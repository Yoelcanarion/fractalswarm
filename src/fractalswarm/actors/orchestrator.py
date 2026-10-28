"""Orchestrators: one actor kind for every level of the fractal tree (spec §2, §4, §5.3).

With ``fanout = [3, 2]`` the root ``o0`` has children ``o1..o3``, each of which has children
``oN.1, oN.2`` (the leaves), and every leaf leads a squad of agents ``oN.M.a1, oN.M.a2``.

What an orchestrator does with a goal depends on the goal's level, not on its own: after a
takeover one orchestrator can own goals of several levels (the root's heir is a track lead).
- **root goal** (level 0): plan it (Wonder), auto-approve the plan in bench mode (its hash
  becomes the scope token) and assign the level-1 subgoals to the child group;
- **intermediate goals**: sub-plan into child subgoals and assign them;
- **leaf goals**: write contracts, dispatch the ready ones to the squad's agents (stigmergy
  over the contract DAG), verify each result (checks, then judge), book placements with
  leases and CAS, and walk the replanning ladder on failure (retry with feedback, then
  reassign).

Ownership of child subgoals uses bounded-load HRW over the child group, so it costs no
tokens. Results integrate bottom-up (``actors/integrator.py``) and the root goal's owner runs
the task's final deterministic check.

**Failure handling** (spec §5.2-§5.3), on when the run has ``membership``: each orchestrator
embeds a failure detector and a bus endpoint and heartbeats its siblings, parent and children
every second. On each tick it also reconciles against the log (``coord/tree.py``):
- it adopts the unfinished goals of dead owners for which it is the HRW heir
  (``ownership.remapped``), with the dead owner's child group (``tree.adopted``): orphaned
  agents and sessions keep running, and their results, sent to the dead owner, are in the
  log, so nothing is paid for twice;
- it pulls such results for the goals it owns, and re-dispatches the contracts of agents
  that died (spawning a replacement when a squad has none left).
An orchestrator that the log declares dead (a partitioned zombie) drops its goals at once;
owner-scoped writes carry fencing tokens.

``mode="central"`` is the central baseline (spec §15.1): one orchestrator owns every goal and
leads every squad, under the best-case supervisor (``baselines/supervisor.py``). A
``chaos.crash`` cancels everything in flight, its agents' calls included (process-tree
semantics); it restarts ``RESTART_DELAY_MS`` later and redoes only the lost work.
``single`` and ``pipeline`` are the same process with one worker: one contract is in flight
across the run, each verified before the next. ``single`` is one agent that also plans, one
LLM call at a time. ``pipeline`` plans every goal first (the planner), then works through the
contracts (the sequential worker) and integrates. All three make the same planning calls as
the swarm, so they plan as well as it does.
"""

from typing import Any

from fractalswarm.actors.board import BOARD
from fractalswarm.actors.integrator import finish_goal, leaf_outcome, merge_children
from fractalswarm.baselines.supervisor import RESTART_TAG
from fractalswarm.bench.profiles import RESTART_DELAY_MS
from fractalswarm.bench.tasks.t2_conference.task import T2
from fractalswarm.comms.bus import Endpoint
from fractalswarm.comms.chaos import CRASH_TOPIC
from fractalswarm.coord import membership
from fractalswarm.coord.hrw import assign, rank
from fractalswarm.coord.membership import Detector
from fractalswarm.coord.tree import ROLE, heir
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import (
    Cancel,
    Command,
    Emit,
    Send,
    SetTimer,
    Spawn,
    StartEffect,
    Stop,
    View,
)
from fractalswarm.planning import feasibility
from fractalswarm.planning import scope as scoping
from fractalswarm.planning.contracts import Contract
from fractalswarm.planning.dag import Dag
from fractalswarm.planning.risk import contract_risk
from fractalswarm.safety.firewall import Verdict, quarantine_stub, scan_request
from fractalswarm.verify import cross_audit
from fractalswarm.verify.checks import run_checks
from fractalswarm.verify.judge import judge_request, read_verdict

TASKS = {T2.name: T2}
MAX_PLAN_ATTEMPTS = 3
MAX_FEEDBACK_LINES = 20
ACTIVE = ("running", "judging", "auditing", "booking")
# One orchestrator under the best-case supervisor (spec §15.1); the last two have one worker.
CENTRAL_MODES = ("central", "single", "pipeline")
SERIAL_MODES = ("single", "pipeline")
CENTRAL_TICK = "central.tick"
CENTRAL_TICK_MS = 1000
CENTRAL_REDO = "central.redo"


def child_ids(actor_id: str, count: int) -> list[str]:
    prefix = "o" if actor_id == "o0" else f"{actor_id}."
    return [f"{prefix}{i}" for i in range(1, count + 1)]


def leaf_count(fanout: list[int]) -> int:
    total = 1
    for count in fanout:
        total *= count
    return total


def orchestrator_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    fanout = list(args["fanout"])
    level = int(args["level"])
    leaf = level == len(fanout)
    mode = args.get("mode", "swarm")
    agents_per_leaf = int(args["agents_per_leaf"])
    if mode in CENTRAL_MODES:
        count = 1 if mode in SERIAL_MODES else agents_per_leaf * leaf_count(fanout)
        children = [f"{actor_id}.a{i}" for i in range(1, count + 1)]
    elif args.get("bare"):  # a member respawned into a dead group: it inherits, spawns none
        children = []
    elif leaf:
        children = [f"{actor_id}.a{i}" for i in range(1, agents_per_leaf + 1)]
    else:
        children = child_ids(actor_id, fanout[level])
    state: dict[str, Any] = {
        "id": actor_id,
        "level": level,
        "leaf": leaf,
        "fanout": fanout,
        "agents_per_leaf": agents_per_leaf,
        "task": args["task"],
        "max_attempts": int(args.get("max_attempts", 6)),
        "max_steps": int(args.get("max_steps", 8)),
        "parent": args.get("parent"),
        "children": children,
        "root_goal": args.get("root_goal"),
        "scope": "",
        "goals": {},
        "child_of": {},
        "mode": mode,
        "membership": bool(args.get("membership")),
        "relay": args.get("relay"),
        "contributor": bool(args.get("contributor")),
        "audit": bool(args.get("audit")),  # the cross-squad audit (verify/cross_audit.py)
        "feasibility": bool(args.get("feasibility")),  # the report at plan approval
        "spawned": len(children),  # agents spawned so far, for replacement names
        "respawned": 0,  # orchestrators spawned into dead sibling groups
        "squads": 0,  # central: squads handed out to leaf goals so far
        "det": None,
        "ep": None,
        "up": True,  # central: false while crashed
        "crashes": 0,
        "pending_crashes": 0,
        "crashed_agents": [],
        "dropped": [],  # goals dropped while the log called this incarnation dead
    }
    if state["membership"]:
        state["det"] = Detector(member=actor_id, role=ROLE, group=args.get("parent"))
        state["ep"] = Endpoint(owner=actor_id, relay=args.get("relay"))
    return state


def orchestrator_handle(state: dict[str, Any], event: Event, view: View):
    if state["mode"] in CENTRAL_MODES:
        return _central(state, event, view)
    det = state["det"]
    if det is None:
        return _handle(state, event, view)
    if event.type == "actor.spawned":
        state, commands = _spawned(state, view)
        return state, commands + membership.join(det, view, _peers(state, view))
    tick = event.type == "effect.completed" and event.payload["tag"] == membership.TICK_TAG
    if tick:
        membership.watch(det, _peers(state, view), view.now)
    out = membership.handle(det, state["ep"], event, view)
    if out is not None:
        commands = list(out.commands)
        if tick:
            state, more = _reconcile(state, view)
            commands += more
        return state, commands
    if _zombie(state, view):
        return _drop_goals(state), []
    return _handle(state, event, view)


