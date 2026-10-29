"""Crash-time jitter (arena spec §C.2) end to end on the fake LLM: the knob ``crash_jitter_pct``
reaches the run as a chaos plan with its coordinator crashes moved, the same for every workflow
of a seed, and a jitter of zero changes nothing.

Nothing here says which system is better: it checks that the crashes land where the plan says.
The runs go through the bench workflows, as a matrix cell does, so they carry the same API
faults.
"""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.bench.profiles import profile
from fractalswarm.bench.registry import Cell, CellContext, get_workflow
from fractalswarm.bench.scoring import load_events, score_run
from fractalswarm.bench.workflows import cell_backend
from fractalswarm.comms.chaos import plan_from
from fractalswarm.runs import replay_run

T2 = "t2_conference"


def record(out: Path, workflow: str, jitter: int | None, seed: str = "1") -> Path:
    knobs = () if jitter is None else (("crash_jitter_pct", jitter),)
    cell = Cell(workflow, T2, profile("C3"), seed, None, knobs)
    ctx = CellContext(cell, out / cell.id, cell_backend(cell), "sim", False, run_cap_usd=2.0)
    flow = get_workflow(workflow)
    assert flow is not None
    asyncio.run(flow.run(ctx))
    return ctx.run_dir


def planned(run_dir: Path) -> list[float]:
    """The coordinator crashes of the plan the run was started with, in the order they fire."""
    params = load_events(run_dir)[0].payload["params"]
    return [a.at for a in plan_from(params).actions if a.kind == "kill_coordinator"]


def fired(run_dir: Path) -> list[float]:
    """The progress at which each coordinator crash was injected."""
    return [
        e.payload["progress"]
        for e in load_events(run_dir)
        if e.type == "chaos.injected"
        and e.payload["fault"] == "kill_coordinator"
        and not e.payload["detail"].get("skipped")
    ]


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    out = tmp_path_factory.mktemp("jitter")
    return {
        "plain": record(out, "durable-max", None),
        "zero": record(out, "durable-max", 0),
        "wide": record(out, "durable-max", 15),
        "swarm": record(out, "swarm", 15),
    }


def test_a_jitter_of_zero_runs_exactly_as_the_plain_profile_does(runs: dict[str, Path]) -> None:
    plain, zero = score_run(runs["plain"]), score_run(runs["zero"])
    assert plain.model_dump(exclude={"run_id"}) == zero.model_dump(exclude={"run_id"})
    assert fired(runs["plain"]) == fired(runs["zero"])
    assert plain.recovery is not None and plain.recovery.crashes == 5


def test_a_jittered_plan_moves_the_crashes_of_a_rival_and_loses_none(runs: dict[str, Path]) -> None:
    plan = planned(runs["wide"])
    assert plan != planned(runs["plain"]) and len(plan) == 5
    moved = fired(runs["wide"])
    assert moved != fired(runs["plain"]) and len(moved) == 5
    assert all(at <= progress for at, progress in zip(plan, moved, strict=True))
    wide = score_run(runs["wide"])
    assert wide.recovery is not None and wide.recovery.crashes == 5 and wide.completed


def test_the_swarm_of_the_same_seed_gets_the_same_crash_times(runs: dict[str, Path]) -> None:
    assert planned(runs["swarm"]) == planned(runs["wide"])
    moved = fired(runs["swarm"])
    assert moved and all(at <= p for at, p in zip(planned(runs["swarm"]), moved, strict=False))
    assert score_run(runs["swarm"]).completed


@pytest.mark.parametrize("which", ["wide", "swarm"])
async def test_a_jittered_run_replays_bit_for_bit(runs: dict[str, Path], which: str) -> None:
    report = await replay_run(runs[which])
    assert report.ok, report.detail
