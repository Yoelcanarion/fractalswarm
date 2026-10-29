"""The matrix of the real rival rows (``bench/matrix-rivals-real.yaml``): what it pays, and where.

It makes no call: these tests load it and run the harness's pre-flight, which never calls a model.
"""

from pathlib import Path

import pytest

from fractalswarm.bench.harness import Matrix, preflight, resolve_out_dir

REPO = Path(__file__).resolve().parents[2]
REAL = REPO / "bench" / "matrix-rivals-real.yaml"
FINAL = REPO / "bench" / "matrix-final.yaml"
V1 = REPO / "bench" / "matrix.yaml"
RIVALS = ("durable-max", "durable")


def test_it_is_the_final_matrix_and_the_two_rivals_in_the_same_results_dir() -> None:
    real, final, v1 = Matrix.load(REAL), Matrix.load(FINAL), Matrix.load(V1)
    assert len(real.workflows) == 6 and set(real.workflows) == {*final.workflows, *RIVALS}
    assert (real.tasks, real.profiles, real.seeds) == (final.tasks, final.profiles, final.seeds)
    assert real.contributor is True and real.budget.run_cap_usd == final.budget.run_cap_usd
    # One results dir: the harness writes results.json and the charts from the cells it ran, and
    # skips a cell that has a result file, so the cells of v1 and of the final matrix stay as they
    # are and a rivals-only matrix cannot overwrite their results.json.
    assert resolve_out_dir(real, REAL) == resolve_out_dir(final, FINAL) == resolve_out_dir(v1, V1)
    ids = {cell.id for cell in real.cells()}
    assert len(ids) == 96 and {c.id for c in final.cells()} | {c.id for c in v1.cells()} <= ids


def test_every_cell_is_registered_and_the_cap_covers_what_is_left_after_v1(tmp_path: Path) -> None:
    real = Matrix.load(REAL)
    (tmp_path / "cells").mkdir()
    for cell in Matrix.load(V1).cells():  # v1 finished: its T2 cells have a result file
        (tmp_path / "cells" / f"{cell.id}.json").write_text("{}", encoding="utf-8")
    plan = preflight(real, tmp_path)
    assert plan.unregistered == [] and all(cell.registered for cell in plan.cells)
    todo = [cell for cell in plan.cells if not cell.done]
    rivals = [cell for cell in todo if cell.cell.split("__")[0] in RIVALS]
    assert (len(todo), len(rivals)) == (64, 32)
    assert all(cell.worst_case_usd == pytest.approx(real.budget.run_cap_usd) for cell in todo)
    assert plan.within_cap and plan.worst_case_usd == pytest.approx(64 * real.budget.run_cap_usd)
