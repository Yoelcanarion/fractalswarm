"""The sweep behind ``docs/any-survivor.md``: the same cells with the parameter on and off.

    uv run python scripts/any_survivor_sweep.py run <out dir> --on    # fake LLM, $0
    uv run python scripts/any_survivor_sweep.py run <out dir> --off   # a hang costs its whole limit
    uv run python scripts/any_survivor_sweep.py compare bench/results/any-survivor

The cells are in ``bench/results/any-survivor/cells.json``, as ``<workflow>|<name>|<seed>``. A name:

- ``C1``, ``C2``, ``C3``: a bench profile. ``HTB``: the arena's default plan. ``KH``: ``--chaos
  kill-half``.
- ``U<plan>@<at>``: that plan, with the Kill half button pressed at that share of the contracts.
- ``<target>+<target>@<at>``: kills at one point, and commas for kills staggered over the run.
- ``P<ms>-<member>@<at>``: that member cut off the bus. ``BUS<ms>@<at>``: all ten at once.

Each cell gets its own process and a wall-clock limit, because a run with the parameter off can
hang for ever, and no budget cap trips when it does. A hung run keeps its row, read from the log as
it stood, and loses its log. Everything goes through the real code and the bench's own params,
``any_survivor`` being the only difference between ``--on`` and ``--off``.
"""

import argparse
import asyncio
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fractalswarm.api.controls import KILL_HALF_TARGETS
from fractalswarm.bench.profiles import half_the_brains_plan, profile
from fractalswarm.bench.registry import Cell
from fractalswarm.bench.scoring import RunMetrics, load_events, score_run
from fractalswarm.bench.workflows import fake_backend, t2_params
from fractalswarm.cli import kill_half_plan
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan, build_plan
from fractalswarm.runs import record_run, replay_run
from fractalswarm.verify.takeover import check_run

MEMBERS = ("o0", "o1", "o1.1", "o1.2", "o2", "o2.1", "o2.2", "o3", "o3.1", "o3.2")
BELOW_NORMAL = 0x00004000  # Windows; ignored elsewhere


def plan_for(name: str, seed: str) -> dict:
    if name in ("C0", "C1", "C2", "C3"):
        return {"profile": name, "seed": seed}
    if name == "HTB":
        return half_the_brains_plan(seed)
    if name == "KH":
        return kill_half_plan(seed)
    if name.startswith("U"):
        base, _, at = name[1:].partition("@")
        if base == "HTB":
            plan = half_the_brains_plan(seed)
        else:
            plan = build_plan(base, seed).model_dump(mode="json")
        pressed = [
            {"at": float(at), "kind": "kill_coordinator", "target": target}
            for target in KILL_HALF_TARGETS
        ]
        plan["actions"] = sorted([*plan["actions"], *pressed], key=lambda a: (a["at"], a["kind"]))
        return plan
    if name.startswith("BUS"):
        ms, _, at = name[3:].partition("@")
        name = "+".join(f"P{ms}-{member}" for member in MEMBERS) + "@" + at
    actions = []
    for part in name.split(","):
        targets, _, at = part.partition("@")
        for target in targets.split("+"):
            if target.startswith("P"):
                ms, _, member = target[1:].partition("-")
                action = ChaosAction(
                    at=float(at), kind="partition", target=member, duration_ms=int(ms)
                )
            else:
                action = ChaosAction(at=float(at), kind="kill_coordinator", target=target)
            actions.append(action)
    plan = ChaosPlan(profile=f"mid-{name}"[:60], seed=seed, actions=tuple(actions))
    return plan.model_dump(mode="json")


def read_log(run_dir: Path) -> dict:
    events = load_events(run_dir)
    kills = [
        {"target": event.payload.get("target"), "at_s": event.ts_virtual / 1000}
        for event in events
        if event.type == "chaos.injected" and event.payload.get("fault") == "kill_coordinator"
    ]
    dead = [
        {"member": e.payload["member"], "by": e.payload["by"], "at_s": e.ts_virtual / 1000}
        for e in events
        if e.type == "member.dead"
    ]
    return {"events": len(events), "kills": kills, "dead": dead}


async def one_cell(out: Path, cell: str, on: bool) -> None:
    workflow, name, seed = cell.split("|")
    run_dir = out / "runs" / f"{workflow}__{name}__s{seed}"
    params = t2_params(Cell(workflow, "t2_conference", profile("C0"), seed), False)
    params["chaos"] = plan_for(name, seed)
    if on:
        params["any_survivor"] = True
    await record_run(
        workflow,
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=fake_backend(),
        seed=seed,
        params=params,
        run_cap_usd=5.0,
    )
    row: dict = {"cell": cell}
    metrics = score_run(run_dir)
    if isinstance(metrics, RunMetrics):
        row |= {"span_s": metrics.makespan_s, "cost_usd": metrics.cost_usd}
    row |= read_log(run_dir)
    if name != "C0":
        report = check_run(run_dir)
        row["takeover_ok"] = report.ok
        row["violations"] = sorted(Counter(v.kind for v in report.violations).items())
    row["replay_ok"] = (await replay_run(run_dir)).ok
    with (out / "rows.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")


