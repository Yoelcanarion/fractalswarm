"""Fit the model's reading of the pasted text to the one shape a T2 run takes.

The model reports what the text says, however many tracks and talks that is. The program the
swarm schedules is fixed: 2 days on the generator's slot grid (so the 12:30 and 14:00 cut-offs
of "morning" and "afternoon" stay valid), exactly 3 tracks with at least 2 talks each, and 8 to 15
talks. Everything here is pure and deterministic: the same reading gives the same proposal,
and every change the shape forces on the text (a merge, a split, a talk left out) is a warning,
so nothing happens silently. What cannot be fitted is an error, and an input with an error
cannot be approved.

``from_read`` turns the model's answer into a proposal, the document a person reviews and
edits; ``normalize`` fits any proposal, including an edited one, and is idempotent.

The proposal (flat, so a review table edits it row by row)::

    {conference, days, slots, rooms[{id,name,capacity}], tracks[{id,name,description}],
     speakers[{id,name,email,note,available,availability_source,preference,preference_source}],
     talks[{id,title,speaker_id,track_id,track_label,abstract,track_source,
            attendance,attendance_source}],
     warnings[], errors[]}

``available`` is a list of ``[day, slot]`` cells, or ``None`` when the text states nothing (any
time). ``preference`` is ``morning``, ``afternoon`` or ``None``; ``attendance`` an int, or
``None`` when the text states nothing (no capacity constraint).
"""

import copy
import re
from typing import Any

from fractalswarm.bench.tasks.t2_conference.generator import DAYS, ROOMS, SLOT_STARTS, slot_end

MIN_TALKS = 8
MAX_TALKS = 15
TRACK_COUNT = 3
MIN_PER_TRACK = 2
MIN_ROOMS = 2  # the root gives each track a home room that is not the largest
LEFT_OUT_SHOWN = 5


def slot_grid() -> list[dict[str, Any]]:
    return [{"index": i, "start": start, "end": slot_end(i)} for i, start in enumerate(SLOT_STARTS)]


def all_cells() -> list[list[int]]:
    return [[day, slot] for day in DAYS for slot in range(len(SLOT_STARTS))]


def slug(text: str, limit: int = 24) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit].strip("-") or "x"


def _key(text: str) -> str:
    """A name or title as a key: case, spacing and edge punctuation do not tell two apart."""
    return " ".join(text.casefold().split()).strip(" .,;:-\"'")


def _squash(text: str) -> str:
    return " ".join(text.split()).casefold()


def present(sentence: str, texts: dict[str, str]) -> bool:
    """Whether ``sentence`` is in the pasted text (spacing and case aside). Empty is fine."""
    wanted = _squash(sentence)
    return not wanted or any(wanted in _squash(text) for text in texts.values())


def _unique(base: str, taken: set[str]) -> str:
    name, n = base, 2
    while name in taken:
        name, n = f"{base}-{n}", n + 1
    taken.add(name)
    return name


# -- the model's answer -> a proposal ------------------------------------------------------


