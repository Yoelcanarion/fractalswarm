"""Kill half the brains (spec §0.2, §5.3): T2 at depth 2 loses 5 of its 10 orchestrators,
the root and two track leads among them, and still finishes without stalling or paying twice.

Takeover is leaderless: each survivor computes the same HRW heir from the log, so there is no
election, and no LLM call is spent on it. Orphaned agents keep working; their results, sent
to dead owners, are adopted from the log by the heirs.
"""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.bench.scoring import RunMetrics, load_events, score_run
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
# The root first; then a session owner, a track lead, a session owner and a track lead.
KILLS = [(0.20, "o0"), (0.35, "o2.1"), (0.50, "o1"), (0.65, "o3.2"), (0.80, "o2")]


async def record(run_dir: Path, chaos: dict) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    params = run_params(spec) | {"chaos": chaos, "membership": True}
    await record_run(
        "swarm",
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=fake_backend(),
        seed=spec.seed,
        params=params,
        run_cap_usd=spec.budget_usd,
    )
    return run_dir


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("kill-half")
    actions = tuple(ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in KILLS)
    plan = ChaosPlan(profile="kill-half", seed="1", actions=actions)
    return {
        "c0": asyncio.run(record(root / "c0", {"profile": "C0", "seed": "1"})),
        "kill": asyncio.run(record(root / "kill", plan.model_dump(mode="json"))),
    }


def events(run: Path) -> list[Event]:
    return load_events(run)


def agent_calls(log: list[Event]) -> int:
    return sum(
        1
        for e in log
        if e.type == "effect.started"
        and e.payload.get("kind") == "llm"
        and e.payload["request"].get("role") == "agent"
    )


def test_half_the_brains_die_and_the_program_is_still_complete(runs) -> None:
    log = events(runs["kill"])
    killed = [
        e.payload["target"]
        for e in log
        if e.type == "chaos.injected" and e.payload["fault"] == "kill_coordinator"
    ]
    assert killed == [target for _, target in KILLS]
    orchestrators = {
        e.payload["actor_id"]
        for e in log
        if e.type == "actor.spawned" and e.payload["kind"] == "orchestrator"
    }
    assert len(orchestrators) == 10  # nobody had to respawn a whole group
    result = next(e.payload for e in log if e.type == "task.result")
    assert result["status"] == "ok"
    assert result["report"]["placed"] == result["report"]["expected"] == 48
    assert result["report"]["hard_violations"] == 0


def test_the_root_and_the_track_leads_are_taken_over_by_hashing(runs) -> None:
    log = events(runs["kill"])
    remaps = [e.payload for e in log if e.type == "ownership.remapped"]
    root = [(r["previous"], r["owner"]) for r in remaps if r["key"] == "root"]
    # Root succession: the root's heir is a level-1 orchestrator, and so are its heirs.
    assert root[0][0] == "o0"
    assert all(owner in ("o1", "o2", "o3") for _, owner in root)
    assert [previous for previous, _ in root[1:]] == [owner for _, owner in root[:-1]]
    adopted = [e.payload for e in log if e.type == "tree.adopted"]
    assert any("final integration" in a["duties"] for a in adopted)
    tracks = [a for a in adopted if "integration" in a["duties"]]
    assert {a["dead"] for a in tracks} >= {"o1", "o2"}
    # The adopted child group of a track is its session owners, never the adopter itself.
    assert all(a["adopter"] not in a["children"] for a in adopted)
    # Every survivor computed the same heir: each goal moved once per death.
    keys = [(r["key"], r["previous"]) for r in remaps]
    assert len(keys) == len(set(keys))


def test_nothing_is_paid_twice_and_nothing_stalls(runs) -> None:
    c0, kill = score_run(runs["c0"]), score_run(runs["kill"])
    assert isinstance(kill, RunMetrics)
    # Orphaned agents finished their contracts and the heirs adopted the results.
    assert agent_calls(events(runs["kill"])) == agent_calls(events(runs["c0"]))
    assert kill.cost_usd <= c0.cost_usd * 1.05
    assert kill.coordination_tokens == 0
    assert kill.stall_s < 5.0
    assert kill.makespan_s <= c0.makespan_s * 1.10


async def test_the_run_replays_bit_for_bit(runs) -> None:
    report = await replay_run(runs["kill"])
    assert report.ok, report.detail
