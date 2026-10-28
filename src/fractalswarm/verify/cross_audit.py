"""The cross-squad audit (spec §11 step 3): a sibling re-checks a squad's contracts.

``verify/audit.py`` is the security audit trail; this is something else, the third stage of
a contract's verification, after the deterministic checks and the judge:

1. **Sampling.** Every contract that passed the judge is sampled with a seeded draw, so every
   orchestrator (an heir after a takeover included) gets the same answer: 100% of the
   critical path and of contracts with risk r >= 0.7, 50% for 0.4 <= r < 0.7, 15% otherwise
   (``planning/risk.py`` computes r). A contract whose earlier attempt failed its audit is
   always audited again. The decision is written to the log (``verify.sampled``) and the log's
   copy is the one every later reader uses, since r moves as the role's history grows.
2. **The auditor.** A sibling of the owner chosen by HRW (``coord/hrw.py``), else any other
   live orchestrator: it runs one LLM call (the ``auditor`` role of the ladder, ``config/
   roles.yaml``) on the contract's data and output and tells the owner.
3. **The verdict** is a ``verify.audited`` event. ``pass`` lets the contract go on to booking
   and ``contract.verified``. ``fail`` puts it back on the replanning ladder (spec §5.5, steps
   1-2: retry with the auditor's reasons as feedback, then reassign), like a failed judge; the
   retry is audited again. An auditor that cannot answer (an API error, an unusable reply, or
   no live auditor) does not block the contract: the audit is ``skipped``, with the reason.

The audit is off unless the TaskSpec asks for it (``cross_audit: true``). The auditor's call
and its answer are in the log, so a dead owner's heir adopts the verdict instead of asking
again, and an owner whose auditor died asks the next one (``AuditView``).
"""

import random
from collections.abc import Iterable
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from fractalswarm.coord.hrw import rank
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.planning.contracts import Contract
from fractalswarm.planning.planner import parse_json, plan_request
from fractalswarm.verify.judge import Verdict

TOPIC_REQUEST = "audit.request"
TOPIC_RESULT = "audit.result"
TAG = "audit"  # the effect tag is audit|<goal>|<contract>|<attempt>

HIGH_RISK = 0.7
MID_RISK = 0.4
MAX_REASONS = 8
MAX_REASON_CHARS = 400

AUDIT_INSTRUCTIONS = """You are an auditor in FractalSwarm, from a squad other than the one
that produced this output. You did not write it and you did not judge it. Re-check it
independently against the contract and its data: coverage, consistency, and every
constraint the data states. Fail it only for a concrete problem that you can name; list the
problems as short, actionable reasons. Reply with JSON matching the schema."""

Key = tuple[str, int]  # (work = goal/contract, attempt)


# -- sampling -----------------------------------------------------------------------------


