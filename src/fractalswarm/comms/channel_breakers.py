"""The channel and topic-storm breakers (spec §8), on virtual time.

Both live in an endpoint's ``Guard`` (``Endpoint.guard``, ``None`` unless a run turns them
on), so they are plain state inside the actor that sends, and a replay reproduces every trip.
Time is the ``now`` the handler was given. Every state change comes back as a ``breaker.*``
payload to emit, like the model breaker's (``comms/breakers.py``).

**What counts.** An application message is a ``msg``, ``request`` or ``reply`` frame. Not
counted and never held back: the bus's own control frames (``ack``, ``fenced``,
``subscribe``) and liveness gossip (``member.heartbeat``). A breaker that silenced heartbeats
would turn congestion into a false ``member.dead`` and a takeover. A message's size is the
bytes of its canonical JSON payload. Resends are not counted: they are the same message.

**Channel breaker** (one per pair, named ``channel:a|b``). Each endpoint keeps its own for
every peer, fed by the messages it sends to and receives from that peer, so a one-way flood
trips only the sender and a ping-pong trips both. It opens on any of:
- more than ``max_msgs`` messages in ``window_ms``;
- more than ``max_bytes`` in ``window_ms``;
- ping-pong: ``pingpong_alternations`` alternations on one correlation id with no new fact.

*New fact:* a payload whose fingerprint (``blake2b`` of ``[topic, payload]``) has not been
seen earlier on that correlation id. An *alternation* is a message from a different sender
than the one before it. The count restarts at every new fact.

While open, an endpoint's sends to that peer split by lane. The **critical lane** is every
frame whose envelope lane is ``critical``: the topics registered critical in ``topics.py``,
plus requests and replies. It keeps flowing at most ``1 / critical_gap_ms`` messages per
second, in order: the bus holds the excess until its slot, so nothing on it is lost and its
FIFO chain (``deps``) stays intact. Everything else is diverted to the receiver's blackboard
mailbox (``comms/mailbox.py``), which the receiver polls with backoff.

**Recovery.** After ``half_open_after_ms`` the breaker is half-open: traffic flows again
on fresh windows, and the first trigger re-opens it (``trips + 1``). A full ``window_ms``
without one closes it.

**Topic storm breaker** (``topic:t``). An endpoint counts the frames it publishes or sends
on one topic, whoever receives them. Above ``max_msgs`` in ``window_ms`` it opens, and its
``msg`` frames on that topic are coalesced per receiver into a digest, sent at most every
``digest_every_ms`` (and once more when it half-opens). Requests and replies are never
coalesced: a digest cannot stand in for a reply. Recovery is the same as above. A fan-in
storm (many publishers, one subscriber) is not seen: no single endpoint counts it.
"""

from collections import deque
from dataclasses import dataclass, field
from enum import StrEnum
from itertools import chain
from typing import Any

from pydantic import BaseModel, ConfigDict

from fractalswarm.comms import breakers as _breakers  # noqa: F401  (registers breaker.*)
from fractalswarm.comms.topics import HEARTBEAT, Lane
from fractalswarm.kernel.ids import canonical_json, digest

Transition = tuple[str, dict[str, Any]]

EXEMPT_TOPICS = frozenset({HEARTBEAT.name})
CONTROL_KINDS = frozenset({"ack", "fenced", "subscribe"})


class ChannelPolicy(BaseModel):
    """Defaults from ``config/defaults.yaml`` (breakers.channel), in milliseconds."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_msgs: int = 20
    max_bytes: int = 65_536
    window_ms: int = 10_000
    pingpong_alternations: int = 6
    critical_gap_ms: int = 1_000  # the critical lane passes 1 msg/s while open
    half_open_after_ms: int = 15_000


class StormPolicy(BaseModel):
    """Defaults from ``config/defaults.yaml`` (breakers.topic_storm), in milliseconds."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_msgs: int = 50
    window_ms: int = 10_000
    half_open_after_ms: int = 15_000
    digest_every_ms: int = 1_000
    digest_max_items: int = 32


