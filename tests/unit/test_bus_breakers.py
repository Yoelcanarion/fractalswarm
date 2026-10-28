"""The breakers inside the bus (spec §5.4, §8): routing of sends, pacing, digests, the mailbox.

Endpoints are driven directly, as in ``test_bus.py``. The blackboard actor's side of the
mailbox is exercised through its real handler in ``tests/integration/test_breakers_replay.py``.
"""

from typing import Any

from fractalswarm.comms import bus
from fractalswarm.comms.bus import Endpoint, Envelope
from fractalswarm.comms.channel_breakers import Coalescer, Guard
from fractalswarm.comms.mailbox import MAIL_ITEMS, MAIL_NOTIFY, MAIL_POLL, MAIL_PUT
from fractalswarm.comms.topics import Lane
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Emit, Send, SetTimer, View

S = 1000


def view(actor: str, now: int = 0, lamport: int = 0) -> View:
    return View(run_id="r", seed="s", actor_id=actor, now=now, lamport=lamport, alive=())


def wired(commands: list[Command]) -> list[Envelope]:
    return [
        Envelope.model_validate(c.body[bus.ENVELOPE_KEY])
        for c in commands
        if isinstance(c, Send) and bus.ENVELOPE_KEY in c.body
    ]


def mailed(commands: list[Command]) -> list[Send]:
    return [c for c in commands if isinstance(c, Send) and c.topic == MAIL_PUT]


def emitted(commands: list[Command]) -> list[str]:
    return [c.type for c in commands if isinstance(c, Emit)]


def mail_event(topic: str, body: dict[str, Any], now: int = 0) -> Event:
    return Event(
        seq=1,
        run_id="r",
        ts_virtual=now,
        lamport=1,
        type="msg.sent",
        actor="board",
        idem_key="k",
        payload={"to": "b", "topic": topic, "body": body},
        prev_hash="0",
        hash="0",
    )


def tick_event(now: int) -> Event:
    return Event(
        seq=1,
        run_id="r",
        ts_virtual=now,
        lamport=1,
        type="effect.completed",
        actor="@env",
        idem_key="t",
        payload={
            "effect_id": "e",
            "kind": "timer",
            "status": "ok",
            "result": {},
            "tag": bus.TICK_TAG,
        },
        prev_hash="0",
        hash="0",
    )


def guarded(owner: str = "a", setting: Any = True) -> Endpoint:
    return Endpoint(owner, guard=Guard.create(owner, setting))


def burst(
    ep: Endpoint, count: int, *, start: int = 0, step: int = 10, topic: str = "chat", lane=None
) -> list[Command]:
    """``count`` sends to ``b``, ``step`` ms apart; every command they produced."""
    commands: list[Command] = []
    for n in range(count):
        now = start + n * step
        commands += bus.send(ep, view(ep.owner, now), "b", topic, {"n": n}, lane=lane)
    return commands


# -- without a guard, or below its thresholds, nothing changes ----------------------------


def test_a_guard_that_never_trips_leaves_every_command_as_it_was() -> None:
    plain, watched = Endpoint("a"), guarded()
    for n in range(20):
        lane = Lane.CRITICAL if n % 3 == 0 else None
        topic = "artifact.ready" if n % 3 == 0 else f"t{n}"
        one = bus.send(plain, view("a", n * 100), "b", topic, {"n": n}, lane=lane)
        two = bus.send(watched, view("a", n * 100), "b", topic, {"n": n}, lane=lane)
        assert one == two
    assert plain.stats == watched.stats and plain.unacked.keys() == watched.unacked.keys()


# -- an open channel ----------------------------------------------------------------------


def test_the_21st_message_opens_the_channel_and_it_and_the_rest_go_to_the_mailbox() -> None:
    ep = guarded()
    first = burst(ep, 20)
    assert len(wired(first)) == 20 and emitted(first) == []

    trip = bus.send(ep, view("a", 200), "b", "chat", {"n": 20})
    assert emitted(trip) == ["breaker.opened"] and wired(trip) == []
    (put,) = mailed(trip)
    assert put.to == "board" and put.body["to"] == "b"
    env = Envelope.model_validate(put.body["env"])
    assert (env.sender, env.to, env.topic, env.payload) == ("a", "b", "chat", {"n": 20})
    assert ep.stats["diverted"] == 1

    more = bus.send(ep, view("a", 300), "b", "chat", {"n": 21}, lane=Lane.LOW)
    assert wired(more) == [] and len(mailed(more)) == 1 and emitted(more) == []


