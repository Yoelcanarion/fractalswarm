"""The ablation: the same notes through a hand-written parser and through Muse (arena spec §E.3).

Per email, the regex ``parse_email`` of the fake T2 backend is set against one Muse extraction
that follows the extract guide; per abstract, ``parse_attendance`` against Muse. Both readings
are scored against the approved reference: the available cells (exact match and Jaccard), the
time preference, and the expected attendance within 10 %. A note is understood when its whole
reading matches, and the headline is "the parser understood N of M notes, Muse K of M".

It is a kernel scenario, not a script, so every Muse call is a real effect: its budget is
reserved and settled, it sits in the log and the cassette, and the lens shows it. The regex is a
pure function of the note and runs inside the handler. The notes are the run's ``corpus`` and
``truth`` as the TaskSpec records them (the generator's today, an approved intake's later), or
the ``cases`` given inline in ``params["ablation"]``.

Two caveats travel with every result. On the generator's emails the regex wins by construction,
because its patterns are the generator's phrasings. And Muse seeds the approved reference that a
person then approves, so agreement with Muse is partly a person accepting its reading. A third
tells when the run used the fake backend: its Muse is the same regex, so the two agree by
construction and a $0 run checks the plumbing and the scoring, not the models.

New event types only (``ablation.note``, ``ablation.done``): no existing payload changes.
"""

import json
from collections import defaultdict
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from fractalswarm.bench.tasks.t2_conference import fake as t2_fake
from fractalswarm.bench.tasks.t2_conference.fake import parse_attendance, parse_email
from fractalswarm.bench.tasks.t2_conference.task import EXTRACT_GUIDE, DayAvailability, Strict
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.scheduler import (
    ActorKind,
    Cancel,
    Command,
    Emit,
    SetCap,
    SetTimer,
    Spawn,
    StartEffect,
    Stop,
    View,
)
from fractalswarm.planning.planner import parse_json, plan_request, read_blocks
from fractalswarm.planning.schemas import register_output

SCENARIO = "fractalswarm.bench.tasks.t2_conference.ablation:ABLATION"
SQUAD = "ablation"
ATTENDANCE_TOLERANCE_PCT = 10  # attendance counts as understood within this share of the reference
CONCURRENCY = 6  # Muse calls open at once
CAP_USD = 0.75  # the run's and the squad's cap, as the job manager's real runs have
DEADLINE_MS = 900_000  # on the run's clock; notes without an answer by then count as missed
MAX_NOTE_CHARS = 20_000  # an email is a few hundred characters; this only stops a runaway body

# The extract contract's guide without the steps that need the memory tools: what a slot index,
# a morning and an afternoon are.
GUIDE = [line for line in EXTRACT_GUIDE if "memory." not in line and not line.startswith("Finally")]
INSTRUCTIONS = {
    "email": (
        "You read one email from a conference speaker and extract the constraints it states, as "
        "the extraction step of FractalSwarm does. Give the speaker's availability as, for each "
        "day they can attend, the indices of the slots they can attend, and their time "
        "preference.\n" + "\n".join(f"- {line}" for line in GUIDE) + "\n"
        "Reply with JSON matching the schema."
    ),
    "abstract": (
        "You read the abstract of one conference talk and extract the audience size it states, "
        "as the extraction step of FractalSwarm does. Give the expected attendance as a number.\n"
        "Reply with JSON matching the schema."
    ),
}
HEADER = "Read the note below and answer with the schema."

CAVEATS = (
    {
        "id": "generator",
        "text": "On the generator's emails the regex parser wins by construction: its patterns "
        "are the phrasings the generator writes. Read the comparison on notes a person wrote.",
    },
    {
        "id": "reference",
        "text": "Muse seeds the approved reference and a person approves it, so where Muse "
        "agrees with the reference, part of that agreement is the person accepting its reading.",
    },
    {
        "id": "fake",
        "text": "This run used the fake backend: its Muse is the same regex parser, so the two "
        "agree by construction. It checks the plumbing and the scoring, not the models.",
    },
)
DEFINITIONS = {
    "understood": "an email: the available cells match the reference exactly and so does the "
    f"time preference; an abstract: the attendance is within {ATTENDANCE_TOLERANCE_PCT} % of the "
    "reference",
    "jaccard": "shared cells over all cells named by either the reading or the reference",
    "agreement": "how the two readers split the notes: both, only Muse, only the parser, neither",
    "differences": "the notes on which the parser's reading and Muse's reading are not the same",
}


