"""The feasibility report on a real T2 run (spec §12): an event between ``plan.proposed`` and
``plan.approved``, off unless the TaskSpec asks, shown by the CLI and the API, and the same on
replay."""

import asyncio
import shutil
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient
from typer.testing import CliRunner

from fractalswarm.api.app import create_app
from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.tasks.t2_conference.generator import generate
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.cli import app as cli
from fractalswarm.comms.chaos import plan_from
from fractalswarm.kernel.events import Event
from fractalswarm.llm.transport import ApiFaults, FaultyBackend
from fractalswarm.planning.feasibility import ATTEMPTS, FeasibilityReport
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"


async def record(run_dir: Path, params: dict[str, Any], backend: Any = None) -> Path:
    await record_run(
        "swarm",
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=backend if backend is not None else fake_backend(),
        seed="1",
        params=params,
        run_cap_usd=2.0,
    )
    return run_dir


def reports(log: list[Event]) -> list[Event]:
    return [e for e in log if e.type == "plan.feasibility"]


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("feasibility") / "runs"
    root.mkdir()
    spec = TaskSpec.load(TASKSPEC)
    on = run_params(spec) | {"feasibility_report": True}
    c3 = on | {"chaos": {"profile": "C3", "seed": "1"}, "cross_audit": True}
    rate = plan_from(c3).api_fault_rate
    return {
        "on": asyncio.run(record(root / "on", on)),
        "c3": asyncio.run(
            record(root / "c3", c3, FaultyBackend(fake_backend(), ApiFaults(seed="1", rate=rate)))
        ),
        "off": asyncio.run(record(root / "off", run_params(spec))),
        "spec": asyncio.run(
            record(root / "spec", run_params(spec.model_copy(update={"feasibility_report": True})))
        ),
    }


def test_the_report_is_one_event_between_the_proposed_and_the_approved_plan(runs) -> None:
    log = load_events(runs["on"])
    (found,) = reports(log)
    proposed = next(e for e in log if e.type == "plan.proposed")
    approved = next(e for e in log if e.type == "plan.approved")
    assert proposed.seq < found.seq < approved.seq
    assert found.actor == "o0"
    report = FeasibilityReport.model_validate(found.payload)
    assert report.goal_id == "root" and report.budget_usd == 2.0
    assert report.verdict == "fits" and 0 < report.cost_p50_usd < report.cost_p90_usd < 2.0
    assert report.tools_denied == [] and report.policy_flags == []
    assert [step.split(":")[0] for step in report.critical_path][0] == "root plan"


def test_the_estimate_has_the_shape_of_what_the_run_then_did(runs) -> None:
    log = load_events(runs["on"])
    report = FeasibilityReport.model_validate(reports(log)[0].payload)
    by_role = Counter(
        e.payload["request"].get("role")
        for e in log
        if e.type == "effect.started" and e.payload["kind"] == "llm"
    )
    stage = {line.stage: line.calls for line in report.breakdown}
    assert stage["root plan"] == by_role["root_planner"] == 1
    assert stage["track plans"] + stage["session plans"] == by_role["sub_planner"] == 9
    # Contracts are expected to take more than one attempt; the fake run needs one each.
    agents = sum(calls for name, calls in stage.items() if name.startswith("agents:"))
    assert agents / ATTEMPTS[0] == pytest.approx(by_role["agent"], abs=0.5)
    assert stage["judge"] / ATTEMPTS[0] == pytest.approx(by_role["judge"], abs=0.5)
    # The fake run is cheaper than a real one, which the estimate is fitted to.
    assert log[-1].payload["spent_usd"] < report.cost_p90_usd


def test_the_report_is_off_unless_the_taskspec_asks(runs) -> None:
    log = load_events(runs["off"])
    assert reports(log) == []
    assert all("feasibility" not in e.payload["args"] for e in log if e.type == "actor.spawned")
    assert next(e.payload for e in log if e.type == "task.result")["status"] == "ok"
    # The TaskSpec flag and the run param do the same thing.
    spec_log = load_events(runs["spec"])
    assert len(reports(spec_log)) == 1
    assert reports(spec_log)[0].payload == reports(load_events(runs["on"]))[0].payload


async def test_a_quarantined_attachment_is_a_policy_flag(tmp_path: Path) -> None:
    """The root scans every attachment before planning, so the report knows what was held."""
    corpus, truth = generate(1, poison=1, wording="explicit")
    params = run_params(TaskSpec.load(TASKSPEC)) | {"corpus": corpus, "truth": truth}
    run = await record(tmp_path / "poisoned", params | {"feasibility_report": True})
    (found,) = reports(load_events(run))
    flags = FeasibilityReport.model_validate(found.payload).policy_flags
    (email_id,) = truth["poisoned"]
    assert any("1 attachment(s) were quarantined" in flag and email_id in flag for flag in flags)


def test_the_flag_is_passed_down_so_an_heir_of_the_root_can_emit_it(runs) -> None:
    log = load_events(runs["on"])
    spawned = [
        e.payload for e in log if e.type == "actor.spawned" and e.payload["kind"] == "orchestrator"
    ]
    assert len(spawned) == 10
    assert all(s["args"].get("feasibility") is True for s in spawned)


def test_at_c3_with_the_audit_on_the_report_prices_the_audit_and_is_still_one_event(runs) -> None:
    log = load_events(runs["c3"])
    (found,) = reports(log)
    report = FeasibilityReport.model_validate(found.payload)
    assert "cross-squad audit" in [line.stage for line in report.breakdown]
    assert any("cross-squad audit is on" in flag for flag in report.policy_flags)
    result = next(e.payload for e in log if e.type == "task.result")
    assert result["status"] == "ok" and result["report"]["hard_violations"] == 0


@pytest.mark.parametrize("name", ["on", "c3"])
async def test_a_run_with_the_report_replays_bit_for_bit(runs, name: str) -> None:
    report = await replay_run(runs[name])
    assert report.ok, report.detail


# -- the CLI and the API ------------------------------------------------------------------


def test_the_cli_shows_the_report_of_a_run(runs) -> None:
    result = CliRunner().invoke(cli, ["feasibility", str(runs["on"])])
    assert result.exit_code == 0, result.output
    assert result.output.startswith("Feasibility of root: fits")
    for needle in ("cost      P50 $", "Critical path", "Limitations", "agents: place"):
        assert needle in result.output


def test_the_cli_says_when_a_run_has_no_report(runs) -> None:
    result = CliRunner().invoke(cli, ["feasibility", str(runs["off"])])
    assert result.exit_code == 1
    assert "no feasibility report" in result.output


def test_the_api_serves_the_report_of_a_run(runs, tmp_path: Path) -> None:
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    for name in ("on", "off"):
        shutil.copytree(runs[name], runs_dir / name)
    client = TestClient(create_app(runs_dir, None, tmp_path / "bench", tmp_path / "static"))
    found = client.get("/api/runs/on/feasibility")
    assert found.status_code == 200
    expected = reports(load_events(runs["on"]))[0].payload
    assert found.json() == expected
    assert FeasibilityReport.model_validate(found.json()).verdict == "fits"
    missing = client.get("/api/runs/off/feasibility")
    assert missing.status_code == 404 and "no feasibility report" in missing.json()["error"]
    assert client.get("/api/runs/nope/feasibility").status_code == 404
