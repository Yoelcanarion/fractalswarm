"""Orchestrators: one actor kind for every level of the fractal tree (spec §2, §4, §5.3).

With ``fanout = [3, 2]`` the root ``o0`` has children ``o1..o3``, each of which has children
``oN.1, oN.2`` (the leaves), and every leaf leads a squad of agents ``oN.M.a1, oN.M.a2``.

What an orchestrator does with a subgoal depends on its level:
- **root** (level 0): plans the goal (Wonder), auto-approves the plan in bench mode (its
  hash becomes the scope token) and assigns the level-1 subgoals to its children;
- **intermediate**: sub-plans its subgoal into child subgoals and assigns them;
- **leaf**: writes contracts, dispatches the ready ones to its agents (stigmergy over the
  contract DAG), verifies each result (checks, then judge), books placements with leases and
  CAS, and walks the replanning ladder on failure (retry with feedback, then reassign).

Ownership of child subgoals uses bounded-load HRW over the child group, so it costs no
tokens. Results integrate bottom-up (``actors/integrator.py``): leaf -> parent -> root, and
the root runs the task's final deterministic check. Failure handling (membership, remap,
adoption) arrives on Day 5.
"""

from typing import Any

from fractalswarm.actors.board import BOARD
from fractalswarm.actors.integrator import finish_goal, leaf_outcome, merge_children
from fractalswarm.bench.tasks.t2_conference.task import T2
from fractalswarm.coord.hrw import assign, rank
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Emit, Send, Spawn, StartEffect, Stop, View
from fractalswarm.planning.contracts import Contract
from fractalswarm.planning.dag import Dag
from fractalswarm.planning.planner import scope_token
from fractalswarm.verify.checks import run_checks
from fractalswarm.verify.judge import judge_request, read_verdict

TASKS = {T2.name: T2}
MAX_PLAN_ATTEMPTS = 3
MAX_FEEDBACK_LINES = 20
ACTIVE = ("running", "judging", "booking")


def child_ids(actor_id: str, count: int) -> list[str]:
    prefix = "o" if actor_id == "o0" else f"{actor_id}."
    return [f"{prefix}{i}" for i in range(1, count + 1)]


def orchestrator_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    fanout = list(args["fanout"])
    level = int(args["level"])
    leaf = level == len(fanout)
    count = int(args["agents_per_leaf"]) if leaf else fanout[level]
    children = (
        [f"{actor_id}.a{i}" for i in range(1, count + 1)] if leaf else child_ids(actor_id, count)
    )
    return {
        "id": actor_id,
        "level": level,
        "leaf": leaf,
        "fanout": fanout,
        "agents_per_leaf": int(args["agents_per_leaf"]),
        "task": args["task"],
        "max_attempts": int(args.get("max_attempts", 6)),
        "max_steps": int(args.get("max_steps", 8)),
        "parent": args.get("parent"),
        "children": children,
        "root_goal": args.get("root_goal"),
        "scope": "",
        "goals": {},
        "child_of": {},
    }


def orchestrator_handle(state: dict[str, Any], event: Event, view: View):
    kind = event.type
    if kind == "actor.spawned":
        return _spawned(state)
    if kind == "effect.completed":
        tag = (event.payload["tag"] or "").split("|")
        if tag[0] == "plan":
            return _planned(state, tag[1], int(tag[2]), event)
        if tag[0] == "judge":
            return _judged(state, tag[1], tag[2], int(tag[3]), event)
        return state, []
    if kind != "msg.sent":
        return state, []
    topic, body, sender = event.payload["topic"], event.payload["body"], event.actor
    if topic == "assign":
        return _assigned(state, body, sender)
    if topic == "result":
        return _child_result(state, body)
    if topic == "contract.result":
        return _contract_result(state, body)
    if topic == "book.result":
        return _booked(state, body)
    if topic == "shutdown":
        return state, _shutdown(state)
    return state, []


# -- spawning and planning ----------------------------------------------------------------


