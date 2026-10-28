"""The scope check on the real planner (spec §13), over ``safety/scope_check.py``.

The root's approved plan becomes an ``ApprovedPlan``: the task lists its nodes (each approved
subgoal, and each kind of subgoal and contract below them) with their envelope of writes,
tools and data categories. Its hash is the scope token that every subgoal and contract
carries. ``plan.approved`` records the envelope, so any orchestrator, an heir included, reads
it back from the log through ``ScopeView``.

Below the root, each orchestrator checks what its planner proposes before acting on it:
- its decomposition (sessions, contracts), whose items claim an approved node;
- the extra work its inputs asked for (``requests``), which claims none, so it is blocked
  unless an ancestor (or a human, for personal data) approved that exact subgoal.

A blocked item becomes a ``scope.violation`` whose evidence links its source, the source's
firewall verdict and the branch of the tree that proposed it.
"""

from typing import Any

import fractalswarm.safety.events  # noqa: F401  (registers the audit event types)
from fractalswarm.kernel.events import Event
from fractalswarm.safety.scope_check import (
    Approval,
    ApprovedNode,
    ApprovedPlan,
    ScopeDecision,
    Subgoal,
    Violation,
    check_scope,
    infer_data_categories,
)

SUBGOAL_FIELDS = ("subgoal_id", "objective", "node_id", "writes", "tools", "data_categories")


def approve(goal_text: str, nodes: list[ApprovedNode]) -> ApprovedPlan:
    return ApprovedPlan(root_goal=goal_text, nodes=nodes)


class ScopeView:
    """Approved plans by scope token, firewall verdicts by source, and scope approvals."""

    name = "scope"

    def __init__(self) -> None:
        self.plans: dict[str, ApprovedPlan] = {}
        self.latest: str = ""  # the token of the last approved plan
        self.scans: dict[str, dict[str, Any]] = {}
        self.approvals: list[Approval] = []

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        payload = event.payload
        if event.type == "plan.approved" and payload.get("envelope"):
            plan = ApprovedPlan.model_validate(payload["envelope"])
            self.plans[plan.scope_token] = plan
            self.latest = plan.scope_token
        elif event.type == "security.scanned":
            keys = ("surface", "decision", "score", "backend")
            self.scans[payload["source_id"]] = {key: payload[key] for key in keys}
        elif event.type == "scope.approval":
            self.approvals.append(Approval.model_validate(payload))


def check(
    view: ScopeView,
    proposals: list[dict[str, Any]],
    token: str,
    proposer: str,
    ancestors: list[str],
) -> list[tuple[dict[str, Any], ScopeDecision]]:
    """The decision on each proposal: a dict of ``Subgoal`` fields, plus ``source_id`` when
    an input asked for it."""
    plan = view.plans.get(token)
    decisions = []
    for proposal in proposals:
        fields = {key: proposal[key] for key in SUBGOAL_FIELDS if key in proposal}
        subgoal = Subgoal(scope_token=token, proposed_by=proposer, ancestors=ancestors, **fields)
        if plan is None:
            decision = ScopeDecision(
                allowed=False,
                subgoal_id=subgoal.subgoal_id,
                scope_token=token,
                node_id=subgoal.node_id,
                data_categories=sorted(
                    set(subgoal.data_categories) | set(infer_data_categories(subgoal.objective))
                ),
                violations=[
                    Violation(code="unknown_scope_token", detail="no approved plan has this token")
                ],
            )
        else:
            decision = check_scope(plan, subgoal, view.approvals)
        decisions.append((proposal, decision))
    return decisions


def evidence(
    view: ScopeView, proposal: dict[str, Any], branch: str, proposer: str
) -> dict[str, Any]:
    """What the audit entry links: the source and its firewall verdict, and the branch."""
    found: dict[str, Any] = {
        "objective": proposal["objective"],
        "branch": branch,
        "proposed_by": proposer,
    }
    source = proposal.get("source_id")
    if source:
        scan = view.scans.get(source)
        found["source_id"] = source
        if scan is not None:
            found |= {"firewall_decision": scan["decision"], "score": scan["score"]}
            found["backend"] = scan["backend"]
    return found
