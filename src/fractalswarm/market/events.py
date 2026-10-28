"""Event types of the economy (spec §5.1: ``market.*``, ``scaling.*``), registered on import.

A market is one non-leaf goal: its owner is the market maker, the owners of its child goals
are the bidders. ``goal_id`` names the market, so it survives a takeover: the heir keeps
clearing the same goal's epochs. Money is in micro-dollars (``*_micros``); RPM and TPM slices
are plain units. Every write an owner makes carries its fencing token (``fence``), like the
other owner-scoped events.
"""

from typing import Any

from fractalswarm.kernel.events import Payload, register


@register("market.epoch_closed")
class MarketEpochClosed(Payload):
    """An epoch of the market of ``goal_id`` closed; the next one opens at ``at_ms``."""

    goal_id: str
    owner: str
    epoch: int
    reason: str  # start | timer | completions | membership | ownership | shock
    at_ms: int
    completions: int = 0  # contracts completed under this goal during the epoch
    member_epoch: int = 0
    fence: dict[str, Any] | None = None


@register("market.bids")
class MarketBids(Payload):
    """The sealed bids the epoch cleared: per child, ``q`` and ``floor`` per resource, the
    ``value`` (spec §7.2) and the ``density`` (value / q of the $ bid)."""

    goal_id: str
    epoch: int
    bids: list[dict[str, Any]]
    fence: dict[str, Any] | None = None


@register("market.cleared")
class MarketCleared(Payload):
    """The result of clearing. ``resources[name]`` is ``{envelope, reserve, pool, grants}``
    (conservation: ``sum(grants) + pool + reserve == envelope``); ``caps[child]`` is the
    cumulative cap on the $ its subtree may commit (``base[child]`` plus its grant), where
    ``base`` is what the subtree had committed when the market cleared."""

    goal_id: str
    epoch: int
    mode: str  # auction | proportional
    resources: dict[str, dict[str, Any]]
    caps: dict[str, int]
    base: dict[str, int]
    fence: dict[str, Any] | None = None


@register("market.refund")
class MarketRefund(Payload):
    """What children left unused of the last epoch's grants; it is back in the pool."""

    goal_id: str
    epoch: int
    refunds: dict[str, int]
    total_micros: int
    fence: dict[str, Any] | None = None


@register("market.topup")
class MarketTopup(Payload):
    """A ``topup.request`` from ``child``, granted from the reserve as far as it reaches."""

    goal_id: str
    epoch: int
    child: str
    requested_micros: int
    granted_micros: int
    reserve_left_micros: int
    cap_micros: int  # the child's cumulative cap after the top-up
    fence: dict[str, Any] | None = None


@register("market.quota")
class MarketQuota(Payload):
    """AIMD on the provider's rate limit for ``model`` (spec §6.1): the share of the limit
    the run may use changed. ``change``: init | decrease (x0.7 after pressure) | increase
    (+5% after a clean epoch) | hold."""

    goal_id: str
    epoch: int
    model: str
    change: str
    fraction: float
    limit_rpm: int  # the provider's limits for the model
    limit_tpm: int
    rpm: int  # the run's share of them: limit * fraction
    tpm: int
    pressure: int  # rate-limited calls seen since the last epoch
    fence: dict[str, Any] | None = None


@register("scaling.decided")
class ScalingDecided(Payload):
    """An autoscale decision (spec §7.3): ``kind`` is orchestrators | agents | recursion."""

    goal_id: str
    owner: str
    kind: str
    before: int
    after: int
    target: int
    reason: str
    detail: dict[str, Any] = {}
    fence: dict[str, Any] | None = None
