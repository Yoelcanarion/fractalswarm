"""Read-only access to recorded and live runs for the API.

A run is a directory holding ``events.sqlite`` (a live or finished log) and/or
``events.jsonl`` (an exported bundle), as written by ``runs.record_run``. The catalog lists
the user's runs under ``runs/``, the bundled runs under ``demo/`` and, when it is given a
private dir, the runs of live input (``FRACTALSWARM_PRIVATE_DIR``: intake runs and runs on
input the user typed), marked private. SQLite logs are opened read-only, so the API can tail a
run that another process is still recording.

A run's status is ``completed``, ``halted`` (the kill switch), ``running`` (its ``LIVE`` file is
fresh: the recording process touches it every second) or ``interrupted`` (the log stops
without an end and nothing touches ``LIVE``: the process died).
"""

import sqlite3
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fractalswarm.kernel.store import COLUMNS, EventStore, _from_row

DEMO_PREFIX = "demo-"
PRIVATE_SOURCE = "private"
PRIVATE_RUN_DIRS = ("runs", "intake")  # under the private dir
LIVE_STALE_S = 15.0  # a LIVE file untouched for this long was left by a process that died
HALT_TAIL = 2000  # events from the end searched for ``run.halted`` (the halt's own reaction)


@dataclass(frozen=True)
class RunEntry:
    id: str
    source: str  # "runs" | "demo" | "private"
    path: Path

    @property
    def sqlite(self) -> Path:
        return self.path / "events.sqlite"

    @property
    def jsonl(self) -> Path:
        return self.path / "events.jsonl"

    @property
    def live(self) -> Path:
        return self.path / "LIVE"

    @property
    def private(self) -> bool:
        return self.source == PRIVATE_SOURCE

    @property
    def recorded_head(self) -> str | None:
        """The head hash written next to a bundle (``HEAD``), if any."""
        head = self.path / "HEAD"
        return head.read_text(encoding="utf-8").strip() if head.exists() else None


def _is_run_dir(path: Path) -> bool:
    return path.is_dir() and ((path / "events.sqlite").exists() or (path / "events.jsonl").exists())