def _handle(state: dict[str, Any], event: Event, view: View):
    kind = event.type
    if kind == "actor.spawned":
        return _spawned(state, view)
    if kind == "effect.completed":
        tag = (event.payload["tag"] or "").split("|")
        if tag[0] == "plan":
            return _planned(state, tag[1], int(tag[2]), event, view)
        if tag[0] == "scan":
            return _scanned(state, tag[1], tag[2], event)
        if tag[0] == "judge":
            payload = event.payload
            text = payload["result"].get("output_text", "")
            return _judged(state, tag[1], tag[2], int(tag[3]), payload["status"], text, view)
        if tag[0] == cross_audit.TAG:
            return _audit_done(state, tag[1], tag[2], int(tag[3]), event, view)
        return state, []
    if kind != "msg.sent":
        return state, []
    topic, body, sender = event.payload["topic"], event.payload["body"], event.actor
    if topic == "assign":
        return _assigned(state, body, sender, view)
    if topic == "result":
        return _child_result(state, body, view)
    if topic == "contract.result":
        return _contract_result(state, body, view)
    if topic == "book.result":
        return _booked(state, body, view)
    if topic == cross_audit.TOPIC_REQUEST:
        return _audit_requested(state, body, view)
    if topic == cross_audit.TOPIC_RESULT:
        return _audit_result(state, body, view)
    if topic == "shutdown":
        return state, [Stop(reason="shutdown")]
    return state, []


# -- spawning and planning ----------------------------------------------------------------


def _spawned(state: dict[str, Any], view: View):
    commands: list[Command] = []
    passed = {"membership": state["membership"], "relay": state["relay"]}
    passed["contributor"] = state["contributor"]
    passed |= _opt_ins(state)
    for child in state["children"]:
        if state["leaf"] or state["mode"] in CENTRAL_MODES:
            commands.append(Spawn(actor_id=child, kind="agent", args=_agent_args(state)))
        else:
            args = {
                key: state[key]
                for key in ("fanout", "agents_per_leaf", "task", "max_attempts", "max_steps")
            }
            args |= {"level": state["level"] + 1, "parent": state["id"]} | passed
            commands.append(Spawn(actor_id=child, kind="orchestrator", args=args))
    if state["root_goal"] is not None:
        root = state["root_goal"]
        state, more = _start_goal(state, root, None, None, 0, view)
        commands += more
    return state, commands


def _assigned(state: dict[str, Any], body: dict[str, Any], sender: str, view: View):
    goal = body["goal"]
    if goal["id"] in state["goals"]:
        return state, []  # idempotent: a duplicate assignment changes nothing
    state = {**state, "scope": body["scope_token"]}
    level = int(body.get("level", state["level"]))
    return _start_goal(state, goal, sender, body.get("parent"), level, view)


def _start_goal(
    state: dict[str, Any],
    goal: dict[str, Any],
    sender: str | None,
    parent_gid: str | None,
    level: int,
    view: View,
):
    entry = {
        "goal": goal,
        "from": sender,
        "parent_gid": parent_gid,
        "level": level,
        "phase": "planning",
        "attempt": 0,
        "feedback": [],
        "epoch": view.member_epoch,
        "group": state["id"],
    }
    if level == len(state["fanout"]):
        entry["agents"] = _squad(state)
        if state["mode"] in CENTRAL_MODES:
            state = {**state, "squads": state["squads"] + 1}
    state = _put_goal(state, goal["id"], entry)
    return _begin(state, goal["id"])


def _begin(state: dict[str, Any], gid: str):
    """Plan the goal; the root first scans its attachments, before any prompt carries them."""
    entry = state["goals"][gid]
    attachments = TASKS[state["task"]].attachments(entry["goal"]) if entry["level"] == 0 else []
    if not attachments:
        if state["mode"] == "single" and _serial_busy(state, but=gid):
            return _put_goal(state, gid, {**entry, "phase": "queued"}), []  # one call at a time
        return state, [_plan_effect(state, gid)]
    state = _put_goal(state, gid, {**entry, "phase": "scanning", "scans": {}})
    return state, [
        StartEffect(
            kind="firewall",
            request=scan_request(text, "attachment", source),
            tag=f"scan|{gid}|{source}",
        )
        for source, text in attachments
    ]


def _scanned(state: dict[str, Any], gid: str, source: str, event: Event):
    entry = state["goals"].get(gid)
    if entry is None or entry["phase"] != "scanning" or source in entry["scans"]:
        return state, []
    if event.payload["status"] == "ok":
        verdict = Verdict.model_validate(event.payload["result"])
    else:  # fail closed: an attachment nobody could scan is not read
        error = event.payload["result"].get("error") or event.payload["status"]
        verdict = Verdict(
            surface="attachment",
            source_id=source,
            decision="quarantine",
            score=1.0,
            backend="none",
            reasons=[f"the scan failed: {error}"],
        )
    commands: list[Command] = [
        Emit(type="security.scanned", payload=verdict.model_dump(mode="json"))
    ]
    if not verdict.allowed:
        quarantined = {"source_id": source, "surface": verdict.surface, "score": verdict.score}
        quarantined |= {"reason": "; ".join(verdict.reasons), "stub": quarantine_stub(verdict)}
        commands.append(Emit(type="security.quarantined", payload=quarantined))
    scans = {**entry["scans"], source: verdict.model_dump(mode="json")}
    entry = {**entry, "scans": scans}
    task = TASKS[state["task"]]
    if len(scans) < len(task.attachments(entry["goal"])):
        return _put_goal(state, gid, entry), commands
    stubs = {
        source_id: quarantine_stub(Verdict.model_validate(found))
        for source_id, found in sorted(scans.items())
        if found["decision"] != "allow"
    }
    entry = {**entry, "goal": task.quarantine(entry["goal"], stubs), "phase": "planning"}
    state = _put_goal(state, gid, entry)
    return state, [*commands, _plan_effect(state, gid)]


def _squad(state: dict[str, Any]) -> list[str]:
    if state["mode"] != "central":  # a leaf's agents, or the one worker of single and pipeline
        return list(state["children"])
    size = state["agents_per_leaf"]
    first = state["squads"] * size
    return list(state["children"][first : first + size])


def _plan_effect(state: dict[str, Any], gid: str) -> StartEffect:
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    goal, feedback = entry["goal"], entry["feedback"]
    if entry["level"] == 0:
        request = task.root_request(goal, feedback)
    elif _is_leaf(state, entry):
        request = task.contracts_request(goal, feedback)
    else:
        request = task.split_request(goal, feedback)
    return StartEffect(
        kind="llm",
        request=_route(state, request),
        tag=f"plan|{gid}|{entry['attempt']}",
        scopes={"squad": state["id"]},
    )


