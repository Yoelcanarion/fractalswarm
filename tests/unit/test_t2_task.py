"""T2: the seeded generator, the hard-constraint checker and the fake's reading of the text."""

import json
from pathlib import Path

import pytest

from fractalswarm.bench.tasks.t2_conference.checker import check
from fractalswarm.bench.tasks.t2_conference.fake import parse_attendance, parse_email
from fractalswarm.bench.tasks.t2_conference.generator import (
    POISON_WORDINGS,
    generate,
    load_fixture,
)

FIXTURE = Path(__file__).resolve().parents[2] / "tasks" / "fixtures" / "t2" / "seed-1"


def test_generation_is_deterministic_and_matches_the_committed_fixture() -> None:
    corpus, truth = generate(1)
    assert generate(1) == (corpus, truth)
    assert json.loads(json.dumps([corpus, truth])) == list(load_fixture(FIXTURE))
    assert generate(2) != (corpus, truth)


def test_the_corpus_has_the_specified_shape() -> None:
    corpus, truth = generate(1)
    assert len(corpus["talks"]) == 48
    assert len(corpus["emails"]) == 32
    assert len(corpus["rooms"]) == 4
    assert corpus["days"] == [1, 2]
    assert len(corpus["tracks"]) == 3
    assert set(truth["track_of"]) == {talk["id"] for talk in corpus["talks"]}


def test_the_prompts_never_carry_the_ground_truth() -> None:
    corpus, truth = generate(1)
    text = json.dumps(corpus)
    assert "availability" not in text and '"track_of"' not in text
    assert all("track_label" in talk and "track" not in talk for talk in corpus["talks"])


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_poison_changes_only_the_poisoned_emails(seed: int) -> None:
    corpus, truth = generate(seed)
    poisoned, poisoned_truth = generate(seed, poison=2, wording="explicit,authority")
    targets = poisoned_truth.pop("poisoned")
    assert poisoned_truth == truth
    assert sorted(targets.values()) == ["authority", "explicit"]
    for clean, email in zip(corpus["emails"], poisoned["emails"], strict=True):
        if email["id"] not in targets:
            assert email == clean
            continue
        assert POISON_WORDINGS[targets[email["id"]]] in email["body"]
        # A one-talk speaker free at any time: a quarantined email loses no constraint.
        talks = [t for t in corpus["talks"] if t["speaker_id"] == email["speaker_id"]]
        assert len(talks) == 1
        assert truth["patterns"][email["speaker_id"]]["kind"] == "any"
        # The fake still reads the availability and preference around the attack line.
        days, slots = corpus["days"], corpus["slots"]
        assert parse_email(email["body"], days, slots) == parse_email(clean["body"], days, slots)
    assert {k: v for k, v in poisoned.items() if k != "emails"} == {
        k: v for k, v in corpus.items() if k != "emails"
    }
    with pytest.raises(ValueError, match="unknown wordings"):
        generate(seed, poison=1, wording="rude")


@pytest.mark.parametrize("seed", range(1, 11))
def test_the_ground_truth_schedule_is_feasible(seed: int) -> None:
    corpus, truth = generate(seed)
    report = check(truth["schedule"], corpus, truth)
    assert report.hard_violations == []
    assert report.placed == report.expected == 48


@pytest.mark.parametrize("seed", range(1, 11))
def test_the_fake_reads_emails_and_abstracts_like_the_truth(seed: int) -> None:
    corpus, truth = generate(seed)
    for email in corpus["emails"]:
        available, preference = parse_email(email["body"], corpus["days"], corpus["slots"])
        cells = sorted([day, slot] for day in available for slot in available[day])
        assert cells == truth["availability"][email["speaker_id"]], email["body"]
        assert (None if preference == "none" else preference) == truth["preferences"][
            email["speaker_id"]
        ]
    for talk in corpus["talks"]:
        assert parse_attendance(talk["abstract"]) == truth["attendance"][talk["id"]]


# -- the checker, one hard constraint at a time ---------------------------------------------


