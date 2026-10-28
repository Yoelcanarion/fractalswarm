"""The message bus (spec §5.4), built on the kernel's ``Send`` and ``msg.sent``.

The bus is not an actor. Each actor keeps an ``Endpoint`` in its state and runs its events
through ``handle`` first. ``handle`` turns bus frames and the bus timer into ``Delivery``
items for the actor, plus commands such as acks and retries. The endpoint is updated in
place: it is part of the actor's state and changes only inside the actor's own handler.

Delivery rules:
- **Critical lane: at-least-once.** The receiver acks every copy. The sender resends with
  exponential backoff until the ack arrives, the message expires, the receiver is dead in
  the members view, or ``max_attempts`` is reached.
- **Normal and low lanes: at-most-once.** They are never resent.
- **Dedup by ``idem_key``**, which defaults to the message id. Resends keep the id, so a
  resent copy is a duplicate. Two senders that publish the same result under one key are
  duplicates too.
- **Causal buffer.** A message waits until every message in its ``deps`` has been delivered,
  or until ``hold_ms`` has passed. Critical messages to the same receiver automatically
  depend on the previous one, which keeps them in FIFO order. Messages that become ready
  together are applied in Lamport order ``(lamport, sender, incarnation, n)``.
- **Fencing.** Frames from an incarnation that the members view (``View.views["members"]``)
  says is dead are dropped. The sender gets a ``fenced`` notice so that it can rejoin.

Pub/sub fans out at the publisher, to the subscribers it knows (given at start or learned
from ``subscribe`` frames), so each copy is acked end to end. With a ``relay`` set, every
frame goes through that actor first (the chaos network in ``comms/chaos.py``).

**Breakers** (spec §8, off by default). With an ``Endpoint.guard`` (``comms/channel_breakers``)
every application message the endpoint sends or receives is counted by its channel and topic
breakers, and a send is routed by what they say: onto the wire, held for its 1 msg/s slot
(critical lane while a channel is open), diverted to the receiver's blackboard mailbox, or
coalesced into a digest (``kind="digest"``, delivered as such). Mail is fetched by polling
(``comms/mailbox.py``). Without a guard none of this runs, and the frames are unchanged.

All timing uses one timer tag, ``bus.tick``, armed only while there is pending work.
"""

import bisect
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict

from fractalswarm.comms.channel_breakers import Guard, Route
from fractalswarm.comms.mailbox import MAIL_ITEMS, MAIL_NOTIFY, MAIL_POLL, MAIL_PUT, MAILBOX_ACTOR
from fractalswarm.comms.topics import Lane, lane_of, validate
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Emit, Send, SetTimer, View

ENVELOPE_KEY = "bus"
TICK_TAG = "bus.tick"
RELAY_TOPIC = "net.frame"

Kind = Literal["msg", "request", "reply", "ack", "subscribe", "fenced", "digest"]


