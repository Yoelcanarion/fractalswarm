"""Takeover evidence: what a recorded run proves about its coordinator kills (spec §0.2, §5.3, §8).

Read-only and pure. Every number is recomputed from the event log (and the cassette, when the
run has one), never read from what an actor says about itself:

1. kills: each ``chaos.injected`` kill, its ``actor.stopped``, and proof of death (no event
   authored by the victim after it stopped, no call of the victim completing after it);
2. death verdicts: each ``member.dead``, true (the subject had stopped) or false, and the
   rejoins that followed false ones;
3. succession: for each ``ownership.remapped``, the views are rebuilt by folding the log with the
   runtime's own reducers (``MembersView``, ``TreeView``) and the heir is recomputed with
   ``coord.tree.heir``. The fold stops at the event that *caused* the remap (the heir's tick),
   which is the state the heir decided on: its other commands of the same tick are appended
   after that point, and a later state could name a different heir without any fault;
4. adoption: ``tree.adopted``, the duties it carries, and the fate of every agent result that
   went to an owner that was already dead;
5. fencing: ``write.fenced`` refusals, and every owner-scoped write checked against the goal's
   owner at that point of the log;
6. lost work: contracts, goals and the final ``task.result``;
7. duplicate calls: completed LLM calls with the same request, calls cancelled in flight and
   whether their work was redone, ``idem_key`` reuse, and the cassette;
8. invariants: hash chain, audit and (when run) replay, supplied by the caller;
9. costs: settled by role and actor, peak committed, open reservations, cancelled worst case.

``analyze`` returns every finding as data plus a list of violations; nothing is weakened to pass.
"""

import json
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from fractalswarm.bench.scoring import llm_calls, load_events
from fractalswarm.coord.hrw import rank, score
from fractalswarm.coord.membership import FencingToken, MembersView
from fractalswarm.coord.tree import GoalRecord, TreeView, candidates, heir
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.ids import digest
from fractalswarm.kernel.replay import ReplayReport
from fractalswarm.verify.audit import AuditReport, audit_log
from fractalswarm.verify.takeover_models import (
    Adoption,
    CallRef,
    CancelledCall,
    CassetteReport,
    ContractOutcome,
    Costs,
    DuplicateCall,
    Duplicates,
    FencedWrite,
    Fencing,
    GoalOutcome,
    HrwScore,
    Invariants,
    Kill,
    LostWork,
    OpenReservation,
    OrphanResult,
    Rejoin,
    Succession,
    TakeoverReport,
    TaskOutcome,
    Verdict,
    Violation,
)

KILL_FAULTS = ("kill_coordinator", "kill_agent")
PAID = ("ok", "incomplete")  # an LLM call that completed with these was billed
ROOT_DUTIES = ["final integration", "top-level arbitration"]
INNER_DUTIES = ["integration", "arbitration"]
CAP_TOLERANCE = 1e-9
SHOWN = 5  # events listed as examples in a finding


# -- entry points -------------------------------------------------------------------------


def check_run(run: Path | str, *, replay: ReplayReport | None = None) -> TakeoverReport:
    """Load a run directory (or an events file) with its cassette, audit it and analyze it.
    ``replay``: the result of replaying the run, when the caller ran it."""
    from fractalswarm.runs import RunPaths

    path = Path(run)
    paths = RunPaths(path if path.is_dir() else path.parent)
    cassette = _read_cassette(paths.cassette) if paths.cassette.exists() else None
    head = paths.root / "HEAD"
    expected = head.read_text(encoding="utf-8").strip() if head.exists() else None
    with paths.open_log() as log:
        audit = audit_log(log, expected)
        events = load_events(log)
    if is_supervisor_log(events):
        raise SupervisorLog("supervisor log: use `fractalswarm recovery`")
    return analyze(events, cassette=cassette, audit=audit, replay=replay)


class SupervisorLog(ValueError):
    """The log is a supervisor's, not a swarm's: it has ``baseline.crashed``. Its crashes are
    not kills and nobody takes over, so this report would only invent violations; the evidence
    for it is ``fractalswarm recovery`` (``verify/recovery.py``)."""


def is_supervisor_log(events: Iterable[Event]) -> bool:
    return any(event.type == "baseline.crashed" for event in events)


def is_supervisor_run(run: Path | str) -> bool:
    """``is_supervisor_log`` of a run directory (or an events file), before any costly step."""
    from fractalswarm.runs import RunPaths

    path = Path(run)
    paths = RunPaths(path if path.is_dir() else path.parent)
    with paths.open_log() as log:
        return is_supervisor_log(load_events(log))


def duplicates_of(events: Iterable[Event]) -> tuple[Duplicates, list[Violation]]:
    """The duplicate-call findings alone (§7), for the readers of logs that are not swarm logs:
    completed calls with one request, contract attempts dispatched twice, reused keys."""
    log = sorted(events, key=lambda event: event.seq)
    ix = _Index(log)
    found: list[Violation] = []
    return _duplicates(ix, _calls(ix), _estimates(log) or {}, None, found), found


def _read_cassette(path: Path) -> list[dict[str, Any]]:
    """The raw lines, not ``Cassette`` (which keeps one entry per effect id and would hide a
    duplicate)."""
    with path.open(encoding="utf-8") as lines:
        return [json.loads(line) for line in lines if line.strip()]


