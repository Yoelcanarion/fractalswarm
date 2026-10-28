"""A chaos test-bed: coordinators share contracts over a faulty bus while chaos strikes.

``CHAOS_TOY`` runs:

- ``net`` (the chaos network) and ``chaos`` (the monkey, with a ``ChaosPlan`` from the params);
- N coordinators. Each one embeds a failure detector and a bus endpoint relayed through
  ``net``, and owns some of the contracts. It keeps at most ``limit`` agents running, and
  verifies a contract when an agent's ``artifact.ready`` arrives;
- one agent per dispatch. It makes one fake LLM call (retried behind a model breaker) and
  publishes the result to every coordinator on the critical lane, under the contract's
  idempotency key, then stops once every copy is acked or given up.

Takeover is leaderless. When the log says an owner is dead, every survivor computes the same
heir for each orphaned contract (the highest ``stable_hash(contract, member)`` among the live
coordinators), and only the heir writes ``toy.ownership.remapped``. Results that reached the
survivors before the takeover are adopted, so a finished orphan is never paid for twice.

Coordinator writes carry fencing tokens, and every ``checkpoint_every`` ticks a coordinator
writes a ``toy.checkpoint``, so a partitioned zombie's writes are fenced until it rejoins.

This is a stand-in until the Day 4 slice lands: it uses plain rendezvous hashing, not the
bounded-load HRW of ``coord/hrw.py``, and its own ``toy.*`` event types.
"""

from dataclasses import dataclass, field
from typing import Any

from fractalswarm.comms import bus
from fractalswarm.comms.breakers import BreakerBoard
from fractalswarm.comms.bus import Endpoint
from fractalswarm.comms.chaos import (
    CHAOS,
    CHAOS_MONKEY,
    NET,
    NET_KIND,
    ActorsView,
    ProgressSpec,
    ProgressView,
    plan_from,
)
from fractalswarm.comms.topics import ARTIFACT_READY
from fractalswarm.coord import membership
from fractalswarm.coord.membership import Detector, MembersView
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.ids import stable_hash
from fractalswarm.kernel.scheduler import (
    ActorKind,
    Command,
    Emit,
    SetTimer,
    Spawn,
    StartEffect,
    Stop,
    View,
)

ROLE = "coordinator"
AGENT = "agent"
PROGRESS = ProgressSpec(
    created=frozenset({"toy.contract.created"}),
    dispatched=frozenset({"toy.contract.dispatched"}),
    finished=frozenset({"toy.contract.verified"}),
    owners=frozenset({"toy.ownership.assigned", "toy.ownership.remapped"}),
)


@register("toy.contract.created")
class ContractsCreated(Payload):
    keys: list[str]


@register("toy.ownership.assigned")
class OwnershipAssigned(Payload):
    owner: str
    keys: list[str]


@register("toy.ownership.remapped")
class OwnershipRemapped(Payload):
    contract_id: str
    owner: str
    previous: str
    adopted: bool  # the result was already in hand
    fence: dict[str, Any]


@register("toy.contract.dispatched")
class ContractDispatched(Payload):
    contract_id: str
    agent: str
    fence: dict[str, Any]


@register("toy.contract.verified")
class ContractVerified(Payload):
    contract_id: str
    owner: str
    agent: str
    text: str
    fence: dict[str, Any]


@register("toy.checkpoint")
class Checkpoint(Payload):
    member: str
    owned: int
    fence: dict[str, Any]


@register("toy.finished")
class Finished(Payload):
    by: str
    complete: bool
    verified: int
    contracts: int


def contract_ids(count: int) -> list[str]:
    return [f"k{n:02d}" for n in range(count)]


def heir(contract: str, members: list[str]) -> str | None:
    """The rendezvous winner for a contract among ``members``."""
    if not members:
        return None
    return max(members, key=lambda member: (stable_hash(contract, member), member))


def agent_name(contract: str, dispatch: int) -> str:
    return f"agent-{contract}-{dispatch}"


# -- coordinators -----------------------------------------------------------------------


@dataclass
class CoordState:
    det: Detector
    ep: Endpoint
    coordinators: list[str]
    limit: int
    deadline_ms: int
    checkpoint_every: int
    results: dict[str, dict[str, Any]] = field(default_factory=dict)  # contract -> result
    ticks: int = 0
    done: bool = False


def coord_init(actor_id: str, args: dict[str, Any]) -> CoordState:
    return CoordState(
        det=Detector(member=actor_id, role=ROLE, group="root"),
        ep=Endpoint(owner=actor_id, relay=args.get("relay")),
        coordinators=list(args["coordinators"]),
        limit=int(args.get("limit", 1)),
        deadline_ms=int(args["deadline_ms"]),
        checkpoint_every=int(args.get("checkpoint_every", 0)),
    )


