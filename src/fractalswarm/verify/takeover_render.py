"""Text and Markdown renderings of a takeover report (``verify/takeover.py``)."""

from fractalswarm.verify.takeover import Succession, TakeoverReport

SECTIONS = (
    "Kills",
    "Death verdicts",
    "Succession",
    "Adoption",
    "Fencing",
    "Lost work",
    "Duplicate calls",
    "Invariants",
    "Costs",
)


def _s(ms: int | None) -> str:
    return "-" if ms is None else f"{ms / 1000:.2f}s"


def _usd(value: float) -> str:
    return f"${value:.6f}"


def _cell(value: object) -> str:
    return str(value).replace("|", "/").replace("\n", " ")


def _verdict(report: TakeoverReport, check: str) -> str:
    count = sum(1 for v in report.violations if v.check == check)
    return "OK" if not count else f"{count} VIOLATION(S)"


def _checks(report: TakeoverReport) -> dict[str, str]:
    names = ("kills", "verdicts", "succession", "adoption", "fencing")
    names += ("lost-work", "duplicates", "invariants", "costs")
    return {title: _verdict(report, name) for title, name in zip(SECTIONS, names, strict=True)}


def _root_line(report: TakeoverReport) -> list[Succession]:
    return [s for s in report.successions if s.root and s.kind == "takeover"]


# -- terminal -----------------------------------------------------------------------------


def render_text(report: TakeoverReport) -> str:
    out = [f"takeover check of {report.run_id}: {report.events} events, head {report.head}"]
    out.append("")
    out.append(f"1 KILLS ({len(report.kills)})")
    for k in report.kills:
        stop = (
            f"stopped at seq {k.stopped_seq} ({k.stopped_reason})"
            if k.stopped_seq
            else "NOT STOPPED"
        )
        at = "-" if k.progress is None else f"{k.progress:.0%}"
        out.append(
            f"  {k.target or '(skipped)':<8} {k.fault} at {at} of the work, seq {k.seq}, "
            f"t={_s(k.ts_virtual)}; {stop}; events after stop: {k.events_after_stop}"
        )
    true = sum(1 for v in report.verdicts if v.truth == "true")
    false = len(report.verdicts) - true
    out.append(f"2 DEATH VERDICTS ({len(report.verdicts)}: {true} true, {false} false)")
    for v in report.verdicts:
        since = f", {_s(v.delay_ms)} after the kill" if v.delay_ms is not None else ""
        rejoined = f"; rejoined as incarnation {v.rejoins[-1].incarnation}" if v.rejoins else ""
        out.append(
            f"  {v.subject:<8} declared dead by {v.by} at seq {v.seq}, "
            f"t={_s(v.ts_virtual)}{since}: {v.truth}{rejoined}"
        )
    out.append(f"3 SUCCESSION ({len(report.successions)} remaps)")
    for goal, chain in report.chains.items():
        out.append(f"  {goal}: {' -> '.join(chain)}")
    for s in report.successions:
        mark = "ok" if s.ok else "MISMATCH " + "; ".join(s.problems)
        out.append(
            f"  seq {s.seq}: {s.goal} {s.previous} -> {s.owner} (recomputed heir {s.heir}, "
            f"pool {', '.join(s.pool) or '-'}): {mark}"
        )
    for s in _root_line(report):
        scores = ", ".join(f"{x.member} {x.score}" for x in s.scores)
        out.append(f"  ROOT {s.previous} died; heir {s.owner}; HRW scores {scores}")
    adopted = sum(a.adopted_results for a in report.successions)
    out.append(
        f"4 ADOPTION ({len(report.adoptions)} tree.adopted, {adopted} orphan results adopted)"
    )
    for a in report.adoptions:
        duties = ", ".join(a.duties) or "no duties"
        out.append(f"  {a.goal}: {a.dead} -> {a.adopter}, children {a.children or '[]'}, {duties}")
    for o in report.orphan_results:
        out.append(
            f"  result {o.goal}/{o.contract} of {o.sender} to dead {o.to} (seq {o.seq}): "
            f"{o.fate}{' by ' + o.consumer if o.consumer else ''}"
        )
    f = report.fencing
    out.append(
        f"5 FENCING ({len(f.fenced)} write.fenced; {f.owner_writes_checked} owner writes "
        f"checked against the owner, {f.owner_writes_unchecked} unchecked)"
    )
    for w in f.fenced:
        out.append(f"  seq {w.seq}: {w.refused} by {w.writer} refused: {w.reason}")
    lw = report.lost_work
    verified = sum(1 for c in lw.contracts if c.status == "verified")
    done = sum(1 for g in lw.goals if g.status == "ok")
    out.append(
        f"6 LOST WORK (contracts verified {verified}/{len(lw.contracts)}, "
        f"goals ok {done}/{len(lw.goals)})"
    )
    t = lw.task
    out.append(
        f"  task.result x{t.results}: {t.status}, placed {t.placed}/{t.expected}, "
        f"hard violations {t.hard_violations}, written by {t.writer}"
    )
    d = report.duplicates
    kill_cancelled = sum(1 for c in d.cancelled if c.cause == "kill")
    out.append(
        f"7 DUPLICATE CALLS ({d.llm_paid} paid llm calls, {len(d.groups)} duplicated; "
        f"{len(d.cancelled)} cancelled, {kill_cancelled} by a kill)"
    )
    for c in d.cancelled:
        again = f"; contract {c.work} dispatched again {c.work_dispatched_again}x" if c.work else ""
        out.append(
            f"  cancelled {c.effect_id} ({c.tag}) by {c.cause}: "
            f"same request redone {len(c.redone)}x{again}"
        )
    cas = d.cassette
    state = f"{cas.entries} entries" if cas.checked else "no cassette"
    out.append(
        f"  idem_key reused {len(d.idem_key_reuse)}, contract attempts dispatched twice "
        f"{len(d.contract_redispatched)}, cassette: {state}"
    )
    i = report.invariants
    chain = "not checked" if not i.chain_checked else ("ok" if i.chain_ok else "BROKEN")
    replay = "not run" if not i.replay_checked else ("MATCH" if i.replay_ok else "MISMATCH")
    out.append(f"8 INVARIANTS (hash chain {chain}, audit {i.audit_ok}, replay {replay})")
    c = report.costs
    out.append(
        f"9 COSTS (settled {_usd(c.settled_usd)}, peak committed {_usd(c.peak_committed_usd)}"
        f" of cap {c.run_cap_usd}, open reservations {len(c.open_reservations)}, cancelled "
        f"worst case {_usd(c.cancelled_worst_case_usd)})"
    )
    out.append("")
    for violation in report.violations:
        where = "" if violation.seq is None else f" (seq {violation.seq})"
        out.append(f"VIOLATION [{violation.check}/{violation.kind}]{where} {violation.detail}")
    out.append(
        "TAKEOVER OK: no violation"
        if report.ok
        else f"TAKEOVER FAILED: {len(report.violations)} violation(s)"
    )
    return "\n".join(out)


