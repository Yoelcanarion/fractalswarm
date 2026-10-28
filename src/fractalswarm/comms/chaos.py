"""Seeded chaos at logical progress points (spec §15.2, §15.4).

Three parts:

- **Plans.** ``build_plan(profile, seed)`` turns a profile (C0–C3) into a ``ChaosPlan``: the
  coordinator crashes, the share of agents to kill, the bus fault rates, an optional
  partition, and the API fault rate (applied by ``llm/transport.py``). Crashes happen at
  20/35/50/65/80% of contracts dispatched. The plan is plain data and goes into the run
  params, so it is part of ``run.started``.
- **The network** (``NET``, kind ``net``). Endpoints with ``relay="net"`` send every frame
  through it. It drops, delays, duplicates and reorders frames, and cuts partitions, with
  decisions drawn from ``View.rng`` per frame and attempt. Every fault it injects is logged
  as ``chaos.injected``.
- **The monkey** (``CHAOS``, kind ``chaos``). It polls the ``progress`` view and, as each
  progress point passes, kills a coordinator chosen by a pluggable targeting rule (default:
  the one with the most remaining owned work), kills agents, or partitions a member and later
  heals it. Each action is a ``chaos.injected`` event followed by the kernel's
  ``actor.stopped``; a kill is a crash, so the victim's in-flight effects die with it. With
  ``crash_mode="signal"`` a coordinator is not stopped but sent ``chaos.crash`` instead: a
  supervised baseline crashes and restarts itself (spec §15.2), at the same progress points.

Every decision is a pure function of the seed and the log so far, so chaos runs replay bit for
bit. Two reducers feed the monkey: ``ProgressView`` (contracts created, dispatched and finished,
and who owns what) and ``ActorsView`` (who is alive, and of which kind).
"""

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from fractalswarm.bench.profiles import CRASH_POINTS
from fractalswarm.comms.bus import ENVELOPE_KEY, RELAY_TOPIC
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.ids import stable_hash
from fractalswarm.kernel.scheduler import ActorKind, Command, Emit, Send, SetTimer, Stop, View

NET = "net"
CHAOS = "chaos"
CONFIG_TOPIC = "net.config"
CRASH_TOPIC = "chaos.crash"


@register("chaos.injected")
class ChaosInjected(Payload):
    fault: str  # kill_coordinator | kill_agent | partition | heal | drop | duplicate | ...
    target: str | None = None
    progress: float | None = None
    detail: dict[str, Any] = {}


# -- plans ------------------------------------------------------------------------------


