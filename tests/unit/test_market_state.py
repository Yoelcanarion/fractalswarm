"""The economy's state: AIMD quotas, bids derived from the log, and the market view that
mirrors the ledger (spec §6.1, §7.2). All pure; no run needed."""

from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.coord.tree import TreeView
from fractalswarm.kernel.events import Event
from fractalswarm.market.allocation import to_micros
from fractalswarm.market.bids import (
    Estimates,
    Need,
    contract_estimate,
    floor_requirement,
    goal_need,
    spent,
    subtree_squads,
    unplanned,
    usd_bid,
)
from fractalswarm.market.ledger import Ledger
from fractalswarm.market.quotas import (
    CEILING,
    DECREASE,
    FLOOR,
    INCREASE,
    START,
    Quota,
    adapt,
    rate_limited,
)
from fractalswarm.market.view import MarketView

# -- AIMD quotas ------------------------------------------------------------------------------

pressures = st.lists(st.integers(min_value=0, max_value=3), max_size=40)


def run_aimd(history: list[int]) -> list[Quota]:
    quota, seen = Quota(model="m", limit_rpm=3000, limit_tpm=4_000_000), []
    for pressure in history:
        quota, _ = adapt(quota, pressure)
        seen.append(quota)
    return seen


@given(pressures)
def test_the_share_of_the_limit_stays_between_5_and_80_percent(history) -> None:
    for quota in run_aimd(history):
        assert FLOOR <= quota.fraction <= CEILING
        assert quota.rpm <= 0.8 * quota.limit_rpm and quota.tpm <= 0.8 * quota.limit_tpm


@given(pressures)
def test_pressure_only_ever_shrinks_the_share_and_clean_epochs_only_grow_it(history) -> None:
    quota = Quota(model="m", limit_rpm=100, limit_tpm=100)
    for pressure in history:
        after, change = adapt(quota, pressure)
        if pressure:
            assert after.fraction <= quota.fraction and change == "decrease"
        else:
            assert after.fraction >= quota.fraction and change in {"increase", "hold"}
        quota = after


def test_aimd_is_additive_up_and_multiplicative_down() -> None:
    quota = Quota(model="m", limit_rpm=1000, limit_tpm=1000)
    assert quota.fraction == START == 0.5
    grown, change = adapt(quota, 0)
    assert change == "increase" and grown.fraction == START + INCREASE
    shrunk, change = adapt(quota, 2)
    assert change == "decrease" and shrunk.fraction == START * DECREASE
    top = Quota(model="m", limit_rpm=1000, limit_tpm=1000, fraction=CEILING)
    assert adapt(top, 0) == (top, "hold")
    bottom = Quota(model="m", limit_rpm=1000, limit_tpm=1000, fraction=FLOOR)
    assert adapt(bottom, 1)[0].fraction == FLOOR  # never below 5%


def test_aimd_recovers_after_a_429() -> None:
    fractions = [q.fraction for q in run_aimd([0, 0, 1, 0, 0, 0])]
    expected = [0.55, 0.6, 0.6 * DECREASE, 0.42 + INCREASE, 0.47 + INCREASE, 0.52 + INCREASE]
    assert fractions == pytest.approx(expected)


def test_a_call_that_met_the_rate_limit_is_pressure() -> None:
    assert rate_limited({"http_status": 429, "attempts": 5})
    assert rate_limited({"http_status": 200, "attempts": 2})  # it needed a retry
    assert not rate_limited({"http_status": 200, "attempts": 1})
    assert not rate_limited({})


# -- a TreeView built from events -------------------------------------------------------------

_seq = 0


def event(kind: str, payload: dict[str, Any], actor: str = "x", at: int = 0) -> Event:
    global _seq
    _seq += 1
    return Event(
        seq=_seq,
        run_id="r",
        ts_virtual=at,
        lamport=_seq,
        type=kind,
        actor=actor,
        idem_key=f"k{_seq}",
        payload=payload,
        prev_hash="",
        hash="",
    )


def contract(goal: str, cid: str, *, usd: float = 0.1, risk: float = 0.3, critical=False) -> dict:
    return {
        "id": cid,
        "goal_id": goal,
        "owner": "x",
        "budget": {"usd": usd},
        "risk": risk,
        "critical_path": critical,
    }