# -- Markdown -----------------------------------------------------------------------------


def _table(headers: list[str], rows: list[list[object]]) -> list[str]:
    if not rows:
        return ["_none_", ""]
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(_cell(c) for c in row) + " |" for row in rows]
    return [*lines, ""]


def render_markdown(report: TakeoverReport, command: str = "") -> str:
    out = [f"# Takeover evidence: {report.run_id}", ""]
    if command:
        out += [f"Command: `{command}`", ""]
    out += [f"{report.events} events, head `{report.head}`.", ""]
    result = "OK" if report.ok else f"FAILED ({len(report.violations)} violation(s))"
    out += [f"**Result: {result}**", ""]
    out += _table(["check", "result"], [[k, v] for k, v in _checks(report).items()])
    out += _violations_md(report)
    out += ["## 1. Kills", ""]
    out += _table(
        [
            "target",
            "fault",
            "progress",
            "seq",
            "t",
            "stopped (seq, reason)",
            "cancelled with it",
            "events after stop",
        ],
        [
            [
                k.target or "(skipped)",
                k.fault,
                "-" if k.progress is None else f"{k.progress:.1%}",
                k.seq,
                _s(k.ts_virtual),
                f"{k.stopped_seq}, {k.stopped_reason}" if k.stopped_seq else "NOT STOPPED",
                ", ".join(f"{n} {kind}" for kind, n in k.cancelled_effects.items()) or "-",
                k.events_after_stop,
            ]
            for k in report.kills
        ],
    )
    out += ["## 2. Death verdicts", ""]
    out += _table(
        ["subject", "declared by", "seq", "t", "after the kill", "verdict", "rejoined"],
        [
            [
                v.subject,
                v.by,
                v.seq,
                _s(v.ts_virtual),
                _s(v.delay_ms),
                v.truth,
                ", ".join(f"incarnation {r.incarnation} (seq {r.seq})" for r in v.rejoins) or "-",
            ]
            for v in report.verdicts
        ],
    )
    out += [
        "## 3. Succession",
        "",
        "Heirs recomputed with `coord.tree.heir` on views folded from the log.",
        "",
    ]
    out += _succession_md(report)
    out += ["## 4. Adoption", ""]
    out += _table(
        ["seq", "goal", "dead", "adopter", "children", "duties", "ok"],
        [
            [
                a.seq,
                a.goal,
                a.dead,
                a.adopter,
                ", ".join(a.children) or "-",
                ", ".join(a.duties) or "-",
                "ok" if a.ok else "; ".join(a.problems),
            ]
            for a in report.adoptions
        ],
    )
    out += ["Orphan results (agent results sent to an owner that was already dead):", ""]
    out += _table(
        ["seq", "contract", "from", "to (dead)", "after death", "fate", "consumer", "verified at"],
        [
            [
                o.seq,
                f"{o.goal}/{o.contract}#{o.attempt}",
                o.sender,
                o.to,
                o.sent_after_death,
                o.fate,
                o.consumer or "-",
                o.verified_seq or "-",
            ]
            for o in report.orphan_results
        ],
    )
    out += ["## 5. Fencing", ""]
    f = report.fencing
    out += [
        f"{f.owner_writes_checked} owner-scoped writes were checked against the goal's owner at "
        f"that point of the log; {f.owner_writes_unchecked} could not be.",
        "",
    ]
    out += _table(
        ["seq", "refused", "writer", "reason", "resource", "epoch", "justified"],
        [
            [w.seq, w.refused, w.writer, w.reason, w.resource, w.epoch, w.justified]
            for w in f.fenced
        ],
    )
    out += _lost_work_md(report)
    out += _duplicates_md(report)
    out += _invariants_costs_md(report)
    out += ["## What the log cannot show", ""]
    out += [f"- {limit}" for limit in report.limits] + [""]
    return "\n".join(out)