def _spawned(state: dict[str, Any]):
    commands: list[Command] = []
    for child in state["children"]:
        if state["leaf"]:
            args = {"owner": state["id"], "squad": state["id"], "max_steps": state["max_steps"]}
            commands.append(Spawn(actor_id=child, kind="agent", args=args))
        else:
            args = {
                key: state[key]
                for key in ("fanout", "agents_per_leaf", "task", "max_attempts", "max_steps")
            }
            args |= {"level": state["level"] + 1, "parent": state["id"]}
            commands.append(Spawn(actor_id=child, kind="orchestrator", args=args))
    if state["root_goal"] is not None:
        root = state["root_goal"]
        state, more = _start_goal(state, root, sender=None)
        commands += more
    return state, commands


def _assigned(state: dict[str, Any], body: dict[str, Any], sender: str):
    goal = body["goal"]
    if goal["id"] in state["goals"]:
        return state, []  # idempotent: a duplicate assignment changes nothing
    state = {**state, "scope": body["scope_token"]}
    return _start_goal(state, goal, sender)


def _start_goal(state: dict[str, Any], goal: dict[str, Any], sender: str | None):
    entry = {"goal": goal, "from": sender, "phase": "planning", "attempt": 0, "feedback": []}
    state = _put_goal(state, goal["id"], entry)
    return state, [_plan_effect(state, goal["id"])]


def _plan_effect(state: dict[str, Any], gid: str) -> StartEffect:
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    goal, feedback = entry["goal"], entry["feedback"]
    if state["level"] == 0:
        request = task.root_request(goal, feedback)
    elif state["leaf"]:
        request = task.contracts_request(goal, feedback)
    else:
        request = task.split_request(goal, feedback)
    return StartEffect(
        kind="llm",
        request=request,
        tag=f"plan|{gid}|{entry['attempt']}",
        scopes={"squad": state["id"]},
    )


def _planned(state: dict[str, Any], gid: str, attempt: int, event: Event):
    entry = state["goals"].get(gid)
    if entry is None or entry["phase"] != "planning" or entry["attempt"] != attempt:
        return state, []
    task = TASKS[state["task"]]
    goal = entry["goal"]
    status, result = event.payload["status"], event.payload["result"]
    if status == "ok":
        if state["level"] == 0:
            plan, errors = task.root_parse(goal, result.get("output_text", ""))
        elif state["leaf"]:
            plan, errors = task.contracts_parse(goal, result.get("output_text", ""))
        else:
            plan, errors = task.split_parse(goal, result.get("output_text", ""))
    else:
        plan, errors = None, [f"planning call {status}: {result.get('error') or ''}".strip()]

    commands: list[Command] = []
    fallback = False
    if plan is None:
        payload = {"goal_id": gid, "attempt": attempt, "errors": errors}
        commands.append(Emit(type="plan.rejected", payload=payload))
        if attempt + 1 < MAX_PLAN_ATTEMPTS:
            entry = {**entry, "attempt": attempt + 1, "feedback": errors}
            state = _put_goal(state, gid, entry)
            return state, [*commands, _plan_effect(state, gid)]
        fallback = True
        if state["level"] == 0:
            plan = task.root_fallback(goal)
        elif state["leaf"]:
            plan = task.contracts_fallback(goal)
        else:
            plan = task.split_fallback(goal)

    if state["level"] == 0:
        token = scope_token(plan)
        state = {**state, "scope": token}
        commands.append(
            Emit(
                type="plan.proposed",
                payload={"goal_id": gid, "plan": plan, "plan_hash": token, "fallback": fallback},
            )
        )
        commands.append(
            Emit(type="plan.approved", payload={"goal_id": gid, "scope_token": token, "by": "auto"})
        )
        state, more = _assign_children(state, gid, task.root_children(goal, plan))
        return state, commands + more
    if state["leaf"]:
        state, more = _start_contracts(state, gid, plan, fallback)
        return state, commands + more
    children = task.split_children(goal, plan)
    payload = {"goal_id": gid, "owner": state["id"], "plan": plan, "fallback": fallback}
    commands.append(
        Emit(type="plan.refined", payload=payload | {"children": [c["id"] for c in children]})
    )
    state, more = _assign_children(state, gid, children)
    return state, commands + more