def analyze(
    events: Iterable[Event],
    *,
    cassette: Sequence[dict[str, Any]] | None = None,
    audit: AuditReport | None = None,
    replay: ReplayReport | None = None,
) -> TakeoverReport:
    log = sorted(events, key=lambda event: event.seq)
    ix = _Index(log)
    report = TakeoverReport(
        run_id=log[0].run_id if log else "", events=len(log), head=log[-1].hash if log else ""
    )
    found = report.violations
    calls = _calls(ix)
    estimates = _estimates(log)
    report.kills = _kills(ix, found)
    report.verdicts = _verdicts(ix, report.kills)
    folded = _fold(ix, found)
    report.successions = folded.successions
    report.chains = _chains(report.successions)
    report.adoptions = folded.adoptions
    report.orphan_results = _orphans(ix, found)
    report.fencing = folded.fencing
    report.lost_work = _lost_work(ix, folded.tree, found)
    report.duplicates = _duplicates(ix, calls, estimates or {}, cassette, found)
    report.invariants = _invariants(audit, replay, found)
    if log and not ix.of("run.completed"):
        _violation(found, "invariants", "run-incomplete", None, "the log has no run.completed")
    report.costs = _costs(ix, calls, estimates or {}, found)
    report.limits = _limits(ix, report, estimated=estimates is not None)
    report.ok = not found
    return report


def _estimates(log: list[Event]) -> dict[str, float] | None:
    """What the provider probably billed for each call cancelled in flight (bench/scoring.py),
    or ``None`` when the log's price snapshot cannot rebuild the requests."""
    try:
        return {c.effect_id: c.cost_usd for c in llm_calls(log) if c.status == "cancelled"}
    except (KeyError, TypeError, ValueError):
        return None


# -- indexes ------------------------------------------------------------------------------


class _Index:
    def __init__(self, events: list[Event]) -> None:
        self.events = events
        self.by_type: dict[str, list[Event]] = defaultdict(list)
        self.by_actor: dict[str, list[Event]] = defaultdict(list)
        self.stops: dict[str, Event] = {}  # actor -> its first actor.stopped
        self.started: dict[str, Event] = {}  # effect id -> effect.started
        self.done: dict[str, list[Event]] = defaultdict(list)  # effect id -> effect.completed
        self.cancelled: dict[str, Event] = {}
        self.settled: dict[str, Event] = {}
        self.dead: dict[str, list[Event]] = defaultdict(list)  # member -> its member.dead
        self.contract_events: dict[tuple[str, str], list[Event]] = defaultdict(list)
        for event in events:
            p = event.payload
            self.by_type[event.type].append(event)
            self.by_actor[event.actor].append(event)
            if event.type == "actor.stopped":
                self.stops.setdefault(p["actor_id"], event)
            elif event.type == "effect.started":
                self.started.setdefault(p["effect_id"], event)
            elif event.type == "effect.completed":
                self.done[p["effect_id"]].append(event)
            elif event.type == "effect.cancelled":
                self.cancelled.setdefault(p["effect_id"], event)
            elif event.type == "budget.settled":
                self.settled.setdefault(p["effect_id"], event)
            elif event.type == "member.dead":
                self.dead[p["member"]].append(event)
            if event.type.startswith("contract.") and "contract_id" in p:
                self.contract_events[(p["goal_id"], p["contract_id"])].append(event)

    def of(self, event_type: str) -> list[Event]:
        return self.by_type.get(event_type, [])

    @property
    def leaf_level(self) -> int | None:
        started = self.of("run.started")
        scaling = ((started[0].payload.get("params") or {}).get("spec") or {}).get("scaling")
        return len(scaling["fanout"]) if scaling and "fanout" in scaling else None


def _violation(found: list[Violation], check: str, kind: str, seq: int | None, detail: str):
    found.append(Violation(check=check, kind=kind, seq=seq, detail=detail))


# -- 1. kills -----------------------------------------------------------------------------


def _kills(ix: _Index, found: list[Violation]) -> list[Kill]:
    kills: list[Kill] = []
    for event in ix.of("chaos.injected"):
        p = event.payload
        if p["fault"] not in KILL_FAULTS:
            continue
        target = p.get("target")
        detail = p.get("detail") or {}
        kill = Kill(
            fault=p["fault"],
            target=target,
            progress=p.get("progress"),
            seq=event.seq,
            ts_virtual=event.ts_virtual,
            remaining_work=detail.get("remaining_work"),
        )
        kills.append(kill)
        if target is None:
            continue  # skipped: no candidate was alive
        stop = next(
            (
                s
                for s in ix.of("actor.stopped")
                if s.seq > event.seq and s.payload["actor_id"] == target
            ),
            None,
        )
        if stop is None:
            _violation(found, "kills", "kill-not-stopped", event.seq, f"{target} was never stopped")
            continue
        kill.stopped_seq, kill.stopped_reason = stop.seq, stop.payload["reason"]
        kill.cancelled_effects = dict(
            Counter(
                c.payload["kind"]
                for c in ix.of("effect.cancelled")
                if event.seq <= c.seq <= stop.seq and _starter(ix, c) == target
            )
        )
        after = [e for e in ix.by_actor.get(target, []) if e.seq > stop.seq]
        kill.events_after_stop = len(after)
        kill.after_stop = [f"seq {e.seq} {e.type}" for e in after[:SHOWN]]
        if after:
            _violation(
                found,
                "kills",
                "zombie",
                after[0].seq,
                f"{target} authored {len(after)} event(s) after it stopped at seq {stop.seq}: "
                + ", ".join(kill.after_stop),
            )
        ghosts = [
            c for c in ix.of("effect.completed") if c.seq > stop.seq and _starter(ix, c) == target
        ]
        kill.completions_after_stop = len(ghosts)
        if ghosts:
            _violation(
                found,
                "kills",
                "ghost-effect",
                ghosts[0].seq,
                f"{len(ghosts)} call(s) of {target} completed after it stopped at seq {stop.seq}",
            )
    return kills


def _starter(ix: _Index, event: Event) -> str | None:
    started = ix.started.get(event.payload["effect_id"])
    return started.actor if started is not None else None


# -- 2. death verdicts --------------------------------------------------------------------