def test_the_critical_lane_keeps_passing_one_message_a_second_in_order() -> None:
    ep = guarded()
    burst(ep, 21)  # open
    sent = [bus.send(ep, view("a", 500), "b", "fact.verified", {"n": n}) for n in range(4)]
    assert [len(wired(c)) for c in sent] == [1, 0, 0, 0]  # the first slot is free: now
    assert [pending.due for pending in ep.paced] == [1500, 2500, 3500]
    assert not ep.idle and mailed(sum(sent, [])) == []

    released: list[Envelope] = []
    for now in (1499, 1500, 2499, 2500, 3500):
        out = bus.on_tick(ep, view("a", now))
        released += [e for e in wired(out.commands) if e.attempt == 0]  # not the resends
    assert [e.payload["n"] for e in released] == [1, 2, 3]
    # The FIFO chain of the critical lane is intact: each depends on the one before it.
    chain = [wired(c)[0] for c in sent[:1]] + released
    assert [e.deps for e in chain[1:]] == [(chain[0].id,), (chain[1].id,), (chain[2].id,)]
    assert ep.paced == []


def test_paced_messages_are_acked_and_resent_like_any_critical_message() -> None:
    ep = guarded()
    burst(ep, 21)
    bus.send(ep, view("a", 500), "b", "fact.verified", {"n": 0})
    bus.send(ep, view("a", 500), "b", "fact.verified", {"n": 1})
    out = bus.on_tick(ep, view("a", 1500))
    (released,) = [e for e in wired(out.commands) if e.attempt == 0]
    assert released.id in ep.unacked  # only now does it wait for its ack
    ack = Envelope(
        id="b#0:1",
        n=1,
        kind="ack",
        sender="b",
        to="a",
        topic="bus.ack",
        idem_key="x",
        correlation_id=released.id,
    )
    bus.on_frame(ep, ack, view("a", 1600))
    assert released.id not in ep.unacked


def test_a_backlog_toward_one_peer_queues_only_that_peers_critical_messages() -> None:
    ep = guarded()
    burst(ep, 21)  # opens the channel to b, at 200 ms
    for n in range(3):
        bus.send(ep, view("a", 500), "b", "fact.verified", {"n": n})  # b's slots: 500, 1500, 2500
    assert [pending.due for pending in ep.paced] == [1500, 2500]

    elsewhere = bus.send(ep, view("a", 600), "c", "fact.verified", {"n": 9})
    assert len(wired(elsewhere)) == 1  # c is quiet and has no backlog: it does not wait for b's
    assert [pending.due for pending in ep.paced] == [1500, 2500]

    # Toward b the order holds even after its channel has half-opened, until the line is empty.
    late = bus.send(ep, view("a", 16 * S), "b", "fact.verified", {"n": 3})
    assert wired(late) == [] and emitted(late) == ["breaker.half_open"]
    assert [pending.envelope.payload["n"] for pending in ep.paced] == [1, 2, 3]


def test_requests_and_replies_are_paced_not_diverted() -> None:
    ep = guarded()
    burst(ep, 21)
    first_id, first = bus.request(ep, view("a", 500), "b", "audit.request", {"q": 1})
    second_id, second = bus.request(ep, view("a", 500), "b", "audit.request", {"q": 2})
    assert len(wired(first)) == 1 and wired(second) == [] and mailed(second) == []
    assert [p.envelope.id for p in ep.paced] == [second_id] and first_id != second_id
    assert second_id in ep.requests  # its timeout is already running


def test_heartbeats_and_acks_are_never_held_back_and_never_counted() -> None:
    ep = guarded()
    burst(ep, 21)  # open
    beat = bus.send(ep, view("a", 400), "b", "member.heartbeat", {}, lane=Lane.LOW)
    assert len(wired(beat)) == 1 and mailed(beat) == []
    for n in range(100):
        bus.send(ep, view("a", 400 + n), "c", "member.heartbeat", {}, lane=Lane.LOW)
    assert set(ep.guard.channels) == {"b"}  # heartbeats to c did not even start a breaker for it


def test_timer_jitter_must_not_push_a_track_leads_heartbeats_over_the_storm_threshold() -> None:
    """A track lead beats 5 peers (parent, 2 siblings, 2 children) every second: exactly 50 frames
    in any 10 s of exact virtual time, the threshold itself. A live clock that fires a tick a
    millisecond early puts 55 in the window, so a counted heartbeat would trip a healthy cluster."""
    lead = guarded("o1")
    peers = ["o0", "o2", "o3", "o1.1", "o1.2"]
    for tick in range(40):
        now = tick * 999  # every tick 1 ms early: 11 of them fall inside one 10 s window
        for peer in peers:
            out = bus.send(lead, view("o1", now), peer, "member.heartbeat", {}, lane=Lane.LOW)
            assert len(wired(out)) == 1 and emitted(out) == []
    assert lead.guard.storms == {} and lead.guard.channels == {}