class Envelope(BaseModel):
    """A bus frame (spec §5.4). ``to`` is one receiver; a publish sends one frame each."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    n: int
    kind: Kind = "msg"
    sender: str
    incarnation: int = 0
    to: str
    topic: str
    lane: Lane = Lane.NORMAL
    lamport: int = 0
    member_epoch: int = 0
    idem_key: str
    correlation_id: str | None = None
    deps: tuple[str, ...] = ()
    expires_at: int | None = None
    attempt: int = 0
    payload: dict[str, Any] = {}

    def order(self) -> tuple[int, str, int, int]:
        return (self.lamport, self.sender, self.incarnation, self.n)


class MembersLike(Protocol):
    def is_dead(self, member: str, incarnation: int) -> bool: ...

    def is_gone(self, member: str) -> bool: ...


@dataclass(frozen=True)
class BusPolicy:
    retry_base_ms: int = 250
    retry_max_ms: int = 4000
    max_attempts: int = 8
    hold_ms: int = 2000
    request_timeout_ms: int = 5000
    memory: int = 4096  # idem keys and delivered ids remembered for dedup and deps

    def backoff(self, attempt: int) -> int:
        return min(self.retry_base_ms * 2**attempt, self.retry_max_ms)


@dataclass(frozen=True)
class Delivery:
    """What the actor sees.

    ``kind``: ``msg``, ``request`` and ``reply`` carry a payload; ``timeout`` is a request
    that got no reply in time; ``undeliverable`` is a critical message the bus gave up on;
    ``fenced`` means this actor's incarnation is dead in the log and it should rejoin.
    """

    kind: str
    topic: str
    sender: str
    payload: dict[str, Any]
    correlation_id: str | None = None
    envelope: Envelope | None = None


@dataclass
class BusOutcome:
    deliveries: list[Delivery] = field(default_factory=list)
    commands: list[Command] = field(default_factory=list)


@dataclass
class Outgoing:
    envelope: Envelope
    due: int


@dataclass
class Endpoint:
    owner: str
    incarnation: int = 0
    relay: str | None = None
    policy: BusPolicy = field(default_factory=BusPolicy)
    subscribers: dict[str, list[str]] = field(default_factory=dict)
    counter: int = 0
    unacked: dict[str, Outgoing] = field(default_factory=dict)
    last_critical: dict[str, str] = field(default_factory=dict)
    held: dict[str, tuple[Envelope, int]] = field(default_factory=dict)
    seen: dict[str, None] = field(default_factory=dict)
    delivered: dict[str, None] = field(default_factory=dict)
    incarnations: dict[str, int] = field(default_factory=dict)
    requests: dict[str, tuple[str, int]] = field(default_factory=dict)  # id -> (topic, deadline)
    armed: list[int] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)
    guard: Guard | None = None
    paced: list[Outgoing] = field(default_factory=list)  # critical messages awaiting their slot

    @property
    def idle(self) -> bool:
        """Nothing left to resend, release, flush, fetch or wait for."""
        if self.unacked or self.held or self.requests or self.paced:
            return False
        return self.guard is None or self.guard.idle

    def count(self, name: str, n: int = 1) -> None:
        self.stats[name] = self.stats.get(name, 0) + n


# -- sending ----------------------------------------------------------------------------


def send(
    ep: Endpoint,
    view: View,
    to: str,
    topic: str,
    payload: dict[str, Any] | None = None,
    *,
    lane: Lane | None = None,
    idem_key: str | None = None,
    correlation_id: str | None = None,
    deps: tuple[str, ...] | list[str] = (),
    ttl_ms: int | None = None,
) -> list[Command]:
    """One message to one actor."""
    _, commands = _send(
        ep,
        view,
        to,
        topic,
        validate(topic, payload or {}),
        kind="msg",
        lane=lane or lane_of(topic),
        idem_key=idem_key,
        correlation_id=correlation_id,
        deps=tuple(deps),
        ttl_ms=ttl_ms,
    )
    return commands


def publish(
    ep: Endpoint,
    view: View,
    topic: str,
    payload: dict[str, Any] | None = None,
    *,
    lane: Lane | None = None,
    idem_key: str | None = None,
    deps: tuple[str, ...] | list[str] = (),
    ttl_ms: int | None = None,
) -> list[Command]:
    """One copy per known subscriber of ``topic`` (the publisher itself excluded)."""
    commands: list[Command] = []
    for subscriber in ep.subscribers.get(topic, []):
        if subscriber != ep.owner:
            commands += send(
                ep,
                view,
                subscriber,
                topic,
                payload,
                lane=lane,
                idem_key=idem_key,
                deps=deps,
                ttl_ms=ttl_ms,
            )
    return commands


def request(
    ep: Endpoint,
    view: View,
    to: str,
    topic: str,
    payload: dict[str, Any] | None = None,
    *,
    timeout_ms: int | None = None,
) -> tuple[str, list[Command]]:
    """Send a request on the critical lane; returns its correlation id.

    The reply arrives as a ``reply`` delivery with that correlation id, or a ``timeout``
    delivery once ``timeout_ms`` has passed.
    """
    envelope, commands = _send(
        ep,
        view,
        to,
        topic,
        validate(topic, payload or {}),
        kind="request",
        lane=Lane.CRITICAL,
    )
    deadline = view.now + (timeout_ms or ep.policy.request_timeout_ms)
    ep.requests[envelope.id] = (topic, deadline)
    return envelope.id, commands + _arm(ep, view.now, deadline)


def reply(
    ep: Endpoint, view: View, to_request: Delivery, payload: dict[str, Any] | None = None
) -> list[Command]:
    _, commands = _send(
        ep,
        view,
        to_request.sender,
        to_request.topic,
        payload or {},
        kind="reply",
        lane=Lane.CRITICAL,
        correlation_id=to_request.correlation_id,
    )
    return commands


def subscribe(ep: Endpoint, view: View, topic: str, publishers: list[str]) -> list[Command]:
    """Ask each publisher to include this actor in its fan-out of ``topic``."""
    commands: list[Command] = []
    for publisher in publishers:
        if publisher != ep.owner:
            _, more = _send(ep, view, publisher, topic, {}, kind="subscribe", lane=Lane.CRITICAL)
            commands += more
    return commands


def add_subscriber(ep: Endpoint, topic: str, subscriber: str) -> None:
    current = ep.subscribers.get(topic, [])
    if subscriber not in current:
        ep.subscribers[topic] = sorted([*current, subscriber])


def reset(ep: Endpoint, incarnation: int) -> None:
    """Start a new incarnation: forget what this actor had in flight."""
    ep.incarnation = incarnation
    ep.unacked.clear()
    ep.last_critical.clear()
    ep.requests.clear()
    ep.paced.clear()
    if ep.guard is not None:
        ep.guard.forget_in_flight()


def _send(
    ep: Endpoint,
    view: View,
    to: str,
    topic: str,
    payload: dict[str, Any],
    *,
    kind: Kind,
    lane: Lane,
    idem_key: str | None = None,
    correlation_id: str | None = None,
    deps: tuple[str, ...] = (),
    ttl_ms: int | None = None,
) -> tuple[Envelope, list[Command]]:
    ep.counter += 1
    msg_id = f"{ep.owner}#{ep.incarnation}:{ep.counter}"
    correlation_id = correlation_id if kind != "request" else msg_id
    routed = None
    if ep.guard is not None:
        routed = ep.guard.route_out(
            view.now,
            peer=to,
            topic=topic,
            kind=kind,
            lane=lane,
            payload=payload,
            correlation_id=correlation_id,
            backlog=bool(ep.paced),
        )
    absorbed = routed is not None and routed.route == Route.ABSORB
    reliable = lane == Lane.CRITICAL and kind not in ("ack", "fenced") and not absorbed
    if reliable:
        previous = ep.last_critical.get(to)
        if previous is not None and previous not in deps:
            deps = (*deps, previous)
        ep.last_critical[to] = msg_id
    envelope = Envelope(
        id=msg_id,
        n=ep.counter,
        kind=kind,
        sender=ep.owner,
        incarnation=ep.incarnation,
        to=to,
        topic=topic,
        lane=lane,
        lamport=view.lamport,
        member_epoch=view.member_epoch,
        idem_key=idem_key or msg_id,
        correlation_id=correlation_id,
        deps=deps,
        expires_at=None if ttl_ms is None else view.now + ttl_ms,
        payload=payload,
    )
    ep.count("sent")
    if routed is None:
        return envelope, _launch(ep, view.now, envelope)
    commands: list[Command] = [Emit(type=name, payload=body) for name, body in routed.moves]
    match routed.route:
        case Route.ABSORB:
            ep.count("coalesced")
        case Route.DIVERT:
            ep.count("diverted")
            commands.append(_mail_put(envelope))
        case Route.PACE if routed.at > view.now or ep.paced:
            ep.count("paced")
            ep.paced.append(Outgoing(envelope, routed.at))
        case _:
            commands += _launch(ep, view.now, envelope)
    return envelope, commands + _arm_guard(ep, view.now)


def _launch(ep: Endpoint, now: int, envelope: Envelope) -> list[Command]:
    """Put a message on the wire. A critical one is also kept until it is acked."""
    commands: list[Command] = [_wire(ep, envelope)]
    if envelope.lane == Lane.CRITICAL and envelope.kind not in ("ack", "fenced"):
        due = now + ep.policy.backoff(0)
        ep.unacked[envelope.id] = Outgoing(envelope, due)
        commands += _arm(ep, now, due)
    return commands


def _wire(ep: Endpoint, envelope: Envelope) -> Send:
    body = {ENVELOPE_KEY: envelope.model_dump(mode="json")}
    if ep.relay is not None:
        return Send(to=ep.relay, topic=RELAY_TOPIC, body=body)
    return Send(to=envelope.to, topic=envelope.topic, body=body)


def _mail_put(envelope: Envelope) -> Send:
    """Divert a message to its receiver's mailbox on the blackboard (not through the relay)."""
    body = {"to": envelope.to, "env": envelope.model_dump(mode="json")}
    return Send(to=MAILBOX_ACTOR, topic=MAIL_PUT, body=body)


