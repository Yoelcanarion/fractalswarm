"""Wiring: record a run (kernel + effect runner + LLM layer) and replay a run directory.

A run directory holds ``events.sqlite`` (the live log), ``events.jsonl`` (its export, for
fixtures and bundles) and ``cassette.jsonl`` (every LLM call, redacted).
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml

from fractalswarm.config import CONFIG_DIR
from fractalswarm.kernel.clock import LiveClock, ManualClock
from fractalswarm.kernel.effects import EffectContext, EffectFn, EffectRunner, drive
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.replay import ReplayReport, ReplaySetup, replay
from fractalswarm.kernel.scheduler import Runtime
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.cassette import Cassette, CassetteBackend
from fractalswarm.llm.client import Backend, LLMClient, RetryPolicy
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.ledger import ProjectLedger
from fractalswarm.market.prices import PriceTable
from fractalswarm.safety.firewall import Firewall

SCENARIOS = {
    "toy": "fractalswarm.actors.toy:TOY",
    "one-call": "fractalswarm.actors.toy:ONE_CALL",
    "swarm": "fractalswarm.actors.swarm:SWARM",
    "central": "fractalswarm.actors.swarm:CENTRAL",
    "single": "fractalswarm.actors.swarm:SINGLE",
    "pipeline": "fractalswarm.actors.swarm:PIPELINE",
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

    @property
    def control(self) -> Path:
        """Inbox for outside control requests (``fractalswarm halt``, budget shocks)."""
        return self.root / "control"

    def request_control(self, request: dict[str, Any]) -> Path:
        self.control.mkdir(parents=True, exist_ok=True)
        number = len(list(self.control.iterdir()))
        path = self.control / f"{number:04d}-{request['op']}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(request), encoding="utf-8")
        tmp.replace(path)
        return path

    def poll_control(self) -> list[dict[str, Any]]:
        """Requests not yet applied, oldest first; each is marked done once read."""
        if not self.control.is_dir():
            return []
        requests = []
        for path in sorted(self.control.glob("*.json")):
            try:
                requests.append(json.loads(path.read_text(encoding="utf-8")))
            except ValueError:
                continue
            path.replace(path.with_suffix(".done"))
        return requests

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
    firewall: Firewall | None = None,
    retry: RetryPolicy | None = None,
    extra_effects: Mapping[str, EffectFn] | None = None,
) -> RunResult:
    """Record a run. ``firewall`` scans attachments (default: the deterministic heuristic;
    real runs pass PromptGuard). ``extra_effects`` are the effect kinds a task adds, such as the
    web task's ``fetch``; replay reuses their recorded completions."""
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
        retry=retry,
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
            routers={"llm": client.route},
        )
        run_clock = ManualClock("sim") if clock == "sim" else LiveClock(speed)
        effects = {"llm": client.effect(), "firewall": (firewall or Firewall()).effect()}
        effects |= extra_effects or {}
        runner = EffectRunner(effects, EffectContext(run_id, run_clock))
        completed = await drive(runtime, runner, control=paths.poll_control)
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

        return ReplaySetup(
            estimators={"llm": client.estimate},
            routers={"llm": client.route},
            replayers={"llm": replay_llm},
        )

    return setup


async def replay_run(run_dir: Path) -> ReplayReport:
    paths = RunPaths(run_dir)
    cassette = Cassette(paths.cassette)
    with paths.open_log() as recorded:
        return await replay(recorded, replay_setup(cassette))