class MailPolicy(BaseModel):
    """How a receiver polls its mailbox: exponential backoff, until it finds it empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    poll_base_ms: int = 250
    poll_max_ms: int = 4_000
    poll_idle_rounds: int = 3  # empty (or unanswered) polls in a row before it stops
    batch: int = 16


class GuardPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    channel: ChannelPolicy = ChannelPolicy()
    storm: StormPolicy = StormPolicy()
    mail: MailPolicy = MailPolicy()

    @classmethod
    def from_config(cls, section: dict[str, Any]) -> "GuardPolicy":
        """``section`` is the ``breakers`` block of ``config/defaults.yaml``."""
        channel, storm = section["channel"], section["topic_storm"]
        return cls(
            channel=ChannelPolicy(
                max_msgs=channel["max_msgs"],
                max_bytes=channel["max_bytes"],
                window_ms=int(channel["window_s"] * 1000),
                pingpong_alternations=channel["pingpong_alternations"],
                critical_gap_ms=int(1000 / channel["open_critical_max_per_s"]),
                half_open_after_ms=int(channel["half_open_after_s"] * 1000),
            ),
            storm=StormPolicy(
                max_msgs=storm["max_msgs"],
                window_ms=int(storm["window_s"] * 1000),
                half_open_after_ms=int(storm["half_open_after_s"] * 1000),
            ),
        )


# -- the pure detectors -----------------------------------------------------------------


def payload_size(payload: dict[str, Any]) -> int:
    return len(canonical_json(payload).encode("utf-8"))


def fingerprint(topic: str, payload: dict[str, Any]) -> str:
    """What makes a message a *new fact* on its conversation: its topic and its content."""
    return digest([topic, payload])


@dataclass
class Window:
    """The messages and bytes of the last ``span_ms``: a sample at ``t`` counts while
    ``now - t < span_ms``. Times must not go backwards."""

    span_ms: int
    samples: deque[tuple[int, int]] = field(default_factory=deque)
    size: int = 0

    @property
    def count(self) -> int:
        return len(self.samples)

    def trim(self, now: int) -> None:
        while self.samples and now - self.samples[0][0] >= self.span_ms:
            self.size -= self.samples.popleft()[1]

    def add(self, now: int, size: int = 0) -> None:
        self.trim(now)
        self.samples.append((now, size))
        self.size += size

    def clear(self) -> None:
        self.samples.clear()
        self.size = 0


@dataclass
class _Conversation:
    last_sender: str
    streak: int = 0
    seen: dict[str, None] = field(default_factory=dict)  # fingerprints, oldest first


@dataclass
class PingPong:
    """Alternations without a new fact, per correlation id.

    Per conversation: a message that carries a new fact restarts the count; any other
    message from a different sender than the one before adds an alternation. Memory is
    bounded: the ``max_conversations`` least recently active conversations are forgotten, and
    so are the oldest of the ``max_facts`` fingerprints a conversation remembers.
    """

    max_conversations: int = 256
    max_facts: int = 64
    conversations: dict[str, _Conversation] = field(default_factory=dict)

    def observe(self, correlation_id: str, sender: str, fact: str) -> int:
        """Feed one message; returns the alternations since the last new fact."""
        conversation = self.conversations.pop(correlation_id, None)  # re-added: most recent
        if conversation is None:
            conversation = _Conversation(last_sender=sender)
        elif fact in conversation.seen:
            if sender != conversation.last_sender:
                conversation.streak += 1
        else:
            conversation.streak = 0
        conversation.last_sender = sender
        conversation.seen.pop(fact, None)
        conversation.seen[fact] = None
        while len(conversation.seen) > self.max_facts:
            del conversation.seen[next(iter(conversation.seen))]
        self.conversations[correlation_id] = conversation
        while len(self.conversations) > self.max_conversations:
            del self.conversations[next(iter(self.conversations))]
        return conversation.streak

    def clear(self) -> None:
        self.conversations.clear()


class DigestItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    payload: dict[str, Any]
    count: int  # identical payloads folded into this item


class Digest(BaseModel):
    """What a storm is coalesced into. Every message is accounted for: ``count`` is the number
    coalesced, the items' counts plus ``elided`` add up to it, and ``elided`` messages carried
    a payload beyond the first ``max_items`` distinct ones."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    topic: str
    count: int
    bytes: int
    first_ms: int
    last_ms: int
    items: list[DigestItem]
    elided: int


