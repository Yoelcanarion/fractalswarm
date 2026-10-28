"""The LangGraph baseline under its best-case supervisor (spec §15.1-§15.2), at $0.

Hierarchical teams on LangGraph, every model call ``ChatOpenAI`` through the LLM layer. The
same T2 instance, role ladder and chaos plan as ``central``; a crash cancels the in-flight
calls of the whole run, the supervisor restarts the graph 5 s later, and LangGraph resumes
from its checkpoints.
"""

import asyncio
import json
from collections import Counter
from pathlib import Path

import pytest

from fractalswarm.baselines.langgraph_teams import record_langgraph
from fractalswarm.baselines.supervisor import RESTART_TAG
from fractalswarm.bench.profiles import RESTART_DELAY_MS, profile
from fractalswarm.bench.registry import Cell, get_task, get_workflow
from fractalswarm.bench.scoring import RunMetrics, load_events, score_run
from fractalswarm.bench.workflows import fake_backend, t2_params
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.llm.roles import RoleTable
from fractalswarm.llm.transport import ApiFaults, FaultyBackend
from fractalswarm.runs import RunPaths, replay_run

CHECKER = get_task("t2_conference").checker  # type: ignore[union-attr]


def record(
    run_dir: Path,
    profile_name: str = "C0",
    *,
    plan: ChaosPlan | None = None,
    clock: str = "sim",
    speed: float = 1.0,
    cap: float | None = None,
    contributor: bool = False,
) -> RunMetrics:
    cell = Cell("langgraph", "t2_conference", profile(profile_name), "1")
    params = t2_params(cell, contributor)
    if plan is not None:
        params["chaos"] = plan.model_dump(mode="json")
    backend = FaultyBackend(fake_backend(), ApiFaults(seed="1", rate=0.0))
    roles = RoleTable.load().contributor_mode() if contributor else RoleTable.load()
    asyncio.run(
        record_langgraph(
            run_id="langgraph",
            run_dir=run_dir,
            backend=backend,
            seed="1",
            params=params,
            clock=clock,
            speed=speed,
            run_cap_usd=cap,
            roles=roles,
        )
    )
    return score_run(run_dir, CHECKER)


def of(log: list[Event], event_type: str) -> list[Event]:
    return [e for e in log if e.type == event_type]


def llm_roles(log: list[Event]) -> Counter[str]:
    return Counter(
        e.payload["request"]["role"]
        for e in of(log, "effect.started")
        if e.payload["kind"] == "llm"
    )


@pytest.fixture(scope="module")
def c0(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, RunMetrics]:
    run_dir = tmp_path_factory.mktemp("langgraph") / "c0"
    return run_dir, record(run_dir, "C0")


@pytest.fixture(scope="module")
def c3(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, RunMetrics]:
    run_dir = tmp_path_factory.mktemp("langgraph") / "c3"
    return run_dir, record(run_dir, "C3")


# -- C0 ---------------------------------------------------------------------------------------


def test_a_c0_cell_is_complete_and_valid(c0) -> None:
    run_dir, metrics = c0
    assert metrics.completed and metrics.valid, metrics.detail
    assert metrics.detail.startswith("placed 48/48, hard violations 0")
    assert metrics.cancelled_llm_calls == 0 and metrics.chaos_events == 0
    log = load_events(run_dir)
    assert not of(log, "baseline.crashed") and not of(log, "chaos.injected")
    assert RunPaths(run_dir).open_log().verify_chain().ok


def test_it_makes_the_central_baselines_planning_calls_plus_its_supervisors_routing(c0) -> None:
    run_dir, metrics = c0
    log = load_events(run_dir)
    roles = llm_roles(log)
    # root planner once, a split per track, a contract plan per session, the judge on each place
    assert roles["root_planner"] == 1 and roles["sub_planner"] == 3 + 6 and roles["judge"] == 6
    assert roles["agent"] >= 18
    # each dispatch of a contract is routed by its team supervisor through the LLM
    assert roles["supervisor"] == 18
    routed = of(log, "supervisor.routed")
    assert len(routed) == 18 and all(e.payload["valid"] for e in routed)
    tags = [
        e.payload["tag"]
        for e in of(log, "effect.started")
        if e.payload["request"].get("role") == "supervisor"
    ]
    assert all(tag.startswith("coord:route|") for tag in tags)
    assert metrics.coordination_tokens > 0  # the swarm spends none


