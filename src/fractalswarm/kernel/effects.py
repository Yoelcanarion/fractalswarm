"""The effect runner and the live and sim drivers.

Effects (LLM calls, tools, timers) run as asyncio tasks outside the deterministic core. Each
one turns an ``effect.started`` event into an ``EffectOutcome``; the driver appends it as an
``effect.completed`` event:

- ``live``: in arrival order, stamped with the live clock, each once the queue is empty;
- ``sim``: in order of virtual completion time (start + latency, ties by start seq), after
  every running effect has reported, so the order never depends on the event loop.

Either way, all nondeterminism enters the log through these completions.
"""

import asyncio
import heapq
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from fractalswarm.kernel.clock import Clock, LiveClock, ManualClock
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Runtime


class EffectOutcome(BaseModel):
    status: str  # ok | error | incomplete
    result: dict[str, Any] = {}
    latency_ms: int = 0


@dataclass(frozen=True)
class EffectContext:
    run_id: str
    clock: Clock

    async def sleep(self, virtual_ms: int) -> None:
        """Wait virtual time: really in live mode, not at all in sim mode."""
        if isinstance(self.clock, LiveClock) and virtual_ms > 0:
            await asyncio.sleep(self.clock.wall_seconds(virtual_ms))


EffectFn = Callable[[Event, EffectContext], Awaitable[EffectOutcome]]


async def timer_effect(started: Event, ctx: EffectContext) -> EffectOutcome:
    delay = int(started.payload["request"]["delay_ms"])
    await ctx.sleep(delay)
    return EffectOutcome(status="ok", latency_ms=delay)


class EffectRunner:
    def __init__(self, handlers: Mapping[str, EffectFn], ctx: EffectContext) -> None:
        self.handlers = {"timer": timer_effect, **handlers}
        self.ctx = ctx

    async def execute(self, started: Event) -> EffectOutcome:
        kind = started.payload["kind"]
        handler = self.handlers.get(kind)
        if handler is None:
            return EffectOutcome(status="error", result={"error": f"no effect handler: {kind}"})
        try:
            return await handler(started, self.ctx)
        except Exception as exc:  # an effect failure is data for the actor, not a crash
            return EffectOutcome(status="error", result={"error": f"{type(exc).__name__}: {exc}"})


async def drive(runtime: Runtime, runner: EffectRunner) -> Event:
    """Run until no delivery is queued and no effect is in flight; return run.completed."""
    clock = runner.ctx.clock
    if runtime.started_event is None:
        runtime.start()
    if isinstance(clock, ManualClock):
        await _drive_sim(runtime, runner, clock)
    else:
        await _drive_live(runtime, runner, clock)
    return runtime.finish()


async def _drive_sim(runtime: Runtime, runner: EffectRunner, clock: ManualClock) -> None:
    pending: list[tuple[int, int, str, EffectOutcome]] = []
    while True:
        while runtime.step():
            pass
        started, runtime.outbox = runtime.outbox, []
        runtime.cancelled.clear()  # cancelled effects are skipped when they come due
        outcomes = await asyncio.gather(*(runner.execute(event) for event in started))
        for event, outcome in zip(started, outcomes, strict=True):
            due = event.ts_virtual + outcome.latency_ms
            heapq.heappush(pending, (due, event.seq, event.payload["effect_id"], outcome))
        while pending and pending[0][2] not in runtime.inflight:
            heapq.heappop(pending)
        if not pending:
            return
        due, _, effect_id, outcome = heapq.heappop(pending)
        clock.advance_to(due)
        runtime.complete(effect_id, outcome.status, outcome.result, clock.now())


async def _drive_live(runtime: Runtime, runner: EffectRunner, clock: Clock) -> None:
    arrived: asyncio.Queue[tuple[Event, EffectOutcome]] = asyncio.Queue()
    tasks: dict[str, asyncio.Task[EffectOutcome]] = {}

    def launch() -> None:
        for effect_id in runtime.cancelled:
            task = tasks.pop(effect_id, None)
            if task is not None:
                task.cancel()
        runtime.cancelled.clear()
        started, runtime.outbox = runtime.outbox, []
        for event in started:
            effect_id = event.payload["effect_id"]
            task = asyncio.create_task(runner.execute(event))
            tasks[effect_id] = task

            def done(task: asyncio.Task[EffectOutcome], event: Event = event) -> None:
                tasks.pop(event.payload["effect_id"], None)
                if not task.cancelled():
                    arrived.put_nowait((event, task.result()))

            task.add_done_callback(done)

    def complete(event: Event, outcome: EffectOutcome) -> None:
        effect_id = event.payload["effect_id"]
        runtime.complete(effect_id, outcome.status, outcome.result, clock.now())

    # A completion is appended only when the delivery queue is empty, one at a time, as in
    # sim mode: a delivery that appends nothing still moves its actor's Lamport clock, and
    # replay can only place such deliveries by draining the queue before each completion.
    launch()
    while True:
        if runtime.step():
            launch()
            await asyncio.sleep(0)
            continue
        if not arrived.empty():
            complete(*arrived.get_nowait())
        elif not runtime.inflight:
            return
        else:
            complete(*await arrived.get())
        launch()
