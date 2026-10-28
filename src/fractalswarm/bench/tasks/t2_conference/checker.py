"""Deterministic T2 checker: hard constraints against the ground truth, plus a soft score.

Hard constraints (spec §11, §15.3):
- ``invalid``: unknown talk, day, slot or room;
- ``duplicate``: a talk placed more than once;
- ``missing``: a talk of the checked set not placed;
- ``room_double_booking``: two talks in one room at one (day, slot);
- ``speaker_double_booking``: one speaker in two talks at one (day, slot);
- ``unavailable``: a talk outside its speaker's availability;
- ``over_capacity``: expected attendance above the room's capacity;
- ``track_parallel``: two talks of one track at one (day, slot) (track rule);
- ``wrong_day``: a talk outside the day of the session that owns it (session checks only).

The soft score is the share of speakers with a time preference whose talks all honor it.
"""

from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel, ConfigDict


class Placement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    talk_id: str
    day: int
    slot: int
    room: str


class Violation(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: str
    talks: list[str]
    detail: str


class CheckReport(BaseModel):
    hard_violations: list[Violation]
    soft_score: float
    placed: int
    expected: int

    @property
    def ok(self) -> bool:
        return not self.hard_violations

    def counts(self) -> dict[str, int]:
        counts: dict[str, int] = defaultdict(int)
        for violation in self.hard_violations:
            counts[violation.kind] += 1
        return dict(sorted(counts.items()))


def check(
    placements: Iterable[Placement | dict[str, Any]],
    corpus: dict[str, Any],
    truth: dict[str, Any],
    *,
    talk_ids: Iterable[str] | None = None,
    day: int | None = None,
) -> CheckReport:
    """Check a schedule. ``talk_ids`` (and ``day``) restrict it to one session's talks."""
    items = [p if isinstance(p, Placement) else Placement.model_validate(p) for p in placements]
    rooms = {room["id"]: room["capacity"] for room in corpus["rooms"]}
    days = set(corpus["days"])
    slots = {slot["index"] for slot in corpus["slots"]}
    known = set(truth["track_of"])
    expected = sorted(set(talk_ids) if talk_ids is not None else known)
    available = {
        speaker: {(d, s) for d, s in cells} for speaker, cells in truth["availability"].items()
    }
    violations: list[Violation] = []

    def add(kind: str, talks: Iterable[str], detail: str) -> None:
        violations.append(Violation(kind=kind, talks=sorted(talks), detail=detail))

    valid: list[Placement] = []
    seen: dict[str, int] = defaultdict(int)
    for item in sorted(items, key=lambda p: (p.talk_id, p.day, p.slot, p.room)):
        seen[item.talk_id] += 1
        problems = []
        if item.talk_id not in known:
            problems.append(f"unknown talk {item.talk_id}")
        if item.day not in days:
            problems.append(f"unknown day {item.day}")
        if item.slot not in slots:
            problems.append(f"unknown slot {item.slot}")
        if item.room not in rooms:
            problems.append(f"unknown room {item.room}")
        if problems:
            add("invalid", [item.talk_id], "; ".join(problems))
            continue
        if seen[item.talk_id] > 1:
            add("duplicate", [item.talk_id], f"{item.talk_id} is placed more than once")
            continue
        valid.append(item)

    for talk in expected:
        if seen[talk] == 0:
            add("missing", [talk], f"{talk} is not placed")

    by_room: dict[tuple, list[str]] = defaultdict(list)
    by_speaker: dict[tuple, list[str]] = defaultdict(list)
    by_track: dict[tuple, list[str]] = defaultdict(list)
    for item in valid:
        speaker = truth["speaker_of"][item.talk_id]
        by_room[(item.day, item.slot, item.room)].append(item.talk_id)
        by_speaker[(item.day, item.slot, speaker)].append(item.talk_id)
        by_track[(item.day, item.slot, truth["track_of"][item.talk_id])].append(item.talk_id)
        where = f"day {item.day} slot {item.slot}"
        if (item.day, item.slot) not in available[speaker]:
            add("unavailable", [item.talk_id], f"{speaker} is not available on {where}")
        people = truth["attendance"][item.talk_id]
        if people > rooms[item.room]:
            add(
                "over_capacity",
                [item.talk_id],
                f"{people} expected in {item.room} (capacity {rooms[item.room]})",
            )
        if day is not None and item.day != day:
            add("wrong_day", [item.talk_id], f"{item.talk_id} is on day {item.day}, not {day}")

    for kind, groups in (
        ("room_double_booking", by_room),
        ("speaker_double_booking", by_speaker),
        ("track_parallel", by_track),
    ):
        for key in sorted(groups):
            if len(groups[key]) > 1:
                add(kind, groups[key], f"{', '.join(map(str, key))}: {len(groups[key])} talks")

    return CheckReport(
        hard_violations=violations,
        soft_score=soft_score(valid, corpus, truth),
        placed=len(valid),
        expected=len(expected),
    )


def soft_score(placements: list[Placement], corpus: dict[str, Any], truth: dict[str, Any]) -> float:
    morning = {slot["index"] for slot in corpus["slots"] if slot["start"] < "12:30"}
    talks_of: dict[str, list[Placement]] = defaultdict(list)
    for item in placements:
        talks_of[truth["speaker_of"][item.talk_id]].append(item)
    scored = honored = 0
    for speaker, preference in sorted(truth["preferences"].items()):
        if preference is None or speaker not in talks_of:
            continue
        scored += 1
        wanted = (
            (lambda s: s in morning) if preference == "morning" else (lambda s: s not in morning)
        )
        honored += all(wanted(item.slot) for item in talks_of[speaker])
    return round(honored / scored, 4) if scored else 1.0
