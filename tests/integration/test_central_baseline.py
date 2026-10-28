"""The central baseline under its best-case supervisor (spec §15.1-§15.2).

One orchestrator plans every level and leads every squad. A crash is a process-tree crash:
its in-flight calls and its workers' calls are cancelled. It restarts exactly 5 s later,
keeps its completed work and redoes only what was lost.
"""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.baselines.supervisor import RESTART_TAG
from fractalswarm.bench.profiles import RESTART_DELAY_MS
from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
CRASH_AT = (0.35, 0.65)


@pytest.fixture(scope="module")
def run(tmp_path_factory: pytest.TempPathFactory) -> Path:
    run_dir = tmp_path_factory.mktemp("central") / "run"
    spec = TaskSpec.load(TASKSPEC)
    actions = tuple(ChaosAction(at=at, kind="kill_coordinator") for at in CRASH_AT)
    plan = ChaosPlan(profile="two-crashes", seed="1", actions=actions)
    params = run_params(spec) | {"chaos": plan.model_dump(mode="json")}
    asyncio.run(
        record_run(
            "central",
            run_id="central",
            run_dir=run_dir,
            backend=fake_backend(),
            seed=spec.seed,
            params=params,
            run_cap_usd=spec.budget_usd,
        )
    )
    return run_dir


def of(log: list[Event], event_type: str) -> list[Event]:
    return [e for e in log if e.type == event_type]


def test_one_coordinator_leads_every_squad(run: Path) -> None:
    log = load_events(run)
    spawned = [e.payload for e in of(log, "actor.spawned")]
    orchestrators = {p["actor_id"] for p in spawned if p["kind"] == "orchestrator"}
    assert orchestrators == {"o0"}
    agents = {p["actor_id"] for p in spawned if p["kind"] == "agent"}
    assert len(agents) >= 12
    result = of(log, "task.result")[0].payload
    assert result["status"] == "ok" and result["report"]["hard_violations"] == 0


def test_a_crash_cancels_the_workers_calls_and_restarts_after_5_s(run: Path) -> None:
    log = load_events(run)
    crashes, restarts = of(log, "baseline.crashed"), of(log, "baseline.restarted")
    assert len(crashes) == len(restarts) == len(CRASH_AT)
    for crash in crashes:
        timer = next(
            e
            for e in log
            if e.type == "effect.completed"
            and e.payload.get("tag") == RESTART_TAG
            and e.ts_virtual >= crash.ts_virtual
        )
        assert timer.ts_virtual - crash.ts_virtual == RESTART_DELAY_MS
        # Process-tree semantics: the workers' in-flight calls die with the coordinator.
        cancelled = [
            e
            for e in of(log, "effect.cancelled")
            if e.ts_virtual == crash.ts_virtual and e.payload["kind"] == "llm"
        ]
        assert cancelled, "a crash with work in flight cancels it"
    # Only the lost work is redone: every redo item was in flight at its crash.
    for crash, restart in zip(crashes, restarts, strict=True):
        assert set(restart.payload["redo"]) <= set(crash.payload["lost"])


def test_nothing_runs_while_it_is_down(run: Path) -> None:
    log = load_events(run)
    for crash, restart in zip(
        of(log, "baseline.crashed"), of(log, "baseline.restarted"), strict=True
    ):
        started = [
            e
            for e in of(log, "effect.started")
            if e.payload["kind"] == "llm" and crash.ts_virtual < e.ts_virtual < restart.ts_virtual
        ]
        assert started == []


async def test_the_run_replays_bit_for_bit(run: Path) -> None:
    report = await replay_run(run)
    assert report.ok, report.detail
