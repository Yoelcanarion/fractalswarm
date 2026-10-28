"""The best-case supervisor's pure state machine (spec §15.2)."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.baselines.supervisor import (
    RESTART_TAG,
    crash,
    crash_due,
    crash_plan,
    crash_target,
    dispatch,
    restart,
    settle,
    supervised,
    track,
)
from fractalswarm.bench.profiles import PROFILES, RESTART_DELAY_MS, profile
from fractalswarm.kernel.scheduler import Cancel, Emit, SetTimer


def test_crash_plan_uses_the_shared_points() -> None:
    assert crash_plan(20, profile("C0")) == ()
    assert crash_plan(20, profile("C1")) == (4,)
    assert crash_plan(20, profile("C2")) == (4, 7, 10)
    assert crash_plan(20, profile("C3")) == (4, 7, 10, 13, 16)
    assert crash_plan(3, profile("C3")) == (1, 2, 2, 2, 3)
    assert crash_plan(0, profile("C3")) == ()


@given(st.integers(min_value=1, max_value=500), st.sampled_from(sorted(PROFILES)))
def test_crash_plan_is_ordered_and_reachable(total: int, name: str) -> None:
    plan = crash_plan(total, profile(name))
    assert len(plan) == profile(name).coordinator_crashes
    assert list(plan) == sorted(plan)
    assert all(1 <= point <= total for point in plan)


def test_crash_cancels_in_flight_work_and_restart_returns_only_the_lost_work() -> None:
    state = supervised("boss", 5, profile("C1"))  # crash after the 1st dispatch
    state = dispatch(state, "c1", "work:c1")
    assert crash_due(state)
    state = track(state, "plan", "plan-call")

    state, commands = crash(state)
    assert not state.up and state.crashes == 1 and state.inflight == {}
    emit, *cancels, timer = commands
    assert isinstance(emit, Emit) and emit.type == "baseline.crashed"
    assert emit.payload["lost"] == ["c1", "plan"]
    assert cancels == [Cancel(tag="work:c1"), Cancel(tag="plan-call")]
    assert timer == SetTimer(delay_ms=RESTART_DELAY_MS, tag=RESTART_TAG)
    assert not crash_due(state)
    with pytest.raises(RuntimeError):
        dispatch(state, "c2", "work:c2")

    state, commands, redo = restart(state)
    assert state.up and redo == ["c1", "plan"]
    assert commands[0].type == "baseline.restarted"  # type: ignore[attr-defined]

    # Re-dispatching lost work does not move the crash points; only new contracts do.
    state = dispatch(state, "c1", "work:c1#2")
    assert state.dispatched == ("c1",)
    state = settle(state, "work:c1#2")
    assert state.inflight == {}
    assert not crash_due(state)  # the plan has one crash and it happened


def test_completed_work_is_not_lost() -> None:
    state = supervised("boss", 20, profile("C1"))  # crash at the 4th dispatch
    state = dispatch(state, "c1", "work:c1")
    state = settle(state, "work:c1")
    for n in range(2, 4):
        state = dispatch(state, f"c{n}", f"work:c{n}")
    state = settle(state, "work:c2")
    assert not crash_due(state)
    state = dispatch(state, "c4", "work:c4")
    assert crash_due(state)
    state, _ = crash(state)
    _, _, redo = restart(state)
    assert redo == ["c3", "c4"]


def test_double_tracking_and_restarting_an_up_coordinator_are_errors() -> None:
    state = dispatch(supervised("boss", 4, profile("C0")), "c1", "t")
    with pytest.raises(ValueError):
        track(state, "c2", "t")
    with pytest.raises(RuntimeError):
        restart(state)
    assert settle(state, "unknown") == state


def test_crash_target_prefers_most_remaining_then_smallest_id() -> None:
    assert crash_target({"b": 3, "a": 3, "c": 1}) == "a"
    assert crash_target({"b": 4, "a": 3}) == "b"
    with pytest.raises(ValueError):
        crash_target({})
