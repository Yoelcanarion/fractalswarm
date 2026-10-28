"""A log and an effect driver for a baseline that is a framework program, not a set of actors.

The kernel (``kernel/scheduler.py``) runs actors whose handlers are pure. A baseline built on
an outside framework (LangGraph, spec §15.1) is an ordinary asyncio program instead, so this
module gives it what the kernel gives an actor, in the same format:

- the same hash-chained event log (``events.sqlite``), so ``bench/scoring.py`` reads it;
- ``effect()``: an LLM call or a timer is ``effect.started`` ... ``effect.completed`` (or
  ``effect.cancelled``), with the two-phase budget reservation of ``market/ledger.py``;
- a driver with the kernel's turn-taking rule: an effect completion is appended only when the
  program is quiet (every task of it waits on an effect), one completion at a time. Time is
  virtual: in ``sim`` mode it jumps to the next completion, in ``live`` mode it follows the
  wall clock. All nondeterminism therefore enters through completions, as in the kernel.

**Replay.** The program is deterministic given its completions, so ``replay_framework`` runs it
again with the recorded completions (in the recorded order and at the recorded times; each LLM
result is re-read from the cassette) and compares every regenerated event with the recorded
one. What it proves is what ``kernel/replay.py`` proves: that this code regenerates the
recorded run from the recorded model outputs.

The program must not depend on threads: LangGraph runs a synchronous node or edge function
through ``run_in_executor``, so every function handed to it is ``async``. As a guard the executor
is replaced by an inline call in ``sim`` and replay modes (``executor_calls`` counts its uses);
in ``live`` mode (real sockets need it) the driver instead waits for the jobs in flight, so a
program that is only waiting for a thread is not taken for a quiet one.
"""

import asyncio
import heapq
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from fractalswarm.kernel.clock import Clock, LiveClock, ManualClock
from fractalswarm.kernel.effects import EffectOutcome, EffectRunner
from fractalswarm.kernel.events import ENV, KERNEL, Event, EventDraft
from fractalswarm.kernel.replay import Divergence, ReplayReport
from fractalswarm.kernel.store import EventStore
from fractalswarm.market.ledger import Ledger

QUIESCE_LIMIT = 100_000  # event loop turns the program may take after one completion

Replayer = Callable[[Event, Event], Awaitable[tuple[str, dict[str, Any]]]]


class EffectKilled(Exception):
    """Raised in the program that awaits an effect that chaos killed (an agent kill)."""


class Deadlock(RuntimeError):
    """The program waits on something that is not an effect: nothing can ever wake it."""


@dataclass
class Waiting:
    event: Event  # the effect.started
    future: asyncio.Future[EffectOutcome]
    agent: str | None = None  # who is running it, for agent kills


