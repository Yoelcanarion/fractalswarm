"""The event envelope (spec §5.1) and the registry of event types and their payloads.

Every payload is validated against its registered model before it enters the log, and is
stored in its JSON form, so the chain hash never depends on Python object identity.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# Actor names for events that no actor produced.
KERNEL = "@kernel"  # deterministic bookkeeping: run start and end, budget, refusals
ENV = "@env"  # the outside world: effect completions, chaos, human actions

ROW_FIELDS = (
    "seq",
    "run_id",
    "ts_virtual",
    "lamport",
    "member_epoch",
    "market_epoch",
    "type",
    "actor",
    "causation_id",
    "correlation_id",
    "idem_key",
    "payload",
)


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class EventDraft(BaseModel):
    """An event before the store gives it a sequence number and a chain hash."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str
    ts_virtual: int = Field(ge=0, description="virtual time in milliseconds")
    lamport: int = Field(ge=0)
    member_epoch: int = 0
    market_epoch: int = 0
    type: str
    actor: str
    causation_id: int | None = None
    correlation_id: str | None = None
    idem_key: str
    payload: dict[str, Any]


class Event(EventDraft):
    seq: int = Field(ge=1)
    prev_hash: str
    hash: str

    def row(self) -> dict[str, Any]:
        """The hashed part of the event: every column except ``prev_hash`` and ``hash``."""
        return self.model_dump(include=set(ROW_FIELDS))


EVENT_TYPES: dict[str, type[Payload]] = {}


def register(event_type: str):
    def decorator(model: type[Payload]) -> type[Payload]:
        if EVENT_TYPES.get(event_type, model) is not model:
            raise ValueError(f"event type {event_type!r} is already registered")
        EVENT_TYPES[event_type] = model
        return model

    return decorator


def validate_payload(event_type: str, payload: dict[str, Any] | Payload) -> dict[str, Any]:
    try:
        model = EVENT_TYPES[event_type]
    except KeyError:
        raise ValueError(f"unknown event type {event_type!r}") from None
    if isinstance(payload, Payload):
        payload = payload.model_dump(mode="json")
    return model.model_validate(payload).model_dump(mode="json")


@register("run.started")
class RunStarted(Payload):
    seed: str
    scenario: str
    params: dict[str, Any] = {}
    clock: str
    # Whatever the effects need to behave the same in replay (role and price tables).
    config: dict[str, Any] = {}
    run_cap_usd: float | None = None
    # Snapshot of the project ledger at start, so that replay sees the same project cap.
    project_remaining_usd: float | None = None


@register("run.completed")
class RunCompleted(Payload):
    events: int
    alive: list[str]
    spent_usd: float


@register("actor.spawned")
class ActorSpawned(Payload):
    actor_id: str
    kind: str
    args: dict[str, Any] = {}
    parent: str | None = None


@register("actor.stopped")
class ActorStopped(Payload):
    actor_id: str
    reason: str = ""


@register("msg.sent")
class MsgSent(Payload):
    to: str
    topic: str
    body: dict[str, Any] = {}


@register("effect.started")
class EffectStarted(Payload):
    effect_id: str
    kind: str
    request: dict[str, Any]
    tag: str | None = None


@register("effect.completed")
class EffectCompleted(Payload):
    effect_id: str
    kind: str
    status: str  # ok | error | refused | incomplete
    result: dict[str, Any] = {}
    tag: str | None = None


@register("effect.cancelled")
class EffectCancelled(Payload):
    effect_id: str
    kind: str
    tag: str | None = None


@register("budget.cap_set")
class BudgetCapSet(Payload):
    level: str
    key: str
    usd: float = Field(ge=0)


@register("budget.reserved")
class BudgetReserved(Payload):
    effect_id: str
    usd: float
    scopes: dict[str, str]


@register("budget.refused")
class BudgetRefused(Payload):
    effect_id: str
    usd: float
    level: str
    key: str


@register("budget.settled")
class BudgetSettled(Payload):
    effect_id: str
    reserved_usd: float
    actual_usd: float


@register("run.halted")
class RunHalted(Payload):
    """The kill switch (spec §13): no delivery and no new effect after it."""

    reason: str
    by: str = "human"


@register("budget.shock")
class BudgetShock(Payload):
    """A new cap from outside (UI or API) in the middle of a run (spec §7.4)."""

    level: str
    key: str
    usd: float = Field(ge=0)
    reason: str = ""


GOAL_CONTROL = "goal:"  # a control for a goal: ``goal:<id>``


@register("control.injected")
class ControlInjected(Payload):
    """A control from a person in the middle of a run, addressed to one actor, to every live one
    (``*``) or to a goal (``goal:<id>``): the arena's kill button (``chaos``, for the monkey), a
    plan approved or sent back (``approve``, ``replan``), the answer to an escalation
    (``answer``). The kernel records and delivers it; what ``op`` means is up to the actor, which
    ignores an ``op`` that is not for it. A goal's control reaches every live actor and the
    goal's owner, as that actor's own view of the log has it at this event, is the one that
    acts: it survives a takeover that happens between the click and the handling."""

    op: str
    body: dict[str, Any] = {}
    to: str


@register("run.resumed")
class RunResumed(Payload):
    """The process died and the run went on from its log (spec §8, docs/resume.md)."""

    attempt: int  # 1 for the first resume of this run
    log_events: int  # events in the log when the dead process was found
    completed_tail: int = 0  # events appended to finish the reaction the crash cut
    from_cassette: list[str] = []  # open effects answered from the cassette: no new request
    ambiguous: list[str] = []  # open effects sent again: the provider may have run them already
    rerun: dict[str, int] = {}  # local effects (timers, scans) run again, by kind
    possible_extra_usd: float = 0.0  # what the ambiguous effects may have cost a second time
    cassette_dropped_bytes: int = 0  # a torn last cassette line that was cut off


@register("effect.reissued")
class EffectReissued(Payload):
    """An effect that may have run before the crash is sent again."""

    effect_id: str
    kind: str
    ambiguous: bool
    reserved_usd: float = 0.0
    reason: str = ""