def _verdicts(ix: _Index, kills: list[Kill]) -> list[Verdict]:
    killed = {k.target: k for k in kills if k.target is not None and k.stopped_seq is not None}
    verdicts: list[Verdict] = []
    for event in ix.of("member.dead"):
        p = event.payload
        subject = p["member"]
        stop = ix.stops.get(subject)
        dead = stop is not None and stop.seq < event.seq
        kill = killed.get(subject)
        if kill is not None and kill.seq > event.seq:
            kill = None  # an earlier, false verdict: not about this kill
        verdicts.append(
            Verdict(
                seq=event.seq,
                ts_virtual=event.ts_virtual,
                member_epoch=event.member_epoch,
                subject=subject,
                incarnation=p["incarnation"],
                by=p["by"],
                missed=p["missed"],
                last_heard_ms=p["last_heard_ms"],
                truth="true" if dead else "false",
                stopped_seq=stop.seq if dead and stop else None,
                stop_reason=stop.payload["reason"] if dead and stop else None,
                kill_seq=kill.seq if kill else None,
                delay_ms=event.ts_virtual - kill.ts_virtual if kill else None,
                rejoins=[
                    Rejoin(
                        seq=j.seq,
                        ts_virtual=j.ts_virtual,
                        member=subject,
                        incarnation=j.payload["incarnation"],
                    )
                    for j in ix.of("member.joined")
                    if j.seq > event.seq and j.payload["member"] == subject
                ],
            )
        )
    return verdicts


# -- 3-5. the fold: succession, adoption and fencing --------------------------------------


@dataclass
class _Decision:
    """The members and tree views at one point of the log, as ``_reconcile`` reads them."""

    known: bool = False
    owner: str | None = None  # the goal's owner in the tree
    gone: bool = False  # the previous owner is dead in the members view
    owner_status: str | None = None  # the new owner's status in the members view
    owner_incarnation: int = 0
    done: bool = False
    root: bool = False
    heir: str | None = None
    pool: tuple[str, ...] = ()
    works: tuple[str, ...] = ()
    adopted: int = 0


@dataclass
class _Folded:
    tree: TreeView
    successions: list[Succession]
    adoptions: list[Adoption]
    fencing: Fencing


def _fold(ix: _Index, found: list[Violation]) -> _Folded:
    members, tree = MembersView(), TreeView()
    remaps = ix.of("ownership.remapped")
    by_cause: dict[int, list[Event]] = defaultdict(list)
    for remap in remaps:
        if remap.causation_id is not None and remap.causation_id < remap.seq:
            by_cause[remap.causation_id].append(remap)
    at_cause: dict[int, _Decision] = {}
    at_event: dict[int, _Decision] = {}
    fencing = Fencing()
    adoptions: list[Adoption] = []
    remap_seq: dict[tuple[int | None, str, str, str], int] = {}
    for event in ix.events:
        p = event.payload
        if event.type == "ownership.remapped":
            at_event[event.seq] = _decide(tree, members, p["previous"], p["key"], p["owner"])
            remap_seq[(event.causation_id, p["key"], p["previous"], p["owner"])] = event.seq
        elif event.type == "write.fenced":
            fenced = _fenced(event, members)
            fencing.fenced.append(fenced)
            if fenced.justified is False:
                _violation(
                    found,
                    "fencing",
                    "fenced-without-cause",
                    event.seq,
                    f"a write of {fenced.writer} was refused but its token was current",
                )
        elif event.type == "tree.adopted":
            adoptions.append(_adoption(event, tree, ix.leaf_level, remap_seq, found))
        if isinstance(p.get("fence"), dict) and event.type != "write.fenced":
            _owner_write(event, members, tree, fencing, found)
        try:
            members.apply(event)
            tree.apply(event)
        except (KeyError, TypeError, ValueError) as exc:
            _violation(found, "invariants", "malformed-event", event.seq, f"{event.type}: {exc!r}")
        for remap in by_cause.get(event.seq, ()):
            rp = remap.payload
            at_cause[remap.seq] = _decide(tree, members, rp["previous"], rp["key"], rp["owner"])
    successions = [_succession(ix, e, at_cause.get(e.seq), at_event[e.seq], found) for e in remaps]
    _split_brain(successions, found)
    return _Folded(tree, successions, adoptions, fencing)


def _decide(tree: TreeView, members: MembersView, previous: str, gid: str, owner: str):
    record = tree.goals.get(gid)
    if record is None:
        return _Decision()
    works, adopted = _expected_works(record, gid)
    seat = members.get(owner)
    return _Decision(
        known=True,
        owner=record.owner,
        gone=members.is_gone(previous),
        owner_status=seat.status if seat is not None else None,
        owner_incarnation=seat.incarnation if seat is not None else 0,
        done=record.done,
        root=record.parent is None,
        heir=heir(tree, gid, members),
        pool=tuple(candidates(record.owner, members)),
        works=tuple(works),
        adopted=adopted,
    )


def _expected_works(record: GoalRecord, gid: str) -> tuple[list[str], int]:
    """What the heir finds in a leaf goal: the unfinished contracts, and how many of the running
    ones already have their result in the log (``actors/orchestrator.py: _rebuild_leaf``)."""
    works: list[str] = []
    adopted = 0
    if record.plan is None or not record.contracts:
        return works, adopted
    for cid in record.children:
        found = record.contracts.get(cid)
        if found is None:
            continue
        state = found.status if found.status in ("verified", "failed", "running") else "pending"
        if state != "verified":
            works.append(f"{gid}/{cid}")
        if state == "running" and found.contract["attempt"] in found.results:
            adopted += 1
    return works, adopted