def tree_of(shape: dict[str, tuple[str | None, str, int]]) -> TreeView:
    """Goals as ``{id: (parent, owner, level)}``, in creation order."""
    tree = TreeView()
    for gid, (parent, owner, level) in shape.items():
        if parent is None:
            root = {"id": gid, "priority": 1}
            tree.apply(
                event(
                    "actor.spawned",
                    {
                        "actor_id": owner,
                        "kind": "orchestrator",
                        "args": {"root_goal": root},
                        "parent": None,
                    },
                )
            )
        else:
            body = {"goal": {"id": gid, "priority": 1}, "parent": parent, "level": level}
            tree.apply(event("msg.sent", {"to": owner, "topic": "assign", "body": body}))
    return tree


def add_contracts(tree: TreeView, goal: str, *specs: dict) -> None:
    for spec in specs:
        tree.apply(event("contract.created", {"contract": spec, "work": f"{goal}/{spec['id']}"}))


SHAPE = {
    "root": (None, "o0", 0),
    "a": ("root", "o1", 1),
    "b": ("root", "o2", 1),
    "a/d1": ("a", "o1.1", 2),
    "a/d2": ("a", "o1.2", 2),
}
EST = Estimates(plan=10_000, contract=30_000, contracts_per_leaf=3, fanout=(3, 2), leaf_level=2)


def test_work_nobody_has_planned_is_estimated_from_the_shape_of_the_tree() -> None:
    leaf = unplanned(2, EST)
    assert leaf.usd == 10_000 + 3 * 30_000 and leaf.remaining == 3 and leaf.ready
    middle = unplanned(1, EST)  # a track: its plan, then two sessions
    assert middle.usd == 10_000 + 2 * leaf.usd and middle.remaining == 6
    assert unplanned(0, EST).usd == 10_000 + 3 * middle.usd


def test_a_goal_with_contracts_is_priced_from_what_is_left_of_them() -> None:
    tree = tree_of(SHAPE)
    add_contracts(
        tree,
        "a/d1",
        contract("a/d1", "extract", usd=0.5, risk=0.2),
        contract("a/d1", "place", risk=0.9, critical=True),
        contract("a/d1", "blurb", risk=0.1),
    )
    need = goal_need(tree, "a/d1", EST)
    # The planner's budget is a ceiling: the estimate is the smaller of it and the typical cost.
    assert need.usd == 3 * 30_000 and need.remaining == need.total == 3 and need.critical == 1
    assert need.risk == 0.9 and need.ready  # the riskiest contract drives the bid
    tree.apply(
        event("contract.verified", {"goal_id": "a/d1", "contract_id": "extract", "attempt": 0})
    )
    tree.apply(
        event(
            "contract.failed",
            {"goal_id": "a/d1", "contract_id": "blurb", "attempt": 0, "reasons": []},
        )
    )
    need = goal_need(tree, "a/d1", EST)
    assert need.remaining == 1 and need.total == 3 and need.usd == 30_000
    tree.apply(event("goal.completed", {"goal_id": "a/d1", "owner": "o1.1", "status": "ok"}))
    assert goal_need(tree, "a/d1", EST) == Need()


def test_a_smaller_declared_budget_wins_over_the_typical_cost() -> None:
    assert contract_estimate({"budget": {"usd": 0.01}}, EST) == 10_000
    assert contract_estimate({"budget": {"usd": 0.50}}, EST) == 30_000
    assert contract_estimate({}, EST) == 30_000


def test_the_need_of_a_goal_adds_up_its_children() -> None:
    tree = tree_of(SHAPE)
    add_contracts(tree, "a/d1", contract("a/d1", "x"), contract("a/d1", "y", risk=0.8))
    need = goal_need(tree, "a", EST)
    # d1 has two contracts; d2 has none yet, so it is estimated as an unplanned leaf.
    assert need.remaining == 2 + 3 and need.risk == 0.8
    assert need.usd == 2 * 30_000 + unplanned(2, EST).usd


