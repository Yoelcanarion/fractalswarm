"""Day 4 vertical slice: T2 at depth 2 with the scripted fake LLM, end to end.

root -> 3 track orchestrators -> 6 session orchestrators -> 2 agents each. The run must place
every talk with 0 hard violations, and its log must replay to the same head.
"""

import asyncio
from collections import Counter
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fractalswarm.bench.tasks.t2_conference.fake import t2_script
from fractalswarm.cli import app
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import RunResult, record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"


async def record(run_dir: Path) -> RunResult:
    spec = TaskSpec.load(TASKSPEC)
    return await record_run(
        "swarm",
        run_id="t2-slice",
        run_dir=run_dir,
        backend=FakeBackend(script=t2_script),
        seed=spec.seed,
        params=run_params(spec),
        run_cap_usd=spec.budget_usd,
    )


def events(result: RunResult) -> list[Event]:
    with EventStore(result.paths.events) as store:
        return list(store.read())


@pytest.fixture(scope="module")
def slice_run(tmp_path_factory: pytest.TempPathFactory) -> RunResult:
    return asyncio.run(record(tmp_path_factory.mktemp("t2") / "run"))


async def test_the_slice_places_every_talk_with_no_hard_violation(slice_run: RunResult) -> None:
    log = events(slice_run)
    results = [event.payload for event in log if event.type == "task.result"]
    assert len(results) == 1
    report = results[0]["report"]
    assert results[0]["status"] == "ok"
    assert report["hard_violations"] == 0, report["violations"]
    assert report["placed"] == report["expected"] == 48
    assert report["gaps"] == []
    assert slice_run.completed.payload["alive"] == []


async def test_the_tree_has_depth_two_with_exact_fanout(slice_run: RunResult) -> None:
    spawned = [event.payload for event in events(slice_run) if event.type == "actor.spawned"]
    kinds = Counter(payload["kind"] for payload in spawned)
    assert kinds == {"board": 1, "orchestrator": 1 + 3 + 6, "agent": 12}
    parents = {payload["actor_id"]: payload["parent"] for payload in spawned}
    assert parents["o0"] is None
    assert [parents[f"o{i}"] for i in (1, 2, 3)] == ["o0"] * 3
    assert parents["o2.1"] == "o2"
    assert parents["o2.1.a2"] == "o2.1"


async def test_the_slice_exercises_every_mechanism(slice_run: RunResult) -> None:
    counts = Counter(event.type for event in events(slice_run))
    assert counts["plan.approved"] == 1
    assert counts["plan.refined"] == 3 + 6
    assert counts["ownership.assigned"] == 3 + 6
    assert counts["contract.verified"] == 6 * 3
    assert counts["verify.judged"] >= 6
    assert counts["lease.booked"] == 6
    assert counts["fact.promoted"] > 0
    assert counts["artifact.written"] == 6
    # Two sessions of one day race for a room or a speaker; CAS catches it and they re-place.
    assert counts["collision.detected"] == counts["collision.resolved"] >= 1


async def test_the_slice_replays_to_its_recorded_head(slice_run: RunResult) -> None:
    report = await replay_run(slice_run.paths.root)
    assert report.ok, report.detail
    assert report.replayed_head == slice_run.head_hash


async def test_a_second_recording_reproduces_the_same_head(
    slice_run: RunResult, tmp_path: Path
) -> None:
    again = await record(tmp_path / "again")
    assert again.head_hash == slice_run.head_hash


def test_cli_run_reports_a_clean_schedule_and_replays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path))
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "ledger.sqlite"))
    runner = CliRunner()
    result = runner.invoke(app, ["run", str(TASKSPEC), "--run-id", "cli"])
    assert result.exit_code == 0, result.output
    assert "placed 48/48, hard violations 0" in result.output
    verified = runner.invoke(app, ["replay", "cli", "--verify"])
    assert verified.exit_code == 0, verified.output
    assert verified.output.startswith("MATCH")
    assert not (tmp_path / "ledger.sqlite").exists()  # the fake never touches the ledger


def test_cli_run_refuses_real_spend_without_confirmation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path))
    result = CliRunner().invoke(app, ["run", str(TASKSPEC), "--backend", "real"])
    assert result.exit_code != 0
    assert "confirm-real-spend" in result.output
    assert not any(tmp_path.iterdir())
