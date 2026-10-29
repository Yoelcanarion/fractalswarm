"""intake/shape.py: any reading of pasted text becomes the one program shape, with a warning
for every change it forces, and an error for what cannot be fitted."""

from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.bench.tasks.t2_conference.generator import ROOMS, SLOT_STARTS
from fractalswarm.intake.shape import (
    MAX_TALKS,
    MIN_PER_TRACK,
    MIN_TALKS,
    TRACK_COUNT,
    normalize,
    shape,
)


def talk(index: int, track: str, speaker: str | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "title": f"Talk {index}",
        "speaker": speaker or f"Speaker {index}",
        "track": track,
        "abstract": f"About talk {index}.",
        "track_source": "",
    } | extra


def reading(talks: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    names = list(dict.fromkeys(t["speaker"] for t in talks))
    return {
        "conference": "Test Conf",
        "tracks": list(dict.fromkeys(t["track"] for t in talks)),
        "talks": talks,
        "speakers": [{"name": n, "email": "", "note": f"Note of {n}."} for n in names],
        "rooms": [],
        "reference": {"availability": [], "preferences": [], "attendance": []},
        "warnings": [],
    } | extra


def spread(tracks: list[str], count: int) -> list[dict[str, Any]]:
    return [talk(i, tracks[i % len(tracks)]) for i in range(count)]


def counts(proposal: dict[str, Any]) -> dict[str, int]:
    found = {track["id"]: 0 for track in proposal["tracks"]}
    for item in proposal["talks"]:
        found[item["track_id"]] += 1
    return found


# -- the shape ------------------------------------------------------------------------------


def test_three_tracks_stay_as_they_are() -> None:
    proposal = shape(reading(spread(["A", "B", "C"], 9)))
    assert [t["name"] for t in proposal["tracks"]] == ["A", "B", "C"]
    assert proposal["errors"] == [] and proposal["warnings"] == []
    assert [t["id"] for t in proposal["talks"]] == [f"T{i:02d}" for i in range(1, 10)]
    assert proposal["days"] == [1, 2]
    assert [s["start"] for s in proposal["slots"]] == SLOT_STARTS
    assert proposal["rooms"] == ROOMS


def test_four_tracks_merge_the_two_smallest_with_a_warning() -> None:
    talks = [talk(i, "ABCD"[i % 4]) for i in range(10)]  # A3 B3 C2 D2
    proposal = shape(reading(talks))
    assert [t["name"] for t in proposal["tracks"]] == ["A", "B", "C / D"]
    assert sorted(counts(proposal).values()) == [3, 3, 4]
    assert len(proposal["warnings"]) == 1 and "merged" in proposal["warnings"][0]
    merged = next(t for t in proposal["tracks"] if t["name"] == "C / D")
    assert {x["track_label"] for x in proposal["talks"] if x["track_id"] == merged["id"]} == {
        "C",
        "D",
    }


def test_one_track_splits_twice() -> None:
    proposal = shape(reading(spread(["Only"], 10)))
    assert len(proposal["tracks"]) == TRACK_COUNT
    assert all(n >= MIN_PER_TRACK for n in counts(proposal).values())
    assert sum("split" in w for w in proposal["warnings"]) == 2
    assert proposal["errors"] == []


def test_two_tracks_split_the_larger() -> None:
    talks = [talk(i, "A" if i < 6 else "B") for i in range(9)]  # A6 B3
    proposal = shape(reading(talks))
    assert [t["name"] for t in proposal["tracks"]] == ["A, part 1", "A, part 2", "B"]
    assert counts(proposal).values() and sorted(counts(proposal).values()) == [3, 3, 3]


def test_a_track_with_one_talk_takes_one_from_the_fullest() -> None:
    talks = [talk(i, "A") for i in range(6)] + [talk(6, "B"), talk(7, "B"), talk(8, "C")]
    proposal = shape(reading(talks))
    assert all(n >= MIN_PER_TRACK for n in counts(proposal).values())
    assert any("moved" in w for w in proposal["warnings"])
    assert proposal["errors"] == []


def test_more_than_fifteen_talks_keep_the_first_fifteen() -> None:
    proposal = shape(reading(spread(["A", "B", "C"], 20)))
    assert len(proposal["talks"]) == MAX_TALKS
    assert proposal["talks"][-1]["title"] == "Talk 14"
    assert "left out 'Talk 15'" in proposal["warnings"][0]


def test_fewer_than_eight_talks_cannot_be_approved() -> None:
    proposal = shape(reading(spread(["A", "B", "C"], 6)))
    assert any(f"at least {MIN_TALKS}" in e for e in proposal["errors"])


def test_a_talk_without_a_known_track_is_an_error_to_fix() -> None:
    talks = spread(["A", "B", "C"], 9)
    talks[0]["track"] = ""
    proposal = shape(reading(talks))
    assert any("has no track" in e for e in proposal["errors"])


def test_ids_follow_the_text_and_speakers_are_numbered_by_first_talk() -> None:
    talks = [
        talk(0, "A", "Zed"),
        talk(1, "B", "Amy"),
        talk(2, "C", "Zed"),
        *spread(["A", "B", "C"], 6)[3:],
    ]
    proposal = shape(reading(talks))
    assert [s["name"] for s in proposal["speakers"][:2]] == ["Zed", "Amy"]
    assert proposal["talks"][2]["speaker_id"] == proposal["talks"][0]["speaker_id"] == "S01"


def test_a_speaker_without_a_talk_is_left_out_with_a_warning() -> None:
    read = reading(spread(["A", "B", "C"], 9))
    read["speakers"].append({"name": "Ghost", "email": "", "note": ""})
    proposal = shape(read)
    assert "Ghost" not in [s["name"] for s in proposal["speakers"]]
    assert any("Ghost has no talk" in w for w in proposal["warnings"])


def test_a_talk_whose_speaker_wrote_nothing_is_still_programmed() -> None:
    talks = spread(["A", "B", "C"], 9)
    read = reading(talks)
    read["speakers"] = read["speakers"][1:]  # nobody wrote for speaker 0
    proposal = shape(read)
    first = proposal["speakers"][0]
    assert first["name"] == "Speaker 0" and first["note"] == ""
    assert any("wrote no note" in w for w in proposal["warnings"])


# -- the reference --------------------------------------------------------------------------


def test_reference_facts_land_on_their_speaker_and_talk() -> None:
    read = reading(spread(["A", "B", "C"], 9))
    read["reference"] = {
        "availability": [
            {
                "speaker": "speaker 1",  # case does not matter
                "available": [{"day": 1, "slots": [2, 1, 1]}, {"day": 3, "slots": [0]}],
                "source": "Only day 1, thanks.",
            }
        ],
        "preferences": [
            {"speaker": "Speaker 2", "preference": "morning", "source": "Mornings."},
            {"speaker": "Speaker 3", "preference": "none", "source": "Whenever."},
        ],
        "attendance": [{"talk": "Talk 4", "attendance": 120, "source": "About 120."}],
    }
    proposal = shape(read)
    by_name = {s["name"]: s for s in proposal["speakers"]}
    assert by_name["Speaker 1"]["available"] == [[1, 1], [1, 2]]  # day 3 is not a day
    assert by_name["Speaker 1"]["availability_source"] == "Only day 1, thanks."
    assert by_name["Speaker 2"]["preference"] == "morning"
    assert by_name["Speaker 3"]["preference"] is None
    assert by_name["Speaker 3"]["preference_source"] == "Whenever."
    assert by_name["Speaker 4"]["available"] is None  # said nothing: any time
    assert next(t for t in proposal["talks"] if t["title"] == "Talk 4")["attendance"] == 120


def test_facts_about_nobody_are_dropped_with_a_warning() -> None:
    read = reading(spread(["A", "B", "C"], 9))
    read["reference"]["attendance"] = [{"talk": "No Such", "attendance": 5, "source": "x"}]
    read["reference"]["availability"] = [{"speaker": "Nobody", "available": [], "source": "x"}]
    proposal = shape(read)
    assert sum("ignored" in w for w in proposal["warnings"]) == 2


def test_quotes_that_are_not_in_the_text_are_flagged() -> None:
    read = reading(spread(["A", "B", "C"], 9))
    read["reference"]["preferences"] = [
        {"speaker": "Speaker 1", "preference": "morning", "source": "I love  MORNINGS."},
        {"speaker": "Speaker 2", "preference": "morning", "source": "Made up by the model."},
    ]
    texts = {"talks": "...", "notes": "He said: i love mornings. Then left."}
    proposal = shape(read, texts)
    flagged = [w for w in proposal["warnings"] if "not word for word" in w]
    # Speaker 1 is S02 and Speaker 2 is S03 (the fixture counts from 0)
    assert any("S03 preference source" in w for w in flagged)
    assert not any("S02 preference source" in w for w in flagged)  # spacing and case aside


# -- the rooms ------------------------------------------------------------------------------


def test_the_persons_rooms_replace_the_default_ones() -> None:
    rooms = [{"name": "Aula Magna", "capacity": 300}, {"name": "Sala 2", "capacity": 40}]
    proposal = shape(reading(spread(["A", "B", "C"], 9)), rooms=rooms)
    assert proposal["rooms"] == [
        {"id": "room-aula-magna", "name": "Aula Magna", "capacity": 300},
        {"id": "room-sala-2", "name": "Sala 2", "capacity": 40},
    ]
    assert proposal["errors"] == []


def test_one_room_is_not_enough_and_zero_capacity_is_wrong() -> None:
    one = shape(reading(spread(["A", "B", "C"], 9)), rooms=[{"name": "R", "capacity": 50}])
    assert any("at least 2 rooms" in e for e in one["errors"])
    bad = shape(
        reading(spread(["A", "B", "C"], 9)),
        rooms=[{"name": "R", "capacity": 0}, {"name": "S", "capacity": 10}],
    )
    assert any("capacity" in e for e in bad["errors"])


# -- properties -----------------------------------------------------------------------------

names = st.sampled_from(["Alpha", "Beta", "Gamma", "Delta", "Eps", "Zeta", "Eta"])


@st.composite
def readings(draw: st.DrawFn) -> dict[str, Any]:
    n = draw(st.integers(min_value=0, max_value=30))
    people = draw(st.integers(min_value=1, max_value=12))
    talks = [talk(i, draw(names), f"Person {draw(st.integers(0, people - 1))}") for i in range(n)]
    return reading(talks)


@settings(max_examples=150, deadline=None)
@given(readings())
def test_any_reading_fits_the_shape_or_says_why_not(read: dict[str, Any]) -> None:
    proposal = shape(read)
    if len(read["talks"]) >= MIN_TALKS:
        assert proposal["errors"] == []
        assert len(proposal["tracks"]) == TRACK_COUNT
        assert all(n >= MIN_PER_TRACK for n in counts(proposal).values())
        assert MIN_TALKS <= len(proposal["talks"]) <= MAX_TALKS
    else:
        assert any(f"at least {MIN_TALKS}" in e for e in proposal["errors"])
    ids = [t["id"] for t in proposal["talks"]]
    assert ids == [f"T{i:02d}" for i in range(1, len(ids) + 1)]
    speakers = [s["id"] for s in proposal["speakers"]]
    assert speakers == [f"S{i:02d}" for i in range(1, len(speakers) + 1)]
    assert {t["speaker_id"] for t in proposal["talks"]} <= set(speakers)
    assert {t["track_id"] for t in proposal["talks"]} <= {t["id"] for t in proposal["tracks"]}
    if len({t["track"] for t in read["talks"]}) != TRACK_COUNT and len(read["talks"]) >= MIN_TALKS:
        assert proposal["warnings"], "a merge or a split is never silent"


@settings(max_examples=150, deadline=None)
@given(readings())
def test_normalizing_twice_changes_nothing(read: dict[str, Any]) -> None:
    once = shape(read)
    assert normalize(once) == once
    assert shape(read) == once  # and the same reading always gives the same proposal
