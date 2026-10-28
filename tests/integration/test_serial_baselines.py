"""The ``single`` and ``pipeline`` baselines under the best-case supervisor (spec §15.1-§15.2).

Both are one process with one worker: one contract is in flight across the run, each one
verified before the next. ``single`` is one agent that also plans, one LLM call at a time;
``pipeline`` plans every goal first, then works through the contracts. Five crashes at the
shared crash points: each restarts 5 s later, keeps the completed work, and the program is
still complete and valid.
"""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.bench.profiles import CRASH_POINTS
from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
PLANNERS = ("root_planner", "sub_planner")
WORK = ("agent", "judge")


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    spec = TaskSpec.load(TASKSPEC)
    actions = tuple(ChaosAction(at=at, kind="kill_coordinator") for at in CRASH_POINTS)
    plan = ChaosPlan(profile="five-crashes", seed="1", actions=actions)
    params = run_params(spec) | {"chaos": plan.model_dump(mode="json")}
    root = tmp_path_factory.mktemp("serial")
    found = {}
    for mode in ("single", "pipeline"):
        asyncio.run(
            record_run(
                mode,
                run_id=mode,
                run_dir=root / mode,
                backend=fake_backend(),
                seed=spec.seed,
                params=params,
                run_cap_usd=spec.budget_usd,
            )
        )
        found[mode] = root / mode
    return found


def of(log: list[Event], event_type: str) -> list[dict]:
    return [e.payload for e in log if e.type == event_type]


def llm_calls(log: list[Event]) -> list[tuple[int, int, str]]:
    """(start, end, role) of every LLM call; a cancelled call ends when it is cancelled."""
    started = {}
    calls = []
    for event in log:
        payload = event.payload
        if event.type == "effect.started" and payload["kind"] == "llm":
            started[payload["effect_id"]] = (event.ts_virtual, payload["request"]["role"])
        elif event.type in ("effect.completed", "effect.cancelled") and (
            payload["effect_id"] in started
        ):
            start, role = started.pop(payload["effect_id"])
            calls.append((start, event.ts_virtual, role))
    return calls


def peak(calls: list[tuple[int, int, str]], roles: tuple[str, ...] | None = None) -> int:
    edges = sorted(
        (at, step)
        for start, end, role in calls
        if roles is None or role in roles
        for at, step in ((start, 1), (end, -1))
    )
    level = top = 0
    for _, step in edges:  # an end sorts before a start at the same instant
        level += step
        top = max(top, level)
    return top


@pytest.mark.parametrize("mode", ["single", "pipeline"])
def test_one_worker_and_one_contract_in_flight(runs, mode: str) -> None:
    log = load_events(runs[mode])
    spawned = of(log, "actor.spawned")
    assert {p["actor_id"] for p in spawned if p["kind"] == "orchestrator"} == {"o0"}
    assert {p["actor_id"] for p in spawned if p["kind"] == "agent"} == {"o0.a1"}
    calls = llm_calls(log)
    assert peak(calls, WORK) == 1
    if mode == "single":  # the one agent also plans
        assert peak(calls) == 1
    else:  # the planner plans the tracks, then the sessions, in parallel
        assert peak(calls, PLANNERS) > 1


def test_the_pipeline_plans_every_goal_before_any_work(runs) -> None:
    calls = llm_calls(load_events(runs["pipeline"]))
    last_plan = max(end for _, end, role in calls if role in PLANNERS)
    first_work = min(start for start, _, role in calls if role in WORK)
    assert last_plan <= first_work


@pytest.mark.parametrize("mode", ["single", "pipeline"])
def test_every_crash_restarts_and_the_program_is_valid(runs, mode: str) -> None:
    log = load_events(runs[mode])
    crashed, restarted = of(log, "baseline.crashed"), of(log, "baseline.restarted")
    assert len(crashed) == len(restarted) == len(CRASH_POINTS)
    assert all(p["coordinator"] == "o0" for p in crashed)
    (result,) = of(log, "task.result")
    assert result["status"] == "ok"
    assert result["report"]["placed"] == result["report"]["expected"] == 48
    assert result["report"]["hard_violations"] == 0


@pytest.mark.parametrize("mode", ["single", "pipeline"])
async def test_a_serial_baseline_replays_bit_for_bit(runs, mode: str) -> None:
    report = await replay_run(runs[mode])
    assert report.ok, report.detail
