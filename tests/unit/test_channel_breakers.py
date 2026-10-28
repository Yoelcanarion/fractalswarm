"""The channel and topic-storm breakers (spec §8): the pure detectors and state machines.

Windows, alternations and the digest are checked against brute-force references on random
traffic; the breaker's recovery and its routing are checked on scripted traffic. Time is
virtual: every ``now`` is a number the test hands in.
"""

import random

import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.comms.channel_breakers import (
    ChannelBreaker,
    ChannelPolicy,
    Coalescer,
    Digest,
    Guard,
    GuardPolicy,
    PingPong,
    Route,
    StormBreaker,
    StormPolicy,
    Window,
)
from fractalswarm.comms.topics import Lane
from fractalswarm.config import CONFIG_DIR
from fractalswarm.planning.taskspec import TaskSpec

S = 1000
POLICY = ChannelPolicy()


def channel(policy: ChannelPolicy = POLICY) -> ChannelBreaker:
    return ChannelBreaker(
        name="channel:a|b",
        open_ms=policy.half_open_after_ms,
        probe_ms=policy.window_ms,
        policy=policy,
    )


def storm(policy: StormPolicy | None = None) -> StormBreaker:
    policy = policy or StormPolicy()
    return StormBreaker(
        name="topic:t",
        open_ms=policy.half_open_after_ms,
        probe_ms=policy.window_ms,
        topic="t",
        policy=policy,
    )


def names(moves: list) -> list[str]:
    return [name for name, _ in moves]


def feed(breaker: ChannelBreaker, now: int, size: int = 10, **kwargs) -> list:
    kwargs = {"sender": "a", "correlation_id": None, "fact": "f"} | kwargs
    return breaker.observe(now, size=size, **kwargs)


# -- the sliding window -------------------------------------------------------------------


@settings(max_examples=100, deadline=None)
@given(
    steps=st.lists(st.tuples(st.integers(0, 4000), st.integers(0, 5000)), max_size=60),
    span=st.integers(1, 12_000),
)
def test_the_window_counts_what_a_brute_force_scan_counts(steps, span) -> None:
    window, history, now = Window(span), [], 0
    for gap, size in steps:
        now += gap
        window.add(now, size)
        history.append((now, size))
        inside = [(at, n) for at, n in history if now - at < span]
        assert window.count == len(inside)
        assert window.size == sum(n for _, n in inside)


# -- rate and size ------------------------------------------------------------------------


@settings(max_examples=150, deadline=None)
@given(
    steps=st.lists(st.tuples(st.integers(0, 2000), st.integers(0, 20_000)), min_size=1, max_size=80)
)
def test_rate_and_size_open_the_breaker_exactly_when_a_scan_says_so(steps) -> None:
    breaker, history, now = channel(), [], 0
    for gap, size in steps:
        now += gap
        history.append((now, size))
        inside = [n for at, n in history if now - at < POLICY.window_ms]
        expected = len(inside) > POLICY.max_msgs or sum(inside) > POLICY.max_bytes
        moves = feed(breaker, now, size)
        assert (names(moves) == ["breaker.opened"]) == expected
        if expected:
            reason = moves[0][1]["reason"]
            assert reason.startswith(f"{len(inside)} msgs") or "bytes" in reason
            break
    else:
        assert breaker.state == "closed"


def test_the_twenty_first_message_in_ten_seconds_opens_it_and_a_slower_stream_does_not() -> None:
    fast = channel()
    for n in range(20):
        assert feed(fast, n * 100) == []
    opened = feed(fast, 2000)
    assert names(opened) == ["breaker.opened"] and opened[0][1]["reason"] == "21 msgs in 10 s"
    assert opened[0][1] == {
        "breaker": "channel:a|b",
        "until_ms": 2000 + 15 * S,
        "trips": 1,
        "reason": "21 msgs in 10 s",
    }

    slow = channel()  # 20 in any 10 s: the 11th second drops the first out of the window
    assert all(feed(slow, n * 500) == [] for n in range(200))


def test_more_than_64_kb_in_ten_seconds_opens_it() -> None:
    breaker = channel()
    assert feed(breaker, 0, 30_000) == [] and feed(breaker, 1000, 30_000) == []
    assert feed(breaker, 2000, 5_536) == []  # exactly 65 536 bytes: not more
    opened = feed(breaker, 3000, 1)
    assert opened[0][1]["reason"] == "65537 bytes in 10 s"


# -- ping-pong ----------------------------------------------------------------------------


