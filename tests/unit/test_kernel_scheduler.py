"""The scheduler: delivery order, Lamport clocks, stops, budget refusals and cancellation."""

from dataclasses import dataclass, field
from typing import Any

import pytest

from fractalswarm.kernel.clock import ManualClock, lamport_receive, lamport_tick
from fractalswarm.kernel.effects import EffectContext, EffectOutcome, EffectRunner, drive
from fractalswarm.kernel.events import KERNEL, Event
from fractalswarm.kernel.scheduler import (
    ActorKind,
    Cancel,
    Command,
    Runtime,
    Send,
    SetTimer,
    Spawn,
    StartEffect,
    Stop,
    View,
    register_scenario,
)
from fractalswarm.kernel.store import EventStore


@dataclass
class Script:
    """A scenario whose handlers follow a table: (actor, topic or tag) -> commands."""

    reactions: dict[tuple[str, str], list[Command]]
    boot_commands: list[Command]
    seen: list[tuple[str, str, int]] = field(default_factory=list)

    @property
    def kinds(self) -> dict[str, ActorKind]:
        return {"scripted": ActorKind(lambda actor_id, args: actor_id, self.handle)}

    def boot(self, params: dict[str, Any]) -> list[Command]:
        return self.boot_commands

    def handle(self, state: str, event: Event, view: View):
        if event.type == "msg.sent":
            key = event.payload["topic"]
        elif event.type == "effect.completed":
            key = event.payload["tag"] or ""
        else:
            key = event.type
        self.seen.append((state, key, view.lamport))
        return state, list(self.reactions.get((state, key), []))


def runtime_for(script: Script, name: str, **kwargs) -> Runtime:
    register_scenario(name, script)
    return Runtime(EventStore(), run_id="r", seed="s", scenario=name, **kwargs)


def drain(runtime: Runtime) -> None:
    runtime.start()
    while runtime.step():
        pass


def test_lamport_helpers() -> None:
    assert lamport_tick(3) == 4
    assert lamport_receive(3, 7) == 8
    assert lamport_receive(9, 2) == 10


def test_messages_are_delivered_in_order_and_lamport_grows() -> None:
    script = Script(
        reactions={
            ("a", "actor.spawned"): [
                Send(to="b", topic="one"),
                Send(to="b", topic="two"),
                Send(to="c", topic="three"),
            ],
            ("b", "one"): [Send(to="c", topic="from-b")],
        },
        boot_commands=[
            Spawn(actor_id="b", kind="scripted"),
            Spawn(actor_id="c", kind="scripted"),
            Spawn(actor_id="a", kind="scripted"),
        ],
    )
    runtime = runtime_for(script, "test:order")
    drain(runtime)
    keys = [(actor, key) for actor, key, _ in script.seen]
    assert keys == [
        ("b", "actor.spawned"),
        ("c", "actor.spawned"),
        ("a", "actor.spawned"),
        ("b", "one"),
        ("b", "two"),
        ("c", "three"),
        ("c", "from-b"),
    ]
    events = list(runtime.store.read())
    for event in events:
        if event.causation_id is not None:
            cause = runtime.store.get(event.causation_id)
            assert cause is not None
            if event.actor != KERNEL:
                assert event.lamport > cause.lamport
    lamports_of_c = [lamport for actor, _, lamport in script.seen if actor == "c"]
    assert lamports_of_c == sorted(lamports_of_c)


async def test_completions_arrive_in_virtual_time_order() -> None:
    script = Script(
        reactions={
            ("a", "actor.spawned"): [
                SetTimer(delay_ms=300, tag="late"),
                SetTimer(delay_ms=100, tag="early"),
                SetTimer(delay_ms=100, tag="early-2"),
            ],
        },
        boot_commands=[Spawn(actor_id="a", kind="scripted")],
    )
    runtime = runtime_for(script, "test:vtime")
    completed = await drive(runtime, EffectRunner({}, EffectContext("r", ManualClock())))
    assert [key for _, key, _ in script.seen][1:] == ["early", "early-2", "late"]
    stamps = [e.ts_virtual for e in runtime.store.read() if e.type == "effect.completed"]
    assert stamps == [100, 100, 300]
    assert completed.ts_virtual == 300


def test_deliveries_to_a_stopped_actor_are_dropped() -> None:
    script = Script(
        reactions={
            ("a", "actor.spawned"): [Stop(actor_id="b"), Send(to="b", topic="late")],
        },
        boot_commands=[
            Spawn(actor_id="a", kind="scripted"),
            Spawn(actor_id="b", kind="scripted"),
        ],
    )
    runtime = runtime_for(script, "test:stop")
    drain(runtime)
    assert ("b", "late") not in [(actor, key) for actor, key, _ in script.seen]
    assert "b" not in runtime.actors


def test_spawning_an_existing_actor_fails() -> None:
    script = Script(
        reactions={},
        boot_commands=[Spawn(actor_id="a", kind="scripted"), Spawn(actor_id="a", kind="scripted")],
    )
    with pytest.raises(ValueError, match="already exists"):
        runtime_for(script, "test:dup").start()


def test_over_budget_effect_is_refused_deterministically() -> None:
    script = Script(
        reactions={
            ("a", "actor.spawned"): [
                StartEffect(kind="llm", request={"usd": 0.6}, tag="first"),
                StartEffect(kind="llm", request={"usd": 0.6}, tag="second"),
            ],
        },
        boot_commands=[Spawn(actor_id="a", kind="scripted")],
    )
    runtime = runtime_for(
        script, "test:budget", run_cap_usd=1.0, estimators={"llm": lambda r: r["usd"]}
    )
    drain(runtime)
    types = [event.type for event in runtime.store.read()]
    assert types.count("budget.reserved") == 1
    assert types.count("budget.refused") == 1
    assert ("a", "second") in [(actor, key) for actor, key, _ in script.seen]
    assert list(runtime.inflight) == ["eff-2.0"]


async def test_cancelled_timer_never_fires_and_releases_budget() -> None:
    script = Script(
        reactions={
            ("a", "actor.spawned"): [
                SetTimer(delay_ms=50_000, tag="slow"),
                StartEffect(kind="llm", request={"usd": 0.5}, tag="slow"),
                SetTimer(delay_ms=10, tag="fast"),
            ],
            ("a", "fast"): [Cancel(tag="slow")],
        },
        boot_commands=[Spawn(actor_id="a", kind="scripted")],
    )
    runtime = runtime_for(
        script, "test:cancel", run_cap_usd=1.0, estimators={"llm": lambda r: r["usd"]}
    )

    async def llm(started: Event, ctx: EffectContext) -> EffectOutcome:
        return EffectOutcome(status="ok", result={"cost_usd": 0.1}, latency_ms=60_000)

    runner = EffectRunner({"llm": llm}, EffectContext("r", ManualClock()))
    completed = await drive(runtime, runner)
    keys = [key for _, key, _ in script.seen]
    assert "slow" not in keys
    assert completed.ts_virtual == 10
    assert runtime.ledger.reserved[("run", "r")] == 0
    assert completed.payload["spent_usd"] == 0
