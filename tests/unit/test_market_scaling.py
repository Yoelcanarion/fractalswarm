"""Autoscale sizing (spec §7.3): pure functions, with hysteresis."""

from hypothesis import given
from hypothesis import strategies as st

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

counts = st.integers(min_value=0, max_value=50)
money = st.one_of(st.none(), st.integers(min_value=-10, max_value=5_000_000))


# -- orchestrators per group ----------------------------------------------------------


@given(counts, st.integers(min_value=1, max_value=12), st.one_of(st.none(), counts))
def test_orchestrators_are_min_of_subgoals_cap_and_what_is_affordable(
    subgoals, cap, can_pay
) -> None:
    n = orchestrators_for(subgoals, cap, can_pay)
    assert n <= min(subgoals, cap) and (n == 0) == (subgoals == 0)
    if subgoals and can_pay is not None:
        assert n == max(1, min(subgoals, cap, can_pay))  # always at least one: work needs an owner


def test_orchestrators_examples() -> None:
    assert orchestrators_for(3, 6, None) == 3  # the T2 tracks
    assert orchestrators_for(9, 6, None) == 6  # capped
    assert orchestrators_for(9, 6, 2) == 2  # only two are affordable
    assert orchestrators_for(4, 6, 0) == 1  # but a goal with work always gets one
    assert orchestrators_for(0, 6, 5) == 0


def test_affordable_counts_whole_pieces_of_work() -> None:
    assert affordable(1_000_000, 210_000) == 4
    assert affordable(0, 210_000) == 0 and affordable(-5, 210_000) == 0
    assert affordable(None, 210_000) is None and affordable(1_000, 0) is None


# -- agents per squad ----------------------------------------------------------


@given(
    counts,
    money,
    st.integers(min_value=1, max_value=200_000),
    money,
    st.integers(1, 60),
    st.integers(1, 8),
)
def test_a_squad_has_between_one_and_cap_agents_and_no_more_than_it_has_work_for(
    ready, usd, est, rpm, per_agent, cap
) -> None:
    n = desired_agents(ready, usd, est, rpm, per_agent, cap)
    assert 1 <= n <= cap
    assert n <= max(ready, 1)  # never more agents than ready contracts (one when idle)
    if usd is not None and usd >= 0:
        assert n <= max(usd // est, 1)
    if rpm is not None and rpm >= 0:
        assert n <= max(rpm // per_agent, 1)


@given(
    counts,
    st.integers(0, 4_000_000),
    st.integers(1, 200_000),
    st.integers(0, 4_000),
    st.integers(1, 60),
)
def test_more_money_or_rate_or_work_never_shrinks_a_squad(ready, usd, est, rpm, per_agent) -> None:
    base = desired_agents(ready, usd, est, rpm, per_agent, 8)
    assert desired_agents(ready + 1, usd, est, rpm, per_agent, 8) >= base
    assert desired_agents(ready, usd + est, est, rpm, per_agent, 8) >= base
    assert desired_agents(ready, usd, est, rpm + per_agent, per_agent, 8) >= base


def test_squad_size_examples() -> None:
    assert desired_agents(1, 500_000, 30_000, 900, 30, 4) == 1  # a chain: one ready contract
    assert desired_agents(9, 500_000, 30_000, 900, 30, 4) == 4  # capped at 4 agents
    assert desired_agents(9, 70_000, 30_000, 900, 30, 4) == 2  # money for two contracts
    assert desired_agents(9, 500_000, 30_000, 65, 30, 4) == 2  # rate limit for two agents
    assert desired_agents(9, None, 30_000, None, 30, 4) == 4  # nothing bounds it
    assert desired_agents(0, 0, 30_000, 0, 30, 4) == 1  # idle, broke: still one agent


# -- recursion ----------------------------------------------------------


def test_recursion_continues_while_complex_and_below_the_depth_cap() -> None:
    caps = Caps()
    assert (caps.max_orchestrators_per_group, caps.max_agents_per_orchestrator) == (6, 4)
    assert caps.max_depth == 2
    assert should_recurse(complexity=3, threshold=1, level=0, max_depth=2)
    assert should_recurse(complexity=2, threshold=1, level=1, max_depth=2)
    assert not should_recurse(complexity=1, threshold=1, level=1, max_depth=2)  # simple enough
    assert not should_recurse(complexity=9, threshold=1, level=2, max_depth=2)  # depth cap


# -- hysteresis ----------------------------------------------------------


def test_scale_up_is_immediate() -> None:
    scale, delta = step(SquadScale(), live=1, target=4, epoch=0)
    assert delta == 3 and scale == SquadScale()


def test_scale_down_waits_for_two_consecutive_epochs_above_target() -> None:
    scale = SquadScale()
    scale, delta = step(scale, live=4, target=2, epoch=7)
    assert delta == 0 and scale.below == 1
    scale, delta = step(scale, live=4, target=2, epoch=7)  # the same epoch does not count twice
    assert delta == 0 and scale.below == 1
    scale, delta = step(scale, live=4, target=2, epoch=8)
    assert delta == -2 and scale == SquadScale()


def test_a_squad_that_needs_its_agents_again_starts_counting_afresh() -> None:
    scale, _ = step(SquadScale(), live=3, target=1, epoch=0)
    scale, delta = step(scale, live=3, target=3, epoch=1)  # busy again
    assert delta == 0 and scale == SquadScale()
    scale, delta = step(scale, live=3, target=1, epoch=2)
    assert delta == 0 and scale.below == 1  # one epoch below, not two


@given(st.lists(st.tuples(st.integers(1, 6), st.integers(1, 6)), min_size=1, max_size=30))
def test_a_squad_converges_on_its_target_and_never_drops_early(history) -> None:
    scale, live, epoch = SquadScale(), 3, 0
    run_above = 0  # epochs in a row with more agents than the target
    last = None
    for want, advance in history:
        epoch += advance % 2  # sometimes the epoch has not changed
        above = live > want
        if above and epoch != last:
            run_above += 1
        elif not above:
            run_above = 0
        last = epoch if above else None
        before = live
        scale, delta = step(scale, live, want, epoch)
        live += delta
        assert live >= 1
        if delta > 0:
            assert before < want and live == want
        if delta < 0:
            assert run_above >= DOWN_EPOCHS and live == want