def _planned(state: dict[str, Any], gid: str, attempt: int, event: Event, view: View):
    entry = state["goals"].get(gid)
    if entry is None or entry["phase"] != "planning" or entry["attempt"] != attempt:
        return state, []
    task = TASKS[state["task"]]
    goal = entry["goal"]
    leaf = _is_leaf(state, entry)
    status, result = event.payload["status"], event.payload["result"]
    if status == "ok":
        if entry["level"] == 0:
            plan, errors = task.root_parse(goal, result.get("output_text", ""))
        elif leaf:
            plan, errors = task.contracts_parse(goal, result.get("output_text", ""))
        else:
            plan, errors = task.split_parse(goal, result.get("output_text", ""))
    else:
        plan, errors = None, [f"planning call {status}: {result.get('error') or ''}".strip()]

    commands: list[Command] = []
    if plan is not None and entry["level"] > 0:
        violations, rejected = _check_scope(state, gid, task.proposals(goal, plan, leaf), view)
        commands += violations
        if rejected:
            plan, errors = None, rejected
    fallback = False
    if plan is None:
        payload = {"goal_id": gid, "attempt": attempt, "errors": errors}
        commands.append(_emit(state, gid, "plan.rejected", payload))
        if attempt + 1 < MAX_PLAN_ATTEMPTS:
            entry = {**entry, "attempt": attempt + 1, "feedback": errors}
            state = _put_goal(state, gid, entry)
            return state, [*commands, _plan_effect(state, gid)]
        fallback = True
        if entry["level"] == 0:
            plan = task.root_fallback(goal)
        elif leaf:
            plan = task.contracts_fallback(goal)
        else:
            plan = task.split_fallback(goal)

    if entry["level"] == 0:
        envelope = scoping.approve(goal["goal"], task.envelope(goal, plan))
        token = envelope.scope_token
        state = {**state, "scope": token}
        proposed = {"goal_id": gid, "plan": plan, "plan_hash": token, "fallback": fallback}
        commands.append(_emit(state, gid, "plan.proposed", proposed))
        if state["feasibility"]:
            commands += _feasibility(state, gid, task, goal, plan, envelope, view)
        approved = {"goal_id": gid, "scope_token": token, "by": "auto"}
        approved["envelope"] = envelope.model_dump(mode="json")
        commands.append(_emit(state, gid, "plan.approved", approved))
        state, more = _assign_children(state, gid, task.root_children(goal, plan), view)
        return state, commands + more
    if leaf:
        state, more = _start_contracts(state, gid, plan, fallback, view)
        return state, commands + more
    children = task.split_children(goal, plan)
    payload = {"goal_id": gid, "owner": state["id"], "plan": plan, "fallback": fallback}
    payload["children"] = [c["id"] for c in children]
    commands.append(_emit(state, gid, "plan.refined", payload))
    state, more = _assign_children(state, gid, children, view)
    return state, commands + more


def _check_scope(state: dict[str, Any], gid: str, proposals: list[dict[str, Any]], view: View):
    """(``scope.violation`` events, reasons to reject the plan). A blocked item of the
    decomposition sends the plan back to its planner; a blocked request is dropped."""
    scope = view.views.get("scope")
    if scope is None or not proposals:
        return [], []
    ancestors = _ancestors(state, gid, view)
    commands: list[Command] = []
    rejected: list[str] = []
    for proposal, decision in scoping.check(
        scope, proposals, state["scope"], state["id"], ancestors
    ):
        if decision.allowed:
            continue
        found = scoping.evidence(scope, proposal, gid, state["id"])
        commands.append(Emit(type="scope.violation", payload=decision.violation_payload(found)))
        if proposal.get("node_id") is not None:
            rejected += [f"{decision.subgoal_id}: {reason}" for reason in decision.reasons]
    return commands, rejected


def _ancestors(state: dict[str, Any], gid: str, view: View) -> list[str]:
    """The owners of the goals above ``gid``, nearest first."""
    tree = view.views.get("tree")
    found: list[str] = []
    parent = state["goals"][gid]["parent_gid"]
    while tree is not None and parent is not None and parent in tree.goals:
        found.append(tree.goals[parent].owner)
        parent = tree.goals[parent].parent
    return found


# -- non-leaf: child subgoals -------------------------------------------------------------


def _assign_children(state: dict[str, Any], gid: str, children: list[dict[str, Any]], view: View):
    entry = state["goals"][gid]
    group = _child_group(state, entry, view)
    # epsilon 0 at plan time: with no more subgoals than members, one each (parallel squads);
    # takeover remaps use the spec's epsilon (coord/tree.py).
    keys = {child["id"]: child["priority"] for child in children}
    owners = assign(keys, group, epsilon=0.0)
    commands: list[Command] = []
    tracked = {}
    child_of = dict(state["child_of"])
    level = entry["level"] + 1
    for child in sorted(children, key=lambda c: c["id"]):
        owner = owners[child["id"]]
        payload = {"group": entry["group"], "key": child["id"], "owner": owner}
        commands.append(_emit(state, gid, "ownership.assigned", payload))
        tracked[child["id"]] = {"owner": owner, "status": "assigned", "result": None}
        child_of[child["id"]] = gid
    entry = {**entry, "phase": "running", "children": tracked}
    state = _put_goal({**state, "child_of": child_of}, gid, entry)
    for child in sorted(children, key=lambda c: c["id"]):
        body = {"goal": child, "scope_token": state["scope"], "parent": gid, "level": level}
        if state["mode"] in CENTRAL_MODES:  # one process: the child goal starts in place
            state, more = _start_goal(state, child, state["id"], gid, level, view)
            commands += more
        else:
            commands.append(Send(to=owners[child["id"]], topic="assign", body=body))
    return state, commands


def _child_group(state: dict[str, Any], entry: dict[str, Any], view: View) -> list[str]:
    """Who the goal's child subgoals go to: the live members of its child group."""
    if state["mode"] in CENTRAL_MODES:
        return [state["id"]]
    members = view.views.get("members")
    if state["membership"] and members is not None:
        alive = members.alive(role=ROLE, group=entry["group"])
        return alive or [state["id"]]
    return list(state["children"])


def _child_result(state: dict[str, Any], body: dict[str, Any], view: View):
    gid = state["child_of"].get(body["goal_id"])
    entry = state["goals"].get(gid) if gid else None
    if entry is None or entry["phase"] != "running":
        return state, []
    child = entry["children"].get(body["goal_id"])
    if child is None or child["status"] != "assigned":
        return state, []  # first result wins (idempotent)
    children = {**entry["children"], body["goal_id"]: {**child, "status": body["status"]}}
    children[body["goal_id"]]["result"] = body
    entry = {**entry, "children": children}
    state = _put_goal(state, gid, entry)
    if any(c["status"] == "assigned" for c in children.values()):
        return state, []
    task = TASKS[state["task"]]
    output, gaps = merge_children(task, entry["goal"], children)
    return _complete(state, gid, output, gaps, view)


def _complete(state: dict[str, Any], gid: str, output: dict[str, Any], gaps: list[str], view: View):
    entry = {**state["goals"][gid], "phase": "done"}
    state = _put_goal(state, gid, entry)
    task = TASKS[state["task"]]
    events, body = finish_goal(task, state["id"], entry, output, gaps)
    commands: list[Command] = [_fenced(state, gid, command) for command in events]
    if body is None:  # the root goal: the run's result is in, stop everything
        others = [actor for actor in view.alive if actor != state["id"]]
        stops = [Stop(actor_id=actor, reason="done", cancel=True) for actor in others]
        return state, [*commands, *stops, Stop(reason="done", cancel=True)]
    if state["mode"] in CENTRAL_MODES:
        state, more = _child_result(state, body, view)
        return state, commands + more
    target = _result_target(state, entry, view)
    return state, [*commands, Send(to=target, topic="result", body=body)]


def _result_target(state: dict[str, Any], entry: dict[str, Any], view: View) -> str:
    """The parent goal's current owner: an heir, if the assigner has died since."""
    tree = view.views.get("tree")
    owner = tree.owner_of(entry["parent_gid"]) if tree is not None else None
    return owner or entry["from"]


# -- leaf: contracts ----------------------------------------------------------------------