class NetFaults(BaseModel):
    """Per-frame fault probabilities of the chaos network."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    drop: float = Field(0.0, ge=0, le=1)
    duplicate: float = Field(0.0, ge=0, le=1)
    delay: float = Field(0.0, ge=0, le=1)
    reorder: float = Field(0.0, ge=0, le=1)
    delay_ms: tuple[int, int] = (200, 1500)
    reorder_ms: tuple[int, int] = (20, 200)


class ChaosAction(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    at: float = Field(ge=0, le=1)  # share of contracts dispatched
    kind: str  # kill_coordinator | kill_agents | partition
    target: str | None = None  # explicit target; otherwise the targeting rule decides
    agent_share: float = 0.0  # kill_agents: cumulative share of the agents seen so far
    duration_ms: int = 8000  # partition


class ChaosPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    profile: str = "custom"
    seed: str = "0"
    actions: tuple[ChaosAction, ...] = ()
    net: NetFaults = NetFaults()
    api_fault_rate: float = 0.0


@dataclass(frozen=True)
class ChaosProfile:
    crashes: int
    agent_share: float
    api_faults: float
    message_loss: float
    partition: bool


PROFILES = {
    "C0": ChaosProfile(0, 0.0, 0.0, 0.0, False),
    "C1": ChaosProfile(1, 0.10, 0.05, 0.05, False),
    "C2": ChaosProfile(3, 0.30, 0.10, 0.10, True),
    "C3": ChaosProfile(5, 0.50, 0.20, 0.20, True),
}


def build_plan(profile: str, seed: str = "0", partition_ms: int = 8000) -> ChaosPlan:
    """The same profile and seed give the same plan for every workflow (spec §15.2)."""
    spec = PROFILES[profile]
    # Crash k happens at the k-th shared point, as in the baselines' supervisor.
    crashes = CRASH_POINTS[: spec.crashes]
    actions = [ChaosAction(at=at, kind="kill_coordinator") for at in crashes]
    if spec.agent_share > 0:
        actions += [
            ChaosAction(at=at, kind="kill_agents", agent_share=spec.agent_share)
            for at in CRASH_POINTS
        ]
    if spec.partition:
        # One partition, at a seeded point between two crash points.
        at = 0.25 + (stable_hash(seed, "partition") % 30) / 100
        actions.append(ChaosAction(at=round(at, 2), kind="partition", duration_ms=partition_ms))
    loss = spec.message_loss
    net = NetFaults(drop=loss, duplicate=loss / 2, delay=loss, reorder=loss / 2)
    ordered = sorted(actions, key=lambda action: (action.at, action.kind))
    return ChaosPlan(
        profile=profile,
        seed=seed,
        actions=tuple(ordered),
        net=net,
        api_fault_rate=spec.api_faults,
    )


def plan_from(params: dict[str, Any]) -> ChaosPlan:
    """``params["chaos"]``: a full plan, or ``{"profile": "C2", "seed": "..."}``."""
    raw = params.get("chaos") or {"profile": "C0"}
    if "actions" in raw:
        return ChaosPlan.model_validate(raw)
    return build_plan(raw.get("profile", "C0"), str(raw.get("seed", "0")))


# -- the views the monkey reads (kernel reducers) ---------------------------------------


@dataclass(frozen=True)
class ProgressSpec:
    """Which event types move a unit of work (a contract) through its life.

    An event names its work by ``key`` (or a list in ``keys``) and may name the ``owner``.
    The defaults fit the contract events of spec §5.1.
    """

    created: frozenset[str] = frozenset({"contract.created"})
    dispatched: frozenset[str] = frozenset({"contract.dispatched"})
    finished: frozenset[str] = frozenset({"contract.verified", "contract.cancelled"})
    owners: frozenset[str] = frozenset({"ownership.assigned", "ownership.remapped"})
    key_field: str = "contract_id"
    keys_field: str = "keys"
    owner_field: str = "owner"


@dataclass
class WorkItem:
    owner: str | None = None
    dispatches: int = 0
    dispatched_at: int | None = None
    finished: bool = False


class ProgressView:
    name = "progress"

    def __init__(self, spec: ProgressSpec | None = None) -> None:
        self.spec = spec or ProgressSpec()
        self.items: dict[str, WorkItem] = {}

    def fraction(self, expected: int = 0) -> float:
        """Share of the work dispatched at least once (the chaos clock). ``expected``: the
        total the task will create, when known, so early dispatches do not count double."""
        total = max(len(self.items), expected)
        if not total:
            return 0.0
        dispatched = sum(1 for item in self.items.values() if item.dispatches > 0)
        return dispatched / total

    def complete(self, expected: int = 0) -> bool:
        if not self.items or len(self.items) < expected:
            return False
        return all(item.finished for item in self.items.values())

    def remaining_by_owner(self) -> dict[str, int]:
        remaining: dict[str, int] = {}
        for item in self.items.values():
            if item.owner is not None and not item.finished:
                remaining[item.owner] = remaining.get(item.owner, 0) + 1
        return dict(sorted(remaining.items()))

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        spec = self.spec
        kinds = (spec.created, spec.dispatched, spec.finished, spec.owners)
        if not any(event.type in kind for kind in kinds):
            return
        payload = event.payload
        keys = list(payload.get(spec.keys_field) or [])
        if spec.key_field in payload:
            keys.append(payload[spec.key_field])
        owner = payload.get(spec.owner_field)
        for key in keys:
            item = self.items.setdefault(key, WorkItem())
            if isinstance(owner, str):
                item.owner = owner
            if event.type in spec.dispatched:
                item.dispatches += 1
                item.dispatched_at = event.ts_virtual
            if event.type in spec.finished:
                item.finished = True


class ActorsView:
    """Every actor ever spawned, its kind, its parent, and whether it is still alive."""

    name = "actors"

    def __init__(self) -> None:
        self.kinds: dict[str, str] = {}
        self.parents: dict[str, str | None] = {}
        self.stopped: dict[str, str] = {}  # actor -> reason

    def alive(self, kinds: tuple[str, ...] | None = None) -> list[str]:
        return sorted(
            actor
            for actor, kind in self.kinds.items()
            if actor not in self.stopped and (kinds is None or kind in kinds)
        )

    def seen(self, kinds: tuple[str, ...]) -> int:
        return sum(1 for kind in self.kinds.values() if kind in kinds)

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        if event.type == "actor.spawned":
            self.kinds[event.payload["actor_id"]] = event.payload["kind"]
            self.parents[event.payload["actor_id"]] = event.payload["parent"]
            self.stopped.pop(event.payload["actor_id"], None)
        elif event.type == "actor.stopped":
            self.stopped[event.payload["actor_id"]] = event.payload["reason"]


# -- targeting --------------------------------------------------------------------------


@dataclass(frozen=True)
class TargetContext:
    candidates: tuple[str, ...]  # sorted
    remaining: dict[str, int]  # remaining owned work per member
    seed: str
    purpose: str


Targeting = Callable[[TargetContext], str | None]


def most_remaining_work(ctx: TargetContext) -> str | None:
    """The coordinator with the most remaining owned work (spec §15.2); ties by seeded hash."""
    if not ctx.candidates:
        return None
    return max(
        ctx.candidates,
        key=lambda m: (ctx.remaining.get(m, 0), stable_hash(ctx.seed, ctx.purpose, m)),
    )


# -- the network ------------------------------------------------------------------------


@dataclass
class NetState:
    faults: NetFaults
    partitions: dict[str, list[str]] = field(default_factory=dict)  # id -> isolated members
    held: dict[str, dict[str, Any]] = field(default_factory=dict)  # hold tag -> frame
    counter: int = 0


def net_init(actor_id: str, args: dict[str, Any]) -> NetState:
    return NetState(faults=NetFaults.model_validate(args.get("faults") or {}))


def _cut(state: NetState, a: str, b: str) -> str | None:
    for partition_id, isolated in state.partitions.items():
        if (a in isolated) != (b in isolated):
            return partition_id
    return None


def net_handle(state: NetState, event: Event, view: View) -> tuple[NetState, list[Command]]:
    if event.type == "msg.sent" and event.payload["topic"] == CONFIG_TOPIC:
        body = event.payload["body"]
        if "faults" in body:
            state.faults = NetFaults.model_validate(body["faults"])
        if "partition" in body:
            state.partitions[body["partition"]["id"]] = sorted(body["partition"]["isolated"])
        if "heal" in body:
            state.partitions.pop(body["heal"], None)
        return state, []
    if event.type == "msg.sent" and event.payload["topic"] == RELAY_TOPIC:
        return state, _relay(state, event.payload["body"][ENVELOPE_KEY], view)
    if event.type == "effect.completed" and (event.payload["tag"] or "").startswith("net.hold:"):
        frame = state.held.pop(event.payload["tag"], None)
        return state, [] if frame is None else [_forward(frame)]
    return state, []


def _relay(state: NetState, frame: dict[str, Any], view: View) -> list[Command]:
    source, target = frame["sender"], frame["to"]
    note = {"frame": frame["id"], "kind": frame["kind"], "from": source, "to": target}
    partition_id = _cut(state, source, target)
    if partition_id is not None:
        detail = note | {"partition": partition_id}
        return [Emit(type="chaos.injected", payload={"fault": "partition_drop", "detail": detail})]

    faults = state.faults
    rng = view.rng(f"frame:{frame['id']}:{frame['attempt']}")
    draws = [rng.random() for _ in range(6)]  # always the same number of draws per frame
    if draws[0] < faults.drop:
        return [Emit(type="chaos.injected", payload={"fault": "drop", "detail": note})]
    commands: list[Command] = []
    copies = 2 if draws[1] < faults.duplicate else 1
    if copies == 2:
        commands.append(Emit(type="chaos.injected", payload={"fault": "duplicate", "detail": note}))
    for copy in range(copies):
        delay, fault = 0, None
        if draws[2 + copy] < faults.delay:
            low, high = faults.delay_ms
            delay, fault = low + int(draws[4 + copy] * (high - low)), "delay"
        elif draws[2 + copy] < faults.delay + faults.reorder:
            low, high = faults.reorder_ms
            delay, fault = low + int(draws[4 + copy] * (high - low)), "reorder"
        if fault is None:
            commands.append(_forward(frame))
            continue
        state.counter += 1
        tag = f"net.hold:{state.counter}"
        state.held[tag] = frame
        detail = note | {"delay_ms": delay}
        commands.append(Emit(type="chaos.injected", payload={"fault": fault, "detail": detail}))
        commands.append(SetTimer(delay_ms=delay, tag=tag))
    return commands


def _forward(frame: dict[str, Any]) -> Send:
    return Send(to=frame["to"], topic=frame["topic"], body={ENVELOPE_KEY: frame})


NET_KIND = ActorKind(net_init, net_handle)


# -- the monkey -------------------------------------------------------------------------


@dataclass
class MonkeyState:
    plan: ChaosPlan
    coordinator_role: str
    agent_kinds: tuple[str, ...]
    poll_ms: int
    until_ms: int | None = None  # stop polling then, even if progress stalls
    crash_mode: str = "stop"  # stop | signal (send CRASH_TOPIC to a supervised coordinator)
    expected_work: int = 0  # the task's total work, for the progress clock
    next_action: int = 0
    agents_killed: int = 0
    killed: list[str] = field(default_factory=list)  # stopped by this monkey
    partitions: dict[str, str] = field(default_factory=dict)  # id -> isolated member
    log: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class ChaosMonkey:
    """The monkey's actor kind, with its targeting rule plugged in."""

    targeting: Targeting = most_remaining_work

    def kind(self) -> ActorKind:
        return ActorKind(self.init, self.handle)

    def init(self, actor_id: str, args: dict[str, Any]) -> MonkeyState:
        return MonkeyState(
            plan=ChaosPlan.model_validate(args.get("plan") or {}),
            coordinator_role=args.get("coordinator_role", "coordinator"),
            agent_kinds=tuple(args.get("agent_kinds", ["agent"])),
            poll_ms=int(args.get("poll_ms", 250)),
            until_ms=args.get("until_ms"),
            crash_mode=args.get("crash_mode", "stop"),
            expected_work=int(args.get("expected_work", 0)),
        )

    def handle(self, state: MonkeyState, event: Event, view: View):
        if event.type == "actor.spawned":
            commands: list[Command] = []
            if state.plan.net != NetFaults():
                faults = state.plan.net.model_dump(mode="json")
                commands.append(Send(to=NET, topic=CONFIG_TOPIC, body={"faults": faults}))
            if state.plan.actions:
                commands.append(SetTimer(delay_ms=state.poll_ms, tag="chaos.poll"))
            return state, commands
        if event.type != "effect.completed":
            return state, []
        tag = event.payload["tag"] or ""
        if tag.startswith("chaos.heal:"):
            return state, self._heal(state, tag.removeprefix("chaos.heal:"))
        if tag != "chaos.poll":
            return state, []
        progress = view.views["progress"]
        fraction = progress.fraction(state.expected_work)
        commands = []
        actions = state.plan.actions
        while state.next_action < len(actions) and actions[state.next_action].at <= fraction:
            action = actions[state.next_action]
            state.next_action += 1
            commands += self._act(state, action, fraction, view)
        more = state.next_action < len(actions) and not progress.complete(state.expected_work)
        if more and (state.until_ms is None or view.now < state.until_ms):
            commands.append(SetTimer(delay_ms=state.poll_ms, tag="chaos.poll"))
        return state, commands

    def _act(
        self, state: MonkeyState, action: ChaosAction, fraction: float, view: View
    ) -> list[Command]:
        members = view.views["members"]
        progress = view.views["progress"]
        actors = view.views["actors"]
        isolated = set(state.partitions.values())
        if state.crash_mode == "signal" and action.kind == "kill_coordinator":
            isolated = set()  # a partition does not touch a workflow without a bus
        at = round(fraction, 4)

        if action.kind in ("kill_coordinator", "partition"):
            candidates = tuple(
                member
                for member in members.alive(role=state.coordinator_role)
                if member not in isolated and member in view.alive and member not in state.killed
            )
            target = action.target if action.target in candidates else None
            purpose = f"{action.kind}:{state.next_action}"
            if target is None and action.target is None:
                ctx = TargetContext(
                    candidates, progress.remaining_by_owner(), state.plan.seed, purpose
                )
                target = self.targeting(ctx)
            if target is None:
                skipped = {"fault": action.kind, "progress": at, "detail": {"skipped": True}}
                return [Emit(type="chaos.injected", payload=skipped)]
            remaining = progress.remaining_by_owner().get(target, 0)
            if action.kind == "kill_coordinator":
                payload = {
                    "fault": "kill_coordinator",
                    "target": target,
                    "progress": at,
                    "detail": {"remaining_work": remaining},
                }
                if state.crash_mode == "signal":
                    crash = Send(to=target, topic=CRASH_TOPIC, body={"progress": at})
                    return [Emit(type="chaos.injected", payload=payload), crash]
                state.killed.append(target)
                return [
                    Emit(type="chaos.injected", payload=payload),
                    Stop(actor_id=target, reason="chaos", cancel=True),
                ]
            partition_id = f"p{state.next_action}"
            state.partitions[partition_id] = target
            payload = {
                "fault": "partition",
                "target": target,
                "progress": at,
                "detail": {"partition": partition_id, "duration_ms": action.duration_ms},
            }
            body = {"partition": {"id": partition_id, "isolated": [target]}}
            return [
                Emit(type="chaos.injected", payload=payload),
                Send(to=NET, topic=CONFIG_TOPIC, body=body),
                SetTimer(delay_ms=action.duration_ms, tag=f"chaos.heal:{partition_id}"),
            ]

        if action.kind == "kill_agents":
            alive = [
                agent
                for agent in actors.alive(state.agent_kinds)
                if agent in view.alive and agent not in state.killed
            ]
            quota = math.floor(action.agent_share * actors.seen(state.agent_kinds) + 1e-9)
            count = min(max(quota - state.agents_killed, 0), len(alive))
            rng = view.rng(f"kill_agents:{state.next_action}")
            victims = sorted(rng.sample(alive, count))
            state.agents_killed += count
            state.killed += victims
            commands: list[Command] = []
            for victim in victims:
                payload = {"fault": "kill_agent", "target": victim, "progress": at}
                commands.append(Emit(type="chaos.injected", payload=payload))
                commands.append(Stop(actor_id=victim, reason="chaos", cancel=True))
            return commands

        raise ValueError(f"unknown chaos action {action.kind!r}")

    def _heal(self, state: MonkeyState, partition_id: str) -> list[Command]:
        target = state.partitions.pop(partition_id, None)
        payload = {"fault": "heal", "target": target, "detail": {"partition": partition_id}}
        return [
            Emit(type="chaos.injected", payload=payload),
            Send(to=NET, topic=CONFIG_TOPIC, body={"heal": partition_id}),
        ]


CHAOS_MONKEY = ChaosMonkey()
