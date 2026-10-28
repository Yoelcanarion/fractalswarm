"""The model ladder on T2 (spec §7.4): as the money spent passes 80%, 90% and 95% of the cap, LLM
calls take cheaper specs, at L2 only the critical path continues, and at the stop no new contract
starts: a partial result that lists its gaps. Opt-in with the economy (a default run never
climbs). The rungs are scaled down in one run so that T2's real spend crosses them; another run
cuts the budget mid-run and meets the real rungs. Fake LLM only, $0."""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.bench.scoring import load_events, score_run
from fractalswarm.bench.workflows import CALIBRATION, bench_script, fake_backend, t2_checker
from fractalswarm.kernel.events import Event
from fractalswarm.llm.calibrate import Calibration
from fractalswarm.market.ladder import LEVELS, request_level
from fractalswarm.market.view import MarketView
from fractalswarm.planning.taskspec import Market, TaskSpec, run_params
from fractalswarm.runs import RunPaths, record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
ORCHESTRATOR_ROLES = {"root_planner", "sub_planner", "judge"}
SCALED_RUNGS = {"L1": 0.05, "L2": 0.09, "stop": 0.12}  # of a $2 cap: $0.10, $0.18, $0.24


async def record(
    run_dir: Path, *, economy: bool = True, budget: float = 2.0, rungs=None, backend=None
) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    spec.market = Market(mode="auction" if economy else "proportional")
    spec.budget_usd = budget
    params = run_params(spec)
    if rungs is not None:
        params["market"]["ladder"] = rungs
    await record_run(
        "swarm",
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=backend or fake_backend(),
        seed=spec.seed,
        params=params,
        run_cap_usd=spec.budget_usd,
    )
    return run_dir


def shock_after(run_dir: Path, calls: int, usd: float):
    """A fake LLM that drops a budget shock into the run's control inbox on its n-th call."""
    seen: list[int] = []

    def script(body, attempt):
        seen.append(1)
        if len(seen) == calls:
            request = {"op": "budget", "level": "run", "key": None, "usd": usd, "reason": "test"}
            RunPaths(run_dir).request_control(request)
        return bench_script(body, attempt)

    return Calibration.load(CALIBRATION).backend(script=script)


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("ladder")
    cut = root / "cut"

    async def everything() -> dict[str, Path]:
        return {
            "default": await record(root / "default", economy=False),
            "calm": await record(root / "calm"),
            "scaled": await record(root / "scaled", rungs=SCALED_RUNGS),
            "cut": await record(cut, backend=shock_after(cut, 25, 0.33)),
        }

    return asyncio.run(everything())


def events(run: Path) -> list[Event]:
    return load_events(run)


def thresholds(run: Path) -> list[dict]:
    return [e.payload for e in events(run) if e.type == "budget.threshold"]


def calls(run: Path) -> list[tuple[str, str, str]]:
    """Each LLM request as (role, the level it carries, the level the run was on when it was
    made), the last rebuilt from the log alone: replay the market view up to the request."""
    view, found = MarketView(), []
    for e in events(run):
        if e.type == "effect.started" and e.payload["kind"] == "llm":
            request = e.payload["request"]
            found.append((request["role"], request.get("level", "L0"), view.ladder.level))
        view.apply(e)
    return found


def rank(level: str) -> int:
    return LEVELS.index(level)


# -- opt-in -----------------------------------------------------------------------------------


def test_a_run_that_never_climbs_sends_no_level_at_all(runs) -> None:
    for name in ("default", "calm"):
        assert not thresholds(runs[name]), name
        assert {carried for _, carried, _ in calls(runs[name])} == {"L0"}, name
        assert not [  # the requests themselves have no `level` key: the logs are as they were
            e for e in events(runs[name]) if e.type == "effect.started"
            and e.payload["kind"] == "llm" and "level" in e.payload["request"]
        ], name  # fmt: skip


# -- climbing the ladder -----------------------------------------------------


def test_the_ladder_climbs_in_order_as_the_money_spent_passes_each_rung(runs) -> None:
    found = thresholds(runs["scaled"])
    assert [(t["previous"], t["level"]) for t in found] == [
        ("L0", "L1"),
        ("L1", "L2"),
        ("L2", "stop"),
    ]
    for move, rung in zip(found, (0.05, 0.09, 0.12), strict=True):
        assert move["cap_usd"] == 2.0 and move["share"] >= rung
        assert move["spent_usd"] >= rung * 2.0 and move["actions"]
    assert [t["at_ms"] for t in found] == sorted(t["at_ms"] for t in found)
    assert "only the critical path continues" in found[1]["actions"]


