"""``any_survivor`` on whole runs (docs/any-survivor.md): each cell never ends without the param.

Its four rules each have a run that needs them, on the fake LLM: one survivor of ten, a root whose
whole group dies, and a planner whose child group is gone. Nothing is run with the param off, since
those runs do not end; ``test_kill_half.py`` and the replay tests hold the runs without it.
"""

import asyncio
from pathlib import Path
from typing import Any

import pytest

from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run
from fractalswarm.verify.takeover import _read_cassette, analyze, check_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
ALL_BUT_O1_2 = ("o0", "o1", "o1.1", "o2", "o2.1", "o2.2", "o3", "o3.1", "o3.2")
CELLS: dict[str, tuple[tuple[float, str], ...]] = {
    "one-survivor": tuple((0.5, target) for target in ALL_BUT_O1_2),
    "root-group": ((0.2, "o0"), (0.5, "o1"), (0.5, "o2"), (0.5, "o3")),
    "child-group": tuple(
        (0.35, target) for target in ("o1", "o1.1", "o1.2", "o2.2", "o3", "o3.1", "o3.2")
    ),
}


async def record(run_dir: Path, chaos: dict[str, Any], on: bool = True) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    params = run_params(spec.model_copy(update={"any_survivor": on}))
    await record_run(
        "swarm",
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=fake_backend(),
        seed=spec.seed,
        params=params | {"chaos": chaos, "membership": True},
        run_cap_usd=spec.budget_usd,
    )
    return run_dir


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("any-survivor")
    found = {}
    for name, kills in CELLS.items():
        actions = tuple(ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in kills)
        plan = ChaosPlan(profile=name, seed="1", actions=actions)
        found[name] = asyncio.run(record(root / name, plan.model_dump(mode="json")))
    return found


def types(log: list[Event], name: str) -> list[dict[str, Any]]:
    return [e.payload for e in log if e.type == name]


@pytest.mark.parametrize("name", sorted(CELLS))
def test_the_run_finishes_the_whole_program(runs, name: str) -> None:
    result = types(load_events(runs[name]), "task.result")[0]
    assert result["status"] == "ok"
    assert result["report"]["placed"] == result["report"]["expected"] == 48
    assert result["report"]["hard_violations"] == 0


@pytest.mark.parametrize("name", sorted(CELLS))
def test_the_checker_proves_the_takeover_from_the_log(runs, name: str) -> None:
    report = check_run(runs[name])
    assert report.ok, report.violations


@pytest.mark.parametrize("name", sorted(CELLS))
def test_only_crashed_members_are_declared_dead(runs, name: str) -> None:
    log = load_events(runs[name])
    crashed = {p["target"] for p in types(log, "chaos.injected")}
    assert {p["member"] for p in types(log, "member.dead")} == crashed


@pytest.mark.parametrize("name", sorted(CELLS))
async def test_the_run_replays_bit_for_bit(runs, name: str) -> None:
    report = await replay_run(runs[name])
    assert report.ok, report.detail


def test_one_survivor_starts_the_recovery_on_its_own(runs) -> None:
    log = load_events(runs["one-survivor"])
    verdicts = types(log, "member.dead")
    assert {v["by"] for v in verdicts} - {"o4", "o5", "o6"} == {"o1.2"}
    # The first verdicts came only when the isolation rule expired (rule 4).
    assert verdicts[0]["missed"] >= 30
    # The ring carried them across the tree (rule 1): o1.2 has neither o2 nor o3 as a peer.
    assert {"o2", "o3"} <= {v["member"] for v in verdicts if v["by"] == "o1.2"}


def test_the_root_goes_to_a_member_outside_the_dead_group(runs) -> None:
    remaps = [r for r in types(load_events(runs["root-group"]), "ownership.remapped")]
    root = [(r["previous"], r["owner"]) for r in remaps if r["key"] == "root"]
    assert root[0][0] == "o0" and root[0][1] in ("o1", "o2", "o3")
    assert root[-1][0] in ("o1", "o2", "o3") and root[-1][1] not in ("o1", "o2", "o3")


def test_the_checker_reads_the_last_resort_from_the_run(runs) -> None:
    """The same log with the param struck out: the remap of the root breaks the heir rule."""
    path = runs["root-group"]
    log = load_events(path)
    cassette = _read_cassette(path / "cassette.jsonl")
    assert not [v for v in analyze(log, cassette=cassette).violations if v.kind == "heir-mismatch"]
    first = log[0]
    params = {k: v for k, v in first.payload["params"].items() if k != "any_survivor"}
    struck = first.model_copy(update={"payload": {**first.payload, "params": params}})
    found = analyze([struck, *log[1:]], cassette=cassette).violations
    assert [v for v in found if v.kind == "heir-mismatch"]


def test_a_dead_child_group_gets_a_new_member(runs) -> None:
    log = load_events(runs["child-group"])
    spawned = [
        p["actor_id"]
        for p in types(log, "actor.spawned")
        if p["kind"] == "orchestrator" and p["actor_id"].count(".") == 1
    ]
    # o1's two owners died; the track's heir brought a third one in.
    assert set(spawned) > {"o1.1", "o1.2", "o2.1", "o2.2", "o3.1", "o3.2"}
    assert all(
        p["args"].get("any_survivor")
        for p in types(log, "actor.spawned")
        if p["kind"] == "orchestrator"
    )


def stripped(event: Event) -> tuple[Any, ...]:
    payload = {k: v for k, v in event.payload.items() if k not in ("params", "args")}
    return event.seq, event.type, event.actor, event.ts_virtual, payload


def test_with_nobody_dead_the_param_changes_nothing(tmp_path: Path) -> None:
    chaos = {"profile": "C0", "seed": "1"}
    off = asyncio.run(record(tmp_path / "off" / "c0", chaos, on=False))
    on = asyncio.run(record(tmp_path / "on" / "c0", chaos, on=True))
    off_log, on_log = load_events(off), load_events(on)
    assert len(off_log) == len(on_log)
    differs = [a.seq for a, b in zip(off_log, on_log, strict=True) if stripped(a) != stripped(b)]
    assert not differs, differs[:5]
    assert "any_survivor" not in off_log[0].payload["params"]
    assert on_log[0].payload["params"]["any_survivor"] is True
