"""The orchestrator's side of the economy (spec §7.2): making the market of a goal.

An orchestrator that owns a non-leaf goal is the market maker of its child goals. Epochs
close on whichever comes first (spec §7.2):

- ``timer``: 15 s of virtual time after the last close;
- ``completions``: 10 contracts completed under the goal (leaves send ``market.done``);
- ``membership``: the member epoch moved (a join, a death);
- ``ownership``: one of the child goals changed hands (a takeover);
- ``shock``: a budget shock reached the actor.

Closing an epoch clears it: refunds the unused grants, reads the bids off the log
(``market/bids.py``), clears $ and the RPM/TPM slices (the auction, or the proportional
fallback), raises or lowers the squad caps of the leaf goals' owners (``SetCap``) and arms the
next timer. ``topup.request`` messages are granted from the reserve in between.

Nothing is kept here that the log does not hold: epoch numbers, grants and caps are read
from ``MarketView``, so when a maker dies its heir resumes the same market. The functions
return commands without fencing tokens; the orchestrator signs them (``emit``).
"""

from collections.abc import Callable
from typing import Any

from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Send, SetCap, SetTimer, View
from fractalswarm.market.allocation import (
    CHILD_RESERVE_SHARE,
    Allocation,
    allocate_micros,
    reserve_share,
    to_micros,
    to_usd,
)
from fractalswarm.market.auction import Bid, clear, grant_topups, refunds
from fractalswarm.market.bids import (
    Estimates,
    committed,
    contract_estimate,
    floor_requirement,
    goal_need,
    subtree_squads,
    usd_bid,
)
from fractalswarm.market.quotas import Quota, adapt

EPOCH_TAG = "epoch"
Emitter = Callable[[str, str, dict[str, Any], str | None], Command]


def enabled(state: dict[str, Any]) -> bool:
    return state.get("market") is not None


def _views(view: View) -> tuple[Any, Any] | None:
    market, tree = view.views.get("market"), view.views.get("tree")
    return None if market is None or tree is None else (market, tree)


def _next(state: dict[str, Any], market: Any, gid: str) -> int:
    return max(market.next_epoch(gid), state["mk"][gid]["closed"] + 1)


def _timer(state: dict[str, Any], market: Any, gid: str, delay_ms: int) -> SetTimer:
    return SetTimer(delay_ms=delay_ms, tag=f"{EPOCH_TAG}|{gid}|{_next(state, market, gid)}")


def _live_children(tree: Any, view: View, gid: str) -> list[str]:
    """The child goals of ``gid`` whose owner is alive: the bidders."""
    members = view.views.get("members")
    return [
        child
        for child in tree.children_goals(gid)
        if tree.owner_of(child) in view.alive
        and not (members is not None and members.is_gone(tree.owner_of(child)))
    ]


def _signature(tree: Any, gid: str) -> str:
    return repr(sorted((child, tree.owner_of(child)) for child in tree.children_goals(gid)))


def _watch(state: dict[str, Any], view: View, tree: Any, gid: str) -> dict[str, Any]:
    return {
        "closed": state["mk"].get(gid, {}).get("closed", -1),
        "completions": 0,
        "member_epoch": view.member_epoch,
        "sig": _signature(tree, gid),
    }


# -- becoming the maker -------------------------------------------------------------------


def start(state: dict[str, Any], gid: str, view: View):
    """This orchestrator has assigned the child goals of ``gid``: it makes their market. The
    first epoch closes at once (a 0 ms timer, so the assignments are in the log by then)."""
    if not enabled(state) or gid in state["mk"]:
        return state, []
    seen = _views(view)
    if seen is None:
        return state, []
    market, tree = seen
    mk = {**state["mk"], gid: _watch(state, view, tree, gid)}
    mk[gid]["closed"] = market.epochs.get(gid, -1)
    state = {**state, "mk": mk}
    return state, [_timer(state, market, gid, 0)]


def adopt(state: dict[str, Any], gid: str, view: View):
    """A takeover: this orchestrator inherited the goal ``gid`` and continues its market from
    the log. Its next epoch closes when the dead maker's would have."""
    if not enabled(state):
        return state, []
    seen = _views(view)
    if seen is None:
        return state, []
    market, tree = seen
    mk = {**state["mk"], gid: _watch(state, view, tree, gid)}
    mk[gid]["closed"] = market.epochs.get(gid, -1)
    state = {**state, "mk": mk}
    delay = 0
    if gid in market.opened:
        delay = max(market.opened[gid] + state["market"]["epoch_interval_ms"] - view.now, 0)
    return state, [_timer(state, market, gid, delay)]