def _succession(
    ix: _Index, event: Event, cause: _Decision | None, now: _Decision, found: list[Violation]
) -> Succession:
    p = event.payload
    key, previous, owner = p["key"], p["previous"], p["owner"]
    basis = cause if cause is not None else now
    fence = p.get("fence") or {}
    verdict = next((d for d in reversed(ix.dead[previous]) if d.seq < event.seq), None)
    kind = "reclaim" if owner == previous else "takeover"
    succession = Succession(
        seq=event.seq,
        ts_virtual=event.ts_virtual,
        goal=key,
        root=basis.root,
        previous=previous,
        owner=owner,
        group=p.get("group"),
        kind=kind,
        works=p["works"],
        adopted_results=p["adopted_results"],
        fence_epoch=fence.get("epoch"),
        verdict_seq=verdict.seq if verdict is not None else None,
        verdict_epoch=verdict.member_epoch if verdict is not None else None,
        basis_seq=event.causation_id if cause is not None else None,
        pool=list(basis.pool),
        scores=[HrwScore(member=m, score=f"{score(key, m):016x}") for m in rank(key, basis.pool)],
        heir=basis.heir,
        expected_works=list(basis.works),
        expected_adopted=basis.adopted,
    )
    if cause is not None and now.heir != cause.heir:
        succession.skew = f"the heir would be {now.heir} on the log at the append point"
    issues: list[tuple[str, str]] = []  # (violation kind, what is wrong)
    if not basis.known:
        issues.append(("remap-precondition", f"{key} is not in the tree at the decision point"))
    else:
        if basis.owner != previous:
            issues.append(("remap-precondition", f"the tree's owner of {key} was {basis.owner}"))
        if basis.done:
            issues.append(("remap-precondition", f"{key} was already completed"))
        if basis.owner_status in (None, "dead"):
            issues.append(("remap-precondition", f"{owner} was not alive in the members view"))
        if kind == "takeover":
            issues += _takeover_issues(succession, basis)
        elif basis.owner_incarnation < 1 or verdict is None:
            issues.append(("remap-precondition", f"{owner} reclaimed {key} without a false death"))
    for issue_kind, text in issues:
        _violation(
            found, "succession", issue_kind, event.seq, f"{key} {previous} -> {owner}: {text}"
        )
    succession.problems = [text for _, text in issues]
    succession.ok = not issues
    return succession


def _takeover_issues(succession: Succession, basis: _Decision) -> list[tuple[str, str]]:
    issues: list[tuple[str, str]] = []
    if not basis.gone:
        issues.append(("remap-precondition", f"{succession.previous} was not dead in the log"))
    if basis.heir != succession.owner:
        issues.append(
            ("heir-mismatch", f"the HRW heir is {basis.heir}, the log records {succession.owner}")
        )
    if sorted(succession.works) != sorted(basis.works):
        issues.append(
            (
                "adopted-results-mismatch",
                f"it claims works {succession.works}; the log holds {list(basis.works)}",
            )
        )
    if succession.adopted_results != basis.adopted:
        issues.append(
            (
                "adopted-results-mismatch",
                f"it claims {succession.adopted_results} adopted result(s); "
                f"the log holds {basis.adopted}",
            )
        )
    epoch, verdict = succession.fence_epoch, succession.verdict_epoch
    if epoch is not None and verdict is not None and epoch < verdict:
        issues.append(
            ("remap-precondition", f"it acquired the goal at epoch {epoch}, before the verdict")
        )
    return issues


def _split_brain(successions: list[Succession], found: list[Violation]) -> None:
    """A goal has one holder at each point of the log, so a remap must start from that holder.

    Two takeovers of one tenure break that rule: the second one's ``previous`` no longer holds
    the goal. A member that held a goal twice (falsely dead, the goal back, really dead later)
    has two tenures, each with its own remap, and breaks nothing. ``successions`` is in log order.
    """
    holder: dict[str, str] = {}
    for s in successions:
        current = holder.setdefault(s.goal, s.previous)
        if current != s.previous:
            _violation(
                found,
                "succession",
                "split-brain",
                s.seq,
                f"{s.goal} was taken from {s.previous} by {s.owner} at seq {s.seq}, "
                f"but {current} held it by then",
            )
        holder[s.goal] = s.owner


def _chains(successions: list[Succession]) -> dict[str, list[str]]:
    chains: dict[str, list[str]] = {}
    for s in successions:
        if s.kind == "reclaim":
            continue
        chain = chains.setdefault(s.goal, [s.previous])
        if chain[-1] == s.previous:
            chain.append(s.owner)
    return chains


def _adoption(
    event: Event,
    tree: TreeView,
    leaf_level: int | None,
    remaps: dict[tuple[int | None, str, str, str], int],
    found: list[Violation],
) -> Adoption:
    p = event.payload
    record = tree.goals.get(p["goal_id"])
    expected: list[str] | None = None
    if record is not None and leaf_level is not None:
        if record.level == 0:
            expected = ROOT_DUTIES
        elif record.level < leaf_level:
            expected = INNER_DUTIES
        else:
            expected = []
    adoption = Adoption(
        seq=event.seq,
        ts_virtual=event.ts_virtual,
        dead=p["dead"],
        adopter=p["adopter"],
        goal=p["goal_id"],
        children=p["children"],
        duties=p["duties"],
        expected_duties=expected,
        remap_seq=remaps.get((event.causation_id, p["goal_id"], p["dead"], p["adopter"])),
    )
    issues: list[tuple[str, str]] = []  # (violation kind, what is wrong)
    if adoption.remap_seq is None:
        text = f"{p['adopter']} adopted {p['goal_id']} without an ownership.remapped for it"
        issues.append(("adoption-without-takeover", text))
    if p["adopter"] in p["children"]:
        issues.append(("adopter-is-child", f"{p['adopter']} adopted itself as a child"))
    if expected is not None and sorted(p["duties"]) != sorted(expected):
        text = f"{p['goal_id']} carries duties {p['duties']}, expected {expected}"
        issues.append(("duties-mismatch", text))
    for kind, text in issues:
        _violation(found, "adoption", kind, event.seq, text)
    adoption.problems = [text for _, text in issues]
    adoption.ok = not issues
    return adoption


