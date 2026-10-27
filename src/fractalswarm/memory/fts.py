"""Full-text search over facts: an in-memory SQLite FTS5 index ranked by bm25 (spec §9).

The index is rebuilt from the log on replay, so it holds no state of its own. Results are
ordered by ``(bm25, key)`` so equal scores never depend on insertion internals. Free-text
queries from agents are sanitized: every word becomes a quoted token, and only the
upper-case operators ``AND``, ``OR`` and ``NOT`` pass through (words are ANDed by default).
"""

import re
import sqlite3

WORD = re.compile(r"[\w\-:.@]+", re.UNICODE)
OPERATORS = {"AND", "OR", "NOT"}


def to_match(query: str) -> str | None:
    """An FTS5 MATCH expression for a free-text query, or None if it has no words."""
    parts: list[str] = []
    for word in WORD.findall(query):
        if word in OPERATORS:
            if parts and parts[-1] not in OPERATORS:
                parts.append(word)
            continue
        if parts and parts[-1] not in OPERATORS:
            parts.append("AND")
        parts.append('"' + word.replace('"', "") + '"')
    while parts and parts[-1] in OPERATORS:
        parts.pop()
    return " ".join(parts) or None


class FtsIndex:
    def __init__(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute(
            "CREATE VIRTUAL TABLE docs USING fts5(key UNINDEXED, squad UNINDEXED, "
            "status UNINDEXED, text, tokenize='unicode61 tokenchars ''-:.@''')"
        )

    def upsert(self, key: str, text: str, *, squad: str, status: str) -> None:
        self.db.execute("DELETE FROM docs WHERE key = ?", (key,))
        self.db.execute(
            "INSERT INTO docs (key, squad, status, text) VALUES (?, ?, ?, ?)",
            (key, squad, status, text),
        )

    def set_status(self, key: str, status: str) -> None:
        self.db.execute("UPDATE docs SET status = ? WHERE key = ?", (status, key))

    def search(self, query: str, *, k: int = 10, squad: str | None = None) -> list[str]:
        """Keys of the best matches visible to ``squad``: verified facts plus its own drafts."""
        match = to_match(query)
        if match is None:
            return []
        rows = self.db.execute(
            "SELECT key, bm25(docs) AS score FROM docs WHERE docs MATCH ? "
            "AND (status = 'verified' OR squad = ?) ORDER BY score, key LIMIT ?",
            (match, squad or "", max(1, k)),
        ).fetchall()
        return [key for key, _ in rows]