# -- events the maker reacts to -----------------------------------------------------------


def on_event(state: dict[str, Any], event: Event, view: View, emit: Emitter):
    """Timers, completions, top-up requests, budget shocks, and the forced epochs."""
    seen = _views(view)
    if not enabled(state) or not state["mk"] or seen is None:
        return state, []
    market, tree = seen
    goals = state["goals"]
    live = {
        gid: m for gid, m in state["mk"].items() if gid in goals and goals[gid]["phase"] != "done"
    }
    state = {**state, "mk": live}
    commands: list[Command] = []
    due: dict[str, str] = {}
    payload = event.payload
    if event.type == "effect.completed":
        parts = (payload.get("tag") or "").split("|")
        if (
            parts[0] == EPOCH_TAG
            and parts[1] in live
            and int(parts[2]) >= _next(state, market, parts[1])
        ):
            due[parts[1]] = "start" if int(parts[2]) == 0 else "timer"
    elif event.type == "msg.sent" and payload["to"] == state["id"]:
        topic, body = payload["topic"], payload["body"]
        if topic == "market.done" and body["goal_id"] in live:
            gid = body["goal_id"]
            counts = {**live[gid], "completions": live[gid]["completions"] + 1}
            state = {**state, "mk": {**state["mk"], gid: counts}}
            if counts["completions"] >= state["market"]["epoch_max_completions"]:
                due[gid] = "completions"
        elif topic == "topup.request" and body["goal_id"] in live:
            more = _topup(state, body, view, emit, market, tree)
            commands += more
    elif event.type == "budget.shock":
        due = dict.fromkeys(live, "shock")
    for gid in sorted(state["mk"]):
        if gid not in due:
            changed = _changed(state, gid, view, tree)
            if changed is not None:
                due[gid] = changed
    for gid in sorted(due):
        state, more = close_epoch(state, gid, due[gid], view, emit)
        commands += more
    return state, commands


def _changed(state: dict[str, Any], gid: str, view: View, tree: Any) -> str | None:
    """A forced epoch: the membership or the owners of the child goals changed."""
    watched = state["mk"][gid]
    if watched["closed"] < 0:
        return None  # the first epoch is still pending
    if view.member_epoch != watched["member_epoch"]:
        return "membership"
    if _signature(tree, gid) != watched["sig"]:
        return "ownership"
    return None


# -- closing an epoch ---------------------------------------------------------------------


def close_epoch(state: dict[str, Any], gid: str, reason: str, view: View, emit: Emitter):
    params = state["market"]
    market, tree = _views(view)  # type: ignore[misc]
    est = Estimates.from_args(params)
    level = state["goals"][gid]["level"]
    epoch = _next(state, market, gid)
    children = _live_children(tree, view, gid)
    floor = to_micros(params["floor_usd"])
    needs = {child: goal_need(tree, child, est) for child in children}
    cap = market.run_cap if level == 0 else market.caps.get(gid, market.run_cap)
    commands: list[Command] = []

    previous = market.clearings.get(gid)
    owed = {}
    if previous is not None:
        used = {
            child: max(committed(tree, market, child) - previous.base.get(child, 0), 0)
            for child in previous.grants
            if child in tree.goals
        }
        owed = refunds(previous.grants, used)

    completions = state["mk"][gid]["completions"]
    closed = {"goal_id": gid, "owner": state["id"], "epoch": epoch, "reason": reason}
    closed |= {"at_ms": view.now, "completions": completions, "member_epoch": view.member_epoch}
    commands.append(emit(gid, "market.epoch_closed", closed, f"market.epoch_closed:{gid}:{epoch}"))

    quotas, quota_commands = _quotas(state, gid, epoch, level, view, market, emit)
    commands += quota_commands

    below = CHILD_RESERVE_SHARE
    bids = {
        child: usd_bid(child, needs[child], floor_requirement(tree, child, est, floor, below))
        for child in children
    }
    asks: dict[str, dict[str, Bid]] = {"usd": bids}
    asks |= _rate_bids(state, tree, needs, bids, quotas)
    committed_now = {child: committed(tree, market, child) for child in children}
    results: dict[str, Allocation] = {}
    share = reserve_share(level)
    envelopes = {"usd": max((cap or 0) - committed(tree, market, gid), 0)}
    envelopes |= _rate_envelopes(gid, level, market, quotas, asks)
    for name in sorted(asks):
        if params["mode"] == "auction":
            results[name] = clear(envelopes[name], asks[name].values(), share=share)
        else:
            quantities = {child: bid.q for child, bid in asks[name].items()}
            results[name] = allocate_micros(envelopes[name], quantities, share=share)

    bids_payload = [
        _bid_payload(child, {name: asks[name].get(child) for name in sorted(asks)})
        for child in sorted(children)
    ]
    commands.append(
        emit(gid, "market.bids", {"goal_id": gid, "epoch": epoch, "bids": bids_payload}, None)
    )
    if owed:
        refund = {
            "goal_id": gid,
            "epoch": epoch,
            "refunds": owed,
            "total_micros": sum(owed.values()),
        }
        commands.append(emit(gid, "market.refund", refund, None))

    usd = results["usd"]
    caps = {child: committed_now[child] + usd.grants_micros[child] for child in children}
    cleared = {
        "goal_id": gid,
        "epoch": epoch,
        "mode": params["mode"],
        "resources": {name: _allocation_payload(results[name]) for name in sorted(results)},
        "caps": caps,
        "base": committed_now,
    }
    commands.append(emit(gid, "market.cleared", cleared, f"market.cleared:{gid}:{epoch}"))
    commands += _squad_caps(tree, market, children, usd, level, state)

    watched = _watch(state, view, tree, gid)
    watched["closed"] = epoch
    state = {**state, "mk": {**state["mk"], gid: watched}}
    commands.append(_timer(state, market, gid, params["epoch_interval_ms"]))
    return state, commands


