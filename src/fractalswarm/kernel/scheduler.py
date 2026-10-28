"""The deterministic core: actor registry, mailboxes and command processing.

``Runtime`` never does I/O and never reads a clock. It appends events to the store, keeps one
delivery queue ordered by ``(vtime, lamport, seq)``, and calls pure handlers:

    handle(state, event, view) -> (new_state, [commands])

Effects leave through ``outbox`` (effect.started events for a driver to run) and come back
through ``complete()``. The live and sim drivers live in ``effects.py``; the replay driver in
``replay.py`` feeds the recorded completions instead, in the recorded order.

Which events reach which actor:
- ``actor.spawned`` goes to the new actor (its first event);
- ``msg.sent`` goes to ``payload.to``;
- ``effect.completed`` goes to the actor that started the effect.
Deliveries to a stopped or unknown actor are dropped.

Reducers (spec §5.1) are views of the log that a scenario may install: every appended event
updates them, handlers read them through ``View.views``, and they may refuse an actor's
``Emit`` (a stale fencing token becomes ``write.fenced``). An ``Emit`` whose explicit
``idem_key`` is already in the log is skipped: the first such event in the log wins.
"""

import heapq
import importlib
import random
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from fractalswarm.kernel.clock import lamport_receive, lamport_tick
from fractalswarm.kernel.events import ENV, KERNEL, Event, EventDraft
from fractalswarm.kernel.store import EventStore
from fractalswarm.market.ledger import Ledger


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Emit(Command):
    """Append an event to the log without delivering it to anyone."""

    type: str
    payload: dict[str, Any] = {}
    idem_key: str | None = None
    correlation_id: str | None = None


class Send(Command):
    to: str
    topic: str
    body: dict[str, Any] = {}
    correlation_id: str | None = None


class StartEffect(Command):
    """Run an effect; its completion comes back as an ``effect.completed`` event.

    ``scopes`` names the budget scopes to charge besides the run and the project, for
    example ``{"contract": "c-1", "squad": "S1"}``.
    """

    kind: str
    request: dict[str, Any]
    tag: str | None = None
    scopes: dict[str, str] = {}


class SetTimer(Command):
    delay_ms: int = Field(ge=0)
    tag: str | None = None


class Cancel(Command):
    """Cancel this actor's in-flight effects with this tag; their completions never arrive."""

    tag: str


class Spawn(Command):
    actor_id: str
    kind: str
    args: dict[str, Any] = {}


class Stop(Command):
    actor_id: str | None = None  # None stops the actor itself
    reason: str = ""
    # A crash: the actor's in-flight effects die with it (``effect.cancelled``, reservation
    # released). Without it they run to completion and are dropped on arrival.
    cancel: bool = False


class SetCap(Command):
    level: str
    key: str
    usd: float = Field(ge=0)


@dataclass(frozen=True)
class View:
    """What a handler may read besides its own state and the event."""

    run_id: str
    seed: str
    actor_id: str
    now: int
    lamport: int
    alive: tuple[str, ...]
    member_epoch: int = 0
    # The scenario's reducers by name: read-only views of the log so far.
    views: Mapping[str, Any] = field(default_factory=dict)

    def rng(self, purpose: str) -> random.Random:
        return random.Random(f"{self.seed}:{self.actor_id}:{purpose}")


Handler = Callable[[Any, Event, View], tuple[Any, list[Command]]]


@dataclass(frozen=True)
class ActorKind:
    init: Callable[[str, dict[str, Any]], Any]  # (actor_id, args) -> initial state
    handle: Handler


@dataclass(frozen=True)
class Admission:
    """A reducer's answer to an actor's ``Emit``.

    ``accept=False`` drops the event; ``instead`` names the event to append in its place
    (for example ``write.fenced``). ``bump_member_epoch`` marks a membership change.
    """

    accept: bool = True
    bump_member_epoch: bool = False
    instead: tuple[str, dict[str, Any]] | None = None


