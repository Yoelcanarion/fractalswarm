"""Autoscale on T2 (spec §7.3): the tree sizes itself from the plan and the budget, does the
same work as ``exact`` with fewer agents, survives kills, and replays bit for bit. Fake LLM
only, $0. ``scaling.mode: autoscale`` is opt-in; ``exact`` stays the default."""

import asyncio
from collections import Counter, defaultdict
from pathlib import Path

import pytest

from fractalswarm.bench.scoring import RunMetrics, load_events, score_run
from fractalswarm.bench.workflows import fake_backend, t2_checker
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import Market, TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
KILLS = [(0.20, "o0"), (0.35, "o2.1"), (0.50, "o1"), (0.65, "o3.2"), (0.80, "o2")]


async def record(
    run_dir: Path,
    *,
    autoscale: bool = True,
    market: str = "proportional",
    chaos: dict | None = None,
    **caps: int,
) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    spec.market = Market(mode=market)
    if autoscale:
        spec.scaling.mode = "autoscale"
        for key, value in caps.items():
            setattr(spec.scaling, key, value)
    params = run_params(spec)
    if chaos is not None:
        params |= {"chaos": chaos, "membership": True}
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
    root = tmp_path_factory.mktemp("autoscale")
    c3 = {"profile": "C3", "seed": "1"}
    kill = ChaosPlan(
        profile="kill-half",
        seed="1",
        actions=tuple(ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in KILLS),
    ).model_dump(mode="json")

    async def everything() -> dict[str, Path]:
        return {
            "exact": await record(root / "exact", autoscale=False),
            "exact-c3": await record(root / "exact-c3", autoscale=False, chaos=c3),
            "auto": await record(root / "auto"),
            "auction": await record(root / "auction", market="auction"),
            "c3": await record(root / "c3", chaos=c3),
            "c3-auction": await record(root / "c3-auction", market="auction", chaos=c3),
            "kill": await record(root / "kill", market="auction", chaos=kill),
            "cap2": await record(root / "cap2", max_orchestrators_per_group=2),
            "cap1": await record(root / "cap1", market="auction", max_orchestrators_per_group=1),
            "agents1": await record(root / "agents1", max_agents_per_orchestrator=1),
        }

    return asyncio.run(everything())


def events(run: Path) -> list[Event]:
    return load_events(run)


def score(run: Path) -> RunMetrics:
    return score_run(run, t2_checker)  # type: ignore[return-value]


def decisions(run: Path, kind: str) -> list[dict]:
    return [
        e.payload for e in events(run) if e.type == "scaling.decided" and e.payload["kind"] == kind
    ]


def spawned(run: Path, kind: str) -> list[Event]:
    return [e for e in events(run) if e.type == "actor.spawned" and e.payload["kind"] == kind]


# -- opt-in: exact is untouched -------------------------------------------------------------------


def test_exact_stays_the_default_and_its_log_carries_no_autoscale(runs) -> None:
    log = events(runs["exact"])
    assert not [e for e in log if e.type.startswith(("scaling.", "market."))]
    params = log[0].payload["params"]
    assert "autoscale" not in log[1].payload["args"] and "market" not in params
    assert not {"max_depth", "max_agents_per_orchestrator"} & set(params["spec"]["scaling"])


def test_autoscale_needs_the_economy_params() -> None:
    from fractalswarm.actors.swarm import SWARM

    spec = TaskSpec.load(TASKSPEC)
    spec.scaling.mode = "autoscale"
    params = run_params(spec)
    assert params["market"]["leaf_level"] == 2 and "ladder" in params["market"]
    del params["market"]
    with pytest.raises(ValueError, match="economy"):
        SWARM.boot(params)


# -- the same program with a leaner tree ----------------------------------------------------------


