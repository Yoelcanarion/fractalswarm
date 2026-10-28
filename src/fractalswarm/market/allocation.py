"""Proportional allocation: the epoch auction's deterministic fallback (spec §7.2).

A parent splits its envelope among its children in proportion to their estimated cost. The
arithmetic runs in integer micro-dollars, so the conservation invariant holds exactly:

    sum(grants) + pool + reserve == envelope

- the reserve (15% at the root, 10% below) is held back for ``topup.request``s;
- if the children ask for less than what is left, each gets its ask and the rest stays in
  the pool;
- otherwise each gets ``available * ask / total_ask``, rounded down, and the leftover micros
  go one by one to the largest remainders (ties by child id), so nothing is lost.
"""

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict

MICROS = 1_000_000
ROOT_RESERVE_SHARE = 0.15
CHILD_RESERVE_SHARE = 0.10


def to_micros(usd: float) -> int:
    return round(usd * MICROS)


def to_usd(micros: int) -> float:
    return micros / MICROS


class Allocation(BaseModel):
    model_config = ConfigDict(frozen=True)

    envelope_micros: int
    reserve_micros: int
    pool_micros: int
    grants_micros: dict[str, int]

    @property
    def grants_usd(self) -> dict[str, float]:
        return {child: to_usd(micros) for child, micros in self.grants_micros.items()}

    @property
    def conserved(self) -> bool:
        total = sum(self.grants_micros.values()) + self.pool_micros + self.reserve_micros
        return total == self.envelope_micros


def reserve_share(depth: int) -> float:
    return ROOT_RESERVE_SHARE if depth == 0 else CHILD_RESERVE_SHARE


def allocate_proportional(
    envelope_usd: float, asks_usd: Mapping[str, float], *, share: float = CHILD_RESERVE_SHARE
) -> Allocation:
    """Split ``envelope_usd`` among children asking ``asks_usd`` (estimated cost each)."""
    if envelope_usd < 0 or any(ask < 0 for ask in asks_usd.values()):
        raise ValueError("the envelope and every ask must be >= 0")
    asks = {child: to_micros(asks_usd[child]) for child in sorted(asks_usd)}
    return allocate_micros(to_micros(envelope_usd), asks, share=share)


def allocate_micros(
    envelope: int, asks: Mapping[str, int], *, share: float = CHILD_RESERVE_SHARE
) -> Allocation:
    """``allocate_proportional`` on integer units, for callers that already count in micros."""
    if envelope < 0 or not 0 <= share < 1:
        raise ValueError("the envelope must be >= 0 and the reserve share in [0, 1)")
    if any(ask < 0 for ask in asks.values()):
        raise ValueError("an ask cannot be negative")
    reserve = envelope * round(share * 10_000) // 10_000
    available = envelope - reserve
    asks = {child: asks[child] for child in sorted(asks)}
    total = sum(asks.values())

    if total <= available:
        grants = dict(asks)
    else:
        grants = {child: available * ask // total for child, ask in asks.items()}
        leftover = available - sum(grants.values())
        by_remainder = sorted(
            (child for child in asks if asks[child] > 0),
            key=lambda child: (-(available * asks[child] % total), child),
        )
        for child in by_remainder[:leftover]:
            grants[child] += 1
    pool = available - sum(grants.values())
    return Allocation(
        envelope_micros=envelope, reserve_micros=reserve, pool_micros=pool, grants_micros=grants
    )
