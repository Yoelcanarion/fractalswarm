"""Recovery evidence: what the coordinator outages of a recorded run cost, and what a supervisor
that keeps its workers must hold to (arena spec §B, backend-design §2).

Read-only and pure: every figure is recomputed from the event log. ``fractalswarm recovery RUN``
prints the per-outage table of ``bench/recovery.py`` (a crash or a partition per row, the same
for a swarm log and a supervisor log), what each supervisor restart found and did, and checks
five rules of the supervisors (``central``, ``durable-max``, ``durable``):

1. ``restarted``: every ``baseline.crashed`` has its ``baseline.restarted`` after it.
2. ``quiet``: from its crash to its restart the coordinator authors nothing but timers. The
   events of the crash's own step (its cancellations and the workers it stops) and the
   respawn of the workers that crash stopped (the process-tree ``central``) are not its doing
   while down. The 1 s tick and the restart timer are the timers.
3. ``consumed``: every ``contract.result`` message logged while it was down, for an attempt
   still open, is consumed after the restart (a ``contract.completed`` of that attempt) and
   named in ``supervisor.adopted.results`` (``durable-max`` and ``durable``).
4. ``own_calls``: ``durable-max`` cancels none of its own calls (plan, judge, scan); under
   ``durable`` the own calls cancelled at a crash are exactly the ones in flight, and the
   ones ``baseline.crashed.lost`` names.
5. ``no_repeat``: no contract attempt is dispatched twice and no call is paid twice; the rules
   are ``verify/takeover.py``'s (``duplicates_of``), which a swarm log is held to as well.

A log with no ``baseline.crashed`` is not a supervisor log: its kills are checked by
``fractalswarm takeover``, and only the table and ``no_repeat`` are read for it.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, computed_field

from fractalswarm.baselines.durable import DURABLE_MODES, OWN_TAG_PREFIXES
from fractalswarm.bench.recovery import OutageRow, RecoveryMetrics
from fractalswarm.bench.recovery import analyze as recovery_metrics
from fractalswarm.bench.scoring import load_events
from fractalswarm.kernel.events import Event
from fractalswarm.verify.takeover import duplicates_of
from fractalswarm.verify.takeover_models import Violation

ORCHESTRATED = ("central", "single", "pipeline", *DURABLE_MODES)
SHOWN = 5  # examples listed in a violation
LAST = 1 << 62

CHECKS = (
    ("restarted", "every crash has its restart"),
    ("quiet", "the coordinator authors only timers while it is down"),
    ("consumed", "results logged while it was down are consumed after the restart"),
    ("own_calls", "its own calls in flight: kept by durable-max, lost by durable"),
    ("no_repeat", "no attempt is dispatched twice and no call is paid twice"),
)


class Restart(BaseModel):
    """One supervisor crash and the restart that followed it."""

    crash: int
    coordinator: str
    crashed_seq: int
    restarted_seq: int | None
    down_s: float | None  # the crash to its restart
    announced_s: float  # the delay baseline.crashed announced
    lost: list[str]  # own-call tags baseline.crashed names as cancelled
    redo: list[str]  # the work baseline.restarted says is redone
    adopted: dict[str, int]  # supervisor.adopted: results, verdicts, plans, bookings, waiting
    results_logged: int  # contract.result messages logged while it was down
    results_consumed: int
    own_in_flight: int  # own calls in flight at the crash
    own_cancelled: int
    workers_stopped: int  # actor.stopped(crash) in the crash's own step


class Check(BaseModel):
    name: str
    title: str
    applies: bool
    detail: str
    violations: list[Violation] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def ok(self) -> bool:
        return not self.violations


class RecoveryReport(BaseModel):
    run_id: str
    events: int
    system: str  # swarm | central | durable-max | durable | single | pipeline | langgraph | ...
    supervised: bool
    metrics: RecoveryMetrics
    restarts: list[Restart] = []
    checks: list[Check] = []
    ok: bool = True

    @property
    def violations(self) -> list[Violation]:
        return [v for check in self.checks for v in check.violations]


# -- entry points ----------------------------------------------------------------------------


def check_run(run: Path | str) -> RecoveryReport:
    """Load a run directory (or an events file) and analyze it."""
    from fractalswarm.runs import RunPaths

    path = Path(run)
    paths = RunPaths(path if path.is_dir() else path.parent)
    with paths.open_log() as log:
        events = load_events(log)
    return analyze(events)


def analyze(events: Iterable[Event]) -> RecoveryReport:
    log = sorted(events, key=lambda event: event.seq)
    system = _system(log)
    outages = _outages(log)
    report = RecoveryReport(
        run_id=log[0].run_id if log else "",
        events=len(log),
        system=system,
        supervised=bool(outages),
        metrics=recovery_metrics(log),
    )
    report.restarts = [_restart(log, outage) for outage in outages]
    report.checks = [
        _restarted(outages),
        _quiet(log, report, outages),
        _consumed(log, report, outages),
        _own_calls(log, report, outages),
        _no_repeat(log),
    ]
    report.ok = all(check.ok for check in report.checks)
    return report


def _system(log: list[Event]) -> str:
    started = next((e for e in log if e.type == "run.started"), None)
    scenario = str(started.payload.get("scenario", "")) if started else ""
    return scenario.rpartition(":")[2].lower().replace("_", "-") or "unknown"


# -- the outages of a supervisor ------------------------------------------------------------


@dataclass
class _Outage:
    crashed: Event
    restarted: Event | None
    adopted: Event | None

    @property
    def coordinator(self) -> str:
        return self.crashed.payload["coordinator"]

    @property
    def number(self) -> int:
        return self.crashed.payload["crash"]

    @property
    def end(self) -> int:
        return LAST if self.restarted is None else self.restarted.seq

    def window(self, log: list[Event]) -> list[Event]:
        """Everything logged after the crash and before the restart, the crash's own step
        included."""
        return [e for e in log if self.crashed.seq < e.seq < self.end]

    def step(self, log: list[Event]) -> list[Event]:
        """The events the crash handler appended: they share the event that made it crash."""
        cause = self.crashed.causation_id
        if cause is None:
            return []
        return [e for e in log if e.seq > self.crashed.seq and e.causation_id == cause]


def _outages(log: list[Event]) -> list[_Outage]:
    def keyed(event_type: str) -> dict[tuple[str, int], Event]:
        return {
            (e.payload["coordinator"], e.payload["crash"]): e for e in log if e.type == event_type
        }

    restarts, adoptions = keyed("baseline.restarted"), keyed("supervisor.adopted")
    return [
        _Outage(
            crashed=crashed,
            restarted=_after(restarts.get(key), crashed),
            adopted=_after(adoptions.get(key), crashed),
        )
        for crashed in log
        if crashed.type == "baseline.crashed"
        for key in [(crashed.payload["coordinator"], crashed.payload["crash"])]
    ]


def _after(event: Event | None, crashed: Event) -> Event | None:
    return event if event is not None and event.seq > crashed.seq else None


def _tag(event: Event) -> str:
    return event.payload.get("tag") or ""


def _own(event: Event) -> bool:
    return _tag(event).startswith(OWN_TAG_PREFIXES)


def _in_flight_own(log: list[Event], outage: _Outage) -> set[str]:
    """The tags of the coordinator's own calls started and not yet closed at the crash."""
    open_calls: dict[str, str] = {}
    for e in log:
        if e.seq >= outage.crashed.seq:
            break
        if e.type == "effect.started" and e.actor == outage.coordinator and _own(e):
            if e.payload["kind"] in ("llm", "firewall"):
                open_calls[e.payload["effect_id"]] = _tag(e)
        elif e.type in ("effect.completed", "effect.cancelled"):
            open_calls.pop(e.payload["effect_id"], None)
    return set(open_calls.values())


