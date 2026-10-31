"""The reading of PREREG §9's mid-level rows, from the logs alone.

Prints one JSON document: for each cell of the two result dirs, the crash and what it cost. Run it
after `bench run`:

    python scripts/midlevel_reading.py bench/results/midlevel > bench/results/midlevel/reading.json

Args: <results dir holding swarm/ and durable-max/>, each with its runs/.
"""

import json
import sys
from collections import Counter
from pathlib import Path

from fractalswarm.bench import recovery as R
from fractalswarm.bench.scoring import load_events, score_run
from fractalswarm.verify.takeover import SupervisorLog, check_run


def branch(goal: str | None) -> str:
    return (goal or "").split("/")[0]


def crash_of(events) -> dict | None:
    for event in events:
        if event.type == "chaos.injected" and event.payload.get("fault") == "kill_coordinator":
            detail = event.payload.get("detail") or {}
            if not detail.get("skipped"):
                return {"target": event.payload.get("target"), "at_s": event.ts_virtual / 1000}
    return None


def read(run: Path, twins: Path) -> dict:
    events = load_events(run)
    log = R._Log.build(events)
    outages = R._outages(log, R._Owners(log))
    by_goal: dict[str, list] = {}
    for item in R._items(log):
        by_goal.setdefault(item.goal, []).append(item)
    crash = crash_of(events)
    metrics = score_run(run)
    try:
        report = check_run(run)
    except SupervisorLog:  # a supervisor hands nothing over: the check has nothing to read
        report = None
    row: dict = {
        "crash": crash,
        "completed": metrics.completed,
        "makespan_s": metrics.makespan_s,
        "cost_usd": metrics.cost_usd,
        "takeover_ok": report.ok if report else None,
        "violations": sorted(Counter(v.kind for v in report.violations).items()) if report else [],
        "remapped": [
            {"goal": e.payload["key"], "from": e.payload["previous"], "to": e.payload["owner"]}
            for e in events
            if e.type == "ownership.remapped"
        ],
        "false_deaths": [
            e.payload["member"]
            for e in events
            if e.type == "member.dead" and (crash is None or e.payload["member"] != crash["target"])
        ],
        "outages": [],
    }
    verified = [e for e in events if e.type == "contract.verified"]
    for outage in outages:
        if outage.kind != "crash":
            continue
        figures = R._figures(outage, by_goal)
        cdt = Counter()
        for item, overlap in figures.blocked:
            cdt[branch(item.goal)] += overlap / 1000
        inside = Counter(
            branch(e.payload.get("goal_id"))
            for e in verified
            if outage.onset <= e.ts_virtual <= outage.end
        )
        row["outages"].append(
            {
                "coordinator": outage.coordinator,
                "ttr_s": (outage.end - outage.onset) / 1000,
                "goals": sorted(outage.spans),
                "branches_owned": sorted({branch(goal) for goal in outage.spans}),
                "cdt_s": figures.cdt / 1000,
                "cdt_by_branch_s": {name: round(cdt[name], 3) for name in sorted(cdt)},
                "verified_during_outage": {name: inside[name] for name in sorted(inside)},
            }
        )
    twin = twins / f"{run.name.replace(run.name.split('__')[2], 'C0')}.json"
    if twin.exists():
        base = json.loads(twin.read_text(encoding="utf-8"))
        scored = base.get("metrics", base)
        row["c0"] = {"makespan_s": scored.get("makespan_s"), "cost_usd": scored.get("cost_usd")}
    return row


def main(root: Path) -> None:
    found: dict[str, dict] = {}
    for side in ("swarm", "durable-max"):
        for run in sorted((root / side / "runs").iterdir()):
            if "__C0__" in run.name:
                continue
            found[run.name] = read(run, root / side / "cells")
    print(json.dumps(found, indent=1, sort_keys=True))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
