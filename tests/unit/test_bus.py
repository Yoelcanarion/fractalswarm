"""The bus (spec §5.4): at-least-once critical lane, dedup, causal order, request/reply, fencing.

Endpoints are driven directly, without the kernel: the tests play the network, which may
drop, duplicate and reorder frames, and advance virtual time in 250 ms steps.
"""

import random
from dataclasses import dataclass, field

from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.comms import bus
from fractalswarm.comms.bus import BusPolicy, Delivery, Endpoint, Envelope
from fractalswarm.comms.topics import Lane
from fractalswarm.coord.membership import MemberRecord, MembersView
from fractalswarm.kernel.scheduler import Command, Send, SetTimer, View

STEP_MS = 250


def view(actor: str, now: int = 0, lamport: int = 0, members: MembersView | None = None) -> View:
    views = {} if members is None else {"members": members}
    return View(
        run_id="r", seed="s", actor_id=actor, now=now, lamport=lamport, alive=(), views=views
    )


def frames(commands: list[Command]) -> list[Envelope]:
    return [
        Envelope.model_validate(c.body[bus.ENVELOPE_KEY]) for c in commands if isinstance(c, Send)
    ]


@dataclass
class Net:
    """A lossy network between endpoints, decided by a seeded RNG."""

    endpoints: dict[str, Endpoint]
    rng: random.Random
    drop: float = 0.0
    duplicate: float = 0.0
    lossy_until: int = 10**9  # stop losing frames after this time, so the run converges
    now: int = 0
    flight: list[Envelope] = field(default_factory=list)
    delivered: dict[str, list[Delivery]] = field(default_factory=dict)

    def put(self, commands: list[Command]) -> None:
        self.flight += frames(commands)

    def round(self) -> None:
        batch, self.flight = self.flight, []
        self.rng.shuffle(batch)
        for env in batch:
            lossy = self.now < self.lossy_until
            if lossy and self.rng.random() < self.drop:
                continue
            copies = 2 if lossy and self.rng.random() < self.duplicate else 1
            for _ in range(copies):
                out = bus.on_frame(self.endpoints[env.to], env, view(env.to, self.now))
                self.delivered.setdefault(env.to, []).extend(out.deliveries)
                self.put(out.commands)
        self.now += STEP_MS
        for name in sorted(self.endpoints):
            out = bus.on_tick(self.endpoints[name], view(name, self.now))
            self.delivered.setdefault(name, []).extend(out.deliveries)
            self.put(out.commands)

    def run(self, rounds: int = 400) -> None:
        for _ in range(rounds):
            if not self.flight and all(ep.idle for ep in self.endpoints.values()):
                return
            self.round()


def payloads(deliveries: list[Delivery], kind: str = "msg") -> list[dict]:
    return [d.payload for d in deliveries if d.kind == kind]


@settings(max_examples=60, deadline=None)
@given(
    count=st.integers(1, 12),
    drop=st.floats(0, 0.6),
    duplicate=st.floats(0, 0.5),
    seed=st.integers(0, 2**32),
)
def test_critical_lane_is_at_least_once_deduplicated_and_in_order(
    count: int, drop: float, duplicate: float, seed: int
) -> None:
    policy = BusPolicy(max_attempts=50, hold_ms=10**9)  # only causality may release a message
    a, b = Endpoint("a", policy=policy), Endpoint("b", policy=policy)
    net = Net({"a": a, "b": b}, random.Random(seed), drop, duplicate, lossy_until=20_000)
    for n in range(count):
        net.put(bus.send(a, view("a", 0, lamport=n), "b", "artifact.ready", {"n": n}))
    net.run()

    assert payloads(net.delivered.get("b", [])) == [{"n": n} for n in range(count)]
    assert a.idle and b.idle
    assert a.stats.get("given_up", 0) == 0


