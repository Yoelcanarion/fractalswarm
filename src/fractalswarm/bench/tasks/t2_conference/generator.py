"""Seeded generator for T2: a two-day conference program from messy inputs (spec §15.3).

It first draws a feasible ground-truth schedule (rooms × slots × days, one talk per track and
slot at most), then writes the messy inputs that are consistent with it:

- talk submissions whose free-text abstracts state the expected audience;
- speaker emails whose free text states availability and a soft preference.

The corpus (what agents see) and the truth (what the checker sees) go to separate files:
``tasks/fixtures/t2/seed-<n>/corpus.json`` and ``truth.json``.

    uv run python -m fractalswarm.bench.tasks.t2_conference.generator --seed 1
"""

import argparse
import json
import random
from pathlib import Path
from typing import Any

DAYS = [1, 2]
SLOT_STARTS = ["09:00", "09:45", "10:30", "11:15", "12:00", "14:00", "14:45", "15:30", "16:15"]
SLOT_MINUTES = 45
MORNING_SLOTS = [0, 1, 2, 3, 4]  # start before 12:30
AFTERNOON_SLOTS = [5, 6, 7, 8]  # start at 14:00 or later
TALKS_PER_SESSION = 8
SPEAKERS = 32

TRACKS = [
    {
        "id": "track-ai",
        "name": "AI Systems",
        "description": "Training, serving and evaluating machine-learning systems.",
        "labels": ["AI Systems", "ai systems", "AI systems track", "AI-Systems"],
        "topics": [
            "speculative decoding",
            "retrieval-augmented generation",
            "model distillation",
            "LLM evaluation harnesses",
            "GPU scheduling",
            "agent tool use",
            "prompt caching",
            "quantized inference",
            "multi-agent planning",
            "reward modelling",
            "long-context attention",
            "on-device models",
        ],
    },
    {
        "id": "track-data",
        "name": "Data Infrastructure",
        "description": "Storage, streaming, query engines and data reliability.",
        "labels": ["Data Infrastructure", "data infrastructure", "Data infra track", "DATA INFRA"],
        "topics": [
            "stream processing",
            "columnar storage",
            "query optimization",
            "change data capture",
            "data contracts",
            "lakehouse tables",
            "vector databases",
            "event sourcing",
            "schema evolution",
            "data lineage",
            "cost-aware warehousing",
            "SQLite at the edge",
        ],
    },
    {
        "id": "track-hci",
        "name": "Human-Centered Computing",
        "description": "Design, accessibility and how people work with software.",
        "labels": ["Human-Centered Computing", "human-centered computing", "HCC track", "HCI"],
        "topics": [
            "accessible interfaces",
            "trust in AI assistants",
            "developer experience",
            "visualizing uncertainty",
            "voice interfaces",
            "onboarding design",
            "explainable recommendations",
            "collaborative editing",
            "notification fatigue",
            "inclusive language tools",
            "dark patterns",
            "usability testing at scale",
        ],
    },
]

ROOMS = [
    {"id": "main-hall", "name": "Main Hall", "capacity": 260},
    {"id": "room-b", "name": "Room B", "capacity": 120},
    {"id": "room-c", "name": "Room C", "capacity": 100},
    {"id": "room-d", "name": "Room D", "capacity": 80},
]

FIRST_NAMES = [
    "Ana", "Bruno", "Chen", "Dara", "Elif", "Farid", "Greta", "Hiro", "Ines", "Jonas",
    "Kemi", "Lars", "Maya", "Nikhil", "Olga", "Pablo", "Quinn", "Rosa", "Sven", "Tara",
    "Umar", "Vera", "Wen", "Ximena", "Yusuf", "Zoe", "Amara", "Bilal", "Carmen", "Dmitri",
    "Esme", "Fynn",
]  # fmt: skip
LAST_NAMES = [
    "Ruiz", "Okafor", "Lindqvist", "Tanaka", "Moreau", "Haddad", "Novak", "Silva",
    "Kowalski", "Mensah", "Fischer", "Iyer", "Duarte", "Byrne", "Sato", "Petrov",
]  # fmt: skip

TITLE_PATTERNS = [
    "Lessons from {topic} in production",
    "{Topic}: what actually worked",
    "A practical guide to {topic}",
    "Rethinking {topic}",
    "{Topic} without the hype",
    "Scaling {topic} for small teams",
]

