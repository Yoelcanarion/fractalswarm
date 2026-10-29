"""Verdicts under the pre-registration (``bench/PREREG.md``): the swarm's wins, ties and losses.

The rules are the file's, applied mechanically to the rows of results directories
(``harness.aggregate``): the tie rule, the minimum effects, hypotheses H1-H6, the plausible region,
the per-process model and the decision rules of arena spec §C.4. Nothing here is tuned, and
nothing asserts that the swarm wins: every verdict is the swarm's, so ``win`` means it is better
than the rival by the minimum effect on every seed, and ``loss`` that it is worse. The result is
``Honesty``, which ``honesty.json`` holds and the UI's "where it helps" panel reads, and a text
rendering of it.
"""

import hashlib
import json
import subprocess
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel

from fractalswarm.bench.harness import aggregate, load_results, read_results
from fractalswarm.planning.taskspec import REPO_ROOT

SWARM = "swarm"
RIVALS = ("durable-max", "durable", "central")
DECIDING_RIVAL = "durable-max"  # the strongest: the outcome is read against it
DECIDING_TASK = "t2_conference"
GATE_PROFILES = ("C2", "C3")  # where the gate decides the outcome
PREREG_PATH = REPO_ROOT / "bench" / "PREREG.md"
PREREG_NAME = "bench/PREREG.md"

Verdict = Literal["win", "tie", "loss", "n/a", "incomplete"]
Locality = Literal["holds", "ties", "fails", "n/a"]
Reading = Literal["swarm lower", "comparable", "rival lower", "n/a"]


# -- the rules (PREREG §3) -------------------------------------------------------------------


@dataclass(frozen=True)
class Rule:
    key: str
    kind: Literal["difference", "ratio"]
    minimum: float  # the difference that counts, or the ratio at or below which it counts
    floor: float = 0.0  # ratio rules: the larger value must reach it
    lower_is_better: bool = True
    per_crash: bool = True  # no value in a run that logged no crash


RULES: dict[str, Rule] = {
    rule.key: rule
    for rule in (
        Rule("stall_s", "difference", 3.0, per_crash=False),
        Rule("extra_cost_pct", "difference", 5.0, per_crash=False),
        Rule("ttr_own_mean_s", "difference", 1.0),
        Rule("dup_chaos_pct", "difference", 5.0),
        Rule("unnecessary_reassignments", "difference", 1.0),
        Rule("preserved_pct", "difference", 10.0, lower_is_better=False),
        Rule("cdt_s", "ratio", 0.5, floor=1.0),
        Rule("blast_sessions_mean_pct", "ratio", 0.5, floor=5.0),
        Rule("blast_agents_mean_pct", "ratio", 0.5, floor=5.0),
        Rule("idle_agent_s", "ratio", 0.5, floor=1.0),
    )
}


@dataclass(frozen=True)
class Hypothesis:
    id: str
    name: str
    metric: str
    expected: str


HYPOTHESES = (
    Hypothesis(
        "H1", "Preserved work", "preserved_pct", "durable-max >= swarm ~ durable >> central"
    ),
    Hypothesis("H2", "Extra cost", "extra_cost_pct", "swarm and durable-max tie"),
    Hypothesis("H3", "Time to recover", "ttr_own_mean_s", "the supervisor wins or ties"),
    Hypothesis("H4a", "Locality: coordinator-dependency time", "cdt_s", "swarm <= 0.5 x rival"),
    Hypothesis("H4b", "Locality: blast radius", "blast_sessions_mean_pct", "swarm <= 0.5 x rival"),
    Hypothesis("H4c", "Locality: idle agent-seconds", "idle_agent_s", "swarm <= 0.5 x rival"),
    Hypothesis(
        "H5",
        "Unnecessary reassignments",
        "unnecessary_reassignments",
        "durable ~ 0; swarm = false deaths",
    ),
    Hypothesis("H6", "Duplicated spend", "dup_chaos_pct", "durable-max = 0 <= swarm"),
    Hypothesis("S", "Stall time (reported, not a hypothesis)", "stall_s", "reported"),
)
HYPOTHESIS = {h.id: h for h in HYPOTHESES}