def _arm(ep: Endpoint, now: int, due: int) -> list[Command]:
    """Make sure a ``bus.tick`` fires at or before ``due``."""
    if ep.armed and ep.armed[0] <= due:
        return []
    bisect.insort(ep.armed, due)
    return [SetTimer(delay_ms=max(due - now, 1), tag=TICK_TAG)]


def _arm_guard(ep: Endpoint, now: int) -> list[Command]:
    """Wake the endpoint for its paced messages and its breakers' deadlines, digests and polls."""
    dues = [pending.due for pending in ep.paced]
    if ep.guard is not None:
        dues += ep.guard.deadlines()
    return _arm(ep, now, min(dues)) if dues else []


# -- receiving --------------------------------------------------------------------------


def frame_of(event: Event) -> Envelope | None:
    if event.type != "msg.sent":
        return None
    raw = event.payload["body"].get(ENVELOPE_KEY)
    return None if raw is None else Envelope.model_validate(raw)


def handle(ep: Endpoint, event: Event, view: View) -> BusOutcome | None:
    """Process a bus event; ``None`` means the event is not the bus's business."""
    if event.type == "effect.completed" and event.payload["tag"] == TICK_TAG:
        return on_tick(ep, view)
    if ep.guard is not None and event.type == "msg.sent":
        mail = on_mail(ep, event, view)
        if mail is not None:
            return mail
    envelope = frame_of(event)
    if envelope is None:
        return None
    return on_frame(ep, envelope, view)