# -- non-leaf: child subgoals -------------------------------------------------------------


def _assign_children(state: dict[str, Any], gid: str, children: list[dict[str, Any]]):
    owners = assign({child["id"]: child["priority"] for child in children}, state["children"])
    commands: list[Command] = []
    tracked = {}
    child_of = dict(state["child_of"])
    for child in sorted(children, key=lambda c: c["id"]):
        owner = owners[child["id"]]
        payload = {"group": state["id"], "key": child["id"], "owner": owner}
        commands.append(Emit(type="ownership.assigned", payload=payload))
        commands.append(
            Send(to=owner, topic="assign", body={"goal": child, "scope_token": state["scope"]})
        )
        tracked[child["id"]] = {"owner": owner, "status": "assigned", "result": None}
        child_of[child["id"]] = gid
    entry = {**state["goals"][gid], "phase": "running", "children": tracked}
    state = _put_goal({**state, "child_of": child_of}, gid, entry)
    return state, commands


def _child_result(state: dict[str, Any], body: dict[str, Any]):
    gid = state["child_of"].get(body["goal_id"])
    entry = state["goals"].get(gid) if gid else None
    if entry is None or entry["phase"] != "running":
        return state, []
    child = entry["children"][body["goal_id"]]
    if child["status"] != "assigned":
        return state, []  # first result wins (idempotent)
    children = {**entry["children"], body["goal_id"]: {**child, "status": body["status"]}}
    children[body["goal_id"]]["result"] = body
    entry = {**entry, "children": children}
    state = _put_goal(state, gid, entry)
    if any(c["status"] == "assigned" for c in children.values()):
        return state, []
    task = TASKS[state["task"]]
    output, gaps = merge_children(task, entry["goal"], children)
    return _complete(state, gid, output, gaps)


def _complete(state: dict[str, Any], gid: str, output: dict[str, Any], gaps: list[str]):
    entry = {**state["goals"][gid], "phase": "done"}
    state = _put_goal(state, gid, entry)
    task = TASKS[state["task"]]
    commands = finish_goal(task, state["id"], entry, output, gaps)
    if entry["from"] is None:  # the root: the run's result is in, shut the tree down
        commands += [Stop(actor_id=BOARD, reason="done"), *_shutdown(state)]
    return state, commands


def _shutdown(state: dict[str, Any]) -> list[Command]:
    sends: list[Command] = [Send(to=child, topic="shutdown") for child in state["children"]]
    return [*sends, Stop(reason="shutdown")]


# -- leaf: contracts ----------------------------------------------------------------------


def _start_contracts(state: dict[str, Any], gid: str, plan: dict[str, Any], fallback: bool):
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    contracts = task.contracts(entry["goal"], plan, state["id"], state["scope"])
    contracts = [
        c.model_copy(
            update={"budget": c.budget.model_copy(update={"max_steps": state["max_steps"]})}
        )
        for c in contracts
    ]
    keys = {f"{gid}/{c.id}": c.priority for c in contracts}
    owners = assign(keys, state["children"])
    commands: list[Command] = [
        Emit(
            type="plan.refined",
            payload={
                "goal_id": gid,
                "owner": state["id"],
                "children": [c.id for c in contracts],
                "plan": plan,
                "fallback": fallback,
            },
        )
    ]
    stored = {}
    for contract in contracts:
        contract = contract.model_copy(update={"assignee": owners[f"{gid}/{contract.id}"]})
        stored[contract.id] = contract.model_dump()
        commands.append(Emit(type="contract.created", payload={"contract": stored[contract.id]}))
    entry = {
        **entry,
        "phase": "running",
        "contracts": stored,
        "status": dict.fromkeys(stored, "pending"),
        "outputs": {},
        "pending": {},
        "collisions": dict.fromkeys(stored, 0),
    }
    state = _put_goal(state, gid, entry)
    state, more = _dispatch(state, gid)
    return state, commands + more