def reference_streak(history: list[tuple[str, str]]) -> int:
    """Alternations (a sender other than the previous message's) after the last new fact."""
    seen: set[str] = set()
    last_new = 0
    for index, (_, fact) in enumerate(history):
        if fact not in seen:
            last_new = index
        seen.add(fact)
    return sum(1 for k in range(last_new + 1, len(history)) if history[k][0] != history[k - 1][0])


@settings(max_examples=200, deadline=None)
@given(
    history=st.lists(
        st.tuples(st.sampled_from("abc"), st.sampled_from(["x", "y", "z", "w"])), max_size=40
    )
)
def test_the_streak_is_the_alternations_since_the_last_new_fact(history) -> None:
    detector = PingPong()
    for k, (sender, fact) in enumerate(history):
        assert detector.observe("c", sender, fact) == reference_streak(history[: k + 1])


@settings(max_examples=60, deadline=None)
@given(
    history=st.lists(st.tuples(st.sampled_from("ab"), st.integers(0, 3)), max_size=80),
    conversations=st.integers(1, 4),
)
def test_conversations_are_tracked_apart(history, conversations) -> None:
    detector, per_id = PingPong(), {}
    for k, (sender, fact) in enumerate(history):
        cid = f"c{k % conversations}"
        per_id.setdefault(cid, []).append((sender, str(fact)))
        assert detector.observe(cid, sender, str(fact)) == reference_streak(per_id[cid])


def test_the_conversation_memory_is_bounded() -> None:
    detector = PingPong(max_conversations=3, max_facts=2)
    for n in range(10):
        detector.observe(f"c{n}", "a", "x")
    assert list(detector.conversations) == ["c7", "c8", "c9"]
    for n in range(10):
        detector.observe("c9", "a", f"fact{n}")
    assert len(detector.conversations["c9"].seen) == 2


def test_six_alternations_with_no_new_fact_open_it_and_a_new_fact_restarts_the_count() -> None:
    breaker = channel()
    kwargs = {"correlation_id": "c1", "fact": "same"}
    assert feed(breaker, 0, sender="a", **kwargs) == []  # the first message is the new fact
    for n in range(1, 6):
        assert feed(breaker, n * S, sender="ab"[n % 2], **kwargs) == []  # alternations 1-5
    opened = feed(breaker, 6 * S, sender="a", **kwargs)  # the 6th
    assert names(opened) == ["breaker.opened"]
    assert opened[0][1]["reason"] == "ping-pong: 6 alternations on c1 with no new fact"

    fresh = channel()
    assert feed(fresh, 0, sender="a", **kwargs) == []
    for n in range(1, 40):  # a new fact every fifth message: it never gets to six
        fact = f"new{n}" if n % 5 == 0 else "same"
        assert feed(fresh, n * S, sender="ab"[n % 2], correlation_id="c1", fact=fact) == []
    assert fresh.state == "closed"


def test_messages_without_a_correlation_id_are_never_a_ping_pong() -> None:
    breaker = channel()
    for n in range(15):
        assert feed(breaker, n * S, sender="ab"[n % 2]) == []


def test_mail_the_receiver_pulls_feeds_the_ping_pong_detector_but_not_the_rate_window() -> None:
    breaker = channel()
    for n in range(40):
        moves = feed(breaker, n, sender="ab"[n % 2], correlation_id="c", fact="x", counted=False)
        if moves:
            assert moves[0][1]["reason"].startswith("ping-pong")
            break
    assert breaker.window.count == 0


# -- recovery -----------------------------------------------------------------------------


def trip_by_rate(breaker: ChannelBreaker, start: int) -> int:
    for n in range(21):
        moves = feed(breaker, start + n)
    assert names(moves) == ["breaker.opened"]
    return start + 20


def test_it_half_opens_after_15_s_and_closes_after_a_quiet_window() -> None:
    breaker = channel()
    now = trip_by_rate(breaker, 0)
    assert breaker.due() == now + 15 * S
    assert breaker.advance(now + 15 * S - 1) == [] and breaker.state == "open"
    assert names(breaker.advance(now + 15 * S)) == ["breaker.half_open"]
    assert breaker.due() == now + 25 * S
    assert breaker.advance(now + 25 * S - 1) == []
    assert names(breaker.advance(now + 25 * S)) == ["breaker.closed"]
    assert breaker.trips == 0 and breaker.due() is None


def test_a_trigger_while_half_open_opens_it_again_with_a_higher_trip_count() -> None:
    breaker = channel()
    now = trip_by_rate(breaker, 0)
    breaker.advance(now + 15 * S)
    again = trip_by_rate(breaker, now + 15 * S + 1)  # the storm is still going: fresh windows
    assert breaker.state == "open" and breaker.trips == 2 and again > now