# PREREG §5: the part of the rival's assumptions a deployment could have. Axis -> settings.
PLAUSIBLE: dict[str, tuple[float, ...]] = {
    "recovery_ms": (1000, 2000, 2500, 5000, 10000),
    "rival_restart_ms": (0, 1000, 3000),
    "rival_recovery_ms": (500, 1000),
}
# PREREG §6: the swarm's coordinators per level of its tree (the demo's fanout [3, 2]).
TREE_COUNTS = {0: 1, 1: 3, 2: 6}
IMPACTS = ("cdt_s", "idle_agent_s", "ttr_own_mean_s", "blast_agents_mean_pct")
PROBE_PREFIX = "K-"


def judge(rule: Rule, swarm: float, rival: float) -> Literal["win", "tie", "loss"]:
    """One seed's outcome for the swarm (PREREG §3)."""
    if rule.kind == "ratio":
        if swarm <= rule.minimum * rival and rival >= rule.floor:
            return "win"
        if rival <= rule.minimum * swarm and swarm >= rule.floor:
            return "loss"
        return "tie"
    better = rival - swarm if rule.lower_is_better else swarm - rival
    if better >= rule.minimum:
        return "win"
    if better <= -rule.minimum:
        return "loss"
    return "tie"


def combine(outcomes: Sequence[str]) -> tuple[Verdict, bool]:
    """A comparison's verdict over its seeds, and whether the seeds disagreed."""
    if not outcomes:
        return "n/a", False
    if all(o == "win" for o in outcomes):
        return "win", False
    if all(o == "loss" for o in outcomes):
        return "loss", False
    return "tie", len(set(outcomes)) > 1


def value(row: Mapping[str, Any], key: str) -> float | None:
    """The row's value of a metric, None where the run has none (PREREG §3)."""
    if RULES[key].per_crash and not row.get("crashes"):
        return None
    if key == "dup_chaos_pct":
        cost, extra = row.get("cost_usd"), row.get("extra_cost_pct")
        spent = (row.get("dup_crash_usd"), row.get("dup_false_death_usd"))
        if cost is None or extra is None or None in spent:
            return None
        twin = cost / (1 + extra / 100)
        return 100 * (spent[0] + spent[1]) / twin if twin > 0 else None
    found = row.get(key)
    return None if found is None else float(found)


# -- the output ------------------------------------------------------------------------------


class Comparison(BaseModel):
    hypothesis: str
    metric: str
    rival: str
    source: str
    task: str
    profile: str
    axis: str | None
    value: float | None
    knobs: dict[str, float]
    agents: int | None
    seeds: list[str]
    swarm: float | None
    rival_value: float | None
    ratio: float | None  # swarm / rival
    difference: float | None  # rival - swarm
    verdict: Verdict
    mixed: bool


class Tally(BaseModel):
    win: int = 0
    tie: int = 0
    loss: int = 0
    na: int = 0  # n/a and incomplete


class HypothesisBlock(BaseModel):
    id: str
    name: str
    metric: str
    expected: str
    tally: dict[str, Tally]


class Regime(BaseModel):
    source: str
    axis: str | None
    value: float | None
    plausible: bool
    task: str
    profile: str
    rival: str
    locality: Locality
    cdt_ratio: float | None
    blast_ratio: float | None
    idle_ratio: float | None


class Outcome(BaseModel):
    label: Literal["A", "B", "pending"]
    against: str
    gate: list[dict[str, Any]]  # task, profile, locality, and the descriptive ratios
    plausible: list[dict[str, Any]]
    conditions: list[str]


class Level(BaseModel):
    level: int
    targets: list[str]
    count: int  # coordinators the swarm runs at this level
    runs: int
    skipped: int  # probes that found no coordinator to crash
    impact: dict[str, float | None]


class PerProcess(BaseModel):
    task: str
    swarm_levels: list[Level]
    swarm_expected: dict[str, float | None]  # sum over levels of count x mean impact
    rivals: dict[str, dict[str, float | None]]  # a supervisor's one crash
    ratio: dict[str, dict[str, float | None]]
    reading: dict[str, dict[str, Reading]]