def coord_handle(state: CoordState, event: Event, view: View):
    if state.done:
        return state, []
    if event.type == "actor.spawned":
        peers = [name for name in state.coordinators if name != state.det.member]
        return state, membership.join(state.det, view, peers)
    out = membership.handle(state.det, state.ep, event, view)
    if out is None:
        return state, []
    commands = list(out.commands)
    for delivery in out.deliveries:
        if delivery.kind == "msg" and delivery.topic == ARTIFACT_READY.name:
            result = dict(delivery.payload)
            if result.get("ok"):
                state.results.setdefault(result["contract_id"], result)
    is_tick = event.type == "effect.completed" and event.payload["tag"] == membership.TICK_TAG
    if is_tick:
        state.ticks += 1
        progress: ProgressView = view.views["progress"]
        if progress.complete() or view.now >= state.deadline_ms:
            return _finish(state, view, commands)
        if state.checkpoint_every and state.ticks % state.checkpoint_every == 0:
            commands.append(_checkpoint(state, view))
    commands += _take_over(state, view)
    commands += _work(state, view)
    return state, commands


def _fence(state: CoordState, view: View, resource: str | None = None) -> dict[str, Any]:
    return membership.token(state.det, view.member_epoch, resource)


def _checkpoint(state: CoordState, view: View) -> Command:
    progress: ProgressView = view.views["progress"]
    owned = sum(
        1
        for item in progress.items.values()
        if item.owner == state.det.member and not item.finished
    )
    payload = {"member": state.det.member, "owned": owned, "fence": _fence(state, view)}
    return Emit(type="toy.checkpoint", payload=payload)


def _take_over(state: CoordState, view: View) -> list[Command]:
    """Re-own the contracts of dead owners: only the heir writes, nobody asks anybody."""
    members: MembersView = view.views["members"]
    progress: ProgressView = view.views["progress"]
    me = state.det.member
    if members.is_dead(me, state.det.incarnation):
        return []  # a zombie takes nothing over until it rejoins
    alive = members.alive(role=ROLE)
    commands: list[Command] = []
    for key in sorted(progress.items):
        item = progress.items[key]
        if item.finished or item.owner is None or not members.is_gone(item.owner):
            continue
        if heir(key, alive) != me:
            continue
        payload = {
            "contract_id": key,
            "owner": me,
            "previous": item.owner,
            "adopted": key in state.results,
            "fence": _fence(state, view, key),
        }
        commands.append(
            Emit(
                type="toy.ownership.remapped",
                payload=payload,
                idem_key=f"toy.ownership.remapped:{key}:{item.owner}",
            )
        )
    return commands


def _owned(state: CoordState, view: View) -> list[str]:
    """Open contracts this coordinator owns, counting the remaps it is about to write."""
    progress: ProgressView = view.views["progress"]
    members: MembersView = view.views["members"]
    me = state.det.member
    alive = members.alive(role=ROLE)
    owned = []
    for key in sorted(progress.items):
        item = progress.items[key]
        if item.finished:
            continue
        mine = item.owner == me
        orphan = item.owner is not None and members.is_gone(item.owner)
        if mine or (orphan and heir(key, alive) == me):
            owned.append(key)
    return owned


def _work(state: CoordState, view: View) -> list[Command]:
    members: MembersView = view.views["members"]
    if members.is_dead(state.det.member, state.det.incarnation):
        return []
    progress: ProgressView = view.views["progress"]
    actors: ActorsView = view.views["actors"]
    running_agents = set(actors.alive((AGENT,)))
    commands: list[Command] = []
    waiting: list[str] = []
    running = 0
    for key in _owned(state, view):
        item = progress.items[key]
        result = state.results.get(key)
        if result is not None:
            payload = {
                "contract_id": key,
                "owner": state.det.member,
                "agent": result["agent"],
                "text": result["text"],
                "fence": _fence(state, view, key),
            }
            commands.append(
                Emit(type="toy.contract.verified", payload=payload, idem_key=f"verified:{key}")
            )
        elif item.dispatches and agent_name(key, item.dispatches) in running_agents:
            running += 1
        else:
            waiting.append(key)
    for key in waiting[: max(state.limit - running, 0)]:
        agent = agent_name(key, progress.items[key].dispatches + 1)
        if agent in actors.kinds:
            continue  # already spawned in this reaction or by a fenced writer
        args = {"contract_id": key, "coordinators": state.coordinators, "relay": state.ep.relay}
        payload = {"contract_id": key, "agent": agent, "fence": _fence(state, view, key)}
        commands += [
            Emit(type="toy.contract.dispatched", payload=payload, idem_key=f"dispatch:{agent}"),
            Spawn(actor_id=agent, kind=AGENT, args=args),
        ]
    return commands


def _finish(state: CoordState, view: View, commands: list[Command]):
    progress: ProgressView = view.views["progress"]
    state.done = True
    membership.stop(state.det)
    verified = sum(1 for item in progress.items.values() if item.finished)
    payload = {
        "by": state.det.member,
        "complete": progress.complete(),
        "verified": verified,
        "contracts": len(progress.items),
    }
    me = state.det.member
    stops = [Stop(actor_id=actor, reason="done") for actor in view.alive if actor != me]
    finished = Emit(type="toy.finished", payload=payload, idem_key="toy.finished")
    return state, [*commands, finished, *stops, Stop(reason="done")]