def test_what_is_diverted_while_open_is_not_counted() -> None:
    breaker = channel()
    now = trip_by_rate(breaker, 0)
    for n in range(100):
        assert feed(breaker, now + n) == []
    assert breaker.window.count == 0


ALLOWED_NEXT = {
    None: {"breaker.opened"},
    "breaker.opened": {"breaker.half_open"},
    "breaker.half_open": {"breaker.closed", "breaker.opened"},
    "breaker.closed": {"breaker.opened"},
}


@settings(max_examples=100, deadline=None)
@given(
    steps=st.lists(
        st.tuples(st.integers(0, 4000), st.integers(0, 30_000)), min_size=1, max_size=300
    )
)
def test_transitions_always_follow_the_state_machine(steps) -> None:
    breaker, now, last = channel(), 0, None
    for gap, size in steps:
        now += gap
        for name, payload in feed(breaker, now, size):
            assert name in ALLOWED_NEXT[last]
            last = name
            if name == "breaker.opened":
                assert payload["until_ms"] == now + POLICY.half_open_after_ms
    assert breaker.state in ("closed", "open", "half_open")


@settings(max_examples=80, deadline=None)
@given(calls=st.lists(st.integers(0, 3000), min_size=1, max_size=60))
def test_critical_slots_are_in_order_a_second_apart_and_never_in_the_past(calls) -> None:
    breaker, now, slots = channel(), 0, []
    for gap in calls:
        now += gap
        slot = breaker.critical_slot(now)
        assert slot >= now
        slots.append(slot)
    assert all(
        later - earlier >= POLICY.critical_gap_ms
        for earlier, later in zip(slots, slots[1:], strict=False)
    )


# -- the topic storm ----------------------------------------------------------------------


def test_the_51st_message_on_a_topic_in_ten_seconds_opens_the_storm_breaker() -> None:
    breaker = storm()
    for n in range(50):
        assert breaker.observe(n * 100) == []
    opened = breaker.observe(5000)
    assert names(opened) == ["breaker.opened"]
    assert opened[0][1] == {
        "breaker": "topic:t",
        "until_ms": 5000 + 15 * S,
        "trips": 1,
        "reason": "51 msgs on t in 10 s",
    }
    assert names(breaker.advance(5000 + 15 * S)) == ["breaker.half_open"]
    assert names(breaker.advance(5000 + 25 * S)) == ["breaker.closed"]


@settings(max_examples=100, deadline=None)
@given(
    steps=st.lists(st.integers(0, 600), min_size=1, max_size=150),
    limit=st.integers(1, 60),
)
def test_the_storm_threshold_is_exactly_the_count_in_the_window(steps, limit) -> None:
    breaker, history, now = storm(StormPolicy(max_msgs=limit)), [], 0
    for gap in steps:
        now += gap
        history.append(now)
        inside = [at for at in history if now - at < 10 * S]
        moves = breaker.observe(now)
        assert (names(moves) == ["breaker.opened"]) == (len(inside) > limit)
        if moves:
            break


# -- the digest ---------------------------------------------------------------------------


@settings(max_examples=150, deadline=None)
@given(
    messages=st.lists(st.tuples(st.integers(0, 50), st.integers(0, 7)), max_size=120),
    cap=st.integers(1, 6),
)
def test_a_digest_accounts_for_every_message(messages, cap) -> None:
    coalescer, now = Coalescer(cap), 0
    for gap, kind in messages:
        now += gap
        coalescer.add(now, {"k": kind}, size=10 + kind)
    digest = coalescer.build("t")

    assert digest.count == len(messages)
    assert digest.bytes == sum(10 + kind for _, kind in messages)
    assert sum(item.count for item in digest.items) + digest.elided == digest.count
    assert len(digest.items) <= cap
    first_seen = list(dict.fromkeys(kind for _, kind in messages))[:cap]
    assert [item.payload["k"] for item in digest.items] == first_seen
    for item in digest.items:
        assert item.count == sum(1 for _, kind in messages if kind == item.payload["k"])
    assert digest.elided == sum(1 for _, kind in messages if kind not in first_seen)
    if messages:
        assert digest.last_ms - digest.first_ms == sum(gap for gap, _ in messages[1:])
    assert Digest.model_validate(digest.model_dump(mode="json")) == digest


