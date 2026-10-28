"""Bids derived from the log (spec §7.2): what each child goal of a market asks for.

The unit of account is the goal, not the actor: a goal keeps its place in the tree when its
owner dies and an heir takes it over, so the market of a goal continues unchanged. A child's
bid is a pure function of what the log says about its subtree (``TreeView``: the plan, each
contract's budget, risk and critical-path flag, and its status), so whoever makes the market,
the maker or its heir after a takeover, computes the same bids. They are logged with the
clearing for audit.

Work that is not planned yet is estimated from the shape of the tree: a planning call plus
what the goals below it will cost.
"""

import math
from dataclasses import dataclass
from typing import Any

from fractalswarm.market.allocation import to_micros
from fractalswarm.market.auction import DEFAULT_RISK, Bid, bid_value, contract_risk

OPEN = ("pending", "running")  # a contract that is neither verified nor failed


@dataclass(frozen=True)
class Estimates:
    """What work is expected to cost, in micro-dollars, where the plan says nothing."""

    plan: int = 10_000  # one planning call
    contract: int = 30_000  # a typical contract; a smaller budget declared in the plan wins
    contracts_per_leaf: int = 3
    fanout: tuple[int, ...] = (3, 2)  # children per level, for goals not split yet
    leaf_level: int = 2

    @classmethod
    def from_args(cls, args: dict[str, Any]) -> "Estimates":
        fanout = tuple(int(n) for n in args["fanout"])
        return cls(
            plan=to_micros(args["plan_usd"]),
            contract=to_micros(args["contract_usd"]),
            contracts_per_leaf=int(args["contracts_per_leaf"]),
            fanout=fanout,
            leaf_level=int(args.get("leaf_level", len(fanout))),
        )


@dataclass(frozen=True)
class Need:
    """The remaining work of a goal's subtree."""

    usd: int = 0  # estimated cost (micros)
    remaining: int = 0  # contracts not finished
    total: int = 0
    critical: int = 0  # remaining contracts on the critical path
    risk: float = 0.0  # the riskiest remaining contract
    priority: int = 0
    ready: bool = False

    def __add__(self, other: "Need") -> "Need":
        return Need(
            usd=self.usd + other.usd,
            remaining=self.remaining + other.remaining,
            total=self.total + other.total,
            critical=self.critical + other.critical,
            risk=max(self.risk, other.risk),
            priority=max(self.priority, other.priority),
            ready=self.ready or other.ready,
        )


def unplanned(level: int, est: Estimates, priority: int = 0) -> Need:
    """A goal nobody has planned: the planning call plus what it will split into."""
    if level >= est.leaf_level:
        n = est.contracts_per_leaf
        usd = est.plan + n * est.contract
        return Need(usd=usd, remaining=n, total=n, risk=DEFAULT_RISK, priority=priority, ready=True)
    width = est.fanout[level] if level < len(est.fanout) else 1
    inner = unplanned(level + 1, est, priority)
    return Need(
        usd=est.plan + width * inner.usd,
        remaining=width * inner.remaining,
        total=width * inner.total,
        risk=DEFAULT_RISK,
        priority=priority,
        ready=True,
    )


def goal_need(tree: Any, gid: str, est: Estimates) -> Need:
    """What is left to do under goal ``gid``, from the contracts the log knows."""
    record = tree.goals.get(gid)
    if record is None or record.done:
        return Need()
    priority = int(record.goal.get("priority", 0))
    if record.contracts:
        return _contracts_need(record, est, priority)
    children = tree.children_goals(gid)
    if children:
        total = Need(priority=priority)
        for child in children:
            total = total + goal_need(tree, child, est)
        return total
    return unplanned(record.level, est, priority)


def contract_estimate(contract: dict[str, Any], est: Estimates) -> int:
    """What one contract is expected to cost: the planner's budget for it is a ceiling, and
    the estimate is the smaller of that and the configured typical cost."""
    declared = to_micros(contract.get("budget", {}).get("usd", 0))
    return min(declared, est.contract) if declared > 0 else est.contract


def _contracts_need(record: Any, est: Estimates, priority: int) -> Need:
    open_ = [found.contract for found in record.contracts.values() if found.status in OPEN]
    return Need(
        usd=sum(contract_estimate(c, est) for c in open_),
        remaining=len(open_),
        total=len(record.contracts),
        critical=sum(1 for c in open_ if c.get("critical_path")),
        risk=max((contract_risk(c) for c in open_), default=0.0),
        priority=priority,
        ready=bool(open_),
    )


def subtree_goals(tree: Any, gid: str) -> list[str]:
    """``gid`` and every goal below it."""
    found, stack = [], [gid]
    while stack:
        current = stack.pop()
        found.append(current)
        stack.extend(tree.children_goals(current))
    return sorted(found)


def subtree_squads(tree: Any, gid: str) -> list[str]:
    """The squads that work under ``gid``: the current owners of its goals."""
    owners = {tree.owner_of(goal) for goal in subtree_goals(tree, gid)}
    return sorted(owner for owner in owners if owner is not None)


def spent(tree: Any, market: Any, gid: str) -> int:
    """The $ settled by the squads working under ``gid``. This is what the market's envelopes,
    bases and caps count. Open reservations do not: they are worst cases that settle for a
    third of their size or less, so counting them would leave a tight budget with no envelope
    for the work it is meant to pay for (the leaf squads' ledger caps, which the ledger checks
    against committed money, are the exception: ``MarketView.committed``)."""
    if tree.goals[gid].parent is None:  # the root goal: the whole run
        return market.run_spent
    return sum(market.spent.get(squad, 0) for squad in subtree_squads(tree, gid))


def floor_requirement(tree: Any, gid: str, est: Estimates, floor: int, reserve: float) -> int:
    """What the market below ``gid`` needs to give each of its squads their floor: a leaf
    goal's squad needs ``floor``; a goal above them needs the sum of its children's, grossed
    up for the reserve its own market holds back. A parent that asks for less starves the
    market below it, whatever the money in the run."""
    record = tree.goals.get(gid)
    level = record.level if record is not None else est.leaf_level
    if level >= est.leaf_level:
        return floor
    children = tree.children_goals(gid) if record is not None else []
    if children:
        below = sum(floor_requirement(tree, child, est, floor, reserve) for child in children)
    else:
        width = est.fanout[level] if level < len(est.fanout) else 1
        below = width * unplanned_floor(level + 1, est, floor, reserve)
    return math.ceil(below / (1 - reserve))


def unplanned_floor(level: int, est: Estimates, floor: int, reserve: float) -> int:
    """``floor_requirement`` of a goal at ``level`` that nobody has planned."""
    if level >= est.leaf_level:
        return floor
    width = est.fanout[level] if level < len(est.fanout) else 1
    return math.ceil(width * unplanned_floor(level + 1, est, floor, reserve) / (1 - reserve))


def usd_bid(child: str, need: Need, floor: int) -> Bid:
    """The $ bid of a child goal. A live child always asks for at least its floor, so that a
    sibling's takeover finds headroom; its value is zero when it has nothing left to do."""
    value = 0.0
    if need.remaining:
        critical = need.critical / need.remaining
        value = bid_value(need.priority, critical, need.risk, need.remaining / max(need.total, 1))
    return Bid(child=child, q=max(need.usd, floor), floor=floor, value=value)
