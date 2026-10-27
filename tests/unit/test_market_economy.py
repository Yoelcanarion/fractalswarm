"""Economy MVI: proportional allocation, the model ladder, the global spend breaker."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.allocation import (
    CHILD_RESERVE_SHARE,
    ROOT_RESERVE_SHARE,
    allocate_proportional,
    reserve_share,
    to_micros,
)
from fractalswarm.market.ladder import (
    LEVELS,
    Thresholds,
    degrade,
    ladder_level,
    ladder_state,
    run_ladder,
)
from fractalswarm.market.ledger import Ledger
from fractalswarm.market.spend_breaker import (
    WINDOW_MS,
    SpendBreaker,
    SpendBreakerConfig,
    record_spend,
)

usd = st.floats(min_value=0, max_value=50, allow_nan=False, allow_infinity=False)
asks = st.dictionaries(st.text("abcdef", min_size=1, max_size=3), usd, max_size=8)

# -- proportional allocation -----------------------------------------------------------------


@given(usd, asks, st.sampled_from([0.0, CHILD_RESERVE_SHARE, ROOT_RESERVE_SHARE]))
def test_allocation_conserves_the_envelope(envelope, children, share) -> None:
    allocation = allocate_proportional(envelope, children, share=share)
    assert allocation.conserved
    assert allocation.pool_micros >= 0
    assert set(allocation.grants_micros) == set(children)
    for child, ask in children.items():
        assert 0 <= allocation.grants_micros[child] <= to_micros(ask)


@given(usd, asks)
def test_allocation_is_deterministic_and_order_free(envelope, children) -> None:
    reversed_children = dict(reversed(list(children.items())))
    assert allocate_proportional(envelope, children) == allocate_proportional(
        envelope, reversed_children
    )


@given(usd, asks)
def test_scarce_budget_is_split_in_proportion(envelope, children) -> None:
    allocation = allocate_proportional(envelope, children)
    available = allocation.envelope_micros - allocation.reserve_micros
    total = sum(to_micros(ask) for ask in children.values())
    if total > available:
        assert allocation.pool_micros == 0
        for child, ask in children.items():
            exact = available * to_micros(ask) / total
            assert abs(allocation.grants_micros[child] - exact) < 1


def test_allocation_examples() -> None:
    plenty = allocate_proportional(1.0, {"a": 0.2, "b": 0.3})
    assert plenty.grants_usd == {"a": 0.2, "b": 0.3}
    assert plenty.reserve_micros == 100_000 and plenty.pool_micros == 400_000
    scarce = allocate_proportional(1.0, {"a": 3.0, "b": 1.0}, share=0.0)
    assert scarce.grants_usd == {"a": 0.75, "b": 0.25}
    assert reserve_share(0) == 0.15 and reserve_share(2) == 0.10
    with pytest.raises(ValueError):
        allocate_proportional(1.0, {"a": -1.0})


# -- the model ladder ---------------------------------------------------------------------------


def test_thresholds_come_from_the_config() -> None:
    assert Thresholds.load() == Thresholds(L1=0.80, L2=0.90, stop=0.95)
    with pytest.raises(ValueError):
        Thresholds(L1=0.9, L2=0.8)


@pytest.mark.parametrize(
    ("spent", "level"),
    [
        (0.0, "L0"),
        (0.79, "L0"),
        (0.80, "L1"),
        (0.899, "L1"),
        (0.90, "L2"),
        (0.95, "stop"),
        (1.2, "stop"),
    ],
)
def test_ladder_levels(spent: float, level: str) -> None:
    assert ladder_level(spent, 1.0, Thresholds()) == level


@given(usd, usd, st.floats(min_value=0.01, max_value=100))
def test_ladder_is_monotonic_in_spend(a, b, cap) -> None:
    low, high = sorted((a, b))
    t = Thresholds()
    assert LEVELS.index(ladder_level(low, cap, t)) <= LEVELS.index(ladder_level(high, cap, t))


def test_ladder_flags_and_role_degradation() -> None:
    state = ladder_state(0.92, 1.0, Thresholds())
    assert state.level == "L2" and state.critical_only and state.scale_down
    assert not state.speculative and not state.stop
    roles = RoleTable.load()
    assert degrade(roles, "root_planner", "L0").model == "muse-wonder-1.0"
    assert degrade(roles, "root_planner", "L1").model == "muse-spark-1.3"
    assert degrade(roles, "agent", "L1").effort == "minimal"
    assert degrade(roles, "agent", "stop") is None
    # Safety roles are never degraded.
    for role in ("safety_classifier", "alignment_check"):
        assert degrade(roles, role, "L0") == degrade(roles, role, "L2")


def test_budget_shock_moves_the_run_up_the_ladder() -> None:
    ledger = Ledger()
    ledger.set_cap("run", "r", 1.0)
    ledger.reserve("e1", {"run": "r"}, 0.5)
    assert run_ladder(ledger, "r", Thresholds()).level == "L0"
    ledger.set_cap("run", "r", 0.55)  # what a budget.shock does to the in-run book
    assert run_ladder(ledger, "r", Thresholds()).level == "L2"
    ledger.set_cap("run", "r", 0.5)
    assert run_ladder(ledger, "r", Thresholds()).stop


# -- the global spend breaker ----------------------------------------------------------------------

CONFIG = SpendBreakerConfig()


def test_breaker_config_comes_from_defaults() -> None:
    assert SpendBreakerConfig.load() == SpendBreakerConfig(
        max_burn_share_per_min=0.2, pause_ms=30_000
    )


def test_breaker_trips_pauses_and_recovers() -> None:
    breaker = SpendBreaker()
    breaker, tripped = record_spend(breaker, 0, 1.0, remaining_usd=20.0, config=CONFIG)
    assert not tripped and breaker.allows_new_contracts(0)  # 1.0 <= 0.2 * 20
    breaker, tripped = record_spend(breaker, 10_000, 3.5, remaining_usd=16.5, config=CONFIG)
    assert tripped and breaker.trips == 1  # 4.5 > 3.3
    assert not breaker.allows_new_contracts(39_999)
    assert breaker.allows_new_contracts(40_000)
    # Once the burst leaves the one-minute window, small spend does not trip it again.
    breaker, tripped = record_spend(breaker, 10_000 + WINDOW_MS, 0.1, 16.4, CONFIG)
    assert not tripped and breaker.burn(10_000 + WINDOW_MS) == pytest.approx(0.1)


spends = st.lists(
    st.tuples(st.integers(min_value=0, max_value=20_000), st.floats(0, 5, allow_nan=False)),
    max_size=30,
)


@given(spends, st.floats(min_value=1, max_value=200))
def test_breaker_is_open_only_after_a_burst_and_never_longer_than_the_pause(steps, budget) -> None:
    breaker, now, remaining = SpendBreaker(), 0, budget
    for gap, cost in steps:
        now += gap
        remaining = max(remaining - cost, 0.0)
        before = breaker
        breaker, tripped = record_spend(breaker, now, cost, remaining, CONFIG)
        if tripped:
            assert breaker.burn(now) > CONFIG.max_burn_share_per_min * remaining
            assert not before.is_open(now)
        if breaker.is_open(now):
            assert breaker.open_until is not None
            assert breaker.open_until - now <= CONFIG.pause_ms
    replayed = SpendBreaker()
    now, remaining = 0, budget
    for gap, cost in steps:
        now += gap
        remaining = max(remaining - cost, 0.0)
        replayed, _ = record_spend(replayed, now, cost, remaining, CONFIG)
    assert replayed == breaker  # pure: the same inputs give the same state