@settings(max_examples=60, deadline=None)
@given(
    messages=st.lists(st.integers(0, 5), min_size=1, max_size=40),
    seed=st.integers(0, 2**32),
)
def test_a_digest_does_not_depend_on_when_the_messages_arrived_only_on_their_order(
    messages, seed
) -> None:
    one, two = Coalescer(8), Coalescer(8)
    shifted = random.Random(seed).randrange(1, 10**6)
    for n, kind in enumerate(messages):
        one.add(n, {"k": kind}, 5)
        two.add(n + shifted, {"k": kind}, 5)
    a, b = one.build("t"), two.build("t")
    assert a.items == b.items and (a.count, a.bytes, a.elided) == (b.count, b.bytes, b.elided)


# -- the guard's routing ------------------------------------------------------------------


def route(guard: Guard, now: int, *, to: str = "b", topic: str = "t", lane=Lane.NORMAL, **extra):
    args = {
        "peer": to,
        "topic": topic,
        "kind": "msg",
        "lane": lane,
        "payload": {"n": now},
        "correlation_id": None,
        "backlog": False,
    } | extra
    return guard.route_out(now, **args)


def test_below_the_thresholds_everything_passes_untouched() -> None:
    guard = Guard("a")
    for n in range(20):
        routed = route(guard, n * 100)
        assert routed.route == Route.PASS and routed.moves == []


def test_an_open_channel_diverts_the_normal_and_low_lanes_and_paces_the_critical_lane() -> None:
    guard = Guard("a")
    for n in range(20):
        route(guard, n * 10)
    tripped = route(guard, 300)
    assert tripped.route == Route.DIVERT and names(tripped.moves) == ["breaker.opened"]
    assert route(guard, 400, lane=Lane.LOW).route == Route.DIVERT

    slots = [route(guard, 500, lane=Lane.CRITICAL) for _ in range(4)]
    assert [r.route for r in slots] == [Route.PACE] * 4
    assert [r.at for r in slots] == [500, 1500, 2500, 3500]  # one a second, in order
    assert route(guard, 5000, lane=Lane.CRITICAL).at == 5000  # a free slot is used at once


def test_liveness_and_the_bus_control_frames_are_never_counted_or_held_back() -> None:
    guard = Guard("a")
    for n in range(200):  # a thousand heartbeats would be a "storm" on any busy cluster
        assert route(guard, n, topic="member.heartbeat", lane=Lane.LOW).route == Route.PASS
        for kind in ("ack", "fenced", "subscribe"):
            assert route(guard, n, kind=kind).route == Route.PASS
    assert guard.channels == {} or all(b.state == "closed" for b in guard.channels.values())
    assert route(guard, 300).moves == []
    for n in range(30):
        route(guard, 400 + n)  # now really trip it
    assert guard.channels["b"].state == "open"
    assert route(guard, 500, topic="member.heartbeat", lane=Lane.LOW).route == Route.PASS
    assert route(guard, 500, kind="ack").route == Route.PASS


def test_the_channel_is_per_pair_and_the_peers_do_not_share_a_window() -> None:
    guard = Guard("a")
    for n in range(60):  # 15 each, on topics of their own: no channel and no topic is busy
        assert route(guard, n * 10, to=f"p{n % 4}", topic=f"t{n}").route == Route.PASS
    assert {peer: b.name for peer, b in guard.channels.items()} == {
        f"p{n}": f"channel:a|p{n}" for n in range(4)
    }


def test_a_storm_across_many_peers_is_coalesced_per_receiver_and_flushed_each_second() -> None:
    guard = Guard("a")
    routes = []
    for n in range(60):  # 4 subscribers, 15 messages each: no channel is busy, the topic is
        routes.append(route(guard, n * 20, to=f"s{n % 4}", topic="budget.epoch"))
    assert [r.route for r in routes[:50]] == [Route.PASS] * 50
    assert names(routes[50].moves) == ["breaker.opened"] and routes[50].moves[0][1]["breaker"] == (
        "topic:budget.epoch"
    )
    assert [r.route for r in routes[50:]] == [Route.ABSORB] * 10
    assert all(b.state == "closed" for b in guard.channels.values())

    first_absorbed = 50 * 20
    assert guard.flush_due == first_absorbed + 1000  # a digest at most every second
    assert min(guard.deadlines()) == guard.flush_due
    moves, digests = guard.tick(guard.flush_due)
    assert moves == []
    assert [(topic, peer) for topic, peer, _ in digests] == [
        ("budget.epoch", "s0"),
        ("budget.epoch", "s1"),
        ("budget.epoch", "s2"),
        ("budget.epoch", "s3"),
    ]
    assert sum(payload["count"] for _, _, payload in digests) == 10
    assert guard.coalescers == {} and guard.flush_due is None