def _members(view: View) -> MembersLike | None:
    return view.views.get("members")


def on_mail(ep: Endpoint, event: Event, view: View) -> BusOutcome | None:
    """The blackboard's side of the mailbox: a notice that mail is waiting, or the messages
    that a poll fetched, which are processed as if they had just arrived."""
    guard = ep.guard
    assert guard is not None
    topic, now = event.payload["topic"], view.now
    if topic == MAIL_NOTIFY:
        guard.on_notify(now)
        return BusOutcome(commands=_arm_guard(ep, now))
    if topic != MAIL_ITEMS:
        return None
    body = event.payload["body"]
    out = BusOutcome()
    for raw in body["items"]:
        more = on_frame(ep, Envelope.model_validate(raw), view, from_mail=True)
        out.deliveries += more.deliveries
        out.commands += more.commands
    ep.count("mail_in", len(body["items"]))
    guard.on_mail(now, len(body["items"]), int(body["more"]))
    out.commands += _arm_guard(ep, now)
    return out


def on_frame(ep: Endpoint, env: Envelope, view: View, *, from_mail: bool = False) -> BusOutcome:
    out = BusOutcome()
    now = view.now
    if env.kind == "ack":
        if ep.unacked.pop(env.correlation_id or "", None) is not None:
            ep.count("acked")
        return out
    if env.kind == "fenced":
        if env.payload.get("incarnation") == ep.incarnation:
            out.deliveries.append(Delivery("fenced", env.topic, env.sender, env.payload))
        return out

    members = _members(view)
    if members is not None and members.is_dead(env.sender, env.incarnation):
        ep.count("fenced")
        notice = {"member": env.sender, "incarnation": env.incarnation}
        _, out.commands = _send(
            ep, view, env.sender, env.topic, notice, kind="fenced", lane=Lane.NORMAL
        )
        return out
    if env.incarnation < ep.incarnations.get(env.sender, -1):
        ep.count("stale")
        return out
    ep.incarnations[env.sender] = env.incarnation

    if env.lane == Lane.CRITICAL:
        _, out.commands = _send(
            ep, view, env.sender, "bus.ack", {}, kind="ack", lane=Lane.NORMAL, correlation_id=env.id
        )
    if env.id in ep.held or env.id in ep.delivered:
        ep.count("duplicate")
        return out
    if env.expires_at is not None and env.expires_at <= now:
        ep.count("expired")
        _remember(ep.delivered, env.id, ep.policy.memory)
        return out
    if env.idem_key in ep.seen:
        ep.count("duplicate")
        _remember(ep.delivered, env.id, ep.policy.memory)  # applied, as its twin
        out.deliveries += _release(ep, now)
        return out
    _remember(ep.seen, env.idem_key, ep.policy.memory)
    if env.kind == "subscribe":
        add_subscriber(ep, env.topic, env.sender)
        _remember(ep.delivered, env.id, ep.policy.memory)
        out.deliveries += _release(ep, now)
        return out
    if ep.guard is not None:
        moves = ep.guard.on_receive(
            now,
            peer=env.sender,
            topic=env.topic,
            kind=env.kind,
            payload=env.payload,
            correlation_id=env.correlation_id,
            from_mail=from_mail,
        )
        if moves:
            out.commands += [Emit(type=name, payload=body) for name, body in moves]
            out.commands += _arm_guard(ep, now)

    release_at = now + ep.policy.hold_ms
    ep.held[env.id] = (env, release_at)
    out.deliveries += _release(ep, now)
    if env.id in ep.held:
        out.commands += _arm(ep, now, release_at)
    return out