@pytest.fixture
def world():
    corpus, truth = generate(1)
    return corpus, truth, [dict(entry) for entry in truth["schedule"]]


def kinds(placements, corpus, truth, **kwargs) -> set[str]:
    return {v.kind for v in check(placements, corpus, truth, **kwargs).hard_violations}


def first_other(schedule, entry, same):
    return next(o for o in schedule if o["talk_id"] != entry["talk_id"] and same(o))


def test_invalid_duplicate_and_missing(world) -> None:
    corpus, truth, schedule = world
    assert kinds([*schedule, dict(schedule[0])], corpus, truth) == {"duplicate"}
    assert kinds(schedule[1:], corpus, truth) == {"missing"}
    bad = [{**schedule[0], "room": "attic"}, *schedule[1:]]
    assert kinds(bad, corpus, truth) == {"invalid"}  # counted once, not also missing


def test_room_double_booking(world) -> None:
    corpus, truth, schedule = world
    a = schedule[0]
    b = first_other(schedule, a, lambda o: o["day"] == a["day"] and o["slot"] == a["slot"])
    b["room"] = a["room"]
    assert "room_double_booking" in kinds(schedule, corpus, truth)


def test_speaker_double_booking_and_track_rule(world) -> None:
    corpus, truth, schedule = world
    speaker_of, track_of = truth["speaker_of"], truth["track_of"]
    a = next(
        e
        for e in schedule
        if sum(speaker_of[o["talk_id"]] == speaker_of[e["talk_id"]] for o in schedule) > 1
    )
    b = first_other(schedule, a, lambda o: speaker_of[o["talk_id"]] == speaker_of[a["talk_id"]])
    moved = [dict(e) for e in schedule]
    target = next(e for e in moved if e["talk_id"] == b["talk_id"])
    target |= {"day": a["day"], "slot": a["slot"]}
    found = kinds(moved, corpus, truth)
    assert "speaker_double_booking" in found
    if track_of[a["talk_id"]] == track_of[b["talk_id"]]:
        assert "track_parallel" in found


def test_track_rule(world) -> None:
    corpus, truth, schedule = world
    track_of = truth["track_of"]
    a = schedule[0]
    b = first_other(
        schedule,
        a,
        lambda o: track_of[o["talk_id"]] == track_of[a["talk_id"]] and o["day"] == a["day"],
    )
    b |= {"slot": a["slot"], "room": next(r["id"] for r in corpus["rooms"] if r["id"] != a["room"])}
    assert "track_parallel" in kinds(schedule, corpus, truth)


def test_capacity(world) -> None:
    corpus, truth, schedule = world
    smallest = min(corpus["rooms"], key=lambda r: r["capacity"])
    big = next(e for e in schedule if truth["attendance"][e["talk_id"]] > smallest["capacity"])
    big["room"] = smallest["id"]
    assert "over_capacity" in kinds(schedule, corpus, truth)


def test_availability(world) -> None:
    corpus, truth, schedule = world
    every = {(d, s["index"]) for d in corpus["days"] for s in corpus["slots"]}

    def allowed(entry):
        return {tuple(c) for c in truth["availability"][truth["speaker_of"][entry["talk_id"]]]}

    entry = next(e for e in schedule if allowed(e) != every)
    entry["day"], entry["slot"] = sorted(every - allowed(entry))[0]
    assert "unavailable" in kinds(schedule, corpus, truth)


def test_session_checks_restrict_to_the_session(world) -> None:
    corpus, truth, schedule = world
    day1 = [e for e in schedule if e["day"] == 1]
    talk_ids = [e["talk_id"] for e in day1]
    assert kinds(day1, corpus, truth, talk_ids=talk_ids, day=1) == set()
    assert "wrong_day" in kinds(day1, corpus, truth, talk_ids=talk_ids, day=2)


def test_soft_score_is_a_share(world) -> None:
    corpus, truth, schedule = world
    score = check(schedule, corpus, truth).soft_score
    assert 0.0 <= score <= 1.0