def test_a_parent_must_ask_for_the_floors_of_the_squads_below_it() -> None:
    tree = tree_of(SHAPE)
    floor, reserve = 80_000, 0.10
    assert floor_requirement(tree, "a/d1", EST, floor, reserve) == floor
    # Track a has two sessions; its market holds back 10%, so it needs 2 floors / 0.9.
    assert floor_requirement(tree, "a", EST, floor, reserve) == -(-2 * floor * 10 // 9)
    # Track b is not split yet: it will be, into fanout[1] = 2 sessions.
    assert floor_requirement(tree, "b", EST, floor, reserve) == floor_requirement(
        tree, "a", EST, floor, reserve
    )
    # The root's market sums its children's requirements, grossed up the same way.
    above = floor_requirement(tree, "root", EST, floor, reserve)
    assert above >= 2 * floor_requirement(tree, "a", EST, floor, reserve)


def test_a_bid_always_asks_for_its_floor_and_is_worth_nothing_when_idle() -> None:
    idle = usd_bid("g", Need(), 80_000)
    assert idle.q == idle.floor == 80_000 and idle.value == 0.0 and idle.density == 0.0
    busy = usd_bid(
        "g", Need(usd=200_000, remaining=2, total=4, critical=1, risk=0.5, priority=1), 80_000
    )
    assert busy.q == 200_000 and busy.value == 2 * 1.5 * 1.5 * 0.5


def test_settled_money_is_summed_over_the_squads_below_a_goal_and_reservations_do_not_count() -> (
    None
):
    tree = tree_of(SHAPE)
    market = MarketView()
    for squad, usd in (("o1", 0.01), ("o1.1", 0.02), ("o1.2", 0.04), ("o2", 0.08), ("o0", 0.16)):
        scopes = {"squad": squad, "run": "r"}
        market.apply(
            event("budget.reserved", {"effect_id": f"e-{squad}", "usd": usd * 3, "scopes": scopes})
        )
        market.apply(
            event(
                "budget.settled",
                {"effect_id": f"e-{squad}", "reserved_usd": usd * 3, "actual_usd": usd},
            )
        )
    # A call in flight holds a worst case that is not spent: the market's envelopes ignore it.
    inflight = {"effect_id": "late", "usd": 0.5, "scopes": {"squad": "o1.1", "run": "r"}}
    market.apply(event("budget.reserved", inflight))
    assert subtree_squads(tree, "a") == ["o1", "o1.1", "o1.2"]
    assert spent(tree, market, "a") == to_micros(0.07)
    assert spent(tree, market, "root") == to_micros(0.31)  # the root goal is the whole run
    assert market.committed("o1.1") == to_micros(0.52)  # the ledger's cap does count it


# -- the market view mirrors the ledger ---------------------------------------------------------


def test_the_view_agrees_with_the_ledger_at_every_step() -> None:
    ledger, market = Ledger(), MarketView()
    ledger.set_cap("squad", "s", 0.10)
    market.apply(event("budget.cap_set", {"level": "squad", "key": "s", "usd": 0.10}))
    scopes = {"run": "r", "squad": "s"}
    steps = [("e1", 0.03, 0.01), ("e2", 0.04, 0.04), ("e3", 0.02, 0.0)]
    for effect, reserved, _ in steps:
        ledger.reserve(effect, scopes, reserved)
        market.apply(
            event("budget.reserved", {"effect_id": effect, "usd": reserved, "scopes": scopes})
        )
        assert market.committed("s") == to_micros(ledger.committed(("squad", "s")))
        assert market.headroom("s") == to_micros(0.10 - ledger.committed(("squad", "s")))
    for effect, reserved, actual in steps:
        ledger.settle(effect, actual)
        market.apply(
            event(
                "budget.settled",
                {"effect_id": effect, "reserved_usd": reserved, "actual_usd": actual},
            )
        )
        assert market.committed("s") == to_micros(ledger.committed(("squad", "s")))
    assert market.spent["s"] == to_micros(0.05) and market.reserved["s"] == 0


def test_a_squad_that_owns_leaves_in_two_markets_is_capped_by_both_grants() -> None:
    # o3 owns a session under track a and another under track b (autoscale with few
    # orchestrators, or an heir). When a's market clears, o3's cap must still count the
    # grant b's market gave it. The Phase 0 mutation check found no test that did.
    from fractalswarm.actors.market_maker import _squad_caps
    from fractalswarm.market.allocation import Allocation, to_usd

    tree = tree_of(
        {
            "root": (None, "o0", 0),
            "a": ("root", "o1", 1),
            "b": ("root", "o2", 1),
            "a1": ("a", "o3", 2),
            "a2": ("a", "o4", 2),
            "b1": ("b", "o3", 2),
            "b2": ("b", "o5", 2),
        }
    )
    market = MarketView()
    cleared_b = {
        "goal_id": "b",
        "epoch": 0,
        "mode": "auction",
        "resources": {
            "usd": {"envelope": 550, "reserve": 50, "pool": 0, "grants": {"b1": 300, "b2": 200}},
        },
        "caps": {},
        "base": {},
    }
    market.apply(event("market.cleared", cleared_b))
    usd = Allocation(
        envelope_micros=600, reserve_micros=100, pool_micros=0, grants_micros={"a1": 400, "a2": 100}
    )
    state = {"market": {"leaf_level": 2}}
    commands = _squad_caps(tree, market, "a", ["a1", "a2"], usd, 1, state)
    assert [(command.key, command.usd) for command in commands] == [
        ("o3", pytest.approx(to_usd(400 + 300))),
        ("o4", pytest.approx(to_usd(100))),
    ]


def test_the_view_follows_the_run_cap_and_a_shock() -> None:
    market = MarketView()
    market.apply(
        event("run.started", {"seed": "1", "scenario": "s", "clock": "sim", "run_cap_usd": 2.0})
    )
    assert market.run_cap == to_micros(2.0)
    market.apply(event("budget.shock", {"level": "run", "key": "r", "usd": 0.5, "reason": ""}))
    assert market.run_cap == to_micros(0.5) and market.shocks == 1
    assert market.headroom("nobody") is None  # no cap, no headroom to speak of


def test_the_view_keeps_the_last_clearing_and_what_top_ups_took_from_its_reserve() -> None:
    market = MarketView()
    cleared = {
        "goal_id": "root",
        "epoch": 3,
        "mode": "auction",
        "resources": {
            "usd": {"envelope": 1000, "reserve": 150, "pool": 0, "grants": {"a": 600, "b": 250}},
            "rpm:m": {"envelope": 10, "reserve": 1, "pool": 0, "grants": {"a": 6, "b": 3}},
        },
        "caps": {"a": 900, "b": 700},
        "base": {"a": 300, "b": 450},
    }
    market.apply(event("market.cleared", cleared))
    last = market.clearings["root"]
    assert last.epoch == 3 and last.reserve_left == 150 and last.grants == {"a": 600, "b": 250}
    assert market.caps == {"a": 900, "b": 700} and market.slices["a"]["rpm:m"] == 6
    topup = {
        "goal_id": "root",
        "epoch": 3,
        "child": "a",
        "requested_micros": 200,
        "granted_micros": 120,
        "reserve_left_micros": 30,
        "cap_micros": 1020,
    }
    market.apply(event("market.topup", topup))
    assert market.clearings["root"].reserve_left == 30 and market.caps["a"] == 1020
    market.apply(
        event(
            "market.epoch_closed",
            {"goal_id": "root", "owner": "o0", "epoch": 4, "reason": "timer", "at_ms": 9000},
        )
    )
    assert market.next_epoch("root") == 5 and market.opened["root"] == 9000
    assert market.next_epoch("track-x") == 0


def test_rate_limited_calls_are_counted_until_a_quota_update_clears_them() -> None:
    market = MarketView()
    ok = {"model": "m", "http_status": 200, "attempts": 1}
    for result in (ok, ok | {"attempts": 3}, ok | {"http_status": 429}):
        market.apply(
            event(
                "effect.completed",
                {"effect_id": "e", "kind": "llm", "status": "ok", "result": result, "tag": "t"},
            )
        )
    assert market.pressure == 2 and market.models == {"m"}
    market.apply(
        event(
            "market.quota",
            {
                "goal_id": "root",
                "epoch": 1,
                "model": "m",
                "change": "decrease",
                "fraction": 0.35,
                "limit_rpm": 100,
                "limit_tpm": 1000,
                "rpm": 35,
                "tpm": 350,
                "pressure": 2,
            },
        )
    )
    assert market.pressure == 0
    assert market.quotas["m"] == Quota(model="m", limit_rpm=100, limit_tpm=1000, fraction=0.35)


# -- the reserve gives way to the floors -----------------------------------------------------


def test_the_reserve_gives_way_to_the_floors_a_squad_needs_to_make_a_call() -> None:
    from fractalswarm.actors.market_maker import _reserve_share

    def asks(*floors: int) -> dict:
        from fractalswarm.market.auction import Bid

        return {
            f"g{n}": Bid(child=f"g{n}", q=max(f, 1), floor=f, value=1.0)
            for n, f in enumerate(floors)
        }

    assert (
        _reserve_share(0, 1_000_000, asks(100_000, 100_000)) == 0.15
    )  # the floors fit: 15% at the root
    assert _reserve_share(1, 1_000_000, asks(100_000, 100_000)) == 0.10  # and 10% below it
    # Floors of 100_000 in an envelope of 105_000 leave room for a reserve of 5_000, not 10_500.
    share = _reserve_share(1, 105_000, asks(100_000))
    assert share < 0.10 and 105_000 * round(share * 10_000) // 10_000 <= 5_000
    assert _reserve_share(1, 100_000, asks(100_000)) == 0.0  # nothing is left over the floors
    assert _reserve_share(1, 50_000, asks(100_000)) == 0.0  # not even the floors fit: no reserve
    assert _reserve_share(1, 0, asks(100_000)) == 0.10  # nothing to clear: the share is moot
    assert _reserve_share(1, 500_000, {}) == 0.10  # no children, no floors