def _start_contracts(
    state: dict[str, Any], gid: str, plan: dict[str, Any], fallback: bool, view: View
):
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    contracts = task.contracts(entry["goal"], plan, state["id"], state["scope"])
    contracts = [
        c.model_copy(
            update={"budget": c.budget.model_copy(update={"max_steps": state["max_steps"]})}
        )
        for c in contracts
    ]
    commands: list[Command] = []
    state, agents, spawned = _live_agents(state, gid, view)
    commands += spawned
    keys = {f"{gid}/{c.id}": c.priority for c in contracts}
    owners = assign(keys, agents)
    refined = {
        "goal_id": gid,
        "owner": state["id"],
        "children": [c.id for c in contracts],
        "plan": plan,
        "fallback": fallback,
    }
    commands.append(_emit(state, gid, "plan.refined", refined))
    stored = {}
    for contract in contracts:
        contract = contract.model_copy(update={"assignee": owners[f"{gid}/{contract.id}"]})
        stored[contract.id] = contract.model_dump()
        created = {"contract": stored[contract.id], "work": f"{gid}/{contract.id}"}
        created["owner"] = state["id"]
        commands.append(_emit(state, gid, "contract.created", created))
    entry = {
        **state["goals"][gid],
        "phase": "running",
        "contracts": stored,
        "status": dict.fromkeys(stored, "pending"),
        "outputs": {},
        "pending": {},
        "collisions": dict.fromkeys(stored, 0),
        "losses": dict.fromkeys(stored, 0),
    }
    state = _put_goal(state, gid, entry)
    state, more = _dispatch(state, gid, view)
    return state, commands + more


def _live_agents(state: dict[str, Any], gid: str, view: View):
    """The goal's squad agents that are alive; spawns a replacement if none is."""
    entry = state["goals"][gid]
    alive = [agent for agent in entry["agents"] if _alive(view, agent)]
    if alive:
        return state, alive, []
    number = state["spawned"] + 1
    agent = f"{state['id']}.a{number}"
    entry = {**entry, "agents": [*entry["agents"], agent]}
    state = _put_goal({**state, "spawned": number}, gid, entry)
    return state, [agent], [Spawn(actor_id=agent, kind="agent", args=_agent_args(state))]


def _alive(view: View, actor: str) -> bool:
    """Alive, or spawned by this very handler call (not in the log yet, so not dead)."""
    tree = view.views.get("tree")
    return actor in view.alive or (tree is not None and actor not in tree.kinds)


def _dispatch(state: dict[str, Any], gid: str, view: View):
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    status = dict(entry["status"])
    contracts = dict(entry["contracts"])
    dag = Dag({cid: c["depends_on"] for cid, c in contracts.items()})
    done = [cid for cid, s in status.items() if s == "verified"]
    busy = [cid for cid, s in status.items() if s != "pending"]
    commands: list[Command] = []
    ready = dag.ready(done, busy)
    if state["mode"] in SERIAL_MODES and ready:
        if _serial_busy(state) or not _work_open(state):
            return state, []  # one worker: the session waits its turn (_serial_next)
        ready = ready[:1]
    agents: list[str] = []
    if ready:
        state, agents, spawned = _live_agents(state, gid, view)
        entry = state["goals"][gid]
        commands += spawned
    for cid in ready:
        contract = Contract.model_validate(contracts[cid])
        deps = {dep: entry["outputs"][dep] for dep in contract.depends_on}
        inputs = task.contract_inputs(entry["goal"], contract, deps)
        update: dict[str, Any] = {"inputs": inputs, "owner": state["id"]}
        if contract.assignee not in agents:
            update["assignee"] = rank(f"{gid}/{cid}:{contract.attempt}", agents)[0]
        contract = contract.model_copy(update=update)
        contracts[cid] = contract.model_dump()
        status[cid] = "running"
        dispatched = {
            "goal_id": gid,
            "contract_id": cid,
            "attempt": contract.attempt,
            "assignee": contract.assignee,
            "idem_key": contract.idem_key,
            "work": f"{gid}/{cid}",
        }
        commands.append(_emit(state, gid, "contract.dispatched", dispatched))
        commands.append(
            Send(to=contract.assignee, topic="contract", body={"contract": contracts[cid]})
        )
    entry = {**entry, "status": status, "contracts": contracts}
    state = _put_goal(state, gid, entry)
    if commands:
        return state, commands
    if any(s in ACTIVE for s in status.values()):
        return state, []
    output, gaps = leaf_outcome(task, entry, dag)
    return _complete(state, gid, output, gaps, view)


def _contract_result(state: dict[str, Any], body: dict[str, Any], view: View):
    gid, cid = body["goal_id"], body["contract_id"]
    entry = state["goals"].get(gid)
    if entry is None or entry["phase"] != "running" or cid not in entry["contracts"]:
        return state, []
    contract = Contract.model_validate(entry["contracts"][cid])
    if entry["status"][cid] != "running" or body["attempt"] != contract.attempt:
        return state, []  # stale: an earlier attempt's late answer
    completed = {
        "goal_id": gid,
        "contract_id": cid,
        "attempt": contract.attempt,
        "agent": body["agent"],
        "status": body["status"],
        "steps": body["steps"],
    }
    commands: list[Command] = [_emit(state, gid, "contract.completed", completed)]
    if body["status"] != "ok":
        state, more = _retry(state, gid, cid, "agent", [body["error"]], view)
        return state, commands + more
    task = TASKS[state["task"]]
    output = body["output"]
    failures = run_checks(contract.acceptance.checks, output, task.check_context(entry["goal"]))
    if failures:
        state, more = _retry(state, gid, cid, "checks", failures, view)
        return state, commands + more
    pending = {**entry["pending"], cid: {"output": output, "published": body["published"]}}
    entry = {**entry, "pending": pending}
    state = _put_goal(state, gid, entry)
    if task.needs_judge(contract):
        state, more = _judge(state, gid, cid, view)
    else:
        state, more = _vet(state, gid, cid, view)
    return state, commands + more


def _judge(state: dict[str, Any], gid: str, cid: str, view: View):
    """Ask the judge, unless the log already holds its verdict (a dead owner asked it)."""
    state = _set_status(state, gid, cid, "judging")
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    logged = _logged(view, gid, cid)
    verdict = logged.judged.get(contract.attempt) if logged is not None else None
    if verdict is not None:
        return _judged(state, gid, cid, contract.attempt, *verdict, view, reused=True)
    output = entry["pending"][cid]["output"]
    request = judge_request(contract, output, contract.inputs.get("data", {}))
    effect = StartEffect(
        kind="llm",
        request=_route(state, request),
        tag=f"judge|{gid}|{cid}|{contract.attempt}",
        scopes={"contract": contract.idem_key, "squad": state["id"]},
    )
    return state, [effect]


def _judged(
    state: dict[str, Any],
    gid: str,
    cid: str,
    attempt: int,
    status: str,
    text: str,
    view: View,
    reused: bool = False,
):
    entry = state["goals"].get(gid)
    if entry is None or entry["status"].get(cid) != "judging":
        return state, []
    contract = Contract.model_validate(entry["contracts"][cid])
    if contract.attempt != attempt:
        return state, []
    verdict = read_verdict(status, text)
    payload = {"goal_id": gid, "contract_id": cid, "attempt": attempt} | verdict.model_dump()
    commands: list[Command] = [_emit(state, gid, "verify.judged", payload | _reused(reused))]
    if verdict.verdict == "fail":
        reasons = verdict.reasons or ["the judge failed it"]
        state, more = _retry(state, gid, cid, "judge", reasons, view)
        return state, commands + more
    state, more = _vet(state, gid, cid, view)
    return state, commands + more


def _reused(reused: bool) -> dict[str, Any]:
    return {"reused": True} if reused else {}


# -- the cross-squad audit (verify/cross_audit.py) ----------------------------------------