# -- what Muse is asked, and how it answers ------------------------------------------------------


class EmailReading(Strict):
    available: list[DayAvailability]
    preference: Literal["morning", "afternoon", "none"]


class AbstractReading(Strict):
    expected_attendance: int


# One schema per kind of note; the values have the shape of the facts the extraction publishes.
SCHEMAS: dict[str, tuple[str, type[Strict]]] = {
    "email": ("t2_ablation_email", EmailReading),
    "abstract": ("t2_ablation_abstract", AbstractReading),
}
for _name, _model in SCHEMAS.values():
    register_output(_name, _model)


class Case(BaseModel):
    """One note and what a person approved for it (``reference`` has the shape of a reading)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    # The id goes into effect tags and contract scopes, so it cannot hold the tag separator.
    id: str = Field(pattern=r"^[\w.:@-]{1,64}$")
    kind: Literal["email", "abstract"]
    subject: str = Field(max_length=200)  # the speaker (email) or talk (abstract) it is about
    text: str = Field(max_length=MAX_NOTE_CHARS)
    reference: dict[str, Any]

    @model_validator(mode="after")
    def _reference_fits_the_kind(self) -> "Case":
        SCHEMAS[self.kind][1].model_validate(self.reference)
        return self


def normalize(value: dict[str, Any]) -> dict[str, Any]:
    """An email reading with each day once, its slots sorted and unique, and days without a slot
    left out; an abstract reading as it is."""
    if "available" not in value:
        return dict(value)
    slots: dict[int, set[int]] = defaultdict(set)
    for entry in value["available"]:
        slots[entry["day"]].update(entry["slots"])
    available = [{"day": day, "slots": sorted(slots[day])} for day in sorted(slots) if slots[day]]
    return {"available": available, "preference": value["preference"]}


def cells(value: dict[str, Any]) -> set[tuple[int, int]]:
    return {(entry["day"], slot) for entry in value["available"] for slot in entry["slots"]}


def cases_from_corpus(
    corpus: dict[str, Any],
    truth: dict[str, Any],
    *,
    emails: int | None = None,
    abstracts: int | None = None,
) -> list[Case]:
    """The notes of a T2 corpus with the reference of its truth (the generator's, or an approved
    one): the first ``emails`` emails, then the first ``abstracts`` abstracts, by id."""
    found: list[Case] = []
    for email in sorted(corpus["emails"], key=lambda item: item["id"])[:emails]:
        speaker = email["speaker_id"]
        taken = truth["availability"][speaker]
        available = [
            {"day": day, "slots": [slot for d, slot in taken if d == day]} for day in corpus["days"]
        ]
        reference = normalize(
            {"available": available, "preference": truth["preferences"].get(speaker) or "none"}
        )
        found.append(
            Case(
                id=email["id"],
                kind="email",
                subject=speaker,
                text=email["body"],
                reference=reference,
            )
        )
    for talk in sorted(corpus["talks"], key=lambda item: item["id"])[:abstracts]:
        reference = {"expected_attendance": truth["attendance"][talk["id"]]}
        found.append(
            Case(
                id=talk["id"],
                kind="abstract",
                subject=talk["id"],
                text=talk["abstract"],
                reference=reference,
            )
        )
    return found


def frame_of(params: dict[str, Any]) -> dict[str, Any]:
    """The days and slots the notes are read against."""
    options = params.get("ablation") or {}
    corpus = params.get("corpus") or {}
    frame = options.get("frame") or {"days": corpus.get("days"), "slots": corpus.get("slots")}
    if not frame["days"] or not frame["slots"]:
        raise ValueError("the ablation needs the days and slots of the conference")
    return {"days": list(frame["days"]), "slots": list(frame["slots"])}


def cases_of(params: dict[str, Any]) -> list[Case]:
    """The notes of a run: its inline ``cases``, else the ones in its corpus and truth."""
    options = params.get("ablation") or {}
    if options.get("cases"):
        found = [Case.model_validate(case) for case in options["cases"]]
    else:
        found = cases_from_corpus(
            params.get("corpus") or {"emails": [], "talks": []},
            params.get("truth") or {},
            emails=options.get("emails"),
            abstracts=options.get("abstracts"),
        )
    if not found:
        raise ValueError("the ablation has no notes to read")
    ids = [case.id for case in found]
    if len(set(ids)) != len(ids):
        raise ValueError("note ids must be unique")
    return found


def source_of(params: dict[str, Any]) -> str:
    """Where the reference comes from: the generator's truth carries its patterns."""
    options = params.get("ablation") or {}
    if options.get("source"):
        return str(options["source"])
    return "generator" if "patterns" in (params.get("truth") or {}) else "approved"


