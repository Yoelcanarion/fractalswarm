"""A delivery that appends nothing still moves its actor's Lamport clock, so replay must place it.

``b`` receives a ping that it ignores, and a timer completion at the same virtual time with a
lower Lamport stamp. Recording delivers the ping first (completions enter only on an empty
queue); replay must do the same, or ``b``'s pong carries a different Lamport stamp.
"""

from dataclasses import dataclass
from typing import Any

import pytest

from fractalswarm.kernel.clock import LiveClock, ManualClock
from fractalswarm.kernel.effects import EffectContext, EffectRunner, drive
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.replay import ReplaySetup, replay
from fractalswarm.kernel.scheduler import (
    ActorKind,
    Command,
    Runtime,
    Send,
    SetTimer,
    Spawn,
    View,
    register_scenario,
)
from fractalswarm.kernel.store import EventStore


def a_handle(state: None, event: Event, view: View):
    if event.type == "actor.spawned":
        # Deliveries to nobody are dropped, but they raise a's Lamport clock.
        noise: list[Command] = [Send(to="nobody", topic="noise") for _ in range(5)]
        return state, [*noise, Send(to="b", topic="ping")]
    return state, []


def b_handle(state: None, event: Event, view: View):
    if event.type == "actor.spawned":
        return state, [SetTimer(delay_ms=0, tag="t")]
    if event.type == "effect.completed":
        return state, [Send(to="a", topic="pong")]
    return state, []  # the ping: nothing to say


@dataclass(frozen=True)
class Silent:
    kinds = {
        "a": ActorKind(lambda actor_id, args: None, a_handle),
        "b": ActorKind(lambda actor_id, args: None, b_handle),
    }

    def boot(self, params: dict[str, Any]) -> list[Command]:
        return [Spawn(actor_id="a", kind="a"), Spawn(actor_id="b", kind="b")]


register_scenario("silent-deliveries", Silent())


@pytest.mark.parametrize("mode", ["sim", "live"])
async def test_silent_deliveries_replay(mode: str) -> None:
    recorded = EventStore()
    runtime = Runtime(recorded, run_id="r", seed="s", scenario="silent-deliveries", clock=mode)
    clock = ManualClock("sim") if mode == "sim" else LiveClock(speed=1000.0)
    await drive(runtime, EffectRunner({}, EffectContext("r", clock)))
    pong = next(e for e in recorded.read() if e.type == "msg.sent" and e.payload["topic"] == "pong")
    ping = next(e for e in recorded.read() if e.type == "msg.sent" and e.payload["topic"] == "ping")
    assert pong.lamport > ping.lamport  # b saw the ping before its timer

    report = await replay(recorded, lambda started: ReplaySetup())
    assert report.ok, report.detail