class Sampling(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rate: float
    basis: str
    draw: float
    selected: bool


def audit_rate(r: float, critical_path: bool, forced: bool = False) -> tuple[float, str]:
    """(share of contracts audited, why): spec §11.3."""
    if forced:
        return 1.0, "an earlier attempt failed its audit"
    if critical_path:
        return 1.0, "critical path"
    if r >= HIGH_RISK:
        return 1.0, f"risk >= {HIGH_RISK}"
    if r >= MID_RISK:
        return 0.5, f"{MID_RISK} <= risk < {HIGH_RISK}"
    return 0.15, f"risk < {MID_RISK}"


def draw(seed: str, work: str, attempt: int) -> float:
    """The contract's draw in [0, 1): a seeded stream per (run seed, contract, attempt), not
    per actor, so a takeover does not re-roll it, and not shared, so the order in which
    contracts are verified does not matter."""
    return random.Random(f"{seed}:{work}:audit:{attempt}").random()


def sample(
    seed: str, work: str, attempt: int, r: float, critical_path: bool, forced: bool = False
) -> Sampling:
    rate, basis = audit_rate(r, critical_path, forced)
    value = draw(seed, work, attempt)
    return Sampling(rate=rate, basis=basis, draw=value, selected=value < rate)


def pick_auditor(work: str, attempt: int, pool: Iterable[str]) -> str | None:
    """The HRW maximum of the pool for this contract and attempt (spec §5.3): every orchestrator
    names the same one, and when one dies only the contracts it was to audit move."""
    ranked = rank(f"audit:{work}:{attempt}", pool)
    return ranked[0] if ranked else None


# -- the auditor's request and verdict ----------------------------------------------------


def audit_request(
    contract: Contract, output: dict[str, Any], data: dict[str, Any]
) -> dict[str, Any]:
    return plan_request(
        role="auditor",
        schema_name="audit_verdict",
        model=Verdict,
        instructions=AUDIT_INSTRUCTIONS,
        header=f"AUDIT of CONTRACT {contract.goal_id}/{contract.id} ({contract.kind})\n"
        f"Objective: {contract.objective}",
        data={
            "audit": {
                "kind": contract.kind,
                "work": f"{contract.goal_id}/{contract.id}",
                "attempt": contract.attempt,
                "checks_passed": contract.acceptance.checks,
                "rubric": contract.acceptance.rubric,
            },
            "contract_data": data,
        },
        untrusted={"agent_output": output},
    )


class AuditOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    verdict: Literal["pass", "fail", "skipped"]
    score: float
    reasons: list[str]
    auditor: str  # empty when no auditor was alive


def skipped(reason: str, auditor: str = "") -> AuditOutcome:
    return AuditOutcome(verdict="skipped", score=0.0, reasons=[reason], auditor=auditor)


def read_audit(status: str, text: str, auditor: str) -> AuditOutcome:
    """The auditor's verdict. Like the judge's, one that cannot be used does not block the
    contract: the audit is skipped."""
    if status != "ok":
        return skipped(f"auditor unavailable ({status})", auditor)
    verdict, errors = parse_json(Verdict, text)
    if verdict is None:
        return skipped(f"audit answer unusable: {errors}", auditor)
    reasons = [reason[:MAX_REASON_CHARS] for reason in verdict.reasons[:MAX_REASONS]]
    return AuditOutcome(
        verdict=verdict.verdict, score=verdict.score, reasons=reasons, auditor=auditor
    )


# -- events -------------------------------------------------------------------------------


@register("verify.sampled")
class VerifySampled(Payload):
    """The audit sampling decision for one attempt of a contract."""

    goal_id: str
    contract_id: str
    attempt: int
    work: str
    risk: float
    terms: dict[str, float]
    critical_path: bool
    rate: float
    basis: str
    draw: float
    selected: bool
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("verify.audited")
class VerifyAudited(Payload):
    goal_id: str
    contract_id: str
    attempt: int
    auditor: str
    verdict: str  # pass | fail | skipped
    score: float
    reasons: list[str]
    reused: bool = False  # the verdict a dead owner's request already got, adopted from the log
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


# -- the audit as a view of the log -------------------------------------------------------


class AuditView:
    """What the log says about audits, for the owner, its heir and the auditors:

    - ``sampled``: the sampling decision of each (contract, attempt), the first one wins;
    - ``requested``: the auditors asked, in order (``audit.request`` messages);
    - ``running``: audit calls in flight, with the orchestrator that started each;
    - ``verdicts``: the first answer of each audit call, even when its owner is dead;
    - ``failed``: the attempts whose audit failed, by contract.
    """

    name = "audit"

    def __init__(self) -> None:
        self.sampled: dict[Key, dict[str, Any]] = {}
        self.requested: dict[Key, list[str]] = {}
        self.running: dict[str, tuple[Key, str]] = {}
        self.verdicts: dict[Key, tuple[str, str, str]] = {}  # (status, text, auditor)
        self.failed: dict[str, set[int]] = {}

    def asked(self, key: Key) -> list[str]:
        return list(self.requested.get(key, []))

    def working(self, key: Key) -> list[str]:
        return sorted(auditor for found, auditor in self.running.values() if found == key)

    def failed_before(self, work: str, attempt: int) -> bool:
        return any(earlier < attempt for earlier in self.failed.get(work, ()))

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        payload = event.payload
        kind = event.type
        if kind == "verify.sampled":
            self.sampled.setdefault((payload["work"], payload["attempt"]), payload)
        elif kind == "verify.audited" and payload["verdict"] == "fail":
            work = f"{payload['goal_id']}/{payload['contract_id']}"
            self.failed.setdefault(work, set()).add(payload["attempt"])
        elif kind == "msg.sent" and payload["topic"] == TOPIC_REQUEST:
            body = payload["body"]
            key = (f"{body['goal_id']}/{body['contract_id']}", body["attempt"])
            self.requested.setdefault(key, []).append(payload["to"])
        elif kind in ("effect.started", "effect.completed", "effect.cancelled"):
            found = _tagged(payload.get("tag"))
            if found is None:
                return
            effect_id = payload["effect_id"]
            if kind == "effect.started":
                self.running[effect_id] = (found, event.actor)
                return
            _, auditor = self.running.pop(effect_id, (found, ""))
            if kind == "effect.completed":
                text = (payload.get("result") or {}).get("output_text", "")
                self.verdicts.setdefault(found, (payload["status"], text, auditor))


def _tagged(tag: str | None) -> Key | None:
    parts = (tag or "").split("|")
    if len(parts) != 4 or parts[0] != TAG:
        return None
    return f"{parts[1]}/{parts[2]}", int(parts[3])