def _owner_write(
    event: Event, members: MembersView, tree: TreeView, fencing: Fencing, found: list[Violation]
) -> None:
    try:
        token = FencingToken.model_validate(event.payload["fence"])
    except ValidationError:
        _violation(
            found, "fencing", "forged-token", event.seq, f"{event.type} has a malformed token"
        )
        return
    if token.member != event.actor:
        _violation(
            found,
            "fencing",
            "forged-token",
            event.seq,
            f"{event.type} by {event.actor} carries the token of {token.member}",
        )
    reason = members.stale(token)
    if reason is not None:
        _violation(
            found,
            "fencing",
            "unrefused-stale-write",
            event.seq,
            f"{event.type} by {event.actor} entered the log although {reason}",
        )
    if event.type == "ownership.remapped":
        return  # the heir becomes the owner with this very event (checked as a succession)
    owner = tree.owner_of(token.resource)
    if owner is None:
        fencing.owner_writes_unchecked += 1
        return
    fencing.owner_writes_checked += 1
    if owner != event.actor:
        _violation(
            found,
            "fencing",
            "stale-write",
            event.seq,
            f"{event.type} for {token.resource} was written by {event.actor}, "
            f"but its owner is {owner}",
        )


def _fenced(event: Event, members: MembersView) -> FencedWrite:
    p = event.payload
    resource = epoch = None
    justified: bool | None = None
    if isinstance(p.get("fence"), dict):
        try:
            token = FencingToken.model_validate(p["fence"])
        except ValidationError:
            pass
        else:
            resource, epoch = token.resource, token.epoch
            justified = members.stale(token) is not None
    return FencedWrite(
        seq=event.seq,
        ts_virtual=event.ts_virtual,
        refused=p["type"],
        writer=p["actor"],
        reason=p["reason"],
        member=p.get("member"),
        resource=resource,
        epoch=epoch,
        justified=justified,
    )


# -- 4. what happened to the results of dead owners --------------------------------------


def _orphans(ix: _Index, found: list[Violation]) -> list[OrphanResult]:
    orphans: list[OrphanResult] = []
    for event in ix.of("msg.sent"):
        p = event.payload
        stop = ix.stops.get(p["to"])
        if p["topic"] != "contract.result" or stop is None:
            continue
        body = p["body"]
        goal, cid, attempt = body["goal_id"], body["contract_id"], body["attempt"]
        later = [e for e in ix.contract_events[(goal, cid)] if e.seq > event.seq]
        consumed = _first(later, "contract.completed", attempt)
        if consumed is not None and consumed.actor == p["to"]:
            continue  # its owner consumed it before it died: an ordinary result
        verified = _first(later, "contract.verified", attempt)
        rejected = _first(later, "contract.rejected", attempt)
        failed = _first(later, "contract.failed", attempt)
        again = [
            e for e in later if e.type == "contract.dispatched" and e.payload["attempt"] >= attempt
        ]
        if any(e.payload["attempt"] == attempt for e in again):
            fate = "redispatched"
        elif verified is not None:
            fate = "adopted"
        elif consumed is not None and rejected is not None:
            fate = "retried"
        elif consumed is not None and failed is not None:
            fate = "failed"
        elif consumed is not None:
            fate = "unfinished"  # an heir consumed it, and its contract never ended
        elif again:
            fate = "redispatched"  # a newer attempt went out while the result sat in the log
        else:
            fate = "unconsumed"
        orphan = OrphanResult(
            seq=event.seq,
            ts_virtual=event.ts_virtual,
            sender=event.actor,
            to=p["to"],
            goal=goal,
            contract=cid,
            attempt=attempt,
            status=body["status"],
            owner_stopped_seq=stop.seq,
            sent_after_death=event.seq > stop.seq,
            fate=fate,
            consumer=consumed.actor if consumed is not None else None,
            consumed_seq=consumed.seq if consumed is not None else None,
            verified_seq=verified.seq if verified is not None else None,
            ok=fate in ("adopted", "retried", "failed"),
        )
        orphans.append(orphan)
        if not orphan.ok:
            how = {
                "redispatched": "its contract was dispatched again (paid twice)",
                "unfinished": "an heir consumed it, but the contract never ended",
                "unconsumed": "nobody consumed it",
            }[fate]
            _violation(
                found,
                "adoption",
                f"orphan-{fate}",
                event.seq,
                f"result of {goal}/{cid} (attempt {attempt}) sent to dead {p['to']}: {how}",
            )
    return orphans


def _first(events: Iterable[Event], event_type: str, attempt: int) -> Event | None:
    return next(
        (e for e in events if e.type == event_type and e.payload["attempt"] == attempt), None
    )


# -- 6. lost work -------------------------------------------------------------------------