def _own_cancelled(events: Iterable[Event], coordinator: str) -> list[Event]:
    return [
        e
        for e in events
        if e.type == "effect.cancelled"
        and e.actor == coordinator
        and e.payload["kind"] != "timer"
        and _own(e)
    ]


def _results(log: list[Event], outage: _Outage) -> list[Event]:
    """The agents' results logged while the coordinator was down."""
    return [
        e
        for e in outage.window(log)
        if e.type == "msg.sent"
        and e.payload["topic"] == "contract.result"
        and e.payload["to"] == outage.coordinator
    ]


def _attempt(event: Event) -> tuple[str, str, int]:
    body = event.payload["body"] if event.type == "msg.sent" else event.payload
    return body["goal_id"], body["contract_id"], body["attempt"]


def _open_results(log: list[Event], outage: _Outage) -> list[Event]:
    """The results of attempts nothing had closed when they were logged: a result for an attempt
    already completed or rejected is stale and is rightly not consumed."""
    closed: set[tuple[str, str, int]] = set()
    found = {id(e) for e in _results(log, outage)}
    opened: list[Event] = []
    for e in log:
        if e.type in ("contract.completed", "contract.rejected"):
            closed.add(_attempt(e))
        elif id(e) in found and _attempt(e) not in closed:
            opened.append(e)
    return opened


