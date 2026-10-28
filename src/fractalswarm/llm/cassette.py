"""Cassettes: every LLM call of a run, with secrets redacted before anything is written.

One JSON line per call (spec §14): ``{effect_id, run_id, model, request, attempts, usage,
latency_ms, cost_usd, refusal}``. Each attempt is one HTTP exchange, so retries replay too.
``CassetteBackend`` serves the recorded attempts in order and refuses any request that
differs from the recorded one, which is how replay proves the handlers asked the same thing.
"""

import json
from collections.abc import Awaitable, Callable, Iterable
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from fractalswarm.kernel.ids import canonical_json
from fractalswarm.safety.scanners import REDACTED, SECRET_PATTERNS, redact_secrets

SENSITIVE_KEYS = {
    "authorization",
    "proxy-authorization",
    "api-key",
    "api_key",
    "x-api-key",
    "cookie",
    "set-cookie",
    "model_api_key",
    "hf_token",
}
# Opaque model blobs (encrypted reasoning): patterns would match random base64 (a real
# T2 run's blob held "hf_" plus 50 letters) and break replay; only known secrets are removed.
OPAQUE_KEYS = {"encrypted_content"}
# Re-exported: the secret patterns live in safety/scanners.py, shared with the scanners.
__all__ = ["OPAQUE_KEYS", "REDACTED", "SECRET_PATTERNS", "SENSITIVE_KEYS", "redact"]


def redact(value: Any, secrets: Iterable[str] = ()) -> Any:
    """A copy of ``value`` with sensitive keys, key-shaped strings and known secrets removed."""
    secrets = sorted((s for s in secrets if s), key=len, reverse=True)
    return _redact(value, secrets)


def _redact(value: Any, secrets: list[str]) -> Any:
    if isinstance(value, dict):
        return {key: _redact_item(str(key).lower(), item, secrets) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_redact(item, secrets) for item in value]
    if isinstance(value, str):
        return redact_secrets(value, secrets)
    return value


def _redact_item(key: str, item: Any, secrets: list[str]) -> Any:
    if key in SENSITIVE_KEYS:
        return REDACTED
    if key in OPAQUE_KEYS and isinstance(item, str):
        for secret in secrets:
            item = item.replace(secret, REDACTED)
        return item
    return _redact(item, secrets)


class Attempt(BaseModel):
    """One HTTP exchange. ``status`` 0 means the request never got a response."""

    status: int
    headers: dict[str, str] = {}
    body: Any = None
    latency_ms: int = 0
    error: str | None = None


class CassetteEntry(BaseModel):
    effect_id: str
    run_id: str
    model: str
    request: dict[str, Any]
    attempts: list[Attempt] = []
    usage: dict[str, int] | None = None
    latency_ms: int = 0
    cost_usd: float = 0.0
    refusal: str | None = None


class CassetteMismatch(Exception):
    """Replay asked for something the cassette does not hold."""


class Cassette:
    def __init__(self, path: Path, secrets: Iterable[str] = ()) -> None:
        self.path = path
        self.secrets = list(secrets)
        self.entries: dict[str, CassetteEntry] = {}
        if path.exists():
            with path.open(encoding="utf-8") as lines:
                for line in lines:
                    if line.strip():
                        entry = CassetteEntry.model_validate_json(line)
                        self.entries[entry.effect_id] = entry

    def record(self, entry: CassetteEntry) -> CassetteEntry:
        clean = CassetteEntry.model_validate(redact(entry.model_dump(mode="json"), self.secrets))
        if clean.effect_id in self.entries:
            raise ValueError(f"effect {clean.effect_id!r} is already recorded")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8", newline="\n") as out:
            out.write(canonical_json(clean.model_dump(mode="json")) + "\n")
        self.entries[clean.effect_id] = clean
        return clean

    def get(self, effect_id: str) -> CassetteEntry:
        try:
            return self.entries[effect_id]
        except KeyError:
            raise CassetteMismatch(f"no cassette entry for {effect_id!r}") from None


class CassetteBackend:
    """A backend that answers from a cassette, for replay."""

    def __init__(self, cassette: Cassette) -> None:
        self.cassette = cassette
        self.served: dict[str, int] = {}

    async def send(
        self,
        effect_id: str,
        body: dict[str, Any],
        sleep: Callable[[int], Awaitable[None]],
    ) -> Attempt:
        entry = self.cassette.get(effect_id)
        if redact(body, self.cassette.secrets) != entry.request:
            recorded, asked = canonical_json(entry.request), canonical_json(body)
            raise CassetteMismatch(
                f"{effect_id}: the request differs from the recording\n"
                f"recorded: {recorded[:400]}\nreplayed: {asked[:400]}"
            )
        index = self.served.get(effect_id, 0)
        if index >= len(entry.attempts):
            raise CassetteMismatch(f"{effect_id}: replay made more attempts than recorded")
        self.served[effect_id] = index + 1
        return entry.attempts[index]


def load_json(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text
