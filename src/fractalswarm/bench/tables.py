"""The tables of ``bench/REPORT.md``, laid out from the committed results (read-only).

``fractalswarm bench tables`` prints them. Every number comes from ``honesty.json`` (``bench
verdicts --prereg``) or from the rows of the rivals gate (``rivals-gate/results.json``, ``bench
run``); this module only lays them out. ``tests/unit/test_report_tables.py`` checks that each one is
in the report word for word, so the report cannot drift from the files.
"""

import json
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from statistics import mean
from typing import Any

from fractalswarm.bench.harness import read_results
from fractalswarm.bench.profiles import jittered_plan
from fractalswarm.bench.verdicts import RIVALS, RULES, evaluate, judge, parse_knobs
from fractalswarm.comms.chaos import build_plan

Row = dict[str, Any]

HONESTY = "honesty.json"
GATE_ROWS = "rivals-gate/results.json"
# The exploratory crash-time jitter sweep: outside ``sweeps/`` and ``honesty.json`` on purpose (it
# is not preregistered), so its tables are laid out from its own rows, and only when it was run.
JITTER_AXIS = "crash_jitter_pct"
JITTER_ROWS = "exploratory/crash_jitter_pct/results.json"
TASKS = {"t1_extraction": "T1", "t2_conference": "T2"}
T2_FIRST = ("t2_conference", "t1_extraction")  # the task the gate decides on comes first
FLOWS = ("swarm", *RIVALS)
NAMES = {"central": "central (in-process supervisor)"}
PROFILES = ("C1", "C2", "C3")
# The row labels of the hypothesis tables; the ids and their order are ``verdicts.HYPOTHESES``.
HYPOTHESIS_ROWS = (
    ("H1", "Preserved work"),
    ("H2", "Extra cost (%)"),
    ("H3", "Time to recover (s)"),
    ("H4a", "Dependency time (s)"),
    ("H4b", "Blast radius (% sessions)"),
    ("H4c", "Idle agent-seconds"),
    ("H5", "Unnecessary reassignments"),
    ("H6", "Duplicated spend (points)"),
    ("S", "Stall time (s), not a hypothesis"),
)
AXES = {
    "recovery_ms": "detection = restart",
    "rival_restart_ms": "rival restart, extra",
    "rival_recovery_ms": "rival detection (fast external restart)",
    "agent_latency_scale": "agent latency",
    "agents": "total agents",
}
SECONDS = ("recovery_ms", "rival_restart_ms", "rival_recovery_ms")  # axes set in milliseconds
LOCALITY = (("cdt_s", "cdt"), ("blast_sessions_mean_pct", "blast"), ("idle_agent_s", "idle"))


def report_tables(results: Path) -> dict[str, str]:
    """Every generated block of the report by name, in the order the report shows them.
    ``results`` is ``bench/results``: ``honesty.json`` and ``rivals-gate/results.json``, and the
    jitter sweep's rows when it was run."""
    honesty: Row = json.loads((results / HONESTY).read_text(encoding="utf-8"))
    rows = read_results(results / GATE_ROWS)
    jitter = results / JITTER_ROWS
    return {
        **_regimes(honesty),
        "deciding": _deciding(honesty),
        **_tallies(honesty),
        **_gate_by_task(honesty),
        **_means(rows),
        **_twins(rows),
        "false_deaths": _false_deaths(honesty),
        **_per_process(honesty),
        "losses": _losses(honesty),
        **_seeds(rows),
        **(_jitter(read_results(jitter)) if jitter.is_file() else {}),
    }


def missing(report: str, tables: Mapping[str, str]) -> list[str]:
    """The names of the tables that are not in the report word for word (line endings aside)."""
    text = report.replace("\r\n", "\n")
    return [name for name, table in tables.items() if table not in text]


# -- layout ----------------------------------------------------------------------------------