def _violations_md(report: TakeoverReport) -> list[str]:
    if report.ok:
        return ["No violation.", ""]
    rows = [[v.check, v.kind, v.seq or "-", v.detail] for v in report.violations]
    return ["## Violations", "", *_table(["check", "kind", "seq", "detail"], rows)]


def _succession_md(report: TakeoverReport) -> list[str]:
    out = [f"- `{goal}`: {' -> '.join(chain)}" for goal, chain in report.chains.items()]
    out += [
        "",
        *_table(
            [
                "seq",
                "goal",
                "previous",
                "owner",
                "recomputed heir",
                "pool",
                "works",
                "adopted results",
                "ok",
            ],
            [
                [
                    s.seq,
                    s.goal,
                    s.previous,
                    s.owner,
                    s.heir,
                    ", ".join(s.pool),
                    len(s.works),
                    s.adopted_results,
                    "ok" if s.ok else "; ".join(s.problems),
                ]
                for s in report.successions
            ],
        ),
    ]
    for s in _root_line(report):
        out += [
            f"**Root, seq {s.seq}:** `{s.previous}` died (verdict at seq {s.verdict_seq}); "
            f"the heir is `{s.owner}` (recomputed `{s.heir}`).",
            "",
        ]
        out += _table(
            ["rank", "candidate", "HRW score (goal, member)"],
            [[n, x.member, x.score] for n, x in enumerate(s.scores, 1)],
        )
    skewed = [s for s in report.successions if s.skew]
    out += [f"- seq {s.seq} {s.goal}: {s.skew}" for s in skewed] + ([""] if skewed else [])
    return out


