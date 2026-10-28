"""Leases and compare-and-set on slot keys (spec §6.1, temporal collisions).

Two squads booking room R at slot S is the concurrent-write collision. Each slot key gets
a lease (TTL 30 s of virtual time, holder plus fencing token) and a version; a write is a
CAS against the version the writer expects. ``book`` claims several keys all-or-nothing:
it takes every lease, CAS-writes every key, then releases the leases. On conflict nothing is
written and the caller gets the conflicting keys, so it can retry another slot.

Everything here is a pure in-memory structure, driven by the virtual time it is given.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict

LEASE_TTL_MS = 30_000


class FencingToken(BaseModel):
    """``(member_id, incarnation, member_epoch)`` (spec §2). Newer tokens compare greater."""

    model_config = ConfigDict(frozen=True)

    member: str
    incarnation: int = 0
    epoch: int = 0

    def order(self) -> tuple[int, int]:
        return (self.incarnation, self.epoch)


class Lease(BaseModel):
    key: str
    holder: str
    token: FencingToken
    expires_at: int


class Cell(BaseModel):
    version: int = 0
    value: dict[str, Any] | None = None
    holder: str | None = None


class Conflict(BaseModel):
    key: str
    reason: str  # leased | version | fenced
    holder: str | None = None
    version: int = 0
    value: dict[str, Any] | None = None


class Write(BaseModel):
    """Set ``key`` to ``value`` if its version is still ``expected`` (0: never written)."""

    key: str
    expected: int = 0
    value: dict[str, Any] | None = None  # None frees the key


class LeaseTable:
    def __init__(self, ttl_ms: int = LEASE_TTL_MS) -> None:
        self.ttl_ms = ttl_ms
        self.leases: dict[str, Lease] = {}
        self.cells: dict[str, Cell] = {}
        self.newest: dict[str, tuple[int, int]] = {}  # member -> newest token order seen

    # -- fencing --------------------------------------------------------------------------

    def fenced(self, token: FencingToken) -> bool:
        """A token older than one already seen from the same member is stale."""
        newest = self.newest.get(token.member)
        if newest is not None and token.order() < newest:
            return True
        self.newest[token.member] = max(newest or token.order(), token.order())
        return False

    # -- leases ---------------------------------------------------------------------------

    def holder(self, key: str, now: int) -> Lease | None:
        lease = self.leases.get(key)
        if lease is None or lease.expires_at <= now:
            return None
        return lease

    def acquire(self, key: str, holder: str, token: FencingToken, now: int) -> Conflict | None:
        if self.fenced(token):
            return Conflict(key=key, reason="fenced", holder=holder)
        current = self.holder(key, now)
        if current is not None and current.holder != holder:
            return Conflict(key=key, reason="leased", holder=current.holder)
        self.leases[key] = Lease(key=key, holder=holder, token=token, expires_at=now + self.ttl_ms)
        return None

    def release(self, key: str, holder: str) -> None:
        lease = self.leases.get(key)
        if lease is not None and lease.holder == holder:
            del self.leases[key]

    # -- versioned cells ------------------------------------------------------------------

    def get(self, key: str) -> Cell:
        return self.cells.get(key, Cell())

    def cas(self, write: Write, holder: str, now: int) -> Conflict | None:
        lease = self.holder(write.key, now)
        if lease is None or lease.holder != holder:
            owner = lease.holder if lease else None
            return Conflict(key=write.key, reason="leased", holder=owner)
        cell = self.get(write.key)
        if cell.version != write.expected:
            return Conflict(
                key=write.key,
                reason="version",
                holder=cell.holder,
                version=cell.version,
                value=cell.value,
            )
        self.cells[write.key] = Cell(
            version=cell.version + 1,
            value=write.value,
            holder=holder if write.value is not None else None,
        )
        return None

    def already(self, writes: list[Write]) -> bool:
        """Is this exact booking already in place? An heir that re-sends a dead owner's
        booking (the values name the session, so no other booking can match) is a no-op."""
        return bool(writes) and all(
            write.value is not None
            and self.get(write.key).version == write.expected + 1
            and self.get(write.key).value == write.value
            for write in writes
        )

    def book(
        self, writes: list[Write], holder: str, token: FencingToken, now: int
    ) -> list[Conflict]:
        """All-or-nothing multi-key CAS. Returns the conflicts (empty when written)."""
        writes = sorted(writes, key=lambda write: write.key)
        if self.fenced(token):
            return [Conflict(key=write.key, reason="fenced", holder=holder) for write in writes]
        conflicts: list[Conflict] = []
        for write in writes:
            current = self.holder(write.key, now)
            if current is not None and current.holder != holder:
                conflicts.append(Conflict(key=write.key, reason="leased", holder=current.holder))
                continue
            cell = self.get(write.key)
            if cell.version != write.expected:
                conflicts.append(
                    Conflict(
                        key=write.key,
                        reason="version",
                        holder=cell.holder,
                        version=cell.version,
                        value=cell.value,
                    )
                )
        if conflicts:
            return conflicts
        for write in writes:
            self.acquire(write.key, holder, token, now)
        for write in writes:
            conflict = self.cas(write, holder, now)
            assert conflict is None, conflict
        for write in writes:
            self.release(write.key, holder)
        return []
