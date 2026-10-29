"""A person's controls on a live run (step 7), as the API puts them into its control inbox.

Each body the UI posts becomes one or more controls, ``{"op", "body", "to"}`` (``kernel/events.py:
ControlInjected``), carried by an ``{"op": "inject", "control": ...}`` inbox request. The run's
driver turns each into a ``control.injected`` event when its queue is empty, so replay puts it in
the same place. What each one asks of the run:

- ``chaos`` (to the chaos monkey, ``chaos``): a kill at a progress point. ``kill_coordinator``
  (``target`` optional), ``kill_agent`` (``target``, or ``count`` agents drawn at random) and
  ``kill_half`` (the root, two track leads and two session owners: ``cli.kill_half_plan``'s five).
  ``at`` is the progress, 0 to 1, where it fires; 0 (the default) is now.
- ``approve`` and ``replan`` (to ``goal:<id>``): the answer to a plan the run holds for a person
  (``auto_approve: false``). The goal's owner acts, whoever it is by then.
- ``answer`` (to ``goal:<id>`` of the escalation): the choice a person made for an escalation
  that is waiting for one, ``{"escalation_id", "choice"}``.

Nothing here reads a run. The caller checks that the run is live and was launched to take
controls (``live_control`` in its params), and a control the run cannot use is ignored by its
actors and stays in its log.
"""

import re
from typing import Any

from pydantic import ValidationError

from fractalswarm.kernel.events import GOAL_CONTROL, ControlInjected

CHAOS = "chaos"  # the monkey's actor id (comms/chaos.py)
ROOT_GOAL = "root"
# The kinds a person can inject into a run that is going. An API storm and network faults are
# set when the chaos network starts, so they belong to the plan a run is launched with.
CHAOS_KINDS = ("kill_half", "kill_coordinator", "kill_agent")
NOT_LIVE_KINDS = ("api_storm", "net_fault")
# T2's ten orchestrators, killed in this order: ``cli.kill_half_plan`` (a test keeps them equal).
KILL_HALF_TARGETS = ("o0", "o2.1", "o1", "o3.2", "o2")
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
MAX_TEXT = 2000


class ControlError(ValueError):
    """A request that cannot be a control: ``status`` is the HTTP code, 422 unless said."""

    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status


def chaos_controls(body: dict[str, Any]) -> list[dict[str, Any]]:
    """The controls for ``POST /api/runs/{id}/chaos``: ``{"kind", "at"?, "target"?, "count"?}``."""
    kind = body.get("kind")
    if kind in NOT_LIVE_KINDS:
        raise ControlError(
            f"{kind} cannot be injected into a running run: it is part of the chaos plan a run "
            f"starts with; live kinds are {', '.join(CHAOS_KINDS)}"
        )
    if kind not in CHAOS_KINDS:
        raise ControlError(f"chaos kind must be one of {', '.join(CHAOS_KINDS)}")
    at = _number(body.get("at", 0.0), "at", 0.0, 1.0)
    target = _text(body.get("target"), "target", 64, ID)
    if kind == "kill_half":
        parts = [{"kind": "kill_coordinator", "at": at, "target": t} for t in KILL_HALF_TARGETS]
    else:
        parts = [{"kind": kind, "at": at}]
        if target is not None:
            parts[0]["target"] = target
        if kind == "kill_agent" and "count" in body:
            count = body["count"]
            if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 100:
                raise ControlError("count must be a whole number from 1 to 100")
            parts[0]["count"] = count
    return [control(CHAOS, "chaos", part) for part in parts]


def approve_control(body: dict[str, Any]) -> dict[str, Any]:
    """The control for ``POST /api/runs/{id}/approve``: ``{"goal_id"?, "approve"?, "reason"?,
    "plan_hash"?}``. ``approve: false`` sends the plan back (``replan``) with ``reason`` (or
    ``feedback``) as the planner's feedback."""
    goal = _text(body.get("goal_id", ROOT_GOAL), "goal_id", 64, ID) or ROOT_GOAL
    approve = body.get("approve", True)
    if not isinstance(approve, bool):
        raise ControlError("approve must be true or false")
    plan_hash = _text(body.get("plan_hash"), "plan_hash", 128)
    detail: dict[str, Any] = {} if plan_hash is None else {"plan_hash": plan_hash}
    if approve:
        return control(GOAL_CONTROL + goal, "approve", detail)
    feedback = _text(body.get("reason") or body.get("feedback"), "reason", MAX_TEXT)
    return control(
        GOAL_CONTROL + goal,
        "replan",
        detail | {"feedback": feedback or "the plan was not approved"},
    )


def answer_control(escalation_id: str, goal_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """The control for ``POST /api/runs/{id}/escalations/{eid}``: ``{"choice"}`` answers the
    escalation of goal ``goal_id`` (the one that opened it)."""
    choice = _text(body.get("choice"), "choice", MAX_TEXT)
    if not choice:
        raise ControlError("choice is required: what the person decided")
    if not ID.fullmatch(goal_id):
        raise ControlError("goal_id is not a goal id")
    detail = {"escalation_id": escalation_id, "choice": choice}
    return control(GOAL_CONTROL + goal_id, "answer", detail)


def control(to: str, op: str, body: dict[str, Any]) -> dict[str, Any]:
    """One control, as the model of its event says it must be."""
    try:
        return ControlInjected.model_validate({"op": op, "body": body, "to": to}).model_dump()
    except ValidationError as exc:
        raise ControlError(str(exc.errors()[0]["msg"])) from None


def inbox_request(found: dict[str, Any]) -> dict[str, Any]:
    """The request a run's control inbox takes for a control."""
    return {"op": "inject", "control": found}


def _number(value: Any, name: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ControlError(f"{name} must be a number from {low:g} to {high:g}")
    if not low <= value <= high:  # also false for NaN
        raise ControlError(f"{name} must be a number from {low:g} to {high:g}")
    return float(value)


def _text(value: Any, name: str, limit: int, pattern: re.Pattern[str] | None = None) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise ControlError(f"{name} must be a string of at most {limit} characters")
    if pattern is not None and not pattern.fullmatch(value):
        raise ControlError(f"{name} is not a valid id")
    return value
