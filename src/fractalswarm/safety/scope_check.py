"""The deterministic scope check against task splitting (spec §13).

An attacker who cannot get a harmful task approved can try to split it into innocent-looking
subgoals, or slip one in through a poisoned input. Every subgoal therefore carries the
approved plan's **scope token** (its hash), and must:

1. carry the token of the plan that was approved;
2. map to an approved plan node;
3. keep its declared writes, tools and data categories inside that node's envelope
   (a new subgoal is measured against the union of every node's envelope).

Data categories are the declared ones plus those inferred from the subgoal's own text, so a
planner that forgets (or is tricked into omitting) ``pii.contact`` is still caught.

A subgoal that fails can still run with a ``scope.approval`` from an ancestor, bound to the
subgoal's digest. Sensitive data categories (personal data, secrets) need a human approver.
Otherwise the result is a ``scope.violation``.

This module is pure data and functions; ``planning/scope.py`` wires it to the real planner.
"""

import re

from pydantic import BaseModel, ConfigDict

from fractalswarm.kernel.ids import digest

HUMAN = "human"

# Categories no orchestrator can approve on its own.
SENSITIVE_PREFIXES = ("pii.", "secret")

# Text -> data category, checked on the subgoal's objective. Deliberately broad: a false
# positive asks for an approval, a false negative lets a split task through.
CATEGORY_RULES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (category, re.compile(pattern, re.IGNORECASE))
    for category, pattern in (
        (
            "pii.contact",
            r"\b(phone|mobile|cell)\s*(numbers?|nos?\.?)\b|\bhome (address|city|town)\b|"
            r"\bpersonal (email|e-mail|phone|contact|address)|\bcontact (sheet|list|details)\b|"
            r"\bwhere (they|each \w+) lives?\b",
        ),
        (
            "pii.identity",
            r"\b(passport|national id|dni|nie|social security|ssn|date of birth|birthdate)\b",
        ),
        ("pii.financial", r"\b(iban|bank account|credit card|card numbers?)\b"),
        ("pii.health", r"\b(medical|health|diagnos\w*|disabilit\w*)\b"),
        ("secret", r"\b(api[_ ]?keys?|passwords?|credentials|access tokens?)\b"),
    )
)


def infer_data_categories(text: str) -> list[str]:
    return sorted(category for category, pattern in CATEGORY_RULES if pattern.search(text))


def is_sensitive(category: str) -> bool:
    return category.startswith(SENSITIVE_PREFIXES)


