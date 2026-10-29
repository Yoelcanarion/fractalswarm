"""The arena's matrix axes: sweep knobs, the per-process probes (``K-`` profiles), the agents'
latency scale and the recovery columns. Nothing here runs a workflow."""

import asyncio
from pathlib import Path

import pytest
from pydantic import ValidationError

from fractalswarm.bench.harness import (
    RECOVERY_COLUMNS,
    RESULT_COLUMNS,
    CellResult,
    HarnessOptions,
    Matrix,
    aggregate,
    read_results,
    resolve_out_dir,
    result_columns,
    run_matrix,
    write_results,
)
from fractalswarm.bench.profiles import (
    CRASH_POINTS,
    JITTER_MAX_PCT,
    crash_jitter,
    jittered_plan,
    profile,
    single_crash_plan,
)
from fractalswarm.bench.recovery import RecoveryMetrics
from fractalswarm.bench.registry import KNOBS, Cell, knobs_text
from fractalswarm.bench.scoring import RunMetrics
from fractalswarm.bench.workflows import cell_backend, t2_params
from fractalswarm.comms.chaos import ChaosPlan, build_plan, plan_from
from fractalswarm.llm.calibrate import RoleLatencyScale
from fractalswarm.llm.cassette import Attempt
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.roles import RoleTable

REPO = Path(__file__).resolve().parents[2]


def matrix(**changes) -> Matrix:
    base = {
        "name": "t",
        "workflows": ["swarm", "durable-max"],
        "tasks": ["t2_conference"],
        "profiles": ["C0", "C3"],
        "seeds": ["1", "2"],
        "out_dir": "out",
    }
    return Matrix.model_validate(base | changes)


# -- the per-process probes ------------------------------------------------------------------


def test_a_single_crash_profile_names_its_target_and_time() -> None:
    probe = profile("K-o1.1")
    assert (probe.target, probe.at, probe.coordinator_crashes) == ("o1.1", 0.5, 1)
    assert probe.name == "K-o1.1" and probe.crash_points == (0.5,)
    assert (probe.agents_killed_pct, probe.api_fault_pct, probe.message_loss_pct) == (0, 0, 0)
    assert not probe.partition
    early = profile("K-o0@0.35")
    assert (early.target, early.at, early.name) == ("o0", 0.35, "K-o0@0.35")
    assert profile("K-o0@0.5").name == "K-o0"  # the default time is not spelled twice


@pytest.mark.parametrize("name", ["K-", "K-@0.5", "K-o0@x", "K-o0@0", "K-o0@1.5", "K-o0@-1"])
def test_a_malformed_single_crash_profile_is_refused(name: str) -> None:
    with pytest.raises(ValueError, match="single-crash|unknown"):
        profile(name)


def test_the_named_profiles_are_as_they_were() -> None:
    for name, crashes in (("C0", 0), ("C1", 1), ("C2", 3), ("C3", 5)):
        chaos = profile(name)
        assert (chaos.target, chaos.at, chaos.coordinator_crashes) == (None, None, crashes)
    assert profile("C3").crash_points == (0.20, 0.35, 0.50, 0.65, 0.80)


def test_a_single_crash_plan_is_a_valid_chaos_plan_with_one_explicit_kill() -> None:
    raw = single_crash_plan(profile("K-o1@0.4"), "3")
    plan = plan_from({"chaos": raw})
    assert isinstance(plan, ChaosPlan) and plan == ChaosPlan.model_validate(raw)
    assert [(a.at, a.kind, a.target) for a in plan.actions] == [(0.4, "kill_coordinator", "o1")]
    assert (plan.seed, plan.api_fault_rate, plan.net.drop) == ("3", 0.0, 0.0)
    with pytest.raises(ValueError, match="not a single-crash"):
        single_crash_plan(profile("C3"))


# -- cells and knobs -------------------------------------------------------------------------


def test_a_cell_id_gets_its_knobs_and_only_then() -> None:
    plain = Cell("swarm", "t2_conference", profile("C3"), "2")
    assert plain.id == "swarm__t2_conference__C3__s2" and plain.knobs == ()
    swept = Cell("swarm", "t2_conference", profile("C3"), "2", None, (("recovery_ms", 500),))
    assert swept.id == "swarm__t2_conference__C3__s2__recovery_ms-500"
    both = Cell("swarm", "t2_conference", profile("C3"), "2", 8, (("agent_latency_scale", 0.25),))
    assert both.id == "swarm__t2_conference__C3__s2__agent_latency_scale-0.25__n8"
    assert swept.knob("recovery_ms") == 500 and swept.knob("rival_restart_ms") is None