def _squad_caps(
    tree: Any, market: Any, children: list[str], usd: Allocation, level: int, state: dict[str, Any]
) -> list[Command]:
    """The grants of leaf goals become hard caps on their owners' squads: what the squad has
    committed so far plus its grants. Intermediate goals pass their grant down as the
    envelope of their own market (``MarketView.caps``)."""
    if level + 1 < state["market"]["leaf_level"]:
        return []  # the children are intermediate: their grant is their own envelope
    totals: dict[str, int] = {}
    for child in children:
        owner = tree.owner_of(child)
        totals[owner] = totals.get(owner, 0) + usd.grants_micros[child]
    commands: list[Command] = []
    for owner in sorted(totals):
        cap = market.committed(owner) + totals[owner]
        if market.squad_caps.get(owner) != cap:
            commands.append(SetCap(level="squad", key=owner, usd=to_usd(cap)))
    return commands


# -- rate-limit quotas --------------------------------------------------------------------


def _quotas(
    state: dict[str, Any],
    gid: str,
    epoch: int,
    level: int,
    view: View,
    market: Any,
    emit: Emitter,
) -> tuple[dict[str, Quota], list[Command]]:
    """The root market adapts the run's share of each model's rate limit by AIMD (spec §6.1)."""
    limits = state["market"]["limits"]
    quotas = dict(market.quotas)
    if level != 0:
        return quotas, []
    commands: list[Command] = []
    for model in sorted(market.models):
        if model not in limits:
            continue
        known = quotas.get(model)
        if known is None:
            quota, change = Quota(model=model, **limits[model]), "init"
        else:
            quota, change = adapt(known, market.pressure)
        quotas[model] = quota
        payload = {"goal_id": gid, "epoch": epoch, "model": model, "change": change}
        payload |= {"fraction": quota.fraction, "limit_rpm": quota.limit_rpm}
        payload |= {"limit_tpm": quota.limit_tpm, "rpm": quota.rpm, "tpm": quota.tpm}
        payload["pressure"] = market.pressure
        commands.append(emit(gid, "market.quota", payload, None))
    return quotas, commands


def _rate_bids(
    state: dict[str, Any],
    tree: Any,
    needs: dict[str, Any],
    bids: dict[str, Bid],
    quotas: dict[str, Quota],
) -> dict[str, dict[str, Bid]]:
    """RPM and TPM bids per model: each child asks for what its agents would use."""
    params = state["market"]
    out: dict[str, dict[str, Bid]] = {}
    for model in sorted(quotas):
        for kind, per in (("rpm", params["rpm_per_agent"]), ("tpm", params["tpm_per_agent"])):
            name = f"{kind}:{model}"
            out[name] = {}
            for child, need in sorted(needs.items()):
                agents = max(_agents(tree, child), 1)
                ask = agents * per if need.ready else per
                out[name][child] = Bid(
                    child=child, q=ask, floor=min(per, ask), value=bids[child].value
                )
    return out


