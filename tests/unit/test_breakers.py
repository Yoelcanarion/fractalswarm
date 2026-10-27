"""The model-endpoint breaker (spec §8): opening, Retry-After, exponential recovery, probes."""

from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.comms.breakers import BreakerBoard, BreakerPolicy, ModelBreaker

S = 1000


def names(transitions: list) -> list[str]:
    return [name for name, _ in transitions]


def test_five_failures_inside_the_window_open_it() -> None:
    breaker = ModelBreaker("m")
    for n in range(4):
        assert breaker.record(n * S, 503) == []
    assert names(breaker.record(4 * S, 429)) == ["breaker.opened"]
    assert breaker.allow(5 * S)[0] is False


def test_failures_spread_beyond_the_window_do_not_open_it() -> None:
    breaker = ModelBreaker("m")
    for n in range(10):
        assert breaker.record(n * 8 * S, 503) == []
    assert breaker.state == "closed"


def test_client_errors_do_not_count() -> None:
    breaker = ModelBreaker("m")
    for n in range(10):
        breaker.record(n, 400)
    assert breaker.state == "closed"


def test_a_long_retry_after_opens_at_once_and_holds_it_open_at_least_that_long() -> None:
    breaker = ModelBreaker("m")
    opened = breaker.record(0, 429, retry_after_ms=60 * S)
    assert names(opened) == ["breaker.opened"] and opened[0][1]["until_ms"] == 60 * S
    assert breaker.allow(59 * S)[0] is False
    allowed, transitions = breaker.allow(60 * S)
    assert allowed and names(transitions) == ["breaker.half_open"]


def test_recovery_doubles_per_trip_and_a_good_probe_closes_it() -> None:
    breaker = ModelBreaker("m", BreakerPolicy(open_after_failures=1))
    now, spans = 0, []
    for _ in range(6):
        opened = breaker.record(now, 503)
        until = opened[0][1]["until_ms"]
        spans.append(until - now)
        now = until
        assert breaker.allow(now) == (True, [("breaker.half_open", {"breaker": "m"})])
        assert breaker.allow(now)[0] is False  # one probe only
    assert spans == [10 * S, 20 * S, 40 * S, 80 * S, 120 * S, 120 * S]
    assert names(breaker.record(now, 200)) == ["breaker.closed"]
    assert breaker.trips == 0 and breaker.allow(now)[0]


@settings(max_examples=100, deadline=None)
@given(
    trips=st.integers(0, 8),
    retry_after=st.one_of(st.none(), st.integers(0, 300 * S)),
)
def test_the_open_span_honors_retry_after_and_the_cap(trips: int, retry_after: int | None) -> None:
    breaker = ModelBreaker("m")
    breaker.trips = trips
    breaker.state = "half_open"
    opened = breaker.record(0, 503, retry_after)
    span = opened[0][1]["until_ms"]
    assert span >= (retry_after or 0)
    assert span <= max(120 * S, retry_after or 0)
    assert span >= min(10 * S * 2**trips, 120 * S)


def test_the_board_routes_around_an_open_breaker_or_queues() -> None:
    board = BreakerBoard(BreakerPolicy(open_after_failures=1))
    board.record_result(0, {"model": "big", "http_status": 503, "attempts": 1})
    assert board.route(1, ["big", "small"])[0] == "small"
    board.record_result(0, {"model": "small", "http_status": 0, "attempts": 1})
    assert board.route(1, ["big", "small"])[0] is None


def test_retries_inside_one_call_count_as_failures() -> None:
    board = BreakerBoard()
    # Four retried failures, then a success: below the threshold.
    assert board.record_result(0, {"model": "m", "http_status": 200, "attempts": 5}) == []
    # Five failed attempts in one call: open.
    other = board.record_result(0, {"model": "n", "http_status": 503, "attempts": 5})
    assert names(other) == ["breaker.opened"]