def test_knobs_read_as_text_in_a_row() -> None:
    assert knobs_text(()) is None
    assert knobs_text((("recovery_ms", 500),)) == "recovery_ms=500"
    both = (("agent_latency_scale", 0.5), ("recovery_ms", 2500))
    assert knobs_text(both) == "agent_latency_scale=0.5;recovery_ms=2500"


def test_the_knobs_axis_multiplies_the_cells_and_keeps_them_distinct() -> None:
    swept = matrix(knobs=[{"recovery_ms": 1000}, {"recovery_ms": 5000}, {}])
    cells = swept.cells()
    assert len(cells) == 2 * 2 * 3 * 2  # workflows x profiles x points x seeds
    assert len({cell.id for cell in cells}) == len(cells)
    assert {cell.knobs for cell in cells} == {
        (("recovery_ms", 1000),),
        (("recovery_ms", 5000),),
        (),
    }
    assert len(matrix().cells()) == 2 * 2 * 2 and all(not c.knobs for c in matrix().cells())


def test_the_knobs_are_sorted_in_a_cell_whatever_the_order_in_the_matrix() -> None:
    swept = matrix(knobs=[{"rival_restart_ms": 1000, "recovery_ms": 5000}])
    assert {cell.knobs for cell in swept.cells()} == {
        (("recovery_ms", 5000), ("rival_restart_ms", 1000))
    }