def _lost_work(ix: _Index, tree: TreeView, found: list[Violation]) -> LostWork:
    verified: dict[str, Event] = {}
    failed: dict[str, Event] = {}
    for event in ix.of("contract.verified"):
        verified.setdefault(_work(event.payload), event)
    for event in ix.of("contract.failed"):
        failed.setdefault(_work(event.payload), event)
    dispatches = Counter(_work(e.payload) for e in ix.of("contract.dispatched"))
    contracts: list[ContractOutcome] = []
    for event in ix.of("contract.created"):
        contract = event.payload["contract"]
        work = event.payload.get("work") or f"{contract['goal_id']}/{contract['id']}"
        outcome = ContractOutcome(work=work, status="unfinished", dispatches=dispatches[work])
        if work in verified:
            outcome.status, outcome.seq = "verified", verified[work].seq
            outcome.verified_by = verified[work].actor
        elif work in failed:
            outcome.status, outcome.seq = "failed", failed[work].seq
            outcome.why = "; ".join(failed[work].payload["reasons"])[:300]
            _violation(found, "lost-work", "contract-failed", outcome.seq, f"{work}: {outcome.why}")
        else:
            outcome.why = _unfinished(ix, contract["goal_id"], contract["id"])
            _violation(found, "lost-work", "contract-unfinished", None, f"{work}: {outcome.why}")
        contracts.append(outcome)
    goals = _goals(ix, tree, found)
    return LostWork(contracts=contracts, goals=goals, task=_task(ix, found))


def _work(payload: dict[str, Any]) -> str:
    return payload.get("work") or f"{payload['goal_id']}/{payload['contract_id']}"


def _unfinished(ix: _Index, goal: str, cid: str) -> str:
    events = ix.contract_events.get((goal, cid), [])
    if not events:
        return "no contract event after its creation"
    last = events[-1]
    why = f"last event {last.type} at seq {last.seq} by {last.actor}"
    stop = ix.stops.get(last.actor)
    if stop is not None:
        why += f", which stopped at seq {stop.seq}"
    return why


def _goals(ix: _Index, tree: TreeView, found: list[Violation]) -> list[GoalOutcome]:
    completed: dict[str, Event] = {}
    for event in ix.of("goal.completed"):
        completed.setdefault(event.payload["goal_id"], event)
    goals: list[GoalOutcome] = []
    for gid in sorted(tree.goals):
        event = completed.get(gid)
        if event is None:
            goals.append(GoalOutcome(goal=gid, status="missing"))
            _violation(found, "lost-work", "goal-incomplete", None, f"{gid} never completed")
            continue
        status = event.payload["status"]
        goals.append(
            GoalOutcome(
                goal=gid,
                status=status,
                seq=event.seq,
                writer=event.actor,
                gaps=event.payload["gaps"],
            )
        )
        if status != "ok":
            gaps = "; ".join(event.payload["gaps"])
            _violation(found, "lost-work", "goal-not-ok", event.seq, f"{gid} is {status}: {gaps}")
    return goals


def _task(ix: _Index, found: list[Violation]) -> TaskOutcome:
    results = ix.of("task.result")
    task = TaskOutcome(results=len(results))
    if not results:
        _violation(found, "lost-work", "task-result", None, "the run wrote no task.result")
        return task
    last = results[-1]
    report = last.payload["report"]
    task.status, task.writer, task.seq = last.payload["status"], last.actor, last.seq
    task.placed, task.expected = report.get("placed"), report.get("expected")
    task.hard_violations, task.gaps = report.get("hard_violations"), report.get("gaps") or []
    if len(results) > 1:
        who = ", ".join(f"{e.actor} at seq {e.seq}" for e in results)
        _violation(found, "lost-work", "task-result", last.seq, f"{len(results)} results: {who}")
    if task.status != "ok":
        _violation(found, "lost-work", "task-result", last.seq, f"status is {task.status}")
    if task.placed is None or task.expected is None:
        _violation(found, "lost-work", "task-result", last.seq, "the report has no placed/expected")
    elif task.placed != task.expected:
        _violation(
            found,
            "lost-work",
            "task-result",
            last.seq,
            f"placed {task.placed} of {task.expected}",
        )
    if task.hard_violations != 0:
        _violation(
            found,
            "lost-work",
            "task-result",
            last.seq,
            f"{task.hard_violations} hard violation(s)",
        )
    return task


# -- 7. duplicate calls -------------------------------------------------------------------


@dataclass
class _Call:
    effect_id: str
    actor: str
    role: str
    tag: str | None
    seq: int
    request: str
    status: str | None = None  # the completion's status
    cost: float = 0.0
    cancelled_seq: int | None = None


def _calls(ix: _Index) -> list[_Call]:
    calls: list[_Call] = []
    for effect_id, started in ix.started.items():
        p = started.payload
        if p["kind"] != "llm":
            continue
        call = _Call(
            effect_id=effect_id,
            actor=started.actor,
            role=str(p["request"].get("role", "")),
            tag=p.get("tag"),
            seq=started.seq,
            request=digest(p["request"]),
        )
        done = ix.done.get(effect_id)
        if done:
            call.status = done[0].payload["status"]
            call.cost = float((done[0].payload.get("result") or {}).get("cost_usd") or 0.0)
        if effect_id in ix.cancelled:
            call.cancelled_seq = ix.cancelled[effect_id].seq
        calls.append(call)
    return sorted(calls, key=lambda call: call.seq)


def _duplicates(
    ix: _Index,
    calls: list[_Call],
    estimates: dict[str, float],
    cassette: Sequence[dict[str, Any]] | None,
    found: list[Violation],
) -> Duplicates:
    out = Duplicates(
        llm_started=len(calls),
        llm_paid=sum(1 for c in calls if c.status in PAID),
        llm_failed=sum(1 for c in calls if c.status is not None and c.status not in PAID),
    )
    paid: dict[str, list[_Call]] = defaultdict(list)
    for call in calls:
        if call.status in PAID:
            paid[call.request].append(call)
    for request, group in sorted(paid.items()):
        if len(group) > 1:
            refs = [
                CallRef(effect_id=c.effect_id, seq=c.seq, actor=c.actor, tag=c.tag, cost_usd=c.cost)
                for c in group
            ]
            out.groups.append(
                DuplicateCall(
                    request=request,
                    role=group[0].role,
                    calls=refs,
                    wasted_usd=sum(c.cost for c in group[1:]),
                )
            )
            _violation(
                found,
                "duplicates",
                "duplicate-call",
                group[1].seq,
                f"{len(group)} completed {group[0].role} calls with the same request: "
                + ", ".join(f"{c.effect_id} ({c.actor})" for c in group[:SHOWN]),
            )
    out.cancelled = _cancelled(ix, calls, paid, estimates, found)
    _reuse(ix, out, found)
    out.cassette = _cassette(ix, cassette, calls, found)
    return out


