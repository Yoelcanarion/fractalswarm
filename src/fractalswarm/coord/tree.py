"""The orchestrator tree as a view of the log, and leaderless takeover at every level (spec §5.3).

Shared log, not shared brain: an orchestrator keeps its working state for a goal in its own
memory, but every fact it acted on is in the log. ``TreeView`` is a kernel reducer that
materializes those facts for every actor to read through ``View.views["tree"]``:

- the goals: who owns each one, its parent goal and level, its plan, its children, and the
  result it sent upward;
- each leaf goal's contracts: the latest version sent to an agent, its status, and every
  agent result, judge verdict and booking outcome, by attempt. Results addressed to an owner
  that has died are in the log too (``msg.sent`` is appended before delivery is attempted);
- the tree's parent links, re-wired by ``tree.adopted``.

When the members view says an owner is dead, every survivor computes the same heir for each of
its unfinished goals with ``heir``: bounded-load HRW over the dead owner's live siblings (the
root's heir comes from its children, as the root has no siblings). Only the heir writes
``ownership.remapped``, and it rebuilds the goal from this view, adopting the orphans' results
instead of paying for them twice. Nobody asks anybody and no LLM is called.
"""

from dataclasses import dataclass, field
from typing import Any

from fractalswarm.coord.hrw import remap
from fractalswarm.kernel.events import Event, Payload, register

ROLE = "coordinator"


@register("ownership.remapped")
class OwnershipRemapped(Payload):
    """``owner`` took over goal ``key`` from the dead ``previous`` (spec §5.3)."""

    group: str | None
    key: str
    owner: str
    previous: str
    works: list[str] = []  # the goal's unfinished contracts, as work keys (gid/cid)
    adopted_results: int = 0  # orphan results already in the log, adopted for free
    fence: dict[str, Any] | None = None


@register("tree.adopted")
class TreeAdopted(Payload):
    """The dead orchestrator's child group (orchestrators or agents) moves under ``adopter``."""

    dead: str
    adopter: str
    goal_id: str
    children: list[str]
    duties: list[str] = []  # integration | arbitration | final integration (the root's)
    fence: dict[str, Any] | None = None


@dataclass
class ContractRecord:
    contract: dict[str, Any]
    status: str = "pending"  # pending | running | verified | failed
    results: dict[int, dict[str, Any]] = field(default_factory=dict)  # attempt -> result body
    judged: dict[int, tuple[str, str]] = field(default_factory=dict)  # attempt -> (status, text)
    booked: dict[int, list[Any]] = field(default_factory=dict)  # attempt -> conflicts


@dataclass
class GoalRecord:
    goal: dict[str, Any]
    owner: str
    parent: str | None  # the parent goal's id
    level: int
    plan: dict[str, Any] | None = None
    children: list[str] = field(default_factory=list)  # contract ids (leaf goals)
    contracts: dict[str, ContractRecord] = field(default_factory=dict)
    result: dict[str, Any] | None = None  # what it sent upward
    done: bool = False


