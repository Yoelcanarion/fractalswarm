"""The global spend breaker (spec §8).

Opens when the burn rate over the last minute of virtual time exceeds 20% of the remaining
budget; while open, new contracts pause for 30 s; then it closes on its own. The state is an
immutable value and every function is pure, so an orchestrator can keep it in its handler
state and replay reproduces every trip.
"""

from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict

from fractalswarm.config import CONFIG_DIR

WINDOW_MS = 60_000


class SpendBreakerConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    max_burn_share_per_min: float = 0.20
    pause_ms: int = 30_000

    @classmethod
    def load(cls, path: Path = CONFIG_DIR / "defaults.yaml") -> "SpendBreakerConfig":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))["breakers"]["global_spend"]
        return cls(
            max_burn_share_per_min=data["max_burn_share_per_min"],
            pause_ms=int(data["pause_s"] * 1000),
        )


class SpendBreaker(BaseModel):
    model_config = ConfigDict(frozen=True)

    samples: tuple[tuple[int, float], ...] = ()  # (virtual ms, usd), oldest first
    open_until: int | None = None
    trips: int = 0

    def burn(self, now: int) -> float:
        return sum(usd for at, usd in self.samples if now - at < WINDOW_MS)

    def is_open(self, now: int) -> bool:
        return self.open_until is not None and now < self.open_until

    def allows_new_contracts(self, now: int) -> bool:
        return not self.is_open(now)


def record_spend(
    breaker: SpendBreaker,
    now: int,
    usd: float,
    remaining_usd: float,
    config: SpendBreakerConfig,
) -> tuple[SpendBreaker, bool]:
    """Add a settled cost at ``now``; returns the new state and whether it just tripped.

    ``remaining_usd`` is the budget left after this spend.
    """
    if usd < 0:
        raise ValueError("spend cannot be negative")
    if breaker.samples and now < breaker.samples[-1][0]:
        raise ValueError("spend must be recorded in time order")
    samples = tuple((at, cost) for at, cost in breaker.samples if now - at < WINDOW_MS)
    samples += ((now, usd),)
    burn = sum(cost for _, cost in samples)
    limit = config.max_burn_share_per_min * max(remaining_usd, 0.0)
    open_until = breaker.open_until if breaker.is_open(now) else None
    tripped = False
    if open_until is None and burn > limit:
        open_until = now + config.pause_ms
        tripped = True
    state = SpendBreaker(samples=samples, open_until=open_until, trips=breaker.trips + int(tripped))
    return state, tripped