def test_its_planning_requests_are_the_ones_the_central_baseline_sends(tmp_path: Path, c0) -> None:
    """Same task instance, same prompts: the root and track and session planner requests are
    identical to central's (the agents' depend on when the board is read)."""
    from fractalswarm.bench.harness import HarnessOptions, Matrix, run_matrix

    out = tmp_path / "central"
    matrix = Matrix(
        name="same-calls",
        workflows=["central"],
        tasks=["t2_conference"],
        profiles=["C0"],
        seeds=["1"],
        out_dir=str(out),
    )
    report = asyncio.run(
        run_matrix(matrix, out, HarnessOptions(backend_factory=fake_backend), charts=False)
    )
    assert not report.failed

    def planning(run_dir: Path) -> set[str]:
        return {
            json.dumps(e.payload["request"], sort_keys=True)
            for e in of(load_events(run_dir), "effect.started")
            if e.payload["kind"] == "llm"
            and e.payload["request"]["role"] in ("root_planner", "sub_planner")
        }

    central = planning(out / "runs" / "central__t2_conference__C0__s1")
    assert len(central) == 10
    assert planning(c0[0]) == central


def test_the_run_is_the_same_every_time(tmp_path: Path, c0) -> None:
    """Replay needs it: LangGraph's concurrency under the turn-taking driver is deterministic."""
    record(tmp_path / "again", "C0")
    first, second = RunPaths(c0[0]).open_log(), RunPaths(tmp_path / "again").open_log()
    assert first.head_hash == second.head_hash


async def test_a_c0_cell_replays_bit_for_bit(c0) -> None:
    report = await replay_run(c0[0])
    assert report.ok, report.detail


# -- C3: five crashes, half the workers -------------------------------------------------------


def test_a_c3_cell_with_five_crashes_is_complete_and_valid(c3) -> None:
    run_dir, metrics = c3
    assert metrics.completed and metrics.valid, metrics.detail
    log = load_events(run_dir)
    crashes, restarts = of(log, "baseline.crashed"), of(log, "baseline.restarted")
    assert len(crashes) == len(restarts) == 5
    kills = [e for e in of(log, "chaos.injected") if e.payload["fault"] == "kill_coordinator"]
    assert len(kills) == 5 and all(e.payload["target"] == "o0" for e in kills)
    # half the workers die, at the same points as for the other workflows
    agent_kills = [e for e in of(log, "chaos.injected") if e.payload["fault"] == "kill_agent"]
    assert len(agent_kills) >= 6
    assert metrics.stall_s >= 5 * RESTART_DELAY_MS / 1000


def test_it_suffers_the_same_crashes_and_kills_as_the_central_baseline(tmp_path: Path, c3) -> None:
    """Spec §15.2: the same coordinator crashes at the same progress points, the same share
    of the workers killed (the same ones at the first point: one seeded draw)."""
    from fractalswarm.bench.harness import HarnessOptions, Matrix, run_matrix

    out = tmp_path / "central"
    matrix = Matrix(
        name="same-chaos",
        workflows=["central"],
        tasks=["t2_conference"],
        profiles=["C3"],
        seeds=["1"],
        out_dir=str(out),
    )
    report = asyncio.run(
        run_matrix(matrix, out, HarnessOptions(backend_factory=fake_backend), charts=False)
    )
    assert not report.failed

    def injected(log: list[Event]) -> dict[str, list]:
        chaos = [e.payload for e in of(log, "chaos.injected")]
        crashes = [c["progress"] for c in chaos if c["fault"] == "kill_coordinator"]
        kills = [(c["progress"], c["target"]) for c in chaos if c["fault"] == "kill_agent"]
        first = min(at for at, _ in kills)
        return {
            "crash": crashes,
            "kill": kills,
            "first": sorted(t for at, t in kills if at == first),
        }

    central = injected(load_events(out / "runs" / "central__t2_conference__C3__s1"))
    langgraph = injected(load_events(c3[0]))
    assert langgraph["crash"] == central["crash"] and len(central["crash"]) == 5
    assert len(langgraph["kill"]) == len(central["kill"]) == 6
    assert len(langgraph["first"]) == 6 and langgraph["first"] == central["first"]


