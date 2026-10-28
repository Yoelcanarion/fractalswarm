"""The channel and topic-storm breakers on a real run (spec §8, §0.2): the breaker-toy test-bed.

One run provokes a ping-pong between two actors, a burst on the critical lane while that
channel is open, and a topic storm. The tests read the log: the ``breaker.*`` events, the
frames that did and did not go on the wire, what the mailbox delivered, the digests. Every
run must replay to the recorded head. The same traffic with the breakers off shows what they
change.
"""

import asyncio
import re
from pathlib import Path
from typing import Any

import pytest

from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.runs import RunResult, record_run, replay_run

S = 1000
PING_PONG = "ping-pong: 6 alternations on negotiation with no new fact"
RUNS: dict[str, dict[str, Any]] = {
    "default": {},
    "off": {"guard": False},
    "rate": {"distinct": True, "bounces": 30},  # a new fact every time: only the rate can trip
    "size": {"pad": 30_000, "bounces": 6},
    "tuned": {"guard": {"channel": {"pingpong_alternations": 3}}},
}


async def record(root: Path, name: str, params: dict[str, Any], run_id: str = "bt") -> RunResult:
    return await record_run(
        "breaker-toy",
        run_id=run_id,
        run_dir=root / name,
        backend=FakeBackend(),
        seed="s",
        params=params,
        run_cap_usd=1.0,
    )


def events_of(result: RunResult) -> list[Event]:
    with EventStore.import_jsonl(result.paths.events_jsonl) as store:
        return list(store.read())


@pytest.fixture(scope="module")
def results(tmp_path_factory: pytest.TempPathFactory) -> dict[str, RunResult]:
    root = tmp_path_factory.mktemp("breakers")
    return {name: asyncio.run(record(root, name, params)) for name, params in RUNS.items()}


@pytest.fixture(scope="module")
def logs(results: dict[str, RunResult]) -> dict[str, list[Event]]:
    return {name: events_of(result) for name, result in results.items()}


def opened(log: list[Event], breaker: str) -> list[Event]:
    return [e for e in log if e.type == "breaker.opened" and e.payload["breaker"] == breaker]


def at(log: list[Event], type_: str, breaker: str) -> list[tuple[str, int]]:
    return [
        (e.actor, e.ts_virtual) for e in log if e.type == type_ and e.payload["breaker"] == breaker
    ]


def got(log: list[Event], who: str | None = None, topic: str | None = None) -> list[Event]:
    return [
        e
        for e in log
        if e.type == "breakertoy.got"
        and (who is None or e.payload["who"] == who)
        and (topic is None or e.payload["topic"] == topic)
    ]


def sent(log: list[Event], topic: str) -> list[Event]:
    return [e for e in log if e.type == "msg.sent" and e.payload["topic"] == topic]


# -- the ping-pong ------------------------------------------------------------------------


def test_the_ping_pong_opens_the_channel_at_the_sixth_alternation(logs) -> None:
    log = logs["default"]
    first, second = opened(log, "channel:ping|pong")
    assert (first.actor, first.ts_virtual) == ("ping", 0)  # it sent the 7th message
    assert first.payload == {
        "breaker": "channel:ping|pong",
        "until_ms": 15 * S,
        "trips": 1,
        "reason": PING_PONG,
    }
    # The other end counts that message when it pulls it from the mailbox, a poll later.
    assert (second.actor, second.ts_virtual) == ("pong", 250)
    assert second.payload["reason"] == PING_PONG and second.payload["until_ms"] == 15 * S + 250
    direct = [e for e in got(log, topic="negotiate") if e.ts_virtual == 0]
    assert len(direct) == 6  # three each: the 7th message was already diverted


def test_the_channel_half_opens_after_15_s_and_closes_after_a_quiet_window(logs) -> None:
    log = logs["default"]
    assert at(log, "breaker.half_open", "channel:ping|pong") == [
        ("ping", 15 * S),
        ("pong", 15 * S + 250),
    ]
    assert at(log, "breaker.closed", "channel:ping|pong") == [
        ("ping", 25 * S),
        ("pong", 25 * S + 250),
    ]


