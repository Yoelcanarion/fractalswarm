"""The risk score r of a contract (spec §12).

``r`` is in [0, 1]: a weighted sum of five terms, each normalized to [0, 1] and non-decreasing
in the risk it measures.

- cost uncertainty: ``1 - P50/P90`` of the contract's cost (0 when the cost is certain,
  towards 1 as the P90 outgrows the median);
- critical path: 1 when a delay or a bad result here delays the whole run;
- tool risk: what its tools can touch, the noisy-or of the per-tool risks, so a tool added
  never lowers it, and a tool this table does not know counts as the riskiest;
- planner risk: the plan's own ``risk`` field, the planner's self-reported confidence turned
  around (``1 - confidence``);
- role failure rate: the share of the role's attempts that did not verify, read from the log
  (``RoleHistoryView``), smoothed with a prior so a role with no history is not trusted blindly.

``risk_score`` is the one function other code calls: the cross-squad audit samples by it
(``verify/cross_audit.py``) and the market's bid value can take it as the ``risk`` of
spec §7.2. Everything here is pure and price-free, so it replays.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

from fractalswarm.kernel.events import Event
from fractalswarm.planning.contracts import Contract

# What a tool can touch if it misbehaves: reads are cheap, writes into shared or external
# state are not. Tools this table lacks are denied by default at run time (safety/capabilities.py).
TOOL_RISK: dict[str, float] = {
    "memory.search": 0.05,
    "workspace.read": 0.10,
    "memory.publish_fact": 0.30,
    "workspace.write": 0.35,
    "web_search": 0.50,
    "fetch": 0.80,
}
UNKNOWN_TOOL_RISK = 1.0

# A role with no history fails once in ten attempts; observations move it from there.
PRIOR_FAILURES = 1
PRIOR_ATTEMPTS = 10

# Cost of an agent loop in units of its first call: every tool turn adds this share of the
# first call's input to the next call, because each call resends the whole conversation.
STEP_GROWTH = 0.3
# The loop takes about one tool turn per tool plus the answer (P50); the P90 loop takes one
# more turn.
P90_EXTRA_STEPS = 1


class RiskWeights(BaseModel):
    """How much each term counts. The weights sum to 1, so r stays in [0, 1].

    The critical path counts little here because the audit samples all of it anyway: the
    weights decide where the rest of the contracts fall. A non-critical contract reaches the
    50% band (r >= 0.4) when its planner calls it very risky, and the 100% band (r >= 0.7)
    only with a planner, a role history and tools that all say so.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    cost_uncertainty: float = 0.15
    critical_path: float = 0.15
    tool: float = 0.15
    planner: float = 0.30
    role_failure: float = 0.25

    @model_validator(mode="after")
    def _sum_to_one(self) -> "RiskWeights":
        values = list(self.model_dump().values())
        if any(value < 0 for value in values) or abs(sum(values) - 1.0) > 1e-9:
            raise ValueError("risk weights must be non-negative and sum to 1")
        return self


DEFAULT_WEIGHTS = RiskWeights()


class RiskTerms(BaseModel):
    """The five normalized terms of one contract, each in [0, 1]."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    cost_uncertainty: float
    critical_path: float
    tool: float
    planner: float
    role_failure: float


class RiskScore(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    r: float
    terms: RiskTerms


def _unit(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def cost_uncertainty(p50_usd: float, p90_usd: float) -> float:
    """``1 - P50/P90``: 0 for a certain cost, 1 when the median is nothing against the P90."""
    if p90_usd <= 0:
        return 0.0
    return _unit(1.0 - max(p50_usd, 0.0) / p90_usd)


def tool_risk(tools: Iterable[str]) -> float:
    safe = 1.0
    for tool in sorted(set(tools)):
        safe *= 1.0 - TOOL_RISK.get(tool, UNKNOWN_TOOL_RISK)
    return _unit(1.0 - safe)


def failure_rate(failures: int, attempts: int) -> float:
    """The role's failure rate with the prior: (failures + 1) / (attempts + 10)."""
    return _unit((failures + PRIOR_FAILURES) / (attempts + PRIOR_ATTEMPTS))


def risk_terms(
    *,
    cost_p50_usd: float,
    cost_p90_usd: float,
    critical_path: bool,
    tools: Iterable[str],
    planner_risk: float,
    role_failure_rate: float,
) -> RiskTerms:
    return RiskTerms(
        cost_uncertainty=cost_uncertainty(cost_p50_usd, cost_p90_usd),
        critical_path=1.0 if critical_path else 0.0,
        tool=tool_risk(tools),
        planner=_unit(planner_risk),
        role_failure=_unit(role_failure_rate),
    )


