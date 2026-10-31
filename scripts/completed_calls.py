"""The second cost basis of the ten-seed headline: what a run paid for its completed calls alone.

    uv run python scripts/completed_calls.py              # the figures, from the committed CSV
    uv run python scripts/completed_calls.py --logs RUNS  # writes the CSV again from the run logs

A cell's `cost_usd` (the pre-registered basis) counts an estimate for the calls a crash cancels.
The run logs are not committed (`bench/REPORT.md` §3), so `completed-calls.csv` holds what they say
about each cell's completed calls, and this reads the figures of `docs/claims.md` R5 from it.
No key and no call.
"""

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean

RESULTS = Path("bench/results/headline-10")
COLUMNS = ["cell", "workflow", "profile", "seed", "cost_usd", "completed_cost_usd", "estimate_usd"]
HEADER = f"{'at C3, T2, ten seeds':<22}{'cells cost':>12}{'completed calls':>17}{'estimate':>10}"


def completed_cost(events: Path) -> float:
    """The sum of `result.cost_usd` over the LLM effects that completed, joined by effect id."""
    llm: set[str] = set()
    total = 0.0
    with events.open(encoding="utf-8") as lines:
        for line in lines:
            event = json.loads(line)
            payload = event["payload"]
            if event["type"] == "effect.started" and payload.get("kind") == "llm":
                llm.add(payload["effect_id"])
            elif event["type"] == "effect.completed" and payload["effect_id"] in llm:
                total += (payload.get("result") or {}).get("cost_usd") or 0.0
    return total


def write_csv(logs: Path, results: Path) -> int:
    with (results / "results.csv").open(encoding="utf-8", newline="") as rows:
        cells = list(csv.DictReader(rows))
    with (results / "completed-calls.csv").open("w", encoding="utf-8", newline="") as out:
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(COLUMNS)
        for cell in cells:
            completed = completed_cost(logs / cell["cell"] / "events.jsonl")
            estimate = float(cell["cost_usd"]) - completed
            names = [cell[name] for name in COLUMNS[:5]]
            writer.writerow([*names, f"{completed:.9f}", f"{estimate:.9f}"])
    return len(cells)


def extra_pct(rows: list[dict[str, str]], column: str, workflow: str) -> float:
    """The mean over the seeds of a C3 run's extra cost against the same seed's C0."""
    costs: dict[str, dict[str, float]] = defaultdict(dict)
    for row in rows:
        if row["workflow"] == workflow:
            costs[row["seed"]][row["profile"]] = float(row[column])
    return mean(100 * (pair["C3"] / pair["C0"] - 1) for pair in costs.values())


def table(results: Path) -> None:
    with (results / "completed-calls.csv").open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    print(HEADER)
    for workflow in ("swarm", "durable-max", "durable", "central"):
        at_c3 = [row for row in rows if row["workflow"] == workflow and row["profile"] == "C3"]
        estimate = mean(float(row["estimate_usd"]) for row in at_c3)
        cells = extra_pct(rows, "cost_usd", workflow)
        completed = extra_pct(rows, "completed_cost_usd", workflow)
        print(f"{workflow:<22}{cells:>+11.1f}%{completed:>+16.1f}%{estimate:>9.3f}$")


def main() -> None:
    doc = argparse.RawDescriptionHelpFormatter
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=doc)
    parser.add_argument("--logs", type=Path, help="the run bundles: writes the CSV again")
    parser.add_argument("--results", type=Path, default=RESULTS)
    args = parser.parse_args()
    if args.logs is not None:
        print(f"{write_csv(args.logs, args.results)} cells read from {args.logs}")
    table(args.results)


if __name__ == "__main__":
    main()
