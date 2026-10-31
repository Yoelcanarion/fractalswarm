"""The split-brain check before and after its fix, on recorded runs (read-only).

For each run: the remaps in the log, what the old rule and the new rule of ``verify/takeover.py``
flag, and an independent walk of the chain of owners that shares no code with either. The old rule
is kept here word for word, so that the before can be recomputed after it left the repo.

To show the fix weakens nothing, each takeover in the log is also given a twin right after it, a
second taker of the same tenure, and both rules must catch every twin.

    uv run python scripts/split_brain_before_after.py OUT.json RUN_DIR [RUN_DIR ...]

A run dir is any folder with an ``events.sqlite``. Nothing is written but OUT.json.
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

from fractalswarm.bench.scoring import load_events
from fractalswarm.kernel.events import Event
from fractalswarm.verify.takeover import _split_brain, analyze
from fractalswarm.verify.takeover_models import Violation

TWIN = 10**9  # the seq of an injected twin; its place in the list is what counts


def remaps_of(events: list[Event]) -> list[dict]:
    return [
        {
            "seq": e.seq,
            "goal": e.payload["key"],
            "previous": e.payload["previous"],
            "owner": e.payload["owner"],
        }
        for e in events
        if e.type == "ownership.remapped"
    ]


def old_rule(remaps: list[dict]) -> list[str]:
    """The rule until Oct 31, 2026: group by (goal, previous), flag two names in a group."""
    owners: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in remaps:
        owners[(r["goal"], r["previous"])].append(r)
    flags = []
    for (goal, previous), group in sorted(owners.items()):
        names = sorted({r["owner"] for r in group})
        if len(names) > 1:
            where = ", ".join(f"{r['owner']} at seq {r['seq']}" for r in group)
            flags.append(f"{goal} from {previous} was taken by {len(names)} owners: {where}")
    return flags


def new_rule(remaps: list[dict]) -> list[Violation]:
    successions = [SimpleNamespace(**r) for r in remaps]
    found: list[Violation] = []
    _split_brain(successions, found)
    return found


def twins(remaps: list[dict]) -> dict:
    """A second taker of each takeover's tenure, right after it. A reclaim opens a new tenure of
    the same member, so what follows it is the next takeover, not a twin."""
    takeovers = [i for i, r in enumerate(remaps) if r["owner"] != r["previous"]]
    caught_old = caught_new = 0
    for i in takeovers:
        twin = remaps[i] | {"seq": TWIN, "owner": "twin"}
        edited = [*remaps[: i + 1], twin, *remaps[i + 1 :]]
        caught_old += any("twin" in flag for flag in old_rule(edited))
        caught_new += any(flag.seq == TWIN for flag in new_rule(edited))
    return {"injected": len(takeovers), "caught_old": caught_old, "caught_new": caught_new}


def chain_walk(events: list[Event]) -> dict:
    """Each remap against the goal's owner at that point of the log, from the log's own events."""
    owner: dict[str, str] = {}
    checked = breaks = unknown = 0
    tenures: Counter[tuple[str, str]] = Counter()
    for e in events:
        if e.type == "ownership.assigned":
            owner[e.payload["key"]] = e.payload["owner"]
            tenures[(e.payload["key"], e.payload["owner"])] += 1
        elif e.type == "ownership.remapped":
            key = e.payload["key"]
            if key not in owner:  # the root has no ownership.assigned
                unknown += 1
            else:
                checked += 1
                breaks += owner[key] != e.payload["previous"]
            owner[key] = e.payload["owner"]
            tenures[(key, e.payload["owner"])] += 1
    second = sorted(f"{goal} held twice by {who}" for (goal, who), n in tenures.items() if n > 1)
    return {
        "checked": checked,
        "breaks": breaks,
        "no_assignment": unknown,
        "second_tenures": second,
    }


def one_run(run: Path) -> dict:
    events = load_events(run)
    remaps = remaps_of(events)
    report = analyze(events)
    new = [v for v in report.violations if v.kind == "split-brain"]
    return {
        "run": run.name,
        "events": len(events),
        "head": events[-1].hash,
        "remaps": len(remaps),
        "old_flags": old_rule(remaps),
        "new_flags": [v.detail for v in new],
        "chain": chain_walk(events),
        "twins": twins(remaps),
    }


def main() -> None:
    out, *runs = sys.argv[1:]
    rows = [one_run(Path(run)) for run in runs]
    totals = {
        "runs": len(rows),
        "remaps": sum(r["remaps"] for r in rows),
        "old_flags": sum(len(r["old_flags"]) for r in rows),
        "runs_old_flags": sum(1 for r in rows if r["old_flags"]),
        "new_flags": sum(len(r["new_flags"]) for r in rows),
        "chain_checked": sum(r["chain"]["checked"] for r in rows),
        "chain_breaks": sum(r["chain"]["breaks"] for r in rows),
        "chain_no_assignment": sum(r["chain"]["no_assignment"] for r in rows),
        "twins_injected": sum(r["twins"]["injected"] for r in rows),
        "twins_caught_old": sum(r["twins"]["caught_old"] for r in rows),
        "twins_caught_new": sum(r["twins"]["caught_new"] for r in rows),
    }
    Path(out).write_text(json.dumps({"totals": totals, "rows": rows}, indent=1), encoding="utf-8")
    print(json.dumps(totals))
    for row in rows:
        if row["old_flags"] or row["new_flags"]:
            print(row["run"], len(row["old_flags"]), "->", len(row["new_flags"]))


if __name__ == "__main__":
    main()