# -- the two readers and the score ---------------------------------------------------------------


def parse_note(case: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
    """What the hand-written regex parser reads from a note."""
    if case["kind"] == "abstract":
        return {"expected_attendance": parse_attendance(case["text"])}
    days = frame["days"]
    available, preference = parse_email(case["text"], days, frame["slots"])
    reading = {
        "available": [{"day": d, "slots": available[d]} for d in days],
        "preference": preference,
    }
    return normalize(reading)


def read_answer(kind: str, text: str) -> tuple[dict[str, Any] | None, str | None]:
    """Muse's reading from its structured answer, or why there is none."""
    value, errors = parse_json(SCHEMAS[kind][1], text)
    if value is None:
        return None, "; ".join(errors)
    return normalize(value.model_dump(mode="json")), None


def score(kind: str, reference: dict[str, Any], reading: dict[str, Any] | None) -> dict[str, Any]:
    """A reading against the reference. No reading scores as not understood."""
    if kind == "abstract":
        if reading is None:
            return {"understood": False, "within": False, "error": None, "error_pct": None}
        want, got = reference["expected_attendance"], reading["expected_attendance"]
        error = got - want
        within = abs(error) * 100 <= abs(want) * ATTENDANCE_TOLERANCE_PCT
        error_pct = None if want == 0 else abs(error) / abs(want) * 100
        return {"understood": within, "within": within, "error": error, "error_pct": error_pct}
    if reading is None:
        return {"understood": False, "cells_exact": False, "jaccard": 0.0, "preference": False}
    want_cells, got_cells = cells(reference), cells(reading)
    union = want_cells | got_cells
    exact = want_cells == got_cells
    preference = reading["preference"] == reference["preference"]
    return {
        "understood": exact and preference,
        "cells_exact": exact,
        "jaccard": len(want_cells & got_cells) / len(union) if union else 1.0,
        "preference": preference,
    }


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _side(results: list[dict[str, Any]], who: str) -> dict[str, Any]:
    scores = [(note["kind"], note[who]["score"]) for note in results]
    emails = [s for kind, s in scores if kind == "email"]
    abstracts = [s for kind, s in scores if kind == "abstract"]
    return {
        "understood": sum(s["understood"] for _, s in scores),
        "of": len(scores),
        "emails": {
            "of": len(emails),
            "understood": sum(s["understood"] for s in emails),
            "cells_exact": sum(s["cells_exact"] for s in emails),
            "preference": sum(s["preference"] for s in emails),
            "mean_jaccard": _mean([s["jaccard"] for s in emails]),
        },
        "abstracts": {
            "of": len(abstracts),
            "understood": sum(s["understood"] for s in abstracts),
            "mean_error_pct": _mean(
                [s["error_pct"] for s in abstracts if s["error_pct"] is not None]
            ),
        },
    }


def summarize(
    results: list[dict[str, Any]], *, source: str, backend: str, complete: bool
) -> dict[str, Any]:
    """The payload of ``ablation.done`` from the notes' results (in the order of the cases)."""
    parser, muse = _side(results, "parser"), _side(results, "muse")
    parser_ok = [bool(n["parser"]["score"]["understood"]) for n in results]
    muse_ok = [bool(n["muse"]["score"]["understood"]) for n in results]
    applies = {
        "generator": source == "generator",
        "reference": source != "generator",
        "fake": backend == "fake",
    }
    return {
        "complete": complete,
        "headline": f"the parser understood {parser['understood']} of {len(results)} notes, "
        f"Muse {muse['understood']} of {len(results)}",
        "source": source,
        "backend": backend,
        "notes": len(results),
        "parser": parser,
        "muse": muse,
        "agreement": {
            "both": sum(p and m for p, m in zip(parser_ok, muse_ok, strict=True)),
            "only_muse": sum(m and not p for p, m in zip(parser_ok, muse_ok, strict=True)),
            "only_parser": sum(p and not m for p, m in zip(parser_ok, muse_ok, strict=True)),
            "neither": sum(not p and not m for p, m in zip(parser_ok, muse_ok, strict=True)),
        },
        "differences": [
            n["note_id"] for n in results if n["parser"]["reading"] != n["muse"]["reading"]
        ],
        "caveats": [{**caveat, "applies": applies[caveat["id"]]} for caveat in CAVEATS],
        "definitions": DEFINITIONS,
    }


# -- the fake Muse of the $0 path ----------------------------------------------------------------


def _fake_email(body: dict[str, Any]) -> str:
    blocks = read_blocks(body["input"])
    days, slots = blocks["days"], blocks["slots"]
    available, preference = parse_email(blocks["note"]["text"], days, slots)
    available = [{"day": d, "slots": available[d]} for d in days if available[d]]
    return json.dumps({"available": available, "preference": preference}, sort_keys=True)


def _fake_abstract(body: dict[str, Any]) -> str:
    text = read_blocks(body["input"])["note"]["text"]
    return json.dumps({"expected_attendance": parse_attendance(text)})


# The T2 fake answers by the name of the requested schema; these two are ours.
t2_fake.HANDLERS["t2_ablation_email"] = _fake_email
t2_fake.HANDLERS["t2_ablation_abstract"] = _fake_abstract


# -- the scenario --------------------------------------------------------------------------------


@register("ablation.note")
class AblationNote(Payload):
    note_id: str
    kind: str
    subject: str
    reference: dict[str, Any]
    parser: dict[str, Any]  # {reading, score}
    muse: dict[str, Any]  # {reading, score, effect_id, error}


@register("ablation.done")
class AblationDone(Payload):
    complete: bool
    headline: str
    source: str
    backend: str
    notes: int
    parser: dict[str, Any]
    muse: dict[str, Any]
    agreement: dict[str, int]
    differences: list[str]
    caveats: list[dict[str, Any]]
    definitions: dict[str, str]


def muse_request(case: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
    """One Muse call: the static instructions first, the frame, then the note, spotlighted."""
    name, model = SCHEMAS[case["kind"]]
    data = {"days": frame["days"], "slots": frame["slots"]} if case["kind"] == "email" else {}
    note = {k: case[k] for k in ("id", "kind", "subject", "text")}
    return plan_request(
        role="agent",
        schema_name=name,
        model=model,
        instructions=INSTRUCTIONS[case["kind"]],
        header=HEADER,
        data=data,
        untrusted={"note": note},
    )


def ablator_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        **args,
        "index": {case["id"]: i for i, case in enumerate(args["cases"])},
        "next": 0,
        "open": 0,
        "results": [],
        "calls": 0,
        "fake_calls": 0,
    }


def _start_more(state: dict[str, Any]) -> tuple[dict[str, Any], list[Command]]:
    """Start the next notes while fewer than ``concurrency`` calls are open."""
    commands: list[Command] = []
    cases, next_case, open_calls = state["cases"], state["next"], state["open"]
    while open_calls < state["concurrency"] and next_case < len(cases):
        case = cases[next_case]
        scopes = {"contract": f"ablate-{case['id']}", "squad": SQUAD}
        request = muse_request(case, state["frame"])
        commands.append(
            StartEffect(kind="llm", request=request, tag=f"ablate|{case['id']}", scopes=scopes)
        )
        next_case, open_calls = next_case + 1, open_calls + 1
    return {**state, "next": next_case, "open": open_calls}, commands


def _result(
    state: dict[str, Any], case: dict[str, Any], reading: dict[str, Any] | None, **muse: Any
) -> dict[str, Any]:
    kind = case["kind"]
    reference = normalize(case["reference"])
    parsed = parse_note(case, state["frame"])
    return {
        "note_id": case["id"],
        "kind": kind,
        "subject": case["subject"],
        "reference": reference,
        "parser": {"reading": parsed, "score": score(kind, reference, parsed)},
        "muse": {"reading": reading, "score": score(kind, reference, reading)} | muse,
    }


def _answered(state: dict[str, Any], event: Event) -> tuple[dict[str, Any], dict[str, Any]]:
    payload = event.payload
    case = state["cases"][state["index"][payload["tag"].split("|", 1)[1]]]
    result = payload.get("result") or {}
    reading, error = None, None
    if payload["status"] == "ok":
        reading, error = read_answer(case["kind"], result.get("output_text", ""))
    else:
        why = result.get("error") or result.get("reason") or "no answer"
        error = f"{payload['status']}: {why}"
    fake = str(result.get("response_id", "")).startswith("resp_fake_")
    note = _result(state, case, reading, effect_id=payload["effect_id"], error=error)
    state = {
        **state,
        "open": state["open"] - 1,
        "results": [*state["results"], note],
        "calls": state["calls"] + (payload["status"] == "ok"),
        "fake_calls": state["fake_calls"] + fake,
    }
    return state, note


def _finish(state: dict[str, Any], *, complete: bool) -> tuple[dict[str, Any], list[Command]]:
    """The summary, after a note that got no answer in time is counted as missed."""
    done = {result["note_id"] for result in state["results"]}
    emitted: list[Command] = []
    results = list(state["results"])
    for case in state["cases"]:
        if case["id"] not in done:
            note = _result(state, case, None, effect_id=None, error="no answer before the deadline")
            results.append(note)
            emitted.append(Emit(type="ablation.note", payload=note))
    order = state["index"]
    results.sort(key=lambda note: order[note["note_id"]])
    calls, fake = state["calls"], state["fake_calls"]
    backend = (
        "unknown" if calls == 0 else "fake" if fake == calls else "real" if fake == 0 else "mixed"
    )
    summary = summarize(results, source=state["source"], backend=backend, complete=complete)
    emitted.append(Emit(type="ablation.done", payload=summary))
    if complete:
        emitted.append(Cancel(tag="deadline"))
    emitted.append(Stop(reason="done" if complete else "deadline", cancel=not complete))
    return {**state, "results": results, "finished": True}, emitted


def ablator_handle(
    state: dict[str, Any], event: Event, view: View
) -> tuple[dict[str, Any], list[Command]]:
    if state.get("finished"):
        return state, []
    if event.type == "actor.spawned":
        state, started = _start_more(state)
        return state, [SetTimer(delay_ms=state["deadline_ms"], tag="deadline"), *started]
    if event.type != "effect.completed":
        return state, []
    tag = event.payload["tag"] or ""
    if tag == "deadline":
        return _finish(state, complete=False)
    if not tag.startswith("ablate|"):
        return state, []
    state, note = _answered(state, event)
    commands: list[Command] = [Emit(type="ablation.note", payload=note)]
    if len(state["results"]) == len(state["cases"]):
        state, closing = _finish(state, complete=True)
        return state, commands + closing
    state, started = _start_more(state)
    return state, commands + started


class AblationScenario:
    kinds = {"ablator": ActorKind(ablator_init, ablator_handle)}

    def boot(self, params: dict[str, Any]) -> list[Command]:
        options = params.get("ablation") or {}
        cap = float(options.get("squad_cap_usd", CAP_USD))
        args = {
            "cases": [case.model_dump(mode="json") for case in cases_of(params)],
            "frame": frame_of(params),
            "source": source_of(params),
            "concurrency": int(options.get("concurrency", CONCURRENCY)),
            "deadline_ms": int(options.get("deadline_ms", DEADLINE_MS)),
        }
        return [
            SetCap(level="squad", key=SQUAD, usd=cap),
            Spawn(actor_id="ablator", kind="ablator", args=args),
        ]


ABLATION = AblationScenario()
