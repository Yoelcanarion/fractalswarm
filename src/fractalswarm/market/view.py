"""The economy as a view of the log (spec §5.1: ``budgets`` and ``quotas``).

Shared log, not shared brain: a market maker keeps no money in its own memory. Everything it
needs to clear an epoch is in the log, and ``MarketView`` (a kernel reducer, read through
``View.views["market"]``) materializes it: what each squad has committed and what it may
(the ledger's reservations, settlements and caps), the epoch each market has reached and its
last clearing, the cumulative caps of intermediate children, and the AIMD quotas. When a
market maker dies, its heir reads the same view and clears the next epoch.

Money is in integer micro-dollars. A reservation counts as committed from the moment it is
made, as in the ledger, so the view and the ledger agree at every event.
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.kernel.events import Event
from fractalswarm.market import events as _events  # noqa: F401  (registers the event types)
from fractalswarm.market.allocation import to_micros
from fractalswarm.market.quotas import Quota, rate_limited


@dataclass
class Clearing:
    """The last clearing of one market."""

    epoch: int
    at_ms: int
    grants: dict[str, int]  # child -> $ granted (micros)
    base: dict[str, int]  # child -> $ its subtree had committed at the time (micros)
    reserve: int  # $ held back for top-ups (micros)
    pool: int  # $ nobody asked for (micros)
    topped: int = 0  # reserve handed out since, as top-ups (micros)

    @property
    def reserve_left(self) -> int:
        return max(self.reserve - self.topped, 0)


class MarketView:
    name = "market"

    def __init__(self) -> None:
        self.run_cap: int | None = None
        self.squad_caps: dict[str, int] = {}  # squad -> ledger cap (micros)
        self.reserved: dict[str, int] = {}  # squad -> open reservations (micros)
        self.spent: dict[str, int] = {}  # squad -> settled spend (micros)
        self._open: dict[str, tuple[str, int]] = {}  # effect id -> (squad, reservation)
        self.epochs: dict[str, int] = {}  # goal -> last closed epoch
        self.opened: dict[str, int] = {}  # goal -> virtual ms its current epoch opened
        self.clearings: dict[str, Clearing] = {}  # goal -> its last clearing
        self.caps: dict[str, int] = {}  # actor -> cumulative cap on its subtree (micros)
        self.slices: dict[str, dict[str, dict[str, int]]] = {}  # actor -> resource -> grant
        self.quotas: dict[str, Quota] = {}  # model -> AIMD state
        self.models: set[str] = set()  # models the run has used
        self.pressure = 0  # rate-limited calls since the last quota update
        self.shocks = 0

    # -- queries --------------------------------------------------------------------------

    def committed(self, squad: str) -> int:
        return self.reserved.get(squad, 0) + self.spent.get(squad, 0)

    def committed_total(self) -> int:
        return sum(self.reserved.values()) + sum(self.spent.values())

    def headroom(self, squad: str) -> int | None:
        """What the squad may still commit under its cap; ``None`` if it has none."""
        cap = self.squad_caps.get(squad)
        return None if cap is None else cap - self.committed(squad)

    def next_epoch(self, goal: str) -> int:
        return self.epochs.get(goal, -1) + 1

    # -- the reducer ----------------------------------------------------------------------

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        payload = event.payload
        kind = event.type
        if kind == "budget.reserved":
            squad = payload["scopes"].get("squad")
            if squad is not None:
                micros = to_micros(payload["usd"])
                self._open[payload["effect_id"]] = (squad, micros)
                self.reserved[squad] = self.reserved.get(squad, 0) + micros
        elif kind == "budget.settled":
            held = self._open.pop(payload["effect_id"], None)
            if held is not None:
                squad, micros = held
                self.reserved[squad] -= micros
                self.spent[squad] = self.spent.get(squad, 0) + to_micros(payload["actual_usd"])
        elif kind == "run.started":
            if payload.get("run_cap_usd") is not None:
                self.run_cap = to_micros(payload["run_cap_usd"])
        elif kind in ("budget.cap_set", "budget.shock"):
            self._cap_set(payload)
            self.shocks += kind == "budget.shock"
        elif kind == "effect.completed" and payload["kind"] == "llm":
            result = payload.get("result") or {}
            if result.get("model"):
                self.models.add(result["model"])
            self.pressure += rate_limited(result)
        elif kind == "market.epoch_closed":
            self.epochs[payload["goal_id"]] = payload["epoch"]
            self.opened[payload["goal_id"]] = payload["at_ms"]
        elif kind == "market.cleared":
            self._cleared(payload, event.ts_virtual)
        elif kind == "market.topup":
            self._topped(payload)
        elif kind == "market.quota":
            self.quotas[payload["model"]] = Quota(
                model=payload["model"],
                limit_rpm=payload["limit_rpm"],
                limit_tpm=payload["limit_tpm"],
                fraction=payload["fraction"],
            )
            self.pressure = 0

    def _cap_set(self, payload: dict[str, Any]) -> None:
        micros = to_micros(payload["usd"])
        if payload["level"] == "squad":
            self.squad_caps[payload["key"]] = micros
        elif payload["level"] == "run":
            self.run_cap = micros

    def _cleared(self, payload: dict[str, Any], at_ms: int) -> None:
        usd = payload["resources"].get("usd")
        if usd is not None:
            self.clearings[payload["goal_id"]] = Clearing(
                epoch=payload["epoch"],
                at_ms=at_ms,
                grants=dict(usd["grants"]),
                base=dict(payload["base"]),
                reserve=usd["reserve"],
                pool=usd["pool"],
            )
        for child, cap in payload["caps"].items():
            self.caps[child] = cap
        for name, resource in payload["resources"].items():
            if name == "usd":
                continue
            for child, grant in resource["grants"].items():
                self.slices.setdefault(child, {})[name] = grant

    def _topped(self, payload: dict[str, Any]) -> None:
        clearing = self.clearings.get(payload["goal_id"])
        if clearing is not None:
            clearing.topped += payload["granted_micros"]
        self.caps[payload["child"]] = payload["cap_micros"]
