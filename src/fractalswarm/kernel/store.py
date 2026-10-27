"""Append-only SQLite event store with a hash chain (spec §5.1).

Each row stores ``prev_hash`` and ``hash = blake2b(prev_hash ‖ canonical_json(row))``, so any
edit, insertion or deletion breaks ``verify_chain()`` from that row onwards.
"""

import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path

from pydantic import BaseModel

from fractalswarm.kernel.events import Event, EventDraft, validate_payload
from fractalswarm.kernel.ids import GENESIS_HASH, canonical_json, chain_hash

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL,
    ts_virtual INTEGER NOT NULL,
    lamport INTEGER NOT NULL,
    member_epoch INTEGER NOT NULL,
    market_epoch INTEGER NOT NULL,
    type TEXT NOT NULL,
    actor TEXT NOT NULL,
    causation_id INTEGER,
    correlation_id TEXT,
    idem_key TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
)
"""
COLUMNS = (
    "seq, run_id, ts_virtual, lamport, member_epoch, market_epoch, type, actor, "
    "causation_id, correlation_id, idem_key, payload, prev_hash, hash"
)


class DuplicateEvent(Exception):
    """An event with the same ``idem_key`` is already in the log."""


class ChainReport(BaseModel):
    ok: bool
    events: int
    head_hash: str
    first_bad_seq: int | None = None
    reason: str = ""


class EventStore:
    def __init__(self, path: Path | str = ":memory:") -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, isolation_level=None)
        if self.path != ":memory:":
            self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute(SCHEMA)
        row = self.db.execute("SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1").fetchone()
        self.last_seq, self.head_hash = row if row else (0, GENESIS_HASH)

    def close(self) -> None:
        self.db.close()

    def __enter__(self) -> "EventStore":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def next_seq(self) -> int:
        return self.last_seq + 1

    def append(self, draft: EventDraft) -> Event:
        payload = validate_payload(draft.type, draft.payload)
        fields = draft.model_dump() | {"payload": payload, "seq": self.next_seq}
        unhashed = Event(**fields, prev_hash=self.head_hash, hash="")
        event = unhashed.model_copy(update={"hash": chain_hash(self.head_hash, unhashed.row())})
        try:
            self.db.execute(
                f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                _to_row(event),
            )
        except sqlite3.IntegrityError as exc:
            if "idem_key" in str(exc):
                raise DuplicateEvent(draft.idem_key) from exc
            raise
        self.last_seq, self.head_hash = event.seq, event.hash
        return event

    def has_idem_key(self, idem_key: str) -> bool:
        query = "SELECT 1 FROM events WHERE idem_key = ?"
        return self.db.execute(query, (idem_key,)).fetchone() is not None

    def read(self, from_seq: int = 1, to_seq: int | None = None) -> Iterator[Event]:
        query = f"SELECT {COLUMNS} FROM events WHERE seq >= ? AND seq <= ? ORDER BY seq"
        upper = self.last_seq if to_seq is None else to_seq
        for row in self.db.execute(query, (from_seq, upper)):
            yield _from_row(row)

    def get(self, seq: int) -> Event | None:
        return next(self.read(seq, seq), None)

    def verify_chain(self) -> ChainReport:
        prev, count = GENESIS_HASH, 0
        for event in self.read():
            count += 1
            if event.seq != count:
                return _broken(count, count, f"seq {count} is missing; found {event.seq}")
            if event.prev_hash != prev:
                return _broken(count, event.seq, "prev_hash does not match the previous hash")
            if chain_hash(prev, event.row()) != event.hash:
                return _broken(count, event.seq, "hash does not match the row")
            prev = event.hash
        return ChainReport(ok=True, events=count, head_hash=prev)

    def export_jsonl(self, path: Path) -> None:
        with path.open("w", encoding="utf-8", newline="\n") as out:
            for event in self.read():
                out.write(canonical_json(event.model_dump()) + "\n")

    @classmethod
    def import_jsonl(cls, source: Path, path: Path | str = ":memory:") -> "EventStore":
        """Load an exported log verbatim (hashes included), so ``verify_chain()`` can judge it."""
        store = cls(path)
        with source.open(encoding="utf-8") as lines:
            for line in lines:
                if line.strip():
                    event = Event.model_validate_json(line)
                    store.db.execute(
                        f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        _to_row(event),
                    )
                    store.last_seq, store.head_hash = event.seq, event.hash
        return store


def _to_row(event: Event) -> tuple:
    return (
        event.seq,
        event.run_id,
        event.ts_virtual,
        event.lamport,
        event.member_epoch,
        event.market_epoch,
        event.type,
        event.actor,
        event.causation_id,
        event.correlation_id,
        event.idem_key,
        canonical_json(event.payload),
        event.prev_hash,
        event.hash,
    )


def _from_row(row: tuple) -> Event:
    names = [name.strip() for name in COLUMNS.split(",")]
    fields = dict(zip(names, row, strict=True))
    fields["payload"] = json.loads(fields["payload"])
    return Event(**fields)


def _broken(events: int, seq: int, reason: str) -> ChainReport:
    return ChainReport(ok=False, events=events, head_hash="", first_bad_seq=seq, reason=reason)