@pytest.mark.parametrize(
    ("knobs", "message"),
    [
        ([{"patience": 3}], "unknown knob"),
        ([{"recovery_ms": -1}], ">= 0"),
        ([{"recovery_ms": 0.5}], "whole milliseconds"),
        ([{"recovery_ms": True}], "valid"),
        ([{"agent_latency_scale": 0}], "> 0"),
        ([], "distinct points"),
        ([{"recovery_ms": 1}, {"recovery_ms": 1}], "distinct points"),
    ],
)
def test_a_bad_knob_is_refused_when_the_matrix_loads(knobs: list[dict], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        matrix(knobs=knobs)


def test_the_known_knobs() -> None:
    assert set(KNOBS) == {
        "recovery_ms",
        "rival_recovery_ms",
        "rival_restart_ms",
        "agent_latency_scale",
        "crash_jitter_pct",
    }


# -- knobs reach the run only when set -------------------------------------------------------


def test_a_sweep_cell_gets_its_times_as_params_and_a_default_cell_gets_none() -> None:
    plain = t2_params(Cell("durable-max", "t2_conference", profile("C3"), "1"), False)
    assert not {"recovery_ms", "rival_recovery_ms", "rival_restart_ms"} & set(plain)
    assert plain["chaos"] == {"profile": "C3", "seed": "1"}
    knobs = (("agent_latency_scale", 0.5), ("recovery_ms", 2500), ("rival_restart_ms", 1000))
    swept = t2_params(Cell("durable-max", "t2_conference", profile("C3"), "1", None, knobs), False)
    assert (swept["recovery_ms"], swept["rival_restart_ms"]) == (2500, 1000)
    assert "agent_latency_scale" not in swept  # it changes the backend, not the run
    assert "rival_recovery_ms" not in swept
    assert {k: v for k, v in swept.items() if k not in ("recovery_ms", "rival_restart_ms")} == plain


def test_a_per_process_cell_carries_an_explicit_plan() -> None:
    params = t2_params(Cell("swarm", "t2_conference", profile("K-o1.1"), "2"), False)
    plan = plan_from(params)
    assert [(a.kind, a.target, a.at) for a in plan.actions] == [("kill_coordinator", "o1.1", 0.5)]
    assert plan.seed == "2" and plan.api_fault_rate == 0 and plan.net.drop == 0


# -- the agents' latency scale ---------------------------------------------------------------


class Delays:
    """Records the delay a backend asked the clock for."""

    def __init__(self) -> None:
        self.asked: list[int] = []

    async def sleep(self, ms: int) -> None:
        self.asked.append(ms)


class FixedBackend:
    """A backend that always takes 1000 ms."""

    def __init__(self) -> None:
        self.calls = 0

    async def send(self, effect_id: str, body: dict, sleep) -> Attempt:
        self.calls += 1
        await sleep(1000)
        return Attempt(status=200, body={"ok": True}, latency_ms=1000)


def body(model: str, effort: str, max_output_tokens: int) -> dict:
    return {
        "model": model,
        "reasoning": {"effort": effort},
        "max_output_tokens": max_output_tokens,
        "input": "x",
    }


AGENT = body("muse-spark-1.3", "low", 4096)
AGENT_LATER = body("muse-spark-1.3-contributor", "minimal", 4096)
SUB_PLANNER = body("muse-spark-1.3", "medium", 8192)


async def send(backend, request: dict) -> tuple[Attempt, list[int]]:
    delays = Delays()
    attempt = await backend.send("e1", request, delays.sleep)
    return attempt, delays.asked


def test_only_the_scaled_roles_calls_change_their_latency() -> None:
    scaled = RoleLatencyScale(FixedBackend(), {"agent": 0.25}, RoleTable.load())
    attempt, asked = asyncio.run(send(scaled, AGENT))
    assert (asked, attempt.latency_ms) == ([250], 250)
    attempt, asked = asyncio.run(send(scaled, AGENT_LATER))  # any level, Contributor too
    assert (asked, attempt.latency_ms) == ([250], 250)
    attempt, asked = asyncio.run(send(scaled, SUB_PLANNER))
    assert (asked, attempt.latency_ms) == ([1000], 1000)
    assert scaled.calls == 3  # whatever the inner backend counts


def test_a_scale_of_one_is_the_inner_backend_untouched() -> None:
    inner = FixedBackend()
    attempt, asked = asyncio.run(send(RoleLatencyScale(inner, {"agent": 1.0}), AGENT))
    assert (asked, attempt.latency_ms, inner.calls) == ([1000], 1000, 1)


def test_a_role_that_cannot_be_told_apart_cannot_be_scaled() -> None:
    with pytest.raises(ValueError, match="no \\(model, effort, max tokens\\) of its own"):
        RoleLatencyScale(FixedBackend(), {"judge": 2.0}, RoleTable.load())  # same as the auditor
    with pytest.raises(ValueError, match="positive"):
        RoleLatencyScale(FixedBackend(), {"agent": 0.0}, RoleTable.load())


def test_the_fake_backend_of_a_cell_follows_its_knob() -> None:
    plain = cell_backend(Cell("swarm", "t2_conference", profile("C3"), "1"))
    assert not isinstance(plain, RoleLatencyScale)
    cell = Cell("swarm", "t2_conference", profile("C3"), "1", None, (("agent_latency_scale", 2),))
    scaled = cell_backend(cell)
    assert isinstance(scaled, RoleLatencyScale) and scaled.scales == {"agent": 2.0}
    assert isinstance(scaled.inner, FakeBackend)


def test_the_scale_stretches_a_calibrated_fake_agent_call() -> None:
    cell = Cell("swarm", "t2_conference", profile("C3"), "1", None, (("agent_latency_scale", 2),))
    request = AGENT | {"input": "extract the speakers", "instructions": "be brief"}
    _, base = asyncio.run(
        send(cell_backend(Cell("swarm", "t2_conference", profile("C3"), "1")), request)
    )
    _, doubled = asyncio.run(send(cell_backend(cell), request))
    assert doubled == [2 * base[0]]


def test_a_matrix_that_sweeps_a_backend_knob_needs_a_cell_backend(tmp_path: Path) -> None:
    swept = matrix(knobs=[{"agent_latency_scale": 0.5}])
    with pytest.raises(ValueError, match="needs a cell_backend"):
        asyncio.run(run_matrix(swept, tmp_path, HarnessOptions(backend_factory=FakeBackend)))
    assert not (tmp_path / "cells").exists()


# -- crash-time jitter -----------------------------------------------------------------------


def crash_times(plan: ChaosPlan) -> list[float]:
    return [a.at for a in plan.actions if a.kind == "kill_coordinator"]


def test_the_displacements_depend_on_the_seed_alone_and_stretch_with_the_jitter() -> None:
    assert crash_jitter("1", 0) == (0,) * len(CRASH_POINTS)
    assert crash_jitter("2", 10) == crash_jitter("2", 10) != crash_jitter("3", 10)
    narrow, wide = crash_jitter("3", 5), crash_jitter("3", 15)
    assert all(abs(a) <= abs(b) for a, b in zip(narrow, wide, strict=True))
    for seed in "1234":
        assert all(abs(d) <= JITTER_MAX_PCT for d in crash_jitter(seed, JITTER_MAX_PCT))
    assert any(any(crash_jitter(seed, JITTER_MAX_PCT)) for seed in "1234")


@pytest.mark.parametrize("jitter", [-1, JITTER_MAX_PCT + 1, 2.5, "5", True])
def test_a_jitter_that_is_not_whole_points_up_to_the_cap_is_refused(jitter) -> None:
    with pytest.raises(ValueError, match="crash jitter"):
        crash_jitter("1", jitter)


def test_a_jitter_of_zero_is_the_plan_spelled_out() -> None:
    for name in ("C0", "C1", "C2", "C3"):
        built = build_plan(name, "2")
        assert (
            ChaosPlan.model_validate(jittered_plan(built.model_dump(mode="json"), "2", 0)) == built
        )


def test_only_the_coordinator_crashes_move() -> None:
    built = build_plan("C3", "1")
    moved = ChaosPlan.model_validate(jittered_plan(built.model_dump(mode="json"), "1", 15))
    displaced = [
        round(at + d / 100, 2) for at, d in zip(CRASH_POINTS, crash_jitter("1", 15), strict=True)
    ]
    assert crash_times(moved) == sorted(displaced) != list(CRASH_POINTS)
    assert all(0 <= at <= 1 for at in crash_times(moved))
    others = [a for a in built.actions if a.kind != "kill_coordinator"]
    assert [a for a in moved.actions if a.kind != "kill_coordinator"] == others
    assert (moved.profile, moved.seed, moved.net, moved.api_fault_rate) == (
        built.profile,
        built.seed,
        built.net,
        built.api_fault_rate,
    )
    keys = [(a.at, a.kind) for a in moved.actions]  # the order the monkey walks them in
    assert keys == sorted(keys)


def test_a_profile_with_fewer_crashes_takes_the_first_displacements_of_the_seed() -> None:
    plan = ChaosPlan.model_validate(
        jittered_plan(build_plan("C2", "4").model_dump(mode="json"), "4", 10)
    )
    first = crash_jitter("4", 10)[:3]
    expected = sorted(round(at + d / 100, 2) for at, d in zip(CRASH_POINTS, first, strict=False))
    assert crash_times(plan) == expected
    assert (
        crash_times(
            ChaosPlan.model_validate(jittered_plan(build_plan("C0", "4").model_dump(), "4", 10))
        )
        == []
    )


def test_a_plan_with_more_crashes_than_points_cannot_be_jittered() -> None:
    plan = {"actions": [{"at": 0.1 * k, "kind": "kill_coordinator"} for k in range(1, 7)]}
    with pytest.raises(ValueError, match="at most 5"):
        jittered_plan(plan, "1", 5)


def test_a_jitter_cell_carries_its_plan_and_no_param_of_its_own() -> None:
    swept = Cell(
        "durable-max", "t2_conference", profile("C3"), "1", None, (("crash_jitter_pct", 10),)
    )
    plain = Cell("durable-max", "t2_conference", profile("C3"), "1")
    params, base = t2_params(swept, False), t2_params(plain, False)
    assert "crash_jitter_pct" not in params
    assert {k: v for k, v in params.items() if k != "chaos"} == {
        k: v for k, v in base.items() if k != "chaos"
    }
    displaced = sorted(
        round(at + d / 100, 2) for at, d in zip(CRASH_POINTS, crash_jitter("1", 10), strict=True)
    )
    assert crash_times(plan_from(params)) == displaced
    assert plan_from(base) == build_plan("C3", "1")
    assert swept.id == "durable-max__t2_conference__C3__s1__crash_jitter_pct-10"


def test_the_jitter_is_in_whole_points_up_to_the_cap() -> None:
    assert "crash_jitter_pct" in KNOBS
    assert matrix(knobs=[{"crash_jitter_pct": 0}, {"crash_jitter_pct": JITTER_MAX_PCT}]).knobs
    for setting in (JITTER_MAX_PCT + 1, 2.5):
        with pytest.raises(ValidationError, match="whole points of progress"):
            matrix(knobs=[{"crash_jitter_pct": setting}])


def test_the_jitter_is_refused_with_a_per_process_probe(tmp_path: Path) -> None:
    path = tmp_path / "m.yaml"
    path.write_text(
        "name: t\nworkflows: [swarm]\ntasks: [t2_conference]\nprofiles: [C0, K-o1]\n"
        "seeds: [1]\nknobs:\n  - {crash_jitter_pct: 5}\nout_dir: out\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="K-o1 sets its own time"):
        Matrix.load(path)


def test_the_jitter_sweep_is_a_matrix_of_its_own_outside_the_preregistered_sweeps() -> None:
    swept = Matrix.load(REPO / "bench" / "matrix-sweep-jitter.yaml")
    assert len(swept.cells()) == 3 * 2 * 4 * 4  # workflows x profiles x seeds x settings
    assert {k for point in swept.knobs or [] for k in point} == {"crash_jitter_pct"}
    assert [dict(point)["crash_jitter_pct"] for point in swept.knobs or []] == [0, 5, 10, 15]
    assert resolve_out_dir(swept, REPO / "bench" / "matrix-sweep-jitter.yaml").parts[-3:] == (
        "results",
        "exploratory",
        "crash_jitter_pct",
    )


# -- the recovery columns --------------------------------------------------------------------


def run_metrics(recovery: RecoveryMetrics | None, cost: float = 1.0) -> RunMetrics:
    zero = dict.fromkeys(
        (
            "input_tokens",
            "output_tokens",
            "total_tokens",
            "llm_calls",
            "llm_errors",
            "cancelled_llm_calls",
            "work_calls",
            "messages",
            "breaker_trips",
            "chaos_events",
            "coordination_tokens",
        ),
        0,
    )
    return RunMetrics(
        run_id="r",
        events=1,
        completed=True,
        valid=True,
        score=1.0,
        makespan_s=60,
        stall_s=0,
        work_window_s=60,
        work_busy_s=60,
        cost_usd=cost,
        recovery=recovery,
        **zero,
    )


def result(profile_name: str, knobs: dict, recovery: RecoveryMetrics | None, cost: float = 1.0):
    suffix = "".join(f"__{name}-{value}" for name, value in sorted(knobs.items()))
    return CellResult(
        cell=f"swarm__t2__{profile_name}__s1{suffix}",
        workflow="swarm",
        task="t2",
        profile=profile_name,
        coordinators_killed=0 if profile_name == "C0" else 5,
        seed="1",
        run_dir="runs/x",
        metrics=run_metrics(recovery, cost),
        knobs=knobs,
    )


def test_a_row_carries_the_recovery_columns_and_a_blank_for_an_old_result() -> None:
    measured = RecoveryMetrics(crashes=5, ttr_own_mean_s=5.5, cdt_s=12.0, dup_usd=0.25)
    rows = aggregate([result("C0", {}, None), result("C3", {}, measured)])
    old, new = rows
    assert set(old) == set(RESULT_COLUMNS) == set(new)
    assert all(old[column] is None for column in RECOVERY_COLUMNS)
    assert (new["crashes"], new["ttr_own_mean_s"], new["cdt_s"], new["dup_usd"]) == (
        5,
        5.5,
        12.0,
        0.25,
    )
    assert new["ttr_drain_mean_s"] is None and new["knobs"] is None
    assert RESULT_COLUMNS[-1] == "run_dir" and RECOVERY_COLUMNS[0] == "crashes"


def test_a_row_is_paired_with_the_c0_twin_that_has_the_same_knobs() -> None:
    results = [
        result("C0", {"agent_latency_scale": 0.5}, None, cost=2.0),
        result("C0", {"agent_latency_scale": 2}, None, cost=1.0),
        result("C3", {"agent_latency_scale": 0.5}, None, cost=3.0),
        result("C3", {"agent_latency_scale": 2}, None, cost=3.0),
    ]
    rows = {row["knobs"] + "/" + row["profile"]: row for row in aggregate(results)}
    assert rows["agent_latency_scale=0.5/C3"]["extra_cost_pct"] == pytest.approx(50.0)
    assert rows["agent_latency_scale=2/C3"]["extra_cost_pct"] == pytest.approx(200.0)


def test_the_recovery_columns_round_trip_through_the_csv(tmp_path: Path) -> None:
    measured = RecoveryMetrics(crashes=3, ttr_own_mean_s=5.25, unnecessary_reassignments=2)
    rows = aggregate(
        [result("C0", {"recovery_ms": 500}, None), result("C3", {"recovery_ms": 500}, measured)]
    )
    csv_path, json_path = write_results(rows, tmp_path)
    back = read_results(csv_path)
    assert back[1]["crashes"] == 3 and back[1]["ttr_own_mean_s"] == 5.25
    assert back[1]["unnecessary_reassignments"] == 2 and back[1]["knobs"] == "recovery_ms=500"
    assert back[0]["crashes"] is None and back[0]["cdt_s"] is None
    assert read_results(json_path) == rows
    assert result_columns(rows) == RESULT_COLUMNS