def _vet(state: dict[str, Any], gid: str, cid: str, view: View):
    """The last gate before booking: when the run asks for the audit, sample the contract and
    have a sibling audit it. Off, this is just ``_accept``."""
    audits = view.views.get("cross_audit")
    if not state["audit"] or audits is None:
        return _accept(state, gid, cid, view)
    contract = Contract.model_validate(state["goals"][gid]["contracts"][cid])
    work = f"{gid}/{cid}"
    sampled = audits.sampled.get((work, contract.attempt))  # the log's copy, if it has one
    commands: list[Command] = []
    if sampled is None:
        risk = contract_risk(contract, view.views.get("role_history"))
        forced = audits.failed_before(work, contract.attempt)
        found = cross_audit.sample(
            view.seed, work, contract.attempt, risk.r, contract.critical_path, forced
        )
        sampled = {"goal_id": gid, "contract_id": cid, "attempt": contract.attempt, "work": work}
        sampled |= {"risk": round(risk.r, 6), "critical_path": contract.critical_path}
        sampled |= {"terms": {k: round(v, 6) for k, v in risk.terms.model_dump().items()}}
        sampled |= found.model_dump()
        idem = f"verify.sampled:{work}:{contract.attempt}"
        commands.append(_emit(state, gid, "verify.sampled", sampled, idem))
    if not sampled["selected"]:
        state, more = _accept(state, gid, cid, view)
        return state, commands + more
    state = _set_status(state, gid, cid, "auditing")
    state, more = _audit(state, gid, cid, view)
    return state, commands + more


def _audit(state: dict[str, Any], gid: str, cid: str, view: View):
    """Have a sibling audit the contract, or take the verdict the log already holds (a dead
    owner's request, or an auditor that died after answering)."""
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    audits = view.views["cross_audit"]
    work = f"{gid}/{cid}"
    key = (work, contract.attempt)
    found = audits.verdicts.get(key)
    if found is not None:
        outcome = cross_audit.read_audit(*found)
        return _audited(state, gid, cid, outcome, view, reused=True)
    if any(
        _orchestrator_live(state, view, who) for who in [*audits.asked(key), *audits.working(key)]
    ):
        return (
            state,
            [],
        )  # a live auditor has it: its answer comes back, or it dies and we ask again
    auditor = cross_audit.pick_auditor(work, contract.attempt, _audit_pool(state, view))
    if auditor is None:
        return _audited(state, gid, cid, cross_audit.skipped("no live auditor"), view)
    output = entry["pending"][cid]["output"]
    request = cross_audit.audit_request(contract, output, contract.inputs.get("data", {}))
    body = {"goal_id": gid, "contract_id": cid, "attempt": contract.attempt, "owner": state["id"]}
    body |= {"idem_key": contract.idem_key, "request": request}
    return state, [Send(to=auditor, topic=cross_audit.TOPIC_REQUEST, body=body)]


def _audit_pool(state: dict[str, Any], view: View) -> list[str]:
    """Who may audit this orchestrator's contracts: its live siblings (the other children of
    its current parent, so adopted groups count), else any other live orchestrator."""
    tree, me = view.views["tree"], state["id"]
    parent = tree.parents.get(me, state["parent"])
    siblings = tree.child_actors(parent, "orchestrator") if parent is not None else []
    pool = [who for who in siblings if who != me and _orchestrator_live(state, view, who)]
    if pool:
        return pool
    everyone = [who for who, kind in sorted(tree.kinds.items()) if kind == "orchestrator"]
    return [who for who in everyone if who != me and _orchestrator_live(state, view, who)]


def _orchestrator_live(state: dict[str, Any], view: View, actor: str) -> bool:
    """Alive as the log sees it: not declared dead (membership on), else still running."""
    members = view.views.get("members")
    if state["membership"] and members is not None:
        return not members.is_gone(actor)
    return actor in view.alive


def _audit_requested(state: dict[str, Any], body: dict[str, Any], view: View):
    """A sibling asks this orchestrator to audit one of its contracts: one LLM call, billed to
    the audited squad. A call already running or answered (in the log) is not asked twice."""
    audits = view.views.get("cross_audit")
    key = (f"{body['goal_id']}/{body['contract_id']}", body["attempt"])
    if audits is None or key in audits.verdicts or audits.working(key):
        return state, []
    tag = f"{cross_audit.TAG}|{body['goal_id']}|{body['contract_id']}|{body['attempt']}"
    effect = StartEffect(
        kind="llm",
        request=_route(state, body["request"]),
        tag=tag,
        scopes={"contract": body["idem_key"], "squad": body["owner"]},
    )
    return state, [effect]


def _audit_done(state: dict[str, Any], gid: str, cid: str, attempt: int, event: Event, view: View):
    """The audit call came back: tell the goal's current owner (an heir, if it changed)."""
    tree = view.views.get("tree")
    owner = tree.owner_of(gid) if tree is not None else None
    if owner is None:
        return state, []
    payload = event.payload
    body = {"goal_id": gid, "contract_id": cid, "attempt": attempt, "auditor": state["id"]}
    body |= {"status": payload["status"], "text": payload["result"].get("output_text", "")}
    return state, [Send(to=owner, topic=cross_audit.TOPIC_RESULT, body=body)]


def _audit_result(state: dict[str, Any], body: dict[str, Any], view: View):
    gid, cid = body["goal_id"], body["contract_id"]
    entry = state["goals"].get(gid)
    if entry is None or entry["phase"] != "running" or entry["status"].get(cid) != "auditing":
        return state, []
    if body["attempt"] != Contract.model_validate(entry["contracts"][cid]).attempt:
        return state, []  # an earlier attempt's late answer
    outcome = cross_audit.read_audit(body["status"], body["text"], body["auditor"])
    return _audited(state, gid, cid, outcome, view)


def _audited(
    state: dict[str, Any],
    gid: str,
    cid: str,
    outcome: cross_audit.AuditOutcome,
    view: View,
    reused: bool = False,
):
    """The verdict is in: ``fail`` puts the contract back on the replanning ladder (spec
    §5.5, steps 1-2, with the auditor's reasons as feedback), anything else goes on to
    booking."""
    entry = state["goals"].get(gid)
    if entry is None or entry["status"].get(cid) != "auditing":
        return state, []
    contract = Contract.model_validate(entry["contracts"][cid])
    payload = {"goal_id": gid, "contract_id": cid, "attempt": contract.attempt}
    payload |= outcome.model_dump() | _reused(reused)
    idem = f"verify.audited:{gid}/{cid}:{contract.attempt}"
    commands: list[Command] = [_emit(state, gid, "verify.audited", payload, idem)]
    if outcome.verdict == "fail":
        reasons = outcome.reasons or ["the audit failed it"]
        state, more = _retry(state, gid, cid, "audit", reasons, view)
        return state, commands + more
    state, more = _accept(state, gid, cid, view)
    return state, commands + more


def _feasibility(
    state: dict[str, Any],
    gid: str,
    task: Any,
    goal: dict[str, Any],
    plan: dict[str, Any],
    envelope: Any,
    view: View,
) -> list[Command]:
    """The feasibility report, an event between the proposed and the approved plan (§12)."""
    report = feasibility.build(
        task,
        goal,
        plan,
        envelope,
        fanout=state["fanout"],
        max_steps=state["max_steps"],
        max_attempts=state["max_attempts"],
        contributor=state["contributor"],
        audit=state["audit"],
        config=view.views.get("run_config"),
        scans=view.views["scope"].scans if view.views.get("scope") is not None else {},
    )
    if report is None:
        return []
    return [
        _emit(
            state,
            gid,
            "plan.feasibility",
            report.model_dump(mode="json"),
            f"plan.feasibility:{gid}",
        )
    ]


def _accept(state: dict[str, Any], gid: str, cid: str, view: View):
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    output = entry["pending"][cid]["output"]
    writes = task.bookings(entry["goal"], contract, output)
    if not writes:
        return _verified(state, gid, cid, view)
    state = _set_status(state, gid, cid, "booking")
    logged = _logged(view, gid, cid)
    booked = logged.booked.get(contract.attempt) if logged is not None else None
    if booked is not None:  # the dead owner's booking already went through the board
        return _booked(state, {"goal_id": gid, "contract_id": cid, "conflicts": booked}, view)
    det = state["det"]
    token = {"member": state["id"], "incarnation": det.incarnation if det else 0}
    body = {
        "goal_id": gid,
        "contract_id": cid,
        "attempt": contract.attempt,
        "token": token | {"epoch": view.member_epoch},
        "writes": writes,
    }
    return state, [Send(to=BOARD, topic="book", body=body)]


