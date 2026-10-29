"""What the API does with an intake: create its input, read its state, approve it.

Creating writes the pasted text (emails already pseudonymized) and the mapping back into the
intake's private directory; a subprocess then runs the ``intake`` scenario there
(``fractalswarm intake``, launched by ``api/jobs.py``). Reading derives the state from the
intake run's log, so there is no second copy to go stale. Approving takes the proposal a person
edited, fits it to the program again, and writes ``approved.json`` in the checker's truth schema.
"""

from pathlib import Path
from typing import Any

from fractalswarm.api.catalog import Catalog, RunEntry
from fractalswarm.intake import proposal as proposals
from fractalswarm.intake.pseudonym import Pseudonyms
from fractalswarm.intake.shape import normalize
from fractalswarm.intake.store import PrivateDir, read_json, utc_now, write_json
from fractalswarm.intake.truth import build_input, input_sha256

MAX_TEXT_CHARS = 200_000
MAX_ROOMS = 12
SEGMENT_ORDER = ("talks", "notes", "conference")  # the order addresses are numbered in


class IntakeError(ValueError):
    """The request cannot be served; the message says why (the API answers 422)."""


def read_body(body: dict[str, Any]) -> tuple[dict[str, str], list[dict[str, Any]] | None]:
    """The pasted segments (newlines normalized, trimmed) and the rooms of a request body, or an
    ``IntakeError`` saying what is wrong. Nothing is written: a preflight reads a body this way
    too."""
    segments: dict[str, str] = {}
    for name in SEGMENT_ORDER:
        value = body.get(name) or ""
        if not isinstance(value, str):
            raise IntakeError(f"{name} must be text")
        if len(value) > MAX_TEXT_CHARS:
            raise IntakeError(f"{name} is longer than {MAX_TEXT_CHARS} characters")
        segments[name] = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not segments["talks"]:
        raise IntakeError("talks is empty: paste the talks (titles, speakers, abstracts)")
    return segments, _rooms(body.get("rooms"))


def mask(segments: dict[str, str]) -> tuple[dict[str, str], Pseudonyms]:
    """The segments with every email address replaced, in the order addresses are numbered,
    and the mapping back."""
    pseudonyms = Pseudonyms()
    return {name: pseudonyms.mask(segments[name]) for name in SEGMENT_ORDER}, pseudonyms


def create_input(
    private: PrivateDir, intake_id: str, body: dict[str, Any]
) -> tuple[dict[str, Any], Path]:
    """Write ``input.json`` and ``pseudonyms.json`` for a new intake from a request body
    (``talks``, ``notes``, ``conference``, ``rooms``, ``names``). Returns the run params of the
    ``intake`` scenario and the directory."""
    cleaned, rooms = read_body(body)
    segments, pseudonyms = mask(cleaned)
    directory = private.intake_dir(intake_id)
    directory.mkdir(parents=True, exist_ok=False)
    write_json(directory / "pseudonyms.json", pseudonyms.mapping())
    saved = {"segments": segments, "rooms": rooms, "names": bool(body.get("names", False))}
    write_json(directory / "input.json", saved | {"created_at": utc_now()})
    return {"segments": segments, "rooms": rooms}, directory


def _rooms(rooms: Any) -> list[dict[str, Any]] | None:
    if rooms in (None, []):
        return None
    if not isinstance(rooms, list) or len(rooms) > MAX_ROOMS:
        raise IntakeError(f"rooms must be a list of at most {MAX_ROOMS} {{name, capacity}}")
    found = []
    for room in rooms:
        capacity = room.get("capacity") if isinstance(room, dict) else None
        name = room.get("name") if isinstance(room, dict) else None
        if not isinstance(name, str) or not name.strip():
            raise IntakeError("every room needs a name")
        if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
            raise IntakeError(f"room {name!r} needs a capacity of at least 1")
        found.append({"name": name.strip(), "capacity": capacity})
    return found


# -- reading an intake ---------------------------------------------------------------------