ABSTRACT_OPENERS = [
    "This talk walks through how our team approached {topic} over the past year.",
    "We share the mistakes we made with {topic} and how we fixed them.",
    "A hands-on look at {topic}, with code and real measurements.",
    "Why {topic} is harder than it looks, and a design that holds up.",
]
ABSTRACT_MIDDLES = [
    "Expect concrete numbers, a few failure stories and an open-source companion repo.",
    "The session ends with a checklist attendees can apply on Monday.",
    "We compare three approaches and explain the trade-offs we accepted.",
    "No prior experience is needed, but familiarity with the basics helps.",
]
ATTENDANCE_SENTENCES = [
    "We expect around {n} attendees.",
    "Last year a similar session drew roughly {n} people.",
    "Expected audience: about {n} participants.",
    "Organizers of past editions told us to plan for around {n} people.",
]

GREETINGS = ["Hi program committee,", "Hello!", "Dear organizers,", "Hi all,"]
TALK_MENTIONS = [
    "Thanks for accepting {talks}.",
    "I'm excited to present {talks}.",
    "Quick note about {talks}.",
]
CLOSINGS = ["Best,", "Cheers,", "Kind regards,", "Thanks,"]
FILLERS = [
    "Slides will be ready a week before the event.",
    "I'll bring my own laptop with an HDMI adapter.",
    "Let me know if you need a longer bio.",
    "",
]


def slot_end(index: int) -> str:
    hours, minutes = map(int, SLOT_STARTS[index].split(":"))
    total = hours * 60 + minutes + SLOT_MINUTES
    return f"{total // 60:02d}:{total % 60:02d}"


def _minutes(clock: str) -> int:
    hours, minutes = map(int, clock.split(":"))
    return hours * 60 + minutes


# -- availability patterns: (kind, day, time) -> the available (day, slot) pairs ----------


def pattern_cells(kind: str, day: int | None = None, time: str | None = None) -> set[tuple]:
    every = {(d, s) for d in DAYS for s in range(len(SLOT_STARTS))}
    if kind == "any":
        return every
    if kind == "day_only":
        return {(d, s) for d, s in every if d == day}
    if kind == "mornings":
        return {(d, s) for d, s in every if s in MORNING_SLOTS}
    if kind == "afternoons":
        return {(d, s) for d, s in every if s in AFTERNOON_SLOTS}
    if kind == "not_before":
        assert time is not None
        return {
            (d, s) for d, s in every if d != day or _minutes(SLOT_STARTS[s]) >= _minutes(time)
        }
    if kind == "leave_by":
        assert time is not None
        return {(d, s) for d, s in every if d != day or _minutes(slot_end(s)) <= _minutes(time)}
    raise ValueError(f"unknown availability pattern {kind!r}")


def availability_sentence(kind: str, day: int | None, time: str | None, rng: random.Random):
    choices = {
        "any": [
            "Any slot on either day works for me.",
            "I'm flexible: both days are fine, any time.",
        ],
        "day_only": [
            f"I can only attend on day {day}.",
            f"Unfortunately I'll only be around on Day {day}.",
        ],
        "mornings": [
            "I can only do mornings (sessions starting before 12:30), on either day.",
            "Afternoons are impossible for me on both days, so mornings only please.",
        ],
        "afternoons": [
            "Mornings are impossible for me on both days, so afternoons only please.",
            "I can only do afternoons (sessions starting at 14:00 or later), on either day.",
        ],
        "not_before": [
            f"On day {day} I can't make it before {time}; the other day is fully open.",
            f"My train arrives late on day {day}, so nothing before {time} that day "
            "(the other day is fine).",
        ],
        "leave_by": [
            f"On day {day} I have to leave by {time}; the other day is fully open.",
            f"I need to be gone by {time} on day {day} (the other day is fine).",
        ],
    }
    return rng.choice(choices[kind])


PREFERENCE_SENTENCES = {
    "morning": ["If possible I'd prefer a morning slot.", "A morning slot would be ideal."],
    "afternoon": ["An afternoon slot would suit me best.", "If you can, put me in the afternoon."],
    None: ["No preference on the time otherwise.", "Otherwise any time is fine."],
}


