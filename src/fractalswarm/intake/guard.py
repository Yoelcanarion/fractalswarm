"""What must never be bundled: runs that hold what a person typed.

A bundle (``demo/<name>``, ``tests/golden/<name>``) is committed and published. A run on live
input lives in the private directory, outside the repo; this is the check that stops one from
being copied across anyway, used by ``fractalswarm bundle`` and by the test that scans the
bundles already in git.
"""

import json
from pathlib import Path
from typing import Any

LIVE_SOURCES = ("intake", "inline")  # ``params.input.source`` of a run on input a person gave
INTAKE_SCENARIO = "fractalswarm.intake.actor:INTAKE"


def first_event(events_jsonl: Path) -> dict[str, Any]:
    """The ``run.started`` event of an exported log."""
    with events_jsonl.open(encoding="utf-8") as handle:
        return json.loads(handle.readline())


def private_reason(started: dict[str, Any]) -> str | None:
    """Why the run whose ``run.started`` event this is must stay out of a bundle, or ``None``."""
    payload = started.get("payload") or {}
    if payload.get("scenario") == INTAKE_SCENARIO:
        return "it is an intake run: it holds the text a person pasted"
    source = ((payload.get("params") or {}).get("input") or {}).get("source")
    if source in LIVE_SOURCES:
        return f"it ran on input a person gave (input.source is {source!r})"
    return None


def inside(path: Path, parent: Path) -> bool:
    try:
        return path.resolve().is_relative_to(parent.resolve())
    except OSError:
        return False
