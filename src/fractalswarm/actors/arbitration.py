"""Wonder arbitration of semantic disputes at the lowest common ancestor (spec §6.2).

A booking collision is two squads after one slot; a compare-and-set settles it. This is the
other kind: two contracts publish different values for one fact (a speaker's availability read
twice from the same email), and nothing in the data says which is right. The disputed key is
settled by the ``arbiter`` role of the ladder (Wonder, effort high), with the sources the
candidates cite as spotlighted evidence, at the lowest common ancestor of the two contracts'
goals: the track goal when both sessions are in one track, the root otherwise.

1. **Detection** (``actors/board.py``). A publish to a key that holds another contract's different
   value (canonical JSON) marks the fact ``disputed`` and logs ``collision.detected`` with
   ``kind: "semantic"``, whose ``conflicts`` carry the candidates. ``DisputesView`` reads them.
   A retry of one contract is not a rival, and a key whose ruling is in is settled for good.
2. **Arbitration.** The owner of the LCA goal runs ``step`` when the board tells it, on its tick,
   and after a takeover: it is a view of the log, so an heir (swarm) or a restarted coordinator
   (the central modes) picks an open dispute up where it was left. Per dispute, in this order:
   a usable answer already in the log is adopted; a call in flight with a live caller is waited
   for; otherwise the call goes out as attempt n (``arbitrate|key|n``). Two unusable answers
   end in a deterministic ruling instead (the oldest value, spec §6.2), so the run never waits
   on a model that cannot answer.
3. **The ruling** is ``arbitration.ruled`` (winner, reason, confidence, evidence ids), then
   ``collision.resolved`` and ``fact.resolve`` to the board, which makes the winner's value the
   verified fact (``fact.resolved``). Below ``MIN_CONFIDENCE`` it also opens ``escalation.opened``:
   a person may answer; if nobody does, the ruling stands.
4. **Effect on the work** (``gate``, from ``orchestrator._dispatch``). A contract whose input
   facts are in dispute waits for the ruling, at most ``HOLD_MS`` after the dispute opened, and
   then goes out with the ruled values laid over its own.

Off unless the run asks for it (``arbitration: true``); with it off no event, spawn argument or
prompt differs from a run without this module.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any, NamedTuple

from pydantic import BaseModel, ConfigDict

from fractalswarm.bench.tasks.t2_conference import arbitration as t2
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.ids import canonical_json
from fractalswarm.kernel.scheduler import Command, Send, StartEffect, View
from fractalswarm.planning.planner import parse_json, plan_request

TAG = "arbitrate"  # the effect tag is arbitrate|<key>|<attempt>
HOLD_TAG = "arb.hold"  # a contract waiting for its ruling wakes on this timer: arb.hold|<goal>
TOPIC_REQUEST = "arbitration.request"  # the board to the LCA owner: a dispute opened
TOPIC_RULING = "arbitration.ruling"  # the arbiter to the squads that wait for it
TOPIC_RESOLVE = "fact.resolve"  # the arbiter to the board
ROOT_GOAL = "root"
HOLD_MS = 30_000
MIN_CONFIDENCE = 0.6
MAX_UNUSABLE = 2  # answers that cannot be used before the deterministic ruling
ESCALATION_TIMEOUT_MS = 60_000
MAX_REASON_CHARS = 400
MAX_EVIDENCE = 8
SCHEMA = "arbitration_ruling"
TASK_HOOKS = {t2.NAME: t2}  # the tasks that can be arbitrated: their evidence and their overlay

INSTRUCTIONS = """You are the arbiter of FractalSwarm, called by the orchestrator that owns the
lowest common ancestor of two agents who disagree. Each candidate is a value that an agent
published for the same fact. Decide which candidate the evidence supports. Judge only from the
evidence given. If no candidate is supported, choose the closest one and report a confidence
below 0.6: a person will be asked. Reply with JSON matching the schema: winner (a candidate
label), reason (one or two sentences that name what in the evidence decides it), confidence
(0 to 1) and evidence (the ids of the evidence that decides it)."""


# -- events -------------------------------------------------------------------------------


@register("arbitration.requested")
class ArbitrationRequested(Payload):
    """The owner of the LCA goal sent a dispute to the arbiter (one call, attempt ``attempt``)."""

    key: str
    subject: str
    attempt: int
    lca: str
    arbiter: str  # the orchestrator that made the call
    candidates: list[str]  # the work (goal/contract) behind each label, in label order
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("arbitration.ruled")
class ArbitrationRuled(Payload):
    """The ruling on one disputed key: the first one in the log is the one."""

    key: str
    subject: str
    winner: str  # the candidate's label
    work: str  # the winning contract's goal/contract
    contract: str  # its idem key, which the board matches
    value: Any  # the winning value, which the waiting contracts take over
    reason: str
    confidence: float
    evidence: list[str]
    attempt: int  # the call that answered; 0 for a ruling that needed none
    by: str  # arbiter | agreement | fallback
    arbiter: str
    lca: str
    reused: bool = False  # the answer a dead owner's call already got, adopted from the log
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


@register("fact.resolved")
class FactResolved(Payload):
    """The board made the winner's value the verified fact (the answer to ``fact.resolve``)."""

    key: str
    contract: str
    version: int
    by: str


