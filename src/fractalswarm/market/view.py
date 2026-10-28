"""The economy as a view of the log (spec §5.1: ``budgets`` and ``quotas``).

Shared log, not shared brain: a market maker keeps no money in its own memory. Everything it
needs to clear an epoch is in the log, and ``MarketView`` (a kernel reducer, read through
``View.views["market"]``) materializes it: what each squad has committed and what it may
(the ledger's reservations, settlements and caps), the epoch each market has reached and its
last clearing, the cumulative caps of intermediate children, and the AIMD quotas. When a
market maker dies, its heir reads the same view and clears the next epoch.

Money is in integer micro-dollars. A reservation counts as committed from the moment it is
made, as in the ledger, so the view and the ledger agree at every event.

The global spend breaker (spec §8) lives here too, when the run enables it: every settled cost
goes through ``market/spend_breaker.py`` on virtual time, so whether it is open at a given
moment is a fact of the log, the same for every orchestrator and for replay.
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.kernel.events import Event
from fractalswarm.market import events as _events  # noqa: F401  (registers the event types)
from fractalswarm.market.allocation import to_micros, to_usd
from fractalswarm.market.ladder import LadderState, Thresholds, ladder_state
from fractalswarm.market.quotas import Quota, rate_limited
from fractalswarm.market.spend_breaker import SpendBreaker, SpendBreakerConfig, record_spend


@dataclass
class Clearing:
    """The last clearing of one market."""

    epoch: int
    at_ms: int
    grants: dict[str, int]  # child -> $ granted (micros)
    base: dict[str, int]  # child -> $ its subtree had spent at the time (micros)
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
        self._open_all: dict[str, int] = {}  # effect id -> reservation, whatever its scopes
        self.run_reserved = 0  # open reservations of the whole run (micros)
        self.last_call_at = 0  # virtual ms of the last reservation: the run's last sign of life
        self.run_spent = 0  # settled spend of the whole run (micros)
        self.thresholds: Thresholds | None = None  # the ladder's rungs; None: no ladder
        self.ladder: LadderState = ladder_state(0.0, None, Thresholds())  # where the run is
        self.changes: list[dict[str, Any]] = []  # every rung crossed, for budget.threshold
        self.breaker = SpendBreaker()  # the global spend breaker (spec §8)
        self.breaker_config: SpendBreakerConfig | None = None  # None: not enabled
        self.epochs: dict[str, int] = {}  # goal -> last closed epoch
        self.opened: dict[str, int] = {}  # goal -> virtual ms its current epoch opened
        self.clearings: dict[str, Clearing] = {}  # goal -> its last clearing
        self.caps: dict[str, int] = {}  # goal -> cumulative cap on what its subtree spends
        self.slices: dict[str, dict[str, dict[str, int]]] = {}  # actor -> resource -> grant
        self.quotas: dict[str, Quota] = {}  # model -> AIMD state
        self.models: set[str] = set()  # models the run has used
        self.pressure = 0  # rate-limited calls since the last quota update
        self.shocks = 0

    # -- queries --------------------------------------------------------------------------

    def committed(self, squad: str) -> int:
        return self.reserved.get(squad, 0) + self.spent.get(squad, 0)

    def committed_total(self) -> int:
        return self.run_reserved + self.run_spent

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
            micros = to_micros(payload["usd"])
            self._open_all[payload["effect_id"]] = micros
            self.run_reserved += micros
            self.last_call_at = event.ts_virtual
            self._rung(event.ts_virtual)
            squad = payload["scopes"].get("squad")
            if squad is not None:
                self._open[payload["effect_id"]] = (squad, micros)
                self.reserved[squad] = self.reserved.get(squad, 0) + micros
        elif kind == "budget.settled":
            actual = to_micros(payload["actual_usd"])
            reserved = self._open_all.pop(payload["effect_id"], None)
            if reserved is not None:
                self.run_reserved -= reserved
                self.run_spent += actual
            held = self._open.pop(payload["effect_id"], None)
            if held is not None:
                squad, micros = held
                self.reserved[squad] -= micros
                self.spent[squad] = self.spent.get(squad, 0) + actual
            self._burn(event.ts_virtual, payload["actual_usd"])
            self._rung(event.ts_virtual)
        elif kind == "run.started":
            if payload.get("run_cap_usd") is not None:
                self.run_cap = to_micros(payload["run_cap_usd"])
            economy = (payload.get("params") or {}).get("market") or {}
            if economy.get("breaker"):
                self.breaker_config = SpendBreakerConfig(**economy["breaker"])
            if economy.get("ladder"):
                self.thresholds = Thresholds(**economy["ladder"])
            self._rung(event.ts_virtual)
        elif kind in ("budget.cap_set", "budget.shock"):
            self._cap_set(payload)
            self.shocks += kind == "budget.shock"
            self._rung(event.ts_virtual)
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

    def _rung(self, now: int) -> None:
        """Where the run is on the model ladder (spec §7.4): the share of the run cap that has
        been spent. Settled money, not the worst-case reservations of calls in flight: those
        overstate a call's cost three to ten times, so counting them would put a run on the
        cheap rungs at its first call and flap it up and down as calls start and settle.
        A new run cap moves the share at once: a shock that cuts it climbs the ladder, one that
        raises it can lower the level."""
        if self.thresholds is None or self.run_cap is None:
            return
        cap = to_usd(self.run_cap)
        fresh = ladder_state(to_usd(self.run_spent), cap, self.thresholds)
        before, self.ladder = self.ladder.level, fresh
        if fresh.level != before:
            self.changes.append(
                {
                    "level": fresh.level,
                    "previous": before,
                    "at_ms": now,
                    "share": fresh.share,
                    "spent_usd": to_usd(self.run_spent),
                    "cap_usd": cap,
                }
            )

    def _burn(self, now: int, usd: float) -> None:
        """A cost settled: the global spend breaker sees it (spec §8)."""
        if self.breaker_config is None or self.run_cap is None:
            return
        remaining = max(self.run_cap - self.committed_total(), 0)
        self.breaker, _ = record_spend(
            self.breaker, now, usd, to_usd(remaining), self.breaker_config
        )

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
