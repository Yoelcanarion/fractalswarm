"""Bounded-load HRW (spec §5.3) and leases with CAS on slot keys (spec §6.1)."""

from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.coord.hrw import assign, capacity, rank, remap
from fractalswarm.coord.leases import FencingToken, LeaseTable, Write

members_st = st.lists(
    st.from_regex(r"o[0-9]{1,2}", fullmatch=True), min_size=1, max_size=8, unique=True
)
keys_st = st.lists(
    st.from_regex(r"k[0-9]{1,3}", fullmatch=True), min_size=0, max_size=60, unique=True
)


@given(keys_st, members_st)
def test_assignment_is_total_and_respects_the_load_bound(keys, members) -> None:
    owners = assign(keys, members)
    assert sorted(owners) == sorted(keys)
    assert set(owners.values()) <= set(members)
    bound = capacity(len(keys), len(members))
    for member in members:
        assert sum(owner == member for owner in owners.values()) <= bound


@given(keys_st, members_st)
def test_assignment_ignores_member_order(keys, members) -> None:
    assert assign(keys, members) == assign(list(reversed(keys)), list(reversed(members)))


@given(keys_st, members_st.filter(lambda m: len(m) >= 2), st.data())
def test_remap_moves_only_the_dead_members_keys(keys, members, data) -> None:
    owners = assign(keys, members)
    dead = data.draw(st.sampled_from(members))
    alive = [member for member in members if member != dead]
    moved = remap(owners, alive)
    assert sorted(moved) == sorted(owners)
    assert dead not in moved.values()
    for key, owner in owners.items():
        if owner != dead:
            assert moved[key] == owner


def test_rank_is_stable_and_complete() -> None:
    members = ["o1", "o2", "o3"]
    assert rank("track-ai", members) == rank("track-ai", list(reversed(members)))
    assert sorted(rank("track-ai", members)) == members


def test_priority_goes_first_under_the_bound() -> None:
    # One member, so the bound is the key count: every key lands, in priority order.
    assert assign({"a": 0, "b": 5}, ["o1"]) == {"a": "o1", "b": "o1"}


# -- leases and CAS ----------------------------------------------------------------------


def token(member: str, incarnation: int = 0, epoch: int = 0) -> FencingToken:
    return FencingToken(member=member, incarnation=incarnation, epoch=epoch)


def test_booking_is_all_or_nothing() -> None:
    table = LeaseTable()
    first = [Write(key="cell:d1:s0:A", value={"t": 1}), Write(key="speaker:S1:d1:s0", value={})]
    assert table.book(first, "o1.1", token("o1.1"), now=0) == []
    second = [Write(key="cell:d1:s1:A", value={"t": 2}), Write(key="speaker:S1:d1:s0", value={})]
    conflicts = table.book(second, "o2.1", token("o2.1"), now=10)
    assert [(c.key, c.reason, c.holder) for c in conflicts] == [
        ("speaker:S1:d1:s0", "version", "o1.1")
    ]
    assert table.get("cell:d1:s1:A").version == 0  # nothing of the losing booking was written
    assert table.leases == {}  # leases are released after a booking


def test_cas_needs_the_lease_and_the_expected_version() -> None:
    table = LeaseTable(ttl_ms=100)
    assert table.acquire("k", "a", token("a"), now=0) is None
    assert table.acquire("k", "b", token("b"), now=50).reason == "leased"
    assert table.cas(Write(key="k", value={"v": 1}), "b", now=50).reason == "leased"
    assert table.cas(Write(key="k", expected=3, value={"v": 1}), "a", now=50).reason == "version"
    assert table.cas(Write(key="k", value={"v": 1}), "a", now=50) is None
    assert table.get("k").version == 1
    # The lease expires: someone else may take it, but must expect the new version.
    assert table.acquire("k", "b", token("b"), now=100) is None
    assert table.cas(Write(key="k", expected=1, value=None), "b", now=100) is None
    assert table.get("k").holder is None


def test_a_stale_fencing_token_is_refused() -> None:
    table = LeaseTable()
    assert table.book([Write(key="k1", value={})], "o1", token("o1", incarnation=2), now=0) == []
    stale = table.book([Write(key="k2", value={})], "o1", token("o1", incarnation=1), now=1)
    assert [c.reason for c in stale] == ["fenced"]
