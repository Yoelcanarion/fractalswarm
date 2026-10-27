"""Bench metrics computed from event logs (spec §15.7)."""

from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.bench.scoring import (
    Outcome,
    extra_cost_pct,
    llm_calls,
    load_events,
    score_run,
    stall_ms,
    time_lost_s,
    union_length,
)
from fractalswarm.kernel.events import Event, EventDraft
from fractalswarm.kernel.store import EventStore

GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "toy"


# -- the golden toy log ----------------------------------------------------------------------


def test_golden_toy_metrics() -> None:
    metrics = score_run(GOLDEN)
    assert metrics.run_id == "golden-toy"
    assert metrics.events == 56
    assert metrics.completed is True
    assert metrics.makespan_s == pytest.approx(1.692)
    # Four agent calls: [0, 577], [0, 620], [620, 1130], [620, 1113]; round 2 starts the
    # moment round 1 ends, so no agent-free gap inside the window.
    assert metrics.work_calls == 4
    assert metrics.work_window_s == pytest.approx(1.130)
    assert metrics.stall_s == 0
    assert metrics.llm_calls == 5  # plus the judge's merge
    assert metrics.cost_usd == pytest.approx(4 * 0.000191 + 0.00024975)
    assert metrics.input_tokens == 4 * 10 + 57
    assert metrics.output_tokens == 5 * 42
    assert metrics.coordination_tokens == 0
    assert metrics.messages == 12  # 4 tasks, 4 results, 4 progress pings
    assert metrics.breaker_trips == 0
    assert metrics.cancelled_llm_calls == 0


def test_golden_toy_cost_matches_the_kernel_ledger() -> None:
    events = load_events(GOLDEN / "events.jsonl")
    completed = next(e for e in events if e.type == "run.completed")
    assert score_run(events).cost_usd == pytest.approx(completed.payload["spent_usd"])


def test_every_source_form_gives_the_same_metrics(tmp_path: Path) -> None:
    with EventStore.import_jsonl(GOLDEN / "events.jsonl", tmp_path / "events.sqlite") as store:
        from_store = score_run(store)
    assert score_run(tmp_path / "events.sqlite") == from_store
    assert score_run(GOLDEN / "events.jsonl") == from_store
    assert score_run(load_events(GOLDEN)) == from_store


def test_a_pluggable_checker_decides_completion_and_validity() -> None:
    def checker(events) -> Outcome:
        done = any(e.type == "toy.done" for e in events)
        return Outcome(completed=done, valid=False, score=0.5, detail="strict")

    metrics = score_run(GOLDEN, checker)
    assert (metrics.completed, metrics.valid, metrics.score, metrics.detail) == (
        True,
        False,
        0.5,
        "strict",
    )


def test_work_predicate_can_count_every_role() -> None:
    metrics = score_run(GOLDEN, is_work=lambda request: True)
    assert metrics.work_calls == 5
    # The merge call runs from 1130 to 1692: the window grows, still no gap.
    assert metrics.work_window_s == pytest.approx(1.692)
    assert metrics.stall_s == 0


# -- synthetic logs --------------------------------------------------------------------------


class LogBuilder:
    def __init__(self) -> None:
        self.store = EventStore()
        self.n = 0

    def add(self, ts: int, type_: str, actor: str, payload: dict[str, Any]) -> None:
        self.n += 1
        self.store.append(
            EventDraft(
                run_id="synthetic",
                ts_virtual=ts,
                lamport=self.n,
                type=type_,
                actor=actor,
                idem_key=f"k{self.n}",
                payload=payload,
            )
        )

    def start_llm(self, ts: int, eid: str, role: str, actor: str = "a", tag: str | None = None):
        request = {"role": role, "input": "x"}
        payload = {"effect_id": eid, "kind": "llm", "request": request, "tag": tag}
        self.add(ts, "effect.started", actor, payload)

    def done_llm(self, ts: int, eid: str, cost: float = 0.01, tokens: tuple[int, int] = (10, 20)):
        result = {
            "cost_usd": cost,
            "usage": {"input_tokens": tokens[0], "output_tokens": tokens[1]},
        }
        payload = {"effect_id": eid, "kind": "llm", "status": "ok", "result": result}
        self.add(ts, "effect.completed", "@env", payload)

    def cancel_llm(self, ts: int, eid: str, actor: str = "a") -> None:
        self.add(ts, "effect.cancelled", actor, {"effect_id": eid, "kind": "llm"})


