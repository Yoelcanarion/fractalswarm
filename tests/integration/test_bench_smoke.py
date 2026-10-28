"""The $0 gate (spec §15.6): swarm vs central on T2 with the calibrated fake LLM.

The same chaos for both (crash points, agent kills, network and API faults from one seed).
The gate passes when the swarm stalls less and pays less extra than the central baseline at
C2 and C3, by a clear margin; a flat chart means stop and revisit the semantics.
"""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.bench.harness import HarnessOptions, Matrix, MatrixReport, run_matrix
from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.runs import replay_run

PROFILES = ["C0", "C2", "C3"]
CRASHES = {"C0": 0, "C2": 3, "C3": 5}


@pytest.fixture(scope="module")
def gate(tmp_path_factory: pytest.TempPathFactory) -> tuple[MatrixReport, Path]:
    out = tmp_path_factory.mktemp("gate")
    matrix = Matrix(
        name="gate-smoke",
        workflows=["swarm", "central"],
        tasks=["t2_conference"],
        profiles=PROFILES,
        seeds=["1"],
        out_dir=str(out),
    )
    options = HarnessOptions(backend_factory=fake_backend, clock="sim")
    report = asyncio.run(run_matrix(matrix, out, options, charts=False))
    return report, out


def row(report: MatrixReport, workflow: str, profile: str) -> dict:
    return next(r for r in report.rows if r["workflow"] == workflow and r["profile"] == profile)


def test_every_cell_completes_with_a_valid_program(gate) -> None:
    report, _ = gate
    assert report.failed == {}
    assert len(report.rows) == 2 * len(PROFILES)
    assert all(r["completed"] and r["valid"] for r in report.rows), report.rows


@pytest.mark.parametrize("profile", ["C2", "C3"])
def test_the_swarm_stalls_less_and_pays_less_extra(gate, profile: str) -> None:
    report, _ = gate
    swarm, central = row(report, "swarm", profile), row(report, "central", profile)
    # Each central crash stops all work for the 5 s restart; the swarm's agents keep going.
    assert central["stall_s"] - swarm["stall_s"] >= 5.0, (swarm, central)
    # A central crash cancels its workers' calls, which are paid again; orphans are adopted.
    assert central["extra_cost_pct"] - swarm["extra_cost_pct"] >= 20.0, (swarm, central)
    assert swarm["coordination_tokens"] == 0


@pytest.mark.parametrize("profile", PROFILES)
def test_both_workflows_get_the_same_number_of_crashes(gate, profile: str) -> None:
    _, out = gate
    for workflow in ("swarm", "central"):
        events = load_events(out / "runs" / f"{workflow}__t2_conference__{profile}__s1")
        kills = [
            e
            for e in events
            if e.type == "chaos.injected" and e.payload["fault"] == "kill_coordinator"
        ]
        assert len(kills) == CRASHES[profile]
        assert all(e.payload.get("target") for e in kills), "a crash was skipped"
        if workflow == "central":
            assert sum(e.type == "baseline.crashed" for e in events) == CRASHES[profile]


@pytest.mark.parametrize("workflow", ["swarm", "central"])
async def test_a_c3_cell_replays_bit_for_bit(gate, workflow: str) -> None:
    _, out = gate
    report = await replay_run(out / "runs" / f"{workflow}__t2_conference__C3__s1")
    assert report.ok, report.detail
