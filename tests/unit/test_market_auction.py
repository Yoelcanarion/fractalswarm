"""The epoch auction's clearing (spec §7.2): pure, deterministic, conserving."""

import random

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.market.allocation import (
    CHILD_RESERVE_SHARE,
    ROOT_RESERVE_SHARE,
    Allocation,
    allocate_proportional,
)
from fractalswarm.market.auction import (
    DEFAULT_RISK,
    Bid,
    bid_value,
    clear,
    contract_risk,
    grant_topups,
    refunds,
)

units = st.integers(min_value=0, max_value=5_000_000)
shares = st.sampled_from([0.0, CHILD_RESERVE_SHARE, ROOT_RESERVE_SHARE])


@st.composite
def bids_strategy(draw, max_children: int = 8) -> list[Bid]:
    children = draw(st.lists(st.text("abcdef", min_size=1, max_size=3), unique=True, max_size=8))
    bids = []
    for child in children[:max_children]:
        q = draw(units)
        floor = draw(st.integers(min_value=0, max_value=q))
        value = draw(st.floats(min_value=0, max_value=20, allow_nan=False, allow_infinity=False))
        bids.append(Bid(child=child, q=q, floor=floor, value=value))
    return bids


# -- conservation -----------------------------------------------------------------------------


@given(units, bids_strategy(), shares)
def test_allocations_plus_pool_plus_reserve_equal_the_envelope(envelope, bids, share) -> None:
    allocation = clear(envelope, bids, share=share)
    assert allocation.conserved
    assert (
        sum(allocation.grants_micros.values())
        + allocation.pool_micros
        + (allocation.reserve_micros)
        == allocation.envelope_micros
    )
    assert allocation.pool_micros >= 0
    assert set(allocation.grants_micros) == {bid.child for bid in bids}


@given(units, bids_strategy(), shares)
def test_nobody_gets_more_than_asked_and_nothing_is_left_while_someone_wants_more(
    envelope, bids, share
) -> None:
    allocation = clear(envelope, bids, share=share)
    for bid in bids:
        assert 0 <= allocation.grants_micros[bid.child] <= bid.q
    wanting = any(allocation.grants_micros[bid.child] < bid.q for bid in bids)
    assert not (wanting and allocation.pool_micros > 0)  # a pool is left only if all is served


@given(units, bids_strategy(), shares)
def test_floors_come_before_anything_else(envelope, bids, share) -> None:
    allocation = clear(envelope, bids, share=share)
    available = allocation.envelope_micros - allocation.reserve_micros
    if sum(bid.floor for bid in bids) <= available:
        for bid in bids:
            assert allocation.grants_micros[bid.child] >= bid.floor


# -- determinism ------------------------------------------------------------------------------


@given(units, bids_strategy(), shares, st.randoms(use_true_random=False))
def test_clearing_does_not_depend_on_the_order_bids_arrive_in(
    envelope, bids, share, rng: random.Random
) -> None:
    shuffled = list(bids)
    rng.shuffle(shuffled)
    assert clear(envelope, bids, share=share) == clear(envelope, shuffled, share=share)


def test_a_child_cannot_bid_twice() -> None:
    bid = Bid(child="a", q=10, value=1.0)
    with pytest.raises(ValueError):
        clear(100, [bid, bid])


def test_bids_and_envelopes_are_validated() -> None:
    with pytest.raises(ValueError):
        Bid(child="a", q=5, floor=6, value=1.0)
    with pytest.raises(ValueError):
        Bid(child="a", q=5, value=-1.0)
    with pytest.raises(ValueError):
        clear(-1, [])
    with pytest.raises(ValueError):
        clear(10, [], share=1.0)


# -- the two passes ---------------------------------------------------------------------------


def test_everyone_gets_their_ask_when_the_pool_is_big_enough() -> None:
    bids = [Bid(child="a", q=200, floor=50, value=1.0), Bid(child="b", q=300, value=9.0)]
    allocation = clear(1_000, bids)  # reserve 100, pool 900
    assert allocation.grants_micros == {"a": 200, "b": 300}
    assert allocation.reserve_micros == 100 and allocation.pool_micros == 400


def test_the_reserve_is_15_percent_at_the_root_and_10_below() -> None:
    assert clear(1_000, [], share=ROOT_RESERVE_SHARE).reserve_micros == 150
    assert clear(1_000, []).reserve_micros == 100


