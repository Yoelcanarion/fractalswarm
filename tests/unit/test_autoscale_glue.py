"""Autoscale's glue to an orchestrator (spec §7.3), without a run: a hand-built state and view,
so the decisions that T2's chain of contracts never makes (a squad growing, a squad shrinking
after two epochs, the budget ladder) are exercised here."""

from typing import Any

from fractalswarm.actors import autoscale
from fractalswarm.coord.tree import TreeView
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Emit, Spawn, Stop, View
from fractalswarm.market.view import MarketView
from fractalswarm.planning.taskspec import Scaling, TaskSpec, market_params

GID = "track-x/d1"
PARENT = "track-x"
PARAMS = market_params(TaskSpec(goal="g", scaling=Scaling(mode="autoscale")))
assert PARAMS is not None
CAPS = {
    "max_orchestrators_per_group": 6,
    "max_agents_per_orchestrator": 4,
    "max_depth": 2,
    "complexity_threshold": 1,
}
_seq = 0


def event(kind: str, payload: dict[str, Any]) -> Event:
    global _seq
    _seq += 1
    return Event(
        seq=_seq, run_id="r", ts_virtual=0, lamport=_seq, type=kind, actor="x",
        idem_key=f"k{_seq}", payload=payload, prev_hash="", hash="",
    )  # fmt: skip


def emit(gid: str, kind: str, payload: dict[str, Any], key: str | None = None) -> Command:
    return Emit(type=kind, payload=payload, idem_key=key)


def contract(cid: str, status: str, assignee: str | None = None) -> tuple[dict, str]:
    found = {"id": cid, "assignee": assignee, "budget": {"usd": 0.03}, "priority": 1}
    return found, status


def squad_state(agents: list[str], busy: dict[str, str] | None = None, scale=None):
    """A leaf's state: contracts c1..c3 (running ones are held by the agents in ``busy``)."""
    busy = busy or {}
    contracts = {f"c{i}": contract(f"c{i}", "pending")[0] for i in (1, 2, 3)}
    status = dict.fromkeys(contracts, "pending")
    for cid, agent in busy.items():
        contracts[cid]["assignee"], status[cid] = agent, "running"
    entry = {
        "agents": agents,
        "contracts": contracts,
        "status": status,
        "parent_gid": PARENT,
        "level": 2,
        "scale": scale,
    }
    return {
        "id": "o1.1",
        "spawned": len(agents),
        "max_steps": 8,
        "contributor": False,
        "market": PARAMS,
        "autoscale": CAPS,
        "goals": {GID: entry},
    }


def view_of(market: MarketView, agents: list[str], epoch: int = 0) -> View:
    if epoch:
        market.apply(event("market.epoch_closed", {"goal_id": PARENT, "owner": "o1", "epoch": epoch,
                                                   "reason": "timer", "at_ms": 0}))  # fmt: skip
    return View(
        run_id="r", seed="s", actor_id="o1.1", now=0, lamport=0, alive=tuple(agents),
        views={"market": market, "tree": TreeView()},
    )  # fmt: skip


def decided(commands: list[Command]) -> list[dict[str, Any]]:
    return [c.payload for c in commands if isinstance(c, Emit) and c.type == "scaling.decided"]


def run_cap(market: MarketView, usd: float) -> None:
    market.apply(
        event("run.started", {"seed": "s", "scenario": "x", "clock": "sim", "run_cap_usd": usd})
    )


# -- growing and shrinking a squad ---------------------------------------------------------------


def test_a_squad_grows_at_once_to_the_number_of_ready_contracts() -> None:
    agents = ["o1.1.a1"]
    state, commands = autoscale.squad(
        squad_state(agents), GID, 3, view_of(MarketView(), agents), emit
    )
    spawned = [c for c in commands if isinstance(c, Spawn)]
    assert [c.actor_id for c in spawned] == ["o1.1.a2", "o1.1.a3"]
    assert spawned[0].args == {
        "owner": "o1.1",
        "squad": "o1.1",
        "max_steps": 8,
        "contributor": False,
    }
    assert state["goals"][GID]["agents"] == ["o1.1.a1", "o1.1.a2", "o1.1.a3"]
    assert state["spawned"] == 3
    [found] = decided(commands)
    assert (found["kind"], found["before"], found["after"], found["target"]) == ("agents", 1, 3, 3)