def _dispatch(state: dict[str, Any], gid: str):
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    status = dict(entry["status"])
    contracts = dict(entry["contracts"])
    dag = Dag({cid: c["depends_on"] for cid, c in contracts.items()})
    done = [cid for cid, s in status.items() if s == "verified"]
    busy = [cid for cid, s in status.items() if s != "pending"]
    commands: list[Command] = []
    for cid in dag.ready(done, busy):
        contract = Contract.model_validate(contracts[cid])
        deps = {dep: entry["outputs"][dep] for dep in contract.depends_on}
        inputs = task.contract_inputs(entry["goal"], contract, deps)
        contract = contract.model_copy(update={"inputs": inputs})
        contracts[cid] = contract.model_dump()
        status[cid] = "running"
        commands.append(
            Emit(
                type="contract.dispatched",
                payload={
                    "goal_id": gid,
                    "contract_id": cid,
                    "attempt": contract.attempt,
                    "assignee": contract.assignee,
                    "idem_key": contract.idem_key,
                },
            )
        )
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
    return _complete(state, gid, output, gaps)


def _contract_result(state: dict[str, Any], body: dict[str, Any]):
    gid, cid = body["goal_id"], body["contract_id"]
    entry = state["goals"].get(gid)
    if entry is None or entry["phase"] != "running" or cid not in entry["contracts"]:
        return state, []
    contract = Contract.model_validate(entry["contracts"][cid])
    if entry["status"][cid] != "running" or body["attempt"] != contract.attempt:
        return state, []  # stale: an earlier attempt's late answer
    commands: list[Command] = [
        Emit(
            type="contract.completed",
            payload={
                "goal_id": gid,
                "contract_id": cid,
                "attempt": contract.attempt,
                "agent": body["agent"],
                "status": body["status"],
                "steps": body["steps"],
            },
        )
    ]
    if body["status"] != "ok":
        state, more = _retry(state, gid, cid, "agent", [body["error"]])
        return state, commands + more
    task = TASKS[state["task"]]
    output = body["output"]
    failures = run_checks(contract.acceptance.checks, output, task.check_context(entry["goal"]))
    if failures:
        state, more = _retry(state, gid, cid, "checks", failures)
        return state, commands + more
    pending = {**entry["pending"], cid: {"output": output, "published": body["published"]}}
    entry = {**entry, "pending": pending}
    state = _put_goal(state, gid, entry)
    if task.needs_judge(contract):
        request = judge_request(contract, output, contract.inputs.get("data", {}))
        state = _set_status(state, gid, cid, "judging")
        effect = StartEffect(
            kind="llm",
            request=request,
            tag=f"judge|{gid}|{cid}|{contract.attempt}",
            scopes={"contract": contract.idem_key, "squad": state["id"]},
        )
        return state, [*commands, effect]
    state, more = _accept(state, gid, cid, view_epoch=0)
    return state, commands + more


def _judged(state: dict[str, Any], gid: str, cid: str, attempt: int, event: Event):
    entry = state["goals"].get(gid)
    if entry is None or entry["status"].get(cid) != "judging":
        return state, []
    contract = Contract.model_validate(entry["contracts"][cid])
    if contract.attempt != attempt:
        return state, []
    verdict = read_verdict(event.payload["status"], event.payload["result"].get("output_text", ""))
    commands: list[Command] = [
        Emit(
            type="verify.judged",
            payload={"goal_id": gid, "contract_id": cid, "attempt": attempt} | verdict.model_dump(),
        )
    ]
    if verdict.verdict == "fail":
        state, more = _retry(state, gid, cid, "judge", verdict.reasons or ["the judge failed it"])
        return state, commands + more
    state, more = _accept(state, gid, cid, view_epoch=event.member_epoch)
    return state, commands + more