class Reducer(Protocol):
    """A view of the log, rebuilt on replay because it only ever sees appended events."""

    name: str

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> Admission | None:
        """Judge an actor's ``Emit`` before it is appended; ``None`` means no opinion."""
        ...

    def apply(self, event: Event) -> None: ...


class Scenario(Protocol):
    """What a run executes: the actor kinds it uses and the commands that boot it.

    A scenario may also define ``reducers() -> list[Reducer]``, returning fresh instances.
    """

    kinds: Mapping[str, ActorKind]

    def boot(self, params: dict[str, Any]) -> list[Command]: ...


REGISTERED_SCENARIOS: dict[str, Scenario] = {}


def register_scenario(name: str, scenario: Scenario) -> None:
    """Make a scenario loadable by name (tests use this for scenarios defined in place)."""
    REGISTERED_SCENARIOS[name] = scenario


def load_scenario(path: str) -> Scenario:
    """A registered name, or ``package.module:NAME``. The path is recorded in run.started."""
    if path in REGISTERED_SCENARIOS:
        return REGISTERED_SCENARIOS[path]
    module, _, name = path.partition(":")
    return getattr(importlib.import_module(module), name)


@dataclass
class ActorSlot:
    kind: str
    state: Any
    lamport: int = 0


@dataclass
class Reaction:
    """The events one delivery appends; their idem keys are ``<cause seq>.<n>``."""

    actor: str
    cause: Event
    appended: list[Event] = field(default_factory=list)


