"""Two-phase budget accounting: reserve before a call, settle after it (spec §7.1).

``Ledger`` is the in-run book. It lives inside the kernel, so every reserve and settle is an
event and replays exactly. Caps apply per scope: contract, squad, run and project. A scope
without a cap is unlimited.

``ProjectLedger`` is the persistent, cross-run book for real calls (SQLite). Its reserve is
one ``BEGIN IMMEDIATE`` transaction, so concurrent runs can never overshoot the project cap.
"""

import sqlite3
from collections import defaultdict
from pathlib import Path

from pydantic import BaseModel

LEVELS = ("contract", "squad", "run", "project")
EPSILON = 1e-12

Scope = tuple[str, str]  # (level, key)


class Refusal(BaseModel):
    level: str
    key: str
    cap_usd: float
    committed_usd: float
    requested_usd: float


class Reservation(BaseModel):
    reservation_id: str
    scopes: dict[str, str]
    usd: float


class Ledger:
    def __init__(self) -> None:
        self.caps: dict[Scope, float] = {}
        self.reserved: defaultdict[Scope, float] = defaultdict(float)
        self.spent: defaultdict[Scope, float] = defaultdict(float)
        self.open: dict[str, Reservation] = {}

    def set_cap(self, level: str, key: str, usd: float) -> None:
        if level not in LEVELS:
            raise ValueError(f"unknown budget level {level!r}")
        self.caps[(level, key)] = usd

    def committed(self, scope: Scope) -> float:
        return self.reserved[scope] + self.spent[scope]

    def check(self, scopes: dict[str, str], usd: float) -> Refusal | None:
        for level in LEVELS:
            if level not in scopes:
                continue
            scope = (level, scopes[level])
            cap = self.caps.get(scope)
            if cap is not None and self.committed(scope) + usd > cap + EPSILON:
                return Refusal(
                    level=level,
                    key=scope[1],
                    cap_usd=cap,
                    committed_usd=self.committed(scope),
                    requested_usd=usd,
                )
        return None

    def reserve(self, reservation_id: str, scopes: dict[str, str], usd: float) -> Refusal | None:
        if usd < 0:
            raise ValueError("a reservation cannot be negative")
        if reservation_id in self.open:
            raise ValueError(f"reservation {reservation_id!r} is already open")
        unknown = set(scopes) - set(LEVELS)
        if unknown:
            raise ValueError(f"unknown budget levels {sorted(unknown)}")
        refusal = self.check(scopes, usd)
        if refusal is None:
            self.open[reservation_id] = Reservation(
                reservation_id=reservation_id, scopes=scopes, usd=usd
            )
            for level, key in sorted(scopes.items()):
                self.reserved[(level, key)] += usd
        return refusal

    def settle(self, reservation_id: str, actual_usd: float) -> Reservation:
        """Replace the reservation with the real cost; the difference is released."""
        reservation = self.open.pop(reservation_id)
        for level, key in sorted(reservation.scopes.items()):
            self.reserved[(level, key)] -= reservation.usd
            self.spent[(level, key)] += actual_usd
        return reservation

    def release(self, reservation_id: str) -> Reservation:
        return self.settle(reservation_id, 0.0)


PROJECT_SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'settled')),
    reserved_usd REAL NOT NULL,
    actual_usd REAL,
    created_at TEXT,
    settled_at TEXT
)
"""


class SpendRow(BaseModel):
    key: str
    calls: int
    actual_usd: float
    reserved_usd: float


class SpendSummary(BaseModel):
    cap_usd: float
    spent_usd: float
    reserved_usd: float
    remaining_usd: float
    by_run: list[SpendRow]
    by_model: list[SpendRow]


class ProjectLedger:
    """The project ledger. Timestamps come from the caller: this module never reads a clock."""

    def __init__(self, path: Path | str, cap_usd: float) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.cap_usd = cap_usd
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(PROJECT_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=30, isolation_level=None)

    def reserve(
        self,
        reservation_id: str,
        run_id: str,
        model: str,
        usd: float,
        at: str | None = None,
    ) -> Refusal | None:
        db = self._connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            committed = self._committed(db)
            if committed + usd > self.cap_usd + EPSILON:
                db.execute("ROLLBACK")
                return Refusal(
                    level="project",
                    key="project",
                    cap_usd=self.cap_usd,
                    committed_usd=committed,
                    requested_usd=usd,
                )
            db.execute(
                "INSERT INTO entries (reservation_id, run_id, model, status, reserved_usd, "
                "created_at) VALUES (?, ?, ?, 'reserved', ?, ?)",
                (reservation_id, run_id, model, usd, at),
            )
            db.execute("COMMIT")
            return None
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        finally:
            db.close()

    def settle(self, reservation_id: str, actual_usd: float, at: str | None = None) -> None:
        db = self._connect()
        try:
            changed = db.execute(
                "UPDATE entries SET status = 'settled', actual_usd = ?, settled_at = ? "
                "WHERE reservation_id = ? AND status = 'reserved'",
                (actual_usd, at, reservation_id),
            ).rowcount
        finally:
            db.close()
        if changed != 1:
            raise KeyError(f"no open reservation {reservation_id!r}")

    @staticmethod
    def _committed(db: sqlite3.Connection) -> float:
        row = db.execute(
            "SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd "
            "ELSE actual_usd END), 0) FROM entries"
        ).fetchone()
        return float(row[0])

    def committed_usd(self) -> float:
        db = self._connect()
        try:
            return self._committed(db)
        finally:
            db.close()

    def remaining_usd(self) -> float:
        return self.cap_usd - self.committed_usd()

    def summary(self) -> SpendSummary:
        db = self._connect()
        try:
            totals = db.execute(
                "SELECT COALESCE(SUM(actual_usd), 0), "
                "COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd END), 0) "
                "FROM entries"
            ).fetchone()
            grouped = {
                column: [
                    SpendRow(key=key, calls=calls, actual_usd=actual, reserved_usd=reserved)
                    for key, calls, actual, reserved in db.execute(
                        f"SELECT {column}, COUNT(*), COALESCE(SUM(actual_usd), 0), "
                        "COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd END), 0) "
                        f"FROM entries GROUP BY {column} ORDER BY MIN(seq)"
                    )
                ]
                for column in ("run_id", "model")
            }
        finally:
            db.close()
        spent, reserved = float(totals[0]), float(totals[1])
        return SpendSummary(
            cap_usd=self.cap_usd,
            spent_usd=spent,
            reserved_usd=reserved,
            remaining_usd=self.cap_usd - spent - reserved,
            by_run=grouped["run_id"],
            by_model=grouped["model"],
        )
