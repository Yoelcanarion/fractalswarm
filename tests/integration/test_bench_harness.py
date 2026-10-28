"""Bench harness end to end on the toy stand-in (fake LLM, $0), plus charts and the CLI.

None of these tests touches the project ledger: the fake path never opens it.
"""

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from fractalswarm.bench import registry
from fractalswarm.bench.charts import hero_chart, series
from fractalswarm.bench.harness import (
    RESULT_COLUMNS,
    CellResult,
    HarnessOptions,
    Matrix,
    MatrixBudget,
    aggregate,
    preflight,
    read_results,
    resolve_out_dir,
    run_matrix,
)
from fractalswarm.bench.registry import Cell, CellContext, TaskDef
from fractalswarm.bench.scoring import RunMetrics
from fractalswarm.cli import app
from fractalswarm.llm.fake import FakeBackend

REPO = Path(__file__).resolve().parents[2]
SMOKE = REPO / "bench" / "matrix-smoke.yaml"
V1 = REPO / "bench" / "matrix.yaml"


def smoke(seeds: list[str] | None = None) -> Matrix:
    matrix = Matrix.load(SMOKE)
    return matrix if seeds is None else matrix.model_copy(update={"seeds": seeds})


def options() -> HarnessOptions:
    return HarnessOptions(backend_factory=FakeBackend, clock="sim")


async def test_smoke_matrix_runs_end_to_end(tmp_path: Path) -> None:
    report = await run_matrix(smoke(), tmp_path, options())
    assert len(report.ran) == 8 and not report.skipped and not report.failed
    rows = read_results(Path(report.csv_path))
    assert rows == json.loads(Path(report.json_path).read_text(encoding="utf-8"))
    assert [row["profile"] for row in rows[:4:2]] == ["C0", "C1"]
    for row in rows:
        assert row["completed"] is True and row["valid"] is True
        assert row["extra_cost_pct"] == pytest.approx(0.0)  # the toy ignores chaos
        assert row["time_lost_s"] == pytest.approx(0.0)
        assert row["cost_usd"] > 0
        assert (tmp_path / row["run_dir"] / "events.jsonl").exists()
    assert {row["coordinators_killed"] for row in rows} == {0, 1, 3, 5}
    png, js = (Path(path) for path in report.chart_paths)
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert set(json.loads(js.read_text(encoding="utf-8"))["series"]) == {"toy"}


async def test_the_matrix_resumes_and_reruns_half_finished_cells(tmp_path: Path) -> None:
    matrix = smoke(["1"])
    first = await run_matrix(matrix, tmp_path, options(), charts=False)
    assert len(first.ran) == 4
    again = await run_matrix(matrix, tmp_path, options(), charts=False)
    assert again.ran == [] and len(again.skipped) == 4
    # A cell that died after recording but before scoring: its run dir is stale.
    cell = "toy__toy__C2__s1"
    (tmp_path / "cells" / f"{cell}.json").unlink()
    (tmp_path / "runs" / cell / "partial.marker").write_text("x", encoding="utf-8")
    third = await run_matrix(matrix, tmp_path, options(), charts=False)
    assert third.ran == [cell]
    assert not (tmp_path / "runs" / cell / "partial.marker").exists()
    assert len(third.rows) == 4


async def test_runs_are_deterministic_across_matrices(tmp_path: Path) -> None:
    a = await run_matrix(smoke(["3"]), tmp_path / "a", options(), charts=False)
    b = await run_matrix(smoke(["3"]), tmp_path / "b", options(), charts=False)
    assert a.rows == b.rows