def state_of(
    catalog: Catalog, entry: RunEntry, private: PrivateDir, job: dict[str, Any] | None = None
) -> dict[str, Any]:
    """The intake's state, derived from its log: ``reading`` (the model is working),
    ``proposed`` (waiting for a person), ``approved``, ``refused`` (the firewall blocked the
    text), ``failed`` or ``interrupted``. ``job`` is the job that runs it, if known: a process
    that died before it wrote anything leaves a log that never starts, and the job says so."""
    has_log = entry.sqlite.exists() or entry.jsonl.exists()
    events = catalog.read(entry) if has_log else []
    proposed = next((e for e in events if e["type"] == "intake.proposed"), None)
    refused = next((e for e in events if e["type"] == "intake.refused"), None)
    failed = next((e for e in events if e["type"] == "intake.failed"), None)
    approved = private.approved(entry.id)
    status = catalog.status(entry, events[-1] if events else None)
    if approved is not None:
        state = "approved"
    elif proposed is not None:
        state = "proposed"
    elif refused is not None:
        state = "refused"
    elif failed is not None or job is not None and job["state"] == "failed":
        state = "failed"
    elif status == "running" or (status == "empty" and job is None) or _working(job):
        state = "reading"
    else:
        state = "interrupted"
    saved = read_json(private.input_file(entry.id)) or {}
    scans = [e["payload"] for e in events if e["type"] == "security.scanned"]
    return {
        "intake_id": entry.id,
        "state": state,
        "status": status,
        "texts": saved.get("segments"),
        "proposal": proposed["payload"]["proposal"] if proposed else None,
        "input_sha256": proposed["payload"]["input_sha256"] if proposed else None,
        "scans": [
            {k: scan[k] for k in ("source_id", "decision", "score", "reasons", "findings")}
            for scan in scans
        ],
        "refused": refused["payload"] if refused else None,
        "failed": failed["payload"] if failed else None,
        "approved": _approved_summary(approved),
        "job": {"id": job["id"], "state": job["state"]} if job else None,
    }


def _working(job: dict[str, Any] | None) -> bool:
    return job is not None and job["state"] in ("starting", "running")


def _approved_summary(approved: dict[str, Any] | None) -> dict[str, Any] | None:
    if approved is None:
        return None
    keep = ("sha256", "approved_at", "edits", "truth_mode", "names_pseudonymized")
    return {key: approved[key] for key in keep}


# -- approving it --------------------------------------------------------------------------


def diff(original: dict[str, Any], edited: dict[str, Any]) -> list[str]:
    """The fields a person changed, as ``kind[id].field``, ``kind[id] added`` or ``removed``."""
    changes: list[str] = []
    if original.get("conference") != edited.get("conference"):
        changes.append("conference")
    for kind in ("tracks", "rooms", "speakers", "talks"):
        before = {row["id"]: row for row in original.get(kind, [])}
        after = {row["id"]: row for row in edited.get(kind, [])}
        changes += [f"{kind}[{key}] added" for key in sorted(after.keys() - before.keys())]
        changes += [f"{kind}[{key}] removed" for key in sorted(before.keys() - after.keys())]
        for key in sorted(before.keys() & after.keys()):
            for field in sorted(before[key].keys() | after[key].keys()):
                if before[key].get(field) != after[key].get(field):
                    changes.append(f"{kind}[{key}].{field}")
    return changes


def approve(
    private: PrivateDir, state: dict[str, Any], edited: dict[str, Any] | None
) -> dict[str, Any]:
    """Approve an intake (``state`` from ``state_of``) with the proposal as a person left it,
    or as proposed when ``edited`` is ``None``. Writes ``approved.json``; raises
    ``IntakeError`` when the proposal is not ready or still has errors."""
    if state["state"] == "approved":
        raise IntakeError("this intake is already approved; start a new one to change it")
    if state["proposal"] is None:
        raise IntakeError(f"nothing to approve: the intake is {state['state']}")
    original = state["proposal"]
    try:
        final = proposals.parse(edited) if edited is not None else original
    except ValueError as exc:  # pydantic's ValidationError is one
        raise IntakeError(f"the proposal is malformed: {exc}") from None
    fitted = normalize(final)
    if fitted["errors"]:
        raise IntakeError("the proposal still has errors: " + "; ".join(fitted["errors"]))
    corpus, truth, reference = build_input(fitted)

    directory = private.intake_dir(state["intake_id"])
    saved_map = read_json(directory / "pseudonyms.json") or {}
    pseudonyms = Pseudonyms({real: alias for alias, real in saved_map.get("emails", {}).items()})
    corpus = pseudonyms.mask_value(corpus)  # an address typed into a row
    names = bool((read_json(private.input_file(state["intake_id"])) or {}).get("names"))
    if names:
        corpus = pseudonyms.mask_names(corpus, [s["name"] for s in fitted["speakers"]])
    write_json(directory / "pseudonyms.json", pseudonyms.mapping())
    approved = {
        "intake_id": state["intake_id"],
        "sha256": input_sha256(corpus, truth),
        "approved_at": utc_now(),
        "truth_mode": "approved",
        "edits": diff(original, final),
        "names_pseudonymized": names,
        "corpus": corpus,
        "truth": truth,
        "reference": reference,
        "proposal": fitted,
    }
    private.write_approved(state["intake_id"], approved)
    return approved