def test_a_crash_cancels_the_whole_runs_calls_and_the_restart_comes_5_s_later(c3) -> None:
    log = load_events(c3[0])
    crashes, restarts = of(log, "baseline.crashed"), of(log, "baseline.restarted")
    for crash, restart in zip(crashes, restarts, strict=True):
        timer = next(
            e
            for e in log
            if e.type == "effect.completed"
            and e.payload.get("tag") == RESTART_TAG
            and e.ts_virtual >= crash.ts_virtual
        )
        assert timer.ts_virtual - crash.ts_virtual == RESTART_DELAY_MS
        assert restart.ts_virtual == timer.ts_virtual
        cancelled = [
            e
            for e in of(log, "effect.cancelled")
            if e.ts_virtual == crash.ts_virtual and e.payload["kind"] == "llm"
        ]
        assert cancelled, "a crash with calls in flight cancels them"
        assert set(restart.payload["redo"]) == set(crash.payload["lost"])
        # nothing runs while the process is down
        during = [
            e
            for e in of(log, "effect.started")
            if e.payload["kind"] == "llm" and crash.ts_virtual < e.ts_virtual < restart.ts_virtual
        ]
        assert during == []


def test_completed_work_is_kept_and_the_lost_calls_are_paid_twice(c0, c3) -> None:
    """LangGraph resumes from its checkpoints: the root plan is not made again, and every
    contract is verified once; only the in-flight calls run again, and the bench bills them."""
    c0_log, c3_log = load_events(c0[0]), load_events(c3[0])
    assert llm_roles(c3_log)["root_planner"] == 1
    assert len(of(c3_log, "plan.proposed")) == 1
    verified = Counter(
        e.payload["contract_id"] + e.payload["goal_id"] for e in of(c3_log, "contract.verified")
    )
    assert len(verified) == 18 and set(verified.values()) == {1}
    cancelled = [e for e in of(c3_log, "effect.cancelled") if e.payload["kind"] == "llm"]
    assert len(cancelled) >= 5
    started = lambda log: sum(1 for e in of(log, "effect.started") if e.payload["kind"] == "llm")  # noqa: E731
    assert started(c3_log) >= started(c0_log) + len(cancelled) - 3  # what was lost runs again
    assert c3[1].cost_usd > c0[1].cost_usd


def test_the_scorer_reads_both_cells(c0, c3) -> None:
    for run_dir, metrics in (c0, c3):
        again = score_run(run_dir, CHECKER)
        assert again == metrics
        assert metrics.llm_calls == metrics.work_calls + sum(
            n for role, n in llm_roles(load_events(run_dir)).items() if role != "agent"
        )
    assert c3[1].cancelled_llm_calls >= 5 and c3[1].makespan_s > c0[1].makespan_s


async def test_a_c3_cell_replays_bit_for_bit(c3) -> None:
    report = await replay_run(c3[0])
    assert report.ok, report.detail
    assert report.replayed_events == RunPaths(c3[0]).open_log().last_seq


# -- agent kills, live mode, budget ------------------------------------------------------------


