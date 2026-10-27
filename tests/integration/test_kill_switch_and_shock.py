"""The kill switch and the budget shock: outside events that the scheduler honors, the audit
checks, and replay reproduces bit for bit. Fake LLM only.

The fake LLM's script drops a control request into the run directory while round 2 is in
flight, which is what ``fractalswarm halt`` / ``fractalswarm budget`` do from another shell.
"""

import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fractalswarm.cli import app
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.runs import RunPaths, record_run, replay_run
from fractalswarm.verify.audit import audit_run

GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "toy"


def control_on_round_2(run_dir: Path, request: dict):
    sent = []

    def script(body, attempt):
        if "item 2" in str(body["input"]) and not sent:
            sent.append(RunPaths(run_dir).request_control(request))
        return "ok"

    return script


def types(run_dir: Path) -> list[str]:
    with RunPaths(run_dir).open_log() as log:
        return [event.type for event in log.read()]


@pytest.mark.parametrize("clock", ["sim", "live"])
async def test_halt_stops_everything_and_replays(tmp_path: Path, clock: str) -> None:
    run_dir = tmp_path / "halted"
    script = control_on_round_2(run_dir, {"op": "halt", "reason": "operator pressed stop"})
    result = await record_run(
        "toy",
        run_id="halted",
        run_dir=run_dir,
        backend=FakeBackend(script=script),
        params={"rounds": 3},
        clock=clock,  # type: ignore[arg-type]
        speed=50,
    )
    seen = types(run_dir)
    assert "run.halted" in seen and "toy.done" not in seen
    halt = seen.index("run.halted")
    after = seen[halt + 1 :]
    assert set(after) <= {"effect.cancelled", "budget.settled", "actor.stopped", "run.completed"}
    assert after[-1] == "run.completed" and result.completed.payload["alive"] == []
    # Every reservation was released or settled: nothing stays committed.
    report = await replay_run(run_dir)
    assert report.ok, report.detail
    audit = await audit_run(run_dir, with_replay=True)
    assert audit.ok, audit.problems
    assert audit.halted_at is not None and audit.replay_ok
    assert any(e.summary.startswith("HALTED by human") for e in audit.entries)


async def test_budget_shock_lowers_the_cap_mid_run(tmp_path: Path) -> None:
    run_dir = tmp_path / "shocked"
    shock = {"op": "budget", "level": "run", "key": None, "usd": 0.0, "reason": "CFO says stop"}
    result = await record_run(
        "toy",
        run_id="shocked",
        run_dir=run_dir,
        backend=FakeBackend(script=control_on_round_2(run_dir, shock)),
        params={"rounds": 3},
    )
    seen = types(run_dir)
    shock_at = seen.index("budget.shock")
    assert "budget.refused" in seen[shock_at:]
    assert "budget.reserved" not in seen[shock_at:]
    assert result.completed.payload["alive"] == []  # the run still ends cleanly
    report = await replay_run(run_dir)
    assert report.ok, report.detail
    audit = await audit_run(run_dir)
    assert audit.ok, audit.problems
    assert [e.type for e in audit.entries][:1] == ["budget.shock"]


async def test_a_tampered_halt_is_caught(tmp_path: Path) -> None:
    run_dir = tmp_path / "halted"
    script = control_on_round_2(run_dir, {"op": "halt", "reason": "stop"})
    await record_run(
        "toy",
        run_id="halted",
        run_dir=run_dir,
        backend=FakeBackend(script=script),
        params={"rounds": 3},
    )
    (run_dir / "events.sqlite").unlink()
    lines = (run_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
    edited = [line.replace('"reason":"stop"', '"reason":"nothing to see"') for line in lines]
    (run_dir / "events.jsonl").write_text("\n".join(edited) + "\n", encoding="utf-8")
    audit = await audit_run(run_dir)
    assert not audit.ok and "hash chain broken" in audit.problems[0]


def test_cli_halt_budget_and_audit(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path))
    runner = CliRunner()
    running = tmp_path / "running"
    running.mkdir()
    assert runner.invoke(app, ["halt", "running", "--reason", "test"]).exit_code == 0
    assert runner.invoke(app, ["budget", "running", "--usd", "0.5"]).exit_code == 0
    requests = RunPaths(running).poll_control()
    assert [r["op"] for r in requests] == ["halt", "budget"]
    assert requests[1] == {
        "op": "budget",
        "level": "run",
        "key": None,
        "usd": 0.5,
        "reason": "budget shock",
    }
    assert RunPaths(running).poll_control() == []  # each request is applied once

    finished = tmp_path / "golden"
    shutil.copytree(GOLDEN, finished)
    assert runner.invoke(app, ["halt", "golden"]).exit_code == 1
    result = runner.invoke(app, ["audit", "verify", "golden", "--replay"])
    assert result.exit_code == 0, result.output
    assert "HEAD file: match" in result.output and "AUDIT OK" in result.output