@register("escalation.opened")
class EscalationOpened(Payload):
    """A ruling the arbiter is not sure of: a person may answer, else the ruling stands."""

    id: str
    kind: str
    key: str
    goal_id: str
    question: str
    options: list[str]
    confidence: float
    timeout_ms: int
    default: str
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


class ArbiterRuling(BaseModel):
    model_config = ConfigDict(extra="forbid")

    winner: str
    reason: str
    confidence: float
    evidence: list[str]


# -- the disputes as a view of the log ----------------------------------------------------


@dataclass
class Dispute:
    """A contested key: its candidates (one per distinct value, labelled A, B, ...) as the board
    last logged them, and the ruling once it is in."""

    key: str
    subject: str
    goal_id: str  # the goal whose publish opened it
    holder: str
    opened_ms: int
    candidates: list[dict[str, Any]]
    ruling: dict[str, Any] | None = None

    def goals(self) -> list[str]:
        return sorted({s["goal"] for c in self.candidates for s in c["by"] if s["goal"]})


@dataclass
class Call:
    """One arbitration call: who made it, and how it ended (running | done | cancelled)."""

    number: int
    effect_id: str
    actor: str
    state: str = "running"
    status: str = ""
    text: str = ""


class DisputesView:
    """What the log says about disputes, for the board, the arbiter, its heir and the squads
    that wait: the work behind each contract, the open and ruled disputes, and the calls."""

    name = "disputes"

    def __init__(self) -> None:
        self.works: dict[str, tuple[str, str]] = {}  # contract idem key -> (goal, contract id)
        self.disputes: dict[str, Dispute] = {}
        self.calls: dict[str, list[Call]] = {}  # key -> its calls, in the order they started
        self._by_effect: dict[str, tuple[str, Call]] = {}

    # -- queries --------------------------------------------------------------------------

    def work_of(self, contract: str) -> tuple[str, str] | None:
        return self.works.get(contract)

    def get(self, key: str) -> Dispute | None:
        return self.disputes.get(key)

    def open_disputes(self) -> list[Dispute]:
        return [d for _, d in sorted(self.disputes.items()) if d.ruling is None]

    def calls_of(self, key: str) -> list[Call]:
        return list(self.calls.get(key, []))

    def tags_in_flight(self, actor: str) -> list[str]:
        """The actor's arbitration calls that are neither answered nor cancelled."""
        return [
            f"{TAG}|{key}|{call.number}"
            for key, calls in sorted(self.calls.items())
            for call in calls
            if call.actor == actor and call.state == "running"
        ]

    # -- the reducer ----------------------------------------------------------------------

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        payload, kind = event.payload, event.type
        if kind == "contract.dispatched":
            self.works.setdefault(payload["idem_key"], (payload["goal_id"], payload["contract_id"]))
        elif kind == "collision.detected" and payload["kind"] == "semantic":
            self._detected(event)
        elif kind == "arbitration.ruled":
            dispute = self.disputes.get(payload["key"])
            if dispute is not None and dispute.ruling is None:
                dispute.ruling = payload
        elif kind in ("effect.started", "effect.completed", "effect.cancelled"):
            found = _tagged(payload.get("tag"))
            if found is not None:
                self._call(event, *found)

    def _detected(self, event: Event) -> None:
        payload = event.payload
        for conflict in payload["conflicts"]:
            dispute = self.disputes.get(conflict["key"])
            if dispute is None:
                self.disputes[conflict["key"]] = Dispute(
                    key=conflict["key"],
                    subject=conflict["subject"],
                    goal_id=payload["goal_id"],
                    holder=payload["holder"],
                    opened_ms=event.ts_virtual,
                    candidates=conflict["candidates"],
                )
            elif dispute.ruling is None:
                dispute.candidates = conflict["candidates"]

    def _call(self, event: Event, key: str, number: int) -> None:
        effect_id = event.payload["effect_id"]
        if event.type == "effect.started":
            call = Call(number=number, effect_id=effect_id, actor=event.actor)
            self.calls.setdefault(key, []).append(call)
            self._by_effect[effect_id] = (key, call)
            return
        found = self._by_effect.get(effect_id)
        if event.type == "effect.cancelled":
            if found is not None and found[1].state == "running":
                found[1].state = "cancelled"
            return
        result = event.payload.get("result") or {}
        text = result.get("output_text", "")
        done = {"state": "done", "status": event.payload["status"], "text": text}
        if found is None:
            # A completion with no start was refused by a budget, in the caller's name.
            call = Call(number=number, effect_id=effect_id, actor=event.actor, **done)
            self.calls.setdefault(key, []).append(call)
            self._by_effect[effect_id] = (key, call)
        elif found[1].state == "running":
            for field_name, value in done.items():
                setattr(found[1], field_name, value)