def test_autoscale_does_the_same_work_as_exact_with_fewer_agents(runs) -> None:
    auto, exact = score(runs["auto"]), score(runs["exact"])
    assert auto.completed and auto.valid
    assert auto.llm_calls == exact.llm_calls and auto.cost_usd == pytest.approx(exact.cost_usd)
    assert auto.coordination_tokens == 0
    assert (
        len(spawned(runs["auto"], "orchestrator"))
        == len(spawned(runs["exact"], "orchestrator"))
        == 10
    )
    # T2's contracts form a chain, so a squad only ever has one ready: one agent each, not two.
    assert len(spawned(runs["auto"], "agent")) == 6 < len(spawned(runs["exact"], "agent")) == 12


def test_a_groups_size_is_min_of_subgoals_cap_and_affordable(runs) -> None:
    found = decisions(runs["auto"], "orchestrators")
    assert {d["goal_id"] for d in found} == {"root", "track-ai", "track-data", "track-hci"}
    for d in found:
        detail = d["detail"]
        assert (
            d["after"]
            == d["target"]
            == max(1, min(detail["subgoals"], detail["cap"], detail["affordable"]))
        )
        assert d["after"] <= 6 and d["before"] == 0
    assert next(d for d in found if d["goal_id"] == "root")["after"] == 3  # one per track
    assert all(d["after"] == 2 for d in found if d["goal_id"] != "root")  # one per day


def test_recursion_continues_while_complex_and_stops_at_the_depth_cap(runs) -> None:
    found = decisions(runs["auto"], "recursion")
    by_level = defaultdict(set)
    for d in found:
        by_level[d["before"]].add(d["detail"]["split"])
    assert by_level == {0: {True}, 1: {True}, 2: {False}}  # root and tracks split, sessions do not
    for d in found:
        assert d["detail"]["split"] == (d["detail"]["complexity"] > 1 and d["before"] < 2)


def test_a_cap_below_the_number_of_subgoals_makes_one_orchestrator_own_several(runs) -> None:
    for name, orchestrators in (("cap2", 7), ("cap1", 3)):
        assert score(runs[name]).valid, name
        assert len(spawned(runs[name], "orchestrator")) == orchestrators, name
    cap1 = events(runs["cap1"])
    owners = Counter(e.payload["owner"] for e in cap1 if e.type == "ownership.assigned")
    assert owners.most_common(1)[0][1] >= 3  # o1 owns all three tracks
    assert not [e for e in cap1 if e.type == "budget.refused"]


def test_a_squad_never_has_more_agents_than_the_cap(runs) -> None:
    per_owner = Counter(e.payload["args"]["owner"] for e in spawned(runs["auto"], "agent"))
    assert per_owner and max(per_owner.values()) <= 4
    one = Counter(e.payload["args"]["owner"] for e in spawned(runs["agents1"], "agent"))
    assert max(one.values()) == 1 and score(runs["agents1"]).valid


# -- with the auction, and under chaos ------------------------------------------------------------


def test_autoscale_with_the_auction_completes_valid(runs) -> None:
    assert score(runs["auction"]).valid and score(runs["auction"]).coordination_tokens == 0
    modes = {e.payload["mode"] for e in events(runs["auction"]) if e.type == "market.cleared"}
    assert modes == {"auction"}
    assert {e.payload["mode"] for e in events(runs["auto"]) if e.type == "market.cleared"} == {
        "proportional"
    }  # autoscale needs the allocations; without the auction they are proportional


def test_autoscale_survives_c3_and_kill_half(runs) -> None:
    for name in ("c3", "c3-auction", "kill"):
        metrics = score(runs[name])
        assert metrics.completed and metrics.valid, name
        assert metrics.coordination_tokens == 0, name
    c3, exact = score(runs["c3"]), score(runs["exact-c3"])
    assert c3.cost_usd <= exact.cost_usd * 1.10  # autoscale pays nothing twice either
    killed = [
        e.payload["target"]
        for e in events(runs["kill"])
        if e.type == "chaos.injected" and e.payload["fault"] == "kill_coordinator"
    ]
    assert killed == [target for _, target in KILLS]  # the root among them


def test_every_autoscale_run_replays_to_its_recorded_head(runs) -> None:
    for name in ("auto", "auction", "c3", "c3-auction", "kill", "cap2", "cap1", "agents1"):
        report = asyncio.run(replay_run(runs[name]))
        assert report.ok, (name, report.detail)