def from_read(read: dict[str, Any], rooms: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The model's reading (``IntakeOutput`` as a dict) as an unnormalized proposal. ``rooms``
    are the person's own: when they gave none, the model's are used if the text lists some."""
    warnings = [w.strip() for w in read.get("warnings", []) if w.strip()]
    ids: set[str] = set()
    tracks: dict[str, dict[str, Any]] = {}  # key of the name -> track
    names = [*read.get("tracks", []), *(talk["track"] for talk in read.get("talks", []))]
    for name in names:
        name = " ".join(name.split())
        if name and _key(name) not in tracks:
            tracks[_key(name)] = {
                "id": _unique(f"track-{slug(name)}", ids),
                "name": name,
                "description": "",
            }

    people: dict[str, dict[str, Any]] = {}  # key of the name -> speaker (in order of the text)
    for speaker in read.get("speakers", []):
        name = " ".join(speaker["name"].split())
        if name and _key(name) not in people:
            people[_key(name)] = _speaker(name, speaker["email"].strip(), speaker["note"].strip())
    for talk in read.get("talks", []):
        name = " ".join(talk["speaker"].split())
        if name and _key(name) not in people:
            people[_key(name)] = _speaker(name, "", "")
            warnings.append(f"{name} gives a talk but wrote no note: any time is assumed")

    talks: list[dict[str, Any]] = []
    for talk in read.get("talks", []):
        title = " ".join(talk["title"].split())
        track = tracks.get(_key(talk["track"]))
        speaker = people.get(_key(talk["speaker"]))
        if not title:
            continue
        if speaker is None:
            warnings.append(f"'{title}' has no speaker name: left out")
            continue
        talks.append(
            {
                "id": "",
                "title": title,
                "speaker_id": speaker["name"],  # the name for now; ids are given on normalize
                "track_id": track["id"] if track else "",
                "track_label": " ".join(talk["track"].split()),
                "abstract": talk["abstract"].strip(),
                "track_source": talk["track_source"].strip(),
                "attendance": None,
                "attendance_source": "",
            }
        )
    by_title = {_key(talk["title"]): talk for talk in talks}

    reference = read.get("reference", {})
    for item in reference.get("availability", []):
        person = people.get(_key(item["speaker"]))
        cells = _cells(item["available"])
        if person is None:
            warnings.append(f"availability for {item['speaker']!r} ignored: no such speaker")
        elif not cells:
            warnings.append(f"{person['name']}: availability had no usable slot: any time assumed")
        elif person["available"] is None:
            person["available"], person["availability_source"] = cells, item["source"].strip()
    for item in reference.get("preferences", []):
        person = people.get(_key(item["speaker"]))
        if person is None:
            warnings.append(f"preference of {item['speaker']!r} ignored: no such speaker")
        elif person["preference_source"] == "":
            value = None if item["preference"] == "none" else item["preference"]
            person["preference"], person["preference_source"] = value, item["source"].strip()
    for item in reference.get("attendance", []):
        talk = by_title.get(_key(item["talk"]))
        if talk is None:
            warnings.append(f"attendance of {item['talk']!r} ignored: no such talk")
        elif talk["attendance"] is None and item["attendance"] >= 0:
            talk["attendance"], talk["attendance_source"] = item["attendance"], item["source"]

    return {
        "conference": " ".join(read.get("conference", "").split()),
        "rooms": _rooms(rooms) or _rooms(read.get("rooms")),
        "tracks": list(tracks.values()),
        "speakers": list(people.values()),
        "talks": talks,
        "warnings": warnings,
    }


def _speaker(name: str, email: str, note: str) -> dict[str, Any]:
    return {
        "id": name,  # the name for now
        "name": name,
        "email": email,
        "note": note,
        "available": None,
        "availability_source": "",
        "preference": None,
        "preference_source": "",
    }


def _cells(available: list[dict[str, Any]]) -> list[list[int]]:
    slots = range(len(SLOT_STARTS))
    cells = {
        (item["day"], slot) for item in available for slot in item["slots"] if item["day"] in DAYS
    }
    return [[day, slot] for day, slot in sorted(cells) if slot in slots]


def _rooms(rooms: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """The rooms a person (or the text) gave: ``{name, capacity}``, plus an id when it has one."""
    found = []
    for room in rooms or []:
        name = " ".join(str(room.get("name", "")).split())
        if name:
            found.append({"id": room.get("id") or "", "name": name, "capacity": room["capacity"]})
    return found


# -- any proposal -> the fixed shape -------------------------------------------------------


def normalize(draft: dict[str, Any], texts: dict[str, str] | None = None) -> dict[str, Any]:
    """Fit a proposal to the shape: exactly 3 tracks, at least 2 talks each, 8-15 talks, ids
    T01/S01 in order. Idempotent. ``texts`` (the pasted segments) turn on the check that every
    quoted sentence is really in them."""
    warnings = list(dict.fromkeys(draft.get("warnings", [])))
    errors: list[str] = []
    tracks = [dict(track) for track in draft.get("tracks", [])]
    talks = [dict(talk) for talk in draft.get("talks", []) if str(talk.get("title", "")).strip()]
    people = {person["id"]: dict(person) for person in draft.get("speakers", [])}

    if len(talks) > MAX_TALKS:
        left_out = talks[MAX_TALKS:]
        shown = "; ".join(f"'{talk['title']}'" for talk in left_out[:LEFT_OUT_SHOWN])
        more = " …" if len(left_out) > LEFT_OUT_SHOWN else ""
        warnings.append(
            f"the program takes {MAX_TALKS} talks: kept the first {MAX_TALKS} of {len(talks)}; "
            f"left out {shown}{more}"
        )
        talks = talks[:MAX_TALKS]

    known = {track["id"] for track in tracks}
    for talk in talks:
        if talk.get("track_id") not in known:
            errors.append(f"'{talk['title']}' has no track: give it one of the program's tracks")
            talk["track_id"] = ""
        if talk.get("speaker_id") not in people:
            errors.append(f"'{talk['title']}' has no speaker: give it one")
    used = {talk["track_id"] for talk in talks}
    for track in [t for t in tracks if t["id"] not in used]:
        warnings.append(f"track {track['name']!r} has no talks: left out")
    tracks = [track for track in tracks if track["id"] in used]

    while len(tracks) > TRACK_COUNT:
        tracks = _merge_smallest(tracks, talks, warnings)
    while len(tracks) < TRACK_COUNT and _split_largest(tracks, talks, warnings):
        pass
    while _rebalance(tracks, talks, warnings):
        pass

    if len(tracks) != TRACK_COUNT:
        errors.append(f"the program has {TRACK_COUNT} tracks; the text gave {len(tracks)}")
    if len(talks) < MIN_TALKS:
        errors.append(f"found {len(talks)} talks; the program needs at least {MIN_TALKS}")
    elif any(_count(talks, track["id"]) < MIN_PER_TRACK for track in tracks):
        errors.append(f"every track needs at least {MIN_PER_TRACK} talks")

    proposal = _renumber(draft, tracks, talks, people, warnings)
    rooms, room_errors = _fix_rooms(draft.get("rooms") or [])
    proposal["rooms"] = rooms
    errors += room_errors
    if texts is not None:
        warnings += _unquoted(proposal, texts)
    proposal["warnings"] = list(dict.fromkeys(warnings))
    proposal["errors"] = list(dict.fromkeys(errors))
    return proposal


def _count(talks: list[dict[str, Any]], track_id: str) -> int:
    return sum(talk["track_id"] == track_id for talk in talks)


def _track_ids(tracks: list[dict[str, Any]]) -> set[str]:
    return {track["id"] for track in tracks}


def _merge_smallest(tracks: list[dict[str, Any]], talks: list[dict[str, Any]], warnings: list[str]):
    sizes = sorted(range(len(tracks)), key=lambda i: (_count(talks, tracks[i]["id"]), i))
    first, second = sorted(sizes[:2])
    a, b = tracks[first], tracks[second]
    taken = _track_ids(tracks) - {a["id"], b["id"]}
    merged = {
        "id": _unique(f"track-{slug(a['name'] + ' ' + b['name'])}", taken),
        "name": f"{a['name']} / {b['name']}",
        "description": f"Merges {a['name']} and {b['name']}",
    }
    for talk in talks:
        if talk["track_id"] in (a["id"], b["id"]):
            talk["track_id"] = merged["id"]
    warnings.append(
        f"merged tracks {a['name']!r} and {b['name']!r} into {merged['name']!r} "
        f"(the program has exactly {TRACK_COUNT} tracks)"
    )
    return [merged if i == first else t for i, t in enumerate(tracks) if i != second]


def _split_largest(
    tracks: list[dict[str, Any]], talks: list[dict[str, Any]], warnings: list[str]
) -> bool:
    sizes = [(-_count(talks, track["id"]), i) for i, track in enumerate(tracks)]
    if not sizes:
        return False
    _, at = min(sizes)
    track = tracks[at]
    members = [talk for talk in talks if talk["track_id"] == track["id"]]
    if len(members) < 2:
        return False
    taken = _track_ids(tracks) - {track["id"]}
    parts = [
        {
            "id": _unique(f"track-{slug(track['name'])}-{n}", taken),
            "name": f"{track['name']}, part {n}",
            "description": f"Part {n} of {track['name']}",
        }
        for n in (1, 2)
    ]
    keep = (len(members) + 1) // 2
    for index, talk in enumerate(members):
        talk["track_id"] = parts[0 if index < keep else 1]["id"]
    tracks[at : at + 1] = parts
    warnings.append(
        f"split track {track['name']!r} into {parts[0]['name']!r} and {parts[1]['name']!r} "
        f"(the program has exactly {TRACK_COUNT} tracks)"
    )
    return True


def _rebalance(
    tracks: list[dict[str, Any]], talks: list[dict[str, Any]], warnings: list[str]
) -> bool:
    """Move the last talk of the fullest track to the emptiest, while one has too few."""
    if len(tracks) < 2:
        return False
    counts = [_count(talks, track["id"]) for track in tracks]
    low = min(range(len(tracks)), key=lambda i: (counts[i], i))
    high = max(range(len(tracks)), key=lambda i: (counts[i], -i))
    if counts[low] >= MIN_PER_TRACK or counts[high] <= MIN_PER_TRACK:
        return False
    moved = [talk for talk in talks if talk["track_id"] == tracks[high]["id"]][-1]
    moved["track_id"] = tracks[low]["id"]
    warnings.append(
        f"moved '{moved['title']}' from {tracks[high]['name']!r} to {tracks[low]['name']!r} "
        f"(every track needs at least {MIN_PER_TRACK} talks)"
    )
    return True


def _renumber(
    draft: dict[str, Any],
    tracks: list[dict[str, Any]],
    talks: list[dict[str, Any]],
    people: dict[str, dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    """T01.. in order, S01.. in order of first appearance; speakers with no talk are left out."""
    wanted = (talk["speaker_id"] for talk in talks)
    order = [speaker for speaker in dict.fromkeys(wanted) if speaker in people]
    new = {old: f"S{i + 1:02d}" for i, old in enumerate(order)}
    for old in people:
        if old not in new:
            warnings.append(f"{people[old]['name']} has no talk in the program: left out")
    speakers = [{**people[old], "id": new[old]} for old in order]
    for person in speakers:
        person["available"] = _cells_of(person.get("available"))
        if person.get("preference") not in ("morning", "afternoon"):
            person["preference"] = None
    renumbered = []
    for i, talk in enumerate(talks):
        attendance = talk.get("attendance")
        renumbered.append(
            {
                "id": f"T{i + 1:02d}",
                "title": talk["title"],
                "speaker_id": new.get(talk["speaker_id"], ""),
                "track_id": talk["track_id"],
                "track_label": talk.get("track_label") or "",
                "abstract": talk.get("abstract") or "",
                "track_source": talk.get("track_source") or "",
                "attendance": int(attendance) if attendance is not None else None,
                "attendance_source": talk.get("attendance_source") or "",
            }
        )
    return {
        "conference": draft.get("conference") or "Untitled conference",
        "days": list(DAYS),
        "slots": slot_grid(),
        "tracks": tracks,
        "speakers": speakers,
        "talks": renumbered,
    }


def _cells_of(cells: Any) -> list[list[int]] | None:
    if cells is None:
        return None
    usable = {
        (int(day), int(slot))
        for day, slot in cells
        if int(day) in DAYS and 0 <= int(slot) < len(SLOT_STARTS)
    }
    return [[day, slot] for day, slot in sorted(usable)] or None


def _fix_rooms(rooms: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    if not rooms:
        return copy.deepcopy(ROOMS), []
    ids: set[str] = set()
    fixed, errors = [], []
    for room in rooms:
        name = " ".join(str(room.get("name", "")).split())
        capacity = room.get("capacity")
        if not name:
            errors.append("every room needs a name")
        elif not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
            errors.append(f"room {name!r} needs a capacity of at least 1")
        else:
            ident = room.get("id") or f"room-{slug(name)}"
            fixed.append({"id": _unique(ident, ids), "name": name, "capacity": capacity})
    if len(fixed) < MIN_ROOMS and not errors:
        errors.append(f"give at least {MIN_ROOMS} rooms, or none to use the default rooms")
    return fixed, errors


def _unquoted(proposal: dict[str, Any], texts: dict[str, str]) -> list[str]:
    """Warnings for each quote that is not in the pasted text: the model reworded it."""
    found = []
    for talk in proposal["talks"]:
        for field in ("abstract", "track_source", "attendance_source"):
            if not present(talk[field], texts):
                found.append(f"{talk['id']} {field.replace('_', ' ')} is not word for word")
    for person in proposal["speakers"]:
        for field in ("note", "availability_source", "preference_source"):
            if not present(person[field], texts):
                found.append(f"{person['id']} {field.replace('_', ' ')} is not word for word")
    return found


def shape(
    read: dict[str, Any],
    texts: dict[str, str] | None = None,
    rooms: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The model's reading as a normalized proposal: what ``intake.proposed`` logs."""
    return normalize(from_read(read, rooms), texts)
