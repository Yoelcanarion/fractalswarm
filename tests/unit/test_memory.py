"""The blackboard: draft/verified visibility, FTS5 search and the workspace jail (spec §9)."""

import pytest

from fractalswarm.memory.blackboard import Blackboard, Fact, Provenance, WorkspaceError, jail
from fractalswarm.memory.fts import to_match


def fact(key: str, squad: str, value, status: str = "draft") -> Fact:
    provenance = Provenance(contract=f"c-{squad}", agent=f"{squad}.a1", squad=squad)
    return Fact(
        key=key, subject=key.split(":")[1], value=value, provenance=provenance, status=status
    )


def test_drafts_stay_in_their_squad_until_promoted() -> None:
    board = Blackboard()
    board.publish(fact("speaker:S01:availability", "o1.1", {"day": 1}))
    assert [f.key for f in board.search("S01", squad="o1.1")] == ["speaker:S01:availability"]
    assert board.search("S01", squad="o2.1") == []
    assert board.get("speaker:S01:availability", squad="o2.1") is None

    promoted = board.promote("speaker:S01:availability")
    assert promoted is not None and promoted.visibility == "global"
    assert [f.key for f in board.search("S01", squad="o2.1")] == ["speaker:S01:availability"]
    assert board.promote("speaker:S01:availability") is None  # already verified


def test_a_verified_fact_is_not_downgraded_by_a_later_draft() -> None:
    board = Blackboard()
    board.publish(fact("talk:T01:attendance", "o1.1", {"n": 40}))
    board.promote("talk:T01:attendance")
    kept = board.publish(fact("talk:T01:attendance", "o2.1", {"n": 99}))
    assert kept.status == "verified" and kept.value == {"n": 40}
    assert board.publish(fact("talk:T02:attendance", "o1.1", {"n": 1})).version == 1
    assert board.publish(fact("talk:T02:attendance", "o1.1", {"n": 2})).version == 2


def test_search_supports_or_and_ranks_deterministically() -> None:
    board = Blackboard()
    for n in (3, 1, 2):
        board.publish(fact(f"speaker:S0{n}:availability", "sq", {"n": n}, status="verified"))
    keys = [f.key for f in board.search("S01 OR S03", k=10)]
    assert sorted(keys) == ["speaker:S01:availability", "speaker:S03:availability"]
    assert keys == [f.key for f in board.search("S01 OR S03", k=10)]
    assert board.search("S01 S03") == []  # words are ANDed by default
    assert len(board.search("availability", k=2)) == 2
    assert [f.key for f in board.search("S02 availability")] == ["speaker:S02:availability"]
    assert [f.key for f in board.search("speaker:S03:availability")] == ["speaker:S03:availability"]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("S01 OR S07", '"S01" OR "S07"'),
        ("booking d1", '"booking" AND "d1"'),
        ('a "b" NOT', '"a" AND "b"'),
        ("OR", None),
        ("   ", None),
        ("x) OR (y*", '"x" OR "y"'),
    ],
)
def test_queries_are_sanitized(query: str, expected: str | None) -> None:
    assert to_match(query) == expected


def test_workspace_writes_are_versioned_and_jailed() -> None:
    board = Blackboard()
    first = board.write("sessions/a/blurb.md", "one", author="a1")
    assert first.version == 1
    assert board.write("sessions/a/blurb.md", "two", author="a2", expected=0).reason == "version"
    assert board.write("sessions/a/./blurb.md", "two", author="a2", expected=1).version == 2
    assert board.read("sessions/a/blurb.md").content == "two"
    for path in ("/etc/passwd", "../x", "a/../../x", "C:/x", "a\\b", ""):
        with pytest.raises(WorkspaceError):
            jail(path)
