"""Membership, failure detection and fencing (spec §5.2).

Two halves:

- ``MembersView`` is a kernel reducer: the members table materialized from the log. Every
  actor reads the same table through ``View.views["members"]``, so every survivor computes
  the same live set. It also judges writes before they enter the log:
  - ``member.dead`` is idempotent by ``(member, incarnation)``: the first one in the log
    wins and increments ``member_epoch``;
  - a verdict from an incarnation that is already dead is fenced;
  - a dead incarnation cannot rejoin; the member must come back with a new incarnation;
  - any event whose payload carries a ``fence`` (a ``FencingToken``) is fenced when its
    writer's incarnation is dead, or when a newer owner has already written the resource.
  A refused write becomes ``write.fenced``.

- ``Detector`` is the per-orchestrator failure detector, embedded in the actor's state.
  Every ``interval_ms`` (1 s of virtual time) it sends a heartbeat over the bus (low lane) to
  the peers it watches, and checks them: ``member.suspected`` after 3 missed heartbeats,
  ``member.dead`` after 5. A detector that hears none of its two or more peers assumes that
  it is the one cut off and issues no verdicts. A member learns that it was declared dead
  from a ``fenced`` notice, which the bus sends back when a peer drops its frame; it then
  rejoins with the next incarnation.
"""

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict

from fractalswarm.comms import bus
from fractalswarm.comms.bus import Delivery, Endpoint
from fractalswarm.comms.topics import HEARTBEAT, Lane
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.scheduler import Admission, Command, Emit, SetTimer, View

TICK_TAG = "member.tick"
MEMBERSHIP_EVENTS = ("member.joined", "member.suspected", "member.dead")


@register("member.joined")
class MemberJoined(Payload):
    member: str
    incarnation: int = 0
    role: str = "coordinator"
    group: str | None = None


@register("member.suspected")
class MemberSuspected(Payload):
    member: str
    incarnation: int
    by: str
    by_incarnation: int
    missed: int


@register("member.dead")
class MemberDead(Payload):
    member: str
    incarnation: int
    by: str
    by_incarnation: int
    missed: int
    last_heard_ms: int


@register("write.fenced")
class WriteFenced(Payload):
    type: str
    actor: str
    reason: str
    fence: dict[str, Any] | None = None
    member: str | None = None


