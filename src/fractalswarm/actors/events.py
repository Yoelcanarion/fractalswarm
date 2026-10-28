"""Event types of the orchestrator tree, the agents and the blackboard (spec §5.1).

Kept apart from ``kernel/events.py`` so the kernel stays task-agnostic; importing the actors
registers them.
"""

from typing import Any

from fractalswarm.kernel.events import Payload, register


@register("plan.proposed")
class PlanProposed(Payload):
    goal_id: str
    plan: dict[str, Any]
    plan_hash: str
    fallback: bool = False
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("plan.approved")
class PlanApproved(Payload):
    goal_id: str
    scope_token: str
    by: str  # auto (bench mode) | human
    envelope: dict[str, Any] | None = None  # the ApprovedPlan the token hashes (spec §13)
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("plan.refined")
class PlanRefined(Payload):
    """A non-root orchestrator split its subgoal into children or contracts."""

    goal_id: str
    owner: str
    children: list[str]
    plan: dict[str, Any]
    fallback: bool = False
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("plan.rejected")
class PlanRejected(Payload):
    goal_id: str
    attempt: int
    errors: list[str]
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("ownership.assigned")
class OwnershipAssigned(Payload):
    group: str  # the parent whose child group owns the key
    key: str
    owner: str
    member_epoch: int = 0
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("contract.created")
class ContractCreated(Payload):
    contract: dict[str, Any]
    work: str = ""  # gid/cid: the contract's run-wide key (chaos progress, takeover)
    owner: str = ""
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("contract.dispatched")
class ContractDispatched(Payload):
    goal_id: str
    contract_id: str
    attempt: int
    assignee: str
    idem_key: str
    work: str = ""  # gid/cid: the contract's run-wide key (chaos progress, takeover)
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("contract.completed")
class ContractCompleted(Payload):
    goal_id: str
    contract_id: str
    attempt: int
    agent: str
    status: str
    steps: int = 0
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("contract.verified")
class ContractVerified(Payload):
    goal_id: str
    contract_id: str
    attempt: int
    work: str = ""  # gid/cid: the contract's run-wide key (chaos progress, takeover)
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("contract.rejected")
class ContractRejected(Payload):
    goal_id: str
    contract_id: str
    attempt: int
    stage: str  # agent | checks | judge | audit | booking
    reasons: list[str]
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("contract.failed")
class ContractFailed(Payload):
    goal_id: str
    contract_id: str
    attempt: int
    reasons: list[str]
    work: str = ""  # gid/cid: the contract's run-wide key (chaos progress, takeover)
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("verify.judged")
class VerifyJudged(Payload):
    goal_id: str
    contract_id: str
    attempt: int
    verdict: str
    score: float
    reasons: list[str]
    reused: bool = False  # a dead owner's judge verdict, adopted from the log
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("fact.published")
class FactPublished(Payload):
    key: str
    subject: str
    status: str
    squad: str
    agent: str
    contract: str
    version: int


@register("fact.promoted")
class FactPromoted(Payload):
    key: str
    by: str


@register("artifact.written")
class ArtifactWritten(Payload):
    path: str
    version: int
    author: str
    size: int


@register("web.hits")
class WebHits(Payload):
    """Search results that passed the firewall: their URLs may be fetched from now on."""

    source: str  # web_search:<effect id>, the provenance of each URL
    query: str
    urls: list[str]


@register("web.page")
class WebPage(Payload):
    """A fetched page that passed the firewall and reached an agent: the run's citable evidence.
    ``text`` is what the agent saw, so a quote can be checked against it."""

    url: str
    final_url: str
    source: str  # the provenance of the URL: task | web_search:<effect id>
    chars: int
    truncated: bool = False
    text: str


@register("lease.booked")
class LeaseBooked(Payload):
    holder: str
    goal_id: str
    keys: list[str]


@register("collision.detected")
class CollisionDetected(Payload):
    kind: str  # temporal (slot keys) | goal
    goal_id: str
    holder: str
    conflicts: list[dict[str, Any]]


@register("collision.resolved")
class CollisionResolved(Payload):
    kind: str
    goal_id: str
    resolution: str
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("goal.completed")
class GoalCompleted(Payload):
    goal_id: str
    owner: str
    status: str  # ok | partial | failed
    gaps: list[str] = []
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("task.result")
class TaskResult(Payload):
    task: str
    status: str
    report: dict[str, Any]
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)