def weighted(terms: RiskTerms, weights: RiskWeights = DEFAULT_WEIGHTS) -> float:
    total = (
        weights.cost_uncertainty * terms.cost_uncertainty
        + weights.critical_path * terms.critical_path
        + weights.tool * terms.tool
        + weights.planner * terms.planner
        + weights.role_failure * terms.role_failure
    )
    return _unit(total)


def risk_score(
    *,
    cost_p50_usd: float,
    cost_p90_usd: float,
    critical_path: bool,
    tools: Iterable[str],
    planner_risk: float,
    role_failure_rate: float,
    weights: RiskWeights = DEFAULT_WEIGHTS,
) -> float:
    """r in [0, 1] for one contract (spec §12): the weighted sum of its five terms."""
    terms = risk_terms(
        cost_p50_usd=cost_p50_usd,
        cost_p90_usd=cost_p90_usd,
        critical_path=critical_path,
        tools=tools,
        planner_risk=planner_risk,
        role_failure_rate=role_failure_rate,
    )
    return weighted(terms, weights)


# -- a contract's cost band and its score -------------------------------------------------


def loop_cost(steps: int) -> float:
    """The cost of an agent loop of ``steps`` calls, in units of its first call."""
    return steps + STEP_GROWTH * steps * (steps - 1) / 2


def loop_cost_band(contract: Contract) -> tuple[float, float]:
    """(P50, P90) of the contract's cost in units of its first call. Both depend only on the
    contract, so they never need the price table: P90/P50 is the same in dollars."""
    cap = max(contract.budget.max_steps, 1)
    p50 = min(len(contract.tools) + 1, cap)
    p90 = min(p50 + P90_EXTRA_STEPS, cap)
    return loop_cost(p50), loop_cost(p90)


def role_key(contract: Contract | Mapping[str, Any]) -> str:
    """What the history of a role is kept under: the contract's kind (what the task does with
    it: extract, place, blurb), else its role."""
    get = contract.get if isinstance(contract, Mapping) else lambda key: getattr(contract, key)
    return str(get("kind") or get("role") or "agent")


def contract_risk(
    contract: Contract,
    history: "RoleHistoryView | None" = None,
    weights: RiskWeights = DEFAULT_WEIGHTS,
) -> RiskScore:
    """The risk score of a contract, with the terms that make it."""
    p50, p90 = loop_cost_band(contract)
    rate = history.failure_rate(role_key(contract)) if history is not None else failure_rate(0, 0)
    terms = risk_terms(
        cost_p50_usd=p50,
        cost_p90_usd=p90,
        critical_path=contract.critical_path,
        tools=contract.tools,
        planner_risk=contract.risk,
        role_failure_rate=rate,
    )
    return RiskScore(r=weighted(terms, weights), terms=terms)


# -- the role's history, as a view of the log ---------------------------------------------


class RoleHistoryView:
    """Per role: how many attempts verified and how many did not, counted from the log, so
    every orchestrator (and every replay) reads the same history.

    An attempt that is rejected (an agent error, a failed check, the judge, a booking conflict
    or the audit) is a failure; one that ends in ``contract.verified`` is a success. A contract
    lost with its agent is neither.
    """

    name = "role_history"

    def __init__(self) -> None:
        self.roles: dict[str, str] = {}  # work (gid/cid) -> role key
        self.attempts: dict[str, int] = {}
        self.failures: dict[str, int] = {}

    def failure_rate(self, role: str) -> float:
        return failure_rate(self.failures.get(role, 0), self.attempts.get(role, 0))

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        payload = event.payload
        if event.type == "contract.created":
            contract = payload["contract"]
            self.roles.setdefault(f"{contract['goal_id']}/{contract['id']}", role_key(contract))
        elif event.type == "contract.verified":
            self._count(f"{payload['goal_id']}/{payload['contract_id']}", failed=False)
        elif event.type == "contract.rejected" and payload["stage"] != "lost":
            self._count(f"{payload['goal_id']}/{payload['contract_id']}", failed=True)

    def _count(self, work: str, failed: bool) -> None:
        role = self.roles.get(work)
        if role is None:
            return
        self.attempts[role] = self.attempts.get(role, 0) + 1
        if failed:
            self.failures[role] = self.failures.get(role, 0) + 1