def test_a_killed_worker_loses_its_call_and_the_supervisor_reassigns_the_contract(
    tmp_path: Path,
) -> None:
    plan = ChaosPlan(
        profile="kills",
        seed="1",
        actions=(ChaosAction(at=0.3, kind="kill_agents", agent_share=0.5),),
    )
    metrics = record(tmp_path / "kills", plan=plan)
    log = load_events(tmp_path / "kills")
    assert metrics.completed and metrics.valid
    assert len([e for e in of(log, "chaos.injected") if e.payload["fault"] == "kill_agent"]) == 6
    assert not of(log, "baseline.crashed"), "an agent kill is not a coordinator crash"
    lost = [e for e in of(log, "contract.rejected") if e.payload["stage"] == "lost"]
    assert lost and metrics.cancelled_llm_calls == len(lost)
    # a lost contract goes again without counting as a failed attempt
    assert not of(log, "contract.failed")


async def test_a_live_run_replays_bit_for_bit(tmp_path: Path) -> None:
    """The coordinator's real rows run on the live clock; the driver's turn-taking makes them
    replayable. Here the live clock runs the fake LLM 40x faster."""
    plan = ChaosPlan(
        profile="one-crash", seed="1", actions=(ChaosAction(at=0.35, kind="kill_coordinator"),)
    )
    metrics = await asyncio.to_thread(
        record, tmp_path / "live", plan=plan, clock="live", speed=40.0
    )
    assert metrics.completed and metrics.valid
    started = load_events(tmp_path / "live")[0]
    assert started.payload["clock"] == "live"
    report = await replay_run(tmp_path / "live")
    assert report.ok, report.detail


def test_contributor_routing_is_on_every_call_that_the_gate_lets_through(tmp_path: Path) -> None:
    metrics = record(tmp_path / "contributor", contributor=True)
    assert metrics.completed and metrics.valid
    log = load_events(tmp_path / "contributor")
    models = {
        e.payload["request"]["role"]: e.payload["request"].get("contributor")
        for e in of(log, "effect.started")
        if e.payload["kind"] == "llm"
    }
    assert all(models.values()), "every call opts in; the client's gate decides"
    cassette = (tmp_path / "contributor" / "cassette.jsonl").read_text(encoding="utf-8")
    assert "muse-spark-1.3-contributor" in cassette


def test_a_run_over_its_budget_ends_with_a_partial_result_not_a_crash(tmp_path: Path) -> None:
    metrics = record(tmp_path / "capped", cap=0.03)
    log = load_events(tmp_path / "capped")
    assert of(log, "budget.refused") and of(log, "task.result")
    assert metrics.completed and not metrics.valid
    assert metrics.cost_usd <= 0.03 + 1e-9


def test_the_bench_runs_it_as_a_registered_workflow() -> None:
    workflow = get_workflow("langgraph")
    assert workflow is not None and workflow.tasks == frozenset({"t2_conference"})
    cell = Cell("langgraph", "t2_conference", profile("C3"), "1")
    requests = workflow.preflight(cell, True)
    roles = Counter(request["role"] for request in requests)
    assert roles["supervisor"] > 0 and all(request["contributor"] for request in requests)


@pytest.fixture
def tracing_env(monkeypatch: pytest.MonkeyPatch):
    """LANGSMITH_TRACING on; langsmith caches its environment lookups, so clear them around it."""
    from langsmith import utils

    utils.get_env_var.cache_clear()
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    yield
    monkeypatch.undo()
    utils.get_env_var.cache_clear()


def test_langsmith_tracing_stays_off_inside_the_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, tracing_env
) -> None:
    """A tracing environment must not send the run's prompts anywhere."""
    from langsmith.utils import tracing_is_enabled

    from fractalswarm.baselines import langgraph_teams

    assert tracing_is_enabled()
    seen: list[bool] = []

    async def spy(rt) -> None:
        seen.append(tracing_is_enabled())

    monkeypatch.setattr(langgraph_teams, "coordinate", spy)
    cell = Cell("langgraph", "t2_conference", profile("C0"), "1")
    asyncio.run(
        record_langgraph(
            run_id="t",
            run_dir=tmp_path / "t",
            backend=fake_backend(),
            seed="1",
            params=t2_params(cell, False),
        )
    )
    assert seen == [False]
