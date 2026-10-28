"""The log and effect driver of the framework baselines (baselines/framework_runtime.py)."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from fractalswarm.baselines.framework_runtime import (
    Deadlock,
    EffectKilled,
    FrameworkRuntime,
    replay_framework,
)
from fractalswarm.kernel.clock import ManualClock
from fractalswarm.kernel.effects import EffectContext, EffectRunner
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import EventStore

Program = Callable[[FrameworkRuntime], Awaitable[Any]]


def sim_runtime(store: EventStore | None = None) -> FrameworkRuntime:
    clock = ManualClock("sim")
    return FrameworkRuntime(
        store or EventStore(),
        run_id="r",
        seed="0",
        scenario="test",
        params={},
        mode="sim",
        clock=clock,
        runner=EffectRunner({}, EffectContext("r", clock)),
    )


def of(store: EventStore, event_type: str) -> list[Event]:
    return [e for e in store.read() if e.type == event_type]


async def test_completions_arrive_in_virtual_time_order_one_at_a_time() -> None:
    order: list[tuple[str, int]] = []

    async def program(rt: FrameworkRuntime) -> None:
        async def wait(delay: int, name: str) -> None:
            await rt.timer(delay, name, "a")
            order.append((name, rt.vtime))

        await asyncio.gather(wait(300, "slow"), wait(100, "fast"), wait(100, "tie"))

    rt = sim_runtime()
    completed = await rt.drive(program)
    assert order == [("fast", 100), ("tie", 100), ("slow", 300)]
    assert completed.type == "run.completed" and completed.ts_virtual == 300
    assert rt.store.verify_chain().ok


async def test_a_kill_cancels_the_effect_in_start_order_and_raises_in_its_program() -> None:
    caught: list[str] = []

    async def program(rt: FrameworkRuntime) -> None:
        async def victim(name: str) -> None:
            try:
                await rt.effect("timer", {"delay_ms": 1000}, actor="a", tag=name, agent="w1")
            except EffectKilled as exc:
                caught.append(f"{name}:{exc}")

        tasks = [asyncio.ensure_future(victim(name)) for name in ("first", "second")]
        await rt.timer(100, "wait", "a")
        cancelled = rt.cancel(lambda w: w.agent == "w1", EffectKilled("w1"))
        assert [w.event.payload["tag"] for w in cancelled] == ["first", "second"]
        await asyncio.gather(*tasks)

    rt = sim_runtime()
    await rt.drive(program)
    assert caught == ["first:w1", "second:w1"]
    cancelled = of(rt.store, "effect.cancelled")
    assert [e.payload["tag"] for e in cancelled] == ["first", "second"]
    assert {e.ts_virtual for e in cancelled} == {100}
    # a cancelled effect never completes, however long it would have taken
    assert [e.payload["tag"] for e in of(rt.store, "effect.completed")] == ["wait"]


async def test_an_effect_whose_awaiting_task_is_cancelled_is_logged_as_cancelled() -> None:
    async def program(rt: FrameworkRuntime) -> None:
        task = asyncio.ensure_future(
            rt.effect("timer", {"delay_ms": 1000}, actor="a", tag="abandoned")
        )
        await rt.timer(100, "wait", "a")
        task.cancel()
        await asyncio.wait({task})
        assert task.cancelled()

    rt = sim_runtime()
    await rt.drive(program)
    assert [e.payload["tag"] for e in of(rt.store, "effect.cancelled")] == ["abandoned"]
    assert [e.payload["tag"] for e in of(rt.store, "effect.completed")] == ["wait"]


async def test_a_program_waiting_on_something_that_is_not_an_effect_is_a_deadlock() -> None:
    async def program(rt: FrameworkRuntime) -> None:
        await asyncio.get_running_loop().create_future()

    with pytest.raises(Deadlock):
        await sim_runtime().drive(program)


async def test_the_program_must_not_wake_from_a_thread_in_sim_mode() -> None:
    """LangGraph runs a sync function through the executor; sim mode runs it inline, in order."""

    async def program(rt: FrameworkRuntime) -> None:
        value = await asyncio.get_running_loop().run_in_executor(None, lambda: 41 + 1)
        await rt.timer(10 * value, "after", "a")

    rt = sim_runtime()
    completed = await rt.drive(program)
    assert rt.executor_calls == 1 and completed.ts_virtual == 420


async def test_a_run_replays_and_a_different_program_does_not() -> None:
    async def program(rt: FrameworkRuntime) -> None:
        async def wait(delay: int, name: str) -> None:
            await rt.timer(delay, name, "a")
            rt.emit("note", {"after": name}, "a")

        await asyncio.gather(wait(300, "slow"), wait(100, "fast"))

    from fractalswarm.kernel.events import Payload, register

    @register("note")
    class Note(Payload):
        after: str

    recorded = EventStore()
    await sim_runtime(recorded).drive(program)

    def build_with(replayed_program: Program):
        def build(first: Event, store: EventStore):
            clock = ManualClock("replay")
            rt = FrameworkRuntime(
                store,
                run_id=first.run_id,
                seed=first.payload["seed"],
                scenario=first.payload["scenario"],
                params=first.payload["params"],
                mode="replay",
                clock=clock,
            )
            return rt, replayed_program

        return build

    report = await replay_framework(recorded, build_with(program))
    assert report.ok and report.replayed_events == recorded.last_seq

    async def other(rt: FrameworkRuntime) -> None:
        await rt.timer(100, "fast", "a")
        rt.emit("note", {"after": "something else"}, "a")

    report = await replay_framework(recorded, build_with(other))
    assert not report.ok and report.first_divergence is not None
