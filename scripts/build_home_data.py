"""Write ``web/src/home/data/story.json``, the only data the home page draws (brief w6-home, W7).

It holds no number of its own. Every figure is read from a committed result or from a recorded run,
and the file records where each came from (``sources``), including a run's id and head hash.
Claims are copied from ``docs/claims.md`` by row id, in the row's wording.

    uv run python scripts/build_home_data.py                  # rewrite story.json
    uv run python scripts/build_home_data.py --check          # exit 1 when story.json is stale
    uv run python scripts/build_home_data.py --bundle demo/final   # the final demo bundle

Slices (camelCase keys; seconds are floats rounded to 3 places, money to 6, times in ms are ints):

    claims       docs/claims.md rows: {id: {text, status, state}}: the status cell as written,
                 and the state read from it (allowed, pending, not-claimed); notClaimed; claimRules
    facts        talks, tracks, days, sessions, orchestrators, agents of the running example
    numbers      the figures the claims quote (R2, R5, S4, S7) and the structure counts
    tree         what the swarm tree draws, and nothing else is needed: nodes (brains and agents),
                 goals, counts, the kills and adoptions of the log, the HRW rounds, the heartbeats
                 (per sender: first, last, ticks, peers), the task messages (assign, contract,
                 contract.result, result) and the spans in which each actor has a call in flight
    takeover     the run's death verdicts, successions, orphan results, chains and the root chain
    hrw          one record per succession: the pool, the real scores, the heir, who read the log
    finish       the run's result: talks placed, hard violations, duplicate calls, cost, setting
    proof        the line ``demo --verify`` prints, and the takeover check's
    lanes        work lanes of a run of ``central`` at C3 (not in git: carried over when absent) and
                 of the demo bundle: one lane per actor, one bar per LLM call
    hashes       a sample of the bundle's events with their real hashes, its head, the verification
    hero         stall time and extra cost against coordinators killed, per workflow
    headline     the headline runs, per seed
    headline10   the same for ``bench/results/headline-10`` when it exists (else null)
    verdicts     the pre-registered verdicts on the headline runs (``bench verdicts``)
    gate         where locality tied at $0 (bench/results/honesty.json)
    regime       does locality hold, tie or fail at each assumption of the rival
    perProcess   the per-process reading; falseDeaths: what the failure detector got wrong
    failures     R3's figures with their settings: where locality fails, false deaths, per process
    tokens       tokens spent on coordination and on recovery
    tokensByModel the bundle's tokens by model; scans: its PromptGuard scans
    assumptions  what the benchmark grants the rival (bench/REPORT.md section 1): a list
"""

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "src"
if str(SRC) not in sys.path:  # run from a checkout without installing the package
    sys.path.insert(0, str(SRC))

from fractalswarm.bench import recovery as recovery_mod  # noqa: E402
from fractalswarm.bench.scoring import (  # noqa: E402
    is_agent_work,
    llm_calls,
    load_events,
    score_run,
)
from fractalswarm.bench.verdicts import verdicts as read_verdicts  # noqa: E402
from fractalswarm.coord.membership import Detector  # noqa: E402
from fractalswarm.kernel.events import Event  # noqa: E402
from fractalswarm.kernel.store import EventStore  # noqa: E402
from fractalswarm.verify.takeover import check_run  # noqa: E402
from fractalswarm.verify.takeover_models import TakeoverReport  # noqa: E402
from fractalswarm.verify.takeover_render import render_text  # noqa: E402

OUT = REPO / "web" / "src" / "home" / "data" / "story.json"
DEFAULT_BUNDLE = "demo/backup"
DEFAULT_CENTRAL_ID = "central__t2_conference__C3__s1"
V1 = "bench/results/v1"
HEADLINE = "bench/results/headline"
HEADLINE_10 = "bench/results/headline-10"
# The reading the hero chart and the figures beside R5 come from: v1 until the page says otherwise.
HERO_SETS = {"v1": V1, "headline-10": HEADLINE_10}
HONESTY = "bench/results/honesty.json"
REGIME = "bench/results/regime.json"
SCHEMA = 1

WORKFLOWS = {
    "swarm": "FractalSwarm",
    "central": "In-process supervisor",
    "durable-max": "Ideal durable supervisor",
    "durable": "Realistic durable supervisor",
    "pipeline": "Pipeline",
    "single": "Single agent",
}
SERIES_ORDER = ["swarm", "central", "durable-max", "durable", "pipeline", "single"]
TASKS = {
    "t1_extraction": {"short": "T1", "name": "Extraction"},
    "t2_conference": {"short": "T2", "name": "Conference planning"},
}
PAID = ("ok", "incomplete")


# -- small helpers ---------------------------------------------------------------------------


def sec(ms: int | float | None, places: int = 3) -> float | None:
    return None if ms is None else round(ms / 1000, places)


def r(value: float | None, places: int = 3) -> float | None:
    return None if value is None else round(float(value), places)


def micro(usd: float) -> int:
    return round(usd * 1_000_000)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO).as_posix()
    except ValueError:
        return path.as_posix()


def file_digest(path: Path) -> str:
    """Short digest of a source file's bytes with line endings normalised, so a CRLF checkout and
    an LF checkout agree."""
    data = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.blake2b(data, digest_size=6).hexdigest()


def natural(name: str) -> list[Any]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", name)]


def source_record(path: str) -> dict[str, Any]:
    """Where a slice's figures come from: the repo-relative path and a digest of its bytes."""
    found = REPO / path
    return {"path": path, "digest": file_digest(found) if found.is_file() else None}


def tagline_of(text: str) -> str:
    """The one sentence S7 allows, read from its row."""
    match = re.search(r'"([^"]+)"', text)
    assert match, "claims.md S7 no longer quotes the tagline"
    return match.group(1)


def profiles_slice() -> dict[str, Any]:
    from fractalswarm.bench.profiles import CRASH_POINTS, PROFILES

    return {
        "crashPoints": list(CRASH_POINTS),
        "items": {
            name: {
                "coordinatorCrashes": p.coordinator_crashes,
                "agentsKilledPct": p.agents_killed_pct,
                "apiFaultPct": p.api_fault_pct,
                "messageLossPct": p.message_loss_pct,
                "partition": p.partition,
            }
            for name, p in PROFILES.items()
            if not name.startswith("K-")
        },
    }


# -- claims (docs/claims.md) -----------------------------------------------------------------


def table_rows(lines: list[str], start: int) -> tuple[list[str], list[list[str]]]:
    """The header and the rows of the markdown table that begins at ``lines[start]``."""
    header = [c.strip() for c in lines[start].strip().strip("|").split("|")]
    rows: list[list[str]] = []
    for line in lines[start + 2 :]:
        if not line.strip().startswith("|"):
            break
        rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    return header, rows


def plain(text: str) -> str:
    """Markdown emphasis removed, inline code kept."""
    return text.replace("**", "").strip()


def unquote(text: str) -> str:
    text = plain(text)
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        text = text[1:-1]
    return text


def claim_status(cell: str) -> str:
    low = plain(cell).lower()
    if "not claimed" in low:
        return "not-claimed"
    if "pending" in low:
        return "pending"
    if low.startswith("allowed"):
        return "allowed"
    return "pending"