def test_scarce_money_goes_to_the_densest_bid_after_the_floors() -> None:
    # Pool 900. Floors: 100 each, 600 left. Then by density: c (4/200) takes 100 more up to
    # its ask, a (3/600) takes 500, and b (1/600), the least dense, is left with its floor.
    bids = [
        Bid(child="a", q=600, floor=100, value=3.0),
        Bid(child="b", q=600, floor=100, value=1.0),
        Bid(child="c", q=200, floor=100, value=4.0),
    ]
    allocation = clear(1_000, bids)
    assert allocation.grants_micros == {"a": 600, "b": 100, "c": 200}
    assert allocation.pool_micros == 0


def test_ties_break_by_child_id() -> None:
    # Equal density and only enough for one: the lowest id wins, whatever order bids arrive in.
    bids = [Bid(child=name, q=500, value=2.0) for name in ("c", "b", "a")]
    assert clear(500, bids, share=0.0).grants_micros == {"a": 500, "b": 0, "c": 0}
    assert clear(1_000, bids, share=0.0).grants_micros == {"a": 500, "b": 500, "c": 0}


def test_when_the_floors_do_not_all_fit_the_densest_children_get_theirs() -> None:
    bids = [
        Bid(child="lo", q=100, floor=100, value=0.5),
        Bid(child="hi", q=100, floor=100, value=5.0),
    ]
    allocation = clear(150, bids, share=0.0)
    assert allocation.grants_micros == {"hi": 100, "lo": 50}


def test_a_child_with_no_work_asks_for_nothing_and_gets_nothing() -> None:
    allocation = clear(1_000, [Bid(child="idle", q=0, value=0.0), Bid(child="busy", q=10, value=1)])
    assert allocation.grants_micros == {"busy": 10, "idle": 0}


def test_an_empty_market_keeps_everything() -> None:
    allocation = clear(1_000, [])
    assert allocation == Allocation(
        envelope_micros=1_000, reserve_micros=100, pool_micros=900, grants_micros={}
    )


def test_the_auction_and_the_proportional_fallback_return_the_same_shape() -> None:
    proportional = allocate_proportional(1.0, {"a": 0.2, "b": 0.3})
    auction = clear(
        1_000_000, [Bid(child="a", q=200_000, value=1), Bid(child="b", q=300_000, value=1)]
    )
    assert type(auction) is type(proportional)
    assert auction == proportional  # plenty of money: both hand out the asks


# -- refunds, top-ups, the bid's terms ----------------------------------------------------------


def test_unused_grants_are_refunded() -> None:
    assert refunds({"a": 100, "b": 50, "c": 10}, {"a": 30, "b": 80}) == {"a": 70, "c": 10}
    assert refunds({}, {"a": 5}) == {}


@given(st.integers(min_value=0, max_value=10**6), bids_strategy())
def test_topups_conserve_the_reserve_and_never_overdraw_it(reserve, requests) -> None:
    granted = grant_topups(reserve, requests)
    assert granted.conserved and granted.reserve_micros == 0
    assert sum(granted.grants_micros.values()) <= reserve


def test_a_topup_is_granted_as_far_as_the_reserve_reaches() -> None:
    assert grant_topups(40, [Bid(child="a", q=100, value=1)]).grants_micros == {"a": 40}
    assert grant_topups(400, [Bid(child="a", q=100, value=1)]).grants_micros == {"a": 100}


def test_bid_value_follows_the_spec_formula() -> None:
    assert bid_value(0, 0.0, 0.0, 1.0) == 1.0
    assert bid_value(1, 1.0, 0.5, 0.5) == 2 * 2 * 1.5 * 0.5
    # More priority, a critical path, more risk or more work left each raise the value.
    base = bid_value(1, 0.0, 0.3, 0.5)
    assert bid_value(2, 0.0, 0.3, 0.5) > base
    assert bid_value(1, 0.5, 0.3, 0.5) > base
    assert bid_value(1, 0.0, 0.6, 0.5) > base
    assert bid_value(1, 0.0, 0.3, 1.0) > base


def test_the_contract_risk_is_read_from_the_plan() -> None:
    assert contract_risk({"risk": 0.8}) == 0.8
    assert contract_risk({}) == DEFAULT_RISK
    assert contract_risk({"risk": 7}) == 1.0 and contract_risk({"risk": -1}) == 0.0
