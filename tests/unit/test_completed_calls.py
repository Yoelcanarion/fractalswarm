"""The second cost basis of R5 reads from committed files, so a juror can check it."""

import csv
import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

REPO = Path(__file__).resolve().parents[2]
RESULTS = REPO / "bench" / "results" / "headline-10"


@pytest.fixture(scope="module")
def script() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "completed_calls", REPO / "scripts" / "completed_calls.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rows(name: str) -> list[dict[str, str]]:
    with (RESULTS / name).open(encoding="utf-8", newline="") as source:
        return list(csv.DictReader(source))


def test_the_committed_csv_gives_the_figures_of_r5(script: ModuleType):
    completed = rows("completed-calls.csv")
    figures = {
        workflow: (
            round(script.extra_pct(completed, "cost_usd", workflow), 1),
            round(script.extra_pct(completed, "completed_cost_usd", workflow), 1),
        )
        for workflow in ("swarm", "durable-max", "durable", "central")
    }
    assert figures == {
        "swarm": (2.4, -1.1),
        "durable-max": (8.1, 5.1),
        "durable": (4.3, -1.6),
        "central": (67.0, 29.2),
    }


def test_it_holds_every_cell_with_the_cost_of_results_csv():
    completed = rows("completed-calls.csv")
    assert [(row["cell"], row["cost_usd"]) for row in completed] == [
        (row["cell"], row["cost_usd"]) for row in rows("results.csv")
    ]
    assert all(float(row["estimate_usd"]) > -1e-6 for row in completed)


def test_only_llm_effects_that_completed_are_summed(script: ModuleType, tmp_path: Path):
    def event(kind: str, payload: dict) -> str:
        return json.dumps({"type": kind, "payload": payload})

    log = tmp_path / "events.jsonl"
    log.write_text(
        "\n".join(
            [
                event("effect.started", {"effect_id": "a", "kind": "llm"}),
                event("effect.started", {"effect_id": "b", "kind": "firewall"}),
                event("effect.started", {"effect_id": "c", "kind": "llm"}),
                event("effect.completed", {"effect_id": "a", "result": {"cost_usd": 0.25}}),
                event("effect.completed", {"effect_id": "b", "result": {"cost_usd": 9}}),
                event("effect.cancelled", {"effect_id": "c"}),
            ]
        ),
        encoding="utf-8",
    )
    assert script.completed_cost(log) == 0.25
