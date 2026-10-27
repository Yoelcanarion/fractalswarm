"""Stable ids, blake2b hashing and canonical JSON.

The built-in ``hash()`` is salted per process, so everything that must survive a replay
(ids, ownership scores, chain hashes) goes through these helpers instead.
"""

import hashlib
import json
from typing import Any

GENESIS_HASH = "0" * 32


def canonical_json(value: Any) -> str:
    """One text per value: sorted keys, no whitespace, UTF-8 kept, NaN and infinity refused."""
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def blake2b_hex(data: bytes | str, digest_size: int = 16) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.blake2b(data, digest_size=digest_size).hexdigest()


def digest(value: Any) -> str:
    """The hash of a JSON-compatible value."""
    return blake2b_hex(canonical_json(value))


def stable_hash(*parts: Any) -> int:
    """A 64-bit integer hash of the parts, identical in every process (for HRW scores)."""
    raw = hashlib.blake2b(canonical_json(list(parts)).encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(raw, "big")


def stable_id(prefix: str, *parts: Any, length: int = 12) -> str:
    return f"{prefix}-{digest(list(parts))[:length]}"


def chain_hash(prev_hash: str, row: Any) -> str:
    """``blake2b(prev_hash ‖ canonical_json(row))`` (spec §5.1)."""
    return blake2b_hex(prev_hash + canonical_json(row))