def tail(run_dir: Path) -> dict:
    """What a hung run had done: read-only, because its writer has just been killed."""
    uri = f"file:{(run_dir / 'events.sqlite').as_posix()}?mode=ro"
    db = sqlite3.connect(uri, uri=True)
    seq, ts = db.execute("select seq, ts_virtual from events order by seq desc limit 1").fetchone()
    dead = [
        json.loads(payload)
        for (payload,) in db.execute("select payload from events where type='member.dead'")
    ]
    db.close()
    return {"events": seq, "virtual_s": ts / 1000, "dead": [d["member"] for d in dead]}


def guarded(out: Path, cell: str, on: bool, limit: float) -> None:
    workflow, name, seed = cell.split("|")
    run_dir = out / "runs" / f"{workflow}__{name}__s{seed}"
    if run_dir.exists():
        return
    arguments = [sys.executable, __file__, "cell", str(out), cell]
    process = subprocess.Popen(
        [*arguments, *(["--on"] if on else [])],
        creationflags=BELOW_NORMAL if os.name == "nt" else 0,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    started = time.monotonic()
    try:
        process.wait(timeout=limit)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        with (out / "rows.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"cell": cell, "hung": True} | tail(run_dir)) + "\n")
        shutil.rmtree(run_dir, ignore_errors=True)
        run_dir.mkdir()
        print(cell, "HUNG", flush=True)
        return
    state = "CRASHED" if process.returncode else "ended"
    print(cell, state, round(time.monotonic() - started, 1), flush=True)


def false_deaths(row: dict) -> int:
    crashed: dict[str, float] = {}
    for kill in row.get("kills", []):
        if kill.get("target"):
            crashed.setdefault(kill["target"], kill["at_s"])
    return sum(
        1
        for death in row.get("dead", [])
        if isinstance(death, dict)
        and (death["member"] not in crashed or crashed[death["member"]] > death["at_s"])
    )


def load(path: Path) -> dict[str, dict]:
    rows = (json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines())
    return {row["cell"]: row for row in rows}


def flags(row: dict) -> list[str]:
    return [kind for kind, _ in row.get("violations") or []]


def flag_set(row: dict) -> str:
    return "hung" if row.get("hung") else " + ".join(flags(row)) or "clean"


def compare(folder: Path) -> dict:
    on, off = load(folder / "rows-on.jsonl"), load(folder / "rows-off.jsonl")
    shared = sorted(set(on) & set(off))
    pairs: Counter[str] = Counter()
    for cell in shared:
        a, b = off[cell], on[cell]
        if a.get("hung"):
            pairs["off hung, on flagged" if flags(b) else "off hung, on clean"] += 1
        elif flags(a) == flags(b):
            pairs["same flags, flagged" if flags(b) else "same flags, clean"] += 1
        else:
            pairs["flags differ"] += 1
    return {
        "cells": {"on": len(on), "off": len(off), "shared": len(shared)},
        "hung": {
            "on": sum(1 for row in on.values() if row.get("hung")),
            "off": sum(1 for row in off.values() if row.get("hung")),
        },
        "replay_ok": {
            "on": sum(1 for row in on.values() if row.get("replay_ok")),
            "off": sum(1 for row in off.values() if row.get("replay_ok")),
        },
        "pairs": dict(sorted(pairs.items())),
        "false_deaths_where_neither_hung": {
            "on": sum(false_deaths(on[c]) for c in shared if not off[c].get("hung")),
            "off": sum(false_deaths(off[c]) for c in shared if not off[c].get("hung")),
            "cells": sum(1 for c in shared if not off[c].get("hung")),
        },
        "flags": {
            side: dict(Counter(flag_set(row) for row in rows.values()))
            for side, rows in (("on", on), ("off", off))
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    actions = parser.add_subparsers(dest="action", required=True)
    run = actions.add_parser("run")
    run.add_argument("out", type=Path)
    side = run.add_mutually_exclusive_group(required=True)
    side.add_argument("--on", action="store_true")
    side.add_argument("--off", action="store_true")
    run.add_argument("--limit", type=float, default=60.0, help="seconds of wall clock per cell")
    run.add_argument("--jobs", type=int, default=3)
    run.add_argument("--cells", type=Path, default=Path("bench/results/any-survivor/cells.json"))
    cell = actions.add_parser("cell")
    cell.add_argument("out", type=Path)
    cell.add_argument("cell")
    cell.add_argument("--on", action="store_true")
    summary = actions.add_parser("compare")
    summary.add_argument("folder", type=Path)
    args = parser.parse_args()

    if args.action == "cell":
        asyncio.run(one_cell(args.out, args.cell, args.on))
    elif args.action == "compare":
        print(json.dumps(compare(args.folder), indent=1))
    else:
        args.out.mkdir(parents=True, exist_ok=True)
        listed = json.loads(args.cells.read_text(encoding="utf-8"))
        cells = [*listed["replayed"], *listed["held_out"]]
        with ThreadPoolExecutor(args.jobs) as pool:
            for cell_name in cells:
                pool.submit(guarded, args.out, cell_name, args.on, args.limit)


if __name__ == "__main__":
    main()
