"""The global spend breaker, wired in (spec §8): the market view feeds every settled cost to
``market/spend_breaker.py`` on virtual time, so whether it is open is a fact of the log; the
orchestrator reports each trip and recovery once and holds new contracts while it is open."""

from typing import Any

from fractalswarm.actors import market_maker
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Emit, SetTimer, View
from fractalswarm.market.allocation import to_micros
from fractalswarm.market.spend_breaker import (
    SpendBreaker,
    SpendBreakerConfig,
    record_spend,
)
from fractalswarm.market.view import MarketView

CONFIG = {"max_burn_share_per_min": 0.2, "pause_ms": 30_000}
_seq = 0


def event(kind: str, payload: dict[str, Any], at: int = 0) -> Event:
    global _seq
    _seq += 1
    return Event(
        seq=_seq, run_id="r", ts_virtual=at, lamport=_seq, type=kind, actor="x",
        idem_key=f"k{_seq}", payload=payload, prev_hash="", hash="",
    )  # fmt: skip


def started(cap: float, breaker: dict | None = CONFIG) -> Event:
    params = {"market": {"breaker": breaker}} if breaker is not None else {}
    return event("run.started", {"seed": "s", "scenario": "x", "clock": "sim",
                                 "run_cap_usd": cap, "params": params})  # fmt: skip


def spend(view: MarketView, effect: str, usd: float, at: int, scopes=None) -> None:
    scopes = {"squad": "s"} if scopes is None else scopes
    reserved = {"effect_id": effect, "usd": usd, "scopes": scopes}
    view.apply(event("budget.reserved", reserved, at=at))
    settled = {"effect_id": effect, "reserved_usd": usd, "actual_usd": usd}
    view.apply(event("budget.settled", settled, at=at))


def view_at(market: MarketView, now: int) -> View:
    return View(run_id="r", seed="s", actor_id="o1.1", now=now, lamport=0, alive=(),
                views={"market": market})  # fmt: skip


def state_of(breaker: dict | None = CONFIG) -> dict[str, Any]:
    return {"id": "o1.1", "market": {"breaker": breaker}, "spend": {"trips": 0, "open": False},
            "goals": {"g": {"phase": "running"}}}  # fmt: skip


# -- the view -----------------------------------------------------


def test_the_view_trips_when_the_burn_passes_a_fifth_of_what_is_left_and_recovers() -> None:
    market = MarketView()
    market.apply(started(10.0))
    spend(market, "a", 1.0, at=0)  # remaining 9.0: the limit is 1.8 a minute
    assert market.breaker.trips == 0
    spend(market, "b", 1.2, at=10_000)  # 2.2 burned in the minute, remaining 7.8: the limit is 1.56
    assert market.breaker.trips == 1 and market.breaker.open_until == 40_000
    assert market.breaker.is_open(39_999) and not market.breaker.is_open(40_000)
    assert market.breaker_config == SpendBreakerConfig(**CONFIG)


def test_the_view_is_the_pure_breaker_fed_the_settled_costs_in_order() -> None:
    market, pure, remaining = MarketView(), SpendBreaker(), 10.0
    market.apply(started(10.0))
    config = SpendBreakerConfig(**CONFIG)
    for number, (usd, at) in enumerate([(0.9, 0), (0.7, 5_000), (0.8, 12_000), (0.4, 70_000)]):
        spend(market, f"e{number}", usd, at)
        remaining -= usd
        pure, _ = record_spend(pure, at, usd, remaining, config)
        assert market.breaker == pure
    assert market.breaker.trips >= 1


def test_a_run_that_did_not_enable_the_breaker_never_trips() -> None:
    market = MarketView()
    market.apply(started(10.0, breaker=None))
    spend(market, "a", 9.0, at=0)
    assert market.breaker_config is None and market.breaker.trips == 0


def test_the_view_counts_every_reservation_of_the_run_whatever_its_scopes() -> None:
    market = MarketView()
    market.apply(started(10.0))
    market.apply(event("budget.reserved", {"effect_id": "x", "usd": 0.3, "scopes": {"run": "r"}}))
    spend(market, "y", 0.2, at=0)
    assert market.committed_total() == to_micros(0.5)  # 0.3 still reserved, 0.2 spent
    assert market.committed("s") == to_micros(0.2)  # the squad sees only its own


# -- holding new contracts -----------------------------------------------------


def tripped() -> MarketView:
    market = MarketView()
    market.apply(started(10.0))
    spend(market, "a", 1.0, at=0)
    spend(market, "b", 1.2, at=10_000)
    return market


def test_new_contracts_are_held_while_the_breaker_is_open_and_only_then() -> None:
    market = tripped()
    assert market_maker.paused_until(state_of(), view_at(market, 20_000)) == 40_000
    assert market_maker.paused_until(state_of(), view_at(market, 40_000)) is None
    assert market_maker.paused_until(state_of(breaker=None), view_at(market, 20_000)) is None
    assert market_maker.paused_until({"id": "o", "market": None}, view_at(market, 20_000)) is None


def test_a_held_leaf_sets_one_wake_up_timer_per_pause() -> None:
    state, view = state_of(), view_at(tripped(), 20_000)
    state, commands = market_maker.wake(state, "g", 40_000, view)
    assert commands == [SetTimer(delay_ms=20_000, tag="breaker|g")]
    state, commands = market_maker.wake(state, "g", 40_000, view)
    assert commands == []  # the pause is already being waited for
    state["goals"]["g"]["wake"] = None  # the timer fired, the breaker was open again
    _, commands = market_maker.wake(state, "g", 70_000, view_at(tripped(), 41_000))
    assert commands == [SetTimer(delay_ms=29_000, tag="breaker|g")]


# -- reporting trips and recoveries -----------------------------------------------------


def test_each_trip_and_recovery_is_reported_once_with_a_key_that_dedupes_other_reporters() -> None:
    market = tripped()
    state, commands = market_maker._spend_breaker(state_of(), view_at(market, 12_000), market)
    [opened] = commands
    assert isinstance(opened, Emit) and opened.type == "breaker.opened"
    assert opened.idem_key == "breaker.opened:global_spend:1"
    assert opened.payload["breaker"] == "global_spend" and opened.payload["until_ms"] == 40_000
    assert opened.payload["trips"] == 1 and "20%" in opened.payload["reason"]
    assert state["spend"] == {"trips": 1, "open": True}
    state, commands = market_maker._spend_breaker(state, view_at(market, 30_000), market)
    assert commands == []  # reported once while it stays open
    state, commands = market_maker._spend_breaker(state, view_at(market, 40_000), market)
    [closed] = commands
    assert closed.type == "breaker.closed" and closed.idem_key == "breaker.closed:global_spend:1"
    assert closed.payload == {"breaker": "global_spend"} and state["spend"]["open"] is False
    assert market_maker._spend_breaker(state, view_at(market, 50_000), market)[1] == []


def test_a_run_without_the_breaker_reports_nothing() -> None:
    market = MarketView()
    market.apply(started(10.0, breaker=None))
    spend(market, "a", 9.0, at=0)
    state, commands = market_maker._spend_breaker(state_of(None), view_at(market, 1), market)
    assert commands == [] and state["spend"] == {"trips": 0, "open": False}
