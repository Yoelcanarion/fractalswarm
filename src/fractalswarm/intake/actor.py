"""The ``intake`` scenario: one actor that reads pasted text into a proposal.

``params``: ``{"segments": {"talks", "notes", "conference"}, "rooms": [...] | None,
"grid": {"days", "slots"}}``. The actor firewall-scans every pasted segment (surface
``intake``: a hostile text is refused outright, not quarantined), then makes one ``llm`` call
with the role ``intake`` whose prompt carries the segments in untrusted blocks (never in the
system prompt), and logs the shaped result as ``intake.proposed``. Being a scenario, it is
logged, replayable and visible in the lens like any other run.
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.intake import events as _events  # noqa: F401  (registers the event types)
from fractalswarm.intake.schema import IntakeOutput, intake_request
from fractalswarm.intake.shape import DAYS, shape, slot_grid
from fractalswarm.intake.truth import text_sha256
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import ActorKind, Command, Emit, Spawn, StartEffect, Stop, View
from fractalswarm.planning.planner import parse_json
from fractalswarm.safety import events as _safety_events  # noqa: F401
from fractalswarm.safety.firewall import Verdict, scan_request

ACTOR = "intake"
SEGMENTS = ("conference", "talks", "notes")  # the order they are scanned and shown in
MAX_ATTEMPTS = 2  # the call, and one more with the parse errors as feedback


def intake_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": actor_id,
        "segments": dict(args["segments"]),
        "grid": args["grid"],
        "rooms": args.get("rooms"),
        "scans": {},
        "attempt": 0,
    }


def _pasted(state: dict[str, Any]) -> list[str]:
    return [name for name in SEGMENTS if state["segments"].get(name)]


def intake_handle(state: dict[str, Any], event: Event, view: View):
    if event.type == "actor.spawned":
        names = _pasted(state)
        if not names:
            failed = {"errors": ["nothing was pasted"]}
            return state, [Emit(type="intake.failed", payload=failed), Stop()]
        return state, [
            StartEffect(
                kind="firewall",
                request=scan_request(state["segments"][name], "intake", name),
                tag=f"scan|{name}",
            )
            for name in names
        ]
    if event.type == "effect.completed":
        kind, _, name = (event.payload["tag"] or "").partition("|")
        if kind == "scan":
            return _scanned(state, name, event)
        if kind == "read":
            return _read(state, event)
    return state, []


def _scanned(state: dict[str, Any], name: str, event: Event):
    if name in state["scans"] or name not in _pasted(state):
        return state, []
    if event.payload["status"] == "ok":
        verdict = Verdict.model_validate(event.payload["result"])
    else:  # fail closed: a text nobody could scan is not read
        error = event.payload["result"].get("error") or event.payload["status"]
        reasons = [f"the scan failed: {error}"]
        verdict = Verdict(
            surface="intake",
            source_id=name,
            decision="block",
            score=1.0,
            backend="none",
            reasons=reasons,
        )
    state = {**state, "scans": {**state["scans"], name: verdict.model_dump(mode="json")}}
    commands: list[Command] = [
        Emit(type="security.scanned", payload=verdict.model_dump(mode="json"))
    ]
    if len(state["scans"]) < len(_pasted(state)):
        return state, commands
    scans = state["scans"]
    blocked = [n for n in SEGMENTS if n in scans and scans[n]["decision"] != "allow"]
    if blocked:
        reasons = [r for n in blocked for r in scans[n]["reasons"]]
        refused = {"segments": blocked, "reason": "; ".join(reasons) or "blocked by the firewall"}
        return state, [*commands, Emit(type="intake.refused", payload=refused), Stop()]
    return state, [*commands, _call(state, [])]


def _call(state: dict[str, Any], feedback: list[str]) -> StartEffect:
    request = intake_request(
        state["segments"], state["grid"]["days"], state["grid"]["slots"], feedback
    )
    return StartEffect(kind="llm", request=request, tag="read", scopes={"squad": ACTOR})


def _read(state: dict[str, Any], event: Event):
    status, result = event.payload["status"], event.payload["result"]
    if status == "ok":
        read, errors = parse_json(IntakeOutput, result.get("output_text", ""))
    else:
        read, errors = None, [f"the call {status}: {result.get('error') or ''}".strip()]
    if read is None:
        attempt = state["attempt"] + 1
        if attempt < MAX_ATTEMPTS:
            state = {**state, "attempt": attempt}
            return state, [_call(state, errors)]
        return state, [Emit(type="intake.failed", payload={"errors": errors}), Stop()]
    texts = {name: text for name, text in state["segments"].items() if name != "conference"}
    proposal = shape(read.model_dump(), texts, state["rooms"])
    if not proposal["conference"] and state["segments"].get("conference"):
        proposal["conference"] = state["segments"]["conference"].strip()
    proposed = {"proposal": proposal, "input_sha256": text_sha256(state["segments"])}
    return state, [Emit(type="intake.proposed", payload=proposed), Stop()]


@dataclass(frozen=True)
class IntakeScenario:
    kinds = {ACTOR: ActorKind(intake_init, intake_handle)}

    def boot(self, params: dict[str, Any]) -> list[Command]:
        args = {
            "segments": params["segments"],
            "rooms": params.get("rooms"),
            "grid": params.get("grid") or {"days": list(DAYS), "slots": slot_grid()},
        }
        return [Spawn(actor_id=ACTOR, kind=ACTOR, args=args)]


INTAKE = IntakeScenario()