def test_what_is_left_in_a_digest_is_flushed_when_the_storm_breaker_half_opens() -> None:
    guard = Guard("a")
    for n in range(50):
        route(guard, n, to=f"s{n % 4}", topic="x")
    assert route(guard, 50, to="s2", topic="x").route == Route.ABSORB  # the 51st opens it
    until = guard.storms["x"].open_until
    assert guard.tick(500)[1] == []  # its digest is not due yet, and the breaker is open
    assert [peer for _, peer, _ in guard.tick(1050)[1]] == ["s2"]

    late = route(guard, until - 100, to="s1", topic="x")  # its digest would be due after it
    assert late.route == Route.ABSORB and guard.flush_due == until + 900
    moves, digests = guard.tick(until)
    assert names(moves) == ["breaker.half_open"]
    assert [(peer, payload["count"]) for _, peer, payload in digests] == [("s1", 1)]
    assert route(guard, until + 1, to="s1", topic="x").route == Route.PASS  # the probe window


def test_requests_and_replies_are_counted_by_the_topic_but_never_coalesced() -> None:
    guard = Guard("a")
    for n in range(80):
        routed = route(guard, n, to=f"s{n % 5}", topic="audit.request", kind="request")
        assert routed.route == Route.PASS
    assert guard.storms["audit.request"].state == "open"


def test_a_digest_frame_is_routed_but_not_counted() -> None:
    guard = Guard("a")
    before = guard.channel("b").window.count
    routed = route(guard, 0, kind="digest", topic="x")
    assert routed.route == Route.PASS
    assert guard.channel("b").window.count == before


# -- the mailbox poll schedule ------------------------------------------------------------


def test_the_receiver_polls_with_backoff_and_stops_after_empty_polls() -> None:
    guard = Guard("b")
    guard.on_notify(1000)
    assert guard.mail_due == 1250 and not guard.idle
    polls = []
    while guard.mail_due is not None and len(polls) < 20:
        now = guard.mail_due
        assert guard.poll_now(now)
        polls.append(now)
        guard.on_mail(now, 0, 0)  # the box is empty
    assert polls == [1250, 1500, 2000]  # the gap doubles (250, 500); the third empty poll ends it
    assert guard.mail_due is None and guard.idle


def test_a_poll_that_finds_mail_keeps_polling_and_one_that_is_never_answered_gives_up() -> None:
    guard = Guard("b")
    guard.on_notify(0)
    assert guard.poll_now(250)
    guard.on_mail(250, 16, 20)  # a full batch, more waiting: poll again soon
    assert guard.mail_empty == 0 and guard.mail_due == 500
    answered = 0
    now = 500
    while guard.poll_now(now):  # the board never answers again
        answered += 1
        now = guard.mail_due
        assert answered < 10
    assert guard.mail_due is None


def test_a_notice_while_polling_does_not_restart_the_backoff() -> None:
    guard = Guard("b")
    guard.on_notify(0)
    guard.poll_now(250)
    guard.on_mail(250, 0, 0)
    due = guard.mail_due
    guard.on_notify(300)
    assert guard.mail_due == due


# -- configuration ------------------------------------------------------------------------


def test_the_policy_defaults_are_the_ones_in_config_defaults_yaml() -> None:
    section = yaml.safe_load((CONFIG_DIR / "defaults.yaml").read_text(encoding="utf-8"))["breakers"]
    assert GuardPolicy.from_config(section) == GuardPolicy()
    assert GuardPolicy().channel.critical_gap_ms == 1000


def test_a_guard_is_made_from_a_run_param() -> None:
    assert Guard.create("a", None) is None and Guard.create("a", False) is None
    assert Guard.create("a", True).policy == GuardPolicy()
    custom = Guard.create("a", {"channel": {"max_msgs": 3}, "storm": {"max_msgs": 7}})
    assert custom.policy.channel.max_msgs == 3 and custom.policy.storm.max_msgs == 7
    assert custom.policy.channel.max_bytes == 65_536


def test_the_taskspec_flag_is_off_unless_the_yaml_turns_it_on(tmp_path) -> None:
    assert TaskSpec(goal="x").channel_breakers is False
    path = tmp_path / "spec.yaml"
    path.write_text("goal: x\nchannel_breakers: true\n", encoding="utf-8")
    assert TaskSpec.load(path).channel_breakers is True
    path.write_text("goal: x\n", encoding="utf-8")
    assert TaskSpec.load(path).channel_breakers is False