def test_a_squad_never_grows_past_the_cap() -> None:
    agents = ["o1.1.a1"]
    state, commands = autoscale.squad(
        squad_state(agents), GID, 20, view_of(MarketView(), agents), emit
    )
    assert len(state["goals"][GID]["agents"]) == 4 == CAPS["max_agents_per_orchestrator"]


def test_a_squad_is_sized_by_its_headroom_and_its_rate_limit_slice() -> None:
    agents = ["o1.1.a1"]
    market = MarketView()
    market.apply(event("budget.cap_set", {"level": "squad", "key": "o1.1", "usd": 0.07}))
    state, _ = autoscale.squad(squad_state(agents), GID, 3, view_of(market, agents), emit)
    assert len(state["goals"][GID]["agents"]) == 2  # $0.07 pays for two $0.03 contracts
    market.apply(event("budget.cap_set", {"level": "squad", "key": "o1.1", "usd": 5.0}))
    rpm = {"envelope": 99, "reserve": 0, "pool": 0, "grants": {GID: 65}}
    cleared = {"goal_id": PARENT, "epoch": 0, "mode": "auction", "caps": {}, "base": {},
               "resources": {"rpm:m": rpm}}  # fmt: skip
    market.apply(event("market.cleared", cleared))
    state, _ = autoscale.squad(squad_state(agents), GID, 3, view_of(market, agents), emit)
    assert len(state["goals"][GID]["agents"]) == 2  # 65 RPM is two agents of 30


def test_scale_down_waits_for_two_consecutive_epochs_and_keeps_busy_agents() -> None:
    agents = ["o1.1.a1", "o1.1.a2", "o1.1.a3"]
    market = MarketView()
    state = squad_state(agents, busy={"c1": "o1.1.a3"})
    for epoch, stops in ((5, 0), (5, 0), (6, 2)):
        view = view_of(market, agents, epoch=epoch if epoch != market.epochs.get(PARENT) else 0)
        state, commands = autoscale.squad(state, GID, 1, view, emit)
        assert len([c for c in commands if isinstance(c, Stop)]) == stops, epoch
    assert state["goals"][GID]["agents"] == ["o1.1.a3"]  # the one at work stays
    [found] = decided(commands)
    assert (found["before"], found["after"], found["target"]) == (3, 1, 1)


def test_a_squad_that_gets_busy_again_does_not_shrink() -> None:
    agents = ["o1.1.a1", "o1.1.a2"]
    market = MarketView()
    state, commands = autoscale.squad(squad_state(agents), GID, 1, view_of(market, agents, 1), emit)
    assert not commands  # first epoch above target
    state, commands = autoscale.squad(state, GID, 2, view_of(market, agents, 2), emit)
    assert not commands  # busy again: the count starts afresh
    state, commands = autoscale.squad(state, GID, 1, view_of(market, agents, 3), emit)
    assert not commands  # one epoch above target again, not two


def test_the_budget_ladder_scales_a_squad_down_at_once_from_80_percent_spent() -> None:
    agents = ["o1.1.a1", "o1.1.a2", "o1.1.a3"]
    market = MarketView()
    run_cap(market, 1.0)
    market.apply(
        event("budget.reserved", {"effect_id": "e", "usd": 0.82, "scopes": {"squad": "z"}})
    )
    state, commands = autoscale.squad(squad_state(agents), GID, 3, view_of(market, agents), emit)
    assert len([c for c in commands if isinstance(c, Stop)]) == 2  # no waiting for epochs
    [found] = decided(commands)
    assert "ladder L1" in found["reason"] and found["after"] == 1
    # Below 80% the same squad keeps its three agents.
    calm = MarketView()
    run_cap(calm, 1.0)
    state, commands = autoscale.squad(squad_state(agents), GID, 3, view_of(calm, agents), emit)
    assert not commands