def _work(key: tuple[str, str, int]) -> str:
    return f"{key[0]}/{key[1]}"


def _restart(log: list[Event], outage: _Outage) -> Restart:
    p = outage.crashed.payload
    adopted = outage.adopted.payload if outage.adopted else {}
    results = _open_results(log, outage)
    after = [e for e in log if outage.restarted and e.seq > outage.restarted.seq]
    completed = {_attempt(e) for e in after if e.type == "contract.completed"}
    return Restart(
        crash=outage.number,
        coordinator=outage.coordinator,
        crashed_seq=outage.crashed.seq,
        restarted_seq=outage.restarted.seq if outage.restarted else None,
        down_s=(
            (outage.restarted.ts_virtual - outage.crashed.ts_virtual) / 1000
            if outage.restarted
            else None
        ),
        announced_s=p.get("restart_in_ms", 0) / 1000,
        lost=list(p.get("lost", [])),
        redo=list(outage.restarted.payload.get("redo", [])) if outage.restarted else [],
        adopted={
            key: len(adopted.get(key, []))
            for key in ("results", "verdicts", "plans", "bookings", "waiting")
        },
        results_logged=len(results),
        results_consumed=sum(_attempt(e) in completed for e in results),
        own_in_flight=len(_in_flight_own(log, outage)),
        own_cancelled=len(_own_cancelled(outage.window(log), outage.coordinator)),
        workers_stopped=sum(
            e.type == "actor.stopped" and e.payload["reason"] == "crash" for e in outage.step(log)
        ),
    )


# -- the checks ------------------------------------------------------------------------------


def _violation(check: str, kind: str, seq: int | None, detail: str) -> Violation:
    return Violation(check=check, kind=kind, seq=seq, detail=detail)


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _skipped(name: str, why: str) -> Check:
    return Check(name=name, title=dict(CHECKS)[name], applies=False, detail=why)


def _restarted(outages: list[_Outage]) -> Check:
    if not outages:
        return _skipped("restarted", "no supervisor crash in the log")
    found = [
        _violation(
            "restarted",
            "no-restart",
            o.crashed.seq,
            f"{o.coordinator} crashed (crash {o.number}) and the log never shows it back",
        )
        for o in outages
        if o.restarted is None
    ]
    detail = f"{_plural(len(outages), 'crash', 'crashes')}, {len(outages) - len(found)} restarted"
    return Check(
        name="restarted",
        title=dict(CHECKS)["restarted"],
        applies=True,
        detail=detail,
        violations=found,
    )


def _quiet(log: list[Event], report: RecoveryReport, outages: list[_Outage]) -> Check:
    name = "quiet"
    if not outages:
        return _skipped(name, "no supervisor crash in the log")
    if report.system not in ORCHESTRATED:
        return _skipped(name, f"a {report.system} log has no timer-driven coordinator")
    found: list[Violation] = []
    seen = 0
    for outage in outages:
        stopped = {
            e.payload["actor_id"]
            for e in outage.step(log)
            if e.type == "actor.stopped" and e.payload["reason"] == "crash"
        }
        step = {e.seq for e in outage.step(log)}
        for e in outage.window(log):
            if e.actor != outage.coordinator or e.seq in step:
                continue
            seen += 1
            timer = e.type == "effect.started" and e.payload["kind"] == "timer"
            respawn = e.type == "actor.spawned" and e.payload["actor_id"] in stopped
            if not (timer or respawn):
                found.append(
                    _violation(
                        name,
                        "authored-while-down",
                        e.seq,
                        f"{outage.coordinator} authored {e.type} while down "
                        f"(crash {outage.number})",
                    )
                )
    detail = (
        f"{_plural(seen, 'event')} authored by the coordinator "
        f"during {_plural(len(outages), 'outage')}"
    )
    return Check(name=name, title=dict(CHECKS)[name], applies=True, detail=detail, violations=found)