def _lost_work_md(report: TakeoverReport) -> list[str]:
    lw, t = report.lost_work, report.lost_work.task
    verified = sum(1 for c in lw.contracts if c.status == "verified")
    out = ["## 6. Lost work", ""]
    out += [f"Contracts verified: {verified} of {len(lw.contracts)}.", ""]
    bad = [[c.work, c.status, c.dispatches, c.why] for c in lw.contracts if c.status != "verified"]
    out += _table(["contract", "status", "dispatches", "why"], bad) if bad else []
    out += ["Goals:", ""]
    out += _table(
        ["goal", "status", "seq", "written by", "gaps"],
        [
            [g.goal, g.status, g.seq or "-", g.writer or "-", "; ".join(g.gaps) or "-"]
            for g in lw.goals
        ],
    )
    out += [
        f"`task.result`: {t.results} written by {t.writer}; status **{t.status}**, "
        f"placed **{t.placed}** of expected **{t.expected}**, hard violations "
        f"**{t.hard_violations}**, gaps {t.gaps or 'none'}.",
        "",
    ]
    return out


def _duplicates_md(report: TakeoverReport) -> list[str]:
    d = report.duplicates
    out = ["## 7. Duplicate calls", ""]
    out += [
        f"{d.llm_started} llm calls started; {d.llm_paid} completed and billed, {d.llm_failed} "
        f"failed (not billed). Completed calls sharing a request body: "
        f"**{len(d.groups)}** group(s).",
        "",
    ]
    out += (
        _table(
            ["request", "role", "calls", "wasted"],
            [
                [
                    g.request,
                    g.role,
                    ", ".join(f"{c.effect_id} ({c.actor})" for c in g.calls),
                    _usd(g.wasted_usd),
                ]
                for g in d.groups
            ],
        )
        if d.groups
        else []
    )
    out += ["Calls cancelled in flight:", ""]
    out += _table(
        ["effect", "tag", "by", "cause", "worst case", "estimated billed", "redone", "contract"],
        [
            [
                c.effect_id,
                c.tag,
                c.actor,
                c.cause,
                _usd(c.worst_case_usd),
                _usd(c.estimated_usd),
                f"{len(c.redone)}x same request",
                f"{c.work}: dispatched again {c.work_dispatched_again}x" if c.work else "-",
            ]
            for c in d.cancelled
        ],
    )
    cas = d.cassette
    out += [
        f"- `idem_key` reused among `effect.started`: {len(d.idem_key_reuse)}; effect ids "
        f"started twice: {len(d.effect_id_reuse)}; contract attempts dispatched twice: "
        f"{len(d.contract_redispatched)}.",
        (
            f"- Cassette: {cas.entries} entries; duplicated {len(cas.duplicated)}, without an "
            f"effect {len(cas.orphans)}, completed calls without an entry {len(cas.missing)}, "
            f"recorded but cancelled {len(cas.recorded_but_cancelled)}, of another run "
            f"{cas.foreign}."
            if cas.checked
            else "- Cassette: not checked (the run has none)."
        ),
        "",
    ]
    return out


def _invariants_costs_md(report: TakeoverReport) -> list[str]:
    i, c = report.invariants, report.costs
    chain = "not checked" if not i.chain_checked else ("verified" if i.chain_ok else "BROKEN")
    replay = "not run" if not i.replay_checked else ("MATCH" if i.replay_ok else "MISMATCH")
    out = ["## 8. Invariants", ""]
    out += [
        f"- Hash chain: {chain}.",
        f"- Audit: {i.audit_ok} {i.audit_problems or ''}".rstrip(),
        f"- Replay: {replay}.",
        "",
    ]
    out += ["## 9. Costs", ""]
    out += [
        f"Settled {_usd(c.settled_usd)}; peak committed (settled + open reservations) "
        f"{_usd(c.peak_committed_usd)} at seq {c.peak_seq}, run cap {c.run_cap_usd}; "
        f"open reservations at the end: {len(c.open_reservations)} "
        f"({_usd(c.open_reserved_usd)}); cancelled llm calls: {c.cancelled_llm_calls}, worst "
        f"case {_usd(c.cancelled_worst_case_usd)}, estimated billed "
        f"{_usd(c.cancelled_estimated_usd)}.",
        "",
    ]
    out += _table(["role", "settled"], [[k, _usd(v)] for k, v in c.by_role.items()])
    out += _table(["actor", "settled"], [[k, _usd(v)] for k, v in c.by_actor.items()])
    return out