def _tagged(tag: str | None) -> tuple[str, int] | None:
    prefix, _, rest = (tag or "").partition("|")
    key, _, attempt = rest.rpartition("|")
    if prefix != TAG or not key or not attempt.isdigit():
        return None
    return key, int(attempt)


# -- the tree: the lowest common ancestor and who owns it ---------------------------------


def lca_of(parent_of: Callable[[str], str | None], goals: Iterable[str]) -> str:
    """The deepest goal that is an ancestor of every goal given (a goal is its own ancestor).
    Goals nobody knows, and goals with nothing in common, meet at the root."""
    chains = []
    for goal in sorted(set(goals)):
        chain = [goal]
        while (above := parent_of(chain[-1])) is not None and above not in chain:
            chain.append(above)
        chains.append(chain)
    if not chains:
        return ROOT_GOAL
    common = [g for g in chains[0] if all(g in other for other in chains[1:])]
    return common[0] if common else ROOT_GOAL


def arbiter_of(view: View, goals: list[str]) -> str | None:
    """Who owns the LCA goal now, from the tree: the one the board tells about a new dispute."""
    tree = view.views.get("tree")
    if tree is None:
        return None

    def parent_of(goal: str) -> str | None:
        record = tree.goals.get(goal)
        return record.parent if record is not None else None

    return tree.owner_of(lca_of(parent_of, goals)) or tree.owner_of(ROOT_GOAL)


def work_of(view: View, contract: str) -> tuple[str, str] | None:
    disputes = view.views.get("disputes")
    return disputes.work_of(contract) if disputes is not None else None


# -- the candidates (the board's side of a dispute) ---------------------------------------