class Runtime:
    def __init__(
        self,
        store: EventStore,
        *,
        run_id: str,
        seed: str,
        scenario: str,
        params: dict[str, Any] | None = None,
        clock: str = "sim",
        config: dict[str, Any] | None = None,
        run_cap_usd: float | None = None,
        project_remaining_usd: float | None = None,
        estimators: Mapping[str, Callable[[dict[str, Any]], float]] | None = None,
    ) -> None:
        self.store = store
        self.run_id = run_id
        self.seed = seed
        self.scenario_path = scenario
        self.scenario = load_scenario(scenario)
        self.params = params or {}
        self.clock_mode = clock
        self.config = config or {}
        self.run_cap_usd = run_cap_usd
        self.project_remaining_usd = project_remaining_usd
        self.estimators = dict(estimators or {})

        self.actors: dict[str, ActorSlot] = {}
        self.queue: list[tuple[int, int, int, str]] = []
        self.vtime = 0
        self.kernel_lamport = 0
        self.member_epoch = 0
        self.market_epoch = 0
        self.ledger = Ledger()
        self.inflight: dict[str, Event] = {}
        self.outbox: list[Event] = []
        self.cancelled: list[str] = []  # effect ids the driver should stop
        self.started_event: Event | None = None
        self.completed_event: Event | None = None
        self.halted: Event | None = None
        make_reducers = getattr(self.scenario, "reducers", None)
        self.reducers: list[Reducer] = list(make_reducers()) if make_reducers else []
        self.views: Mapping[str, Any] = MappingProxyType({r.name: r for r in self.reducers})

    # -- run lifecycle ------------------------------------------------------------------

    def start(self) -> Event:
        payload = {
            "seed": self.seed,
            "scenario": self.scenario_path,
            "params": self.params,
            "clock": self.clock_mode,
            "config": self.config,
            "run_cap_usd": self.run_cap_usd,
            "project_remaining_usd": self.project_remaining_usd,
        }
        self.kernel_lamport = lamport_tick(self.kernel_lamport)
        event = self._append(
            "run.started", KERNEL, payload, self.kernel_lamport, idem_key="run.started"
        )
        self.started_event = event
        if self.run_cap_usd is not None:
            self.ledger.set_cap("run", self.run_id, self.run_cap_usd)
        if self.project_remaining_usd is not None:
            self.ledger.set_cap("project", "project", self.project_remaining_usd)
        reaction = Reaction(KERNEL, event)
        for command in self.scenario.boot(self.params):
            self._apply(reaction, command)
        return event

    # -- outside control: kill switch and budget shock ------------------------------------

    def halt(self, reason: str, ts_virtual: int, by: str = "human") -> Event | None:
        """Honor the kill switch: drop every queued delivery, cancel every in-flight effect
        (releasing its reservation) and stop every actor. Later halts are ignored."""
        if self.halted is not None:
            return None
        self.vtime = max(self.vtime, ts_virtual)
        self.kernel_lamport = lamport_tick(self.kernel_lamport)
        event = self._append(
            "run.halted",
            ENV,
            {"reason": reason, "by": by},
            self.kernel_lamport,
            idem_key="run.halted",
        )
        self.halted = event
        self.queue.clear()
        reaction = Reaction(KERNEL, event)
        for started in sorted(self.inflight.values(), key=lambda e: e.seq):
            effect_id = started.payload["effect_id"]
            self.cancelled.append(effect_id)
            payload = {"effect_id": effect_id, "kind": started.payload["kind"]}
            payload["tag"] = started.payload["tag"]
            self._react(reaction, "effect.cancelled", payload, correlation_id=effect_id)
            if effect_id in self.ledger.open:
                reservation = self.ledger.release(effect_id)
                settled = {"effect_id": effect_id, "reserved_usd": reservation.usd}
                self._react(
                    reaction,
                    "budget.settled",
                    settled | {"actual_usd": 0.0},
                    correlation_id=effect_id,
                )
        self.inflight.clear()
        for actor_id in sorted(self.actors):
            self._react(reaction, "actor.stopped", {"actor_id": actor_id, "reason": "halted"})
        self.actors.clear()
        return event

    def shock(self, level: str, key: str, usd: float, ts_virtual: int, reason: str = "") -> Event:
        """A budget shock: set a new cap now and tell every live actor (it forces an epoch)."""
        self.vtime = max(self.vtime, ts_virtual)
        self.kernel_lamport = lamport_tick(self.kernel_lamport)
        payload = {"level": level, "key": key, "usd": usd, "reason": reason}
        event = self._append(
            "budget.shock",
            ENV,
            payload,
            self.kernel_lamport,
            idem_key=f"shock:{self.store.next_seq}",
        )
        self.ledger.set_cap(level, key, usd)
        if self.halted is None:
            for actor_id in sorted(self.actors):
                self._enqueue(event, actor_id)
        return event

    @property
    def idle(self) -> bool:
        return not self.queue and not self.inflight

    def finish(self) -> Event:
        if self.completed_event is not None:
            raise RuntimeError("the run is already completed")
        payload = {
            "events": self.store.last_seq + 1,
            "alive": sorted(self.actors),
            "spent_usd": self.ledger.spent[("run", self.run_id)],
        }
        self.kernel_lamport = lamport_tick(self.kernel_lamport)
        self.completed_event = self._append(
            "run.completed", KERNEL, payload, self.kernel_lamport, idem_key="run.completed"
        )
        return self.completed_event

    # -- delivery -----------------------------------------------------------------------

    def step(self) -> bool:
        """Deliver the next queued event. Returns False when the queue is empty."""
        while self.queue:
            _, _, seq, target = heapq.heappop(self.queue)
            slot = self.actors.get(target)
            if slot is None:
                continue
            event = self.store.get(seq)
            assert event is not None
            self.vtime = max(self.vtime, event.ts_virtual)
            slot.lamport = lamport_receive(slot.lamport, event.lamport)
            view = View(
                run_id=self.run_id,
                seed=self.seed,
                actor_id=target,
                now=self.vtime,
                lamport=slot.lamport,
                alive=tuple(sorted(self.actors)),
                member_epoch=self.member_epoch,
                views=self.views,
            )
            kind = self.scenario.kinds[slot.kind]
            slot.state, commands = kind.handle(slot.state, event, view)
            reaction = Reaction(target, event)
            for command in commands:
                self._apply(reaction, command)
            return True
        return False

    def complete(
        self, effect_id: str, status: str, result: dict[str, Any], ts_virtual: int
    ) -> Event | None:
        """Append an effect's completion, as it arrived from the outside world.

        A completion of a cancelled effect is dropped (it may race the cancellation).
        """
        started = self.inflight.pop(effect_id, None)
        if started is None:
            return None
        self.vtime = max(self.vtime, ts_virtual)
        payload = {
            "effect_id": effect_id,
            "kind": started.payload["kind"],
            "status": status,
            "result": result,
            "tag": started.payload["tag"],
        }
        event = self._append(
            "effect.completed",
            ENV,
            payload,
            started.lamport + 1,
            causation_id=started.seq,
            correlation_id=effect_id,
            idem_key=f"done:{effect_id}",
        )
        self._enqueue(event, started.actor)
        if effect_id in self.ledger.open:
            actual = float(result.get("cost_usd") or 0.0)
            reservation = self.ledger.settle(effect_id, actual)
            self.kernel_lamport = lamport_receive(self.kernel_lamport, event.lamport)
            self._append(
                "budget.settled",
                KERNEL,
                {"effect_id": effect_id, "reserved_usd": reservation.usd, "actual_usd": actual},
                self.kernel_lamport,
                causation_id=event.seq,
                correlation_id=effect_id,
                idem_key=f"settle:{effect_id}",
            )
        return event

    # -- commands -----------------------------------------------------------------------

    def _apply(self, reaction: Reaction, command: Command) -> None:
        match command:
            case Emit():
                if command.idem_key is not None and self.store.has_idem_key(command.idem_key):
                    return  # the first such event in the log wins
                admission = self._admit(reaction.actor, command)
                if not admission.accept:
                    if admission.instead is not None:
                        self._react(reaction, *admission.instead)
                    return
                if admission.bump_member_epoch:
                    self.member_epoch += 1
                self._react(
                    reaction,
                    command.type,
                    command.payload,
                    idem_key=command.idem_key,
                    correlation_id=command.correlation_id,
                )
            case Send():
                payload = {"to": command.to, "topic": command.topic, "body": command.body}
                event = self._react(
                    reaction, "msg.sent", payload, correlation_id=command.correlation_id
                )
                self._enqueue(event, command.to)
            case SetTimer():
                timer = StartEffect(
                    kind="timer", request={"delay_ms": command.delay_ms}, tag=command.tag
                )
                self._start_effect(reaction, timer)
            case StartEffect():
                self._start_effect(reaction, command)
            case Cancel():
                self._cancel(reaction, command.tag)
            case Spawn():
                if command.actor_id in self.actors:
                    raise ValueError(f"actor {command.actor_id!r} already exists")
                kind = self.scenario.kinds[command.kind]
                payload = {
                    "actor_id": command.actor_id,
                    "kind": command.kind,
                    "args": command.args,
                    "parent": None if reaction.actor == KERNEL else reaction.actor,
                }
                event = self._react(reaction, "actor.spawned", payload)
                self.actors[command.actor_id] = ActorSlot(
                    command.kind, kind.init(command.actor_id, command.args)
                )
                self._enqueue(event, command.actor_id)
            case Stop():
                target = command.actor_id or reaction.actor
                if target in self.actors:
                    if command.cancel:
                        self._cancel_effects(reaction, lambda event: event.actor == target)
                    payload = {"actor_id": target, "reason": command.reason}
                    self._react(reaction, "actor.stopped", payload)
                    del self.actors[target]
            case SetCap():
                payload = {"level": command.level, "key": command.key, "usd": command.usd}
                self._react(reaction, "budget.cap_set", payload)
                self.ledger.set_cap(command.level, command.key, command.usd)
            case _:
                raise TypeError(f"unknown command {command!r}")

    def _admit(self, actor: str, command: Emit) -> Admission:
        bump = False
        for reducer in self.reducers:
            admission = reducer.admit(actor, command.type, command.payload)
            if admission is None:
                continue
            if not admission.accept:
                return admission
            bump = bump or admission.bump_member_epoch
        return Admission(bump_member_epoch=bump)

    def _start_effect(self, reaction: Reaction, command: StartEffect) -> None:
        effect_id = f"eff-{reaction.cause.seq}.{len(reaction.appended)}"
        estimator = self.estimators.get(command.kind)
        usd = estimator(command.request) if estimator else 0.0
        if usd > 0:
            scopes = {"run": self.run_id, **command.scopes}
            if self.project_remaining_usd is not None:
                scopes["project"] = "project"
            refusal = self.ledger.reserve(effect_id, scopes, usd)
            if refusal is not None:
                refused = {"effect_id": effect_id, "usd": usd, "level": refusal.level}
                self._react(reaction, "budget.refused", refused | {"key": refusal.key})
                payload = {
                    "effect_id": effect_id,
                    "kind": command.kind,
                    "status": "refused",
                    "result": {"reason": f"budget cap: {refusal.level} {refusal.key}"},
                    "tag": command.tag,
                }
                event = self._react(reaction, "effect.completed", payload, correlation_id=effect_id)
                self._enqueue(event, reaction.actor)
                return
            reserved = {"effect_id": effect_id, "usd": usd, "scopes": scopes}
            self._react(reaction, "budget.reserved", reserved, correlation_id=effect_id)
        payload = {
            "effect_id": effect_id,
            "kind": command.kind,
            "request": command.request,
            "tag": command.tag,
        }
        event = self._react(reaction, "effect.started", payload, correlation_id=effect_id)
        self.inflight[effect_id] = event
        self.outbox.append(event)

    def _cancel(self, reaction: Reaction, tag: str) -> None:
        self._cancel_effects(
            reaction,
            lambda event: event.actor == reaction.actor and event.payload["tag"] == tag,
        )

    def _cancel_effects(self, reaction: Reaction, select: Callable[[Event], bool]) -> None:
        chosen = [event for event in self.inflight.values() if select(event)]
        for started in sorted(chosen, key=lambda event: event.seq):
            effect_id = started.payload["effect_id"]
            tag = started.payload["tag"]
            del self.inflight[effect_id]
            self.cancelled.append(effect_id)
            payload = {"effect_id": effect_id, "kind": started.payload["kind"], "tag": tag}
            self._react(reaction, "effect.cancelled", payload, correlation_id=effect_id)
            if effect_id in self.ledger.open:
                reservation = self.ledger.release(effect_id)
                settled = {"effect_id": effect_id, "reserved_usd": reservation.usd}
                self._react(
                    reaction,
                    "budget.settled",
                    settled | {"actual_usd": 0.0},
                    correlation_id=effect_id,
                )

    # -- appending ----------------------------------------------------------------------

    def _react(
        self,
        reaction: Reaction,
        event_type: str,
        payload: dict[str, Any],
        *,
        idem_key: str | None = None,
        correlation_id: str | None = None,
    ) -> Event:
        if reaction.actor == KERNEL:
            self.kernel_lamport = lamport_tick(self.kernel_lamport)
            lamport = self.kernel_lamport
        else:
            slot = self.actors[reaction.actor]
            slot.lamport = lamport_tick(slot.lamport)
            lamport = slot.lamport
        event = self._append(
            event_type,
            reaction.actor,
            payload,
            lamport,
            causation_id=reaction.cause.seq,
            correlation_id=correlation_id,
            idem_key=idem_key or f"{reaction.cause.seq}.{len(reaction.appended)}",
        )
        reaction.appended.append(event)
        return event

    def _append(
        self,
        event_type: str,
        actor: str,
        payload: dict[str, Any],
        lamport: int,
        *,
        idem_key: str,
        causation_id: int | None = None,
        correlation_id: str | None = None,
    ) -> Event:
        draft = EventDraft(
            run_id=self.run_id,
            ts_virtual=self.vtime,
            lamport=lamport,
            member_epoch=self.member_epoch,
            market_epoch=self.market_epoch,
            type=event_type,
            actor=actor,
            causation_id=causation_id,
            correlation_id=correlation_id,
            idem_key=idem_key,
            payload=payload,
        )
        event = self.store.append(draft)
        for reducer in self.reducers:
            reducer.apply(event)
        return event

    def _enqueue(self, event: Event, target: str) -> None:
        heapq.heappush(self.queue, (event.ts_virtual, event.lamport, event.seq, target))