def test_what_cannot_pass_goes_through_the_mailbox_and_every_message_is_delivered_once(
    logs,
) -> None:
    log = logs["default"]
    puts = sent(log, "mailbox.put")
    assert len(puts) == 8 and all(e.payload["to"] == "board" for e in puts)
    diverted = {e.payload["body"]["env"]["id"] for e in puts}
    assert {e.payload["body"]["env"]["lane"] for e in puts} == {"normal"}

    talk = got(log, topic="negotiate")
    ids = [e.payload["msg_id"] for e in talk]
    assert len(ids) == len(set(ids)) == 14  # the whole exchange arrived, nothing twice
    late = {e.payload["msg_id"] for e in talk if e.ts_virtual > 0}
    assert late == diverted  # ... and what arrived late is exactly what was diverted

    delivered = [e.payload for e in log if e.type == "mailbox.delivered"]
    assert sum(p["count"] for p in delivered) == len(puts)
    assert all(p["dropped"] == 0 and p["remaining"] == 0 for p in delivered)
    # The bounces went at the receivers' pace, not at wire speed.
    assert max(e.ts_virtual for e in talk) == 1750 and min(e.ts_virtual for e in talk) == 0


def test_receivers_poll_with_backoff_and_stop_when_the_box_stays_empty(logs) -> None:
    log = logs["default"]
    for who in ("ping", "pong"):
        last_mail = max(
            e.ts_virtual for e in log if e.type == "mailbox.delivered" and e.payload["owner"] == who
        )
        polls = [e.ts_virtual for e in sent(log, "mailbox.poll") if e.actor == who]
        tail = [t for t in polls if t > last_mail]
        # Each poll is scheduled when it goes out: +250 ms, then +250 (the first empty reply
        # has not come back yet), then the gap doubles. The third empty reply ends it.
        assert tail == [last_mail + 250, last_mail + 500, last_mail + 1000]
        assert not [
            e for e in sent(log, "mailbox.poll") if e.actor == who and e.ts_virtual > tail[-1]
        ]


# -- the critical lane --------------------------------------------------------------------


def test_the_critical_lane_passes_one_message_a_second_in_order_while_the_channel_is_open(
    logs,
) -> None:
    log = logs["default"]
    burst = got(log, who="pong", topic="artifact.ready")
    assert [(e.ts_virtual, e.payload["body"]["i"]) for e in burst] == [
        (2 * S + n * S, n) for n in range(6)
    ]
    # Every one of them was on the wire at its slot (not in the mailbox), and was acked.
    wire = sent(log, "artifact.ready")
    assert [e.ts_virtual for e in wire] == [2 * S + n * S for n in range(6)]
    assert not [
        e for e in sent(log, "mailbox.put") if e.payload["body"]["env"]["lane"] == "critical"
    ]
    assert len(sent(log, "bus.ack")) == 6
    # The channel really was open the whole time, and normal traffic was being diverted.
    (opened_at,) = [e.ts_virtual for e in opened(log, "channel:ping|pong") if e.actor == "ping"]
    (half_open_at,) = [
        t for who, t in at(log, "breaker.half_open", "channel:ping|pong") if who == "ping"
    ]
    assert opened_at <= wire[0].ts_virtual and wire[-1].ts_virtual < half_open_at
    assert any(e.ts_virtual >= 1500 for e in sent(log, "mailbox.put"))


# -- the storm ----------------------------------------------------------------------------


def test_a_topic_storm_opens_the_topic_breaker_but_no_channel(logs) -> None:
    log = logs["default"]
    (storm,) = opened(log, "topic:budget.epoch")
    assert (storm.actor, storm.ts_virtual) == ("publisher", 21_200)
    assert storm.payload["reason"] == "51 msgs on budget.epoch in 10 s"
    assert storm.payload["until_ms"] == 21_200 + 15 * S
    assert at(log, "breaker.half_open", "topic:budget.epoch") == [("publisher", 36_200)]
    assert at(log, "breaker.closed", "topic:budget.epoch") == [("publisher", 46_200)]
    # 15 updates to each of 4 subscribers: no pair is busy, only the topic.
    assert not [
        e
        for e in log
        if e.type == "breaker.opened"
        and "publisher" in e.payload["breaker"]
        and e.payload["breaker"].startswith("channel")
    ]


