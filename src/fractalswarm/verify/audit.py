"""``fractalswarm audit verify RUN``: check a run's audit trail (spec §13).

The audit is the hash-chained log itself. Verification checks:

1. the hash chain is intact (and matches ``HEAD`` when the bundle carries one);
2. every security decision states its reason;
3. every quarantine follows a firewall scan of the same source;
4. the kill switch was honored: after ``run.halted`` nothing new starts (no delivery, no
   effect, no message, no spawn) and no effect completes;
5. optionally (``--replay``), the run replays bit for bit.

It also lists the security decisions, which is what the UI security view shows.
"""

from pathlib import Path
from typing import Any

from pydantic import BaseModel

from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import ChainReport, EventStore

SECURITY_TYPES = (
    "security.scanned",
    "security.quarantined",
    "security.policy",
    "security.routed",
    "tool.denied",
    "scope.approval",
    "scope.violation",
    "budget.refused",
    "budget.shock",
    "run.halted",
)
# Types that may not appear once the run is halted (the halt's own cleanup is
# ``effect.cancelled``, ``budget.settled`` and ``actor.stopped``, then ``run.completed``).
AFTER_HALT_FORBIDDEN = ("effect.started", "effect.completed", "msg.sent", "actor.spawned")


class AuditEntry(BaseModel):
    seq: int
    type: str
    actor: str
    ts_virtual: int
    summary: str
    payload: dict[str, Any]


class AuditReport(BaseModel):
    ok: bool
    chain: ChainReport
    head_file_ok: bool | None = None
    problems: list[str] = []
    entries: list[AuditEntry] = []
    halted_at: int | None = None
    replay_ok: bool | None = None


def _summary(event: Event) -> str:
    p = event.payload
    match event.type:
        case "security.scanned":
            return f"{p['surface']} {p['source_id']}: {p['decision']} (score {p['score']:.4f})"
        case "security.quarantined":
            return f"quarantined {p['source_id']}: {p['reason']}"
        case "security.policy":
            return f"intake {p['task_id']}: {p['decision']} {p['categories']}"
        case "security.routed":
            target = "contributor" if p["contributor"] else "standard"
            return f"{p['request_id']} -> {target}: {p['reason']}"
        case "tool.denied":
            return f"tool {p['tool']} denied: {p['reason']}"
        case "scope.approval":
            return f"{p['subgoal_id']} approved by {p['approver']}"
        case "scope.violation":
            return f"BLOCKED {p['subgoal_id']}: {'; '.join(p['reasons'])}"
        case "budget.refused":
            return f"{p['effect_id']} refused: {p['level']} {p['key']} cap"
        case "budget.shock":
            return f"budget shock: {p['level']} {p['key']} cap -> ${p['usd']:.4f}"
        case "run.halted":
            return f"HALTED by {p['by']}: {p['reason']}"
    return event.type


def _reason_problems(event: Event) -> list[str]:
    p = event.payload
    missing = False
    if event.type == "scope.violation":
        missing = not p.get("reasons") or not all(p["reasons"]) or not p.get("codes")
    elif event.type in ("security.quarantined", "tool.denied", "security.routed", "run.halted"):
        missing = not str(p.get("reason", "")).strip()
    elif event.type == "security.scanned" and p.get("decision") != "allow":
        missing = not p.get("reasons")
    elif event.type == "security.policy" and p.get("decision") != "allow":
        missing = not str(p.get("explanation", "")).strip()
    return [f"seq {event.seq}: {event.type} has no reason"] if missing else []


def audit_log(log: EventStore, head: str | None = None) -> AuditReport:
    chain = log.verify_chain()
    report = AuditReport(ok=False, chain=chain)
    if not chain.ok:
        report.problems.append(f"hash chain broken at seq {chain.first_bad_seq}: {chain.reason}")
        return report
    if head is not None:
        report.head_file_ok = head == chain.head_hash
        if not report.head_file_ok:
            report.problems.append(f"HEAD {head} does not match the log head {chain.head_hash}")

    scanned: set[str] = set()
    for event in log.read():
        if report.halted_at is not None and event.type in AFTER_HALT_FORBIDDEN:
            report.problems.append(
                f"seq {event.seq}: {event.type} after run.halted (seq {report.halted_at})"
            )
        if event.type == "run.halted" and report.halted_at is None:
            report.halted_at = event.seq
        if event.type == "security.scanned":
            scanned.add(event.payload["source_id"])
        if event.type == "security.quarantined" and event.payload["source_id"] not in scanned:
            report.problems.append(
                f"seq {event.seq}: quarantine of {event.payload['source_id']} without a scan"
            )
        if event.type in SECURITY_TYPES:
            report.problems += _reason_problems(event)
            report.entries.append(
                AuditEntry(
                    seq=event.seq,
                    type=event.type,
                    actor=event.actor,
                    ts_virtual=event.ts_virtual,
                    summary=_summary(event),
                    payload=event.payload,
                )
            )
    report.ok = not report.problems
    return report


async def audit_run(run_dir: Path, *, with_replay: bool = False) -> AuditReport:
    from fractalswarm.runs import RunPaths, replay_run

    paths = RunPaths(run_dir)
    head_file = run_dir / "HEAD"
    head = head_file.read_text(encoding="utf-8").strip() if head_file.exists() else None
    with paths.open_log() as log:
        report = audit_log(log, head)
    if with_replay and report.chain.ok:
        replayed = await replay_run(run_dir)
        report.replay_ok = replayed.ok
        if not replayed.ok:
            report.problems.append(
                f"replay diverges at seq {replayed.first_divergence}: {replayed.detail}"
            )
        report.ok = not report.problems
    return report