def _release(ep: Endpoint, now: int) -> list[Delivery]:
    released: list[Delivery] = []
    while True:
        ready = [
            env
            for env, release_at in ep.held.values()
            if release_at <= now or all(dep in ep.delivered for dep in env.deps)
        ]
        if not ready:
            return released
        env = min(ready, key=Envelope.order)
        del ep.held[env.id]
        _remember(ep.delivered, env.id, ep.policy.memory)
        if any(dep not in ep.delivered for dep in env.deps):
            ep.count("released_without_deps")
        delivery = _to_delivery(ep, env)
        if delivery is not None:
            ep.count("delivered")
            released.append(delivery)


def _to_delivery(ep: Endpoint, env: Envelope) -> Delivery | None:
    if env.kind == "reply" and ep.requests.pop(env.correlation_id or "", None) is None:
        ep.count("late_reply")
        return None
    return Delivery(env.kind, env.topic, env.sender, env.payload, env.correlation_id, env)


def on_tick(ep: Endpoint, view: View) -> BusOutcome:
    out = BusOutcome()
    now = view.now
    ep.armed = [due for due in ep.armed if due > now]
    members = _members(view)

    for msg_id in list(ep.unacked):
        pending = ep.unacked[msg_id]
        env = pending.envelope
        if pending.due > now:
            continue
        if env.expires_at is not None and env.expires_at <= now:
            del ep.unacked[msg_id]
            ep.count("expired")
            continue
        attempt = env.attempt + 1
        receiver_gone = members is not None and members.is_gone(env.to)
        if receiver_gone or attempt >= ep.policy.max_attempts:
            del ep.unacked[msg_id]
            ep.count("given_up")
            out.deliveries.append(
                Delivery("undeliverable", env.topic, env.to, env.payload, env.correlation_id, env)
            )
            continue
        resent = env.model_copy(update={"attempt": attempt})
        ep.unacked[msg_id] = Outgoing(resent, now + ep.policy.backoff(attempt))
        ep.count("resent")
        out.commands.append(_wire(ep, resent))

    out.deliveries += _release(ep, now)

    for correlation_id, (topic, deadline) in list(ep.requests.items()):
        if deadline <= now:
            del ep.requests[correlation_id]
            ep.count("timeout")
            out.deliveries.append(Delivery("timeout", topic, ep.owner, {}, correlation_id))

    if ep.guard is not None:
        out.commands += _guard_tick(ep, view)

    upcoming = [pending.due for pending in ep.unacked.values()]
    upcoming += [release_at for _, release_at in ep.held.values()]
    upcoming += [deadline for _, deadline in ep.requests.values()]
    upcoming += [pending.due for pending in ep.paced]
    if ep.guard is not None:
        upcoming += ep.guard.deadlines()
    if upcoming:
        out.commands += _arm(ep, now, min(upcoming))
    return out


def _guard_tick(ep: Endpoint, view: View) -> list[Command]:
    """The breakers' own clock: state changes, paced messages that are due, digests, a poll."""
    guard, now = ep.guard, view.now
    assert guard is not None
    moves, digests = guard.tick(now)
    commands: list[Command] = [Emit(type=name, payload=body) for name, body in moves]
    ready = [pending for pending in ep.paced if pending.due <= now]
    ep.paced = [pending for pending in ep.paced if pending.due > now]
    for pending in ready:
        commands += _launch(ep, now, pending.envelope)
    for topic, peer, payload in digests:
        _, more = _send(
            ep,
            view,
            peer,
            topic,
            payload,
            kind="digest",
            lane=lane_of(topic),
            idem_key=guard.digest_key(topic, peer),
        )
        commands += more
    if guard.poll_now(now):
        commands.append(
            Send(to=MAILBOX_ACTOR, topic=MAIL_POLL, body={"batch": guard.policy.mail.batch})
        )
    return commands


def _remember(memory: dict[str, None], key: str, limit: int) -> None:
    memory[key] = None
    while len(memory) > limit:
        del memory[next(iter(memory))]