class FalseDeaths(BaseModel):
    """What a system's failure detector got wrong at one point: live coordinators it gave away
    (``false_death_remaps``). Only the swarm has a detector; the supervisors are told."""

    source: str
    axis: str | None
    value: float | None
    task: str
    profile: str
    workflow: str
    runs: int
    remaps_mean: float | None  # per run
    remaps_max: int | None
    spent_usd_mean: float | None  # work paid twice because of them, per run


class Honesty(BaseModel):
    schema_version: int = 1
    prereg: dict[str, str]
    code: dict[str, Any] = {}  # the commit the verdicts were computed at, and whether it is clean
    sources: list[str]
    rules: dict[str, Any]
    outcome: Outcome
    hypotheses: list[HypothesisBlock]
    comparisons: list[Comparison]
    regimes: list[Regime]
    per_process: list[PerProcess]
    false_deaths: list[FalseDeaths] = []
    tally: Tally


# -- reading the results ---------------------------------------------------------------------


def parse_knobs(text: str | None) -> dict[str, float]:
    """The row's knobs column (``recovery_ms=500;agent_latency_scale=0.5``) as numbers."""
    if not text:
        return {}
    return {
        name: float(number) for name, _, number in (part.partition("=") for part in text.split(";"))
    }


def read_rows(path: Path) -> list[tuple[str, list[dict[str, Any]]]]:
    """(source name, rows) for a results directory, or for each one below a directory of them.
    The cell results are the source of truth; a directory with only ``results.json`` is read."""
    if (path / "cells").is_dir():
        return [(path.name, aggregate(load_results(path)))]
    if (path / "results.json").is_file():
        return [(path.name, read_results(path / "results.json"))]
    found = []
    for child in sorted(p for p in path.iterdir() if p.is_dir()):
        found += read_rows(child)
    return found


def axis_of(row: Mapping[str, Any], knobs: Mapping[str, float]) -> tuple[str | None, float | None]:
    if knobs:
        axis = "+".join(sorted(knobs))
        return axis, knobs[axis] if len(knobs) == 1 else None
    if row.get("agents") is not None:
        return "agents", float(row["agents"])
    return None, None


Point = tuple[str, str, str, str | None, float | None, str, int | None]
# source, task, profile, axis, value, knobs text, agents


def point_key(point: Point) -> tuple:
    source, task, profile, axis, setting, knobs_text, agents = point
    return (
        source,
        task,
        profile,
        axis or "",
        -1.0 if setting is None else setting,
        knobs_text,
        agents or 0,
    )