def test_the_orchestrators_calls_carry_exactly_the_level_the_run_is_on(runs) -> None:
    for name in ("scaled", "cut"):
        mine = [(c, v) for role, c, v in calls(runs[name]) if role in ORCHESTRATOR_ROLES]
        assert mine, name
        for carried, on in mine:
            assert carried == request_level(on) or (carried == "L0" and on == "L0"), (
                name,
                carried,
                on,
            )


def test_the_agents_calls_follow_the_ladder_a_contract_behind_but_never_run_ahead(runs) -> None:
    mine = [(c, v) for role, c, v in calls(runs["scaled"]) if role == "agent"]
    assert {carried for carried, _ in mine} >= {"L0", "L1", "L2"}  # the ladder reached the agents
    for carried, on in mine:
        assert rank(carried) <= rank(request_level(on))  # a contract in flight keeps its level


def test_cheaper_specs_are_really_chosen_at_each_level(runs) -> None:
    """roles.yaml gives the agent a lower effort at L1 and L2: the calls made there think less."""
    log = events(runs["scaled"])
    level_of = {
        e.payload["effect_id"]: e.payload["request"].get("level", "L0")
        for e in log
        if e.type == "effect.started"
        and e.payload["kind"] == "llm"
        and e.payload["request"]["role"] == "agent"
    }
    spent: dict[str, list[int]] = {}
    for e in log:
        if e.type == "effect.completed" and e.payload["effect_id"] in level_of:
            tokens = e.payload["result"]["usage"]["output_tokens"]
            spent.setdefault(level_of[e.payload["effect_id"]], []).append(tokens)
    mean = {level: sum(found) / len(found) for level, found in spent.items()}
    assert set(mean) == {"L0", "L1", "L2"}
    assert mean["L1"] < mean["L0"] and mean["L2"] < mean["L0"]


def test_at_l2_only_the_critical_path_continues_and_at_the_stop_nothing_new_starts(runs) -> None:
    log = events(runs["scaled"])
    dropped = [e.payload for e in log if e.type == "contract.failed"]
    assert dropped and all(d["reasons"][0].startswith("budget ladder") for d in dropped)
    at_l2 = [d for d in dropped if "L2" in d["reasons"][0]]
    at_stop = [d for d in dropped if "stop" in d["reasons"][0]]
    assert at_l2 and at_stop
    assert {d["contract_id"] for d in at_l2} == {"blurb"}  # extract and place are the critical path
    stop_at = next(t["at_ms"] for t in thresholds(runs["scaled"]) if t["level"] == "stop")
    started = [e.ts_virtual for e in log if e.type == "contract.dispatched"]
    assert not [at for at in started if at > stop_at]  # nothing new begins after the stop


def test_the_ladder_saves_money_and_the_result_lists_its_gaps(runs) -> None:
    scaled, calm = score_run(runs["scaled"], t2_checker), score_run(runs["calm"], t2_checker)
    assert scaled.cost_usd < calm.cost_usd and scaled.cost_usd <= 2.0
    result = next(e.payload for e in events(runs["scaled"]) if e.type == "task.result")
    assert result["status"] == "partial" and result["report"]["hard_violations"] <= 8
    gaps = set(result["report"]["gaps"])
    for e in events(runs["scaled"]):
        if e.type == "contract.failed":
            assert f"{e.payload['goal_id']}/{e.payload['contract_id']}: failed" in gaps


# -- a budget cut mid-run meets the real rungs -----------------------------------------------------


def test_a_budget_cut_to_a_third_climbs_the_real_ladder_and_the_talks_are_still_placed(
    runs,
) -> None:
    found = thresholds(runs["cut"])
    assert found and found[0]["previous"] == "L0" and found[0]["level"] == "L1"
    assert found[0]["cap_usd"] == 0.33 and found[0]["share"] >= 0.8  # the real 80% rung
    shock = next(e.ts_virtual for e in events(runs["cut"]) if e.type == "budget.shock")
    assert found[0]["at_ms"] > shock  # it climbed as the money went, after the cut
    assert {carried for _, carried, _ in calls(runs["cut"])} >= {"L0", "L1"}
    metrics = score_run(runs["cut"], t2_checker)
    assert metrics.cost_usd <= 0.33
    result = next(e.payload for e in events(runs["cut"]) if e.type == "task.result")
    assert result["report"]["hard_violations"] == 0  # degraded, not wrong


def test_every_ladder_run_replays_to_its_recorded_head(runs) -> None:
    for name in ("calm", "scaled", "cut"):
        report = asyncio.run(replay_run(runs[name]))
        assert report.ok, (name, report.detail)