def test_spread_gives_several_ready_contracts_to_several_agents() -> None:
    contracts = {f"c{i}": {"priority": 1} for i in (1, 2, 3)}
    agents = ["a1", "a2", "a3"]
    owners = autoscale.spread("g", ["c1", "c2", "c3"], contracts, agents)
    assert sorted(owners) == ["g/c1", "g/c2", "g/c3"]
    assert sorted(owners.values()) == agents  # bounded load: one each
    assert owners == autoscale.spread("g", ["c3", "c2", "c1"], contracts, agents)


# -- orchestrators per group ----------------------------------------------------------------------


def group_state(**changes: Any) -> dict[str, Any]:
    entry = {"level": 0, "group": "o0", "goal": {}}
    state = {
        "id": "o0", "children": [], "membership": False, "relay": None, "contributor": False,
        "market": PARAMS, "autoscale": CAPS, "fanout": [6, 6], "agents_per_leaf": 2, "task": "t",
        "max_attempts": 6, "max_steps": 8, "goals": {"root": entry},
    }  # fmt: skip
    return state | changes


def group_view(market: MarketView) -> View:
    tree = TreeView()  # the root goal, owned by o0, as the real run's spawn records it
    spawned = {"actor_id": "o0", "kind": "orchestrator", "parent": None}
    tree.apply(event("actor.spawned", spawned | {"args": {"root_goal": {"id": "root"}}}))
    return View(
        run_id="r", seed="s", actor_id="o0", now=0, lamport=0, alive=("o0",),
        views={"market": market, "tree": tree},
    )  # fmt: skip


def test_a_group_has_min_of_subgoals_cap_and_affordable_orchestrators() -> None:
    market = MarketView()
    run_cap(market, 2.0)
    state, commands = autoscale.group(group_state(), "root", 3, group_view(market), emit)
    spawned = [c for c in commands if isinstance(c, Spawn)]
    assert [c.actor_id for c in spawned] == ["o1", "o2", "o3"] and state["children"] == [
        "o1",
        "o2",
        "o3",
    ]
    assert spawned[0].args["level"] == 1 and spawned[0].args["parent"] == "o0"
    assert spawned[0].args["autoscale"] == CAPS and spawned[0].args["market"] == PARAMS
    [found] = decided(commands)
    assert (found["kind"], found["before"], found["after"]) == ("orchestrators", 0, 3)
    assert found["detail"]["subgoals"] == 3 and found["detail"]["cap"] == 6

    capped = group_state(autoscale=CAPS | {"max_orchestrators_per_group": 2})
    _, commands = autoscale.group(capped, "root", 3, group_view(market), emit)
    assert [c.actor_id for c in commands if isinstance(c, Spawn)] == ["o1", "o2"]


def test_a_group_is_as_big_as_the_money_allows_but_never_empty() -> None:
    each = 0.01 + 2 * (0.01 + 3 * 0.03)  # what one track is estimated to cost
    market = MarketView()
    run_cap(market, 2.2 * each)  # money for two tracks
    _, commands = autoscale.group(group_state(), "root", 3, group_view(market), emit)
    assert len([c for c in commands if isinstance(c, Spawn)]) == 2
    broke = MarketView()
    run_cap(broke, 0.001)
    _, commands = autoscale.group(group_state(), "root", 3, group_view(broke), emit)
    assert len([c for c in commands if isinstance(c, Spawn)]) == 1  # work always has an owner


def test_an_heir_adopting_a_goal_finds_its_group_already_spawned() -> None:
    market = MarketView()
    run_cap(market, 2.0)
    state, commands = autoscale.group(
        group_state(children=["o1"]), "root", 3, group_view(market), emit
    )
    assert not commands and state["children"] == ["o1"]


def test_recursion_is_logged_with_its_inputs() -> None:
    state = group_state()
    state["goals"]["root"]["level"] = 1
    found = autoscale.recursion(state, "root", 2, emit)
    assert isinstance(found, Emit) and found.payload["detail"] == {"complexity": 2, "split": True}
    assert found.payload["before"] == 1 and found.payload["after"] == 2
    state["goals"]["root"]["level"] = 2  # at the depth cap it stops, however complex
    found = autoscale.recursion(state, "root", 9, emit)
    assert found.payload["detail"]["split"] is False and found.payload["after"] == 2
