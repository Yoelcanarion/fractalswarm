"""Chaos profiles C0-C3 (spec §15.4) and the shared crash points (spec §15.2).

The harness only names a profile and hands it to the workflow; injecting the faults is the
chaos layer's job, the same for every workflow.

A profile named ``K-<target>`` or ``K-<target>@<at>`` is the per-process probe of the arena
(arena spec §C.2): one coordinator crash, on the named actor, when ``at`` of the contracts
have been dispatched (0.5 unless given), and no other fault. Run on every level of the swarm's
tree and on a supervisor's ``o0``, it measures what one process failure costs per level.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict

# Coordinator crashes happen at these fractions of contracts dispatched, in this order.
CRASH_POINTS = (0.20, 0.35, 0.50, 0.65, 0.80)
# A crashed baseline coordinator restarts this long after the crash (= swarm detection, §5.2).
RESTART_DELAY_MS = 5_000
SINGLE_CRASH_PREFIX = "K-"
SINGLE_CRASH_AT = 0.5


class ChaosProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    coordinator_crashes: int
    agents_killed_pct: int
    api_fault_pct: int
    message_loss_pct: int
    partition: bool
    # The per-process probe (``K-<target>@<at>``): the one actor to crash, and when.
    target: str | None = None
    at: float | None = None

    @property
    def crash_points(self) -> tuple[float, ...]:
        if self.at is not None:
            return (self.at,)
        return CRASH_POINTS[: self.coordinator_crashes]


PROFILES: dict[str, ChaosProfile] = {
    profile.name: profile
    for profile in (
        ChaosProfile(
            name="C0",
            coordinator_crashes=0,
            agents_killed_pct=0,
            api_fault_pct=0,
            message_loss_pct=0,
            partition=False,
        ),
        ChaosProfile(
            name="C1",
            coordinator_crashes=1,
            agents_killed_pct=10,
            api_fault_pct=5,
            message_loss_pct=5,
            partition=False,
        ),
        ChaosProfile(
            name="C2",
            coordinator_crashes=3,
            agents_killed_pct=30,
            api_fault_pct=10,
            message_loss_pct=10,
            partition=True,
        ),
        ChaosProfile(
            name="C3",
            coordinator_crashes=5,
            agents_killed_pct=50,
            api_fault_pct=20,
            message_loss_pct=20,
            partition=True,
        ),
    )
}


def single_crash(target: str, at: float = SINGLE_CRASH_AT) -> ChaosProfile:
    """The per-process probe: crash ``target`` once, at ``at`` of the contracts dispatched."""
    if not target or not 0 < at <= 1:
        raise ValueError(f"a single crash needs a target and 0 < at <= 1, got {target!r}@{at}")
    name = f"{SINGLE_CRASH_PREFIX}{target}" + ("" if at == SINGLE_CRASH_AT else f"@{at:g}")
    return ChaosProfile(
        name=name,
        coordinator_crashes=1,
        agents_killed_pct=0,
        api_fault_pct=0,
        message_loss_pct=0,
        partition=False,
        target=target,
        at=at,
    )


def profile(name: str) -> ChaosProfile:
    if name.startswith(SINGLE_CRASH_PREFIX):
        target, _, at = name.removeprefix(SINGLE_CRASH_PREFIX).partition("@")
        try:
            return single_crash(target, float(at) if at else SINGLE_CRASH_AT)
        except ValueError as exc:
            raise ValueError(f"bad single-crash profile {name!r}: {exc}") from None
    try:
        return PROFILES[name]
    except KeyError:
        raise ValueError(f"unknown chaos profile {name!r} (known: {sorted(PROFILES)})") from None


def single_crash_plan(chaos: ChaosProfile, seed: str = "0") -> dict[str, Any]:
    """The JSON of the ``ChaosPlan`` (``comms/chaos.py``) for a ``K-`` profile: one
    ``kill_coordinator`` with an explicit target. A target that is no coordinator when the
    time comes is skipped, and the run records no crash."""
    if chaos.target is None or chaos.at is None:
        raise ValueError(f"{chaos.name} is not a single-crash profile")
    action = {"at": chaos.at, "kind": "kill_coordinator", "target": chaos.target}
    return {"profile": chaos.name, "seed": seed, "actions": [action]}


def half_the_brains_plan(seed: str = "0") -> dict[str, Any]:
    """The arena's failure plan (arena spec §D), as the JSON of a ``ChaosPlan``
    (``comms/chaos.py``, which imports this module, so the plan is plain data here).

    Five coordinator crashes at the shared crash points, and nothing else: no agent kills, no
    network or API faults, so a pair isolates coordinator recovery. The first crash names
    ``o0``, the root, in both systems. The rest name nobody: the swarm's targeting rule picks
    the coordinator with the most work left (a track lead, mostly), and a supervisor has only
    ``o0`` to lose. A name that is not a candidate is skipped, which is why ``kill-half``
    (explicit names of the swarm's coordinators) crashes a supervisor once, not five times.
    """
    actions: list[dict[str, Any]] = [{"at": at, "kind": "kill_coordinator"} for at in CRASH_POINTS]
    actions[0]["target"] = "o0"
    return {"profile": "half-the-brains", "seed": seed, "actions": actions}
