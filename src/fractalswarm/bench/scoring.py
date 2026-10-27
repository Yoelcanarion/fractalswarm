"""Benchmark metrics, computed only from a recorded event log (spec §15.7).

Every number here is a pure function of the log, so anyone can recompute it from a run
bundle. The definitions:

- **LLM call interval.** An ``effect.started`` of kind ``llm`` opens an interval at its
  ``ts_virtual``; the matching ``effect.completed`` or ``effect.cancelled`` closes it. An
  interval never closed is still in flight at the end of the run, so it closes at the run's
  end. Calls refused by the budget never start and have no interval.
- **Work.** A call counts as agent work when ``is_work(request)`` holds. By default that
  is the ``agent`` role: planning, judging and supervisor calls are not agent work, so a
  supervisor that re-plans through the LLM after a crash is still stalled.
- **Stall time.** Inside the work window, from the first work call's start to the last work
  call's end, the total virtual time during which no work call is in flight anywhere. Time
  before the first and after the last work call (root planning, final integration) is
  outside the window: every workflow pays it at C0 too, and it is not what a crash costs.
- **Makespan.** ``run.completed.ts_virtual - run.started.ts_virtual`` (the last event if
  the run never completed).
- **Cost.** The sum of ``result.cost_usd`` over completed LLM calls, plus an estimate for
  calls that were cancelled or still in flight at the run end: the provider has billed the
  input in full and the output produced so far. Input tokens come from a completed call
  with the identical request in the same run, else from the body size (4 chars/token).
  Output tokens are ``elapsed × the run's observed output rate`` for that role (output
  tokens over latency of its completed calls, base latency included, so the estimate errs
  low), capped at the identical call's output or the role's ``max_output_tokens``. Prices
  and roles come from the snapshot in ``run.started``; a log without one bills $0. A crash
  that cancels in-flight work and then redoes it therefore pays for it twice.
- **Coordination tokens.** Input plus output tokens of LLM calls whose role is a
  coordination role (``COORDINATION_ROLES``) or whose effect tag starts with ``coord:``.
  These are calls spent deciding who does what or rebuilding coordination state (supervisor
  routing, re-planning after a crash, elections). Takeover in the swarm never calls the LLM,
  so it spends none; baselines tag their routing calls so they are counted.
- **Messages.** ``msg.sent`` events. **Breaker trips:** ``breaker.tripped`` events (0 when
  the log has none). **Chaos events:** every ``chaos.*`` event.
- **Completion and validity** come from a pluggable ``Checker`` that sees the whole log
  (each task supplies its own; the default only checks that the run completed).
- **Extra cost vs C0** = ``(cost(Ck) - cost(C0)) / cost(C0)`` in percent, and **time lost
  vs C0** = ``makespan(Ck) - makespan(C0)``, both for the same workflow, task and seed.
"""

from collections.abc import Callable, Iterable, Sequence
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from fractalswarm.kernel.events import Event
from fractalswarm.kernel.ids import canonical_json
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.client import LLMClient, LLMRequest
from fractalswarm.market.prices import Usage

COORDINATION_ROLES = frozenset({"coordinator", "supervisor", "router", "recovery"})
COORDINATION_TAG_PREFIX = "coord:"
BREAKER_TRIPPED = "breaker.tripped"

Interval = tuple[int, int]
WorkPredicate = Callable[[dict[str, Any]], bool]


class Outcome(BaseModel):
    """What a task's checker says about a run."""

    completed: bool
    valid: bool | None = None  # None: the task has no validity check
    score: float | None = None  # task-specific quality (soft score, F1, ...)
    detail: str = ""


Checker = Callable[[Sequence[Event]], Outcome]


class LLMCall(BaseModel):
    effect_id: str
    actor: str
    role: str
    tag: str | None
    start: int
    end: int | None = None  # None: never closed in the log
    status: str = "inflight"  # ok | error | refused | incomplete | cancelled | inflight
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    estimated: bool = False  # cost and tokens estimated (cancelled or never closed)