class ApprovedNode(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str
    objective: str
    writes: list[str] = []
    tools: list[str] = []
    data_categories: list[str] = []


class ApprovedPlan(BaseModel):
    """What the human (or the root planner, within its own approval) signed off on."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    root_goal: str
    nodes: list[ApprovedNode]

    def node(self, node_id: str | None) -> ApprovedNode | None:
        return next((n for n in self.nodes if n.node_id == node_id), None)

    @property
    def scope_token(self) -> str:
        return scope_token(self)


def scope_token(plan: ApprovedPlan) -> str:
    """The plan hash. Node order does not matter; every list is compared as a set."""
    canonical = {
        "root_goal": plan.root_goal,
        "nodes": sorted(
            (
                {
                    "node_id": node.node_id,
                    "objective": node.objective,
                    "writes": sorted(set(node.writes)),
                    "tools": sorted(set(node.tools)),
                    "data_categories": sorted(set(node.data_categories)),
                }
                for node in plan.nodes
            ),
            key=lambda node: node["node_id"],
        ),
    }
    return "scope-" + digest(canonical)


class Subgoal(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    subgoal_id: str
    objective: str
    scope_token: str
    node_id: str | None = None  # the approved node it claims to implement; None if new
    writes: list[str] = []
    tools: list[str] = []
    data_categories: list[str] = []
    proposed_by: str = ""
    ancestors: list[str] = []  # orchestrators above the proposer, nearest first

    @property
    def digest(self) -> str:
        return digest(self.model_dump(mode="json", exclude={"proposed_by", "ancestors"}))


class Approval(BaseModel):
    """A ``scope.approval``: binds an approver to one exact subgoal under one plan."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    subgoal_id: str
    subgoal_digest: str
    approver: str
    scope_token: str
    reason: str = ""


class Violation(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str
    detail: str


class ScopeDecision(BaseModel):
    model_config = ConfigDict(frozen=True)

    allowed: bool
    subgoal_id: str
    scope_token: str
    node_id: str | None
    data_categories: list[str]
    violations: list[Violation] = []
    approved_by: str | None = None

    @property
    def codes(self) -> list[str]:
        return [v.code for v in self.violations]

    @property
    def reasons(self) -> list[str]:
        return [v.detail for v in self.violations]

    def violation_payload(self, evidence: dict | None = None) -> dict:
        """The payload of a ``scope.violation`` event."""
        return {
            "subgoal_id": self.subgoal_id,
            "scope_token": self.scope_token,
            "node_id": self.node_id,
            "codes": self.codes,
            "reasons": self.reasons,
            "data_categories": self.data_categories,
            "evidence": evidence or {},
        }


def _outside(kind: str, claimed: list[str], allowed: list[str], code: str) -> list[Violation]:
    extra = sorted(set(claimed) - set(allowed))
    if not extra:
        return []
    return [Violation(code=code, detail=f"{kind} {extra} are outside the approved envelope")]


def check_scope(
    plan: ApprovedPlan, subgoal: Subgoal, approvals: list[Approval] | tuple[Approval, ...] = ()
) -> ScopeDecision:
    token = plan.scope_token
    categories = sorted(
        set(subgoal.data_categories) | set(infer_data_categories(subgoal.objective))
    )
    violations: list[Violation] = []

    if subgoal.scope_token != token:
        violations.append(
            Violation(
                code="token_mismatch",
                detail="the subgoal carries the scope token of a different (unapproved) plan",
            )
        )
    node = plan.node(subgoal.node_id)
    if node is None:
        violations.append(
            Violation(
                code="unmapped_node",
                detail=f"no approved plan node {subgoal.node_id!r}; the subgoal is new",
            )
        )
        # A new subgoal is still measured against the whole plan's envelope.
        allowed_writes = sorted({w for n in plan.nodes for w in n.writes})
        allowed_tools = sorted({t for n in plan.nodes for t in n.tools})
        allowed_categories = sorted({c for n in plan.nodes for c in n.data_categories})
    else:
        allowed_writes, allowed_tools = node.writes, node.tools
        allowed_categories = node.data_categories
    violations += _outside("writes", subgoal.writes, allowed_writes, "write_outside_envelope")
    violations += _outside("tools", subgoal.tools, allowed_tools, "tool_outside_envelope")
    violations += _outside(
        "data categories", categories, allowed_categories, "data_category_outside_envelope"
    )

    decision = ScopeDecision(
        allowed=not violations,
        subgoal_id=subgoal.subgoal_id,
        scope_token=token,
        node_id=subgoal.node_id,
        data_categories=categories,
        violations=violations,
    )
    if not violations:
        return decision

    approval = _valid_approval(plan, subgoal, approvals, categories, allowed_categories)
    if approval is not None:
        return decision.model_copy(update={"allowed": True, "approved_by": approval.approver})
    return decision


def _valid_approval(
    plan: ApprovedPlan,
    subgoal: Subgoal,
    approvals: list[Approval] | tuple[Approval, ...],
    categories: list[str],
    allowed_categories: list[str],
) -> Approval | None:
    if subgoal.scope_token != plan.scope_token:
        return None  # a different plan is a new plan: it needs a fresh plan approval
    needs_human = any(is_sensitive(c) and c not in allowed_categories for c in categories)
    for approval in sorted(approvals, key=lambda a: (a.approver, a.subgoal_digest)):
        if (
            approval.subgoal_id != subgoal.subgoal_id
            or approval.subgoal_digest != subgoal.digest
            or approval.scope_token != plan.scope_token
        ):
            continue
        if needs_human and approval.approver != HUMAN:
            continue
        if approval.approver == HUMAN or approval.approver in subgoal.ancestors:
            return approval
    return None