@settings(max_examples=40, deadline=None)
@given(seed=st.integers(0, 2**32), copies=st.integers(2, 4))
def test_one_idem_key_is_applied_once_whoever_sends_it(seed: int, copies: int) -> None:
    receiver = Endpoint("b")
    senders = [Endpoint(f"s{n}") for n in range(copies)]
    net = Net({"b": receiver, **{s.owner: s for s in senders}}, random.Random(seed), duplicate=0.5)
    for sender in senders:
        net.put(
            bus.send(sender, view(sender.owner), "b", "artifact.ready", {"k": 1}, idem_key="k1")
        )
    net.run()
    assert payloads(net.delivered["b"]) == [{"k": 1}]


def test_normal_and_low_lanes_are_at_most_once() -> None:
    a = Endpoint("a")
    commands = bus.send(a, view("a"), "b", "budget.epoch", {"x": 1})
    assert [type(c) for c in commands] == [Send] and a.idle
    commands = bus.send(a, view("a"), "b", "member.heartbeat", {})
    assert frames(commands)[0].lane == Lane.LOW and a.idle


def test_a_message_waits_for_its_dependency_or_for_the_hold_to_expire() -> None:
    a, b = Endpoint("a"), Endpoint("b", policy=BusPolicy(hold_ms=2000))
    first = frames(bus.send(a, view("a"), "b", "fact.verified", {"n": 1}))[0]
    second = frames(bus.send(a, view("a"), "b", "fact.verified", {"n": 2}))[0]
    assert second.deps == (first.id,)

    out = bus.on_frame(b, second, view("b", 0))
    assert out.deliveries == [] and any(isinstance(c, SetTimer) for c in out.commands)
    out = bus.on_frame(b, first, view("b", 100))
    assert payloads(out.deliveries) == [{"n": 1}, {"n": 2}]

    # A dependency that never arrives: the message is released when the hold expires.
    third = frames(bus.send(a, view("a"), "b", "fact.verified", {"n": 3}, deps=["lost"]))[0]
    assert bus.on_frame(b, third, view("b", 200)).deliveries == []
    assert bus.on_tick(b, view("b", 2199)).deliveries == []
    assert payloads(bus.on_tick(b, view("b", 2200)).deliveries) == [{"n": 3}]
    assert b.stats["released_without_deps"] == 1


def test_messages_that_become_ready_together_are_applied_in_lamport_order() -> None:
    b = Endpoint("b")
    senders = {name: Endpoint(name) for name in ("x", "y", "z")}
    held = []
    for name, lamport in (("x", 9), ("y", 3), ("z", 5)):
        env = frames(
            bus.send(
                senders[name], view(name, lamport=lamport), "b", "t", {"from": name}, deps=["gate"]
            )
        )[0]
        held.append(env)
        assert bus.on_frame(b, env, view("b")).deliveries == []
    gate = frames(bus.send(Endpoint("g"), view("g"), "b", "t", {"from": "g"}, idem_key="gate"))[0]
    gate = gate.model_copy(update={"id": "gate"})
    released = bus.on_frame(b, gate, view("b", 10)).deliveries
    assert [d.payload["from"] for d in released] == ["g", "y", "z", "x"]


def test_request_reply_and_timeout() -> None:
    a, b = Endpoint("a"), Endpoint("b")
    correlation, commands = bus.request(
        a, view("a"), "b", "audit.request", {"q": 1}, timeout_ms=1000
    )
    request = bus.on_frame(b, frames(commands)[0], view("b", 10)).deliveries[0]
    assert request.kind == "request" and request.correlation_id == correlation

    reply = frames(bus.reply(b, view("b", 20), request, {"a": 2}))[0]
    got = bus.on_frame(a, reply, view("a", 30)).deliveries
    assert [(d.kind, d.payload, d.correlation_id) for d in got] == [
        ("reply", {"a": 2}, correlation)
    ]

    lost, _ = bus.request(a, view("a", 100), "b", "audit.request", {}, timeout_ms=1000)
    timeouts = [d for d in bus.on_tick(a, view("a", 1100)).deliveries if d.kind == "timeout"]
    assert [d.correlation_id for d in timeouts] == [lost]
    # A reply after the timeout is dropped.
    late = reply.model_copy(update={"id": "b#0:99", "correlation_id": lost, "deps": ()})
    assert bus.on_frame(a, late, view("a", 1200)).deliveries == []