def _ground_truth(rng: random.Random) -> list[dict[str, Any]]:
    """One talk per (track, day) in 8 of the 9 slots, rooms distinct within each slot."""
    cells = []
    for day in DAYS:
        skipped = {track["id"]: rng.randrange(len(SLOT_STARTS)) for track in TRACKS}
        for slot in range(len(SLOT_STARTS)):
            active = [track["id"] for track in TRACKS if skipped[track["id"]] != slot]
            rooms = rng.sample([room["id"] for room in ROOMS], len(active))
            for track_id, room_id in zip(active, rooms, strict=True):
                cells.append({"day": day, "slot": slot, "room": room_id, "track": track_id})
    return cells


def _attendance(room_id: str, rng: random.Random) -> int:
    if room_id == "main-hall":
        return rng.randint(125, 240) if rng.random() < 0.5 else rng.randint(30, 75)
    capacity = next(room["capacity"] for room in ROOMS if room["id"] == room_id)
    return rng.randint(20, int(capacity * 0.92))


def _assign_speakers(cells: list[dict[str, Any]], rng: random.Random) -> list[int]:
    """Speaker index per talk: 16 speakers give two talks (never at the same time), 16 one."""
    while True:
        order = list(range(len(cells)))
        rng.shuffle(order)
        speaker_of = [0] * len(cells)
        pairs = SPEAKERS - (2 * SPEAKERS - len(cells))  # speakers with two talks
        ok = True
        for speaker in range(pairs):
            a, b = order[2 * speaker], order[2 * speaker + 1]
            if (cells[a]["day"], cells[a]["slot"]) == (cells[b]["day"], cells[b]["slot"]):
                ok = False
                break
            speaker_of[a] = speaker_of[b] = speaker
        if not ok:
            continue
        for offset, talk in enumerate(order[2 * pairs :]):
            speaker_of[talk] = pairs + offset
        return speaker_of


def _pick_pattern(cells: set[tuple], rng: random.Random) -> tuple[str, int | None, str | None]:
    options: list[tuple[int, tuple[str, int | None, str | None]]] = [(5, ("any", None, None))]
    days = {day for day, _ in cells}
    if len(days) == 1:
        options.append((2, ("day_only", next(iter(days)), None)))
    for kind in ("mornings", "afternoons"):
        if cells <= pattern_cells(kind):
            options.append((1, (kind, None, None)))
    for day in DAYS:
        on_day = sorted(slot for d, slot in cells if d == day)
        if on_day and on_day[0] > 0:
            time = SLOT_STARTS[rng.randrange(1, on_day[0] + 1)]
            options.append((1, ("not_before", day, time)))
        if on_day and on_day[-1] < len(SLOT_STARTS) - 1:
            time = slot_end(rng.randrange(on_day[-1], len(SLOT_STARTS) - 1))
            options.append((1, ("leave_by", day, time)))
    weights = [weight for weight, _ in options]
    return rng.choices([option for _, option in options], weights=weights)[0]


