"""Compare two sets of reference runs event by event (see record_refs.ps1).

    uv run python scripts/refs/compare_refs.py BEFORE_DIR AFTER_DIR

Each dir holds runs/<id>/ and, optionally, bench/runs/<cell>/. For every run present in both,
every event column is compared except the hash chain, which cascades from the first change.
The exit code is 0 only when every run has identical event bodies.
"""

import contextlib
import json
import sqlite3
import sys
from pathlib import Path

HASH_COLUMNS = {"hash", "prev_hash", "prev"}


def load(run: Path) -> list[dict]:
    sqlite = run / "events.sqlite"
    if sqlite.exists():
        with sqlite3.connect(f"file:{sqlite}?mode=ro", uri=True) as db:
            cols = [row[1] for row in db.execute("PRAGMA table_info(events)")]
            rows = db.execute("SELECT * FROM events ORDER BY seq")
            return [dict(zip(cols, row, strict=True)) for row in rows]
    lines = (run / "events.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def body(event: dict) -> dict:
    out = {k: v for k, v in event.items() if k not in HASH_COLUMNS}
    if isinstance(out.get("payload"), str):
        with contextlib.suppress(ValueError):
            out["payload"] = json.loads(out["payload"])
    return out


def diff_keys(a, b, prefix: str = "") -> list[str]:
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for key in sorted(set(a) | set(b)):
            if key not in a:
                out.append(f"+{prefix}{key}={json.dumps(b[key])[:80]}")
            elif key not in b:
                out.append(f"-{prefix}{key}")
            elif a[key] != b[key]:
                out.extend(diff_keys(a[key], b[key], f"{prefix}{key}."))
        return out
    return [f"~{prefix.rstrip('.')}: {json.dumps(a)[:60]} -> {json.dumps(b)[:60]}"]


def head(events: list[dict]) -> str:
    return str(events[-1].get("hash", "?"))[:12] if events else "-"


def compare(name: str, before: Path, after: Path) -> bool:
    a, b = load(before), load(after)
    # The shorter log bounds the pairwise diff; a length mismatch is reported on its own.
    diffs = [(x, y) for x, y in zip(a, b, strict=False) if body(x) != body(y)]
    same = len(a) == len(b) and not diffs
    status = "IDENTICAL" if same and head(a) == head(b) else ("SAME-BODY" if same else "DIFF")
    print(f"{status:<10} {name:<44} events {len(a)}/{len(b)} heads {head(a)}/{head(b)}")
    if not same:
        types: dict[str, int] = {}
        for x, _ in diffs:
            types[x.get("type")] = types.get(x.get("type"), 0) + 1
        print(f"           differing events: {len(diffs)} by type {types}")
        for x, y in diffs[:3]:
            changes = diff_keys(body(x), body(y))[:6]
            print(f"           seq {x.get('seq')} {x.get('type')}: {changes}")
    return same


def main() -> int:
    root_a, root_b = Path(sys.argv[1]), Path(sys.argv[2])
    pairs = []
    for sub in ("runs", "bench/runs"):
        da, db = root_a / sub, root_b / sub
        if da.is_dir() and db.is_dir():
            for run in sorted(p for p in da.iterdir() if p.is_dir()):
                if (db / run.name).is_dir():
                    pairs.append((f"{sub}/{run.name}", run, db / run.name))
    results = [compare(name, a, b) for name, a, b in pairs]
    print(f"\n{sum(results)} of {len(results)} runs have identical event bodies")
    return 0 if results and all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
