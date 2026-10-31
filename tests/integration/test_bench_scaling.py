"""The scaling sweep at $0 (spec §15.6): bench/matrix-scaling.yaml on the calibrated fake LLM.

Every point of the sweep runs, is valid and has exactly the agents it is named after; the
chart renders; sweep cells replay bit for bit; the dry-run prices the sweep under its cap.
"""

import asyncio
import json
from collections import Counter
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fractalswarm.bench.harness import (
    RESULT_COLUMNS,
    HarnessOptions,
    Matrix,
    MatrixReport,
    preflight,
    read_results,
    run_matrix,
)
from fractalswarm.bench.scaling import tree_for
from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.cli import app
from fractalswarm.runs import replay_run

REPO = Path(__file__).resolve().parents[2]
SCALING = REPO / "bench" / "matrix-scaling.yaml"
SWEEP = [1, 2, 4, 8, 16]
WORKFLOWS = ["swarm", "central"]


@pytest.fixture(scope="module")
def sweep(tmp_path_factory: pytest.TempPathFactory) -> tuple[MatrixReport, Path]:
    out = tmp_path_factory.mktemp("scaling")
    options = HarnessOptions(backend_factory=fake_backend, clock="sim")
    return asyncio.run(run_matrix(Matrix.load(SCALING), out, options)), out


def test_every_point_of_the_sweep_runs_and_is_valid(sweep: tuple[MatrixReport, Path]) -> None:
    report, _ = sweep
    assert report.failed == {} and len(report.ran) == 20
    assert all(row["completed"] and row["valid"] for row in report.rows), report.rows
    points = {(row["workflow"], row["agents"], row["seed"]) for row in report.rows}
    assert points == {(w, n, s) for w in WORKFLOWS for n in SWEEP for s in ("1", "2")}
    assert {row["profile"] for row in report.rows} == {"C0"}


def test_each_run_has_exactly_the_agents_it_is_named_after(
    sweep: tuple[MatrixReport, Path],
) -> None:
    report, out = sweep
    for row in report.rows:
        events = load_events(out / row["run_dir"])
        spawned = Counter(e.payload["kind"] for e in events if e.type == "actor.spawned")
        # Not one agent more: central used to spawn replacements when its squads ran out.
        assert spawned["agent"] == row["agents"], row["cell"]
        tracks, leaves_per_track = tree_for(row["agents"])[0]
        swarm = 1 + tracks + tracks * leaves_per_track  # root, track and session orchestrators
        assert spawned["orchestrator"] == (swarm if row["workflow"] == "swarm" else 1), row["cell"]


def test_the_chart_and_the_csv_carry_the_agents_axis(sweep: tuple[MatrixReport, Path]) -> None:
    report, out = sweep
    png, js = (Path(path) for path in report.chart_paths)
    assert png.name == "scaling-t2_conference.png" and png.stat().st_size > 10_000
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert not list(out.glob("hero-*"))  # the agents axis draws the scaling chart instead
    payload = json.loads(js.read_text(encoding="utf-8"))
    assert payload["x"] == SWEEP and payload["limit"] == 6 and payload["profile"] == "C0"
    assert [panel["metric"] for panel in payload["panels"]] == ["makespan_s", "cost_usd", "stall_s"]
    assert set(payload["series"]) == set(WORKFLOWS)
    for series in payload["series"].values():
        assert [point["x"] for point in series["points"]] == SWEEP
        assert all(point["seeds"] == ["1", "2"] for point in series["points"])
        assert all(len(point["runs"]) == 2 for point in series["points"])

    header = Path(report.csv_path).read_text(encoding="utf-8").splitlines()[0].split(",")
    assert header == [*RESULT_COLUMNS[:6], "agents", *RESULT_COLUMNS[6:]]
    assert read_results(Path(report.csv_path)) == read_results(Path(report.json_path))


@pytest.mark.parametrize(
    "cell", ["swarm__t2_conference__C0__s1__n4", "central__t2_conference__C0__s2__n2"]
)
async def test_sweep_cells_replay_bit_for_bit(sweep: tuple[MatrixReport, Path], cell: str) -> None:
    _, out = sweep
    replayed = await replay_run(out / "runs" / cell)
    assert replayed.ok, replayed.detail


def test_the_dry_run_prices_the_sweep_under_its_cap(tmp_path: Path) -> None:
    # An empty directory: the real cells are committed, and a finished cell is not priced again.
    result = CliRunner().invoke(app, ["bench", str(SCALING), "--dry-run", "--out", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "20 cells" in result.output and "NOT REGISTERED" not in result.output
    assert "contributor ON" in result.output
    cells = [line for line in result.output.splitlines() if "__n" in line and " ready " in line]
    assert len(cells) == 20 and all("<= $0.5000" in line for line in cells)  # each at its run cap
    assert "worst case for the cells to run: $10.0000 (matrix cap $10.00)" in result.output


async def test_workflows_with_one_worker_refuse_the_agents_axis(tmp_path: Path) -> None:
    small = {"workflows": ["swarm", "single"], "seeds": ["1"], "agents": [4]}
    matrix = Matrix.load(SCALING).model_copy(update=small)
    plan = preflight(matrix, tmp_path)
    assert plan.unregistered == ["single does not scale with agents"]
    options = HarnessOptions(backend_factory=fake_backend, clock="sim")
    with pytest.raises(ValueError, match="single does not scale with agents"):
        await run_matrix(matrix, tmp_path, options)
    assert not (tmp_path / "cells").exists()  # nothing ran
