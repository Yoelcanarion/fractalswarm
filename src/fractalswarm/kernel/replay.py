"""Verifiable replay (spec §3): rebuild a run from its recorded completions and compare hashes.

The recorded log decides only *where* each outside-world event lands and its timestamp.
Everything else is recomputed: the actors run again from ``run.started``, and each effect
completion comes from its replayer (an LLM call is re-parsed from the cassette, which must
hold the exact request the replayed actor makes). Every regenerated event must hash like the
recorded one; the report names the first event that does not.
"""

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from fractalswarm.kernel.events import ENV, Event
from fractalswarm.kernel.scheduler import Runtime
from fractalswarm.kernel.store import EventStore

# (started event, recorded completion) -> (status, result)
Replayer = Callable[[Event, Event], Awaitable[tuple[str, dict[str, Any]]]]


@dataclass
class ReplaySetup:
    """What a replay needs that depends on the recorded run.started (built by the caller)."""

    estimators: dict[str, Callable[[dict[str, Any]], float]] = field(default_factory=dict)
    replayers: dict[str, Replayer] = field(default_factory=dict)


class ReplayReport(BaseModel):
    ok: bool
    chain_ok: bool
    recorded_events: int
    replayed_events: int
    recorded_head: str
    replayed_head: str
    first_divergence: int | None = None
    detail: str = ""


class Divergence(Exception):
    def __init__(self, seq: int, detail: str) -> None:
        super().__init__(f"seq {seq}: {detail}")
        self.seq = seq
        self.detail = detail


async def replay(
    recorded: EventStore,
    setup: Callable[[Event], ReplaySetup],
    store: EventStore | None = None,
) -> ReplayReport:
    chain = recorded.verify_chain()
    replayed = store or EventStore()
    report = ReplayReport(
        ok=False,
        chain_ok=chain.ok,
        recorded_events=recorded.last_seq,
        replayed_events=0,
        recorded_head=recorded.head_hash,
        replayed_head="",
    )
    if not chain.ok:
        report.first_divergence = chain.first_bad_seq
        report.detail = f"the recorded log is corrupt: {chain.reason}"
        return report

    first = recorded.get(1)
    if first is None or first.type != "run.started":
        report.detail = "the recorded log does not start with run.started"
        return report
    started = first.payload
    tools = setup(first)
    runtime = Runtime(
        replayed,
        run_id=first.run_id,
        seed=started["seed"],
        scenario=started["scenario"],
        params=started["params"],
        clock=started["clock"],
        config=started["config"],
        run_cap_usd=started["run_cap_usd"],
        project_remaining_usd=started["project_remaining_usd"],
        estimators=tools.estimators,
    )
    checked = 0
    try:
        runtime.start()
        checked = _compare(recorded, replayed, checked)
        while replayed.last_seq < recorded.last_seq:
            await _advance(runtime, recorded.get(replayed.next_seq), tools.replayers)
            runtime.outbox.clear()
            runtime.cancelled.clear()
            checked = _compare(recorded, replayed, checked)
        if not runtime.idle:
            raise Divergence(replayed.next_seq, "the recorded log ends but the replay has work")
    except Divergence as exc:
        report.first_divergence = exc.seq
        report.detail = exc.detail
    except Exception as exc:  # a replayer refusing (cassette mismatch) is a divergence too
        report.first_divergence = replayed.next_seq
        report.detail = f"{type(exc).__name__}: {exc}"

    report.replayed_events = replayed.last_seq
    report.replayed_head = replayed.head_hash
    report.ok = report.first_divergence is None and replayed.head_hash == recorded.head_hash
    return report


async def _advance(runtime: Runtime, recorded: Event | None, replayers: Mapping[str, Replayer]):
    assert recorded is not None
    if recorded.actor == ENV and recorded.type == "effect.completed":
        # Completions enter only once the queue is empty, so deliver what is still queued:
        # those deliveries appended nothing, but they move their actors' Lamport clocks.
        while runtime.step():
            pass
        effect_id = recorded.payload["effect_id"]
        started = runtime.inflight.get(effect_id)
        if started is None:
            raise Divergence(recorded.seq, f"completion of {effect_id}, which never started")
        replayer = replayers.get(started.payload["kind"])
        if replayer is None:
            status, result = recorded.payload["status"], recorded.payload["result"]
        else:
            status, result = await replayer(started, recorded)
        runtime.complete(effect_id, status, result, recorded.ts_virtual)
    elif recorded.actor == ENV:
        raise Divergence(recorded.seq, f"unsupported outside event {recorded.type}")
    elif runtime.step():
        pass
    elif recorded.type == "run.completed" and runtime.idle:
        runtime.finish()
    else:
        raise Divergence(recorded.seq, f"replay stalled; the log expects {recorded.type}")


def _compare(recorded: EventStore, replayed: EventStore, checked: int) -> int:
    for event in replayed.read(checked + 1):
        original = recorded.get(event.seq)
        if original is None:
            raise Divergence(event.seq, f"replay produced an extra {event.type}")
        if original.hash != event.hash:
            raise Divergence(event.seq, _diff(original, event))
        checked = event.seq
    return checked


def _diff(original: Event, replayed: Event) -> str:
    a, b = original.row(), replayed.row()
    fields = [name for name in a if a[name] != b[name]]
    if not fields:
        return "same row, different chain (an earlier event differs)"
    lines = [f"{original.type} differs in {', '.join(fields)}"]
    for name in fields[:3]:
        lines.append(f"  recorded {name}: {str(a[name])[:300]}")
        lines.append(f"  replayed {name}: {str(b[name])[:300]}")
    return "\n".join(lines)