def index_rows(sources: Iterable[tuple[str, list[dict[str, Any]]]]):
    """point -> workflow -> seed -> row."""
    index: dict[Point, dict[str, dict[str, dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    for source, rows in sources:
        for row in rows:
            knobs = parse_knobs(row.get("knobs"))
            axis, setting = axis_of(row, knobs)
            point = (
                source,
                row["task"],
                row["profile"],
                axis,
                setting,
                row.get("knobs") or "",
                row.get("agents"),
            )
            index[point][row["workflow"]][str(row["seed"])] = row
    return index


# -- comparing -------------------------------------------------------------------------------


def compare(
    hypothesis: Hypothesis,
    rival: str,
    point: Point,
    swarm: Mapping[str, Mapping[str, Any]],
    other: Mapping[str, Mapping[str, Any]],
) -> Comparison:
    rule = RULES[hypothesis.metric]
    source, task, profile, axis, setting, knobs_text, agents = point
    paired = sorted(set(swarm) & set(other))
    incomplete = any(not swarm[s].get("completed") or not other[s].get("completed") for s in paired)
    seeds, outcomes, mine, theirs = [], [], [], []
    for seed in paired:
        a, b = value(swarm[seed], hypothesis.metric), value(other[seed], hypothesis.metric)
        if a is None or b is None:
            continue
        seeds.append(seed)
        mine.append(a)
        theirs.append(b)
        outcomes.append(judge(rule, a, b))
    verdict, mixed = combine(outcomes)
    swarm_mean = sum(mine) / len(mine) if mine else None
    rival_mean = sum(theirs) / len(theirs) if theirs else None
    return Comparison(
        hypothesis=hypothesis.id,
        metric=hypothesis.metric,
        rival=rival,
        source=source,
        task=task,
        profile=profile,
        axis=axis,
        value=setting,
        knobs=parse_knobs(knobs_text),
        agents=agents,
        seeds=seeds,
        swarm=swarm_mean,
        rival_value=rival_mean,
        ratio=swarm_mean / rival_mean if swarm_mean is not None and rival_mean else None,
        difference=rival_mean - swarm_mean
        if swarm_mean is not None and rival_mean is not None
        else None,
        verdict="incomplete" if incomplete else verdict,
        mixed=mixed and not incomplete,
    )


def locality(a: Verdict, b: Verdict, c: Verdict) -> Locality:
    """PREREG §4: it fails when H4a or H4b is a loss; it holds when both are wins and H4c is not
    a loss; with no verdict on either of the two it is n/a; otherwise it ties."""
    if a == "loss" or b == "loss":
        return "fails"
    if a in ("n/a", "incomplete") or b in ("n/a", "incomplete"):
        return "n/a"
    if a == "win" and b == "win" and c != "loss":
        return "holds"
    return "ties"


def where(axis: str | None, setting: float | None) -> str:
    if axis is None:
        return "gate"
    return axis if setting is None else f"{axis}={setting:g}"


def is_plausible(axis: str | None, setting: float | None) -> bool:
    return axis in PLAUSIBLE and setting in PLAUSIBLE[axis]


def regimes_of(comparisons: Sequence[Comparison]) -> list[Regime]:
    """One regime per rival at each point: its locality and the three ratios."""
    grouped: dict[tuple, dict[str, Comparison]] = defaultdict(dict)
    for c in comparisons:
        if c.hypothesis in ("H4a", "H4b", "H4c"):
            point = (c.source, c.task, c.profile, c.axis, c.value, c.agents, c.rival)
            grouped[point][c.hypothesis] = c
    regimes = []

    def order(item: tuple) -> tuple:
        source, task, profile, axis, setting, agents, rival = item[0]
        return (
            source,
            task,
            profile,
            axis or "",
            -1.0 if setting is None else setting,
            agents or 0,
            rival,
        )

    for (source, task, profile, axis, setting, _, rival), found in sorted(
        grouped.items(), key=order
    ):
        a, b, c = (found.get(h) for h in ("H4a", "H4b", "H4c"))
        verdicts: list[Verdict] = [x.verdict if x else "n/a" for x in (a, b, c)]
        regimes.append(
            Regime(
                source=source,
                axis=axis,
                value=setting,
                plausible=is_plausible(axis, setting),
                task=task,
                profile=profile,
                rival=rival,
                locality=locality(*verdicts),
                cdt_ratio=a.ratio if a else None,
                blast_ratio=b.ratio if b else None,
                idle_ratio=c.ratio if c else None,
            )
        )
    return regimes


def ratio_text(cdt: float | None, blast: float | None, idle: float | None) -> str:
    """The ratios of the seed means that sit next to a locality verdict. They are descriptive:
    the verdict is the one PREREG §4 derives, seed by seed, and these are shown beside it."""
    return (
        "ratios of the seed means, descriptive (no verdict): "
        f"cdt {_num(cdt)}, blast {_num(blast)}, idle {_num(idle)}"
    )


def ratios_of(r: Regime) -> dict[str, float | None]:
    return {"cdt_ratio": r.cdt_ratio, "blast_ratio": r.blast_ratio, "idle_ratio": r.idle_ratio}


def decide(regimes: Sequence[Regime]) -> Outcome:
    """PREREG §7. A needs locality against the deciding rival on the deciding task at the gate
    (C2 and C3, default assumptions) and at every point of the plausible region; B is anything
    else; pending while a point it needs has no data. Every locality verdict it prints comes
    with the ratios of the seed means, descriptive."""
    ours = [r for r in regimes if r.rival == DECIDING_RIVAL and r.task == DECIDING_TASK]
    gate = {r.profile: r for r in ours if r.axis is None and r.profile in GATE_PROFILES}
    swept = {(r.axis, r.value): r for r in ours if r.plausible and r.profile == "C3"}
    needed = [(axis, setting) for axis, settings in PLAUSIBLE.items() for setting in settings]
    conditions = []
    missing = [f"gate {p}" for p in GATE_PROFILES if p not in gate]
    missing += [where(axis, setting) for axis, setting in needed if (axis, setting) not in swept]
    deciding = [*gate.values(), *swept.values()]
    for r in deciding:
        if r.locality != "holds":
            conditions.append(
                f"locality {r.locality} at {where(r.axis, r.value)} ({r.task}, {r.profile}); "
                + ratio_text(r.cdt_ratio, r.blast_ratio, r.idle_ratio)
            )
    for r in ours:  # outside the plausible region: the scope of the claim, not its test
        if r not in deciding and r.profile == "C3" and r.locality in ("ties", "fails"):
            conditions.append(
                f"locality {r.locality} at {where(r.axis, r.value)} ({r.task}, {r.profile}), "
                "outside the plausible region; "
                + ratio_text(r.cdt_ratio, r.blast_ratio, r.idle_ratio)
            )
    if missing:
        label: Literal["A", "B", "pending"] = "pending"
        conditions.insert(0, "no data for " + ", ".join(missing))
    elif all(r.locality == "holds" for r in deciding):
        label = "A"
    else:
        label = "B"
    return Outcome(
        label=label,
        against=DECIDING_RIVAL,
        gate=[
            {"task": r.task, "profile": r.profile, "locality": r.locality, **ratios_of(r)}
            for r in gate.values()
        ],
        plausible=[
            {"axis": r.axis, "value": r.value, "locality": r.locality, **ratios_of(r)}
            for r in swept.values()
        ],
        conditions=conditions,
    )


# -- the per-process view (PREREG §6) --------------------------------------------------------


def level_of(target: str) -> int:
    return 0 if target == "o0" else 1 + target.count(".")


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def per_process(sources: Iterable[tuple[str, list[dict[str, Any]]]]) -> list[PerProcess]:
    probes: dict[str, dict[str, dict[str, list[dict[str, Any]]]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(list))
    )
    for _, rows in sources:
        for row in rows:
            profile = row["profile"]
            if profile.startswith(PROBE_PREFIX) and not row.get("knobs"):
                target = profile.removeprefix(PROBE_PREFIX).partition("@")[0]
                probes[row["task"]][row["workflow"]][target].append(row)
    views = []
    for task, by_workflow in sorted(probes.items()):
        swarm_probes = by_workflow.get(SWARM, {})
        levels = []
        expected: dict[str, float | None] = dict.fromkeys(IMPACTS, 0.0)
        for level, count in sorted(TREE_COUNTS.items()):
            targets = sorted(t for t in swarm_probes if level_of(t) == level)
            rows = [r for t in targets for r in swarm_probes[t]]
            landed = [r for r in rows if r.get("crashes")]
            impact = {k: _mean([r[k] for r in landed if r.get(k) is not None]) for k in IMPACTS}
            levels.append(
                Level(
                    level=level,
                    targets=targets,
                    count=count,
                    runs=len(landed),
                    skipped=len(rows) - len(landed),
                    impact=impact,
                )
            )
            for k in IMPACTS:
                if impact[k] is None:
                    expected[k] = None
                elif expected[k] is not None:
                    expected[k] += count * impact[k]
        rivals: dict[str, dict[str, float | None]] = {}
        ratio: dict[str, dict[str, float | None]] = {}
        reading: dict[str, dict[str, Reading]] = {}
        for rival in RIVALS:
            landed = [r for r in by_workflow.get(rival, {}).get("o0", []) if r.get("crashes")]
            if not landed:
                continue
            rivals[rival] = {
                k: _mean([r[k] for r in landed if r.get(k) is not None]) for k in IMPACTS
            }
            ratio[rival], reading[rival] = {}, {}
            for k in IMPACTS:
                mine, theirs = expected[k], rivals[rival][k]
                ratio[rival][k] = mine / theirs if mine is not None and theirs else None
                reading[rival][k] = read_ratio(mine, theirs)
        views.append(
            PerProcess(
                task=task,
                swarm_levels=levels,
                swarm_expected=expected,
                rivals=rivals,
                ratio=ratio,
                reading=reading,
            )
        )
    return views


def read_ratio(swarm: float | None, rival: float | None) -> Reading:
    """PREREG §6: ``r <= 0.5`` the swarm's expected impact is lower, ``r >= 2`` the supervisor's
    is, anything between is comparable."""
    if swarm is None or rival is None:
        return "n/a"
    if rival == 0:
        return "comparable" if swarm == 0 else "rival lower"
    ratio = swarm / rival
    if ratio <= 0.5:
        return "swarm lower"
    if ratio >= 2:
        return "rival lower"
    return "comparable"


# -- false deaths ----------------------------------------------------------------------------


def false_deaths_of(sources: Iterable[tuple[str, list[dict[str, Any]]]]) -> list[FalseDeaths]:
    """Per regime point and workflow, the live coordinators a detector gave away (PREREG §5). C0
    and the single-crash probes run no faults that could cause one, and are left out."""
    found = []
    index = index_rows(sources)
    for point in sorted(index, key=point_key):
        source, task, profile, axis, setting, _, _ = point
        if profile == "C0" or profile.startswith(PROBE_PREFIX):
            continue
        for workflow, by_seed in sorted(index[point].items()):
            rows = list(by_seed.values())
            counts = [
                r["false_death_remaps"] for r in rows if r.get("false_death_remaps") is not None
            ]
            spent = [
                r["dup_false_death_usd"] for r in rows if r.get("dup_false_death_usd") is not None
            ]
            found.append(
                FalseDeaths(
                    source=source,
                    axis=axis,
                    value=setting,
                    task=task,
                    profile=profile,
                    workflow=workflow,
                    runs=len(rows),
                    remaps_mean=_mean(counts),
                    remaps_max=max(counts) if counts else None,
                    spent_usd_mean=_mean(spent),
                )
            )
    return found


# -- the whole thing -------------------------------------------------------------------------


def prereg_sha(path: Path) -> str:
    """12 hex digits of the file with its line endings normalized, so every checkout agrees."""
    text = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.blake2b(text, digest_size=6).hexdigest()


def code_version(root: Path = REPO_ROOT) -> dict[str, Any]:
    """The commit the verdicts were computed at, and whether a tracked file differs from it: results
    can be reproduced from a clean commit only. Both are None where there is no git to ask."""

    def git(*args: str) -> str | None:
        try:
            done = subprocess.run(
                ["git", "-C", str(root), *args],
                capture_output=True,
                text=True,
                timeout=30,
                check=True,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return done.stdout.strip()

    status = git("status", "--porcelain", "--untracked-files=no")
    return {"commit": git("rev-parse", "HEAD"), "dirty": None if status is None else bool(status)}


def evaluate(
    sources: Sequence[tuple[str, list[dict[str, Any]]]],
    prereg: Path | None = None,
    code: dict[str, Any] | None = None,
) -> Honesty:
    comparisons: list[Comparison] = []
    for point, by_workflow in sorted(
        index_rows(sources).items(), key=lambda item: point_key(item[0])
    ):
        _, _, profile, *_ = point
        swarm = by_workflow.get(SWARM)
        if swarm is None or profile == "C0" or profile.startswith(PROBE_PREFIX):
            continue
        for rival in RIVALS:
            if rival in by_workflow:
                comparisons += [
                    compare(h, rival, point, swarm, by_workflow[rival]) for h in HYPOTHESES
                ]
    blocks = []
    for h in HYPOTHESES:
        tally = {rival: Tally() for rival in RIVALS}
        for c in comparisons:
            if c.hypothesis == h.id:
                column = "na" if c.verdict in ("n/a", "incomplete") else c.verdict
                setattr(tally[c.rival], column, getattr(tally[c.rival], column) + 1)
        blocks.append(
            HypothesisBlock(id=h.id, name=h.name, metric=h.metric, expected=h.expected, tally=tally)
        )
    regimes = regimes_of(comparisons)
    total = Tally()
    for c in comparisons:
        if c.hypothesis != "S":
            column = "na" if c.verdict in ("n/a", "incomplete") else c.verdict
            setattr(total, column, getattr(total, column) + 1)
    path = prereg or PREREG_PATH
    return Honesty(
        prereg={"path": PREREG_NAME, "sha": prereg_sha(path) if path.exists() else ""},
        code=code or {},
        sources=[name for name, _ in sources],
        rules={
            "difference": {k: r.minimum for k, r in RULES.items() if r.kind == "difference"},
            "ratio": {
                k: {"ratio": r.minimum, "floor": r.floor}
                for k, r in RULES.items()
                if r.kind == "ratio"
            },
            "tie": "a tie unless every seed agrees and the difference reaches the minimum effect",
        },
        outcome=decide(regimes),
        hypotheses=blocks,
        comparisons=sorted(
            comparisons,
            key=lambda c: (
                c.source,
                c.task,
                c.profile,
                c.axis or "",
                c.value or 0,
                c.rival,
                c.hypothesis,
            ),
        ),
        regimes=regimes,
        per_process=per_process(sources),
        false_deaths=false_deaths_of(sources),
        tally=total,
    )


def verdicts(paths: Sequence[Path], prereg: Path | None = None) -> Honesty:
    sources: list[tuple[str, list[dict[str, Any]]]] = []
    for path in paths:
        sources += read_rows(path)
    if not sources:
        raise ValueError(f"no results found under {', '.join(str(p) for p in paths)}")
    return evaluate(sources, prereg, code_version())


def write_json(honesty: Honesty, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(honesty.model_dump(mode="json"), indent=2) + "\n", encoding="utf-8")


# -- text ------------------------------------------------------------------------------------


def _num(x: float | None, digits: int = 2) -> str:
    return "-" if x is None else f"{x:.{digits}f}"


def _gate_lines(comparisons: Sequence[Comparison]) -> list[str]:
    """H1-H6 at the gate for each source, task and rival: the verdict, then the swarm's and the
    rival's value (means over the seeds that count). ``*`` marks a tie in which the seeds
    disagree."""
    gate = [c for c in comparisons if c.axis is None]
    out: list[str] = []
    for source, task in sorted({(c.source, c.task) for c in gate}):
        for rival in RIVALS:
            found = {
                (c.hypothesis, c.profile): c
                for c in gate
                if (c.source, c.task, c.rival) == (source, task, rival)
            }
            profiles = sorted({profile for _, profile in found})
            if not profiles:
                continue
            out.append(f"  {source}, {task}: swarm against {rival}, verdict (swarm / {rival})")
            for h in HYPOTHESES:
                cells = []
                for profile in profiles:
                    c = found.get((h.id, profile))
                    if c is None:
                        cells.append(f"{profile} -")
                        continue
                    shown = f"{c.verdict}{'*' if c.mixed else ''}"
                    cells.append(f"{profile} {shown:<6}({_num(c.swarm)} / {_num(c.rival_value)})")
                out.append(f"    {h.id:<4} {h.metric:<26} " + "  ".join(cells))
    return out


def _false_death_lines(found: Sequence[FalseDeaths]) -> list[str]:
    """The swarm's false deaths at each point, next to the supervisors' (none by construction)."""
    points: dict[tuple, dict[str, FalseDeaths]] = defaultdict(dict)
    for f in found:
        points[(f.source, f.axis, f.value, f.task, f.profile)][f.workflow] = f
    out = []
    for (source, axis, setting, task, profile), by_workflow in points.items():
        swarm = by_workflow.get(SWARM)
        if swarm is None or swarm.remaps_mean is None:
            continue
        rivals = [f.remaps_max or 0 for name, f in by_workflow.items() if name != SWARM]
        out.append(
            f"  {source:<22} {where(axis, setting):<24} {task[:2]} {profile:<3} "
            f"swarm {swarm.remaps_mean:.2f} per run (most {swarm.remaps_max}, {swarm.runs} runs), "
            f"${swarm.spent_usd_mean or 0:.4f} paid twice; supervisors "
            + (f"most {max(rivals)}" if rivals else "-")
        )
    return out


def render_text(honesty: Honesty) -> str:
    commit = honesty.code.get("commit")
    out = [
        f"Verdicts under {honesty.prereg['path']} (sha {honesty.prereg['sha'] or 'missing'}); "
        f"sources: {', '.join(honesty.sources)}",
        f"Code: {commit[:12] if commit else 'unknown'}"
        + (", with uncommitted changes" if honesty.code.get("dirty") else ""),
        "Every verdict is the swarm's: win = better by the minimum effect on every seed.",
        "",
    ]
    outcome = honesty.outcome
    out.append(f"Outcome {outcome.label.upper()} (read against {outcome.against}, {DECIDING_TASK})")

    def shown(point: dict[str, Any]) -> str:
        return ratio_text(point["cdt_ratio"], point["blast_ratio"], point["idle_ratio"])

    out += [f"  gate {g['profile']}: locality {g['locality']}; {shown(g)}" for g in outcome.gate]
    out += [
        f"  {where(p['axis'], p['value'])}: locality {p['locality']}; {shown(p)}"
        for p in outcome.plausible
    ]
    out += [f"  condition: {c}" for c in outcome.conditions]
    out += ["", "Hypotheses: swarm wins / ties / losses (n/a) against each rival"]
    for block in honesty.hypotheses:
        out.append(f"  {block.id:<4} {block.name}  [{block.metric}; expected: {block.expected}]")
        for rival, t in block.tally.items():
            if t.win + t.tie + t.loss + t.na:
                out.append(
                    f"       vs {rival:<12} {t.win:>3} / {t.tie:>3} / {t.loss:>3}   ({t.na} n/a)"
                )
    gate = _gate_lines(honesty.comparisons)
    if gate:
        out += ["", "The gate, default assumptions, by task and rival"] + gate
    out += [
        "",
        "Regime map: locality of the swarm against each rival (the verdict is PREREG 4's; the "
        "ratios are swarm / rival\n  of the seed means, descriptive, and no verdict)",
    ]
    for r in honesty.regimes:
        flag = "*" if r.plausible else " "
        head = f" {flag}{r.source:<22} {where(r.axis, r.value):<24} {r.task[:2]} {r.profile:<3}"
        ratios = f"cdt {_num(r.cdt_ratio)}  blast {_num(r.blast_ratio)}  idle {_num(r.idle_ratio)}"
        out.append(f"{head} vs {r.rival:<11} {r.locality:<6} {ratios}")
    out.append("  (* in the plausible region)")
    lines = _false_death_lines(honesty.false_deaths)
    if lines:
        out += [
            "",
            "False deaths: live coordinators a detector gave away (the supervisors have none)",
        ]
        out += lines
    for view in honesty.per_process:
        out += ["", f"Per process, {view.task}: expected impact per hour = rate x sum over levels"]
        for lv in view.swarm_levels:
            shown = ", ".join(f"{k} {_num(v)}" for k, v in lv.impact.items())
            out.append(
                f"  swarm level {lv.level} x{lv.count} ({', '.join(lv.targets) or 'no probe'}; "
                f"{lv.runs} runs, {lv.skipped} skipped): {shown}"
            )
        out.append(
            "  swarm expected: "
            + ", ".join(f"{k} {_num(v)}" for k, v in view.swarm_expected.items())
        )
        for rival, impact in view.rivals.items():
            out.append(
                f"  {rival} (one o0): " + ", ".join(f"{k} {_num(v)}" for k, v in impact.items())
            )
            ratios = ", ".join(
                f"{k} {_num(view.ratio[rival][k])} ({view.reading[rival][k]})" for k in IMPACTS
            )
            out.append(f"    ratio swarm / {rival}: {ratios}")
    return "\n".join(out)