def test_publish_reaches_every_subscriber_but_the_publisher() -> None:
    hub = Endpoint("hub")
    for name in ("s2", "s1", "hub"):
        bus.add_subscriber(hub, "artifact.ready", name)
    sent = frames(bus.publish(hub, view("hub"), "artifact.ready", {"x": 1}))
    assert [env.to for env in sent] == ["s1", "s2"]

    s3 = Endpoint("s3")
    request = frames(bus.subscribe(s3, view("s3"), "artifact.ready", ["hub"]))[0]
    bus.on_frame(hub, request, view("hub"))
    assert hub.subscribers["artifact.ready"] == ["hub", "s1", "s2", "s3"]


def members_with(member: str, incarnation: int, status: str) -> MembersView:
    view_ = MembersView()
    view_.records[member] = MemberRecord(member, "coordinator", None, incarnation, status, 0)
    return view_


def test_frames_from_a_dead_incarnation_are_fenced() -> None:
    zombie, b = Endpoint("z"), Endpoint("b")
    env = frames(bus.send(zombie, view("z"), "b", "fact.verified", {"stale": True}))[0]
    out = bus.on_frame(b, env, view("b", 10, members=members_with("z", 0, "dead")))
    assert out.deliveries == []
    notice = frames(out.commands)[0]
    assert notice.kind == "fenced" and notice.to == "z"
    fenced = bus.on_frame(zombie, notice, view("z", 20)).deliveries
    assert [d.kind for d in fenced] == ["fenced"]

    # After a rejoin the old notice is ignored, and the new incarnation gets through.
    bus.reset(zombie, 1)
    assert bus.on_frame(zombie, notice, view("z", 30)).deliveries == []
    fresh = frames(bus.send(zombie, view("z"), "b", "fact.verified", {"stale": False}))[0]
    got = bus.on_frame(b, fresh, view("b", 40, members=members_with("z", 1, "alive")))
    assert payloads(got.deliveries) == [{"stale": False}]
    # And a frame of the superseded incarnation is now stale.
    assert bus.on_frame(b, env, view("b", 50)).deliveries == []


def test_the_bus_gives_up_on_a_dead_receiver() -> None:
    a = Endpoint("a")
    bus.send(a, view("a"), "b", "artifact.ready", {"x": 1})
    out = bus.on_tick(a, view("a", 1000, members=members_with("b", 0, "dead")))
    assert [d.kind for d in out.deliveries] == ["undeliverable"] and a.idle


def test_resends_back_off_exponentially_until_max_attempts() -> None:
    policy = BusPolicy(retry_base_ms=100, retry_max_ms=400, max_attempts=4)
    a = Endpoint("a", policy=policy)
    bus.send(a, view("a"), "b", "artifact.ready", {})
    now, resent_at = 0, []
    while not a.idle:
        now += 50
        out = bus.on_tick(a, view("a", now))
        if frames(out.commands):
            resent_at.append(now)
        gave_up = [d for d in out.deliveries if d.kind == "undeliverable"]
    assert resent_at == [100, 300, 700]  # 100, then +200, then +400 (capped)
    assert len(gave_up) == 1 and a.stats["given_up"] == 1


def test_expired_messages_are_not_delivered() -> None:
    a, b = Endpoint("a"), Endpoint("b")
    env = frames(bus.send(a, view("a"), "b", "budget.epoch", {}, ttl_ms=100))[0]
    assert bus.on_frame(b, env, view("b", 100)).deliveries == []
    assert b.stats["expired"] == 1
