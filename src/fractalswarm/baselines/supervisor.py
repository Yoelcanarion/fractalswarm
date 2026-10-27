"""The best-case supervisor every baseline gets (spec §15.2).

A baseline coordinator keeps a ``Supervised`` record in its state and calls these pure
functions from its handler:

- ``dispatch`` / ``track`` when it starts work, ``settle`` when that work completes;
- ``crash_due`` after each dispatch: the crashes happen at the shared logical progress points
  (``bench.profiles.CRASH_POINTS`` of the contracts dispatched), the same for every workflow;
- ``crash``: process-tree semantics. Every in-flight effect of the coordinator, including its
  workers' calls, is cancelled, and a restart timer fires ``RESTART_DELAY_MS`` later (= the
  swarm's detection latency); the restart itself takes 0 s;
- ``restart`` when that timer completes: completed work is kept (native persistence), only the
  lost in-flight work is handed back to redo. No LLM re-planning.

While the coordinator is down (``state.up`` is false) it must not start work.
"""

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict

from fractalswarm.bench.profiles import RESTART_DELAY_MS, ChaosProfile
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.scheduler import Cancel, Command, Emit, SetTimer

RESTART_TAG = "supervisor:restart"


@register("baseline.crashed")
class BaselineCrashed(Payload):
    coordinator: str
    crash: int  # 1-based
    dispatched: int
    lost: list[str]
    restart_in_ms: int


@register("baseline.restarted")
class BaselineRestarted(Payload):
    coordinator: str
    crash: int
    redo: list[str]


class Supervised(BaseModel):
    model_config = ConfigDict(frozen=True)

    coordinator: str
    plan: tuple[int, ...] = ()  # crash when this many contracts have been dispatched
    crashes: int = 0
    up: bool = True
    dispatched: tuple[str, ...] = ()  # distinct contracts, first-dispatch order
    inflight: dict[str, str] = {}  # effect tag -> work key, in start order
    lost: tuple[str, ...] = ()  # work keys cancelled by the last crash


def crash_plan(total_contracts: int, profile: ChaosProfile) -> tuple[int, ...]:
    """Dispatch counts that trigger each crash: ceil(point × total), at least 1.

    Integer percent arithmetic, so 0.35 × 20 is 7, not 8.
    """
    if total_contracts <= 0:
        return ()
    plan = []
    for point in profile.crash_points:
        percent = round(point * 100)
        plan.append(max(1, -(-percent * total_contracts // 100)))
    return tuple(plan)


def supervised(coordinator: str, total_contracts: int, profile: ChaosProfile) -> Supervised:
    return Supervised(coordinator=coordinator, plan=crash_plan(total_contracts, profile))


def track(state: Supervised, key: str, tag: str) -> Supervised:
    """Record in-flight work under the coordinator (redone if a crash cancels it)."""
    if not state.up:
        raise RuntimeError(f"{state.coordinator} is down; it cannot start {key!r}")
    if tag in state.inflight:
        raise ValueError(f"tag {tag!r} is already in flight")
    return state.model_copy(update={"inflight": {**state.inflight, tag: key}})


def dispatch(state: Supervised, contract: str, tag: str) -> Supervised:
    """Like ``track``, and the contract counts towards the crash points the first time."""
    state = track(state, contract, tag)
    if contract in state.dispatched:
        return state
    return state.model_copy(update={"dispatched": (*state.dispatched, contract)})


def settle(state: Supervised, tag: str) -> Supervised:
    """The work under ``tag`` finished (any status); it is no longer at risk."""
    if tag not in state.inflight:
        return state
    inflight = {t: key for t, key in state.inflight.items() if t != tag}
    return state.model_copy(update={"inflight": inflight})


def crash_due(state: Supervised) -> bool:
    return (
        state.up
        and state.crashes < len(state.plan)
        and len(state.dispatched) >= state.plan[state.crashes]
    )


def crash(state: Supervised) -> tuple[Supervised, list[Command]]:
    lost = tuple(state.inflight.values())
    number = state.crashes + 1
    payload = {
        "coordinator": state.coordinator,
        "crash": number,
        "dispatched": len(state.dispatched),
        "lost": list(lost),
        "restart_in_ms": RESTART_DELAY_MS,
    }
    commands: list[Command] = [Emit(type="baseline.crashed", payload=payload)]
    commands += [Cancel(tag=tag) for tag in state.inflight]
    commands.append(SetTimer(delay_ms=RESTART_DELAY_MS, tag=RESTART_TAG))
    update = {"up": False, "crashes": number, "inflight": {}, "lost": lost}
    return state.model_copy(update=update), commands


def is_restart(event: Event) -> bool:
    return event.type == "effect.completed" and event.payload.get("tag") == RESTART_TAG


def restart(state: Supervised) -> tuple[Supervised, list[Command], list[str]]:
    """Bring the coordinator back. Returns the lost work keys to redo, in their start order."""
    if state.up:
        raise RuntimeError(f"{state.coordinator} is not down")
    redo = list(state.lost)
    payload = {"coordinator": state.coordinator, "crash": state.crashes, "redo": redo}
    new = state.model_copy(update={"up": True, "lost": ()})
    return new, [Emit(type="baseline.restarted", payload=payload)], redo


def crash_target(remaining: Mapping[str, int]) -> str:
    """The coordinator with the most remaining owned work; ties go to the smallest id."""
    ranked = sorted(remaining.items(), key=lambda item: (-item[1], item[0]))
    if not ranked:
        raise ValueError("no coordinators to crash")
    return ranked[0][0]