@dataclass
class Coalescer:
    """Folds the messages of one (topic, receiver) into a digest, identical payloads together."""

    max_items: int
    count: int = 0
    size: int = 0
    first_ms: int = 0
    last_ms: int = 0
    elided: int = 0
    items: dict[str, list[Any]] = field(default_factory=dict)  # fingerprint -> [payload, count]

    def add(self, now: int, payload: dict[str, Any], size: int) -> None:
        if self.count == 0:
            self.first_ms = now
        self.count += 1
        self.size += size
        self.last_ms = now
        key = digest(payload)
        if key in self.items:
            self.items[key][1] += 1
        elif len(self.items) < self.max_items:
            self.items[key] = [payload, 1]
        else:
            self.elided += 1

    def build(self, topic: str) -> Digest:
        items = [DigestItem(payload=payload, count=count) for payload, count in self.items.values()]
        return Digest(
            topic=topic,
            count=self.count,
            bytes=self.size,
            first_ms=self.first_ms,
            last_ms=self.last_ms,
            items=items,
            elided=self.elided,
        )


# -- the breakers -----------------------------------------------------------------------


@dataclass(kw_only=True)
class Latch:
    """closed -> open -> half-open -> closed, shared by both breakers."""

    name: str
    open_ms: int  # how long it stays open
    probe_ms: int  # how long a half-open breaker watches before it closes
    state: str = "closed"  # closed | open | half_open
    trips: int = 0  # consecutive trips
    open_until: int = 0
    probe_until: int = 0

    @property
    def is_open(self) -> bool:
        return self.state == "open"

    def reset(self) -> None:
        """Start fresh windows (on every trip and when it half-opens)."""

    def due(self) -> int | None:
        """The next moment it changes state by itself."""
        if self.state == "open":
            return self.open_until
        return self.probe_until if self.state == "half_open" else None

    def advance(self, now: int) -> list[Transition]:
        """The state changes that time alone causes."""
        moves: list[Transition] = []
        if self.state == "open" and now >= self.open_until:
            self.state = "half_open"
            self.probe_until = self.open_until + self.probe_ms
            self.reset()
            moves.append(("breaker.half_open", {"breaker": self.name}))
        if self.state == "half_open" and now >= self.probe_until:
            self.state = "closed"
            self.trips = 0
            moves.append(("breaker.closed", {"breaker": self.name}))
        return moves

    def trip(self, now: int, reason: str) -> list[Transition]:
        self.state = "open"
        self.trips += 1
        self.open_until = now + self.open_ms
        self.reset()
        payload = {
            "breaker": self.name,
            "until_ms": self.open_until,
            "trips": self.trips,
            "reason": reason,
        }
        return [("breaker.opened", payload)]


@dataclass(kw_only=True)
class ChannelBreaker(Latch):
    policy: ChannelPolicy = field(default_factory=ChannelPolicy)
    window: Window = field(init=False)
    pingpong: PingPong = field(default_factory=PingPong)
    next_critical_at: int = 0

    def __post_init__(self) -> None:
        self.window = Window(self.policy.window_ms)

    def reset(self) -> None:
        self.window.clear()
        self.pingpong.clear()

    def observe(
        self,
        now: int,
        *,
        sender: str,
        size: int,
        correlation_id: str | None,
        fact: str,
        counted: bool = True,
    ) -> list[Transition]:
        """Feed one message of the pair. ``counted=False`` feeds only the ping-pong detector
        (mail that the receiver pulls was already counted when its sender sent it)."""
        moves = self.advance(now)
        if self.state == "open":
            return moves  # what is diverted is not counted: the windows restart at half-open
        if counted:
            self.window.add(now, size)
        streak = self.pingpong.observe(correlation_id, sender, fact) if correlation_id else 0
        span_s = self.policy.window_ms // 1000
        if self.window.count > self.policy.max_msgs:
            reason = f"{self.window.count} msgs in {span_s} s"
        elif self.window.size > self.policy.max_bytes:
            reason = f"{self.window.size} bytes in {span_s} s"
        elif streak >= self.policy.pingpong_alternations:
            reason = f"ping-pong: {streak} alternations on {correlation_id} with no new fact"
        else:
            return moves
        return moves + self.trip(now, reason)

    def critical_slot(self, now: int) -> int:
        """The time the next critical message may go: slots are one gap apart, in order."""
        at = max(now, self.next_critical_at)
        self.next_critical_at = at + self.policy.critical_gap_ms
        return at