class FencingToken(BaseModel):
    """Carried as ``payload["fence"]`` by owner-scoped writes.

    ``epoch`` is the ``member_epoch`` at which the writer acquired ``resource``. A new owner
    acquires it after the old owner's ``member.dead``, so its epoch is higher, and once it
    has written, the old owner's writes to that resource are fenced.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    member: str
    incarnation: int
    epoch: int
    resource: str | None = None


# -- the members view (a kernel reducer) ------------------------------------------------


@dataclass
class MemberRecord:
    member: str
    role: str
    group: str | None
    incarnation: int
    status: str  # alive | suspected | dead
    since: int


class MembersView:
    name = "members"

    def __init__(self) -> None:
        self.records: dict[str, MemberRecord] = {}
        self.epoch = 0
        self.resources: dict[str, int] = {}  # resource -> newest fencing epoch written

    # -- queries --------------------------------------------------------------------------

    def get(self, member: str) -> MemberRecord | None:
        return self.records.get(member)

    def is_dead(self, member: str, incarnation: int) -> bool:
        """Is this incarnation of the member dead (or superseded by a newer one)?"""
        record = self.records.get(member)
        if record is None:
            return False
        if incarnation < record.incarnation:
            return True
        return incarnation == record.incarnation and record.status == "dead"

    def is_gone(self, member: str) -> bool:
        record = self.records.get(member)
        return record is not None and record.status == "dead"

    def alive(self, role: str | None = None, group: str | None = None) -> list[str]:
        return sorted(
            record.member
            for record in self.records.values()
            if record.status != "dead"
            and (role is None or record.role == role)
            and (group is None or record.group == group)
        )

    def stale(self, token: FencingToken) -> str | None:
        """Why a write with this token must be fenced, or ``None``."""
        if self.is_dead(token.member, token.incarnation):
            return "the writer's incarnation is dead"
        if token.resource is not None and token.epoch < self.resources.get(token.resource, -1):
            return "a newer owner has already written this resource"
        return None

    # -- the reducer ----------------------------------------------------------------------

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> Admission | None:
        if event_type == "member.joined":
            return self._admit_join(actor, payload)
        if event_type in ("member.suspected", "member.dead"):
            if self.is_dead(payload["by"], payload["by_incarnation"]):
                return _fenced(actor, event_type, "a verdict from a dead incarnation", payload)
            record = self.records.get(payload["member"])
            if (
                record is None
                or record.incarnation != payload["incarnation"]
                or record.status == "dead"
            ):
                return Admission(accept=False)  # stale or already decided: first one wins
            return Admission(bump_member_epoch=event_type == "member.dead")
        fence = payload.get("fence")
        if isinstance(fence, dict):
            reason = self.stale(FencingToken.model_validate(fence))
            if reason is not None:
                return _fenced(actor, event_type, reason, payload, fence)
        return None

    def _admit_join(self, actor: str, payload: dict[str, Any]) -> Admission:
        record = self.records.get(payload["member"])
        incarnation = payload.get("incarnation", 0)
        if record is None or incarnation > record.incarnation:
            return Admission(bump_member_epoch=True)
        if incarnation == record.incarnation and record.status != "dead":
            return Admission(accept=False)  # already joined
        return _fenced(actor, "member.joined", "a dead incarnation cannot rejoin", payload)

    def apply(self, event: Event) -> None:
        payload = event.payload
        if event.type == "member.joined":
            self.records[payload["member"]] = MemberRecord(
                member=payload["member"],
                role=payload["role"],
                group=payload["group"],
                incarnation=payload["incarnation"],
                status="alive",
                since=event.ts_virtual,
            )
            self.epoch += 1
        elif event.type == "member.suspected":
            record = self.records[payload["member"]]
            if record.status == "alive":
                record.status = "suspected"
        elif event.type == "member.dead":
            record = self.records[payload["member"]]
            record.status = "dead"
            record.since = event.ts_virtual
            self.epoch += 1
        elif event.type != "write.fenced" and isinstance(payload.get("fence"), dict):
            token = FencingToken.model_validate(payload["fence"])
            if token.resource is not None:
                newest = self.resources.get(token.resource, -1)
                self.resources[token.resource] = max(newest, token.epoch)


def _fenced(
    actor: str,
    event_type: str,
    reason: str,
    payload: dict[str, Any],
    fence: dict[str, Any] | None = None,
) -> Admission:
    member = payload.get("member") or (fence or {}).get("member")
    fenced = {"type": event_type, "actor": actor, "reason": reason, "fence": fence}
    return Admission(accept=False, instead=("write.fenced", fenced | {"member": member}))


# -- the failure detector (embedded in an orchestrator) ---------------------------------


@dataclass
class Peer:
    incarnation: int
    last_heard: int
    status: str = "alive"  # alive | suspected | dead
    episode: int = 0  # suspicion episodes, for idempotency keys
    load: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Change:
    """A membership change seen by this detector. ``member`` is this actor for
    ``rejoined``, ``isolated`` and ``connected``."""

    member: str
    status: str  # suspected | dead | alive | rejoined | isolated | connected
    incarnation: int


@dataclass
class Detector:
    member: str
    role: str = "coordinator"
    group: str | None = None
    incarnation: int = 0
    interval_ms: int = 1000
    suspect_after: int = 3
    dead_after: int = 5
    peers: dict[str, Peer] = field(default_factory=dict)
    load: dict[str, Any] = field(default_factory=dict)  # gossiped in heartbeats
    isolated: bool = False
    stopped: bool = False


@dataclass
class MembershipOutcome:
    changes: list[Change] = field(default_factory=list)
    commands: list[Command] = field(default_factory=list)
    deliveries: list[Delivery] = field(default_factory=list)  # for the actor itself


def token(det: Detector, epoch: int, resource: str | None = None) -> dict[str, Any]:
    """The fencing token for a write by this member (``epoch``: when it acquired it)."""
    return FencingToken(
        member=det.member, incarnation=det.incarnation, epoch=epoch, resource=resource
    ).model_dump(mode="json")


def join(det: Detector, view: View, peers: list[str] | tuple[str, ...] = ()) -> list[Command]:
    """Announce this member (``member.joined``) and start heartbeating."""
    watch(det, peers, view.now)
    joined = {
        "member": det.member,
        "incarnation": det.incarnation,
        "role": det.role,
        "group": det.group,
    }
    return [
        Emit(
            type="member.joined",
            payload=joined,
            idem_key=f"member.joined:{det.member}:{det.incarnation}",
        ),
        SetTimer(delay_ms=det.interval_ms, tag=TICK_TAG),
    ]


def watch(det: Detector, peers: list[str] | tuple[str, ...], now: int) -> None:
    """Set the peers this detector watches (siblings, parent and children)."""
    kept = {name: det.peers[name] for name in sorted(peers) if name in det.peers}
    for name in sorted(peers):
        if name != det.member and name not in kept:
            kept[name] = Peer(incarnation=0, last_heard=now)
    det.peers = kept


def stop(det: Detector) -> None:
    """Stop heartbeating (the next tick does not re-arm)."""
    det.stopped = True


def handle(det: Detector, ep: Endpoint, event: Event, view: View) -> MembershipOutcome | None:
    """Run an event through the detector and the bus; ``None`` if it concerns neither.

    Heartbeats and fenced notices are consumed here; other bus deliveries are returned in
    ``deliveries`` for the actor.
    """
    if event.type == "effect.completed" and event.payload["tag"] == TICK_TAG:
        return tick(det, ep, view)
    bus_out = bus.handle(ep, event, view)
    if bus_out is None:
        return None
    out = MembershipOutcome(commands=list(bus_out.commands))
    for delivery in bus_out.deliveries:
        if delivery.kind == "fenced":
            more = rejoin(det, ep, view)
            out.changes += more.changes
            out.commands += more.commands
        elif delivery.kind == "msg" and delivery.topic == HEARTBEAT.name:
            out.changes += heard(det, delivery, view.now)
        else:
            out.deliveries.append(delivery)
    return out


def heard(det: Detector, delivery: Delivery, now: int) -> list[Change]:
    peer = det.peers.get(delivery.sender)
    incarnation = delivery.envelope.incarnation if delivery.envelope else 0
    if peer is None or incarnation < peer.incarnation:
        return []
    changes: list[Change] = []
    if incarnation > peer.incarnation:
        peer.incarnation = incarnation
        peer.status = "alive"
        changes.append(Change(delivery.sender, "alive", incarnation))
    elif peer.status == "dead":
        return []
    elif peer.status == "suspected":
        peer.status = "alive"
        changes.append(Change(delivery.sender, "alive", incarnation))
    peer.last_heard = now
    peer.load = dict(delivery.payload.get("load") or {})
    if det.isolated:
        det.isolated = False
        changes.append(Change(det.member, "connected", det.incarnation))
    return changes


def tick(det: Detector, ep: Endpoint, view: View) -> MembershipOutcome:
    out = MembershipOutcome()
    if det.stopped:
        return out
    now = view.now
    out.changes += sync(det, view)

    for name, peer in det.peers.items():
        if peer.status != "dead":
            beat = {"member": det.member, "incarnation": det.incarnation, "load": det.load}
            out.commands += bus.send(ep, view, name, HEARTBEAT.name, beat, lane=Lane.LOW)

    watched = [name for name, peer in det.peers.items() if peer.status != "dead"]
    missed = {name: (now - det.peers[name].last_heard) // det.interval_ms for name in watched}
    isolated = len(watched) >= 2 and all(missed[name] >= det.suspect_after for name in watched)
    if isolated != det.isolated:
        det.isolated = isolated
        status = "isolated" if isolated else "connected"
        out.changes.append(Change(det.member, status, det.incarnation))

    if not isolated:
        for name in watched:
            out.commands += _judge(det, name, missed[name], out.changes)

    out.commands.append(SetTimer(delay_ms=det.interval_ms, tag=TICK_TAG))
    return out


def _judge(det: Detector, name: str, missed: int, changes: list[Change]) -> list[Command]:
    peer = det.peers[name]
    verdict = {
        "member": name,
        "incarnation": peer.incarnation,
        "by": det.member,
        "by_incarnation": det.incarnation,
        "missed": missed,
    }
    if missed >= det.dead_after:
        peer.status = "dead"
        changes.append(Change(name, "dead", peer.incarnation))
        return [
            Emit(
                type="member.dead",
                payload=verdict | {"last_heard_ms": peer.last_heard},
                idem_key=f"member.dead:{name}:{peer.incarnation}",
            )
        ]
    if missed >= det.suspect_after and peer.status == "alive":
        peer.status = "suspected"
        peer.episode += 1
        changes.append(Change(name, "suspected", peer.incarnation))
        key = f"member.suspected:{name}:{peer.incarnation}:{det.member}:{peer.episode}"
        return [Emit(type="member.suspected", payload=verdict, idem_key=key)]
    return []


def sync(det: Detector, view: View) -> list[Change]:
    """Adopt what the log already decided: the first ``member.dead`` in the log wins, and a
    verdict of ours that never entered the log (we were a dead incarnation, so it was
    fenced) is withdrawn: the peer is alive again, with a fresh grace period."""
    members = view.views.get("members")
    if members is None:
        return []
    changes: list[Change] = []
    for name, peer in det.peers.items():
        record = members.get(name)
        if record is None:
            continue
        if record.incarnation > peer.incarnation and record.status != "dead":
            peer.incarnation = record.incarnation
            peer.status = "alive"
            peer.last_heard = max(peer.last_heard, record.since)
            changes.append(Change(name, "alive", record.incarnation))
        elif (
            record.incarnation == peer.incarnation
            and record.status != "dead"
            and (peer.status == "dead")
        ):
            peer.status = "alive"
            peer.last_heard = view.now
            changes.append(Change(name, "alive", record.incarnation))
        elif (
            record.incarnation >= peer.incarnation
            and record.status == "dead"
            and peer.status != "dead"
        ):
            peer.incarnation = record.incarnation
            peer.status = "dead"
            changes.append(Change(name, "dead", record.incarnation))
    return changes


def rejoin(det: Detector, ep: Endpoint, view: View) -> MembershipOutcome:
    """Come back from being declared dead, as the next incarnation."""
    det.incarnation += 1
    bus.reset(ep, det.incarnation)
    for peer in det.peers.values():
        peer.last_heard = view.now
    det.isolated = False
    joined = {
        "member": det.member,
        "incarnation": det.incarnation,
        "role": det.role,
        "group": det.group,
    }
    return MembershipOutcome(
        changes=[Change(det.member, "rejoined", det.incarnation)],
        commands=[
            Emit(
                type="member.joined",
                payload=joined,
                idem_key=f"member.joined:{det.member}:{det.incarnation}",
            )
        ],
    )