def test_it_recovers_by_itself_when_a_timer_fires_after_the_15_seconds() -> None:
    ep = guarded()
    commands = burst(ep, 21)
    arms = [c for c in commands if isinstance(c, SetTimer)]
    assert [c.delay_ms for c in arms] == [15 * S]  # armed for the half-open, at the 21st message
    out = bus.on_tick(ep, view("a", 200 + 15 * S))
    assert emitted(out.commands) == ["breaker.half_open"]
    out = bus.on_tick(ep, view("a", 200 + 25 * S))
    assert emitted(out.commands) == ["breaker.closed"]
    after = bus.send(ep, view("a", 200 + 26 * S), "b", "chat", {"n": 99})
    assert len(wired(after)) == 1 and mailed(after) == []


# -- the receiver's side of a ping-pong ---------------------------------------------------


def test_a_ping_pong_opens_where_the_6th_alternation_is_seen_and_the_other_end_pulls() -> None:
    a, b = guarded("a"), guarded("b")
    reasons: dict[str, list[str]] = {"a": [], "b": []}
    diverted: list[Send] = []
    for n in range(7):  # the same question, back and forth on one correlation id
        who, peer = ("a", "b") if n % 2 == 0 else ("b", "a")
        sender, receiver = (a, b) if who == "a" else (b, a)
        said = {"q": "agree?"}
        out = bus.send(sender, view(who, n * 100), peer, "negotiate", said, correlation_id="c")
        reasons[who] += [c.payload["reason"] for c in out if isinstance(c, Emit)]
        diverted += mailed(out)
        for env in wired(out):
            got = bus.on_frame(receiver, env, view(peer, n * 100))
            reasons[peer] += [c.payload["reason"] for c in got.commands if isinstance(c, Emit)]
    reason = "ping-pong: 6 alternations on c with no new fact"
    assert reasons == {"a": [reason], "b": []}  # a sent the 7th message: its 6th alternation
    assert a.guard.channels["b"].state == "open" and b.guard.channels["a"].state == "closed"
    (put,) = diverted  # the message that did it was diverted, so b has not seen it yet

    items = {"items": [put.body["env"]], "more": 0}
    out = bus.handle(b, mail_event(MAIL_ITEMS, items, 700), view("b", 700))
    assert out is not None and [
        c.payload["reason"] for c in out.commands if isinstance(c, Emit)
    ] == [reason]
    assert b.guard.channels["a"].window.count == 0  # pulled mail is not counted for the rate


# -- digests ------------------------------------------------------------------------------


def test_a_topic_storm_is_coalesced_per_subscriber_and_the_digest_is_delivered_as_one() -> None:
    pub = guarded("pub")
    subscribers = {name: Endpoint(name) for name in ("s0", "s1", "s2", "s3")}
    for name in subscribers:
        bus.add_subscriber(pub, "budget.epoch", name)
    wire: list[Envelope] = []
    for n in range(15):  # 4 copies each: 60 frames in 15 * 20 ms
        wire += wired(bus.publish(pub, view("pub", n * 20), "budget.epoch", {"epoch": n % 3}))
    assert len(wire) == 50  # the 51st frame opened the topic breaker; the rest are absorbed
    assert pub.stats["coalesced"] == 10 and pub.guard.storms["budget.epoch"].state == "open"

    out = bus.on_tick(pub, view("pub", 14 * 20 + 1000))
    digests = wired(out.commands)
    assert sorted((d.to, d.kind, d.lane) for d in digests) == [
        (name, "digest", Lane.NORMAL) for name in sorted(subscribers)
    ]
    assert sum(d.payload["count"] for d in digests) == 10
    assert all(d.idem_key.startswith("digest:pub:budget.epoch:") for d in digests)
    assert len({d.idem_key for d in digests}) == 4

    got = bus.on_frame(subscribers["s0"], next(d for d in digests if d.to == "s0"), view("s0"))
    (delivery,) = got.deliveries
    assert delivery.kind == "digest" and delivery.topic == "budget.epoch"
    # s0 was sent the 14th and the 15th publish after the breaker opened (epochs 1 and 2).
    assert delivery.payload["count"] == 2 and delivery.payload["elided"] == 0
    assert [i["payload"]["epoch"] for i in delivery.payload["items"]] == [1, 2]


