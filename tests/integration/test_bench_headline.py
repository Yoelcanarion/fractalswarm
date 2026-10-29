"""The matrix of the standard headline runs (``bench/matrix-headline.yaml``): what it pays, where,
and that its results can be charted and read.

It makes no call: these tests load it and run the harness's pre-flight, which never calls a model,
and draw a chart from committed fake-LLM rows.
"""

import json
from pathlib import Path

import pytest

from fractalswarm.bench.charts import hero_chart
from fractalswarm.bench.harness import Matrix, preflight, resolve_out_dir

REPO = Path(__file__).resolve().parents[2]
BENCH = REPO / "bench"
HEADLINE = BENCH / "matrix-headline.yaml"
REAL = BENCH / "matrix-rivals-real.yaml"
GATE_ROWS = BENCH / "results" / "rivals-gate" / "results.json"
WORKFLOWS = ("swarm", "durable-max", "durable")


def test_it_is_the_three_workflows_on_t2_at_c0_and_c3_with_three_seeds() -> None:
    headline, real = Matrix.load(HEADLINE), Matrix.load(REAL)
    assert headline.workflows == list(WORKFLOWS)
    assert headline.tasks == ["t2_conference"] and headline.chart_task == "t2_conference"
    assert headline.profiles == ["C0", "C3"] and headline.seeds == ["1", "2", "3"]
    # the fairness settings and caps of the rival rows: Contributor routing, the same run cap, and
    # no knob and no agents axis, so detection is 5 s for everyone and the supervisors restart
    # at once
    assert headline.contributor is True and headline.budget.run_cap_usd == real.budget.run_cap_usd
    assert not headline.knobs and not headline.agents
    cells = headline.cells()
    assert len(cells) == 18 and len({cell.id for cell in cells}) == 18
    # every C3 cell has its C0 twin: the extra cost and the pairing are against the same
    # workflow's own C0 on the same seed
    twins = {(c.workflow, c.task, c.seed) for c in cells if c.profile.name == "C0"}
    assert twins == {(c.workflow, c.task, c.seed) for c in cells if c.profile.name == "C3"}


def test_it_has_a_results_dir_of_its_own() -> None:
    """The harness skips a cell that has a result file: a shared dir would hand back cells that
    were run before the handler freeze."""
    headline = resolve_out_dir(Matrix.load(HEADLINE), HEADLINE)
    others = {
        resolve_out_dir(Matrix.load(path), path)
        for path in BENCH.glob("matrix*.yaml")
        if path != HEADLINE
    }
    assert headline.name == "headline" and headline.parent == BENCH / "results"
    assert headline not in others


def test_every_cell_is_registered_and_the_cap_is_the_worst_case(tmp_path: Path) -> None:
    headline = Matrix.load(HEADLINE)
    plan = preflight(headline, tmp_path)  # an empty results dir: nothing is done yet
    assert plan.unregistered == [] and all(cell.registered for cell in plan.cells)
    assert len(plan.cells) == 18 and not any(cell.done for cell in plan.cells)
    assert all(
        cell.worst_case_usd == pytest.approx(headline.budget.run_cap_usd) for cell in plan.cells
    )
    assert plan.within_cap
    assert plan.worst_case_usd == pytest.approx(headline.budget.matrix_cap_usd)
    assert headline.budget.matrix_cap_usd == pytest.approx(18 * headline.budget.run_cap_usd)


def test_the_hero_chart_draws_from_c0_and_c3_alone_and_has_the_extra_cost(tmp_path: Path) -> None:
    """The matrix has no C1 and C2: the chart has two points per workflow, and the C3 point has
    the extra cost the C0 twin gives. Drawn from the committed fake-LLM rows of the same shape."""
    rows = [
        row
        for row in json.loads(GATE_ROWS.read_text(encoding="utf-8"))
        if row["task"] == "t2_conference"
        and row["workflow"] in WORKFLOWS
        and row["profile"] in ("C0", "C3")
        and row["seed"] in ("1", "2", "3")
    ]
    assert len(rows) == 18
    png, data = hero_chart(
        rows, tmp_path / "hero-t2_conference", task="t2_conference", title="headline"
    )
    assert png.exists() and data.exists()
    series = json.loads(data.read_text(encoding="utf-8"))["series"]
    assert sorted(series) == sorted(WORKFLOWS)
    for workflow in WORKFLOWS:
        points = {p["x"]: p for p in series[workflow]["points"]}
        assert sorted(points) == [0, 5]
        assert points[5]["seeds"] == ["1", "2", "3"] and points[5]["extra_cost_pct"] is not None