class Catalog:
    def __init__(
        self,
        runs_dir: Path,
        demo_dir: Path | None = None,
        private_dir: Path | None = None,
        live_stale_s: float = LIVE_STALE_S,
    ) -> None:
        self.runs_dir = runs_dir
        self.demo_dir = demo_dir
        self.private_dir = private_dir
        self.live_stale_s = live_stale_s
        self._jsonl_cache: dict[Path, tuple[tuple[int, int], list[dict[str, Any]]]] = {}

    def entries(self) -> list[RunEntry]:
        found: list[RunEntry] = []
        if self.demo_dir and self.demo_dir.is_dir():
            for path in sorted(self.demo_dir.iterdir()):
                if _is_run_dir(path):
                    found.append(RunEntry(DEMO_PREFIX + path.name, "demo", path))
        runs: list[tuple[str, Path]] = []
        if self.runs_dir.is_dir():
            runs += [("runs", path) for path in self.runs_dir.iterdir() if _is_run_dir(path)]
        if self.private_dir is not None:
            for name in PRIVATE_RUN_DIRS:
                parent = self.private_dir / name
                if parent.is_dir():
                    runs += [
                        (PRIVATE_SOURCE, path) for path in parent.iterdir() if _is_run_dir(path)
                    ]
        # Newest first: the run the user just recorded is the one they want.
        runs.sort(key=lambda found_: (-_mtime(found_[1]), found_[1].name))
        taken = {entry.id for entry in found}
        for source, path in runs:
            if path.name not in taken:  # the first of two runs with one name wins
                taken.add(path.name)
                found.append(RunEntry(path.name, source, path))
        return found

    def get(self, run_id: str) -> RunEntry:
        for entry in self.entries():
            if entry.id == run_id:
                return entry
        raise KeyError(run_id)

    def read(self, entry: RunEntry, from_seq: int = 1, limit: int | None = None) -> list[dict]:
        """Events with ``seq >= from_seq``, as JSON-ready dicts, oldest first."""
        if entry.sqlite.exists():
            query = f"SELECT {COLUMNS} FROM events WHERE seq >= ? ORDER BY seq"
            params: tuple = (from_seq,)
            if limit is not None:
                query += " LIMIT ?"
                params = (from_seq, limit)
            with _readonly(entry.sqlite) as db:
                return [_from_row(row).model_dump() for row in db.execute(query, params)]
        events = self._jsonl(entry)
        start = max(from_seq - 1, 0)
        return events[start : None if limit is None else start + limit]

    def last(self, entry: RunEntry) -> dict | None:
        if entry.sqlite.exists():
            with _readonly(entry.sqlite) as db:
                row = db.execute(f"SELECT {COLUMNS} FROM events ORDER BY seq DESC LIMIT 1")
                found = row.fetchone()
            return _from_row(found).model_dump() if found else None
        events = self._jsonl(entry)
        return events[-1] if events else None

    def listing(self, entry: RunEntry) -> dict[str, Any]:
        first = self.read(entry, 1, 1)
        last = self.last(entry)
        started = first[0]["payload"] if first and first[0]["type"] == "run.started" else {}
        return {
            "id": entry.id,
            "source": entry.source,
            "private": entry.private,
            "run_id": first[0]["run_id"] if first else None,
            "scenario": started.get("scenario"),
            "seed": started.get("seed"),
            "clock": started.get("clock"),
            "events": last["seq"] if last else 0,
            "duration_ms": last["ts_virtual"] if last else 0,
            "status": self.status(entry, last),
            "head": last["hash"] if last else None,
        }

    def status(self, entry: RunEntry, last: dict | None) -> str:
        """``completed``, ``halted``, ``running`` or ``interrupted`` (``empty``: no events yet)."""
        if last is None:
            return "empty"
        if self.halted(entry):
            return "halted"
        if last["type"] == "run.completed":
            return "completed"
        return "running" if self.is_live(entry) else "interrupted"

    def is_live(self, entry: RunEntry) -> bool:
        """Whether a process is recording the run: its ``LIVE`` file was touched lately."""
        try:
            age = time.time() - entry.live.stat().st_mtime
        except OSError:
            return False
        return age < self.live_stale_s

    def halted(self, entry: RunEntry) -> bool:
        """Whether the kill switch stopped the run. A halted run goes on to ``run.completed``,
        so the halt is looked for in the tail of the log, where its reaction is."""
        if entry.sqlite.exists():
            query = f"SELECT 1 FROM (SELECT type FROM events ORDER BY seq DESC LIMIT {HALT_TAIL})"
            with _readonly(entry.sqlite) as db:
                return db.execute(query + " WHERE type = 'run.halted'").fetchone() is not None
        events = self._jsonl(entry)[-HALT_TAIL:]
        return any(event["type"] == "run.halted" for event in events)

    def summary(self, entry: RunEntry) -> dict[str, Any]:
        events = self.read(entry)
        info = self.listing(entry)
        counts = Counter(event["type"] for event in events)
        chain = self.verify_chain(entry)
        completed = (
            events[-1]["payload"] if events and events[-1]["type"] == "run.completed" else {}
        )
        started = events[0]["payload"] if events and events[0]["type"] == "run.started" else {}
        return info | {
            "params": started.get("params", {}),
            "run_cap_usd": started.get("run_cap_usd"),
            "spent_usd": completed.get("spent_usd"),
            "alive": completed.get("alive"),
            "chain": chain,
            "recorded_head": entry.recorded_head,
            "counts": dict(sorted(counts.items())),
        }

    def verify_chain(self, entry: RunEntry) -> dict[str, Any]:
        if entry.sqlite.exists():
            with _readonly(entry.sqlite) as db:
                store = EventStore()
                for row in db.execute(f"SELECT {COLUMNS} FROM events ORDER BY seq"):
                    event = _from_row(row)
                    store.db.execute(
                        f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        row,
                    )
                    store.last_seq, store.head_hash = event.seq, event.hash
        else:
            store = EventStore.import_jsonl(entry.jsonl)
        with store:
            return store.verify_chain().model_dump()

    def _jsonl(self, entry: RunEntry) -> list[dict[str, Any]]:
        stat = entry.jsonl.stat()
        key = (stat.st_mtime_ns, stat.st_size)
        cached = self._jsonl_cache.get(entry.jsonl)
        if cached and cached[0] == key:
            return cached[1]
        with EventStore.import_jsonl(entry.jsonl) as store:
            events = [event.model_dump() for event in store.read()]
        self._jsonl_cache[entry.jsonl] = (key, events)
        return events


def _mtime(path: Path) -> int:
    for name in ("events.sqlite", "events.jsonl"):
        if (path / name).exists():
            return (path / name).stat().st_mtime_ns
    return 0


class _readonly:
    """A read-only SQLite connection that never creates or migrates the file."""

    def __init__(self, path: Path) -> None:
        self.db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)

    def __enter__(self) -> sqlite3.Connection:
        return self.db

    def __exit__(self, *exc: object) -> None:
        self.db.close()
