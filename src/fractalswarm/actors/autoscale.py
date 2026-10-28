"""Autoscale on the live tree (spec §7.3): an orchestrator sizes its own group and squad.

The sizing is pure (``market/scaling.py``); this is its glue to an orchestrator:

- ``group``: when a goal has been split, spawn ``min(#subgoals, cap, affordable)`` child
  orchestrators for it (``affordable`` from the goal's envelope in the market view);
- ``squad``: before a leaf dispatches ready contracts, grow its agents at once to
  ``clamp(min(ready, $alloc / est cost, rpm_alloc / rpm per agent), 1, cap)``, or shrink them
  after two consecutive epochs above the target; the budget ladder (``scale_down`` from 80%
  spent) shrinks them at once;
- ``recursion``: the decision to split a goal further, logged with its inputs.

Every decision is a ``scaling.decided`` event with the numbers behind it. Nothing here calls
the LLM or a clock: epochs are the market's counters, so replay reproduces each decision.
"""

from typing import Any

from fractalswarm.actors import market_maker
from fractalswarm.actors.market_maker import Emitter
from fractalswarm.coord.hrw import assign
from fractalswarm.kernel.scheduler import Command, Spawn, Stop, View
from fractalswarm.market.bids import Estimates, committed, contract_estimate, unplanned
from fractalswarm.market.scaling import (
    DOWN_EPOCHS,
    Caps,
    SquadScale,
    affordable,
    desired_agents,
    orchestrators_for,
    should_recurse,
    step,
)

BUSY = ("running", "judging", "booking")  # a contract an agent is working on


def enabled(state: dict[str, Any]) -> bool:
    return state.get("autoscale") is not None


def caps_of(state: dict[str, Any]) -> Caps:
    return Caps(**state["autoscale"])


def _decided(
    emit: Emitter, gid: str, state: dict[str, Any], kind: str, before: int, after: int, **why: Any
) -> Command:
    payload = {"goal_id": gid, "owner": state["id"], "kind": kind, "before": before, "after": after}
    payload |= {"target": why.pop("target"), "reason": why.pop("reason"), "detail": why}
    return emit(gid, "scaling.decided", payload, None)


# -- orchestrators per group ----------------------------------------------------------------


def group(state: dict[str, Any], gid: str, subgoals: int, view: View, emit: Emitter):
    """Spawn the child orchestrators of goal ``gid``, which has ``subgoals`` child goals.
    A group that already has live members (an heir adopting a goal) is left as it is."""
    seen = market_maker.views(view)
    entry = state["goals"][gid]
    if state["children"] or seen is None or subgoals <= 0:
        return state, []
    members = view.views.get("members")
    if members is not None and members.alive(role="coordinator", group=entry["group"]):
        return state, []
    market, tree = seen
    caps, est, level = caps_of(state), Estimates.from_args(state["market"]), entry["level"]
    cap = market.run_cap if level == 0 else market.caps.get(gid, market.run_cap)
    envelope = None if cap is None else max(cap - committed(tree, market, gid), 0)
    each = unplanned(level + 1, est).usd
    can_pay = affordable(envelope, each)
    n = orchestrators_for(subgoals, caps.max_orchestrators_per_group, can_pay)
    prefix = "o" if state["id"] == "o0" else f"{state['id']}."
    ids = [f"{prefix}{i}" for i in range(1, n + 1)]
    args = {k: state[k] for k in ("fanout", "agents_per_leaf", "task", "max_attempts", "max_steps")}
    args |= {"level": level + 1, "parent": state["id"], "membership": state["membership"]}
    args |= {"relay": state["relay"], "contributor": state["contributor"]}
    args |= {"market": state["market"], "autoscale": state["autoscale"]}
    commands: list[Command] = [Spawn(actor_id=i, kind="orchestrator", args=args) for i in ids]
    reason = (
        f"min({subgoals} subgoals, cap {caps.max_orchestrators_per_group}, affordable {can_pay})"
    )
    commands.append(
        _decided(
            emit,
            gid,
            state,
            "orchestrators",
            0,
            n,
            target=n,
            reason=reason,
            subgoals=subgoals,
            cap=caps.max_orchestrators_per_group,
            affordable=can_pay,
            envelope_micros=envelope,
            est_child_micros=each,
        )
    )
    return {**state, "children": ids}, commands


# -- recursion ------------------------------------------------------------------------------


