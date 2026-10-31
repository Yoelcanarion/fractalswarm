"""The split-brain check reads tenures, not names (verify/takeover.py).

A goal has one holder at each point of the log, so every remap must start from that holder. These
cases are the rule itself; ``test_takeover_check.py`` runs the same rule on edited logs.
"""

from types import SimpleNamespace

from fractalswarm.verify.takeover import _split_brain
from fractalswarm.verify.takeover_models import Violation


def flags(*remaps: tuple[str, str, str]) -> list[Violation]:
    """What the check says about remaps given as (goal, previous, owner), in log order."""
    successions = [
        SimpleNamespace(seq=seq, goal=goal, previous=previous, owner=owner)
        for seq, (goal, previous, owner) in enumerate(remaps, start=1)
    ]
    found: list[Violation] = []
    _split_brain(successions, found)
    return found


def test_a_chain_of_owners_is_clean() -> None:
    assert flags(("g", "a", "b"), ("g", "b", "c"), ("g", "c", "d")) == []


def test_two_takeovers_of_one_tenure_are_flagged_at_the_second() -> None:
    found = flags(("g", "a", "b"), ("g", "a", "c"))
    assert [(f.kind, f.seq) for f in found] == [("split-brain", 2)]
    assert "b held it" in found[0].detail


def test_the_same_heir_taking_one_tenure_twice_is_flagged() -> None:
    assert [f.seq for f in flags(("g", "a", "b"), ("g", "a", "b"))] == [2]


def test_a_member_that_held_a_goal_twice_in_turn_is_clean() -> None:
    """A false death, the goal back, a real death later: the shape of real C3 seeds 2, 6 and 7."""
    assert flags(("g", "a", "b"), ("g", "b", "a"), ("g", "a", "c")) == []


def test_a_reclaim_starts_a_new_tenure_of_the_same_member() -> None:
    assert flags(("g", "a", "b"), ("g", "b", "b"), ("g", "b", "c")) == []


def test_a_second_tenure_can_itself_be_split() -> None:
    found = flags(("g", "a", "b"), ("g", "b", "a"), ("g", "a", "c"), ("g", "a", "d"))
    assert [f.seq for f in found] == [4]


def test_goals_are_read_apart() -> None:
    assert flags(("g", "a", "b"), ("h", "a", "c")) == []
    assert [f.seq for f in flags(("g", "a", "b"), ("h", "a", "c"), ("g", "a", "d"))] == [3]