def _cancelled(
    ix: _Index,
    calls: list[_Call],
    paid: dict[str, list[_Call]],
    estimates: dict[str, float],
    found: list[Violation],
) -> list[CancelledCall]:
    cancelled: list[CancelledCall] = []
    # An agent call's tag is ``<contract idem key>:<step>``; a lost contract goes out again as a
    # new attempt, so its requests differ and only the contract shows the work was redone.
    attempts: dict[str, str] = {}
    sent: dict[str, list[Event]] = defaultdict(list)
    for dispatched in ix.of("contract.dispatched"):
        attempts.setdefault(dispatched.payload["idem_key"], _work(dispatched.payload))
        sent[_work(dispatched.payload)].append(dispatched)
    for call in calls:
        if call.cancelled_seq is None:
            continue
        settled = ix.settled.get(call.effect_id)
        again = [c.effect_id for c in paid.get(call.request, []) if c.seq > call.cancelled_seq]
        work = attempts.get((call.tag or "").partition(":")[0])
        cancelled.append(
            CancelledCall(
                effect_id=call.effect_id,
                actor=call.actor,
                role=call.role,
                tag=call.tag,
                started_seq=call.seq,
                cancelled_seq=call.cancelled_seq,
                cause=_cause(ix, ix.cancelled[call.effect_id]),
                worst_case_usd=float(settled.payload["reserved_usd"]) if settled else 0.0,
                estimated_usd=estimates.get(call.effect_id, 0.0),
                redone=again,
                work=work,
                work_dispatched_again=sum(
                    1 for e in sent.get(work or "", []) if e.seq > call.cancelled_seq
                ),
            )
        )
        if len(again) > 1:
            _violation(
                found,
                "duplicates",
                "cancelled-redone-twice",
                call.cancelled_seq,
                f"{call.effect_id} ({call.tag}) was cancelled and its request completed "
                f"{len(again)} times afterwards: {', '.join(again)}",
            )
    return cancelled


def _cause(ix: _Index, cancel: Event) -> str:
    """Why a call was cancelled: a chaos kill, the kill switch, or the actor's own stop."""
    if cancel.actor == "@kernel":
        return "halt"
    stop = next(
        (
            s
            for s in ix.of("actor.stopped")
            if s.causation_id == cancel.causation_id and s.seq > cancel.seq
        ),
        None,
    )
    if stop is None:
        return "cancel"
    return "kill" if stop.payload["reason"] == "chaos" else f"stop:{stop.payload['reason']}"


def _reuse(ix: _Index, out: Duplicates, found: list[Violation]) -> None:
    starts = ix.of("effect.started")
    keys = Counter(e.idem_key for e in starts)
    out.idem_key_reuse = sorted(k for k, n in keys.items() if n > 1)
    ids = Counter(e.payload["effect_id"] for e in starts)
    out.effect_id_reuse = sorted(i for i, n in ids.items() if n > 1)
    twice = sorted(i for i, done in ix.done.items() if len(done) > 1)
    for kind, what, reused in (
        ("idem-key-reuse", "effect.started idem_key reused", out.idem_key_reuse),
        ("effect-id-reuse", "effect id started more than once", out.effect_id_reuse),
        ("effect-completed-twice", "effect completed more than once", twice),
    ):
        if reused:
            _violation(found, "duplicates", kind, None, f"{what}: {', '.join(reused[:SHOWN])}")
    dispatched = Counter(e.payload["idem_key"] for e in ix.of("contract.dispatched"))
    out.contract_redispatched = sorted(k for k, n in dispatched.items() if n > 1)
    if out.contract_redispatched:
        _violation(
            found,
            "duplicates",
            "contract-redispatched",
            None,
            f"{len(out.contract_redispatched)} contract attempt(s) were dispatched more than once",
        )


def _cassette(
    ix: _Index, entries: Sequence[dict[str, Any]] | None, calls: list[_Call], found: list[Violation]
) -> CassetteReport:
    if entries is None:
        return CassetteReport()
    report = CassetteReport(checked=True, entries=len(entries))
    ids = Counter(entry.get("effect_id") for entry in entries)
    started = {c.effect_id for c in calls}
    report.duplicated = sorted(i for i, n in ids.items() if n > 1)
    report.orphans = sorted(i for i in ids if i not in started)
    report.missing = sorted(
        c.effect_id for c in calls if c.status is not None and c.effect_id not in ids
    )
    report.recorded_but_cancelled = sorted(
        c.effect_id for c in calls if c.status is None and c.effect_id in ids
    )
    run_ids = {s.run_id for s in ix.started.values()}
    report.foreign = sum(1 for entry in entries if entry.get("run_id") not in run_ids)
    for kind, what, bad in (
        ("cassette-duplicate", "entries appear more than once", report.duplicated),
        ("cassette-orphan", "entries belong to no effect of the log", report.orphans),
        ("cassette-missing", "completed calls have no entry", report.missing),
    ):
        if bad:
            _violation(
                found, "duplicates", kind, None, f"{len(bad)} {what}: {', '.join(bad[:SHOWN])}"
            )
    if report.foreign:
        _violation(
            found,
            "duplicates",
            "cassette-foreign",
            None,
            f"{report.foreign} entries are of another run",
        )
    return report


# -- 8. invariants ------------------------------------------------------------------------


