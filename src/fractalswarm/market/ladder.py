"""The model ladder (spec §7.4): degrade model and effort as the run budget fills.

| spent share | level | what changes |
|---|---|---|
| < 80% | L0 | normal operation |
| >= 80% | L1 | cheaper model or effort; no speculative execution; scale down |
| >= 90% | L2 | cheaper still; only the critical path continues |
| >= 95% | stop | partial result with explicit gaps and a resumable checkpoint |

"Spent" counts committed money (settled plus open reservations), so the ladder reacts before
the money is gone. A budget shock that lowers the cap moves the run up the ladder at once.
Safety roles are never degraded: ``config/roles.yaml`` gives them the same spec at every level.
"""

from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, model_validator

from fractalswarm.config import CONFIG_DIR
from fractalswarm.llm.roles import RoleSpec, RoleTable
from fractalswarm.market.ledger import Ledger

Level = Literal["L0", "L1", "L2", "stop"]
LEVELS: tuple[Level, ...] = ("L0", "L1", "L2", "stop")


class Thresholds(BaseModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    L1: float = 0.80
    L2: float = 0.90
    stop: float = 0.95

    @model_validator(mode="after")
    def ordered(self) -> "Thresholds":
        if not 0 < self.L1 <= self.L2 <= self.stop <= 1:
            raise ValueError("ladder thresholds must satisfy 0 < L1 <= L2 <= stop <= 1")
        return self

    @classmethod
    def load(cls, path: Path = CONFIG_DIR / "defaults.yaml") -> "Thresholds":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls.model_validate(data["budget"]["ladder"])


class LadderState(BaseModel):
    model_config = ConfigDict(frozen=True)

    level: Level
    share: float
    speculative: bool  # may start speculative work
    scale_down: bool
    critical_only: bool
    stop: bool


def ladder_level(spent_usd: float, cap_usd: float | None, thresholds: Thresholds) -> Level:
    if cap_usd is None:
        return "L0"
    if cap_usd <= 0:
        return "stop"
    share = spent_usd / cap_usd
    if share >= thresholds.stop:
        return "stop"
    if share >= thresholds.L2:
        return "L2"
    if share >= thresholds.L1:
        return "L1"
    return "L0"


def ladder_state(spent_usd: float, cap_usd: float | None, thresholds: Thresholds) -> LadderState:
    level = ladder_level(spent_usd, cap_usd, thresholds)
    rank = LEVELS.index(level)
    share = 0.0 if not cap_usd else spent_usd / cap_usd
    return LadderState(
        level=level,
        share=share,
        speculative=rank == 0,
        scale_down=rank >= 1,
        critical_only=rank >= 2,
        stop=level == "stop",
    )


def run_ladder(ledger: Ledger, run_id: str, thresholds: Thresholds) -> LadderState:
    """The ladder for a run from the kernel's in-run book (committed = spent + reserved)."""
    scope = ("run", run_id)
    return ladder_state(ledger.committed(scope), ledger.caps.get(scope), thresholds)


def request_level(level: str) -> str:
    """The level an LLM request carries. At ``stop`` no new work starts, but a call that is
    still made (a plan already under way) takes the cheapest specs: ``roles.yaml`` has none
    for ``stop``."""
    return "L2" if level == "stop" else level


def actions(level: str) -> list[str]:
    """What the run does at a level, for the ``budget.threshold`` event (spec §7.4)."""
    if level == "L0":
        return ["normal operation"]
    steps = ["cheaper model and effort", "scale squads down to one agent"]
    if level in ("L2", "stop"):
        steps.append("only the critical path continues")
    if level == "stop":
        steps.append("no new contracts: partial result with explicit gaps")
    return steps


def critical_closure(contracts: Mapping[str, Mapping[str, Any]]) -> set[str]:
    """The contracts that keep running at L2, where "only the critical path continues" (spec
    §7.4): the ones flagged critical and everything they depend on, however far back. A
    plan that flags none has no critical path to prune to: all of it continues."""
    flagged = [cid for cid, found in contracts.items() if found.get("critical_path")]
    if not flagged:
        return set(contracts)
    keep: set[str] = set()
    while flagged:
        cid = flagged.pop()
        if cid in keep or cid not in contracts:
            continue
        keep.add(cid)
        flagged.extend(contracts[cid].get("depends_on", []))
    return keep


def degrade(roles: RoleTable, role: str, level: Level) -> RoleSpec | None:
    """The role's spec at this level; None once the run must stop."""
    if level == "stop":
        return None
    return roles.resolve(role, level)
