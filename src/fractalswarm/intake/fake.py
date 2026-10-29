"""The $0 path: a scripted stand-in for Muse that reads the generator's wording.

``intake_script`` answers the ``t2_intake`` schema the way the model should, from the request
alone: it parses the talks and the notes with the same regex parsers the T2 fake uses for the
swarm's agents (``parse_email``, ``parse_attendance``). It reads the format
``generator.live_sample`` writes (``Title:`` / ``Speaker:`` / ``Track:`` / ``Abstract:`` blocks,
and ``From:`` / ``Subject:`` notes). It is not a model: a text in any other wording gets the
talks it can parse and a warning, which is exactly why the real path calls Muse.
"""

import json
import re
from typing import Any

from fractalswarm.bench.tasks.t2_conference.fake import (
    ATTENDANCE,
    _prompt,
    parse_attendance,
    parse_email,
)
from fractalswarm.bench.tasks.t2_conference.generator import TRACKS
from fractalswarm.bench.tasks.t2_conference.task import normalize_track
from fractalswarm.bench.workflows import bench_script, fake_backend
from fractalswarm.intake.schema import SCHEMA_NAME
from fractalswarm.llm.fake import FakeBackend, FakeReply
from fractalswarm.planning.planner import read_blocks

SUBMISSION = re.compile(
    r"^Title:[ \t]*(?P<title>.+)\n"
    r"Speaker:[ \t]*(?P<speaker>[^<\n]+?)[ \t]*(?:<(?P<email>[^>\n]*)>)?[ \t]*\n"
    r"Track:[ \t]*(?P<track>.+)\n"
    r"Abstract:[ \t]*(?P<abstract>.+)$",
    re.MULTILINE,
)
NOTE = re.compile(
    r"^From:[ \t]*(?P<name>[^<\n]+?)[ \t]*(?:<(?P<email>[^>\n]*)>)?[ \t]*\n"
    r"Subject:[^\n]*\n(?P<body>.*)$",
    re.DOTALL,
)
NO_PREFERENCE = re.compile(r"no preference|any time is fine", re.IGNORECASE)
SENTENCES = re.compile(r"(?<=[.!?])\s+")


def intake_script(body: dict[str, Any], attempt: int) -> FakeReply | str:
    name = ((body.get("text") or {}).get("format") or {}).get("name", "")
    if name != SCHEMA_NAME:
        return f"[fake] no script for {name or 'plain text'}"
    return json.dumps(read_text(read_blocks(_prompt(body))), sort_keys=True)


def read_text(blocks: dict[str, Any]) -> dict[str, Any]:
    """The ``IntakeOutput`` for the request's blocks (``grid``, ``talks``, ``notes``...)."""
    days, slots = blocks["grid"]["days"], blocks["grid"]["slots"]
    warnings: list[str] = []
    talks, tracks = [], []
    for found in SUBMISSION.finditer(blocks.get("talks", "")):
        label = found.group("track").strip()
        official = normalize_track(label, TRACKS)
        track = next((t["name"] for t in TRACKS if t["id"] == official), None)
        if track is None:
            warnings.append(f"unknown track {label!r}: left to a person")
            track = label
        if track not in tracks:
            tracks.append(track)
        talks.append(
            {
                "title": found.group("title").strip(),
                "speaker": found.group("speaker").strip(),
                "track": track,
                "abstract": found.group("abstract").strip(),
                "track_source": f"Track: {label}",
            }
        )
    if not talks:
        warnings.append("no talks could be read from the pasted text")

    speakers, availability, preferences = [], [], []
    for block in re.split(r"\n\s*\n(?=From:)", blocks.get("notes", "").strip()):
        found = NOTE.match(block.strip())
        if found is None:
            continue
        name, text = found.group("name").strip(), found.group("body").strip()
        speakers.append({"name": name, "email": found.group("email") or "", "note": text})
        every, preference = parse_email(text, days, slots)
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        everything = {day: [slot["index"] for slot in slots] for day in days}
        said = next((line for line in lines if parse_email(line, days, slots)[0] != everything), "")
        if said:
            free = [{"day": day, "slots": every[day]} for day in days]
            availability.append({"speaker": name, "available": free, "source": said})
        stated = next((line for line in lines if parse_email(line, days, slots)[1] != "none"), "")
        stated = stated or next((line for line in lines if NO_PREFERENCE.search(line)), "")
        if stated:
            preferences.append({"speaker": name, "preference": preference, "source": stated})

    attendance = []
    for talk in talks:
        sentence = next((s for s in SENTENCES.split(talk["abstract"]) if ATTENDANCE.search(s)), "")
        if sentence:
            counted = {"talk": talk["title"], "attendance": parse_attendance(sentence)}
            attendance.append(counted | {"source": sentence})
    return {
        "conference": blocks.get("conference", "").strip(),
        "tracks": tracks,
        "talks": talks,
        "speakers": speakers,
        "rooms": [],
        "reference": {
            "availability": availability,
            "preferences": preferences,
            "attendance": attendance,
        },
        "warnings": warnings,
    }


def composed_script(body: dict[str, Any], attempt: int) -> FakeReply | str:
    """The intake reader for ``t2_intake``, the bench's fake for every other request."""
    reply = intake_script(body, attempt)
    if isinstance(reply, str) and reply.startswith("[fake] no script"):
        return bench_script(body, attempt)
    return reply


def intake_backend() -> FakeBackend:
    """The calibrated fake LLM of the bench, extended with the intake reader."""
    return fake_backend(script=composed_script)
