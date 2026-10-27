"""Audit event types of the safety layer (spec §13). Importing this module registers them.

Actors emit these with ``Emit``; ``verify/audit.py`` and the UI security view read them.
"""

from typing import Any

from fractalswarm.kernel.events import Payload, register


@register("security.scanned")
class SecurityScanned(Payload):
    """A firewall verdict on one piece of text (intake, attachment, external, fact)."""

    surface: str
    source_id: str
    decision: str  # allow | quarantine | block
    score: float
    backend: str
    reasons: list[str] = []
    findings: list[str] = []


@register("security.quarantined")
class SecurityQuarantined(Payload):
    source_id: str
    surface: str
    score: float
    reason: str
    stub: str


@register("security.policy")
class SecurityPolicy(Payload):
    """The intake policy classifier's decision on a task."""

    task_id: str
    decision: str  # allow | constrain | refuse
    categories: list[str] = []
    explanation: str = ""
    constraints: list[str] = []


@register("security.routed")
class SecurityRouted(Payload):
    """A Contributor routing decision (spec §7.5)."""

    request_id: str
    contributor: bool
    reason: str
    findings: list[str] = []


@register("tool.denied")
class ToolDenied(Payload):
    tool: str
    reason: str
    contract: str | None = None
    target: str | None = None


@register("scope.approval")
class ScopeApproval(Payload):
    subgoal_id: str
    subgoal_digest: str
    approver: str
    scope_token: str
    reason: str = ""


@register("scope.violation")
class ScopeViolation(Payload):
    subgoal_id: str
    scope_token: str
    node_id: str | None = None
    codes: list[str]
    reasons: list[str]
    data_categories: list[str] = []
    # Links for the audit trail: the source that caused the subgoal, its firewall score, the
    # branch of the tree that proposed it.
    evidence: dict[str, Any] = {}