@dataclass(kw_only=True)
class StormBreaker(Latch):
    topic: str
    policy: StormPolicy = field(default_factory=StormPolicy)
    window: Window = field(init=False)

    def __post_init__(self) -> None:
        self.window = Window(self.policy.window_ms)

    def reset(self) -> None:
        self.window.clear()

    def observe(self, now: int) -> list[Transition]:
        moves = self.advance(now)
        if self.state == "open":
            return moves
        self.window.add(now)
        if self.window.count <= self.policy.max_msgs:
            return moves
        span_s = self.policy.window_ms // 1000
        return moves + self.trip(now, f"{self.window.count} msgs on {self.topic} in {span_s} s")


# -- the guard --------------------------------------------------------------------------


class Route(StrEnum):
    PASS = "pass"  # onto the wire now
    PACE = "pace"  # critical lane: held until its slot
    DIVERT = "divert"  # to the receiver's mailbox
    ABSORB = "absorb"  # into the topic's digest


@dataclass(frozen=True)
class Routed:
    route: Route
    at: int = 0  # PACE: the slot
    moves: list[Transition] = field(default_factory=list)


@dataclass
class Guard:
    """One endpoint's breakers: a channel breaker per peer, a storm breaker per topic, the
    digests being built, and the state of its mailbox polling."""

    owner: str
    policy: GuardPolicy = field(default_factory=GuardPolicy)
    channels: dict[str, ChannelBreaker] = field(default_factory=dict)
    storms: dict[str, StormBreaker] = field(default_factory=dict)
    coalescers: dict[tuple[str, str], Coalescer] = field(default_factory=dict)
    flush_due: int | None = None
    digests: int = 0  # digest frames made, for their idem keys
    mail_due: int | None = None  # when to poll next; None: not polling
    mail_empty: int = 0  # empty or unanswered polls in a row
    mail_waiting: bool = False  # a poll is out

    @classmethod
    def create(cls, owner: str, setting: Any) -> "Guard | None":
        """``setting`` is a run param: falsy for off, ``True`` for the defaults, or a dict of
        ``GuardPolicy`` overrides."""
        if not setting:
            return None
        policy = GuardPolicy() if setting is True else GuardPolicy.model_validate(setting)
        return cls(owner, policy)

    @property
    def idle(self) -> bool:
        """Nothing left to flush or fetch. Open breakers do not count: their deadlines only
        decide when a state change is logged."""
        return not self.coalescers and self.mail_due is None

    def channel(self, peer: str) -> ChannelBreaker:
        if peer not in self.channels:
            policy = self.policy.channel
            name = "channel:" + "|".join(sorted((self.owner, peer)))
            self.channels[peer] = ChannelBreaker(
                name=name,
                open_ms=policy.half_open_after_ms,
                probe_ms=policy.window_ms,
                policy=policy,
            )
        return self.channels[peer]

    def storm(self, topic: str) -> StormBreaker:
        if topic not in self.storms:
            policy = self.policy.storm
            self.storms[topic] = StormBreaker(
                name=f"topic:{topic}",
                open_ms=policy.half_open_after_ms,
                probe_ms=policy.window_ms,
                topic=topic,
                policy=policy,
            )
        return self.storms[topic]

    # -- messages ---------------------------------------------------------------------

    def route_out(
        self,
        now: int,
        *,
        peer: str,
        topic: str,
        kind: str,
        lane: Lane,
        payload: dict[str, Any],
        correlation_id: str | None,
        backlog: bool,
    ) -> Routed:
        """What happens to a message this endpoint sends. ``backlog``: critical messages are
        already waiting for their slots, so a new one queues behind them even when closed."""
        if topic in EXEMPT_TOPICS or kind in CONTROL_KINDS:
            return Routed(Route.PASS)
        channel, storm = self.channel(peer), self.storm(topic)
        moves = channel.advance(now) + storm.advance(now)
        size = payload_size(payload)
        if kind != "digest":  # the breaker's own output is not traffic to count
            fact = fingerprint(topic, payload)
            moves += channel.observe(
                now, sender=self.owner, size=size, correlation_id=correlation_id, fact=fact
            )
            moves += storm.observe(now)
        if kind == "msg" and storm.is_open:
            self._coalesce(now, topic, peer, payload, size)
            return Routed(Route.ABSORB, moves=moves)
        if lane == Lane.CRITICAL and (channel.is_open or backlog):
            return Routed(Route.PACE, channel.critical_slot(now), moves)
        if channel.is_open:
            return Routed(Route.DIVERT, moves=moves)
        return Routed(Route.PASS, moves=moves)

    def on_receive(
        self,
        now: int,
        *,
        peer: str,
        topic: str,
        kind: str,
        payload: dict[str, Any],
        correlation_id: str | None,
        from_mail: bool,
    ) -> list[Transition]:
        """A fresh message from ``peer`` reached this endpoint (after dedup)."""
        if topic in EXEMPT_TOPICS or kind in CONTROL_KINDS or kind == "digest":
            return []
        return self.channel(peer).observe(
            now,
            sender=peer,
            size=payload_size(payload),
            correlation_id=correlation_id,
            fact=fingerprint(topic, payload),
            counted=not from_mail,
        )

    def _coalesce(
        self, now: int, topic: str, peer: str, payload: dict[str, Any], size: int
    ) -> None:
        coalescer = self.coalescers.get((topic, peer))
        if coalescer is None:
            coalescer = self.coalescers[(topic, peer)] = Coalescer(
                self.policy.storm.digest_max_items
            )
        coalescer.add(now, payload, size)
        if self.flush_due is None:
            self.flush_due = now + self.policy.storm.digest_every_ms

    # -- time -------------------------------------------------------------------------

    def deadlines(self) -> list[int]:
        """Moments the bus must wake this guard: breaker deadlines, the next digest, the next
        poll (the bus adds its paced messages)."""
        breakers = chain(self.channels.values(), self.storms.values())
        dues = [due for due in (b.due() for b in breakers) if due is not None]
        if self.coalescers and self.flush_due is not None:
            dues.append(self.flush_due)
        if self.mail_due is not None:
            dues.append(self.mail_due)
        return dues

    def tick(self, now: int) -> tuple[list[Transition], list[tuple[str, str, dict[str, Any]]]]:
        """Time-driven transitions, and the digests to send: ``(topic, receiver, payload)``.

        A topic's digests go out every ``digest_every_ms`` while it is open, and the moment
        it is no longer open (it half-opened: what is left must not wait for the probe).
        """
        moves: list[Transition] = []
        for peer in sorted(self.channels):
            moves += self.channels[peer].advance(now)
        for topic in sorted(self.storms):
            moves += self.storms[topic].advance(now)
        flushed: list[tuple[str, str, dict[str, Any]]] = []
        due = self.flush_due is not None and now >= self.flush_due
        for topic, peer in sorted(self.coalescers):
            if due or not self.storm(topic).is_open:
                coalescer = self.coalescers.pop((topic, peer))
                self.digests += 1
                payload = coalescer.build(topic).model_dump(mode="json")
                flushed.append((topic, peer, payload))
        if due:
            self.flush_due = None
        if not self.coalescers:
            self.flush_due = None
        return moves, flushed

    def digest_key(self, topic: str, peer: str) -> str:
        return f"digest:{self.owner}:{topic}:{peer}:{self.digests}"

    def forget_in_flight(self) -> None:
        """A new incarnation: what was being coalesced died with the old one."""
        self.coalescers.clear()
        self.flush_due = None

    # -- the mailbox (receiver side) ----------------------------------------------------

    def on_notify(self, now: int) -> None:
        """The blackboard says mail is waiting: start polling, unless already doing so."""
        if self.mail_due is None:
            self.mail_due = now + self.policy.mail.poll_base_ms
            self.mail_empty = 0
            self.mail_waiting = False

    def poll_now(self, now: int) -> bool:
        """Called when ``mail_due`` has come: should a poll go out? Schedules the next one."""
        mail = self.policy.mail
        if self.mail_due is None or now < self.mail_due:
            return False
        if self.mail_waiting:  # the last poll was never answered
            self.mail_empty += 1
        if self.mail_empty >= mail.poll_idle_rounds:
            self.mail_due, self.mail_waiting = None, False
            return False
        self.mail_waiting = True
        self.mail_due = now + min(mail.poll_base_ms << self.mail_empty, mail.poll_max_ms)
        return True

    def on_mail(self, now: int, count: int, remaining: int) -> None:
        """A poll was answered with ``count`` items, ``remaining`` still in the box."""
        mail = self.policy.mail
        self.mail_waiting = False
        if count:
            self.mail_empty = 0
            if remaining:
                soon = now + mail.poll_base_ms
                self.mail_due = soon if self.mail_due is None else min(self.mail_due, soon)
        else:
            self.mail_empty += 1
            if self.mail_empty >= mail.poll_idle_rounds:
                self.mail_due = None