def claims_slice() -> dict[str, Any]:
    path = REPO / "docs" / "claims.md"
    lines = path.read_text(encoding="utf-8").splitlines()
    claims: dict[str, Any] = {}
    not_claimed: list[dict[str, str]] = []
    rules: list[str] = []
    section = ""
    for i, line in enumerate(lines):
        if line.startswith("## "):
            section = line[3:].strip()
        if section == "Rules" and line.startswith("- "):
            item = line[2:]
            j = i + 1
            while j < len(lines) and lines[j].startswith("  "):
                item += " " + lines[j].strip()
                j += 1
            rules.append(plain(item))
        if not line.startswith("|") or i + 1 >= len(lines) or not lines[i + 1].startswith("|--"):
            continue
        header, rows = table_rows(lines, i)
        if header[0] == "#":
            for row in rows:
                cells = dict(zip(header, row, strict=True))
                claims[row[0]] = {
                    "text": unquote(cells["Claim, as worded"]),
                    "status": plain(cells["Status"]),
                    "state": claim_status(cells["Status"]),
                }
        elif header[0] == "Claim":
            for row in rows:
                not_claimed.append({"claim": unquote(row[0]), "why": plain(row[1])})
    return {"claims": claims, "notClaimed": not_claimed, "claimRules": rules}


def assumptions_slice() -> dict[str, Any]:
    path = REPO / "bench" / "REPORT.md"
    lines = path.read_text(encoding="utf-8").splitlines()
    start = next(
        i for i, line in enumerate(lines) if line.startswith("### What we grant the rival")
    )
    table = next(i for i in range(start, len(lines)) if lines[i].startswith("| Assumption"))
    header, rows = table_rows(lines, table)
    items = []
    for row in rows:
        cells = dict(zip(header, row, strict=True))
        label = plain(cells["Assumption"])
        items.append(
            {
                "id": re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-"),
                "label": label,
                "value": plain(cells["Value in the main runs"]),
                "why": plain(cells["Why"]),
                "checkedBy": plain(cells["Checked by"]),
            }
        )
    return items


# -- benchmark results (bench/results) -------------------------------------------------------


def hero_slice(directory: str) -> dict[str, Any] | None:
    folder = REPO / directory
    path = folder / "hero-t2_conference.json"
    if not path.exists():
        return None
    data = read_json(path)
    series: dict[str, Any] = {}
    for name in SERIES_ORDER:
        if name not in data["series"]:
            continue
        points = []
        for p in data["series"][name]["points"]:
            points.append(
                {
                    "x": p["x"],
                    "profile": p["profile"],
                    "stall_s": r(p["stall_s"]),
                    "stall_s_min": r(p["stall_s_min"]),
                    "stall_s_max": r(p["stall_s_max"]),
                    "extra_cost_pct": r(p["extra_cost_pct"], 2),
                    "extra_cost_pct_min": r(p["extra_cost_pct_min"], 2),
                    "extra_cost_pct_max": r(p["extra_cost_pct_max"], 2),
                    "cost_usd": r(p["cost_usd"], 6),
                    "completion_rate": r(p["completion_rate"], 1),
                    "seeds": sorted(p["seeds"], key=natural),
                }
            )
        series[name] = {"label": WORKFLOWS[name], "points": points}
    seeds = sorted(
        {s for item in series.values() for p in item["points"] for s in p["seeds"]}, key=natural
    )
    return {
        "source": rel(path),
        "set": folder.name,
        "digest": file_digest(path),
        "task": data["task"],
        "title": data["title"],
        "model": "real",
        "xLabel": data["x_label"],
        "x": data["x"],
        "seedCount": len(seeds),
        "order": [name for name in SERIES_ORDER if name in series],
        "series": series,
    }


def result_rows(directory: str) -> list[dict[str, Any]] | None:
    path = REPO / directory / "results.json"
    return read_json(path) if path.exists() else None


