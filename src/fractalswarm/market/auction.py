"""The epoch auction's clearing (spec §7.2): a pure function over integer units.

One resource at a time ($ in micro-dollars, or an RPM/TPM slice in plain units). A parent's
envelope splits into a reserve (15% at the root, 10% below, kept for ``topup.request``s) and a
pool, which the children's bids share out in two passes:

1. **floors**: every child with ready work gets a floor allocation, enough for one contract,
   most valuable first, while the pool lasts;
2. **greedy**: what is left goes to the children by density, descending, each up to its ask.

Ties break by child id, so the answer never depends on the order bids arrive in. The result is
an ``Allocation`` (``market/allocation.py``), the same shape the proportional fallback
returns, and the conservation invariant ``sum(grants) + pool + reserve == envelope`` holds
exactly, because every step moves whole units.

``bid_value`` is the spec's value term. ``contract_risk`` is the one place the bid reads a
contract's risk from the plan; swap its body when a computed risk score replaces the plan's.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

from fractalswarm.market.allocation import CHILD_RESERVE_SHARE, Allocation

DEFAULT_RISK = 0.3  # what a contract planned without a risk carries (planning/contracts.py)


def contract_risk(contract: Mapping[str, Any]) -> float:
    """The risk r in [0, 1] of a contract, as the plan declared it (spec §12)."""
    return min(max(float(contract.get("risk", DEFAULT_RISK)), 0.0), 1.0)


def bid_value(
    priority: int, critical_path: float, risk: float, remaining_work_ratio: float
) -> float:
    """``priority_w * (1 + critical_path) * (1 + risk) * remaining_work_ratio`` (spec §7.2).

    ``priority_w`` is ``1 + priority`` (priority 0 still counts), ``critical_path`` the share
    of the child's remaining contracts that sit on the critical path.
    """
    return (1 + max(priority, 0)) * (1 + critical_path) * (1 + risk) * remaining_work_ratio


class Bid(BaseModel):
    """One child's sealed bid for one resource: ``q`` is its estimated need for the next
    epoch, ``floor`` what one contract needs (0 for a child with no ready work)."""

    model_config = ConfigDict(frozen=True)

    child: str
    q: int
    floor: int = 0
    value: float

    @model_validator(mode="after")
    def _sane(self) -> "Bid":
        if self.q < 0 or self.value < 0 or not 0 <= self.floor <= self.q:
            raise ValueError("a bid needs 0 <= floor <= q and a value >= 0")
        return self

    @property
    def density(self) -> float:
        return self.value / self.q if self.q > 0 else 0.0


def reserve_of(envelope: int, share: float) -> int:
    return envelope * round(share * 10_000) // 10_000


def clear(envelope: int, bids: Iterable[Bid], *, share: float = CHILD_RESERVE_SHARE) -> Allocation:
    """Clear one resource: floors first, then greedily by density (ties by child id)."""
    if envelope < 0 or not 0 <= share < 1:
        raise ValueError("the envelope must be >= 0 and the reserve share in [0, 1)")
    ordered = sorted(bids, key=lambda bid: (-bid.density, bid.child))
    if len({bid.child for bid in ordered}) != len(ordered):
        raise ValueError("one bid per child")
    reserve = reserve_of(envelope, share)
    left = envelope - reserve
    grants = dict.fromkeys((bid.child for bid in ordered), 0)
    for bid in ordered:  # pass 1: the floors
        given = min(bid.floor, left)
        grants[bid.child] = given
        left -= given
    for bid in ordered:  # pass 2: the rest, by density
        given = min(bid.q - grants[bid.child], left)
        grants[bid.child] += given
        left -= given
    return Allocation(
        envelope_micros=envelope,
        reserve_micros=reserve,
        pool_micros=left,
        grants_micros=dict(sorted(grants.items())),
    )


def refunds(granted: Mapping[str, int], used: Mapping[str, int]) -> dict[str, int]:
    """What each child leaves unused of last epoch's grants, which goes back to the pool."""
    return {
        child: granted[child] - min(used.get(child, 0), granted[child])
        for child in sorted(granted)
        if granted[child] > used.get(child, 0)
    }


def grant_topups(reserve_left: int, requests: Iterable[Bid]) -> Allocation:
    """``topup.request``s are granted from the parent's reserve with the same formula: the
    reserve is the envelope, none of it is held back, and the requests are the bids."""
    return clear(reserve_left, requests, share=0.0)
