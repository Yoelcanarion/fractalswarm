"""Autoscale (spec §7.3): how many orchestrators and agents the run runs, as pure functions.

- orchestrators per group: ``min(#subgoals, cap, affordable)``, at least one;
- a squad's agents: ``clamp(min(ready contracts, $alloc / est cost per contract,
  rpm_alloc / rpm per agent), 1, cap)``;
- hysteresis: scale-up is immediate, scale-down waits until the squad has been above its
  target in two consecutive epochs (``SquadScale``);
- recursion: a goal is split while its complexity exceeds a threshold and its depth is below
  the cap (``should_recurse``).

A term with no bound (no cap on the squad, no RPM slice yet) does not limit. Nothing here
reads a clock: epochs are the market's counters, so replay reproduces every decision.
"""

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict

DOWN_EPOCHS = 2  # consecutive epochs above its target before a squad scales down


class Caps(BaseModel):
    """The autoscale caps (``config/defaults.yaml: scaling.autoscale``)."""

    model_config = ConfigDict(frozen=True)

    max_orchestrators_per_group: int = 6
    max_agents_per_orchestrator: int = 4
    max_depth: int = 2
    complexity_threshold: int = 1


def affordable(envelope: int | None, est_each: int) -> int | None:
    """How many pieces of work an envelope pays for; ``None`` when nothing bounds it."""
    if envelope is None or est_each <= 0:
        return None
    return max(envelope, 0) // est_each


def orchestrators_for(subgoals: int, cap: int, can_afford: int | None) -> int:
    """``min(#subgoals, cap, affordable)``, but never fewer than one for a goal with work."""
    if subgoals <= 0:
        return 0
    most = min(subgoals, cap)
    return max(1, most if can_afford is None else min(most, can_afford))


def desired_agents(
    ready: int,
    usd_alloc: int | None,
    est_cost: int,
    rpm_alloc: int | None,
    rpm_per_agent: int,
    cap: int,
) -> int:
    """``clamp(min(ready, $alloc / est cost, rpm_alloc / rpm per agent), 1, cap)``."""
    bounds = [ready]
    if usd_alloc is not None and est_cost > 0:
        bounds.append(max(usd_alloc, 0) // est_cost)
    if rpm_alloc is not None and rpm_per_agent > 0:
        bounds.append(max(rpm_alloc, 0) // rpm_per_agent)
    return max(1, min(min(bounds), cap))


def should_recurse(complexity: int, threshold: int, level: int, max_depth: int) -> bool:
    """Split a goal while its complexity exceeds the threshold and its depth is below the cap."""
    return complexity > threshold and level < max_depth


@dataclass(frozen=True)
class SquadScale:
    """A squad's agent count and how long it has been above its target."""

    below: int = 0  # consecutive epochs the squad has had more agents than its target
    epoch: int | None = None  # the last epoch that counted


def step(scale: SquadScale, live: int, target: int, epoch: int) -> tuple[SquadScale, int]:
    """One evaluation at ``epoch``: the new state and the change in agents (+ up, - down).

    Scale-up is immediate. Scale-down needs ``DOWN_EPOCHS`` consecutive epochs with more
    agents than the target; evaluating again within one epoch does not count twice.
    """
    if target >= live:
        return SquadScale(), target - live
    below = scale.below if scale.epoch == epoch else scale.below + 1
    if below >= DOWN_EPOCHS:
        return SquadScale(), target - live
    return SquadScale(below=below, epoch=epoch), 0