def _booked(state: dict[str, Any], body: dict[str, Any], view: View):
    gid, cid = body["goal_id"], body["contract_id"]
    entry = state["goals"].get(gid)
    if entry is None or entry["status"].get(cid) != "booking":
        return state, []
    if not body["conflicts"]:
        return _verified(state, gid, cid, view)
    task = TASKS[state["task"]]
    collisions = {**entry["collisions"], cid: entry["collisions"][cid] + 1}
    state = _put_goal(state, gid, {**entry, "collisions": collisions})
    feedback = task.conflict_feedback(body["conflicts"])
    return _retry(state, gid, cid, "booking", feedback, view)


def _verified(state: dict[str, Any], gid: str, cid: str, view: View):
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    pending = entry["pending"][cid]
    entry = {
        **entry,
        "outputs": {**entry["outputs"], cid: pending["output"]},
        "status": {**entry["status"], cid: "verified"},
    }
    state = _put_goal(state, gid, entry)
    verified = {"goal_id": gid, "contract_id": cid, "attempt": contract.attempt}
    commands: list[Command] = [
        _emit(state, gid, "contract.verified", verified | {"work": f"{gid}/{cid}"})
    ]
    if pending["published"]:
        commands.append(Send(to=BOARD, topic="promote", body={"keys": pending["published"]}))
    if entry["collisions"][cid]:
        resolution = f"re-placed after {entry['collisions'][cid]} booking conflict(s)"
        payload = {"kind": "temporal", "goal_id": gid, "resolution": resolution}
        commands.append(_emit(state, gid, "collision.resolved", payload))
    state, more = _dispatch(state, gid, view)
    return state, commands + more


def _retry(state: dict[str, Any], gid: str, cid: str, stage: str, reasons: list[str], view: View):
    """The replanning ladder, steps 1-2: retry with feedback, then reassign to a sibling.

    A contract lost with its agent (stage ``lost``) is re-dispatched without counting as a
    failed attempt.
    """
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    reasons = [reason[:400] for reason in reasons[:MAX_FEEDBACK_LINES]]
    rejected = {
        "goal_id": gid,
        "contract_id": cid,
        "attempt": contract.attempt,
        "stage": stage,
        "reasons": reasons,
    }
    commands: list[Command] = [_emit(state, gid, "contract.rejected", rejected)]
    losses = dict(entry.get("losses") or dict.fromkeys(entry["contracts"], 0))
    if stage == "lost":
        losses[cid] = losses.get(cid, 0) + 1
    attempt = contract.attempt + 1
    if attempt - losses.get(cid, 0) >= state["max_attempts"]:
        failed = {"goal_id": gid, "contract_id": cid, "attempt": contract.attempt}
        failed |= {"reasons": reasons, "work": f"{gid}/{cid}"}
        commands.append(_emit(state, gid, "contract.failed", failed))
        state = _set_status(state, gid, cid, "failed")
        state, more = _dispatch(state, gid, view)
        return state, commands + more
    assignee = contract.assignee
    if stage == "lost":
        assignee = None  # _dispatch picks a live agent
    elif stage != "booking" and attempt >= 2:
        ranked = rank(f"{gid}/{cid}", entry["agents"])
        others = [agent for agent in ranked if agent != contract.assignee] or ranked
        assignee = others[0]
    feedback = contract.feedback if stage == "lost" else reasons
    contract = contract.model_copy(
        update={"attempt": attempt, "feedback": feedback, "assignee": assignee}
    )
    entry = {
        **entry,
        "contracts": {**entry["contracts"], cid: contract.model_dump()},
        "status": {**entry["status"], cid: "pending"},
        "losses": losses,
    }
    state = _put_goal(state, gid, entry)
    state, more = _dispatch(state, gid, view)
    return state, commands + more


# -- failure handling: membership, reconcile, adoption ------------------------------------


def _peers(state: dict[str, Any], view: View) -> list[str]:
    """Siblings, the (current) parent and the (current) child orchestrators (spec §5.2)."""
    me, det = state["id"], state["det"]
    members, tree = view.views.get("members"), view.views.get("tree")
    peers: set[str] = set()
    if members is not None and det.group is not None:
        peers |= set(members.alive(role=ROLE, group=det.group))
    if tree is not None:
        parent = tree.parents.get(me, state["parent"])
        if parent is not None and tree.kinds.get(parent) == "orchestrator":
            peers.add(parent)
        peers |= set(tree.child_actors(me, kind="orchestrator"))
    else:
        if state["parent"] is not None:
            peers.add(state["parent"])
        if not state["leaf"]:
            peers |= set(state["children"])
    peers.discard(me)
    if members is not None:
        peers = {peer for peer in peers if not members.is_gone(peer)}
    return sorted(peers)


def _zombie(state: dict[str, Any], view: View) -> bool:
    members = view.views.get("members")
    det = state["det"]
    return members is not None and members.is_dead(state["id"], det.incarnation)


def _drop_goals(state: dict[str, Any]) -> dict[str, Any]:
    """The log says this incarnation is dead: its goals belong to its heirs now. They are
    remembered: if this member is back (a new incarnation) before any heir took them, nobody
    else ever will, so it takes them back from the log (``_reconcile``)."""
    if not state["goals"]:
        return state
    dropped = sorted(set(state["dropped"]) | set(state["goals"]))
    return {**state, "goals": {}, "child_of": {}, "dropped": dropped}


def _reconcile(state: dict[str, Any], view: View):
    members, tree = view.views.get("members"), view.views.get("tree")
    if members is None or tree is None:
        return state, []
    if _zombie(state, view):
        return _drop_goals(state), []
    me = state["id"]
    commands: list[Command] = []
    respawned: set[str | None] = set()
    for gid in state["dropped"]:
        record = tree.goals.get(gid)
        if record is not None and not record.done and record.owner == me:
            state, more = _adopt(state, gid, view)  # back alive and still the owner
            commands += more
    state = {**state, "dropped": []}
    for gid in sorted(tree.goals):
        record = tree.goals[gid]
        if record.done or gid in state["goals"] or not members.is_gone(record.owner):
            continue
        new_owner = heir(tree, gid, members)
        if new_owner == me:
            state, more = _adopt(state, gid, view)
            commands += more
        elif new_owner is None and tree.owner_of(record.parent) == me:
            group = members.get(record.owner).group
            if group not in respawned:
                respawned.add(group)
                state, more = _respawn(state, record.level, group)
                commands += more
    for gid in sorted(state["goals"]):
        state, more = _pull(state, gid, view)
        commands += more
    return state, commands