# -- agents -----------------------------------------------------------------------------


@dataclass
class AgentState:
    contract_id: str
    ep: Endpoint
    board: BreakerBoard = field(default_factory=BreakerBoard)
    tries: int = 0
    max_tries: int = 3
    model: str | None = None
    published: bool = False


def agent_init(actor_id: str, args: dict[str, Any]) -> AgentState:
    ep = Endpoint(owner=actor_id, relay=args.get("relay"))
    ep.subscribers[ARTIFACT_READY.name] = sorted(args["coordinators"])
    return AgentState(contract_id=args["contract_id"], ep=ep)


def _call(state: AgentState) -> Command:
    state.tries += 1
    request = {"role": "agent", "input": f"Carry out contract {state.contract_id}."}
    scopes = {"contract": state.contract_id}
    return StartEffect(kind="llm", request=request, tag="work", scopes=scopes)


def agent_handle(state: AgentState, event: Event, view: View):
    if event.type == "actor.spawned":
        return state, [_call(state)]
    tag = event.payload.get("tag") if event.type == "effect.completed" else None
    if tag == "work":
        commands = _on_result(state, event, view)
    elif tag == "retry":
        commands = _retry(state, view)
    else:
        out = bus.handle(state.ep, event, view)
        commands = [] if out is None else list(out.commands)
    if state.published and state.ep.idle:
        commands.append(Stop(reason="published"))
    return state, commands


def _on_result(state: AgentState, event: Event, view: View) -> list[Command]:
    result = event.payload["result"]
    status = event.payload["status"]
    state.model = result.get("model") or state.model
    commands: list[Command] = [
        Emit(type=name, payload=payload)
        for name, payload in state.board.record_result(view.now, result)
    ]
    ok = status in ("ok", "incomplete")
    if not ok and state.tries < state.max_tries:
        return [*commands, SetTimer(delay_ms=1000, tag="retry")]
    me = view.actor_id
    payload = {"contract_id": state.contract_id, "agent": me, "ok": ok}
    payload["text"] = result.get("output_text", "") if ok else str(result.get("error", status))
    state.published = True
    return commands + bus.publish(
        state.ep, view, ARTIFACT_READY.name, payload, idem_key=f"artifact:{state.contract_id}:{me}"
    )


def _retry(state: AgentState, view: View) -> list[Command]:
    if state.model is None:
        return [_call(state)]
    breaker = state.board.breaker(state.model)
    allowed, transitions = breaker.allow(view.now)
    commands: list[Command] = [Emit(type=name, payload=payload) for name, payload in transitions]
    if allowed:
        return [*commands, _call(state)]
    return [*commands, SetTimer(delay_ms=max(breaker.open_until - view.now, 1), tag="retry")]


# -- the scenario -----------------------------------------------------------------------


@dataclass(frozen=True)
class ChaosToyScenario:
    kinds = {
        ROLE: ActorKind(coord_init, coord_handle),
        AGENT: ActorKind(agent_init, agent_handle),
        NET: NET_KIND,
        CHAOS: CHAOS_MONKEY.kind(),
    }

    def reducers(self) -> list[Any]:
        return [MembersView(), ProgressView(PROGRESS), ActorsView()]

    def boot(self, params: dict[str, Any]) -> list[Command]:
        count = int(params.get("coordinators", 10))  # C3 kills five: half the brains
        coordinators = [f"c{n}" for n in range(count)]
        keys = contract_ids(int(params.get("contracts", 30)))
        deadline_ms = int(params.get("deadline_ms", 300_000))
        plan = plan_from(params)
        owners: dict[str, list[str]] = {}
        for key in keys:
            owners.setdefault(heir(key, coordinators) or "", []).append(key)

        commands: list[Command] = [
            Spawn(actor_id=NET, kind=NET, args={}),
            Emit(type="toy.contract.created", payload={"keys": keys}),
        ]
        commands += [
            Emit(type="toy.ownership.assigned", payload={"owner": owner, "keys": owners[owner]})
            for owner in sorted(owners)
        ]
        args = {
            "coordinators": coordinators,
            "relay": NET,
            "limit": int(params.get("limit", 1)),
            "deadline_ms": deadline_ms,
            "checkpoint_every": int(params.get("checkpoint_every", 2)),
        }
        commands += [Spawn(actor_id=name, kind=ROLE, args=args) for name in coordinators]
        monkey = {
            "plan": plan.model_dump(mode="json"),
            "coordinator_role": ROLE,
            "agent_kinds": [AGENT],
            "until_ms": deadline_ms,
        }
        commands.append(Spawn(actor_id=CHAOS, kind=CHAOS, args=monkey))
        return commands


CHAOS_TOY = ChaosToyScenario()