def synthetic() -> LogBuilder:
    log = LogBuilder()
    log.add(0, "run.started", "@kernel", {"seed": "1", "scenario": "s", "clock": "sim"})
    log.start_llm(0, "plan", "root_planner", actor="O0")
    log.done_llm(500, "plan", cost=0.10, tokens=(100, 200))
    log.start_llm(1_000, "w1", "agent")
    log.start_llm(1_000, "w2", "agent")
    log.done_llm(3_000, "w1")
    log.add(3_000, "msg.sent", "a", {"to": "O0", "topic": "result"})
    log.cancel_llm(4_000, "w2")  # a coordinator crash cancels it: [1000, 4000]
    # 5 s restart: nothing in flight from 4000 to 9000.
    log.start_llm(9_000, "route", "supervisor", actor="O0")
    log.done_llm(9_500, "route", cost=0.02, tokens=(30, 5))
    log.start_llm(9_500, "w2b", "agent", tag="coord:redo")
    log.done_llm(12_000, "w2b", tokens=(7, 3))
    log.start_llm(13_000, "w3", "agent")  # never closed: in flight until the run ends
    log.add(15_000, "msg.sent", "O0", {"to": "a", "topic": "task"})
    log.add(16_000, "run.completed", "@kernel", {"events": 0, "alive": [], "spent_usd": 0})
    return log


def test_synthetic_stall_cost_and_coordination() -> None:
    log = synthetic()
    metrics = score_run(log.store)
    # Agent intervals: [1000,3000], [1000,4000], [9500,12000], [13000,16000].
    # Window 1000..16000 = 15 s; busy 3 + 2.5 + 3 = 8.5 s; stall 6.5 s.
    assert metrics.work_window_s == pytest.approx(15.0)
    assert metrics.work_busy_s == pytest.approx(8.5)
    assert metrics.stall_s == pytest.approx(6.5)
    assert metrics.makespan_s == pytest.approx(16.0)
    assert metrics.cost_usd == pytest.approx(0.10 + 0.01 + 0.02 + 0.01)
    assert metrics.cancelled_llm_calls == 1
    assert metrics.llm_calls == 6
    # The supervisor's routing call and the coord:-tagged redo.
    assert metrics.coordination_tokens == 35 + 10
    assert metrics.messages == 2
    assert metrics.breaker_trips == 0


def test_unclosed_calls_close_at_the_run_end() -> None:
    calls = {c.effect_id: c for c in llm_calls(list(synthetic().store.read()))}
    assert calls["w3"].end == 16_000 and calls["w3"].status == "inflight"
    assert calls["w2"].status == "cancelled" and calls["w2"].cost_usd == 0


def test_breaker_trips_and_chaos_events_are_counted_when_present() -> None:
    events = list(synthetic().store.read())
    extra = []
    for n, type_ in enumerate(("breaker.tripped", "breaker.tripped", "chaos.injected")):
        extra.append(
            Event(
                seq=len(events) + n + 1,
                run_id="synthetic",
                ts_virtual=16_000,
                lamport=99 + n,
                type=type_,
                actor="@env",
                idem_key=f"x{n}",
                payload={},
                prev_hash="",
                hash="",
            )
        )
    metrics = score_run(events + extra)
    assert metrics.breaker_trips == 2
    assert metrics.chaos_events == 1


def test_a_log_without_agent_work_has_no_stall() -> None:
    log = LogBuilder()
    log.add(0, "run.started", "@kernel", {"seed": "1", "scenario": "s", "clock": "sim"})
    metrics = score_run(log.store)
    assert (metrics.stall_s, metrics.work_window_s, metrics.completed) == (0, 0, False)


def test_extra_cost_and_time_lost() -> None:
    assert extra_cost_pct(1.5, 1.0) == pytest.approx(50.0)
    assert extra_cost_pct(0.9, 1.0) == pytest.approx(-10.0)
    assert extra_cost_pct(1.0, 0.0) is None
    assert time_lost_s(12.5, 10.0) == pytest.approx(2.5)


# -- interval properties ---------------------------------------------------------------------

intervals = st.lists(
    st.tuples(st.integers(0, 200), st.integers(0, 60)).map(lambda t: (t[0], t[0] + t[1])),
    max_size=12,
)


@given(intervals)
def test_union_length_matches_brute_force(spans: list[tuple[int, int]]) -> None:
    covered = {t for start, end in spans for t in range(start, end)}
    assert union_length(spans) == len(covered)


@given(intervals)
def test_stall_plus_busy_is_the_window(spans: list[tuple[int, int]]) -> None:
    stall, window, busy = stall_ms(spans)
    assert stall >= 0 and busy >= 0
    assert stall + busy == window
    if spans:
        assert window == max(e for _, e in spans) - min(s for s, _ in spans)


@given(intervals, st.data())
def test_more_work_inside_the_window_never_adds_stall(spans, data) -> None:
    if not spans:
        return
    low, high = min(s for s, _ in spans), max(e for _, e in spans)
    start = data.draw(st.integers(low, high))
    end = data.draw(st.integers(start, high))
    assert stall_ms([*spans, (start, end)])[0] <= stall_ms(spans)[0]


@given(intervals)
def test_order_of_intervals_does_not_matter(spans: list[tuple[int, int]]) -> None:
    assert stall_ms(spans) == stall_ms(list(reversed(spans)))
