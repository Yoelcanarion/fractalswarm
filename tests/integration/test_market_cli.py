"""The economy from the CLI: a TaskSpec YAML switches it on, with no flag and no code."""

from pathlib import Path

import pytest
from typer.testing import CliRunner

from fractalswarm.cli import app
from fractalswarm.planning.taskspec import TaskSpec, run_params

EXAMPLES = Path(__file__).resolve().parents[2] / "tasks" / "examples"


def test_the_example_taskspecs_opt_in_to_the_economy() -> None:
    auction = TaskSpec.load(EXAMPLES / "t2-auction.yaml")
    assert auction.market.mode == "auction" and auction.scaling.mode == "exact"
    auto = TaskSpec.load(EXAMPLES / "t2-autoscale.yaml")
    assert auto.scaling.mode == "autoscale" and auto.scaling.max_agents_per_orchestrator == 4
    plain = TaskSpec.load(EXAMPLES / "t2-conference.yaml")
    assert plain.market.mode == "proportional" and plain.scaling.mode == "exact"
    assert "market" in run_params(auction) and "market" in run_params(auto)
    assert "market" not in run_params(plain)  # the default needs no economy


@pytest.mark.parametrize("example", ["t2-auction.yaml", "t2-autoscale.yaml"])
def test_cli_run_with_the_economy_finishes_the_program_and_replays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, example: str
) -> None:
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path))
    runner = CliRunner()
    result = runner.invoke(app, ["run", str(EXAMPLES / example), "--run-id", "cli"])
    assert result.exit_code == 0, result.output
    assert "placed 48/48, hard violations 0" in result.output
    verified = runner.invoke(app, ["replay", "cli", "--verify"])
    assert verified.exit_code == 0, verified.output
    assert verified.output.startswith("MATCH")


def test_autoscale_is_refused_for_the_baselines(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path))
    result = CliRunner().invoke(
        app, ["run", str(EXAMPLES / "t2-autoscale.yaml"), "--scenario", "central"]
    )
    assert result.exit_code != 0
