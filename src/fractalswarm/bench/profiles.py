"""Chaos profiles C0-C3 (spec §15.4) and the shared crash points (spec §15.2).

The harness only names a profile and hands it to the workflow; injecting the faults is the
chaos layer's job, the same for every workflow.
"""

from pydantic import BaseModel, ConfigDict

# Coordinator crashes happen at these fractions of contracts dispatched, in this order.
CRASH_POINTS = (0.20, 0.35, 0.50, 0.65, 0.80)
# A crashed baseline coordinator restarts this long after the crash (= swarm detection, §5.2).
RESTART_DELAY_MS = 5_000


class ChaosProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    coordinator_crashes: int
    agents_killed_pct: int
    api_fault_pct: int
    message_loss_pct: int
    partition: bool

    @property
    def crash_points(self) -> tuple[float, ...]:
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


def profile(name: str) -> ChaosProfile:
    try:
        return PROFILES[name]
    except KeyError:
        raise ValueError(f"unknown chaos profile {name!r} (known: {sorted(PROFILES)})") from None