class TreeView:
    name = "tree"

    def __init__(self) -> None:
        self.goals: dict[str, GoalRecord] = {}
        self.parents: dict[str, str | None] = {}  # actor -> parent actor
        self.kinds: dict[str, str] = {}  # actor -> kind

    # -- queries --------------------------------------------------------------------------

    def children_goals(self, gid: str) -> list[str]:
        return sorted(g for g, record in self.goals.items() if record.parent == gid)

    def child_actors(self, actor: str, kind: str | None = None) -> list[str]:
        return sorted(
            child
            for child, parent in self.parents.items()
            if parent == actor and (kind is None or self.kinds.get(child) == kind)
        )

    def owner_of(self, gid: str | None) -> str | None:
        record = self.goals.get(gid) if gid is not None else None
        return record.owner if record is not None else None

    # -- the reducer ----------------------------------------------------------------------

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        payload = event.payload
        kind = event.type
        if kind == "actor.spawned":
            self._spawned(payload)
        elif kind == "msg.sent":
            self._message(event.actor, payload["to"], payload["topic"], payload["body"])
        elif kind == "ownership.remapped":
            record = self.goals.get(payload["key"])
            if record is not None:
                record.owner = payload["owner"]
        elif kind == "tree.adopted":
            for child in payload["children"]:
                self.parents[child] = payload["adopter"]
        elif kind == "plan.proposed" and payload["goal_id"] in self.goals:
            self.goals[payload["goal_id"]].plan = payload["plan"]
        elif kind == "plan.refined" and payload["goal_id"] in self.goals:
            record = self.goals[payload["goal_id"]]
            record.plan = payload["plan"]
            record.children = list(payload["children"])
        elif kind == "contract.created":
            contract = payload["contract"]
            record = self.goals.get(contract["goal_id"])
            if record is not None and contract["id"] not in record.contracts:
                record.contracts[contract["id"]] = ContractRecord(contract=contract)
        elif kind in ("contract.verified", "contract.failed", "contract.rejected"):
            found = self._contract(payload["goal_id"], payload["contract_id"])
            if found is not None:
                status = {"contract.verified": "verified", "contract.failed": "failed"}
                found.status = status.get(kind, "pending")
        elif kind == "effect.completed" and (payload.get("tag") or "").startswith("judge|"):
            _, gid, cid, attempt = payload["tag"].split("|")
            found = self._contract(gid, cid)
            if found is not None:
                text = (payload.get("result") or {}).get("output_text", "")
                found.judged[int(attempt)] = (payload["status"], text)
        elif kind == "goal.completed" and payload["goal_id"] in self.goals:
            self.goals[payload["goal_id"]].done = True

    def _spawned(self, payload: dict[str, Any]) -> None:
        actor = payload["actor_id"]
        self.parents[actor] = payload["parent"]
        self.kinds[actor] = payload["kind"]
        root = (payload.get("args") or {}).get("root_goal")
        if payload["kind"] == "orchestrator" and root is not None and root["id"] not in self.goals:
            self.goals[root["id"]] = GoalRecord(goal=root, owner=actor, parent=None, level=0)

    def _message(self, sender: str, to: str, topic: str, body: dict[str, Any]) -> None:
        if topic == "assign":
            goal = body["goal"]
            if goal["id"] not in self.goals:
                self.goals[goal["id"]] = GoalRecord(
                    goal=goal, owner=to, parent=body.get("parent"), level=int(body.get("level", 0))
                )
        elif topic == "contract":
            contract = body["contract"]
            found = self._contract(contract["goal_id"], contract["id"])
            if found is not None:
                found.contract = contract
                found.status = "running"
        elif topic == "contract.result":
            found = self._contract(body["goal_id"], body["contract_id"])
            if found is not None:
                found.results.setdefault(int(body["attempt"]), body)
        elif topic == "book.result":
            found = self._contract(body["goal_id"], body["contract_id"])
            if found is not None:
                found.booked.setdefault(int(body["attempt"]), list(body["conflicts"]))
        elif topic == "result":
            record = self.goals.get(body["goal_id"])
            if record is not None and record.result is None:
                record.result = body

    def _contract(self, gid: str, cid: str) -> ContractRecord | None:
        record = self.goals.get(gid)
        return record.contracts.get(cid) if record is not None else None


def candidates(dead: str, members: Any) -> list[str]:
    """Who may inherit from a dead orchestrator (spec §5.3): its live siblings. The root has
    none, so its heir comes from its live children (failing them, any live coordinator).
    An empty answer means a whole sibling group died: the owner of the parent goal then
    spawns a new member into the group, which inherits on its first tick."""
    record = members.get(dead)
    group = record.group if record is not None else None
    if group is not None:
        return members.alive(role=ROLE, group=group)
    return members.alive(role=ROLE, group=dead) or members.alive(role=ROLE)


def heir(tree: TreeView, gid: str, members: Any) -> str | None:
    """The new owner of a dead owner's goal: bounded-load HRW over ``candidates`` (spec §5.3).

    The keys are the goal and its siblings (the children of its parent goal), so a survivor
    that already owns siblings counts them as load. Every survivor gets the same answer.
    ``None``: no candidate is alive.
    """
    record = tree.goals[gid]
    pool = candidates(record.owner, members)
    if not pool:
        return None
    siblings = tree.children_goals(record.parent) if record.parent is not None else [gid]
    owners = {key: tree.goals[key].owner for key in siblings if key in tree.goals}
    owners[gid] = record.owner
    return remap(owners, pool)[gid]