def _consumed(log: list[Event], report: RecoveryReport, outages: list[_Outage]) -> Check:
    name = "consumed"
    if not outages:
        return _skipped(name, "no supervisor crash in the log")
    if report.system not in DURABLE_MODES:
        return _skipped(name, f"a {report.system} crash stops its workers: nothing is logged")
    found: list[Violation] = []
    logged = consumed = 0
    for outage, restart in zip(outages, report.restarts, strict=True):
        if outage.restarted is None:
            continue  # reported by `restarted`
        results = _open_results(log, outage)
        logged += len(results)
        consumed += restart.results_consumed
        completed = {
            _attempt(e)
            for e in log
            if e.type == "contract.completed" and e.seq > outage.restarted.seq
        }
        for e in results:
            if _attempt(e) not in completed:
                found.append(
                    _violation(
                        name,
                        "result-not-consumed",
                        e.seq,
                        f"the result of {_work(_attempt(e))} (attempt {_attempt(e)[2]}) logged "
                        f"while {outage.coordinator} was down was not consumed after the restart",
                    )
                )
        due = {_work(_attempt(e)) for e in results}
        named = set(outage.adopted.payload["results"]) if outage.adopted else set()
        if due != named:
            found.append(
                _violation(
                    name,
                    "adoption-mismatch",
                    outage.adopted.seq if outage.adopted else outage.restarted.seq,
                    f"crash {outage.number}: supervisor.adopted names {sorted(named)[:SHOWN]} "
                    f"but the log holds the results of {sorted(due)[:SHOWN]}",
                )
            )
    detail = f"{_plural(logged, 'result')} logged while down, {consumed} consumed after the restart"
    return Check(name=name, title=dict(CHECKS)[name], applies=True, detail=detail, violations=found)


def _own_calls(log: list[Event], report: RecoveryReport, outages: list[_Outage]) -> Check:
    name = "own_calls"
    if report.system not in DURABLE_MODES:
        return _skipped(name, f"the rule is the durable modes': this is a {report.system} log")
    if not outages:
        return _skipped(name, "no supervisor crash in the log")
    coordinator = outages[0].coordinator
    found: list[Violation] = []
    if report.system == "durable-max":
        cancelled = _own_cancelled(log, coordinator)
        found = [
            _violation(
                name,
                "own-call-cancelled",
                e.seq,
                f"durable-max lost its own call {_tag(e)} (a crash must cancel none)",
            )
            for e in cancelled
        ]
        detail = f"{_plural(len(cancelled), 'own call')} cancelled in the whole run"
        return Check(
            name=name, title=dict(CHECKS)[name], applies=True, detail=detail, violations=found
        )
    flying = lost = 0
    for outage in outages:
        cancelled = {_tag(e) for e in _own_cancelled(outage.window(log), outage.coordinator)}
        in_flight = _in_flight_own(log, outage)
        named = set(outage.crashed.payload["lost"])
        # A call whose completion was logged just before the crash but not yet handled is in
        # ``lost`` (the state still waits for it) though there was nothing left to cancel.
        done = _done_before(log, outage)
        flying += len(in_flight)
        lost += len(cancelled)
        if cancelled != in_flight or cancelled - named or named - cancelled - done:
            found.append(
                _violation(
                    name,
                    "own-calls-mismatch",
                    outage.crashed.seq,
                    f"crash {outage.number}: in flight {sorted(in_flight)[:SHOWN]}, cancelled "
                    f"{sorted(cancelled)[:SHOWN]}, named lost {sorted(named)[:SHOWN]}",
                )
            )
    detail = (
        f"{_plural(flying, 'own call')} in flight at "
        f"{_plural(len(outages), 'crash', 'crashes')}, {lost} cancelled"
    )
    return Check(name=name, title=dict(CHECKS)[name], applies=True, detail=detail, violations=found)


def _done_before(log: list[Event], outage: _Outage) -> set[str]:
    return {
        _tag(e)
        for e in log
        if e.seq < outage.crashed.seq
        and e.type == "effect.completed"
        and e.payload["kind"] in ("llm", "firewall")
        and _own(e)
    }


