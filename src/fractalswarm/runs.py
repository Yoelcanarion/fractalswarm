"""Wiring: record a run (kernel + effect runner + LLM layer) and replay a run directory.

A run directory holds ``events.sqlite`` (the live log), ``events.jsonl`` (its export, for
fixtures and bundles) and ``cassette.jsonl`` (every LLM call, redacted).
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml

from fractalswarm.config import CONFIG_DIR
from fractalswarm.kernel.clock import LiveClock, ManualClock
from fractalswarm.kernel.effects import EffectContext, EffectRunner, drive
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.replay import ReplayReport, ReplaySetup, replay
from fractalswarm.kernel.scheduler import Runtime
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.cassette import Cassette, CassetteBackend
from fractalswarm.llm.client import Backend, LLMClient
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.ledger import ProjectLedger
from fractalswarm.market.prices import PriceTable

SCENARIOS = {
    "toy": "fractalswarm.actors.toy:TOY",
    "one-call": "fractalswarm.actors.toy:ONE_CALL",
    "chaos-toy": "fractalswarm.actors.chaos_toy:CHAOS_TOY",
}


def default_run_cap_usd() -> float:
    defaults = yaml.safe_load((CONFIG_DIR / "defaults.yaml").read_text(encoding="utf-8"))
    return float(defaults["budget"]["run_cap_usd"])


@dataclass(frozen=True)
class RunPaths:
    root: Path

    @property
    def events(self) -> Path:
        return self.root / "events.sqlite"

    @property
    def events_jsonl(self) -> Path:
        return self.root / "events.jsonl"

    @property
    def cassette(self) -> Path:
        return self.root / "cassette.jsonl"

    def open_log(self) -> EventStore:
        """The recorded log: the SQLite store if present, else the JSONL export."""
        if self.events.exists():
            return EventStore(self.events)
        if self.events_jsonl.exists():
            return EventStore.import_jsonl(self.events_jsonl)
        raise FileNotFoundError(f"no event log in {self.root}")


@dataclass(frozen=True)
class RunResult:
    run_id: str
    paths: RunPaths
    completed: Event
    head_hash: str
    events: int


async def record_run(
    scenario: str,
    *,
    run_id: str,
    run_dir: Path,
    backend: Backend,
    seed: str = "0",
    params: dict[str, Any] | None = None,
    clock: Literal["sim", "live"] = "sim",
    speed: float = 1.0,
    run_cap_usd: float | None = None,
    project_ledger: ProjectLedger | None = None,
    secrets: list[str] | None = None,
    roles: RoleTable | None = None,
    prices: PriceTable | None = None,
) -> RunResult:
    paths = RunPaths(run_dir)
    if paths.events.exists() or paths.cassette.exists():
        raise FileExistsError(f"{run_dir} already holds a run")
    cassette = Cassette(paths.cassette, secrets or [])
    client = LLMClient(
        backend,
        roles=roles or RoleTable.load(),
        prices=prices or PriceTable.load(),
        mode="record",
        cassette=cassette,
        project_ledger=project_ledger,
    )
    with EventStore(paths.events) as store:
        runtime = Runtime(
            store,
            run_id=run_id,
            seed=seed,
            scenario=SCENARIOS.get(scenario, scenario),
            params=params,
            clock=clock,
            config={"llm": client.config_snapshot()},
            run_cap_usd=default_run_cap_usd() if run_cap_usd is None else run_cap_usd,
            project_remaining_usd=project_ledger.remaining_usd() if project_ledger else None,
            estimators={"llm": client.estimate},
        )
        run_clock = ManualClock("sim") if clock == "sim" else LiveClock(speed)
        runner = EffectRunner({"llm": client.effect()}, EffectContext(run_id, run_clock))
        completed = await drive(runtime, runner)
        store.export_jsonl(paths.events_jsonl)
        return RunResult(run_id, paths, completed, store.head_hash, store.last_seq)


def replay_setup(cassette: Cassette):
    def setup(started: Event) -> ReplaySetup:
        roles, prices = LLMClient.config_from_snapshot(started.payload["config"]["llm"])
        client = LLMClient(
            CassetteBackend(cassette), roles=roles, prices=prices, mode="replay", cassette=cassette
        )

        async def no_sleep(virtual_ms: int) -> None:
            return None

        async def replay_llm(started_effect: Event, recorded: Event) -> tuple[str, dict]:
            outcome = await client.call(
                started_effect.payload["effect_id"],
                started_effect.payload["request"],
                run_id=started_effect.run_id,
                sleep=no_sleep,
            )
            return outcome.status, outcome.result

        return ReplaySetup(estimators={"llm": client.estimate}, replayers={"llm": replay_llm})

    return setup


async def replay_run(run_dir: Path) -> ReplayReport:
    paths = RunPaths(run_dir)
    cassette = Cassette(paths.cassette)
    with paths.open_log() as recorded:
        return await replay(recorded, replay_setup(cassette))