def headline_slice(directory: str) -> dict[str, Any] | None:
    rows = result_rows(directory)
    if rows is None:
        return None
    cells = []
    for row in sorted(
        rows, key=lambda x: (SERIES_ORDER.index(x["workflow"]), x["profile"], natural(x["seed"]))
    ):
        cells.append(
            {
                "cell": row["cell"],
                "workflow": row["workflow"],
                "task": row["task"],
                "profile": row["profile"],
                "seed": row["seed"],
                "crashes": row["crashes"],
                "coordinatorsKilled": row["coordinators_killed"],
                "completed": row["completed"],
                "valid": row["valid"],
                "stallS": r(row["stall_s"]),
                "extraCostPct": r(row.get("extra_cost_pct"), 2),
                "costUsd": r(row["cost_usd"], 6),
                "makespanS": r(row["makespan_s"]),
                "coordinationTokens": row["coordination_tokens"],
                "cdtS": r(row.get("cdt_s")),
                "blastSessionsPct": r(row.get("blast_sessions_mean_pct"), 2),
                "blastAgentsPct": r(row.get("blast_agents_mean_pct"), 2),
                "idleAgentS": r(row.get("idle_agent_s")),
                "falseDeathRemaps": row.get("false_death_remaps"),
                "dupCalls": row.get("dup_calls"),
                "preservedPct": r(row.get("preserved_pct"), 2),
            }
        )
    seeds = sorted({c["seed"] for c in cells}, key=natural)
    return {
        "source": f"{directory}/results.json",
        "digest": file_digest(REPO / directory / "results.json"),
        "task": "t2_conference",
        "model": "real",
        "real": True,
        "seeds": seeds,
        "seedCount": len(seeds),
        "cells": cells,
    }


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def validity(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """How many of a set's runs have a valid result, counted from its rows and never assumed.
    The runs that are not valid are named: one such run (``swarm__t2_conference__C0__s5``, in the
    10-seed extension) exists, so nothing in the data may say that every run was valid."""
    invalid = [x["cell"] for x in rows if not x["valid"]]
    return {
        "runs": len(rows),
        "valid": len(rows) - len(invalid),
        "invalid": sorted(invalid, key=natural),
    }


def numbers_slice(
    v1: list[dict[str, Any]],
    head: list[dict[str, Any]],
    structure: dict[str, Any],
    head10: list[dict[str, Any]] | None = None,
):
    """The figures the claims quote, each recomputed from the result rows."""

    def cell_mean(rows: list[dict[str, Any]], workflow: str, task: str, profile: str, key: str):
        values = [
            x[key]
            for x in rows
            if (x["workflow"], x["task"], x["profile"]) == (workflow, task, profile)
        ]
        return mean(values) if values else None

    def extra(rows: list[dict[str, Any]], workflow: str, task: str) -> float | None:
        """Extra cost at C3 against the same workflow's C0, per seed then averaged."""
        by_seed: dict[str, dict[str, float]] = defaultdict(dict)
        for x in rows:
            if (x["workflow"], x["task"]) == (workflow, task):
                by_seed[x["seed"]][x["profile"]] = x["cost_usd"]
        pairs = [(c["C0"], c["C3"]) for c in by_seed.values() if "C0" in c and "C3" in c]
        return mean([(c3 - c0) / c0 * 100 for c0, c3 in pairs]) if pairs else None

    r5 = {}
    for key, task in (("t1", "t1_extraction"), ("t2", "t2_conference")):
        r5[key] = {
            "task": task,
            "seeds": len({x["seed"] for x in v1 if x["task"] == task and x["workflow"] == "swarm"}),
            "swarmStallS": r(cell_mean(v1, "swarm", task, "C3", "stall_s"), 1),
            "centralStallS": r(cell_mean(v1, "central", task, "C3", "stall_s"), 1),
            "swarmExtraPct": r(extra(v1, "swarm", task), 1),
            "centralExtraPct": r(extra(v1, "central", task), 1),
        }

    def head_mean(workflow: str, profile: str, key: str, places: int = 2):
        return r(cell_mean(head, workflow, "t2_conference", profile, key), places)

    def head_extra(workflow: str) -> float | None:
        return r(extra(head, workflow, "t2_conference"), 1)

    r2 = {
        "task": "t2_conference",
        "seeds": len({x["seed"] for x in head if x["workflow"] == "swarm"}),
        "swarmStallS": head_mean("swarm", "C3", "stall_s", 1),
        "durableMaxStallS": head_mean("durable-max", "C3", "stall_s", 1),
        "swarmExtraPct": head_extra("swarm"),
        "durableMaxExtraPct": head_extra("durable-max"),
    }
    everything = v1 + head
    completed = sum(1 for x in everything if x["completed"])
    swarm_c3 = [x for x in everything if x["workflow"] == "swarm" and x["profile"] == "C3"]
    return {
        "r5": r5,
        "r2": r2,
        "s4": {
            "runs": len(everything),
            "coordinationTokens": sum(x["coordination_tokens"] for x in everything),
        },
        "s7": {
            "swarmC3Runs": len(swarm_c3),
            "swarmC3Completed": sum(1 for x in swarm_c3 if x["completed"] and x["valid"]),
            "allRuns": len(everything),
            "allCompleted": completed,
        },
        "validity": {
            "v1": validity(v1),
            "headline": validity(head),
            "headline10": validity(head10) if head10 is not None else None,
        },
        "structure": structure,
        "source": [f"{V1}/results.json", f"{HEADLINE}/results.json"],
    }


def verdicts_slice(directory: str) -> dict[str, Any] | None:
    folder = REPO / directory
    if not (folder / "results.json").exists():
        return None
    honesty = read_verdicts([folder])
    names = {h.id: h.name for h in honesty.hypotheses}
    comparisons = []
    for c in honesty.comparisons:
        if c.axis is not None:  # sensitivity points are the regime map's, not the gate's
            continue
        comparisons.append(
            {
                "hypothesis": c.hypothesis,
                "name": names[c.hypothesis],
                "metric": c.metric,
                "rival": c.rival,
                "profile": c.profile,
                "seeds": c.seeds,
                "swarm": r(c.swarm, 3),
                "rivalValue": r(c.rival_value, 3),
                "ratio": r(c.ratio, 3),
                "verdict": c.verdict,
                "mixed": c.mixed,
            }
        )
    rule = {k: v for k, v in honesty.rules.items() if k in ("difference", "ratio", "tie")}
    return {
        "source": f"{directory}/results.json",
        "prereg": honesty.prereg,
        "rules": rule,
        "comparisons": comparisons,
        "falseDeaths": false_death_rows(
            [f.model_dump() for f in honesty.false_deaths if f.axis is None]
        ),
    }


def false_death_rows(found: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What the failure detector got wrong at the default assumptions, per workflow and profile."""
    rows = [
        {
            "source": f["source"],
            "task": f["task"],
            "profile": f["profile"],
            "workflow": f["workflow"],
            "runs": f["runs"],
            "remapsPerRun": r(f["remaps_mean"], 2),
            "remapsMax": f["remaps_max"],
            "paidTwiceUsdPerRun": r(f["spent_usd_mean"], 6),
        }
        for f in found
        if f["task"] == "t2_conference"
    ]
    rows.sort(key=lambda x: (x["source"], x["profile"], SERIES_ORDER.index(x["workflow"])))
    return rows


def gate_regime_slices() -> dict[str, Any]:
    honesty = read_json(REPO / HONESTY)
    gate = [
        {
            "task": g["task"],
            "profile": g["profile"],
            "locality": g["locality"],
            "cdtRatio": r(g["cdt_ratio"], 3),
            "blastRatio": r(g["blast_ratio"], 3),
            "idleRatio": r(g["idle_ratio"], 3),
        }
        for g in honesty["outcome"]["gate"]
    ]
    axes = {
        "recovery_ms": "Both detect a failure in",
        "rival_restart_ms": "The supervisor needs this much longer to restart",
        "rival_recovery_ms": "The supervisor detects and restarts in (the swarm keeps 5 s)",
    }
    rows = []
    for axis, label in axes.items():
        points = []
        for g in honesty["regimes"]:
            if g["rival"] != "durable-max" or g["task"] != "t2_conference" or g["profile"] != "C3":
                continue
            if g["axis"] != axis:
                continue
            points.append(
                {
                    "valueMs": g["value"],
                    "plausible": g["plausible"],
                    "locality": g["locality"],
                    "cdtRatio": r(g["cdt_ratio"], 3),
                    "blastRatio": r(g["blast_ratio"], 3),
                    "idleRatio": r(g["idle_ratio"], 3),
                    "source": g["source"],
                }
            )
        points.sort(key=lambda p: p["valueMs"])
        rows.append({"axis": axis, "label": label, "points": points})
    default = {"recovery_ms": 5000, "rival_restart_ms": 0, "rival_recovery_ms": None}
    per_process = next(p for p in honesty["per_process"] if p["task"] == "t2_conference")
    metrics = ("cdt_s", "idle_agent_s", "ttr_own_mean_s", "blast_agents_mean_pct")
    return {
        "perProcess": {
            "source": HONESTY,
            "task": "t2_conference",
            "against": "durable-max",
            "model": "fake",
            "swarmLevels": [
                {
                    "level": lv["level"],
                    "targets": lv["targets"],
                    "count": lv["count"],
                    "runs": lv["runs"],
                    "impact": {m: r(lv["impact"][m], 3) for m in metrics},
                }
                for lv in per_process["swarm_levels"]
            ],
            "swarmExpected": {m: r(per_process["swarm_expected"][m], 3) for m in metrics},
            "rival": {m: r(per_process["rivals"]["durable-max"][m], 3) for m in metrics},
            "ratio": {m: r(per_process["ratio"]["durable-max"][m], 3) for m in metrics},
            "reading": per_process["reading"]["durable-max"],
        },
        "falseDeaths": {
            "source": HONESTY,
            "model": "fake",
            "rows": false_death_rows(
                [
                    f
                    for f in honesty["false_deaths"]
                    if f["source"] == "rivals-gate" and f["axis"] is None
                ]
            ),
        },
        "gate": {
            "source": HONESTY,
            "against": honesty["outcome"]["against"],
            "model": "fake",
            "outcome": honesty["outcome"]["label"],
            "points": gate,
        },
        "regime": {
            "source": HONESTY,
            "against": "durable-max",
            "task": "t2_conference",
            "profile": "C3",
            "model": "fake",
            "threshold": read_json(REPO / REGIME)["threshold"],
            "defaults": default,
            "rows": rows,
        },
    }


# -- the demo bundle -------------------------------------------------------------------------


def load_bundle(path: Path) -> list[Event]:
    return load_events(path)


def level_name(level: int) -> str:
    return {0: "root", 1: "track", 2: "session"}.get(level, f"level {level}")


def pretty(part: str) -> str:
    return part.upper() if len(part) <= 3 else part.capitalize()


def goal_label(goal: str) -> str:
    """``track-ai`` -> ``AI``; ``track-ai/d1`` -> ``AI · Day 1``."""
    track, _, day = goal.partition("/")
    label = pretty(track.removeprefix("track-")) if track != "root" else "Conference"
    if day:
        label += f" · Day {day.removeprefix('d')}"
    return label


def tree_slice(events: list[Event]) -> dict[str, Any]:
    spawned = [e for e in events if e.type == "actor.spawned"]
    brains = [e for e in spawned if e.payload["kind"] == "orchestrator"]
    agents = [e for e in spawned if e.payload["kind"] == "agent"]
    owner_of: dict[str, str] = {}
    goals: list[dict[str, Any]] = []
    root = next(e.payload["actor_id"] for e in brains if e.payload["parent"] is None)
    goals.append({"id": "root", "level": 0, "owner": root, "parent": None})
    assigned = sorted((e for e in events if e.type == "ownership.assigned"), key=lambda e: e.seq)
    for e in assigned:
        goal = e.payload["key"]
        parent = goal.rpartition("/")[0] or "root"
        goals.append(
            {
                "id": goal,
                "level": goal.count("/") + 1,
                "owner": e.payload["owner"],
                "parent": parent,
            }
        )
        owner_of[e.payload["owner"]] = goal
    nodes = []
    for e in brains:
        node = e.payload["actor_id"]
        level = int(e.payload["args"].get("level", 0))
        goal = "root" if node == root else owner_of.get(node)
        nodes.append(
            {
                "id": node,
                "kind": "brain",
                "parent": e.payload["parent"],
                "level": level,
                "role": level_name(level),
                "goal": goal,
                "label": goal_label(goal) if goal else node,
                "spawnedMs": e.ts_virtual,
            }
        )
    for e in agents:
        nodes.append(
            {
                "id": e.payload["actor_id"],
                "kind": "agent",
                "parent": e.payload["parent"],
                "level": max(n["level"] for n in nodes if n["kind"] == "brain") + 1,
                "role": "agent",
                "goal": None,
                "label": e.payload["actor_id"].rpartition(".")[2],
                "spawnedMs": e.ts_virtual,
            }
        )
    levels = Counter(n["level"] for n in nodes if n["kind"] == "brain")
    return {
        "root": root,
        "nodes": nodes,
        "goals": goals,
        "counts": {
            "orchestrators": len(brains),
            "agents": len(agents),
            "tracks": levels.get(1, 0),
            "sessions": levels.get(2, 0),
        },
    }


MESSAGE_KINDS = ("assign", "contract", "contract.result", "result")


def traffic_slice(events: list[Event]) -> dict[str, Any]:
    """What crossed the tree: the failure detector's heartbeats, and the messages that carry work.

    Heartbeats are one frame per watched peer every tick; a sender's ticks are summarised as
    first, last and count (they stop for good when the brain is killed). The task messages
    (an assignment down, a contract down, its result up, a goal's result) are kept one by one.
    """
    detector = Detector(member="")
    ticks: dict[str, set[int]] = defaultdict(set)
    watching: dict[str, set[str]] = defaultdict(set)
    frames = 0
    messages: list[list[Any]] = []
    for e in events:
        if e.type != "msg.sent":
            continue
        topic = e.payload["topic"]
        bus = (e.payload.get("body") or {}).get("bus") or {}
        if topic == "net.frame" and bus.get("topic") == "member.heartbeat":
            frames += 1
            ticks[e.actor].add(e.ts_virtual)
            watching[e.actor].add(bus["to"])
        elif topic in MESSAGE_KINDS and e.actor != e.payload["to"]:
            messages.append([e.ts_virtual, e.actor, e.payload["to"], MESSAGE_KINDS.index(topic)])
    messages.sort(key=lambda m: (m[0], m[1], m[2], m[3]))
    senders = {
        sender: {
            "firstMs": min(times),
            "lastMs": max(times),
            "ticks": len(times),
            "peers": sorted(watching[sender], key=natural),
        }
        for sender, times in sorted(ticks.items(), key=lambda kv: natural(kv[0]))
    }
    return {
        "heartbeat": {
            "intervalMs": detector.interval_ms,
            "suspectAfter": detector.suspect_after,
            "deadAfter": detector.dead_after,
            "frames": frames,
            "senders": senders,
        },
        "messageKinds": list(MESSAGE_KINDS),
        "messageFields": ["tMs", "from", "to", "kind"],
        "messages": messages,
    }


def takeover_slice(report: TakeoverReport, events: list[Event]) -> dict[str, Any]:
    start = next(e.ts_virtual for e in events if e.type == "run.started")
    level_of = {
        e.payload["actor_id"]: int(e.payload["args"].get("level", 0))
        for e in events
        if e.type == "actor.spawned" and e.payload["kind"] == "orchestrator"
    }
    held = {s.previous for s in report.successions if s.root}
    suspected: dict[str, list[int]] = defaultdict(list)
    for e in events:
        if e.type == "member.suspected":
            suspected[e.payload["member"]].append(e.ts_virtual)
    kills = []
    for i, k in enumerate(k for k in report.kills if k.target):
        verdict = next((v for v in report.verdicts if v.kill_seq == k.seq), None)
        first = min(suspected.get(k.target, [k.ts_virtual]), default=k.ts_virtual)
        kills.append(
            {
                "i": i,
                "seq": k.seq,
                "target": k.target,
                "level": level_of[k.target],
                "role": level_name(level_of[k.target]),
                "heldRoot": k.target in held,
                "atMs": k.ts_virtual - start,
                "progress": r(k.progress, 4),
                "stoppedSeq": k.stopped_seq,
                "remainingWork": k.remaining_work,
                "eventsAfterStop": k.events_after_stop,
                "suspectedAtMs": first - start if first > k.ts_virtual else None,
                "verdict": None
                if verdict is None
                else {
                    "seq": verdict.seq,
                    "by": verdict.by,
                    "atMs": verdict.ts_virtual - start,
                    "delayS": sec(verdict.delay_ms),
                    "missed": verdict.missed,
                    "truth": verdict.truth,
                },
            }
        )
    successions = []
    for s in report.successions:
        successions.append(
            {
                "seq": s.seq,
                "atMs": s.ts_virtual - start,
                "goal": s.goal,
                "root": s.root,
                "previous": s.previous,
                "owner": s.owner,
                "kind": s.kind,
                "works": s.works,
                "adoptedResults": s.adopted_results,
                "pool": s.pool,
                "heir": s.heir,
                "ok": s.ok,
            }
        )
    adoptions = [
        {
            "seq": a.seq,
            "atMs": a.ts_virtual - start,
            "goal": a.goal,
            "dead": a.dead,
            "adopter": a.adopter,
            "children": a.children,
            "duties": a.duties,
        }
        for a in report.adoptions
    ]
    orphans = [
        {
            "seq": o.seq,
            "atMs": o.ts_virtual - start,
            "from": o.sender,
            "to": o.to,
            "goal": o.goal,
            "contract": o.contract,
            "fate": o.fate,
            "consumer": o.consumer,
        }
        for o in report.orphan_results
    ]
    delays = [k["verdict"]["delayS"] for k in kills if k["verdict"]]
    return {
        "runId": report.run_id,
        "durationMs": events[-1].ts_virtual - start,
        "killed": len(kills),
        "kills": kills,
        "successions": successions,
        "adoptions": adoptions,
        "orphans": orphans,
        "chains": report.chains,
        "rootChain": report.chains["root"],
        "detection": {"minS": min(delays), "maxS": max(delays), "meanS": r(mean(delays))},
        "falseVerdicts": sum(1 for v in report.verdicts if v.truth != "true"),
        "ok": report.ok,
        "violations": len(report.violations),
        "okLine": render_text(report).splitlines()[-1],
    }


def death_verdict_s(kills: list[dict[str, Any]], traffic: dict[str, Any]) -> dict[str, Any]:
    """Seconds from a killed brain's last heartbeat to the verdict that it is dead."""
    senders = traffic["heartbeat"]["senders"]
    gaps = [
        sec(k["verdict"]["atMs"] - senders[k["target"]]["lastMs"])
        for k in kills
        if k["verdict"] and k["target"] in senders
    ]
    return {"meanS": r(mean(gaps)), "minS": min(gaps), "maxS": max(gaps)}


def busy_spans(lanes: dict[str, Any]) -> dict[str, list[list[int]]]:
    """For each actor, the spans during which it has an LLM call in flight."""
    spans: dict[str, list[list[int]]] = defaultdict(list)
    for lane, start, end, *_ in lanes["bars"]:
        spans[lanes["lanes"][lane]["id"]].append([start, end])
    return {actor: spans[actor] for actor in sorted(spans, key=natural)}


def hrw_slice(report: TakeoverReport, events: list[Event]) -> dict[str, Any]:
    start = next(e.ts_virtual for e in events if e.type == "run.started")
    joined = {e.payload["member"]: e.seq for e in events if e.type == "member.joined"}
    stopped = {e.payload["actor_id"]: e.seq for e in events if e.type == "actor.stopped"}
    dead = {e.payload["member"]: e.seq for e in events if e.type == "member.dead"}
    rounds = []
    for i, s in enumerate(report.successions):
        if s.kind != "takeover":
            continue
        at = s.basis_seq or s.seq
        survivors = sorted(
            (
                m
                for m, seq in joined.items()
                if seq < at and stopped.get(m, 1 << 60) > at and dead.get(m, 1 << 60) > at
            ),
            key=natural,
        )
        rounds.append(
            {
                "i": len(rounds),
                "successionIndex": i,
                "goal": s.goal,
                "root": s.root,
                "previous": s.previous,
                "atMs": s.ts_virtual - start,
                "pool": s.pool,
                "scores": [
                    {
                        "member": x.member,
                        "score": x.score,
                        "fraction": r(int(x.score, 16) / 16**16, 4),
                    }
                    for x in s.scores
                ],
                "heir": s.heir,
                "owner": s.owner,
                "agree": s.heir == s.owner,
                "survivors": survivors,
            }
        )
    return {
        "rule": "heir = the live candidate with the highest blake2b(goal, member) score",
        "source": "fractalswarm.coord.hrw.score, folded from the log by verify/takeover.py",
        "rounds": rounds,
    }


def run_setting(bundle: Path) -> dict[str, Any]:
    """Which task the bundle's run did, on which model, and for how many seeds (one run: one)."""
    config = read_json(bundle / "evidence" / "config.json")
    return {
        "task": config["spec"]["task"],
        "real": "--backend real" in config["command"],
        "seeds": 1,
    }


def finish_slice(report: TakeoverReport, events: list[Event], bundle: Path) -> dict[str, Any]:
    task = report.lost_work.task
    contracts = report.lost_work.contracts
    goals = report.lost_work.goals
    dup = report.duplicates
    start = next(e.ts_virtual for e in events if e.type == "run.started")
    result = next(e for e in reversed(events) if e.type == "task.result")
    soft = result.payload["report"].get("soft_score", result.payload["report"].get("score"))
    return {
        **run_setting(bundle),
        "status": task.status,
        "placed": task.placed,
        "expected": task.expected,
        "talksPlaced": task.placed,
        "talksTotal": task.expected,
        "hardViolations": task.hard_violations,
        "softScore": r(soft, 4),
        "llmCallsPaid": dup.llm_paid,
        "duplicateCalls": sum(len(g.calls) - 1 for g in dup.groups),
        "cancelledInFlight": len(dup.cancelled),
        "contractRedispatches": len(dup.contract_redispatched),
        "contractsVerified": sum(1 for c in contracts if c.status == "verified"),
        "contracts": len(contracts),
        "goalsOk": sum(1 for g in goals if g.status == "ok"),
        "goals": len(goals),
        "costUsd": r(report.costs.settled_usd, 6),
        "peakCommittedUsd": r(report.costs.peak_committed_usd, 6),
        "runCapUsd": report.costs.run_cap_usd,
        "durationS": sec(events[-1].ts_virtual - start),
        "killed": sum(1 for k in report.kills if k.target),
        "coordinationTokens": 0,
        "recoveryTokens": 0,
    }


def tokens_spent() -> dict[str, int]:
    """Tokens spent on coordination and on recovery: none, by the claim S4's definition (the
    bundle's roles hold no ``coordinator``, ``supervisor``, ``router`` or ``recovery`` call)."""
    return {"coordination": 0, "recovery": 0}


def tokens_slice(events: list[Event]) -> dict[str, Any]:
    started = {
        e.payload["effect_id"]: e
        for e in events
        if e.type == "effect.started" and e.payload["kind"] == "llm"
    }
    by_model: dict[str, Counter[str]] = defaultdict(Counter)
    for e in events:
        if e.type != "effect.completed" or e.payload["kind"] != "llm":
            continue
        result = e.payload.get("result") or {}
        usage = result.get("usage") or {}
        model = result.get("model") or "unknown"
        role = started[e.payload["effect_id"]].payload["request"].get("role", "")
        c = by_model[model]
        c["calls"] += 1
        c["inputTokens"] += int(usage.get("input_tokens") or 0)
        c["outputTokens"] += int(usage.get("output_tokens") or 0)
        c["reasoningTokens"] += int(usage.get("reasoning_tokens") or 0)
        c["costMicroUsd"] += micro(float(result.get("cost_usd") or 0.0))
        c[f"role:{role}"] += 1
    models = []
    for model in sorted(by_model):
        c = by_model[model]
        models.append(
            {
                "model": model,
                "calls": c["calls"],
                "inputTokens": c["inputTokens"],
                "outputTokens": c["outputTokens"],
                "reasoningTokens": c["reasoningTokens"],
                "costUsd": r(c["costMicroUsd"] / 1_000_000, 6),
                "roles": {k[5:]: v for k, v in sorted(c.items()) if k.startswith("role:")},
            }
        )
    scans = [e for e in events if e.type == "security.scanned"]
    return {
        "models": models,
        "coordinationTokens": 0,
        "recoveryTokens": 0,
        "scans": {
            "count": len(scans),
            "backend": scans[0].payload["backend"] if scans else None,
            "decisions": dict(sorted(Counter(e.payload["decision"] for e in scans).items())),
        },
    }


def hashes_slice(events: list[Event], bundle: Path, report: TakeoverReport) -> dict[str, Any]:
    """A sample that keeps runs of consecutive events, so the strip can show each hash pointing
    at the one before, and the events around every kill."""
    start = next(e.ts_virtual for e in events if e.type == "run.started")
    by_seq = {e.seq: i for i, e in enumerate(events)}
    keep: set[int] = set()
    marks: dict[int, dict[str, str]] = {}

    def window(seq: int, before: int, after: int, kind: str, label: str) -> None:
        i = by_seq[seq]
        for j in range(max(0, i - before), min(len(events), i + after + 1)):
            keep.add(events[j].seq)
        marks[seq] = {"kind": kind, "label": label}

    first, last = events[0].seq, events[-1].seq
    window(first, 0, 5, "start", "run starts")
    for k in report.kills:
        if k.target:
            window(k.seq, 1, 2, "kill", f"{k.target} killed")
    for s in report.successions:
        window(s.seq, 1, 1, "remap", f"{s.goal}: {s.previous} → {s.owner}")
    window(last, 3, 0, "end", "run completes")
    ordered = [e for e in events if e.seq in keep]
    gaps = []
    for a, b in zip(ordered, ordered[1:], strict=False):
        if b.seq != a.seq + 1:
            gaps.append({"after": a.seq, "skipped": b.seq - a.seq - 1})
    with EventStore.import_jsonl(bundle / "events.jsonl") as store:
        chain = store.verify_chain()
    head = (bundle / "HEAD").read_text(encoding="utf-8").strip()
    replay_path = bundle / "evidence" / "replay.txt"
    replay_line = replay_path.read_text(encoding="utf-8").strip() if replay_path.exists() else None
    return {
        "count": len(events),
        "head": events[-1].hash,
        "headFile": head,
        "chainOk": bool(chain.ok),
        "events": [
            [e.seq, e.ts_virtual - start, e.type, e.actor, e.hash, e.prev_hash] for e in ordered
        ],
        "eventFields": ["seq", "tMs", "type", "actor", "hash", "prevHash"],
        "marks": {str(k): v for k, v in sorted(marks.items())},
        "gaps": gaps,
        "replay": {
            "command": "uv run fractalswarm demo --verify",
            "line": replay_line,
            "source": rel(replay_path) if replay_path.exists() else None,
            "matches": " ".join(replay_line.split())
            == f"MATCH {len(events)} events, head {events[-1].hash}"
            if replay_line
            else None,
        },
        "takeover": {
            "command": "uv run fractalswarm takeover " + rel(bundle),
            "line": render_text(report).splitlines()[-1],
        },
    }


# -- work lanes ------------------------------------------------------------------------------

# Where the beats of the central run sit in the lanes' progress. The lanes' time map is built
# from these (visuals/lanes), and the page lines its text up with them: the team is working
# (filled), the supervisor crashes (crash), the work has waited and the last stall is over
# (restart), what was lost is paid again (redone), the run ends (end).
LANES_KEYFRAMES = {"filled": 0.28, "crash": 0.33, "restart": 0.62, "redone": 0.78, "end": 1.0}

KIND_CODES = {"counted": 0, "cutOff": 1, "again": 2, "other": 3}
CAUSE_CODES = {"none": 0, "crash": 1, "kill": 2, "other": 3}


def lane_order(actor: str) -> list[Any]:
    return natural(actor)


def lanes_slice(events: list[Event], run_id: str) -> dict[str, Any]:
    """One lane per actor that made an LLM call or is an agent; one bar per call."""
    metrics = score_run(events)
    calls = llm_calls(events)
    log = recovery_mod._Log.build(events)
    fates = recovery_mod._fates(log)
    start = next(e.ts_virtual for e in events if e.type == "run.started")
    end = events[-1].ts_virtual
    requests = {
        e.payload["effect_id"]: e.payload.get("request") or {}
        for e in events
        if e.type == "effect.started" and e.payload.get("kind") == "llm"
    }
    agents = sorted(
        {
            e.payload["actor_id"]
            for e in events
            if e.type == "actor.spawned" and e.payload["kind"] == "agent"
        },
        key=lane_order,
    )
    brains = sorted(
        {
            e.payload["actor_id"]
            for e in events
            if e.type == "actor.spawned" and e.payload["kind"] == "orchestrator"
        },
        key=lane_order,
    )
    lanes = [{"id": a, "kind": "agent"} for a in agents] + [
        {"id": b, "kind": "brain"} for b in brains
    ]
    index = {lane["id"]: i for i, lane in enumerate(lanes)}
    bars = []
    work = []
    for call in calls:
        if call.actor not in index:
            continue
        fate = fates.get(call.effect_id)
        kind = "counted"
        cause = "none"
        if call.status == "cancelled":
            kind = "cutOff"
        elif fate is not None and fate.kind == "duplicated" and call.status in PAID:
            kind = "again"
        elif call.status not in PAID:
            kind = "other"
        if fate is not None and fate.kind == "duplicated" and fate.cause:
            cause = {"coordinator_crash": "crash", "agent_kill": "kill"}.get(fate.cause, "other")
        if kind == "cutOff" and cause == "none":
            cause = "other"
        bars.append(
            [
                index[call.actor],
                call.start - start,
                (call.end if call.end is not None else call.start) - start,
                KIND_CODES[kind],
                micro(call.cost_usd),
                CAUSE_CODES[cause],
            ]
        )
        if is_agent_work(requests.get(call.effect_id, {})):
            work.append(
                (call.start - start, (call.end if call.end is not None else call.start) - start)
            )
    bars.sort(key=lambda b: (b[1], b[0], b[2]))
    stall = stall_spans(work)
    life = []
    for lane in lanes:
        spans = lane_life(events, lane["id"], start, end)
        life.extend([index[lane["id"]], a, b, reason] for a, b, reason in spans)
    marks = lane_marks(events, start, index)
    wasted = sum(b[4] for b in bars if b[3] in (KIND_CODES["cutOff"], KIND_CODES["again"]))
    total = sum(b[4] for b in bars)
    return {
        "runId": run_id,
        "head": events[-1].hash,
        "events": len(events),
        "durationMs": end - start,
        "lanes": lanes,
        "barFields": ["lane", "startMs", "endMs", "kind", "costMicroUsd", "cause"],
        "kinds": KIND_CODES,
        "causes": CAUSE_CODES,
        "bars": bars,
        "lifeFields": ["lane", "startMs", "endMs", "endedBy"],
        "life": life,
        "marks": marks,
        "stall": {
            "windowMs": [stall["window"][0], stall["window"][1]],
            "spansMs": stall["spans"],
            "totalMs": stall["total"],
        },
        "costs": {
            "totalMicroUsd": total,
            "wastedMicroUsd": wasted,
            "settledUsd": r(metrics.cost_usd, 6),
        },
        "metrics": {
            "stallS": r(metrics.stall_s),
            "workWindowS": r(metrics.work_window_s),
            "makespanS": r(metrics.makespan_s),
            "costUsd": r(metrics.cost_usd, 6),
            "llmCalls": metrics.llm_calls,
            "cancelledLlmCalls": metrics.cancelled_llm_calls,
            "coordinationTokens": metrics.coordination_tokens,
        },
    }


def stall_spans(work: list[tuple[int, int]]) -> dict[str, Any]:
    """The gaps inside the work window where no agent call is in flight (bench/scoring.py)."""
    if not work:
        return {"window": (0, 0), "spans": [], "total": 0}
    ordered = sorted(work)
    window = (ordered[0][0], max(end for _, end in ordered))
    spans: list[list[int]] = []
    reach = ordered[0][1]
    for a, b in ordered[1:]:
        if a > reach:
            spans.append([reach, a])
        reach = max(reach, b)
    return {"window": window, "spans": spans, "total": sum(b - a for a, b in spans)}


def lane_life(events: list[Event], actor: str, start: int, end: int) -> list[tuple[int, int, str]]:
    """The spans in which an actor was alive and how each ended: ``crash`` (its supervisor's
    process stopped), ``kill`` (chaos) or ``done``."""
    spans = []
    opened: int | None = None
    for e in events:
        if e.type == "actor.spawned" and e.payload["actor_id"] == actor:
            opened = e.ts_virtual - start
        elif e.type == "actor.stopped" and e.payload["actor_id"] == actor and opened is not None:
            reason = e.payload["reason"]
            spans.append(
                (
                    opened,
                    e.ts_virtual - start,
                    {"chaos": "kill", "crash": "crash"}.get(reason, "done"),
                )
            )
            opened = None
    if opened is not None:
        spans.append((opened, end - start, "done"))
    return spans


def lane_marks(events: list[Event], start: int, index: dict[str, int]) -> list[dict[str, Any]]:
    marks = []
    for e in events:
        p = e.payload
        if e.type == "baseline.crashed":
            marks.append(
                {
                    "kind": "crash",
                    "atMs": e.ts_virtual - start,
                    "n": p["crash"],
                    "restartInMs": p["restart_in_ms"],
                }
            )
        elif e.type == "baseline.restarted":
            marks.append({"kind": "restart", "atMs": e.ts_virtual - start, "n": p["crash"]})
        elif (
            e.type == "chaos.injected"
            and p["fault"] in ("kill_coordinator", "kill_agent")
            and p.get("target")
        ):
            if p["fault"] == "kill_coordinator" and any(
                x.type == "baseline.crashed" and x.ts_virtual == e.ts_virtual for x in events
            ):
                continue  # a supervisor's crash is marked once, by baseline.crashed
            marks.append(
                {
                    "kind": "kill",
                    "atMs": e.ts_virtual - start,
                    "lane": index.get(p["target"]),
                    "target": p["target"],
                    "role": "agent" if p["fault"] == "kill_agent" else "brain",
                }
            )
        elif e.type == "member.dead":
            marks.append(
                {
                    "kind": "verdict",
                    "atMs": e.ts_virtual - start,
                    "target": p["member"],
                    "by": p["by"],
                }
            )
        elif e.type == "ownership.remapped" and p["owner"] != p["previous"]:
            marks.append(
                {
                    "kind": "remap",
                    "atMs": e.ts_virtual - start,
                    "goal": p["key"],
                    "from": p["previous"],
                    "to": p["owner"],
                }
            )
    return marks


def central_lanes(
    central_dir: Path | None, previous: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The lanes of a recorded run of ``central`` at C3, plus the source record. The recorded runs
    are gitignored: without them the slice already in story.json is kept as it is."""
    run_id = DEFAULT_CENTRAL_ID
    if central_dir is not None and central_dir.is_dir():
        events = load_events(central_dir)
        lanes = lanes_slice(events, central_dir.name)
        source = {
            "path": f"{V1}/runs/{central_dir.name}",
            "runId": central_dir.name,
            "head": events[-1].hash,
            "events": len(events),
            "cell": f"{V1}/cells/{central_dir.name}.json",
            "inGit": False,
        }
        return lanes, source
    if previous is None or "lanes" not in previous or "central" not in previous["lanes"]:
        raise SystemExit(
            f"the recorded run {run_id} is not available and story.json has no lanes.central "
            "to keep: pass --central-run <dir>, from a checkout that has bench/results/v1/runs"
        )
    kept = previous["lanes"]["central"]
    return kept, previous["sources"]["lanesCentral"]


def central_setting(central: dict[str, Any]) -> dict[str, Any]:
    """What the recorded run was, from its id (workflow, task, profile, seed) and its marks."""
    workflow, task, profile, seed = central["runId"].split("__")
    return {
        "label": WORKFLOWS[workflow],
        "task": task,
        "profile": profile,
        "seed": seed.removeprefix("s"),
        "real": True,  # docs/claims.md S4: "the 96 real runs of bench/results/v1"
        "crashes": sum(1 for m in central["marks"] if m["kind"] == "crash"),
    }


def with_page_fields(central: dict[str, Any]) -> dict[str, Any]:
    return {
        **central,
        "setting": central_setting(central),
        "stallS": central["metrics"]["stallS"],
        "keyframes": LANES_KEYFRAMES,
    }


def facts_slice(tree: dict[str, Any], finish: dict[str, Any]) -> dict[str, Any]:
    """The structure of the running example, counted in the bundle: talks, tracks, days (the
    distinct day suffixes of the session goals), sessions, orchestrators, agents."""
    days = {g["id"].rpartition("/")[2] for g in tree["goals"] if g["level"] == 2}
    return {
        "talks": finish["expected"],
        "tracks": tree["counts"]["tracks"],
        "days": len(days),
        "sessions": tree["counts"]["sessions"],
        "orchestrators": tree["counts"]["orchestrators"],
        "agents": tree["counts"]["agents"],
    }


def proof_slice(hashes: dict[str, Any], bundle: Path) -> dict[str, Any]:
    """What ``demo --verify`` prints when the replay matches (cli.py: ``MATCH  <bundle>: N events,
    head H``), and the line of the takeover check, which is another command."""
    line = f"MATCH  {bundle.name}: {hashes['count']} events, head {hashes['head']}"
    return {
        "command": "uv run fractalswarm demo --verify",
        "lines": [line] if hashes["replay"]["matches"] else [],
        "takeover": hashes["takeover"],
    }


def seconds_label(ms: float) -> str:
    return f"{ms / 1000:g} s"


def failures_slice(found: dict[str, Any], verdicts: dict[str, Any]) -> dict[str, Any]:
    """The figures of R3 and R4's loss: where locality fails, the false deaths, the per-process
    reading. Each is a number from the regime map or the honesty rows with its setting named."""
    regime, false_deaths, per_process = found["regime"], found["falseDeaths"], found["perProcess"]
    fast = [
        {
            "value": point["cdtRatio"],
            "label": f"the supervisor detects and restarts in {seconds_label(point['valueMs'])}, "
            f"the swarm keeps {seconds_label(regime['defaults']['recovery_ms'])}",
        }
        for row in regime["rows"]
        if row["axis"] == "rival_recovery_ms"
        for point in row["points"]
        if point["locality"] == "fails"
    ]
    deaths = [
        {
            "value": row["remapsPerRun"],
            "label": f"per run at {row['profile']}, {false_deaths['model']} model, "
            f"{row['runs']} runs",
        }
        for row in false_deaths["rows"]
        if row["workflow"] == "swarm" and row["source"] == "rivals-gate" and row["remapsPerRun"] > 0
    ]
    real = [
        row
        for row in verdicts["falseDeaths"]
        if row["workflow"] == "swarm" and row["profile"] == "C3"
    ]
    deaths += [
        {
            "value": row["remapsPerRun"],
            "label": f"per run at {row['profile']}, real model, {row['runs']} seeds",
        }
        for row in real
    ]
    return {
        "fastRestart": fast,
        "falseDeaths": deaths,
        "perProcess": {
            "value": per_process["ratio"]["cdt_s"],
            "decimals": 2,
            "label": f"each coordinator process failing at the same rate, {per_process['model']} "
            f"model: the swarm's coordinator-dependency time over the supervisor's",
        },
    }


# -- assembly --------------------------------------------------------------------------------


def build(
    bundle_arg: str,
    central_dir: Path | None,
    previous: dict[str, Any] | None,
    hero_set: str = "v1",
) -> dict[str, Any]:
    hero_dir = HERO_SETS[hero_set]
    hero = hero_slice(hero_dir)
    if hero is None:
        raise SystemExit(
            f"{hero_dir}/hero-t2_conference.json does not exist: "
            f"the {hero_set} reading cannot be the hero yet"
        )
    bundle = (REPO / bundle_arg).resolve()
    events = load_bundle(bundle)
    report = check_run(bundle)
    claims = claims_slice()
    v1_rows = result_rows(V1)
    head_rows = result_rows(HEADLINE)
    assert v1_rows is not None and head_rows is not None, (
        "bench/results/v1 and headline are required"
    )
    swarm_lanes = lanes_slice(events, report.run_id)
    central, central_source = central_lanes(central_dir, previous)
    gate_regime = gate_regime_slices()
    head10 = headline_slice(HEADLINE_10)
    verdicts = verdicts_slice(HEADLINE)
    assert verdicts is not None, "bench/results/headline is required"

    # Each visual draws one slice and nothing else: the tree's holds all it needs.
    finish = finish_slice(report, events, bundle)
    traffic = traffic_slice(events)
    takeover = takeover_slice(report, events)
    hrw = hrw_slice(report, events)
    tree = tree_slice(events)
    structure = dict(tree["counts"])
    facts = facts_slice(tree, finish)
    gaps = death_verdict_s(takeover["kills"], traffic)
    tree = {
        **tree,
        "durationMs": takeover["durationMs"],
        "talks": {"placed": finish["placed"], "expected": finish["expected"]},
        "kills": takeover.pop("kills"),
        "adoptions": takeover.pop("adoptions"),
        "rounds": hrw["rounds"],
        "heartbeat": traffic["heartbeat"],
        "messageKinds": traffic["messageKinds"],
        "messageFields": traffic["messageFields"],
        "messages": traffic["messages"],
        "busy": busy_spans(swarm_lanes),
    }
    takeover["deathVerdictS"] = gaps["meanS"]
    takeover["deathVerdictRangeS"] = [gaps["minS"], gaps["maxS"]]
    hashes = hashes_slice(events, bundle, report)
    sources: dict[str, Any] = {
        "bundle": {
            "path": rel(bundle),
            "runId": report.run_id,
            "head": events[-1].hash,
            "events": len(events),
            "inGit": True,
        },
        "lanesCentral": central_source,
        "claims": source_record("docs/claims.md"),
        "hero": source_record(f"{hero_dir}/hero-t2_conference.json"),
        "v1": source_record(f"{V1}/results.json"),
        "headline": source_record(f"{HEADLINE}/results.json"),
        "headline10": {
            **source_record(f"{HEADLINE_10}/results.json"),
            "present": head10 is not None,
        },
        "honesty": source_record(HONESTY),
        "regime": source_record(REGIME),
        "assumptions": source_record("bench/REPORT.md"),
    }
    story = {
        "schema": SCHEMA,
        "generator": "scripts/build_home_data.py",
        "sources": sources,
        **claims,
        "tagline": tagline_of(claims["claims"]["S7"]["text"]),
        "tasks": TASKS,
        "workflows": WORKFLOWS,
        "profiles": profiles_slice(),
        "numbers": numbers_slice(v1_rows, head_rows, structure, result_rows(HEADLINE_10)),
        "facts": facts,
        "tree": tree,
        "takeover": takeover,
        "hrw": hrw,
        "finish": finish,
        "lanes": {"central": with_page_fields(central), "swarm": swarm_lanes},
        "hashes": hashes,
        "proof": proof_slice(hashes, bundle),
        "hero": hero,
        "hero10": hero_slice(HEADLINE_10),
        "headline": headline_slice(HEADLINE),
        "headline10": head10,
        "verdicts": verdicts,
        "verdicts10": verdicts_slice(HEADLINE_10),
        **gate_regime,
        "failures": failures_slice(gate_regime, verdicts),
        "tokens": tokens_spent(),
        "tokensByModel": tokens_slice(events),
        "assumptions": assumptions_slice(),
    }
    return story


def dump(story: dict[str, Any]) -> str:
    """Sorted keys, compact values, one top-level slice per line, so a diff names the slice."""
    parts = []
    for key in sorted(story):
        value = json.dumps(story[key], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        parts.append(f"{json.dumps(key)}:{value}")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--bundle", default=DEFAULT_BUNDLE, help="the demo bundle (replaced by the final one)"
    )
    parser.add_argument(
        "--central-run",
        type=Path,
        help="a recorded run of central at C3, when not in this checkout",
    )
    parser.add_argument(
        "--hero-set",
        choices=sorted(HERO_SETS),
        default="v1",
        help="the result set the hero chart and the figures beside R5 are read from",
    )
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument(
        "--check", action="store_true", help="exit 1 when --out differs from a fresh build"
    )
    args = parser.parse_args(argv)

    previous = json.loads(args.out.read_text(encoding="utf-8")) if args.out.exists() else None
    central = args.central_run
    if central is None:
        default = REPO / V1 / "runs" / DEFAULT_CENTRAL_ID
        central = default if default.is_dir() else None
    story = build(args.bundle, central, previous, args.hero_set)
    text = dump(story)
    if args.check:
        current = (
            args.out.read_text(encoding="utf-8").replace("\r\n", "\n") if args.out.exists() else ""
        )
        if current != text:
            print(f"{rel(args.out)} is stale: run scripts/build_home_data.py", file=sys.stderr)
            return 1
        print(f"{rel(args.out)} is current ({len(text) // 1024} KB)")
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {rel(args.out)} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