def _no_repeat(log: list[Event]) -> Check:
    name = "no_repeat"
    if not log:
        return _skipped(name, "the log is empty")
    duplicates, found = duplicates_of(log)
    dispatched = sum(e.type == "contract.dispatched" for e in log)
    detail = (
        f"{_plural(dispatched, 'attempt')} dispatched, {_plural(duplicates.llm_paid, 'call')} paid"
    )
    return Check(
        name=name,
        title=dict(CHECKS)[name],
        applies=True,
        detail=detail,
        violations=[v.model_copy(update={"check": name}) for v in found],
    )


# -- text ------------------------------------------------------------------------------------


OUTAGE_HEADER = (
    "OUTAGES (virtual seconds; ttr_own: the crash to the heir or the restart; drain: to the",
    "release of the work it held up; blast: the share of sessions / agents it held up)",
    "   #  kind       who     lvl      at    back  ttr_own  drain     cdt     blast s/a %"
    "    idle own/ses/wide   kept/risk",
)


def _outage_line(row: OutageRow) -> str:
    when = f"{row.onset_s:>7.1f} {row.end_s:>7.1f} {row.ttr_own_s:>8.2f} {row.ttr_drain_s:>6.2f}"
    blast = f"{row.blast_sessions_pct:>5.1f}/{row.blast_agents_pct:<5.1f}"
    idle = f"{row.idle_agent_own_s:>6.1f}/{row.idle_agent_s:>5.1f}/{row.idle_agent_wide_s:<6.1f}"
    kept = f"{row.preserved_calls:>4}/{row.at_risk_calls:<4}"
    state = "" if row.recovered else "  NOT RECOVERED"
    who = f"{row.number:>2}  {row.kind:<9}  {row.coordinator:<6} {row.level:>3}"
    return f"  {who} {when} {row.cdt_s:>7.1f}  {blast}  {idle}  {kept}{state}"


def render_text(report: RecoveryReport) -> str:
    m = report.metrics
    out = [
        f"recovery check of {report.run_id}: {report.events} events, system {report.system}, "
        f"{m.crashes} crash(es), {m.partitions} partition(s)"
    ]
    if m.outages:
        out += ["", *OUTAGE_HEADER, *(_outage_line(row) for row in m.outages)]
        preserved = "-" if m.preserved_pct is None else f"{m.preserved_pct:.1f}%"
        idle = f"{m.idle_agent_own_s:.1f}/{m.idle_agent_s:.1f}/{m.idle_agent_wide_s:.1f}"
        out.append(
            f"  totals: cdt {m.cdt_s:.1f} s, blocked {m.blocked_total_s:.1f} s, idle {idle} "
            f"agent-s, exposure {m.exposure_peak_pct:.1f}%, preserved {preserved}, duplicated "
            f"{m.dup_calls} call(s) ${m.dup_usd:.4f}, unnecessary reassignments "
            f"{m.unnecessary_reassignments}"
        )
    if report.restarts:
        out += ["", "RESTARTS"]
        for r in report.restarts:
            back = "never" if r.down_s is None else f"{r.down_s:.2f} s"
            kept = ", ".join(f"{n} {k}" for k, n in r.adopted.items() if n)
            out.append(
                f"  crash {r.crash} ({r.coordinator}): back after {back} (announced "
                f"{r.announced_s:.2f} s); {r.own_in_flight} own call(s) in flight, "
                f"{r.own_cancelled} cancelled; {r.workers_stopped} worker(s) stopped; "
                f"{r.results_consumed}/{r.results_logged} result(s) of the outage consumed; "
                f"redo {len(r.redo)}; adopted: {kept or 'nothing'}"
            )
    out += ["", "CHECKS"]
    for check in report.checks:
        state = "n/a" if not check.applies else ("OK" if check.ok else "VIOLATION")
        out.append(f"  {check.name:<10} {state:<9} {check.title}: {check.detail}")
        out += [
            f"             seq {v.seq if v.seq is not None else '-'}: {v.detail}"
            for v in check.violations[:SHOWN]
        ]
        if len(check.violations) > SHOWN:
            out.append(f"             ... {len(check.violations) - SHOWN} more")
    out.append("")
    out.append("RECOVERY OK" if report.ok else "RECOVERY CHECK FAILED")
    return "\n".join(out)
