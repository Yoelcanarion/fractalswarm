"""The blackboard: facts, artifacts and slot bookings, with draft/verified visibility (spec §9).

- A **fact** is typed knowledge with provenance. It starts as a squad-local ``draft``; the
  owning orchestrator promotes it to ``verified``, which makes it global (anti-silo).
- An **artifact** is versioned content written with CAS (the agents' ``workspace``).
- **Bookings** are the T2 grid: slot keys guarded by leases and CAS (``coord/leases.py``).

The structure is pure and in-memory. The board actor (``actors/board.py``) owns one and
applies every change as a logged event, so replay rebuilds it exactly.
"""

import posixpath
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from fractalswarm.coord.leases import Conflict, FencingToken, LeaseTable, Write
from fractalswarm.kernel.ids import canonical_json
from fractalswarm.memory.fts import FtsIndex

Status = Literal["draft", "verified", "disputed", "blocked"]


class Provenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract: str
    agent: str
    squad: str
    sources: list[str] = []


class Fact(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    key: str
    subject: str
    value: Any
    schema_name: str = Field(default="json", alias="schema")
    provenance: Provenance
    status: Status = "draft"
    visibility: Literal["squad", "global"] = "squad"
    lamport: int = 0
    version: int = 1

    def text(self) -> str:
        value = self.value if isinstance(self.value, str) else canonical_json(self.value)
        # The key whole (exact-key queries) and split (so "S01 availability" finds it).
        parts = self.key.replace(":", " ")
        return f"{self.key} {parts} {self.subject} {value}"


class Artifact(BaseModel):
    path: str
    content: str
    version: int
    author: str


class WorkspaceError(ValueError):
    pass


def jail(path: str) -> str:
    """A normalized workspace path, refusing absolute paths and escapes (path jail)."""
    if not path or path.startswith(("/", "\\")) or ":" in path or "\\" in path:
        raise WorkspaceError(f"path {path!r} is outside the workspace")
    clean = posixpath.normpath(path)
    if clean.startswith("..") or clean == ".":
        raise WorkspaceError(f"path {path!r} is outside the workspace")
    return clean


class Blackboard:
    def __init__(self) -> None:
        self.facts: dict[str, Fact] = {}
        self.artifacts: dict[str, Artifact] = {}
        self.index = FtsIndex()
        self.grid = LeaseTable()

    # -- facts ----------------------------------------------------------------------------

    def publish(self, fact: Fact) -> Fact:
        """Add or replace a fact. A verified fact is not downgraded by a later draft."""
        current = self.facts.get(fact.key)
        if current is not None and current.status == "verified" and fact.status == "draft":
            return current
        version = current.version + 1 if current else 1
        fact = fact.model_copy(update={"version": version})
        self.facts[fact.key] = fact
        self.index.upsert(fact.key, fact.text(), squad=fact.provenance.squad, status=fact.status)
        return fact

    def promote(self, key: str) -> Fact | None:
        fact = self.facts.get(key)
        if fact is None or fact.status == "verified":
            return None
        fact = fact.model_copy(update={"status": "verified", "visibility": "global"})
        self.facts[key] = fact
        self.index.set_status(key, "verified")
        return fact

    def visible(self, fact: Fact, squad: str | None) -> bool:
        return fact.status == "verified" or (
            fact.status == "draft" and fact.provenance.squad == squad
        )

    def search(self, query: str, *, k: int = 10, squad: str | None = None) -> list[Fact]:
        return [self.facts[key] for key in self.index.search(query, k=k, squad=squad)]

    def get(self, key: str, squad: str | None = None) -> Fact | None:
        fact = self.facts.get(key)
        return fact if fact is not None and self.visible(fact, squad) else None

    # -- artifacts (workspace) ------------------------------------------------------------

    def read(self, path: str) -> Artifact | None:
        return self.artifacts.get(jail(path))

    def write(
        self, path: str, content: str, author: str, expected: int | None = None
    ) -> Artifact | Conflict:
        path = jail(path)
        current = self.artifacts.get(path)
        version = current.version if current else 0
        if expected is not None and expected != version:
            return Conflict(key=path, reason="version", holder=current.author if current else None)
        artifact = Artifact(path=path, content=content, version=version + 1, author=author)
        self.artifacts[path] = artifact
        return artifact

    # -- bookings (the T2 grid) -----------------------------------------------------------

    def book(
        self, writes: list[Write], holder: str, token: FencingToken, now: int
    ) -> list[Conflict]:
        return self.grid.book(writes, holder, token, now)