async def test_a_failing_cell_is_reported_and_not_marked_done(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Broken:
        name = "broken"
        tasks = None

        async def run(self, ctx: CellContext) -> None:
            raise RuntimeError("boom")

        def preflight(self, cell: Cell, contributor: bool) -> list[dict[str, Any]]:
            return []

    monkeypatch.setitem(registry.WORKFLOWS, "broken", Broken())
    matrix = smoke(["1"]).model_copy(update={"workflows": ["broken"], "profiles": ["C0"]})
    report = await run_matrix(matrix, tmp_path, options())
    assert report.failed == {"broken__toy__C0__s1": "RuntimeError: boom"}
    assert not (tmp_path / "cells").exists()
    assert report.chart_paths == []


def test_preflight_prices_worst_cases_and_lists_unregistered(tmp_path: Path) -> None:
    plan = preflight(smoke(), tmp_path)
    assert plan.unregistered == []
    assert all(cell.registered and cell.calls == 5 for cell in plan.cells)
    assert plan.worst_case_usd == pytest.approx(sum(c.worst_case_usd for c in plan.cells))
    assert plan.worst_case_usd > 0

    v1 = Matrix.load(V1)
    assert len(v1.cells()) == 32 and v1.contributor is True
    plan = preflight(v1, tmp_path)
    registered = {cell.cell.split("__")[0] for cell in plan.cells if cell.registered}
    assert registered == {"swarm", "central"}
    assert plan.unregistered == ["workflow pipeline", "workflow single"]
    # Only the registered cells are priced.
    assert plan.worst_case_usd == pytest.approx(sum(c.worst_case_usd or 0 for c in plan.cells))
    assert all(c.worst_case_usd is None for c in plan.cells if not c.registered)


async def test_running_an_unregistered_matrix_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="workflow pipeline"):
        await run_matrix(Matrix.load(V1), tmp_path, options())