class RunMetrics(BaseModel):
    run_id: str
    events: int
    completed: bool
    valid: bool | None
    score: float | None
    detail: str = ""
    makespan_s: float
    stall_s: float
    work_window_s: float
    work_busy_s: float
    cost_usd: float
    input_tokens: int
    output_tokens: int
    total_tokens: int
    coordination_tokens: int
    llm_calls: int
    llm_errors: int
    cancelled_llm_calls: int
    work_calls: int
    messages: int
    breaker_trips: int
    chaos_events: int


def default_checker(events: Sequence[Event]) -> Outcome:
    completed = any(event.type == "run.completed" for event in events)
    return Outcome(completed=completed)


def is_agent_work(request: dict[str, Any]) -> bool:
    return request.get("role") == "agent"


def is_coordination(call: LLMCall) -> bool:
    tag = call.tag or ""
    return call.role in COORDINATION_ROLES or tag.startswith(COORDINATION_TAG_PREFIX)


# -- loading ---------------------------------------------------------------------------------


def load_events(source: Path | str | EventStore | Iterable[Event]) -> list[Event]:
    """Events in seq order from a store, a run directory, an events.jsonl/.sqlite file or a list."""
    if isinstance(source, EventStore):
        return list(source.read())
    if isinstance(source, str | Path):
        path = Path(source)
        if path.is_dir():
            sqlite, jsonl = path / "events.sqlite", path / "events.jsonl"
            path = sqlite if sqlite.exists() else jsonl
        if path.suffix == ".jsonl":
            with EventStore.import_jsonl(path) as store:
                return list(store.read())
        with EventStore(path) as store:
            return list(store.read())
    return sorted(source, key=lambda event: event.seq)


# -- intervals -------------------------------------------------------------------------------


def union_length(intervals: Iterable[Interval]) -> int:
    """Total length covered by the union of half-open intervals ``[start, end)``."""
    total, cur_start, cur_end = 0, None, None
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if cur_end is None or start > cur_end:
            if cur_end is not None:
                total += cur_end - cur_start  # type: ignore[operator]
            cur_start, cur_end = start, end
        else:
            cur_end = max(cur_end, end)
    if cur_end is not None:
        total += cur_end - cur_start  # type: ignore[operator]
    return total


def stall_ms(intervals: Sequence[Interval]) -> tuple[int, int, int]:
    """(stall, window, busy) in ms over the window spanned by the intervals."""
    if not intervals:
        return 0, 0, 0
    window = max(end for _, end in intervals) - min(start for start, _ in intervals)
    busy = union_length(intervals)
    return window - busy, window, busy


def run_span(events: Sequence[Event]) -> tuple[int, int]:
    start = next((e.ts_virtual for e in events if e.type == "run.started"), None)
    end = next((e.ts_virtual for e in events if e.type == "run.completed"), None)
    first = events[0].ts_virtual if events else 0
    last = max((e.ts_virtual for e in events), default=0)
    return (first if start is None else start), (last if end is None else end)


def llm_calls(events: Sequence[Event]) -> list[LLMCall]:
    """Every LLM call that started, closed by its completion or cancellation if logged."""
    _, run_end = run_span(events)
    calls: dict[str, LLMCall] = {}
    for event in events:
        payload = event.payload
        if payload.get("kind") != "llm":
            continue
        effect_id = payload.get("effect_id")
        if event.type == "effect.started":
            request = payload.get("request") or {}
            calls[effect_id] = LLMCall(
                effect_id=effect_id,
                actor=event.actor,
                role=str(request.get("role", "")),
                tag=payload.get("tag"),
                start=event.ts_virtual,
            )
        elif event.type in ("effect.completed", "effect.cancelled") and effect_id in calls:
            call = calls[effect_id]
            if call.end is not None:
                continue
            call.end = event.ts_virtual
            if event.type == "effect.cancelled":
                call.status = "cancelled"
                continue
            result = payload.get("result") or {}
            usage = result.get("usage") or {}
            call.status = payload.get("status", "ok")
            call.cost_usd = float(result.get("cost_usd") or 0.0)
            call.input_tokens = int(usage.get("input_tokens") or 0)
            call.output_tokens = int(usage.get("output_tokens") or 0)
    ordered = list(calls.values())
    for call in ordered:
        if call.end is None:
            call.end = max(run_end, call.start)
    _bill_unfinished(events, ordered)
    return ordered


CHARS_PER_TOKEN = 4