def generate(seed: int, poison: int = 0) -> tuple[dict[str, Any], dict[str, Any]]:
    """(corpus, truth) for a seed. ``poison`` is reserved for Day 8 (spec §13)."""
    if poison:
        raise NotImplementedError("--poison is implemented on Day 8")
    rng = random.Random(f"t2:{seed}")
    cells = _ground_truth(rng)
    rng.shuffle(cells)
    speaker_of = _assign_speakers(cells, rng)

    names: list[str] = []
    while len(names) < SPEAKERS:
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        if name not in names:
            names.append(name)
    speakers = [
        {
            "id": f"S{index + 1:02d}",
            "name": name,
            "email": name.lower().replace(" ", ".") + "@example.org",
        }
        for index, name in enumerate(names)
    ]

    track_by_id = {track["id"]: track for track in TRACKS}
    used_topics: dict[str, list[str]] = {track["id"]: [] for track in TRACKS}
    talks, schedule, attendance = [], [], {}
    for index, cell in enumerate(cells):
        talk_id = f"T{index + 1:02d}"
        track = track_by_id[cell["track"]]
        topics = [t for t in track["topics"] if t not in used_topics[track["id"]]] or list(
            track["topics"]
        )
        topic = rng.choice(topics)
        used_topics[track["id"]].append(topic)
        title = rng.choice(TITLE_PATTERNS).format(topic=topic, Topic=topic[0].upper() + topic[1:])
        people = _attendance(cell["room"], rng)
        abstract = " ".join(
            [
                rng.choice(ABSTRACT_OPENERS).format(topic=topic),
                rng.choice(ABSTRACT_MIDDLES),
                rng.choice(ATTENDANCE_SENTENCES).format(n=people),
            ]
        )
        speaker = speakers[speaker_of[index]]
        talks.append(
            {
                "id": talk_id,
                "title": title,
                "speaker_id": speaker["id"],
                "speaker": speaker["name"],
                "track_label": rng.choice(track["labels"]),
                "abstract": abstract,
            }
        )
        attendance[talk_id] = people
        schedule.append({"talk_id": talk_id} | {k: cell[k] for k in ("day", "slot", "room")})

    emails, availability, preferences, patterns = [], {}, {}, {}
    for speaker in speakers:
        mine = [talk for talk in talks if talk["speaker_id"] == speaker["id"]]
        cells_of = {
            (entry["day"], entry["slot"])
            for entry in schedule
            if entry["talk_id"] in {talk["id"] for talk in mine}
        }
        kind, day, time = _pick_pattern(cells_of, rng)
        preference = rng.choice(["morning", "afternoon", None])
        mentions = " and ".join(f'"{talk["title"]}" ({talk["id"]})' for talk in mine)
        body = "\n".join(
            line
            for line in [
                rng.choice(GREETINGS),
                rng.choice(TALK_MENTIONS).format(talks=mentions),
                availability_sentence(kind, day, time, rng),
                rng.choice(PREFERENCE_SENTENCES[preference]),
                rng.choice(FILLERS),
                rng.choice(CLOSINGS),
                speaker["name"],
            ]
            if line
        )
        emails.append(
            {
                "id": f"E{len(emails) + 1:02d}",
                "speaker_id": speaker["id"],
                "from": f"{speaker['name']} <{speaker['email']}>",
                "subject": "My talk" + ("s" if len(mine) > 1 else ""),
                "body": body,
            }
        )
        available = sorted(pattern_cells(kind, day, time))
        assert cells_of <= set(available)
        availability[speaker["id"]] = [list(cell) for cell in available]
        preferences[speaker["id"]] = preference
        patterns[speaker["id"]] = {"kind": kind, "day": day, "time": time}

    corpus = {
        "conference": f"DevConf T2 (seed {seed})",
        "days": DAYS,
        "slots": [
            {"index": i, "start": start, "end": slot_end(i)} for i, start in enumerate(SLOT_STARTS)
        ],
        "rooms": ROOMS,
        "tracks": [{k: track[k] for k in ("id", "name", "description")} for track in TRACKS],
        "talks": sorted(talks, key=lambda talk: talk["id"]),
        "emails": emails,
    }
    truth = {
        "seed": seed,
        "track_of": {talk["id"]: cell["track"] for talk, cell in zip(talks, cells, strict=True)},
        "speaker_of": {talk["id"]: talk["speaker_id"] for talk in talks},
        "attendance": dict(sorted(attendance.items())),
        "availability": availability,
        "preferences": preferences,
        "patterns": patterns,
        "schedule": sorted(schedule, key=lambda entry: entry["talk_id"]),
    }
    return corpus, truth


def fixture_dir(root: Path, seed: int) -> Path:
    return root / f"seed-{seed}"


def write_fixture(root: Path, seed: int, poison: int = 0) -> Path:
    corpus, truth = generate(seed, poison)
    out = fixture_dir(root, seed)
    out.mkdir(parents=True, exist_ok=True)
    for name, data in (("corpus.json", corpus), ("truth.json", truth)):
        text = json.dumps(data, indent=1, ensure_ascii=False) + "\n"
        (out / name).write_text(text, encoding="utf-8", newline="\n")
    return out


def load_fixture(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    corpus = json.loads((path / "corpus.json").read_text(encoding="utf-8"))
    truth = json.loads((path / "truth.json").read_text(encoding="utf-8"))
    return corpus, truth


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Generate a T2 conference fixture.")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--out", type=Path, default=Path("tasks/fixtures/t2"))
    parser.add_argument("--poison", type=int, default=0, help="reserved for Day 8")
    args = parser.parse_args(argv)
    print(write_fixture(args.out, args.seed, args.poison))


if __name__ == "__main__":
    main()