def _adopt(state: dict[str, Any], gid: str, view: View):
    """Take over a dead owner's goal: rebuild it from the log, adopt its child group."""
    tree, members = view.views["tree"], view.views["members"]
    record = tree.goals[gid]
    previous, me = record.owner, state["id"]
    leaf = record.level == len(state["fanout"])
    entry: dict[str, Any] = {
        "goal": record.goal,
        "from": tree.owner_of(record.parent),
        "parent_gid": record.parent,
        "level": record.level,
        "phase": "planning",
        "attempt": 0,
        "feedback": [],
        "epoch": view.member_epoch,
        "group": previous,
    }
    works: list[str] = []
    adopted = 0
    children = [actor for actor in _child_group_of(tree, gid, leaf) if actor in view.alive]
    children = [actor for actor in children if actor != me]
    if leaf:
        entry["agents"] = children
        if record.plan is not None and record.contracts:
            entry, works, adopted = _rebuild_leaf(entry, record, gid)
    elif record.plan is not None and tree.children_goals(gid):
        tracked = {}
        for child in tree.children_goals(gid):
            result = tree.goals[child].result
            status = result["status"] if result is not None else "assigned"
            tracked[child] = {"owner": tree.goals[child].owner, "status": status, "result": result}
        entry |= {"phase": "running", "children": tracked}
        state = {**state, "child_of": state["child_of"] | dict.fromkeys(tracked, gid)}
    state = _put_goal(state, gid, entry)

    group = members.get(previous).group if members.get(previous) is not None else None
    remapped = {"group": group, "key": gid, "owner": me, "previous": previous}
    remapped |= {"works": works, "adopted_results": adopted}
    # One key per takeover: a member back from a false death can own the same goal again, and
    # the kernel drops an event whose key is already in the log.
    takeover = f"{gid}:{previous}:{me}:{view.member_epoch}"
    commands: list[Command] = [
        _emit(state, gid, "ownership.remapped", remapped, f"ownership.remapped:{takeover}")
    ]
    duties = ["final integration", "top-level arbitration"] if record.level == 0 else []
    if not leaf and record.level > 0:
        duties = ["integration", "arbitration"]
    if children or duties:
        payload = {"dead": previous, "adopter": me, "goal_id": gid, "children": children}
        idem = f"tree.adopted:{takeover}"
        commands.append(_emit(state, gid, "tree.adopted", payload | {"duties": duties}, idem))

    if not state["scope"] and view.views.get("scope") is not None:
        state = {**state, "scope": view.views["scope"].latest}
    if entry["phase"] == "planning":  # the plan died with its owner: plan it again
        state, more = _begin(state, gid)
        return state, [*commands, *more]
    if not leaf:
        tracked = entry["children"]
        if all(child["status"] != "assigned" for child in tracked.values()):
            task = TASKS[state["task"]]
            output, gaps = merge_children(task, entry["goal"], tracked)
            state, more = _complete(state, gid, output, gaps, view)
            return state, commands + more
    return state, commands


def _child_group_of(tree: Any, gid: str, leaf: bool) -> list[str]:
    """A goal's child group: the owners of its subgoals, or its squad (the agents its
    contracts went to, plus the owner's own agents when this was its only session)."""
    record = tree.goals[gid]
    if not leaf:
        return sorted({tree.goals[child].owner for child in tree.children_goals(gid)})
    squad = {found.contract.get("assignee") for found in record.contracts.values()}
    sessions = [
        g for g in tree.goals.values() if g.owner == record.owner and g.level == record.level
    ]
    if len(sessions) == 1:
        squad |= set(tree.child_actors(record.owner, "agent"))
    return sorted(agent for agent in squad if agent)


def _respawn(state: dict[str, Any], level: int, group: str | None):
    """A whole sibling group died (spec §5.3): the parent goal's owner spawns a new member
    into it, which inherits the group's goals by HRW on its first tick."""
    number = state["respawned"] + 1
    prefix = "o" if state["id"] == "o0" else f"{state['id']}."
    actor = f"{prefix}{len(state['children']) + number}"
    args = {key: state[key] for key in ("fanout", "agents_per_leaf", "task", "max_attempts")}
    args |= {"max_steps": state["max_steps"], "level": level, "parent": group, "bare": True}
    args |= {"membership": True, "relay": state["relay"], "contributor": state["contributor"]}
    args |= _opt_ins(state)
    state = {**state, "respawned": number}
    return state, [Spawn(actor_id=actor, kind="orchestrator", args=args)]


def _rebuild_leaf(entry: dict[str, Any], record: Any, gid: str):
    contracts, status, outputs = {}, {}, {}
    works: list[str] = []
    adopted = 0
    for cid in record.children:
        found = record.contracts.get(cid)
        if found is None:
            continue
        contract = found.contract
        contracts[cid] = contract
        state = found.status if found.status in ("verified", "failed", "running") else "pending"
        status[cid] = state
        if state == "verified":
            outputs[cid] = found.results.get(contract["attempt"], {}).get("output", {})
        else:
            works.append(f"{gid}/{cid}")
        if state == "running" and contract["attempt"] in found.results:
            adopted += 1
    entry = {
        **entry,
        "phase": "running",
        "contracts": contracts,
        "status": status,
        "outputs": outputs,
        "pending": {},
        "collisions": dict.fromkeys(contracts, 0),
        "losses": dict.fromkeys(contracts, 0),
    }
    return entry, works, adopted


def _pull(state: dict[str, Any], gid: str, view: View):
    """Results sent to a dead previous owner are in the log: take them from there. Contracts
    whose agent died are dispatched again; pending ones are dispatched."""
    entry = state["goals"].get(gid)
    tree = view.views.get("tree")
    if entry is None or entry["phase"] != "running" or tree is None:
        return state, []
    commands: list[Command] = []
    if not _is_leaf(state, entry):
        for child in sorted(entry["children"]):
            record = tree.goals.get(child)
            if entry["children"][child]["status"] == "assigned" and record and record.result:
                state, more = _child_result(state, record.result, view)
                commands += more
                entry = state["goals"][gid]
                if entry["phase"] != "running":
                    break
        return state, commands
    for cid in sorted(entry["contracts"]):
        entry = state["goals"][gid]
        if entry["phase"] != "running":
            continue
        if entry["status"].get(cid) == "auditing":  # its auditor may have answered, or died
            state, more = _audit(state, gid, cid, view)
            commands += more
            continue
        if entry["status"].get(cid) != "running":
            continue
        contract = entry["contracts"][cid]
        logged = _logged(view, gid, cid)
        result = logged.results.get(contract["attempt"]) if logged is not None else None
        if result is not None:
            state, more = _contract_result(state, result, view)
            commands += more
        elif not _alive(view, contract["assignee"]):
            reason = f"agent {contract['assignee']} was lost"
            state, more = _retry(state, gid, cid, "lost", [reason], view)
            commands += more
    entry = state["goals"][gid]
    if entry["phase"] == "running" and "pending" in entry["status"].values():
        state, more = _dispatch(state, gid, view)
        commands += more
    return state, commands


def _logged(view: View, gid: str, cid: str):
    tree = view.views.get("tree")
    record = tree.goals.get(gid) if tree is not None else None
    return record.contracts.get(cid) if record is not None else None


# -- the central baseline: one orchestrator under the best-case supervisor ----------------


def _central(state: dict[str, Any], event: Event, view: View):
    state, commands = _central_step(state, event, view)
    if state["mode"] in SERIAL_MODES and state["up"]:
        state, more = _serial_next(state, view)
        commands = [*commands, *more]
    return state, commands


def _central_step(state: dict[str, Any], event: Event, view: View):
    if event.type == "actor.spawned":
        joined = {"member": state["id"], "incarnation": 0, "role": ROLE, "group": None}
        join = Emit(type="member.joined", payload=joined, idem_key=f"member.joined:{state['id']}:0")
        state, commands = _handle(state, event, view)
        tick = SetTimer(delay_ms=CENTRAL_TICK_MS, tag=CENTRAL_TICK)
        return state, [join, *commands, tick]
    tag = event.payload.get("tag") if event.type == "effect.completed" else None
    if tag == RESTART_TAG:
        return _restart(state)
    if tag == CENTRAL_REDO:
        return _redo(state, view)
    if event.type == "msg.sent" and event.payload["topic"] == CRASH_TOPIC:
        if not state["up"]:  # two crash points passed at once: crash again after the restart
            return {**state, "pending_crashes": state["pending_crashes"] + 1}, []
        return _crash(state, view)
    if tag == CENTRAL_TICK:
        if all(entry["phase"] == "done" for entry in state["goals"].values()):
            return state, []
        commands: list[Command] = [SetTimer(delay_ms=CENTRAL_TICK_MS, tag=CENTRAL_TICK)]
        if state["up"]:  # the same 1 s check as the swarm's: lost agents, results in the log
            for gid in sorted(state["goals"]):
                state, more = _pull(state, gid, view)
                commands += more
        return state, commands
    if not state["up"]:
        return state, []  # down: deliveries and completions are lost with the process
    return _handle(state, event, view)