def _bill_unfinished(events: Sequence[Event], calls: list[LLMCall]) -> None:
    """Estimate what the provider billed for calls cut off before they completed."""
    started = next((e for e in events if e.type == "run.started"), None)
    snapshot = ((started.payload.get("config") or {}) if started else {}).get("llm")
    unfinished = [c for c in calls if c.status in ("cancelled", "inflight")]
    if not snapshot or not unfinished:
        return
    roles, prices = LLMClient.config_from_snapshot(snapshot)
    client = LLMClient(None, roles=roles, prices=prices, mode="live")  # type: ignore[arg-type]
    requests = _requests(events)
    done = [c for c in calls if c.status in ("ok", "incomplete")]
    twins = {canonical_json(requests[c.effect_id]): c for c in done}

    def rate(sample: Iterable[LLMCall]) -> float:
        sample = list(sample)
        busy = sum((c.end or c.start) - c.start for c in sample)
        return sum(c.output_tokens for c in sample) / busy if busy > 0 else 0.0

    overall = rate(done)
    for call in unfinished:
        request = requests[call.effect_id]
        model, body, max_output = client.build(LLMRequest.model_validate(request))
        twin = twins.get(canonical_json(request))
        if twin is not None:
            input_tokens, cap = twin.input_tokens, twin.output_tokens
        else:
            input_tokens, cap = len(canonical_json(body)) // CHARS_PER_TOKEN + 1, max_output
        role_rate = rate(c for c in done if c.role == call.role) or overall
        elapsed = (call.end or call.start) - call.start
        output_tokens = min(int(elapsed * role_rate), cap)
        usage = Usage(input_tokens=input_tokens, output_tokens=output_tokens)
        call.cost_usd = prices.cost(model, usage)
        call.input_tokens, call.output_tokens = input_tokens, output_tokens
        call.estimated = True


def _requests(events: Sequence[Event]) -> dict[str, dict[str, Any]]:
    return {
        e.payload["effect_id"]: e.payload.get("request") or {}
        for e in events
        if e.type == "effect.started" and e.payload.get("kind") == "llm"
    }


# -- the metrics -----------------------------------------------------------------------------


def score_run(
    source: Path | str | EventStore | Iterable[Event],
    checker: Checker = default_checker,
    is_work: WorkPredicate = is_agent_work,
) -> RunMetrics:
    events = load_events(source)
    calls = llm_calls(events)
    requests = _requests(events)
    work = [c for c in calls if is_work(requests.get(c.effect_id, {}))]
    stall, window, busy = stall_ms([(c.start, c.end or c.start) for c in work])
    start, end = run_span(events)
    outcome = checker(events)
    input_tokens = sum(c.input_tokens for c in calls)
    output_tokens = sum(c.output_tokens for c in calls)
    return RunMetrics(
        run_id=events[0].run_id if events else "",
        events=len(events),
        completed=outcome.completed,
        valid=outcome.valid,
        score=outcome.score,
        detail=outcome.detail,
        makespan_s=(end - start) / 1000,
        stall_s=stall / 1000,
        work_window_s=window / 1000,
        work_busy_s=busy / 1000,
        cost_usd=sum(c.cost_usd for c in calls),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        coordination_tokens=sum(
            c.input_tokens + c.output_tokens for c in calls if is_coordination(c)
        ),
        llm_calls=len(calls),
        llm_errors=sum(1 for c in calls if c.status == "error"),
        cancelled_llm_calls=sum(1 for c in calls if c.status == "cancelled"),
        work_calls=len(work),
        messages=sum(1 for e in events if e.type == "msg.sent"),
        breaker_trips=sum(1 for e in events if e.type == BREAKER_TRIPPED),
        chaos_events=sum(1 for e in events if e.type.startswith("chaos.")),
    )


def extra_cost_pct(cost_usd: float, c0_cost_usd: float) -> float | None:
    """``(cost(Ck) - cost(C0)) / cost(C0)`` in percent; None when C0 cost nothing."""
    if c0_cost_usd <= 0:
        return None
    return (cost_usd - c0_cost_usd) / c0_cost_usd * 100


def time_lost_s(makespan_s: float, c0_makespan_s: float) -> float:
    return makespan_s - c0_makespan_s
