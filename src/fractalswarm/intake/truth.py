"""The approved input: a reviewed proposal as the corpus the agents read and the truth the
checker holds (``bench/tasks/t2_conference/checker.py``'s schema), plus the reference with the
sentence behind each fact.

The corpus is what a swarm run sees: tracks, rooms, talks, and one "email" per speaker that is
the speaker's own note, word for word. The truth never reaches a prompt. ``sha256`` is the hash
of ``{corpus, truth}``; a run on this input records it in ``params.input``.
"""

import copy
import hashlib
import json
from typing import Any

from fractalswarm.intake.shape import all_cells
from fractalswarm.kernel.ids import canonical_json

TRUTH_KEYS = ("track_of", "speaker_of", "attendance", "availability", "preferences")


def input_sha256(corpus: dict[str, Any], truth: dict[str, Any]) -> str:
    text = canonical_json({"corpus": corpus, "truth": truth})
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def corpus_and_truth(approved: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The ``(corpus, truth)`` of an approved input (an intake's ``approved.json``), in the
    shapes a run records as ``params.corpus`` and ``params.truth``, and the ablation reads.

    The corpus is what the agents read: ``emails[{id, speaker_id, from, subject, body}]``,
    ``talks[{id, title, speaker_id, speaker, track_label, abstract}]``, ``days``, ``slots``,
    ``rooms``, ``tracks`` and ``conference``. The truth is the checker's: ``track_of``,
    ``speaker_of``, ``attendance``, ``availability`` and ``preferences``. Pure, and a copy: the
    caller cannot change the approved input through it. ``ValueError`` when ``approved`` is not an
    approved input, or was edited after it was approved (its hash no longer matches).
    """
    try:
        corpus, truth, expected = approved["corpus"], approved["truth"], approved["sha256"]
    except (KeyError, TypeError):
        raise ValueError("not an approved input: it lacks corpus, truth or sha256") from None
    if input_sha256(corpus, truth) != expected:
        raise ValueError("it changed after it was approved")
    return copy.deepcopy(corpus), copy.deepcopy(truth)


def text_sha256(segments: dict[str, str]) -> str:
    """The hash of the pasted segments, so a proposal can be tied to its text."""
    text = json.dumps(segments, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_input(proposal: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """``(corpus, truth, reference)`` of a normalized proposal. Raises ``ValueError`` when it
    still has errors."""
    if proposal["errors"]:
        raise ValueError("the proposal has errors: " + "; ".join(proposal["errors"]))
    people = {person["id"]: person for person in proposal["speakers"]}
    corpus = {
        "conference": proposal["conference"],
        "days": list(proposal["days"]),
        "slots": [dict(slot) for slot in proposal["slots"]],
        "rooms": [dict(room) for room in proposal["rooms"]],
        "tracks": [
            {"id": track["id"], "name": track["name"], "description": track["description"]}
            for track in proposal["tracks"]
        ],
        "talks": [
            {
                "id": talk["id"],
                "title": talk["title"],
                "speaker_id": talk["speaker_id"],
                "speaker": people[talk["speaker_id"]]["name"],
                "track_label": talk["track_label"] or _track_name(proposal, talk["track_id"]),
                "abstract": talk["abstract"],
            }
            for talk in proposal["talks"]
        ],
        "emails": _emails(proposal),
    }
    everything = all_cells()
    truth = {
        "track_of": {talk["id"]: talk["track_id"] for talk in proposal["talks"]},
        "speaker_of": {talk["id"]: talk["speaker_id"] for talk in proposal["talks"]},
        "attendance": {talk["id"]: talk["attendance"] or 0 for talk in proposal["talks"]},
        "availability": {
            person["id"]: person["available"] or everything for person in proposal["speakers"]
        },
        "preferences": {person["id"]: person["preference"] for person in proposal["speakers"]},
    }
    reference = {
        "availability": {
            p["id"]: {"cells": p["available"], "source": p["availability_source"]}
            for p in proposal["speakers"]
            if p["available"] is not None
        },
        "preferences": {
            p["id"]: {"value": p["preference"], "source": p["preference_source"]}
            for p in proposal["speakers"]
            if p["preference_source"]
        },
        "attendance": {
            t["id"]: {"value": t["attendance"], "source": t["attendance_source"]}
            for t in proposal["talks"]
            if t["attendance"] is not None
        },
    }
    return corpus, truth, reference


def _track_name(proposal: dict[str, Any], track_id: str) -> str:
    return next(track["name"] for track in proposal["tracks"] if track["id"] == track_id)


def _emails(proposal: dict[str, Any]) -> list[dict[str, Any]]:
    """One email per speaker who wrote something: their note, as they wrote it."""
    talks_of: dict[str, int] = {}
    for talk in proposal["talks"]:
        talks_of[talk["speaker_id"]] = talks_of.get(talk["speaker_id"], 0) + 1
    emails = []
    for person in proposal["speakers"]:
        if not person["note"]:
            continue
        sender = f"{person['name']} <{person['email']}>" if person["email"] else person["name"]
        emails.append(
            {
                "id": f"E{len(emails) + 1:02d}",
                "speaker_id": person["id"],
                "from": sender,
                "subject": "My talks" if talks_of.get(person["id"], 0) > 1 else "My talk",
                "body": person["note"],
            }
        )
    return emails


# -- an input handed over whole (``TaskInputs.inline``) ------------------------------------

CORPUS_KEYS = ("conference", "days", "slots", "rooms", "tracks", "talks", "emails")
TALK_KEYS = ("id", "title", "speaker_id", "speaker", "track_label", "abstract")
EMAIL_KEYS = ("id", "speaker_id", "from", "subject", "body")


def validate_corpus(corpus: Any) -> None:
    """``ValueError`` naming what is wrong with a T2 corpus, before a run is built on it."""
    if not isinstance(corpus, dict):
        raise ValueError("the corpus must be an object")
    missing = [key for key in CORPUS_KEYS if key not in corpus]
    if missing:
        raise ValueError(f"the corpus lacks {', '.join(missing)}")
    if not corpus["days"] or not corpus["slots"] or not corpus["tracks"] or not corpus["talks"]:
        raise ValueError("the corpus needs days, slots, tracks and talks")
    if len(corpus["rooms"]) < 2:
        raise ValueError("the corpus needs at least 2 rooms")
    for name, keys in (("talks", TALK_KEYS), ("emails", EMAIL_KEYS)):
        for item in corpus[name]:
            absent = [key for key in keys if not isinstance(item, dict) or key not in item]
            if absent:
                raise ValueError(f"an entry of {name} lacks {', '.join(absent)}")
    ids = [talk["id"] for talk in corpus["talks"]]
    if len(set(ids)) != len(ids):
        raise ValueError("talk ids must be unique")


def validate_truth(corpus: dict[str, Any], truth: dict[str, Any]) -> None:
    """``ValueError`` if a given truth does not cover the corpus in the checker's schema."""
    missing = [key for key in TRUTH_KEYS if key not in truth]
    if missing:
        raise ValueError(f"the truth lacks {', '.join(missing)}")
    talks = {talk["id"] for talk in corpus["talks"]}
    speakers = {talk["speaker_id"] for talk in corpus["talks"]}
    for key in ("track_of", "speaker_of", "attendance"):
        if set(truth[key]) != talks:
            raise ValueError(f"truth.{key} must have exactly the talks of the corpus")
    for key in ("availability", "preferences"):
        if set(truth[key]) != speakers:
            raise ValueError(f"truth.{key} must have exactly the speakers of the corpus")
    slots = {slot["index"] for slot in corpus["slots"]}
    for speaker, cells in truth["availability"].items():
        bad = [c for c in cells if len(c) != 2 or c[0] not in corpus["days"] or c[1] not in slots]
        if bad:
            raise ValueError(f"truth.availability of {speaker} has cells off the grid: {bad[:3]}")