def test_preflight_honors_the_contributor_opt_in(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Agents:
        name = "agents"
        tasks = None

        async def run(self, ctx: CellContext) -> None:  # pragma: no cover
            raise AssertionError

        def preflight(self, cell: Cell, contributor: bool) -> list[dict[str, Any]]:
            request = {"role": "agent", "level": "L1", "input": "x" * 400}
            return [request | {"contributor": contributor}] * 10

    monkeypatch.setitem(registry.WORKFLOWS, "agents", Agents())
    monkeypatch.setitem(registry.TASKS, "any", TaskDef(name="any"))
    base = smoke(["1"]).model_copy(update={"workflows": ["agents"], "tasks": ["any"]})
    standard = preflight(base, tmp_path).worst_case_usd
    contributor = preflight(base.model_copy(update={"contributor": True}), tmp_path)
    assert 0 < contributor.worst_case_usd < standard / 5


def test_preflight_skips_finished_cells_and_checks_the_cap(tmp_path: Path) -> None:
    budget = MatrixBudget(matrix_cap_usd=0.01)
    matrix = smoke(["1"]).model_copy(update={"budget": budget})
    plan = preflight(matrix, tmp_path)
    assert not plan.within_cap
    (tmp_path / "cells").mkdir()
    for cell in matrix.cells():
        (tmp_path / "cells" / f"{cell.id}.json").write_text("{}", encoding="utf-8")
    plan = preflight(matrix, tmp_path)
    assert plan.worst_case_usd == 0 and plan.within_cap
    assert all(cell.done for cell in plan.cells)


def test_matrix_validation(tmp_path: Path) -> None:
    path = tmp_path / "m.yaml"
    path.write_text(
        "name: x\nworkflows: [toy]\ntasks: [toy]\nprofiles: [C1]\nseeds: [1]\nout_dir: o\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="C0"):
        Matrix.load(path)
    path.write_text(path.read_text(encoding="utf-8").replace("C1", "C9"), encoding="utf-8")
    with pytest.raises(ValueError, match="C9"):
        Matrix.load(path)
    assert resolve_out_dir(smoke(), SMOKE) == (REPO / "runs" / "bench-smoke").resolve()
    assert resolve_out_dir(smoke(), SMOKE, tmp_path) == tmp_path


# -- aggregation and charts ------------------------------------------------------------------


def metrics(cost: float, makespan: float, stall: float, coord: int = 0) -> RunMetrics:
    zero = dict.fromkeys(
        (
            "input_tokens",
            "output_tokens",
            "total_tokens",
            "llm_calls",
            "llm_errors",
            "cancelled_llm_calls",
            "work_calls",
            "messages",
            "breaker_trips",
            "chaos_events",
        ),
        0,
    )
    return RunMetrics(
        run_id="r",
        events=1,
        completed=True,
        valid=True,
        score=1.0,
        makespan_s=makespan,
        stall_s=stall,
        work_window_s=makespan,
        work_busy_s=makespan - stall,
        cost_usd=cost,
        coordination_tokens=coord,
        **zero,
    )


def synthetic_results() -> list[CellResult]:
    results = []
    for workflow, slope in (("swarm", 0.1), ("central", 1.0)):
        for profile, killed in (("C0", 0), ("C1", 1), ("C2", 3), ("C3", 5)):
            for seed in ("1", "2"):
                cost = 1.0 + slope * killed * (1 if seed == "1" else 2) / 10
                results.append(
                    CellResult(
                        cell=f"{workflow}__t2__{profile}__s{seed}",
                        workflow=workflow,
                        task="t2",
                        profile=profile,
                        coordinators_killed=killed,
                        seed=seed,
                        run_dir=f"runs/{workflow}-{profile}-{seed}",
                        metrics=metrics(cost, 60 + 5 * slope * killed, 5 * slope * killed),
                    )
                )
    return results


def test_aggregate_pairs_every_row_with_its_c0_twin() -> None:
    rows = {row["cell"]: row for row in aggregate(synthetic_results())}
    assert rows["central__t2__C3__s2"]["extra_cost_pct"] == pytest.approx(100.0)
    assert rows["central__t2__C3__s1"]["extra_cost_pct"] == pytest.approx(50.0)
    assert rows["central__t2__C3__s1"]["time_lost_s"] == pytest.approx(25.0)
    assert rows["swarm__t2__C0__s1"]["extra_cost_pct"] == 0
    assert set(next(iter(rows.values()))) == set(RESULT_COLUMNS)


def test_hero_chart_series_and_files(tmp_path: Path) -> None:
    rows = aggregate(synthetic_results())
    data = series(rows, "t2")
    assert list(data) == ["central", "swarm"]
    c3 = data["central"][-1]
    assert (c3["x"], c3["profile"]) == (5, "C3")
    assert c3["extra_cost_pct"] == pytest.approx(75.0)
    assert (c3["extra_cost_pct_min"], c3["extra_cost_pct_max"]) == pytest.approx((50.0, 100.0))
    assert c3["runs"] == ["runs/central-C3-1", "runs/central-C3-2"]
    assert c3["completion_rate"] == 100.0

    png, js = hero_chart(rows, tmp_path / "hero", task="t2", title="test")
    assert png.stat().st_size > 10_000
    payload = json.loads(js.read_text(encoding="utf-8"))
    assert payload["x"] == [0, 1, 3, 5]
    assert payload["series"]["swarm"]["color"] != payload["series"]["central"]["color"]
    assert [p["metric"] for p in payload["panels"]][:2] == ["stall_s", "extra_cost_pct"]


def test_chart_from_csv_round_trip(tmp_path: Path) -> None:
    from fractalswarm.bench.harness import write_results

    rows = aggregate(synthetic_results())
    csv_path, json_path = write_results(rows, tmp_path)
    assert read_results(csv_path) == read_results(json_path)
    png, _ = hero_chart(read_results(csv_path), tmp_path / "from-csv", task="t2")
    assert png.exists()


# -- CLI -------------------------------------------------------------------------------------


def test_cli_dry_run_lists_the_v1_matrix() -> None:
    result = CliRunner().invoke(app, ["bench", str(V1), "--dry-run"])
    assert result.exit_code == 0, result.output
    assert "32 cells" in result.output and "NOT REGISTERED" in result.output
    assert "contributor ON" in result.output


def test_cli_fake_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(app, ["bench", str(SMOKE), "--fake", "--out", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "ran 8" in result.output
    assert (tmp_path / "results.csv").exists() and (tmp_path / "hero-toy.png").exists()
    again = runner.invoke(app, ["bench", str(SMOKE), "--fake", "--out", str(tmp_path)])
    assert "ran 0, skipped 8" in again.output
    shutil.rmtree(tmp_path / "runs")


def test_cli_refuses_real_runs_without_confirmation(tmp_path: Path) -> None:
    result = CliRunner().invoke(app, ["bench", str(SMOKE), "--out", str(tmp_path)])
    assert result.exit_code != 0
    assert "--confirm-real-spend" in result.output
    assert not (tmp_path / "cells").exists()


def test_cli_refuses_to_run_unregistered_workflows(tmp_path: Path) -> None:
    result = CliRunner().invoke(app, ["bench", str(V1), "--fake", "--out", str(tmp_path)])
    assert result.exit_code != 0
    assert "not registered" in result.output