def test_a_digest_of_a_critical_topic_is_a_critical_frame_with_its_place_in_the_chain() -> None:
    pub = guarded("pub")
    guard = pub.guard
    sent: list[Envelope] = []
    for n in range(60):
        # a second subscriber name per message keeps every channel quiet; only the topic is hot
        out = bus.send(pub, view("pub", n * 10), f"s{n % 4}", "fact.verified", {"k": n})
        sent += wired(out)
    assert guard.storms["fact.verified"].state == "open" and len(sent) == 50
    out = bus.on_tick(pub, view("pub", 600 + 1000))
    digests = [e for e in wired(out.commands) if e.kind == "digest"]  # not the resends
    assert digests and all(d.lane == Lane.CRITICAL for d in digests)
    for d in digests:
        previous = [e for e in sent if e.to == d.to][-1]
        assert d.deps == (previous.id,)  # in order after the last message that did go out
        assert d.id in pub.unacked  # at-least-once, like the messages it stands in for


# -- the mailbox, receiver side -----------------------------------------------------------


def test_a_notice_starts_the_polling_and_the_items_are_delivered_as_if_they_had_arrived() -> None:
    sender, receiver = guarded("a"), guarded("b")
    envelopes = []
    burst(sender, 20)
    for n in range(3):
        out = bus.send(sender, view("a", 250 + n), "b", "chat", {"n": 100 + n})
        envelopes += [Envelope.model_validate(m.body["env"]) for m in mailed(out)]
    assert len(envelopes) == 3

    out = bus.handle(receiver, mail_event(MAIL_NOTIFY, {"waiting": 3}, now=300), view("b", 300))
    assert out is not None and any(isinstance(c, SetTimer) for c in out.commands)
    assert receiver.guard.mail_due == 550 and not receiver.idle

    out = bus.handle(receiver, tick_event(550), view("b", 550))
    assert out is not None
    (poll,) = [c for c in out.commands if isinstance(c, Send)]
    assert (poll.to, poll.topic) == ("board", MAIL_POLL) and poll.body["batch"] == 16

    items = [e.model_dump(mode="json") for e in envelopes]
    out = bus.handle(
        receiver, mail_event(MAIL_ITEMS, {"items": items, "more": 0}, 560), view("b", 560)
    )
    assert out is not None
    assert [d.payload["n"] for d in out.deliveries] == [100, 101, 102]
    assert receiver.stats["mail_in"] == 3 and receiver.guard.mail_empty == 0
    # The receiver polls on, with backoff, and stops once it finds the box empty three times.
    now = 560
    for _ in range(10):
        if receiver.guard.mail_due is None:
            break
        now = receiver.guard.mail_due
        bus.handle(receiver, tick_event(now), view("b", now))
        bus.handle(receiver, mail_event(MAIL_ITEMS, {"items": [], "more": 0}, now), view("b", now))
    assert receiver.guard.mail_due is None and receiver.idle


def test_mail_is_deduplicated_like_any_other_frame() -> None:
    sender, receiver = guarded("a"), guarded("b")
    burst(sender, 20)
    out = bus.send(sender, view("a", 250), "b", "chat", {"n": 1})
    item = mailed(out)[0].body["env"]
    for _ in range(2):
        bus.handle(receiver, mail_event(MAIL_ITEMS, {"items": [item], "more": 0}), view("b", 300))
    assert receiver.stats["delivered"] == 1 and receiver.stats["duplicate"] == 1


def test_mail_from_a_sender_the_log_calls_dead_is_fenced_not_delivered() -> None:
    receiver = guarded("b")
    burst(sender := guarded("a"), 20)
    item = mailed(bus.send(sender, view("a", 250), "b", "chat", {"n": 1}))[0].body["env"]
    from fractalswarm.coord.membership import MemberRecord, MembersView

    members = MembersView()
    members.records["a"] = MemberRecord("a", "coordinator", None, 0, "dead", 0)
    dead = View("r", "s", "b", 300, 0, (), views={"members": members})
    out = bus.handle(receiver, mail_event(MAIL_ITEMS, {"items": [item], "more": 0}), dead)
    assert out is not None and out.deliveries == []
    assert receiver.stats["fenced"] == 1


# -- a new incarnation --------------------------------------------------------------------


def test_a_new_incarnation_forgets_what_was_paced_or_being_coalesced() -> None:
    ep = guarded()
    burst(ep, 21)
    bus.send(ep, view("a", 500), "b", "fact.verified", {"n": 0})
    bus.send(ep, view("a", 500), "b", "fact.verified", {"n": 1})
    ep.guard.coalescers[("t", "b")] = Coalescer(4)  # a digest in the making
    assert ep.paced
    bus.reset(ep, 1)
    assert ep.paced == [] and ep.guard.coalescers == {}