def test_after_it_opens_the_updates_reach_each_subscriber_as_one_digest(logs) -> None:
    log = logs["default"]
    publishes = 15
    folded = 0
    for name in ("s0", "s1", "s2", "s3"):
        mine = got(log, who=name, topic="budget.epoch")
        singles = [e for e in mine if e.payload["kind"] == "msg"]
        digests = [e for e in mine if e.payload["kind"] == "digest"]
        assert len(digests) == 1 and digests[0].ts_virtual == 22_200  # a second after the first
        digest = digests[0].payload["body"]
        assert digest["topic"] == "budget.epoch" and digest["elided"] == 0
        assert sum(item["count"] for item in digest["items"]) == digest["count"]
        assert len(singles) + digest["count"] == publishes  # every update is accounted for
        assert all(e.ts_virtual < 22_200 for e in singles)
        folded += digest["count"]
    assert folded == 10  # frames 51 to 60
    frames = [e for e in sent(log, "budget.epoch") if e.payload["body"]["bus"]["kind"] == "digest"]
    assert len(frames) == 4
    assert all(f.payload["body"]["bus"]["idem_key"].startswith("digest:publisher:") for f in frames)


# -- rate and size (the fallback form) ----------------------------------------------------


def test_more_than_20_messages_in_ten_seconds_opens_the_channel(logs) -> None:
    log = logs["rate"]
    (first, *_) = opened(log, "channel:ping|pong")
    assert (first.actor, first.ts_virtual) == ("ping", 0)
    assert first.payload["reason"] == "21 msgs in 10 s"
    talk = got(log, topic="negotiate")
    # All 30 arrive. The 21st is the one that opens the breaker, and it is held back too.
    assert len({e.payload["msg_id"] for e in talk}) == 30
    assert len([e for e in talk if e.ts_virtual == 0]) == 20
    assert len(sent(log, "mailbox.put")) == 10


def test_more_than_64_kb_in_ten_seconds_opens_the_channel(logs) -> None:
    log = logs["size"]
    (first, *_) = opened(log, "channel:ping|pong")
    assert first.ts_virtual == 0
    match = re.fullmatch(r"(\d+) bytes in 10 s", first.payload["reason"])
    assert match and int(match.group(1)) > 65_536
    assert len(got(log, topic="negotiate")) == 6  # nothing is lost, only delayed
    assert sent(log, "mailbox.put")


def test_a_policy_override_in_the_run_params_is_honoured_and_replays(logs) -> None:
    (first, *_) = opened(logs["tuned"], "channel:ping|pong")
    assert first.payload["reason"] == "ping-pong: 3 alternations on negotiation with no new fact"
    assert logs["tuned"][0].payload["params"] == RUNS["tuned"]


# -- with the breakers off ----------------------------------------------------------------


def test_with_the_breakers_off_nothing_is_held_back_and_nothing_is_logged(logs) -> None:
    log = logs["off"]
    assert not [e for e in log if e.type.startswith(("breaker.", "mailbox."))]
    assert not sent(log, "mailbox.put") and not sent(log, "mailbox.poll")
    talk = got(log, topic="negotiate")
    assert len(talk) == 14 and {e.ts_virtual for e in talk} == {0}  # all at wire speed
    burst = got(log, who="pong", topic="artifact.ready")
    assert [e.ts_virtual for e in burst] == [2 * S] * 6  # all six at once
    storm = [e for e in got(log, topic="budget.epoch")]
    assert len(storm) == 60 and {e.payload["kind"] for e in storm} == {"msg"}


# -- replay -------------------------------------------------------------------------------


@pytest.mark.parametrize("name", list(RUNS))
async def test_every_run_replays_to_its_recorded_head(results, name: str) -> None:
    report = await replay_run(results[name].paths.root)
    assert report.ok, report.detail
    assert report.replayed_head == results[name].head_hash


async def test_the_same_params_give_the_same_run(tmp_path: Path, results) -> None:
    again = await record(tmp_path, "again", RUNS["default"])
    assert again.head_hash == results["default"].head_hash
    assert again.events == results["default"].events