def _accept(state: dict[str, Any], gid: str, cid: str, view_epoch: int):
    task = TASKS[state["task"]]
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    output = entry["pending"][cid]["output"]
    writes = task.bookings(entry["goal"], contract, output)
    if not writes:
        return _verified(state, gid, cid)
    state = _set_status(state, gid, cid, "booking")
    body = {
        "goal_id": gid,
        "contract_id": cid,
        "attempt": contract.attempt,
        "token": {"member": state["id"], "incarnation": 0, "epoch": view_epoch},
        "writes": writes,
    }
    return state, [Send(to=BOARD, topic="book", body=body)]


def _booked(state: dict[str, Any], body: dict[str, Any]):
    gid, cid = body["goal_id"], body["contract_id"]
    entry = state["goals"].get(gid)
    if entry is None or entry["status"].get(cid) != "booking":
        return state, []
    if not body["conflicts"]:
        return _verified(state, gid, cid)
    task = TASKS[state["task"]]
    collisions = {**entry["collisions"], cid: entry["collisions"][cid] + 1}
    state = _put_goal(state, gid, {**entry, "collisions": collisions})
    return _retry(state, gid, cid, "booking", task.conflict_feedback(body["conflicts"]))


def _verified(state: dict[str, Any], gid: str, cid: str):
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    pending = entry["pending"][cid]
    entry = {
        **entry,
        "outputs": {**entry["outputs"], cid: pending["output"]},
        "status": {**entry["status"], cid: "verified"},
    }
    state = _put_goal(state, gid, entry)
    commands: list[Command] = [
        Emit(
            type="contract.verified",
            payload={"goal_id": gid, "contract_id": cid, "attempt": contract.attempt},
        )
    ]
    if pending["published"]:
        commands.append(Send(to=BOARD, topic="promote", body={"keys": pending["published"]}))
    if entry["collisions"][cid]:
        resolution = f"re-placed after {entry['collisions'][cid]} booking conflict(s)"
        payload = {"kind": "temporal", "goal_id": gid, "resolution": resolution}
        commands.append(Emit(type="collision.resolved", payload=payload))
    state, more = _dispatch(state, gid)
    return state, commands + more


def _retry(state: dict[str, Any], gid: str, cid: str, stage: str, reasons: list[str]):
    """The replanning ladder, steps 1-2: retry with feedback, then reassign to a sibling."""
    entry = state["goals"][gid]
    contract = Contract.model_validate(entry["contracts"][cid])
    reasons = [reason[:400] for reason in reasons[:MAX_FEEDBACK_LINES]]
    commands: list[Command] = [
        Emit(
            type="contract.rejected",
            payload={
                "goal_id": gid,
                "contract_id": cid,
                "attempt": contract.attempt,
                "stage": stage,
                "reasons": reasons,
            },
        )
    ]
    attempt = contract.attempt + 1
    if attempt >= state["max_attempts"]:
        commands.append(
            Emit(
                type="contract.failed",
                payload={"goal_id": gid, "contract_id": cid, "attempt": contract.attempt}
                | {"reasons": reasons},
            )
        )
        state = _set_status(state, gid, cid, "failed")
        state, more = _dispatch(state, gid)
        return state, commands + more
    assignee = contract.assignee
    if stage != "booking" and attempt >= 2:
        ranked = rank(f"{gid}/{cid}", state["children"])
        others = [agent for agent in ranked if agent != contract.assignee] or ranked
        assignee = others[0]
    contract = contract.model_copy(
        update={"attempt": attempt, "feedback": reasons, "assignee": assignee}
    )
    entry = {
        **entry,
        "contracts": {**entry["contracts"], cid: contract.model_dump()},
        "status": {**entry["status"], cid: "pending"},
    }
    state = _put_goal(state, gid, entry)
    state, more = _dispatch(state, gid)
    return state, commands + more


# -- helpers ------------------------------------------------------------------------------


def _put_goal(state: dict[str, Any], gid: str, entry: dict[str, Any]) -> dict[str, Any]:
    return {**state, "goals": {**state["goals"], gid: entry}}


def _set_status(state: dict[str, Any], gid: str, cid: str, status: str) -> dict[str, Any]:
    entry = state["goals"][gid]
    return _put_goal(state, gid, {**entry, "status": {**entry["status"], cid: status}})