def _crash(state: dict[str, Any], view: View):
    """Process-tree crash: everything in flight dies, the workers' calls included."""
    tags: list[str] = []
    lost: list[str] = []
    for gid in sorted(state["goals"]):
        entry = state["goals"][gid]
        if entry["phase"] == "planning":
            tags.append(f"plan|{gid}|{entry['attempt']}")
            lost.append(gid)
        for cid in sorted(entry.get("status", {})):
            status = entry["status"][cid]
            if status in ACTIVE:
                lost.append(f"{gid}/{cid}")
            if status == "judging":
                tags.append(f"judge|{gid}|{cid}|{entry['contracts'][cid]['attempt']}")
    agents = [agent for agent in _all_agents(state) if agent in view.alive]
    number = state["crashes"] + 1
    payload = {
        "coordinator": state["id"],
        "crash": number,
        "dispatched": _dispatched_count(state),
        "lost": lost,
        "restart_in_ms": RESTART_DELAY_MS,
    }
    commands: list[Command] = [Emit(type="baseline.crashed", payload=payload)]
    commands += [Cancel(tag=tag) for tag in tags]
    commands += [Stop(actor_id=agent, reason="crash", cancel=True) for agent in agents]
    commands.append(SetTimer(delay_ms=RESTART_DELAY_MS, tag=RESTART_TAG))
    state = {**state, "up": False, "crashes": number, "crashed_agents": agents}
    return state, commands


def _restart(state: dict[str, Any]):
    """Back ``RESTART_DELAY_MS`` after the crash; the restart itself takes 0 s. The workers
    come back first, so the redo (a 0 ms timer later) can dispatch to them."""
    commands: list[Command] = [
        Spawn(actor_id=agent, kind="agent", args=_agent_args(state))
        for agent in state["crashed_agents"]
    ]
    state = {**state, "up": True, "crashed_agents": []}
    return state, [*commands, SetTimer(delay_ms=0, tag=CENTRAL_REDO)]


def _redo(state: dict[str, Any], view: View):
    """Redo only the work the crash lost: completed work was kept (native persistence)."""
    commands: list[Command] = []
    redo: list[str] = []
    for gid in sorted(state["goals"]):
        if state["goals"][gid]["phase"] == "planning":
            redo.append(gid)
            commands.append(_plan_effect(state, gid))
            continue
        for cid in sorted(state["goals"][gid].get("status", {})):
            entry = state["goals"][gid]
            status = entry["status"][cid] if entry["phase"] == "running" else None
            if status not in ACTIVE:
                continue
            redo.append(f"{gid}/{cid}")
            if status == "judging":
                state, more = _judge(state, gid, cid, view)
            elif status == "booking":
                state, more = _accept(state, gid, cid, view)
            else:
                logged = _logged(view, gid, cid)
                attempt = entry["contracts"][cid]["attempt"]
                result = logged.results.get(attempt) if logged is not None else None
                if result is not None:  # it answered before the crash: kept
                    state, more = _contract_result(state, result, view)
                else:
                    state, more = _retry(state, gid, cid, "lost", ["lost in a crash"], view)
            commands += more
    restarted = {"coordinator": state["id"], "crash": state["crashes"], "redo": redo}
    commands = [Emit(type="baseline.restarted", payload=restarted), *commands]
    if state["pending_crashes"]:
        state = {**state, "pending_crashes": state["pending_crashes"] - 1}
        state, more = _crash(state, view)
        commands += more
    return state, commands


def _serial_busy(state: dict[str, Any], but: str | None = None) -> bool:
    """Single and pipeline: is the one worker busy? A contract keeps it busy until verified.
    In ``single`` the one agent also plans, so a planning call other than ``but``'s counts."""
    for gid, entry in state["goals"].items():
        if any(status in ACTIVE for status in entry.get("status", {}).values()):
            return True
        if state["mode"] == "single" and gid != but and entry["phase"] == "planning":
            return True
    return False


def _work_open(state: dict[str, Any]) -> bool:
    """The pipeline's worker starts once its planner has planned every goal."""
    if state["mode"] != "pipeline":
        return True
    return all(entry["phase"] not in ("scanning", "planning") for entry in state["goals"].values())


def _serial_next(state: dict[str, Any], view: View):
    """Single and pipeline: give the free worker its next piece of work, in goal order: a
    queued plan first (single only), else the next ready contract."""
    commands: list[Command] = []
    for gid in sorted(state["goals"]):
        if _serial_busy(state):
            return state, commands
        entry = state["goals"][gid]
        if entry["phase"] == "queued":
            state = _put_goal(state, gid, {**entry, "phase": "planning"})
            commands.append(_plan_effect(state, gid))
    if _serial_busy(state) or not _work_open(state):
        return state, commands
    for gid in sorted(state["goals"]):
        entry = state["goals"][gid]
        if entry["phase"] == "running" and "pending" in entry.get("status", {}).values():
            state, more = _dispatch(state, gid, view)
            commands += more
            if _serial_busy(state):
                break
    return state, commands


def _all_agents(state: dict[str, Any]) -> list[str]:
    spawned = {agent for entry in state["goals"].values() for agent in entry.get("agents", [])}
    return sorted({*state["children"], *spawned})


def _dispatched_count(state: dict[str, Any]) -> int:
    return sum(
        1
        for entry in state["goals"].values()
        for status in entry.get("status", {}).values()
        if status != "pending"
    )


# -- helpers ------------------------------------------------------------------------------


def _agent_args(state: dict[str, Any]) -> dict[str, Any]:
    args = {"owner": state["id"], "squad": state["id"], "max_steps": state["max_steps"]}
    return args | {"contributor": state["contributor"]}


def _opt_ins(state: dict[str, Any]) -> dict[str, Any]:
    """The opt-in features this run turned on, for the orchestrators spawned below. They are
    left out when off, so a run that did not ask for them logs the spawn args it always did."""
    return {name: True for name in ("audit", "feasibility") if state[name]}


def _route(state: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    """Contributor routing, when the run opted in (spec §7.5; the client still gates it)."""
    return request | {"contributor": True} if state["contributor"] else request


def _is_leaf(state: dict[str, Any], entry: dict[str, Any]) -> bool:
    return entry["level"] == len(state["fanout"])


def _emit(
    state: dict[str, Any],
    gid: str,
    event_type: str,
    payload: dict[str, Any],
    idem_key: str | None = None,
) -> Emit:
    """An owner-scoped write: with membership on, it carries the owner's fencing token."""
    det = state["det"]
    entry = state["goals"].get(gid)
    if det is not None and entry is not None:
        payload = payload | {"fence": membership.token(det, entry["epoch"], gid)}
    return Emit(type=event_type, payload=payload, idem_key=idem_key)


def _fenced(state: dict[str, Any], gid: str, command: Command) -> Command:
    if isinstance(command, Emit):
        return _emit(state, gid, command.type, command.payload, command.idem_key)
    return command


def _put_goal(state: dict[str, Any], gid: str, entry: dict[str, Any]) -> dict[str, Any]:
    return {**state, "goals": {**state["goals"], gid: entry}}


def _set_status(state: dict[str, Any], gid: str, cid: str, status: str) -> dict[str, Any]:
    entry = state["goals"][gid]
    return _put_goal(state, gid, {**entry, "status": {**entry["status"], cid: status}})
