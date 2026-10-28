"""The model-endpoint circuit breaker (spec §8), on virtual time.

A breaker per model, kept in the state of the actor that makes calls (pure, so it replays):

- **Opens** after ``open_after_failures`` failures within ``failure_window_ms``, or at once
  when a failure carries a Retry-After above ``open_if_retry_after_above_ms``.
- **While open** the caller routes to the next allowed model or queues the call
  (``BreakerBoard.route``).
- **Recovery.** It stays open for ``open_base_ms · 2^k`` (at most ``open_max_ms``, never
  less than the Retry-After it saw), where ``k`` counts consecutive trips. Then it is
  half-open and lets ``half_open_probes`` calls through. A probe that succeeds closes it;
  one that fails opens it again with ``k + 1``.

Failures are 429, 5xx and transport errors (status 0). Other 4xx are the caller's fault and
do not count. Every state change comes back as a ``breaker.*`` payload to emit.
"""

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict

from fractalswarm.kernel.events import Payload, register


@register("breaker.opened")
class BreakerOpened(Payload):
    breaker: str
    until_ms: int
    trips: int
    reason: str


@register("breaker.half_open")
class BreakerHalfOpen(Payload):
    breaker: str


@register("breaker.closed")
class BreakerClosed(Payload):
    breaker: str


class BreakerPolicy(BaseModel):
    """Defaults from ``config/defaults.yaml`` (breakers.model_endpoint), in milliseconds."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    open_after_failures: int = 5
    failure_window_ms: int = 30_000
    open_if_retry_after_above_ms: int = 20_000
    open_base_ms: int = 10_000
    open_max_ms: int = 120_000
    half_open_probes: int = 1

    @classmethod
    def from_config(cls, section: dict[str, Any]) -> "BreakerPolicy":
        return cls(
            open_after_failures=section["open_after_failures"],
            failure_window_ms=int(section["failure_window_s"] * 1000),
            open_if_retry_after_above_ms=int(section["open_if_retry_after_above_s"] * 1000),
            open_base_ms=int(section["open_base_s"] * 1000),
            open_max_ms=int(section["open_max_s"] * 1000),
            half_open_probes=section["half_open_probes"],
        )


def is_failure(http_status: int) -> bool:
    return http_status == 0 or http_status == 429 or http_status >= 500


@dataclass
class ModelBreaker:
    name: str
    policy: BreakerPolicy = field(default_factory=BreakerPolicy)
    state: str = "closed"  # closed | open | half_open
    failures: list[int] = field(default_factory=list)  # failure times inside the window
    trips: int = 0  # consecutive trips (the k in 10 s · 2^k)
    open_until: int = 0
    probes: int = 0  # probes let through while half-open

    def allow(self, now: int) -> tuple[bool, list[tuple[str, dict[str, Any]]]]:
        """May a call start now? Also returns the transitions (half-open) to emit."""
        transitions: list[tuple[str, dict[str, Any]]] = []
        if self.state == "open" and now >= self.open_until:
            self.state = "half_open"
            self.probes = 0
            transitions.append(("breaker.half_open", {"breaker": self.name}))
        if self.state == "closed":
            return True, transitions
        if self.state == "half_open" and self.probes < self.policy.half_open_probes:
            self.probes += 1
            return True, transitions
        return False, transitions

    def record(
        self, now: int, http_status: int, retry_after_ms: int | None = None
    ) -> list[tuple[str, dict[str, Any]]]:
        """Feed one attempt's outcome; returns the transitions to emit."""
        if not is_failure(http_status):
            if http_status >= 400:
                return []  # the caller's fault, not the endpoint's
            if self.state == "half_open":
                self.state = "closed"
                self.trips = 0
                self.failures.clear()
                return [("breaker.closed", {"breaker": self.name})]
            return []
        if self.state == "half_open":
            return self._open(now, retry_after_ms, "the half-open probe failed")
        if self.state == "open":
            return []
        self.failures = [t for t in self.failures if now - t < self.policy.failure_window_ms]
        self.failures.append(now)
        retry_after = retry_after_ms or 0
        if retry_after > self.policy.open_if_retry_after_above_ms:
            return self._open(now, retry_after_ms, f"Retry-After {retry_after} ms")
        if len(self.failures) >= self.policy.open_after_failures:
            window_s = self.policy.failure_window_ms // 1000
            reason = f"{len(self.failures)} failures in {window_s} s"
            return self._open(now, retry_after_ms, reason)
        return []

    def _open(
        self, now: int, retry_after_ms: int | None, reason: str
    ) -> list[tuple[str, dict[str, Any]]]:
        span = min(self.policy.open_base_ms * 2**self.trips, self.policy.open_max_ms)
        span = max(span, retry_after_ms or 0)
        self.state = "open"
        self.trips += 1
        self.open_until = now + span
        self.failures.clear()
        self.probes = 0
        payload = {
            "breaker": self.name,
            "until_ms": self.open_until,
            "trips": self.trips,
            "reason": reason,
        }
        return [("breaker.opened", payload)]


@dataclass
class BreakerBoard:
    """One breaker per model."""

    policy: BreakerPolicy = field(default_factory=BreakerPolicy)
    breakers: dict[str, ModelBreaker] = field(default_factory=dict)

    def breaker(self, model: str) -> ModelBreaker:
        if model not in self.breakers:
            self.breakers[model] = ModelBreaker(f"model:{model}", self.policy)
        return self.breakers[model]

    def route(
        self, now: int, models: list[str]
    ) -> tuple[str | None, list[tuple[str, dict[str, Any]]]]:
        """The first allowed model of ``models`` (in preference order), or ``None``: queue."""
        transitions: list[tuple[str, dict[str, Any]]] = []
        for model in models:
            allowed, more = self.breaker(model).allow(now)
            transitions += more
            if allowed:
                return model, transitions
        return None, transitions

    def record_result(self, now: int, result: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        """Feed an ``llm`` effect's result (from ``LLMClient``).

        The client already retried inside the effect, so every attempt but the last failed
        with a retryable status (counted as a 503: only the last status is reported).
        """
        model = result.get("model")
        if not model:
            return []
        breaker = self.breaker(model)
        transitions: list[tuple[str, dict[str, Any]]] = []
        for _ in range(max(int(result.get("attempts", 1)) - 1, 0)):
            transitions += breaker.record(now, 503)
        status = int(result.get("http_status", 200))
        transitions += breaker.record(now, status, result.get("retry_after_ms"))
        return transitions