def recursion(state: dict[str, Any], gid: str, complexity: int, emit: Emitter) -> Command:
    """Log whether goal ``gid`` is split further: while its complexity exceeds the threshold
    and its depth is below the cap. The depth cap is what ends it in a task whose leaves are
    at a fixed level (T2's sessions)."""
    caps = caps_of(state)
    level = state["goals"][gid]["level"]
    split = should_recurse(complexity, caps.complexity_threshold, level, caps.max_depth)
    reason = f"complexity {complexity} vs threshold {caps.complexity_threshold}, "
    reason += f"depth {level} vs cap {caps.max_depth}"
    return _decided(
        emit,
        gid,
        state,
        "recursion",
        level,
        level + int(split),
        target=caps.max_depth,
        reason=reason,
        complexity=complexity,
        split=split,
    )


# -- agents per squad -----------------------------------------------------------------------


def squad(state: dict[str, Any], gid: str, ready: int, view: View, emit: Emitter):
    """Size the squad of leaf goal ``gid`` for ``ready`` contracts about to be dispatched."""
    seen = market_maker.views(view)
    if seen is None:
        return state, []
    market, tree = seen
    entry = state["goals"][gid]
    caps, params = caps_of(state), state["market"]
    est = Estimates.from_args(params)
    contracts = [entry["contracts"][cid] for cid in sorted(entry["contracts"])]
    typical = [contract_estimate(c, est) for c in contracts] or [est.contract]
    slices = [v for k, v in market.slices.get(gid, {}).items() if k.startswith("rpm:")]
    ladder = market_maker.ladder(state, view)
    target = desired_agents(
        ready,
        market.headroom(state["id"]),
        sum(typical) // len(typical),
        min(slices) if slices else None,
        params["rpm_per_agent"],
        caps.max_agents_per_orchestrator,
    )
    headroom = market.headroom(state["id"])
    forced = ladder.scale_down  # 80% spent: shrink at once, and never grow (spec §7.4)
    if forced:
        target = 1
    live = [agent for agent in entry["agents"] if _alive(view, tree, agent)]
    parent = entry["parent_gid"]
    epoch = market.epochs.get(parent, 0) if parent is not None else 0
    if forced:
        scale, delta = SquadScale(), min(target - len(live), 0)
    else:
        scale, delta = step(entry.get("scale") or SquadScale(), len(live), target, epoch)
    entry = {**entry, "scale": scale}
    commands: list[Command] = []
    agents = list(entry["agents"])
    if delta > 0:
        spawned = state["spawned"]
        args = {"owner": state["id"], "squad": state["id"], "max_steps": state["max_steps"]}
        args |= {"contributor": state["contributor"]}
        for _ in range(delta):
            spawned += 1
            agent = f"{state['id']}.a{spawned}"
            agents.append(agent)
            commands.append(Spawn(actor_id=agent, kind="agent", args=args))
        state = {**state, "spawned": spawned}
        reason = f"{ready} ready, headroom {headroom}"
    elif delta < 0:
        busy = {
            c["assignee"] for cid, c in entry["contracts"].items() if entry["status"][cid] in BUSY
        }
        idle = [agent for agent in sorted(live, reverse=True) if agent not in busy]
        stopped = idle[:-delta]
        agents = [agent for agent in agents if agent not in stopped]
        commands += [Stop(actor_id=agent, reason="scale-down") for agent in stopped]
        delta = -len(stopped)
        reason = f"budget ladder {ladder.level}: scale down"
        if not forced:
            reason = f"above target {target} for {DOWN_EPOCHS} epochs"
    if delta:
        commands.append(
            _decided(
                emit,
                gid,
                state,
                "agents",
                len(live),
                len(live) + delta,
                target=target,
                reason=reason,
                ready=ready,
                epoch=epoch,
                headroom_micros=headroom,
            )
        )
    entry = {**entry, "agents": agents}
    return {**state, "goals": {**state["goals"], gid: entry}}, commands


def _alive(view: View, tree: Any, actor: str) -> bool:
    """Alive, or spawned by this very handler call (not in the log yet, so not dead)."""
    return actor in view.alive or actor not in tree.kinds


def spread(gid: str, ready: list[str], contracts: dict[str, Any], agents: list[str]):
    """Which agent takes which of several ready contracts: bounded-load HRW over the squad."""
    keys = {f"{gid}/{cid}": contracts[cid]["priority"] for cid in ready}
    return assign(keys, agents, epsilon=0.0)