def _rate_envelopes(
    gid: str, level: int, market: Any, quotas: dict[str, Quota], asks: dict[str, Any]
) -> dict[str, int]:
    out = {}
    for name in asks:
        if name == "usd":
            continue
        kind, model = name.split(":", 1)
        if level == 0:
            quota = quotas[model]
            out[name] = quota.rpm if kind == "rpm" else quota.tpm
        else:
            out[name] = market.slices.get(gid, {}).get(name, 0)
    return out


def _agents(tree: Any, gid: str) -> int:
    live = 0
    for squad in subtree_squads(tree, gid):
        live += len(tree.child_actors(squad, "agent"))
    return live


# -- top-ups ------------------------------------------------------------------------------


def _topup(
    state: dict[str, Any], body: dict[str, Any], view: View, emit: Emitter, market: Any, tree: Any
) -> list[Command]:
    """A child asks for more than its grant: grant it from the reserve, as far as it reaches."""
    gid, child, need = body["goal_id"], body["child"], int(body["need_micros"])
    clearing = market.clearings.get(gid)
    owner = tree.owner_of(child)
    if clearing is None or owner is None or need <= 0:
        return []
    bid = Bid(child=child, q=need, floor=need, value=1.0)
    granted = grant_topups(clearing.reserve_left, [bid]).grants_micros[child]
    old = market.squad_caps.get(owner)
    leaf = state["goals"][gid]["level"] + 1 >= state["market"]["leaf_level"]
    if leaf and old is None:
        return []  # no cap to raise
    cap = (old if leaf else market.caps.get(child, 0)) + granted
    payload = {"goal_id": gid, "epoch": market.epochs.get(gid, 0), "child": child}
    payload |= {"requested_micros": need, "granted_micros": granted}
    payload |= {"reserve_left_micros": clearing.reserve_left - granted, "cap_micros": cap}
    commands: list[Command] = [emit(gid, "market.topup", payload, None)]
    if granted and leaf:
        commands.append(SetCap(level="squad", key=owner, usd=to_usd(cap)))
    return commands


def request_topup(
    state: dict[str, Any], gid: str, contracts: list[dict[str, Any]], view: View
) -> list[Command]:
    """A leaf is about to dispatch ``contracts`` and its squad's headroom is less than they
    are budgeted at: ask the maker of the parent goal for the difference, in one message and
    before the first call reserves."""
    seen = _views(view)
    if not enabled(state) or seen is None:
        return []
    market, tree = seen
    headroom = market.headroom(state["id"])
    est = Estimates.from_args(state["market"])
    need_micros = sum(contract_estimate(contract, est) for contract in contracts)
    if headroom is None or headroom >= need_micros:
        return []
    parent = state["goals"][gid]["parent_gid"]
    maker = tree.owner_of(parent) if parent is not None else None
    if maker is None:
        return []
    body = {"goal_id": parent, "child": gid, "need_micros": need_micros - headroom}
    return [Send(to=maker, topic="topup.request", body=body)]


def completed(state: dict[str, Any], gid: str, view: View) -> list[Command]:
    """A contract under leaf goal ``gid`` finished: tell the makers above it (epoch trigger)."""
    seen = _views(view)
    if not enabled(state) or seen is None:
        return []
    _, tree = seen
    commands: list[Command] = []
    parent = state["goals"][gid]["parent_gid"]
    while parent is not None and parent in tree.goals:
        owner = tree.owner_of(parent)
        if owner is not None:
            commands.append(Send(to=owner, topic="market.done", body={"goal_id": parent}))
        parent = tree.goals[parent].parent
    return commands


# -- payloads -----------------------------------------------------------------------------


def _allocation_payload(allocation: Allocation) -> dict[str, Any]:
    return {
        "envelope": allocation.envelope_micros,
        "reserve": allocation.reserve_micros,
        "pool": allocation.pool_micros,
        "grants": dict(allocation.grants_micros),
    }


def _bid_payload(child: str, by_resource: dict[str, Bid | None]) -> dict[str, Any]:
    usd = by_resource["usd"]
    assert usd is not None
    resources = {
        name: {"q": bid.q, "floor": bid.floor}
        for name, bid in by_resource.items()
        if bid is not None
    }
    return {"child": child, "resources": resources, "value": usd.value, "density": usd.density}