def _table(header: Sequence[str], body: Iterable[Sequence[str]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines)


def _num(value: float | None, digits: int = 2) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def _avg(rows: Iterable[Row], key: str, digits: int = 1) -> str:
    values = [r[key] for r in rows if r.get(key) is not None]
    return "-" if not values else f"{mean(values):.{digits}f}"


def _setting(axis: str | None, value: Any) -> str:
    if axis is None:
        return "gate"
    if axis in SECONDS:
        return f"{value / 1000:g} s"
    if axis == "agent_latency_scale":
        return f"{value:g}x"
    return f"{value:g}"


def _name(rival: str) -> str:
    return rival.replace("-", "_")


def _ratios(point: Row) -> list[str]:
    return [_num(point["cdt_ratio"]), _num(point["blast_ratio"]), _num(point["idle_ratio"])]


def _where(point: Row) -> str:
    if point["axis"] is None:
        return f"{TASKS[point['task']]} {point['profile']}"
    return f"{AXES[point['axis']]} {_setting(point['axis'], point['value'])}"


def _by_cell(rows: Iterable[Row]) -> dict[tuple[str, str, str], list[Row]]:
    cells: dict[tuple[str, str, str], list[Row]] = defaultdict(list)
    for row in rows:
        cells[(row["task"], row["workflow"], row["profile"])].append(row)
    return cells


def _seeds_of(rows: Iterable[Row]) -> list[str]:
    return sorted({r["seed"] for r in rows}, key=int)


# -- the regime map and the outcome ----------------------------------------------------------


def _regimes(honesty: Row) -> dict[str, str]:
    regimes: list[Row] = honesty["regimes"]
    sweeps = [r for r in regimes if r["axis"] is not None]
    header = ["Sweep", "Setting", "In the plausible region", "Locality (PREREG)"]
    out = {}
    for rival in ("durable-max", "durable"):
        body = []
        for axis in AXES:
            mine = sorted(
                (r for r in sweeps if r["axis"] == axis and r["rival"] == rival),
                key=lambda r: r["value"],
            )
            body += [
                [
                    AXES[axis],
                    _setting(axis, r["value"]),
                    "yes" if r["plausible"] else "no",
                    r["locality"],
                    *_ratios(r),
                ]
                for r in mine
            ]
        out[f"regime_{_name(rival)}"] = _table([*header, "cdt", "blast", "idle"], body)
    body = []
    for task in TASKS:
        for profile in PROFILES:
            row = [TASKS[task], profile]
            for rival in RIVALS:
                point = next(
                    (
                        r
                        for r in regimes
                        if r["axis"] is None
                        and (r["task"], r["profile"], r["rival"]) == (task, profile, rival)
                    ),
                    None,
                )
                row.append(
                    "-" if point is None else f"{point['locality']}: {' / '.join(_ratios(point))}"
                )
            body.append(row)
    out["gate_locality"] = _table(
        ["Task", "Profile", "vs durable-max", "vs durable", "vs central"], body
    )
    return out


def _deciding(honesty: Row) -> str:
    """The points that decide the outcome, in the order of PREREG §7: the gate, then the sweeps."""
    outcome = honesty["outcome"]
    swept = sorted(outcome["plausible"], key=lambda p: list(AXES).index(p["axis"]))
    points = [("gate", g["profile"], g) for g in outcome["gate"]]
    points += [(AXES[p["axis"]], _setting(p["axis"], p["value"]), p) for p in swept]
    return _table(
        [
            "Point (T2, C3 unless a gate row)",
            "Setting",
            "Locality (PREREG)",
            "cdt",
            "blast",
            "idle",
        ],
        [[label, where, p["locality"], *_ratios(p)] for label, where, p in points],
    )


# -- the hypotheses --------------------------------------------------------------------------


def _gate_comparisons(honesty: Row) -> list[Row]:
    return [c for c in honesty["comparisons"] if c["axis"] is None and c["source"] == "rivals-gate"]


def _tally_table(counts: Mapping[str, Mapping[str, Sequence[int]]]) -> str:
    body = []
    for hid, label in HYPOTHESIS_ROWS:
        row = [f"{hid} {label}"]
        for rival in RIVALS:
            tally = counts[hid].get(rival)
            row.append("-" if tally is None else f"{tally[0]} / {tally[1]} / {tally[2]}")
        body.append(row)
    return _table(["Hypothesis", "vs durable-max", "vs durable", "vs central"], body)


def _tallies(honesty: Row) -> dict[str, str]:
    """Wins / ties / losses of the swarm per hypothesis and rival: at the gate, and everywhere."""
    everywhere = {
        h["id"]: {r: [t["win"], t["tie"], t["loss"]] for r, t in h["tally"].items()}
        for h in honesty["hypotheses"]
    }
    at_gate: dict[str, dict[str, list[int]]] = {hid: {} for hid, _ in HYPOTHESIS_ROWS}
    verdicts = ("win", "tie", "loss")
    for c in _gate_comparisons(honesty):
        slot = at_gate[c["hypothesis"]].setdefault(c["rival"], [0, 0, 0])
        if c["verdict"] in verdicts:
            slot[verdicts.index(c["verdict"])] += 1
    return {"tally_gate": _tally_table(at_gate), "tally_all": _tally_table(everywhere)}


def _gate_by_task(honesty: Row) -> dict[str, str]:
    """The gate against each rival, one table per task: the verdict and (swarm / rival) means."""
    found: dict[tuple[str, str, str, str], Row] = {}
    for c in _gate_comparisons(honesty):
        found.setdefault((c["hypothesis"], c["task"], c["profile"], c["rival"]), c)
    out = {}
    for rival in RIVALS:
        for task in T2_FIRST:
            body = []
            for hid, label in HYPOTHESIS_ROWS:
                row = [f"{hid} {label}"]
                for profile in PROFILES:
                    c = found.get((hid, task, profile, rival))
                    if c is None:
                        row.append("-")
                        continue
                    mark = c["verdict"] + ("*" if c["mixed"] else "")
                    row.append(f"{mark} ({_num(c['swarm'])} / {_num(c['rival_value'])})")
                body.append(row)
            out[f"gate_{TASKS[task].lower()}_{_name(rival)}"] = _table(["", *PROFILES], body)
    return out


def _losses(honesty: Row) -> str:
    """Where the swarm loses against ``durable-max``, per hypothesis, with its figure and theirs."""
    lines = []
    for hid, label in HYPOTHESIS_ROWS:
        if hid not in ("H1", "H3", "H4a", "H4b", "H4c", "H6"):
            continue
        points = [
            f"{_where(c)} ({_num(c['swarm'])} against {_num(c['rival_value'])})"
            for c in honesty["comparisons"]
            if c["hypothesis"] == hid and c["rival"] == "durable-max" and c["verdict"] == "loss"
        ]
        if points:
            lines.append(f"- **{hid}, {label}:** " + "; ".join(points) + ".")
    return "\n".join(lines)


# -- the gate's means ------------------------------------------------------------------------


def _means(rows: list[Row]) -> dict[str, str]:
    by = _by_cell(rows)
    cells = [(task, w) for task in T2_FIRST for w in FLOWS]
    chaos = ("C0", *PROFILES)

    def means(column: str, profiles: Sequence[str], digits: int = 1) -> list[list[str]]:
        return [
            [
                TASKS[task],
                NAMES.get(w, w),
                *(_avg(by[(task, w, p)], column, digits) for p in profiles),
            ]
            for task, w in cells
        ]

    out = {
        "stall": _table(["Task", "Workflow", *chaos], means("stall_s", chaos)),
        "cost": _table(["Task", "Workflow", *PROFILES], means("extra_cost_pct", PROFILES)),
        "cost_abs": _table(["Task", "Workflow", *chaos], means("cost_usd", chaos, 3)),
    }
    for profile in ("C2", "C3"):
        body = []
        for task, w in cells:
            g = by[(task, w, profile)]
            body.append(
                [
                    TASKS[task],
                    NAMES.get(w, w),
                    _avg(g, "idle_agent_s"),
                    _avg(g, "cdt_s"),
                    _avg(g, "ttr_own_mean_s", 2),
                    _avg(g, "blast_sessions_mean_pct"),
                    _avg(g, "preserved_pct"),
                    _avg(g, "cancelled_llm_calls"),
                    _avg(g, "dup_usd", 3),
                    _avg(g, "false_death_remaps", 2),
                ]
            )
        out[f"recovery_{profile.lower()}"] = _table(
            [
                "Task",
                "Workflow",
                "Idle agent-s",
                "Dependency time (s)",
                "Time to recover (s)",
                "Blast (% of sessions)",
                "Preserved (%)",
                "Calls cancelled",
                "Paid twice ($)",
                "False deaths",
            ],
            body,
        )
    body = []
    for task, w in cells:
        g = [r for p in chaos for r in by[(task, w, p)]]
        done = sum(1 for r in g if r["completed"]) / len(g)
        valid = sum(1 for r in g if r["valid"]) / len(g)
        body.append(
            [
                TASKS[task],
                NAMES.get(w, w),
                f"{100 * done:.0f}%",
                f"{100 * valid:.0f}%",
                _avg(g, "coordination_tokens", 0),
                _avg(g, "makespan_s"),
                _avg(g, "cost_usd", 3),
            ]
        )
    out["secondary"] = _table(
        [
            "Task",
            "Workflow",
            "Completion",
            "Validity",
            "Coordination tokens / run",
            "Makespan (s)",
            "Cost ($)",
        ],
        body,
    )
    return out


def _twins(rows: list[Row]) -> dict[str, str]:
    """C0 is the twin of every chaos cell: do the four systems start from the same run? And T1's
    stall, seed by seed, swarm against ``durable-max``."""
    index = {(r["workflow"], r["task"], r["profile"], r["seed"]): r for r in rows}
    seeds = _seeds_of(rows)
    body = []
    for task in T2_FIRST:
        for seed in seeds:
            row = [TASKS[task], seed]
            for w in FLOWS:
                r = index[(w, task, "C0", seed)]
                row.append(f"{r['llm_calls']} / {r['makespan_s']:.1f} s / ${r['cost_usd']:.3f}")
            body.append(row)
    out = {"c0_twin": _table(["Task", "Seed", *FLOWS], body)}
    body = []
    for profile in PROFILES:
        for w in ("swarm", "durable-max"):
            stalls = [index[(w, "t1_extraction", profile, s)]["stall_s"] for s in seeds]
            body.append([profile, w, *(f"{v:.1f}" for v in stalls), f"{mean(stalls):.1f}"])
    header = ["Profile", "Workflow", *(f"Seed {s}" for s in seeds), "Mean"]
    out["stall_t1_seeds"] = _table(header, body)
    return out


def _seeds(rows: list[Row]) -> dict[str, str]:
    """T2 at C2 and C3, seed by seed, swarm against ``durable-max``: H2 and the locality metrics."""
    index = {(r["workflow"], r["task"], r["profile"], r["seed"]): r for r in rows}
    seeds = _seeds_of(rows)
    body = []
    for profile in ("C2", "C3"):
        for seed in seeds:
            s = index[("swarm", "t2_conference", profile, seed)]
            d = index[("durable-max", "t2_conference", profile, seed)]
            body.append(
                [
                    profile,
                    seed,
                    _num(s["extra_cost_pct"]),
                    _num(d["extra_cost_pct"]),
                    _num(d["extra_cost_pct"] - s["extra_cost_pct"]),
                    f"{s['cost_usd']:.3f} / {d['cost_usd']:.3f}",
                    f"{s['preserved_pct']:.0f} / {d['preserved_pct']:.0f}",
                    f"{s['score']:.3f} / {d['score']:.3f}",
                ]
            )
    out = {
        "h2_seeds": _table(
            [
                "Profile",
                "Seed",
                "Swarm extra cost (%)",
                "durable-max extra cost (%)",
                "Difference (points)",
                "Cost, swarm / durable-max ($)",
                "Preserved, swarm / durable-max (%)",
                "Score, swarm / durable-max",
            ],
            body,
        )
    }
    body = []
    for profile in ("C2", "C3"):
        for metric, label in LOCALITY:
            cells = []
            for seed in seeds:
                a = index[("swarm", "t2_conference", profile, seed)][metric]
                b = index[("durable-max", "t2_conference", profile, seed)][metric]
                ratio = f"{a / b:.2f}" if b else "-"
                win = judge(RULES[metric], a, b) == "win"
                cells.append(f"{a:.1f} / {b:.1f} = {ratio}{'' if win else ' (no win)'}")
            body.append([profile, label, *cells])
    out["gate_t2_seeds"] = _table(["Profile", "Metric", *(f"Seed {s}" for s in seeds)], body)
    return out


# -- false deaths and the per-process view ---------------------------------------------------


def _false_deaths(honesty: Row) -> str:
    """The swarm's false deaths per run at the gate and at every setting of every sweep."""
    swarm = [
        f
        for f in honesty["false_deaths"]
        if f["workflow"] == "swarm" and f["remaps_mean"] is not None
    ]
    body = []
    for axis in [None, *AXES]:
        mine = sorted(
            (f for f in swarm if f["axis"] == axis),
            key=lambda f: (f["task"], f["profile"], f["value"] or 0),
        )
        for f in mine:
            if axis is None:
                label, place = "gate", f"{TASKS[f['task']]} {f['profile']}"
            else:
                label, place = AXES[axis], _setting(axis, f["value"])
            body.append(
                [
                    label,
                    place,
                    str(f["runs"]),
                    _num(f["remaps_mean"]),
                    str(f["remaps_max"]),
                    f"{f['spent_usd_mean'] or 0:.4f}",
                ]
            )
    return _table(
        [
            "Sweep",
            "Setting",
            "Runs",
            "Per run (mean)",
            "Most in one run",
            "Paid twice per run ($)",
        ],
        body,
    )


def _per_process(honesty: Row) -> dict[str, str]:
    """What one crash costs the swarm (per level of its tree) and each rival (one coordinator)."""
    found = next(p for p in honesty["per_process"] if p["task"] == "t2_conference")
    metrics = ("cdt_s", "idle_agent_s", "ttr_own_mean_s", "blast_agents_mean_pct")

    def impact(impacts: Mapping[str, float | None]) -> list[str]:
        return [_num(impacts[m]) for m in metrics]

    body = [
        [
            f"swarm, level {lv['level']} (x{lv['count']})",
            ", ".join(lv["targets"]),
            f"{lv['runs']} ({lv['skipped']} skipped)",
            *impact(lv["impact"]),
        ]
        for lv in found["swarm_levels"]
    ]
    body.append(
        ["swarm, expected per hour (count x mean)", "", "", *impact(found["swarm_expected"])]
    )
    body += [
        [f"{rival}, one coordinator", "o0", "4", *impact(impacts)]
        for rival, impacts in found["rivals"].items()
    ]
    out = {
        "per_process_impact": _table(
            [
                "System",
                "Probes",
                "Runs",
                "cdt (s)",
                "Idle agent-s",
                "Time to recover (s)",
                "Blast (% of agents)",
            ],
            body,
        )
    }
    body = [
        [rival, *(f"{_num(ratios[m])} ({found['reading'][rival][m]})" for m in metrics)]
        for rival, ratios in found["ratio"].items()
    ]
    out["per_process_ratio"] = _table(
        ["r = swarm / rival", "cdt", "Idle agent-s", "Time to recover", "Blast (agents)"], body
    )
    return out


# -- the exploratory crash-time jitter sweep -------------------------------------------------


def _points(value: float) -> str:
    return f"±{value:g}" if value else "0"


def _jitter(rows: list[Row]) -> dict[str, str]:
    """T2 at C3 at each jitter setting (each with its own C0 twin): where the crashes of each
    seed's plan land, the locality of the swarm against each rival as ``bench verdicts`` reads it,
    each workflow's means, and the locality metrics seed by seed against ``durable-max``.
    Exploratory: none of it is in ``honesty.json``."""
    swept = [
        (parse_knobs(r.get("knobs")).get(JITTER_AXIS), r)
        for r in rows
        if r["task"] == "t2_conference"
    ]
    mine = [(setting, r) for setting, r in swept if setting is not None]
    settings = sorted({setting for setting, _ in mine})
    chaos = [(setting, r) for setting, r in mine if r["profile"] == "C3"]

    seeds = _seeds_of(r for _, r in chaos)
    plans = []
    for seed in seeds:  # where the crashes of the plan land: what a setting means
        row = [seed]
        for setting in settings:
            plan = jittered_plan(build_plan("C3", seed).model_dump(mode="json"), seed, int(setting))
            at = [a["at"] for a in plan["actions"] if a["kind"] == "kill_coordinator"]
            row.append(" / ".join(f"{x * 100:.0f}" for x in at))
        plans.append(row)
    out = {"jitter_plans": _table(["Seed", *(f"Jitter {_points(s)}" for s in settings)], plans)}

    regimes = evaluate([(JITTER_AXIS, [r for _, r in mine])]).regimes
    found = {(r.rival, r.value): r for r in regimes if r.axis == JITTER_AXIS and r.profile == "C3"}
    body = []
    for setting in settings:
        row = [_points(setting)]
        for rival in ("durable-max", "durable"):
            point = found.get((rival, setting))
            row += ["-"] * 4 if point is None else [point.locality, *_ratios(point.model_dump())]
        body.append(row)
    out["jitter_locality"] = _table(
        [
            "Jitter (points)",
            "vs durable-max",
            "cdt",
            "blast",
            "idle",
            "vs durable",
            "cdt",
            "blast",
            "idle",
        ],
        body,
    )

    body = []
    for setting in settings:
        for w in ("swarm", "durable-max", "durable"):
            cell = [r for s, r in chaos if s == setting and r["workflow"] == w]
            body.append(
                [
                    _points(setting),
                    w,
                    _avg(cell, "cdt_s"),
                    _avg(cell, "blast_sessions_mean_pct"),
                    _avg(cell, "idle_agent_s"),
                    _avg(cell, "extra_cost_pct"),
                    _avg(cell, "stall_s"),
                ]
            )
    out["jitter_means"] = _table(
        [
            "Jitter (points)",
            "Workflow",
            "cdt (s)",
            "Blast (% sessions)",
            "Idle agent-s",
            "Extra cost (%)",
            "Stall (s)",
        ],
        body,
    )

    index = {(s, r["workflow"], r["seed"]): r for s, r in chaos}
    body = []
    for metric, label in LOCALITY:
        for seed in seeds:
            cells = []
            for setting in settings:
                a = index[(setting, "swarm", seed)][metric]
                b = index[(setting, "durable-max", seed)][metric]
                ratio = f"{a / b:.2f}" if b else "-"
                win = judge(RULES[metric], a, b) == "win"
                cells.append(f"{a:.1f} / {b:.1f} = {ratio}{'' if win else ' (no win)'}")
            body.append([label, seed, *cells])
    out["jitter_seeds"] = _table(
        ["Metric", "Seed", *(f"Jitter {_points(s)}" for s in settings)], body
    )
    return out