@dataclass
class FrameworkRuntime:
    store: EventStore
    run_id: str
    seed: str
    scenario: str
    params: dict[str, Any]
    mode: str  # sim | live | replay
    clock: Clock
    clock_mode: str = "sim"  # what run.started records: sim | live (a replay copies the recorded)
    config: dict[str, Any] = field(default_factory=dict)
    run_cap_usd: float | None = None
    project_remaining_usd: float | None = None
    estimators: Mapping[str, Callable[[dict[str, Any]], float]] = field(default_factory=dict)
    runner: EffectRunner | None = None  # sim and live: how an effect runs
    replayers: Mapping[str, Replayer] = field(default_factory=dict)  # replay
    recorded: EventStore | None = None  # replay: the log to regenerate
    reducers: list[Any] = field(default_factory=list)  # objects with apply(event)

    def __post_init__(self) -> None:
        self.ledger = Ledger()
        self.vtime = 0
        self.lamport = 0
        self.inflight: dict[str, Event] = {}
        self.waiting: dict[str, Waiting] = {}
        self.executor_calls = 0
        self._executor_jobs = 0
        self._effects = 0
        self._outbox: list[Event] = []
        self._heap: list[tuple[int, int, str, EffectOutcome]] = []
        self._arrived: asyncio.Queue[tuple[Event, EffectOutcome]] = asyncio.Queue()
        self._tasks: dict[str, asyncio.Task[EffectOutcome]] = {}
        self._checked = 0
        self._closed = False
        self.started_event: Event | None = None

    # -- the log ---------------------------------------------------------------------------

    def emit(
        self,
        event_type: str,
        payload: dict[str, Any],
        actor: str,
        *,
        idem_key: str | None = None,
        correlation_id: str | None = None,
        causation_id: int | None = None,
    ) -> Event:
        """Append an event at the current virtual time. ``actor`` is who produced it."""
        self.lamport += 1
        draft = EventDraft(
            run_id=self.run_id,
            ts_virtual=self.vtime,
            lamport=self.lamport,
            type=event_type,
            actor=actor,
            causation_id=causation_id,
            correlation_id=correlation_id,
            idem_key=idem_key or f"fw.{self.store.next_seq}",
            payload=payload,
        )
        event = self.store.append(draft)
        for reducer in self.reducers:
            reducer.apply(event)
        return event

    def start(self) -> Event:
        payload = {
            "seed": self.seed,
            "scenario": self.scenario,
            "params": self.params,
            "clock": self.clock_mode,
            "config": self.config,
            "run_cap_usd": self.run_cap_usd,
            "project_remaining_usd": self.project_remaining_usd,
        }
        self.started_event = self.emit("run.started", payload, KERNEL, idem_key="run.started")
        if self.run_cap_usd is not None:
            self.ledger.set_cap("run", self.run_id, self.run_cap_usd)
        if self.project_remaining_usd is not None:
            self.ledger.set_cap("project", "project", self.project_remaining_usd)
        return self.started_event

    def finish(self) -> Event:
        payload = {
            "events": self.store.last_seq + 1,
            "alive": [],
            "spent_usd": self.ledger.spent[("run", self.run_id)],
        }
        return self.emit("run.completed", payload, KERNEL, idem_key="run.completed")

    # -- effects ---------------------------------------------------------------------------

    async def effect(
        self,
        kind: str,
        request: dict[str, Any],
        *,
        actor: str,
        tag: str | None = None,
        scopes: Mapping[str, str] | None = None,
        agent: str | None = None,
    ) -> EffectOutcome:
        """Start an effect and wait for its completion (or for its cancellation, which raises)."""
        self._effects += 1
        effect_id = f"eff-{self._effects}"
        estimator = self.estimators.get(kind)
        usd = estimator(request) if estimator else 0.0
        if usd > 0:
            booked = {"run": self.run_id, **(scopes or {})}
            if self.project_remaining_usd is not None:
                booked["project"] = "project"
            refusal = self.ledger.reserve(effect_id, booked, usd)
            if refusal is not None:
                refused = {"effect_id": effect_id, "usd": usd, "level": refusal.level}
                self.emit("budget.refused", refused | {"key": refusal.key}, actor)
                reason = {"reason": f"budget cap: {refusal.level} {refusal.key}"}
                done = {"effect_id": effect_id, "kind": kind, "status": "refused", "tag": tag}
                self.emit("effect.completed", done | {"result": reason}, actor)
                return EffectOutcome(status="refused", result=reason)
            reserved = {"effect_id": effect_id, "usd": usd, "scopes": booked}
            self.emit("budget.reserved", reserved, actor, correlation_id=effect_id)
        payload = {"effect_id": effect_id, "kind": kind, "request": request, "tag": tag}
        started = self.emit("effect.started", payload, actor, correlation_id=effect_id)
        self.inflight[effect_id] = started
        future: asyncio.Future[EffectOutcome] = asyncio.get_running_loop().create_future()
        future.add_done_callback(lambda done: done.cancelled() or done.exception())
        self.waiting[effect_id] = Waiting(started, future, agent)
        self._outbox.append(started)
        try:
            return await future
        except asyncio.CancelledError:
            # The task that awaited it was cancelled (a framework unwinding a failed step):
            # the effect is abandoned, which the log says as for any other cancellation.
            if effect_id in self.waiting and not self._closed:
                self._cancel_one(self.waiting[effect_id])
            raise

    def complete(self, effect_id: str, status: str, result: dict[str, Any], ts: int) -> None:
        """Append an effect's completion as it arrived, and wake the program that awaits it."""
        started = self.inflight.pop(effect_id, None)
        if started is None:
            return
        self.vtime = max(self.vtime, ts)
        payload = {
            "effect_id": effect_id,
            "kind": started.payload["kind"],
            "status": status,
            "result": result,
            "tag": started.payload["tag"],
        }
        event = self.emit(
            "effect.completed",
            payload,
            ENV,
            causation_id=started.seq,
            correlation_id=effect_id,
            idem_key=f"done:{effect_id}",
        )
        if effect_id in self.ledger.open:
            actual = float(result.get("cost_usd") or 0.0)
            reservation = self.ledger.settle(effect_id, actual)
            settled = {"effect_id": effect_id, "reserved_usd": reservation.usd}
            self.emit(
                "budget.settled",
                settled | {"actual_usd": actual},
                KERNEL,
                causation_id=event.seq,
                correlation_id=effect_id,
                idem_key=f"settle:{effect_id}",
            )
        waiting = self.waiting.pop(effect_id)
        if not waiting.future.done():
            waiting.future.set_result(EffectOutcome(status=status, result=result))

    def cancel(
        self, select: Callable[[Waiting], bool], error: BaseException | None = None
    ) -> list[Waiting]:
        """Cancel the in-flight effects ``select`` picks, in start order (as the kernel does):
        ``effect.cancelled``, and the reservation released. The program that awaits one gets
        ``error``, or a cancellation."""
        chosen = sorted((w for w in self.waiting.values() if select(w)), key=lambda w: w.event.seq)
        for waiting in chosen:
            self._cancel_one(waiting)
            if error is None:
                waiting.future.cancel()
            else:
                waiting.future.set_exception(error)
        return chosen

    def _cancel_one(self, waiting: Waiting) -> None:
        started = waiting.event
        effect_id = started.payload["effect_id"]
        del self.inflight[effect_id], self.waiting[effect_id]
        task = self._tasks.pop(effect_id, None)
        if task is not None:
            task.cancel()
        payload = {"effect_id": effect_id, "kind": started.payload["kind"]}
        payload["tag"] = started.payload["tag"]
        self.emit("effect.cancelled", payload, started.actor, correlation_id=effect_id)
        if effect_id in self.ledger.open:
            reservation = self.ledger.release(effect_id)
            settled = {"effect_id": effect_id, "reserved_usd": reservation.usd}
            self.emit(
                "budget.settled",
                settled | {"actual_usd": 0.0},
                KERNEL,
                correlation_id=effect_id,
                idem_key=f"settle:{effect_id}",
            )

    async def timer(self, delay_ms: int, tag: str, actor: str) -> None:
        await self.effect("timer", {"delay_ms": delay_ms}, actor=actor, tag=tag)

    # -- the driver --------------------------------------------------------------------------

    async def drive(self, program: Callable[["FrameworkRuntime"], Awaitable[Any]]) -> Event:
        """Run the program to its end; return ``run.completed``."""
        loop = asyncio.get_running_loop()
        before = asyncio.all_tasks()
        loop.run_in_executor = self._executor_guard(loop)  # type: ignore[method-assign]
        self.start()
        task = asyncio.ensure_future(program(self))
        try:
            while True:
                await self._quiesce()
                self._compare()
                if task.done():
                    break
                await self._deliver()
            task.result()
            completed = self.finish()
            self._compare()
            return completed
        finally:
            # Whatever the program left running (a failed cell, a replay that diverged) must
            # not outlive the run: the bench goes on to the next cell on the same loop.
            self._closed = True
            for running in self._tasks.values():
                running.cancel()
            leftovers = asyncio.all_tasks() - before - {asyncio.current_task()}
            for leftover in leftovers:
                leftover.cancel()
            await asyncio.gather(*leftovers, return_exceptions=True)
            del loop.run_in_executor

    def _executor_guard(self, loop: asyncio.AbstractEventLoop):
        real = loop.run_in_executor

        def inline(executor: Any, func: Callable[..., Any], *args: Any):
            self.executor_calls += 1
            future = loop.create_future()
            try:
                future.set_result(func(*args))
            except Exception as exc:
                future.set_exception(exc)
            return future

        def tracked(executor: Any, func: Callable[..., Any], *args: Any):
            self.executor_calls += 1
            self._executor_jobs += 1
            future = real(executor, func, *args)

            def done(_: Any) -> None:
                self._executor_jobs -= 1

            future.add_done_callback(done)
            return future

        return tracked if self.mode == "live" else inline

    async def _quiesce(self) -> None:
        """Let the program run until every task of it waits on an effect: nothing is ready."""
        loop = asyncio.get_running_loop()
        for _ in range(QUIESCE_LIMIT):
            await asyncio.sleep(0.001 if self._executor_jobs else 0)
            if not loop._ready and not self._executor_jobs:  # type: ignore[attr-defined]
                return
        raise RuntimeError("the program does not settle after a completion")

    async def _deliver(self) -> None:
        if self.mode == "sim":
            await self._deliver_sim()
        elif self.mode == "live":
            await self._deliver_live()
        else:
            await self._deliver_replay()

    async def _deliver_sim(self) -> None:
        """The kernel's sim rule: run what started, then complete the earliest due effect."""
        assert self.runner is not None
        started, self._outbox = self._outbox, []
        for event in started:
            if event.payload["effect_id"] not in self.inflight:
                continue
            outcome = await self.runner.execute(event)
            due = event.ts_virtual + outcome.latency_ms
            heapq.heappush(self._heap, (due, event.seq, event.payload["effect_id"], outcome))
        while self._heap and self._heap[0][2] not in self.inflight:
            heapq.heappop(self._heap)
        if not self._heap:
            raise Deadlock(f"nothing is in flight; waiting: {sorted(self.waiting)}")
        due, _, effect_id, outcome = heapq.heappop(self._heap)
        assert isinstance(self.clock, ManualClock)
        self.clock.advance_to(due)
        self.complete(effect_id, outcome.status, outcome.result, self.clock.now())

    async def _deliver_live(self) -> None:
        assert self.runner is not None
        started, self._outbox = self._outbox, []
        for event in started:
            effect_id = event.payload["effect_id"]
            if effect_id not in self.inflight:
                continue
            task = asyncio.ensure_future(self.runner.execute(event))
            self._tasks[effect_id] = task

            def done(task: asyncio.Task[EffectOutcome], event: Event = event) -> None:
                self._tasks.pop(event.payload["effect_id"], None)
                if not task.cancelled():
                    self._arrived.put_nowait((event, task.result()))

            task.add_done_callback(done)
        if not self.inflight and self._arrived.empty():
            raise Deadlock(f"nothing is in flight; waiting: {sorted(self.waiting)}")
        event, outcome = await self._arrived.get()
        assert isinstance(self.clock, LiveClock)
        effect_id = event.payload["effect_id"]
        self.complete(effect_id, outcome.status, outcome.result, self.clock.now())

    async def _deliver_replay(self) -> None:
        """Feed the next recorded completion, at its recorded time, with its re-read result."""
        assert self.recorded is not None
        self._outbox.clear()
        seq = self.store.last_seq + 1
        recorded = next(
            (
                event
                for event in self.recorded.read(seq)
                if event.actor == ENV and event.type == "effect.completed"
            ),
            None,
        )
        if recorded is None:
            raise Divergence(seq, "the recorded log ends but the replay has work in flight")
        effect_id = recorded.payload["effect_id"]
        started = self.inflight.get(effect_id)
        if started is None:
            raise Divergence(recorded.seq, f"completion of {effect_id}, which never started")
        replayer = self.replayers.get(started.payload["kind"])
        if replayer is None:
            status, result = recorded.payload["status"], recorded.payload["result"]
        else:
            status, result = await replayer(started, recorded)
        self.complete(effect_id, status, result, recorded.ts_virtual)

    def _compare(self) -> None:
        if self.recorded is None:
            return
        for event in self.store.read(self._checked + 1):
            original = self.recorded.get(event.seq)
            if original is None:
                raise Divergence(event.seq, f"replay produced an extra {event.type}")
            if original.hash != event.hash:
                a, b = original.row(), event.row()
                fields = [name for name in a if a[name] != b[name]] or ["an earlier event"]
                detail = f"{original.type} differs in {', '.join(fields)}"
                for name in fields[:3]:
                    if name in a:
                        detail += f"\n  recorded {name}: {str(a[name])[:300]}"
                        detail += f"\n  replayed {name}: {str(b[name])[:300]}"
                raise Divergence(event.seq, detail)
            self._checked = event.seq


async def replay_framework(
    recorded: EventStore,
    build: Callable[[Event, EventStore], tuple[FrameworkRuntime, Callable[..., Awaitable[Any]]]],
) -> ReplayReport:
    """Regenerate a recorded run and compare every event. ``build`` makes the runtime (in
    replay mode, over a fresh store) and the program from the recorded ``run.started``."""
    chain = recorded.verify_chain()
    replayed = EventStore()
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
    runtime, program = build(first, replayed)
    runtime.recorded = recorded
    try:
        await runtime.drive(program)
        if replayed.last_seq != recorded.last_seq:
            raise Divergence(replayed.next_seq, "the replay ended before the recorded log")
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