def supporter(fact: Any, view: View) -> dict[str, Any]:
    """Who stands behind a value: the contract that published it, and the work it stands for
    (the retries of one contract share it; the idem key itself when the log does not know it)."""
    provenance = fact.provenance
    found = work_of(view, provenance.contract)
    return {
        "contract": provenance.contract,
        "work": f"{found[0]}/{found[1]}" if found is not None else provenance.contract,
        "goal": found[0] if found is not None else "",
        "agent": provenance.agent,
        "squad": provenance.squad,
        "sources": list(provenance.sources),
        "lamport": fact.lamport,
    }


def join(dispute: dict[str, Any], fact: Any, view: View) -> list[dict[str, Any]]:
    """Add a publish to a dispute's candidates, in place. One candidate per distinct value
    (canonical JSON), labelled once and for good (A, B, ...). The publisher's earlier word, if
    any (a retry of the same work), is taken back first."""
    new = supporter(fact, view)
    candidates = dispute["candidates"]
    for candidate in candidates:
        candidate["by"] = [s for s in candidate["by"] if s["work"] != new["work"]]
    candidates[:] = [c for c in candidates if c["by"]]
    value = canonical_json(fact.value)
    match = next((c for c in candidates if canonical_json(c["value"]) == value), None)
    if match is not None:
        match["by"].append(new)
    else:
        label = chr(ord("A") + dispute["labels"])
        dispute["labels"] += 1
        candidates.append({"label": label, "value": fact.value, "by": [new]})
    return candidates


# -- the arbiter ---------------------------------------------------------------------------


def arbiter_request(
    dispute: Dispute,
    context: dict[str, Any],
    evidence: dict[str, Any],
    note: str,
    feedback: list[str],
) -> dict[str, Any]:
    works = {c["label"]: [s["work"] for s in c["by"]] for c in dispute.candidates}
    return plan_request(
        role="arbiter",
        schema_name=SCHEMA,
        model=ArbiterRuling,
        instructions=f"{INSTRUCTIONS}\n\n{note}",
        header="ARBITRATION\nContracts published different values for the same fact. Decide "
        "which one the evidence supports.",
        data={"context": context, "works": works},
        # What agents published (the key, the subject, the values) and the evidence come from
        # outside the system: all of it is spotlighted, none of it is in the header.
        untrusted={
            "fact": {"key": dispute.key, "subject": dispute.subject},
            "candidates": {c["label"]: c["value"] for c in dispute.candidates},
        }
        | evidence,
        feedback=feedback,
    )


def read_ruling(status: str, text: str, labels: set[str]) -> tuple[ArbiterRuling | None, str]:
    """The arbiter's answer, or why it cannot be used."""
    if status != "ok":
        return None, f"the arbiter was unavailable ({status})"
    ruling, errors = parse_json(ArbiterRuling, text)
    if ruling is None:
        return None, f"the answer was unusable: {'; '.join(errors)}"
    if ruling.winner not in labels:
        return None, f"the winner {ruling.winner!r} is not one of {sorted(labels)}"
    ruling = ruling.model_copy(
        update={
            "reason": ruling.reason.strip()[:MAX_REASON_CHARS],
            "evidence": [found[:64] for found in ruling.evidence[:MAX_EVIDENCE]],
            "confidence": min(max(ruling.confidence, 0.0), 1.0),
        }
    )
    return ruling, ""


def _alive(view: View, actor: str) -> bool:
    members = view.views.get("members")
    return actor in view.alive and not (members is not None and members.is_gone(actor))


class Tools(NamedTuple):
    """What the orchestrator lends ``step``: its fenced writes, its model routing, the board."""

    emit: Callable[..., Command]
    route: Callable[[dict[str, Any]], dict[str, Any]]
    parent_of: Callable[[str], str | None]
    board: str