def _invariants(
    audit: AuditReport | None, replay: ReplayReport | None, found: list[Violation]
) -> Invariants:
    out = Invariants()
    if audit is not None:
        out.chain_checked, out.chain_ok = True, audit.chain.ok
        out.head_file_ok, out.audit_ok, out.audit_problems = (
            audit.head_file_ok,
            audit.ok,
            list(audit.problems),
        )
        if not audit.chain.ok:
            _violation(
                found, "invariants", "chain-broken", audit.chain.first_bad_seq, audit.chain.reason
            )
        elif not audit.ok:
            _violation(found, "invariants", "audit-failed", None, "; ".join(audit.problems[:SHOWN]))
    if replay is not None:
        out.replay_checked, out.replay_ok, out.replay_detail = True, replay.ok, replay.detail
        if not replay.ok:
            _violation(
                found,
                "invariants",
                "replay-diverged",
                replay.first_divergence,
                replay.detail or "the replay does not match",
            )
    return out


# -- 9. costs -----------------------------------------------------------------------------


def _costs(
    ix: _Index, calls: list[_Call], estimates: dict[str, float], found: list[Violation]
) -> Costs:
    """Committed = settled + open reservations, the figure the ledger holds against the cap."""
    costs = Costs()
    start = ix.of("run.started")
    cap: float | None = start[0].payload.get("run_cap_usd") if start else None
    costs.run_cap_usd = cap
    open_: dict[str, tuple[float, Event]] = {}
    by_role: dict[str, float] = defaultdict(float)
    by_actor: dict[str, float] = defaultdict(float)
    breached = False
    for event in ix.events:
        p = event.payload
        if event.type in ("budget.cap_set", "budget.shock"):
            if p["level"] == "run":
                cap = float(p["usd"])
            continue
        if event.type == "budget.reserved":
            open_[p["effect_id"]] = (float(p["usd"]), event)
        elif event.type == "budget.settled":
            open_.pop(p["effect_id"], None)
            started = ix.started.get(p["effect_id"])
            role = str((started.payload["request"].get("role") if started else None) or "?")
            actual = float(p["actual_usd"])
            costs.settled_usd += actual
            by_role[role] += actual
            by_actor[started.actor if started else "?"] += actual
        else:
            continue
        committed = costs.settled_usd + sum(usd for usd, _ in open_.values())
        if committed > costs.peak_committed_usd:
            costs.peak_committed_usd, costs.peak_seq = committed, event.seq
        if cap is not None and committed > cap + CAP_TOLERANCE and not breached:
            breached = True
            _violation(
                found,
                "costs",
                "cap-exceeded",
                event.seq,
                f"committed ${committed:.6f} exceeds the run cap ${cap:.6f}",
            )
    costs.by_role = dict(sorted(by_role.items()))
    costs.by_actor = dict(sorted(by_actor.items()))
    for effect_id, (usd, event) in sorted(open_.items(), key=lambda item: item[1][1].seq):
        started = ix.started.get(effect_id)
        costs.open_reservations.append(
            OpenReservation(
                effect_id=effect_id,
                usd=usd,
                actor=started.actor if started else None,
                role=started.payload["request"].get("role") if started else None,
                seq=event.seq,
            )
        )
    costs.open_reserved_usd = sum(r.usd for r in costs.open_reservations)
    if costs.open_reservations and ix.of("run.completed"):
        _violation(
            found,
            "costs",
            "open-reservation",
            costs.open_reservations[0].seq,
            f"{len(costs.open_reservations)} reservation(s) never settled "
            f"(${costs.open_reserved_usd:.6f})",
        )
    for call in (c for c in calls if c.cancelled_seq is not None):
        settled = ix.settled.get(call.effect_id)
        costs.cancelled_llm_calls += 1
        costs.cancelled_worst_case_usd += float(settled.payload["reserved_usd"]) if settled else 0.0
        costs.cancelled_estimated_usd += estimates.get(call.effect_id, 0.0)
    return costs


# -- what the log cannot show -------------------------------------------------------------


def _limits(ix: _Index, report: TakeoverReport, estimated: bool = True) -> list[str]:
    limits = [
        "A kill is an in-process Stop (actor.stopped): the log cannot show an operating-system "
        "process dying, only that the actor produced nothing afterwards.",
        "Message deliveries are not logged, only sends. Whether an orphaned result was ever "
        "delivered to its dead owner is inferred from who consumed it afterwards.",
        "The heir is recomputed with this repository's coord.tree.heir on views folded from the "
        "log: it proves the log is consistent with that code, not that the code matches the spec.",
        "Costs are the log's: settled amounts and reservation worst cases. What a provider "
        "billed for a call cancelled in flight is estimated, not known.",
        "A call that completed with an error is counted as not billed (its cost is 0 in the "
        "log); a provider may still bill a request that timed out.",
        "The chain and the replay show that this code reproduces the recorded run from the "
        "recorded model outputs, not where those outputs came from.",
    ]
    if not estimated:
        limits.append("The estimated cost of cancelled calls could not be rebuilt from the log.")
    if not report.invariants.chain_checked:
        limits.append("The hash chain and the audit were not checked (no store was given).")
    if not report.invariants.replay_checked:
        limits.append("The run was not replayed (add --replay): the code was not re-executed.")
    if not report.duplicates.cassette.checked:
        limits.append("There is no cassette: the cassette entries were not checked.")
    if ix.leaf_level is None:
        limits.append("run.started has no fanout: the duties of adoptions were not checked.")
    unjustified = [f.seq for f in report.fencing.fenced if f.justified is None]
    if unjustified:
        limits.append(
            f"{len(unjustified)} write.fenced event(s) (verdicts or joins) carry no token: "
            "their refusal cannot be re-derived from the log."
        )
    return limits
