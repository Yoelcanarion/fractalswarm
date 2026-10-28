"""A test-bed for the channel and topic-storm breakers (spec §8): three phases on one bus.

``BREAKER_TOY`` runs a blackboard (the mailbox lives there) and:

- **a ping-pong.** ``ping`` and ``pong`` bounce the same question back and forth on one
  correlation id, so no message after the first carries a new fact. The channel breaker
  opens at the 6th alternation; the rest of the exchange goes through the mailbox, which
  each side polls;
- **a critical burst.** While that channel is open, ``ping`` sends ``burst`` messages on the
  critical lane at once; they must arrive one per second, in order, none lost;
- **a storm.** ``publisher`` publishes ``publishes`` updates of one topic to ``subscribers``
  subscribers, so no single channel is busy but the topic is. After the topic breaker opens
  its updates reach each subscriber as one digest.

Every delivery is logged as ``breakertoy.got``. ``ping`` ends the run at ``deadline_ms``.
Nothing here calls the LLM. ``params`` (all optional): ``guard`` (``True``, or a dict of
``GuardPolicy`` overrides; ``False`` runs the same traffic with no breakers), ``bounces``,
``burst``, ``burst_at_ms``, ``storm_at_ms``, ``publishes``, ``subscribers``, ``deadline_ms``.

Two knobs trip the other detectors with the same traffic: ``distinct`` makes every ping-pong
message carry a new fact (so only the rate can open the channel), and ``pad`` adds that many
bytes to each (so the size can).
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.actors.board import BOARD, board_handle, board_init
from fractalswarm.comms import bus
from fractalswarm.comms.bus import Delivery, Endpoint
from fractalswarm.comms.channel_breakers import Guard
from fractalswarm.comms.topics import ARTIFACT_READY, BUDGET_EPOCH
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.scheduler import (
    ActorKind,
    Command,
    Emit,
    SetTimer,
    Spawn,
    Stop,
    View,
)

NEGOTIATE = "negotiate"
CONVERSATION = "negotiation"
QUESTION = {"q": "agree?"}  # said by both sides every time: never a new fact


@register("breakertoy.got")
class Got(Payload):
    who: str
    kind: str  # msg | digest
    topic: str
    sender: str
    msg_id: str | None
    body: dict[str, Any]


@register("breakertoy.finished")
class Finished(Payload):
    by: str
    said: dict[str, int]  # actor -> ping-pong messages it sent


def _got(who: str, delivery: Delivery) -> Command:
    envelope = delivery.envelope
    payload = Got(
        who=who,
        kind=delivery.kind,
        topic=delivery.topic,
        sender=delivery.sender,
        msg_id=envelope.id if envelope else None,
        body=delivery.payload,
    )
    return Emit(type="breakertoy.got", payload=payload.model_dump(mode="json"))


def _tag(event: Event) -> str | None:
    return event.payload.get("tag") if event.type == "effect.completed" else None


def _bus(ep: Endpoint, event: Event, view: View) -> tuple[list[Command], list[Delivery]]:
    out = bus.handle(ep, event, view)
    return ([], []) if out is None else (list(out.commands), list(out.deliveries))


# -- ping and pong ----------------------------------------------------------------------


@dataclass
class Talker:
    ep: Endpoint
    peer: str
    limit: int  # ping-pong messages this side will send
    burst: int
    burst_at_ms: int
    deadline_ms: int
    distinct: bool = False
    pad: int = 0
    said: int = 0


def talker_init(actor_id: str, args: dict[str, Any]) -> Talker:
    return Talker(
        ep=Endpoint(actor_id, guard=Guard.create(actor_id, args.get("guard"))),
        peer=args["peer"],
        limit=int(args["limit"]),
        burst=int(args["burst"]),
        burst_at_ms=int(args["burst_at_ms"]),
        deadline_ms=int(args["deadline_ms"]),
        distinct=bool(args["distinct"]),
        pad=int(args["pad"]),
    )


def _say(state: Talker, view: View) -> list[Command]:
    state.said += 1
    said = dict(QUESTION)
    if state.distinct:
        said["n"] = state.said  # (per side) a new fact every time
    if state.pad:
        said["pad"] = "x" * state.pad
    return bus.send(state.ep, view, state.peer, NEGOTIATE, said, correlation_id=CONVERSATION)


def talker_handle(state: Talker, event: Event, view: View):
    me = view.actor_id
    if event.type == "actor.spawned":
        if me != "ping":
            return state, []
        commands = _say(state, view)
        commands.append(SetTimer(delay_ms=state.burst_at_ms, tag="burst"))
        commands.append(SetTimer(delay_ms=state.deadline_ms, tag="deadline"))
        return state, commands
    tag = _tag(event)
    if tag == "burst":
        commands = []
        for i in range(state.burst):
            commands += bus.send(state.ep, view, state.peer, ARTIFACT_READY.name, {"i": i})
        return state, commands
    if tag == "deadline":
        finished = Finished(by=me, said={me: state.said})
        stops = [Stop(actor_id=actor, reason="done") for actor in view.alive if actor != me]
        done = Emit(type="breakertoy.finished", payload=finished.model_dump(mode="json"))
        return state, [done, *stops, Stop(reason="done")]
    commands, deliveries = _bus(state.ep, event, view)
    for delivery in deliveries:
        commands.append(_got(me, delivery))
        if delivery.kind == "msg" and delivery.topic == NEGOTIATE and state.said < state.limit:
            commands += _say(state, view)
    return state, commands


# -- the storm --------------------------------------------------------------------------


@dataclass
class Publisher:
    ep: Endpoint
    publishes: int
    start_ms: int
    every_ms: int
    sent: int = 0


def publisher_init(actor_id: str, args: dict[str, Any]) -> Publisher:
    ep = Endpoint(actor_id, guard=Guard.create(actor_id, args.get("guard")))
    ep.subscribers[BUDGET_EPOCH.name] = sorted(args["subscribers"])
    return Publisher(
        ep=ep,
        publishes=int(args["publishes"]),
        start_ms=int(args["start_ms"]),
        every_ms=int(args["every_ms"]),
    )


def publisher_handle(state: Publisher, event: Event, view: View):
    if event.type == "actor.spawned":
        return state, [SetTimer(delay_ms=state.start_ms, tag="publish")]
    if _tag(event) == "publish":
        payload = {"epoch": state.sent // 5}  # updates repeat: a digest folds them
        commands = bus.publish(state.ep, view, BUDGET_EPOCH.name, payload)
        state.sent += 1
        if state.sent < state.publishes:
            commands.append(SetTimer(delay_ms=state.every_ms, tag="publish"))
        return state, commands
    commands, _ = _bus(state.ep, event, view)
    return state, commands


@dataclass
class Subscriber:
    ep: Endpoint


def subscriber_init(actor_id: str, args: dict[str, Any]) -> Subscriber:
    return Subscriber(Endpoint(actor_id, guard=Guard.create(actor_id, args.get("guard"))))


def subscriber_handle(state: Subscriber, event: Event, view: View):
    commands, deliveries = _bus(state.ep, event, view)
    commands += [_got(view.actor_id, delivery) for delivery in deliveries]
    return state, commands


# -- the scenario -----------------------------------------------------------------------


@dataclass(frozen=True)
class BreakerToyScenario:
    kinds = {
        "board": ActorKind(board_init, board_handle),
        "talker": ActorKind(talker_init, talker_handle),
        "publisher": ActorKind(publisher_init, publisher_handle),
        "subscriber": ActorKind(subscriber_init, subscriber_handle),
    }

    def boot(self, params: dict[str, Any]) -> list[Command]:
        guard = params.get("guard", True)
        bounces = int(params.get("bounces", 14))
        talk = {
            "guard": guard,
            "limit": (bounces + 1) // 2,
            "burst": int(params.get("burst", 6)),
            "burst_at_ms": int(params.get("burst_at_ms", 2_000)),
            "deadline_ms": int(params.get("deadline_ms", 60_000)),
            "distinct": bool(params.get("distinct", False)),
            "pad": int(params.get("pad", 0)),
        }
        names = [f"s{n}" for n in range(int(params.get("subscribers", 4)))]
        storm = {
            "guard": guard,
            "subscribers": names,
            "publishes": int(params.get("publishes", 15)),
            "start_ms": int(params.get("storm_at_ms", 20_000)),
            "every_ms": 100,
        }
        commands: list[Command] = [Spawn(actor_id=BOARD, kind="board")]
        commands += [
            Spawn(actor_id=name, kind="subscriber", args={"guard": guard}) for name in names
        ]
        commands += [Spawn(actor_id="publisher", kind="publisher", args=storm)]
        commands += [Spawn(actor_id="pong", kind="talker", args=talk | {"peer": "ping"})]
        commands += [Spawn(actor_id="ping", kind="talker", args=talk | {"peer": "pong"})]
        return commands


BREAKER_TOY = BreakerToyScenario()