def step(state: dict[str, Any], view: View, tools: Tools) -> list[Command]:
    """Take up the open disputes whose LCA goal this orchestrator owns (it holds the goal)."""
    disputes = view.views.get("disputes")
    hooks = TASK_HOOKS.get(state["task"])
    if disputes is None or hooks is None:
        return []
    commands: list[Command] = []
    for dispute in disputes.open_disputes():
        lca = lca_of(tools.parent_of, dispute.goals())
        entry = state["goals"].get(lca)
        if entry is None:
            continue  # not ours: the LCA goal's owner (or its heir) rules
        commands += _take_up(state, view, dispute, lca, entry, tools, hooks)
    return commands


def _take_up(
    state: dict[str, Any],
    view: View,
    dispute: Dispute,
    lca: str,
    entry: dict[str, Any],
    tools: Tools,
    hooks: Any,
) -> list[Command]:
    rule = _Ruler(state, view, dispute, lca, tools)
    if len(dispute.candidates) == 1:
        return rule(dispute.candidates[0], "agreement", "the contracts came to agree", 1.0, [], 0)
    labels = {c["label"] for c in dispute.candidates}
    calls = view.views["disputes"].calls_of(dispute.key)
    unusable: list[str] = []
    for call in calls:
        if call.state == "running" and _alive(view, call.actor):
            return []  # a live caller has it in flight: its answer comes
        if call.state != "done":
            continue
        ruling, problem = read_ruling(call.status, call.text, labels)
        if ruling is None:
            unusable.append(f"attempt {call.number}: {problem}")
            continue
        winner = next(c for c in dispute.candidates if c["label"] == ruling.winner)
        return rule(
            winner,
            "arbiter",
            ruling.reason,
            ruling.confidence,
            ruling.evidence,
            call.number,
            reused=call.actor != state["id"],
        )
    if len(unusable) >= MAX_UNUSABLE:
        return rule(*_oldest(dispute), note=unusable[-1])
    context, evidence, found = hooks.evidence(entry["goal"], dispute)
    if not found:
        return rule(*_oldest(dispute), note="the goal holds no evidence to weigh")
    if entry["phase"] == "done":
        return []  # an answer in the log is still read, but a finished goal pays for no new call
    number = max((call.number for call in calls), default=0) + 1
    request = arbiter_request(dispute, context, evidence, hooks.NOTE, unusable)
    requested = {
        "key": dispute.key,
        "subject": dispute.subject,
        "attempt": number,
        "lca": lca,
        "arbiter": state["id"],
        "candidates": [c["by"][0]["work"] for c in dispute.candidates],
    }
    idem = f"arbitration.requested:{dispute.key}:{number}"
    return [
        tools.emit(lca, "arbitration.requested", requested, idem),
        StartEffect(
            kind="llm",
            request=tools.route(request),
            tag=f"{TAG}|{dispute.key}|{number}",
            scopes={"squad": state["id"]},
        ),
    ]


def _oldest(dispute: Dispute) -> tuple[dict[str, Any], str, str, float, list[str], int]:
    """The ruling that needs no model (spec §6.2): the oldest value, by Lamport clock, then id."""
    oldest = min(dispute.candidates, key=lambda c: min((s["lamport"], s["work"]) for s in c["by"]))
    reason = "no usable answer from the arbiter; the oldest value stands"
    return oldest, "fallback", reason, 0.0, [], 0


class _Ruler:
    """Everything a ruling writes: the events, the order to the board, the news to the squads."""

    def __init__(
        self, state: dict[str, Any], view: View, dispute: Dispute, lca: str, tools: Tools
    ) -> None:
        self.state, self.view, self.dispute = state, view, dispute
        self.lca, self.tools = lca, tools

    def __call__(
        self,
        winner: dict[str, Any],
        by: str,
        reason: str,
        confidence: float,
        evidence: list[str],
        attempt: int,
        *,
        reused: bool = False,
        note: str = "",
    ) -> list[Command]:
        dispute, lca, emit = self.dispute, self.lca, self.tools.emit
        if note:  # a ruling without the arbiter says why it had none
            reason = f"{reason} ({note})"[:MAX_REASON_CHARS]
        first = winner["by"][0]
        ruled = {
            "key": dispute.key,
            "subject": dispute.subject,
            "winner": winner["label"],
            "work": first["work"],
            "contract": first["contract"],
            "value": winner["value"],
            "reason": reason,
            "confidence": round(confidence, 3),
            "evidence": evidence,
            "attempt": attempt,
            "by": by,
            "arbiter": self.state["id"],
            "lca": lca,
            "reused": reused,
        }
        resolution = f"{first['work']} kept ({by}, confidence {confidence:.2f}): {reason}"
        resolved = {"kind": "semantic", "goal_id": dispute.goal_id, "resolution": resolution}
        order = {"key": dispute.key, "contract": first["contract"], "by": self.state["id"]}
        commands: list[Command] = [
            emit(lca, "arbitration.ruled", ruled, f"arbitration.ruled:{dispute.key}"),
            emit(lca, "collision.resolved", resolved, f"collision.resolved:semantic:{dispute.key}"),
            Send(to=self.tools.board, topic=TOPIC_RESOLVE, body=order),
        ]
        if confidence < MIN_CONFIDENCE:
            commands.append(self._escalate(winner, confidence))
        return commands + self._tell_the_squads()

    def _escalate(self, winner: dict[str, Any], confidence: float) -> Command:
        dispute = self.dispute
        escalation = {
            "id": f"arbitration:{dispute.key}",
            "kind": "arbitration",
            "key": dispute.key,
            "goal_id": self.lca,
            "question": f"Which value of {dispute.key} is right?",
            "options": [c["label"] for c in dispute.candidates],
            "confidence": round(confidence, 3),
            "timeout_ms": ESCALATION_TIMEOUT_MS,
            "default": winner["label"],
        }
        return self.tools.emit(
            self.lca, "escalation.opened", escalation, f"escalation.opened:{dispute.key}"
        )

    def _tell_the_squads(self) -> list[Command]:
        """The owners of the candidates' goals may hold a contract for this ruling."""
        tree = self.view.views.get("tree")
        if tree is None:
            return []
        owners = {tree.owner_of(goal) for goal in self.dispute.goals()}
        owners.discard(None)
        owners.discard(self.state["id"])
        body = {"key": self.dispute.key}
        return [Send(to=owner, topic=TOPIC_RULING, body=body) for owner in sorted(owners) if owner]


# -- the effect on the work ----------------------------------------------------------------


def gate(
    state: dict[str, Any], kind: str, inputs: dict[str, Any], view: View
) -> tuple[int | None, dict[str, Any]]:
    """A contract about to go out: (until, inputs). ``until`` is the virtual time up to which
    it waits because a fact it reads is in dispute; otherwise the inputs carry the ruled values
    over its own. The wait ends at the latest ``HOLD_MS`` after the dispute opened."""
    hooks = TASK_HOOKS.get(state["task"])
    disputes = view.views.get("disputes")
    if hooks is None or disputes is None:
        return None, inputs
    until: int | None = None
    ruled: dict[str, Any] = {}
    for key in hooks.fact_keys(kind, inputs):
        dispute = disputes.get(key)
        if dispute is None:
            continue
        if dispute.ruling is not None:
            ruled[key] = dispute.ruling["value"]
        elif view.now < dispute.opened_ms + HOLD_MS:
            until = max(until or 0, dispute.opened_ms + HOLD_MS)
    if until is not None:
        return until, inputs
    return None, hooks.overlay(inputs, ruled) if ruled else inputs


def tags_in_flight(view: View, actor: str) -> list[str]:
    """The actor's own arbitration calls in flight: what a crash that loses them cancels."""
    disputes = view.views.get("disputes")
    return disputes.tags_in_flight(actor) if disputes is not None else []
