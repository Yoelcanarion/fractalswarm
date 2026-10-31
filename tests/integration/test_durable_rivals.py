"""The arena's durable rivals (arena spec §A, backend-design §1), end to end on the fake LLM.

``durable-max`` and ``durable`` are the central baseline with workers that outlive their
coordinator: a crash stops no worker, and what the workers send while it is down is read from
the log at the restart. ``durable-max`` also keeps its own plan and judge calls running through
the crash; ``durable`` loses them with the process and asks again.

Nothing here says which system is better. These are the rules of the two rivals, and the
guard that they keep at least as much work as the process-tree baseline they replace.
"""

import asyncio
import json
from collections import Counter
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fractalswarm.actors.orchestrator import heartbeat_interval_ms
from fractalswarm.actors.swarm import CENTRAL, DURABLE, DURABLE_MAX, PIPELINE, SINGLE, SWARM
from fractalswarm.baselines.durable import DURABLE_MODES
from fractalswarm.baselines.supervisor import RESTART_TAG
from fractalswarm.bench.profiles import RESTART_DELAY_MS, half_the_brains_plan
from fractalswarm.bench.scoring import load_events, score_run
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.cli import app as cli
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan, build_plan, plan_from
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run
from fractalswarm.verify.recovery import analyze as recovery_report
from fractalswarm.verify.recovery import check_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
OWN = ("plan|", "judge|", "scan|")
SYSTEMS = ("swarm", "central", *DURABLE_MODES)


def record(out: Path, scenario: str, chaos: dict, **knobs: int) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    run_dir = out / f"{scenario}-{len(list(out.iterdir()))}"
    params = run_params(spec) | {"chaos": chaos} | knobs
    asyncio.run(
        record_run(
            scenario,
            run_id=run_dir.name,
            run_dir=run_dir,
            backend=fake_backend(),
            seed=spec.seed,
            params=params,
            run_cap_usd=spec.budget_usd,
        )
    )
    return run_dir


def one_crash(at: float) -> dict:
    action = ChaosAction(at=at, kind="kill_coordinator", target="o0")
    return ChaosPlan(profile="one-crash", seed="1", actions=(action,)).model_dump(mode="json")


def of(log: list[Event], event_type: str) -> list[Event]:
    return [e for e in log if e.type == event_type]


def tag_of(event: Event) -> str:
    return event.payload.get("tag") or ""


def outages(log: list[Event]) -> list[tuple[Event, Event, Event]]:
    """Each crash with its restart and the adoption that follows it, in order."""
    return list(
        zip(
            of(log, "baseline.crashed"),
            of(log, "baseline.restarted"),
            of(log, "supervisor.adopted"),
            strict=True,
        )
    )


def during(log: list[Event], crashed: Event, restarted: Event) -> list[Event]:
    return [e for e in log if crashed.seq < e.seq < restarted.seq]


def calls_cancelled(log: list[Event]) -> list[Event]:
    return [e for e in of(log, "effect.cancelled") if e.payload["kind"] != "timer"]


def work_of(tag: str) -> str:
    """The work a lost own call stood for, as a restart names it (goal, or goal/contract)."""
    kind, goal, *rest = tag.split("|")
    return goal if kind == "plan" else f"{goal}/{rest[0]}"


@pytest.fixture(scope="module")
def arena(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    out = tmp_path_factory.mktemp("arena")
    return {mode: record(out, mode, half_the_brains_plan("1")) for mode in SYSTEMS}


@pytest.fixture(scope="module")
def verdict_run(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One crash at 65% of the contracts: results and a judge verdict reach the log meanwhile."""
    return record(tmp_path_factory.mktemp("verdict"), "durable-max", one_crash(0.65))


# -- the arena plan ----------------------------------------------------------------------


def test_the_arena_plan_is_a_valid_chaos_plan_with_five_crashes() -> None:
    raw = half_the_brains_plan("7")
    plan = plan_from({"chaos": raw})
    assert [a.kind for a in plan.actions] == ["kill_coordinator"] * 5
    assert [a.target for a in plan.actions] == ["o0", None, None, None, None]
    assert plan.seed == "7" and plan.api_fault_rate == 0 and plan.net.drop == 0
    assert plan.actions[0].at < plan.actions[-1].at <= 0.8
    assert raw == half_the_brains_plan("7"), "a pure function of the seed"


def test_every_system_runs_the_same_five_crashes_and_finishes(arena: dict[str, Path]) -> None:
    started = {mode: of(load_events(run), "run.started")[0].payload for mode, run in arena.items()}
    assert len({repr(p["params"]) for p in started.values()}) == 1, "one plan, one input"
    assert {p["scenario"] for p in started.values()} == {
        "fractalswarm.actors.swarm:" + name
        for name in ("SWARM", "CENTRAL", "DURABLE_MAX", "DURABLE")
    }
    for mode, run in arena.items():
        log = load_events(run)
        kills = [e for e in of(log, "chaos.injected") if e.payload["fault"] == "kill_coordinator"]
        assert len(kills) == 5 and all(e.payload.get("target") for e in kills), mode
        assert kills[0].payload["target"] == "o0", mode
        if mode != "swarm":
            assert len(of(log, "baseline.crashed")) == len(of(log, "baseline.restarted")) == 5
        result = of(log, "task.result")[0].payload
        assert result["status"] == "ok" and result["report"]["hard_violations"] == 0, mode


# -- workers outlive the coordinator -----------------------------------------------------


def test_no_worker_is_stopped_by_its_coordinators_crash(arena: dict[str, Path]) -> None:
    for mode in DURABLE_MODES:
        stopped = of(load_events(arena[mode]), "actor.stopped")
        assert [e for e in stopped if e.payload["reason"] == "crash"] == [], mode
    # What the rivals change: the process-tree baseline stops every worker at every crash.
    assert any(
        e.payload["reason"] == "crash" for e in of(load_events(arena["central"]), "actor.stopped")
    )


@pytest.mark.parametrize("mode", DURABLE_MODES)
def test_workers_finish_calls_while_the_coordinator_is_down(
    arena: dict[str, Path], mode: str
) -> None:
    log = load_events(arena[mode])
    finished = 0
    for crashed, restarted, _ in outages(log):
        window = during(log, crashed, restarted)
        finished += sum(
            e.type == "effect.completed"
            and e.payload["kind"] == "llm"
            and not tag_of(e).startswith(OWN)
            for e in window
        )
        # The coordinator itself starts no call while it is down.
        started = [e for e in window if e.type == "effect.started" and e.actor == "o0"]
        assert [e for e in started if e.payload["kind"] != "timer"] == []
    assert finished > 0


def test_results_logged_while_the_coordinator_was_down_are_all_consumed(
    arena: dict[str, Path],
) -> None:
    log = load_events(arena["durable-max"])
    adopted_total = 0
    for crashed, restarted, adopted in outages(log):
        logged = {
            f"{e.payload['body']['goal_id']}/{e.payload['body']['contract_id']}"
            for e in during(log, crashed, restarted)
            if e.type == "msg.sent" and e.payload["topic"] == "contract.result"
        }
        assert logged == set(adopted.payload["results"])
        adopted_total += len(logged)
    assert adopted_total > 0, (
        "the plan must put results in an outage for this test to mean anything"
    )


def test_a_live_worker_is_never_reassigned(tmp_path: Path) -> None:
    # Under the full C3 chaos (agent kills too), a contract is retried as lost only when its
    # agent really died: the restart never reassigns work whose worker is alive.
    for mode in DURABLE_MODES:
        log = load_events(record(tmp_path, mode, build_plan("C3", "1").model_dump(mode="json")))
        lost = [e for e in of(log, "contract.rejected") if e.payload["stage"] == "lost"]
        assert lost, f"{mode}: C3 kills agents, so some contract must be lost"
        for e in lost:
            agent = e.payload["reasons"][0].removeprefix("agent ").removesuffix(" was lost")
            stops = [s for s in of(log, "actor.stopped") if s.payload["actor_id"] == agent]
            assert stops and stops[0].seq < e.seq, f"{mode}: {agent} was alive when it was dropped"
            assert stops[0].payload["reason"] != "crash", f"{mode}: a crash stopped {agent}"


# -- durable-max: nothing is lost, nothing is paid twice ---------------------------------


def test_durable_max_cancels_nothing_and_pays_no_call_twice(arena: dict[str, Path]) -> None:
    log = load_events(arena["durable-max"])
    assert calls_cancelled(log) == []
    assert all(crashed.payload["lost"] == [] for crashed, _, _ in outages(log))
    started = Counter(
        (e.actor, tag_of(e))
        for e in of(log, "effect.started")
        if e.payload["kind"] in ("llm", "firewall")
    )
    assert {key: n for key, n in started.items() if n > 1} == {}


def test_the_checks_details_read_as_sentences(arena: dict[str, Path]) -> None:
    # A viewer reads them in the arena's proof tooltip, so no "crash(es)".
    details = {check.name: check.detail for check in check_run(arena["durable-max"]).checks}
    assert details["restarted"] == "5 crashes, 5 restarted"
    assert not any("(s)" in detail or "(es)" in detail for detail in details.values())


def test_durable_max_waits_for_its_own_calls_in_flight(arena: dict[str, Path]) -> None:
    log = load_events(arena["durable-max"])
    waited = [
        tag
        for _, _, adopted in outages(log)
        for tag in adopted.payload["waiting"]
        if tag.startswith(OWN)
    ]
    adopted_plans = sum(len(adopted.payload["plans"]) for _, _, adopted in outages(log))
    assert waited or adopted_plans, "the plan must catch a plan call in an outage"
    assert all(restarted.payload["redo"] == [] for _, restarted, _ in outages(log))


def test_a_verdict_logged_while_down_is_reused_and_not_asked_again(verdict_run: Path) -> None:
    log = load_events(verdict_run)
    ((crashed, restarted, adopted),) = outages(log)
    verdicts = [
        tag_of(e)
        for e in during(log, crashed, restarted)
        if e.type == "effect.completed" and tag_of(e).startswith("judge|")
    ]
    work = {work_of(tag) for tag in verdicts}
    assert work and work == set(adopted.payload["verdicts"])
    reused = {
        f"{e.payload['goal_id']}/{e.payload['contract_id']}"
        for e in of(log, "verify.judged")
        if e.payload.get("reused")
    }
    assert reused == work
    asked = Counter(tag_of(e) for e in of(log, "effect.started"))
    assert [tag for tag in verdicts if asked[tag] != 1] == []
    assert len(adopted.payload["results"]) >= 1
    assert restarted.payload["redo"] == []


# -- durable: its own calls are lost with the process ------------------------------------


def test_durable_cancels_exactly_its_own_calls_in_flight_and_asks_again(
    arena: dict[str, Path],
) -> None:
    log = load_events(arena["durable"])
    lost_total = 0
    for crashed, restarted, _ in outages(log):
        cancelled = {tag_of(e) for e in calls_cancelled(during(log, crashed, restarted))}
        assert cancelled == set(crashed.payload["lost"])
        assert all(tag.startswith(OWN) for tag in cancelled), "workers' calls are never cancelled"
        assert {work_of(tag) for tag in cancelled} <= set(restarted.payload["redo"])
        for tag in cancelled:
            again = [
                e for e in of(log, "effect.started") if tag_of(e) == tag and e.seq > restarted.seq
            ]
            assert again, f"{tag} was not asked again after the restart"
        lost_total += len(cancelled)
    assert lost_total > 0


# -- the restart timer and the guard against the process-tree baseline -------------------


def test_the_restart_takes_5_s_unless_a_sweep_says_otherwise(arena: dict[str, Path]) -> None:
    for mode in DURABLE_MODES:
        log = load_events(arena[mode])
        for crashed, _, _ in outages(log):
            assert crashed.payload["restart_in_ms"] == RESTART_DELAY_MS
            timer = next(
                e
                for e in of(log, "effect.completed")
                if tag_of(e) == RESTART_TAG and e.seq > crashed.seq
            )
            assert timer.ts_virtual - crashed.ts_virtual == RESTART_DELAY_MS


def test_the_durable_modes_keep_at_least_as_much_work_as_the_process_tree_baseline(
    arena: dict[str, Path],
) -> None:
    kept = {mode: score_run(arena[mode]) for mode in ("central", *DURABLE_MODES)}
    assert (
        kept["durable-max"].cancelled_llm_calls
        <= kept["durable"].cancelled_llm_calls
        <= kept["central"].cancelled_llm_calls
    )
    assert kept["durable-max"].llm_calls <= kept["durable"].llm_calls <= kept["central"].llm_calls


@pytest.mark.parametrize("mode", DURABLE_MODES)
async def test_a_durable_run_replays_bit_for_bit(arena: dict[str, Path], mode: str) -> None:
    report = await replay_run(arena[mode])
    assert report.ok, report.detail


# -- a sweep's knobs ---------------------------------------------------------------------


def test_the_knobs_are_left_out_of_a_default_run() -> None:
    for scenario in (SWARM, CENTRAL, SINGLE, PIPELINE, DURABLE_MAX, DURABLE):
        assert scenario.sweep_knobs({}) == {}
        assert scenario.sweep_knobs({"rival_restart_ms": None}) == {}


def test_recovery_ms_sets_the_swarms_detection_and_the_supervisors_restart() -> None:
    assert SWARM.sweep_knobs({"recovery_ms": 1000}) == {"detect_ms": 1000}
    for scenario in (CENTRAL, SINGLE, PIPELINE, DURABLE_MAX, DURABLE):
        assert scenario.sweep_knobs({"recovery_ms": 1000}) == {"restart_ms": 1000}


def test_the_rival_knobs_move_the_supervisors_only() -> None:
    params = {"recovery_ms": 1000, "rival_recovery_ms": 2000, "rival_restart_ms": 500}
    assert SWARM.sweep_knobs(params) == {"detect_ms": 1000}
    assert DURABLE_MAX.sweep_knobs(params) == {"restart_ms": 2500}
    assert DURABLE.sweep_knobs({"recovery_ms": 1000, "rival_restart_ms": 500}) == {
        "restart_ms": 1500
    }
    assert DURABLE.sweep_knobs({"rival_restart_ms": 500}) == {"restart_ms": RESTART_DELAY_MS + 500}
    assert SWARM.sweep_knobs({"rival_recovery_ms": 2000, "rival_restart_ms": 500}) == {}


def test_a_detection_time_the_heartbeat_cannot_scale_to_is_refused_not_clamped() -> None:
    assert [heartbeat_interval_ms(ms) for ms in (5000, 1000, 500, 50)] == [1000, 200, 100, 10]
    for ms in (502, 40, 0, -1000):
        with pytest.raises(ValueError, match="detection time"):
            heartbeat_interval_ms(ms)
    with pytest.raises(ValueError, match="detection time"):
        SWARM.sweep_knobs({"recovery_ms": 40})
    with pytest.raises(ValueError, match="negative"):
        DURABLE.sweep_knobs({"rival_recovery_ms": -1})


def test_a_supervisor_restarts_after_the_time_the_sweep_gives_it(tmp_path: Path) -> None:
    run = record(tmp_path, "durable-max", one_crash(0.5), recovery_ms=1000, rival_restart_ms=250)
    log = load_events(run)
    ((crashed, restarted, _),) = outages(log)
    assert crashed.payload["restart_in_ms"] == 1250
    assert restarted.ts_virtual - crashed.ts_virtual == 1250


def test_the_swarm_declares_a_dead_member_dead_within_the_detection_time_it_is_given(
    tmp_path: Path,
) -> None:
    run = record(tmp_path, "swarm", half_the_brains_plan("1"), recovery_ms=2000)
    log = load_events(run)
    kills = {
        e.payload["target"]: e
        for e in of(log, "chaos.injected")
        if e.payload["fault"] == "kill_coordinator"
    }
    deaths = of(log, "member.dead")
    assert {d.payload["member"] for d in deaths} == set(kills), "no false death, none missed"
    for death in deaths:  # 5 missed beats of 400 ms, at most one beat late
        delay = death.ts_virtual - kills[death.payload["member"]].ts_virtual
        assert 1000 <= delay <= 2400, (death.payload["member"], delay)
    spawned = [e for e in of(log, "actor.spawned") if e.payload["actor_id"] == "o0"]
    assert spawned[0].payload["args"]["detect_ms"] == 2000


# -- the recovery check reads these runs -------------------------------------------------

CHECKS_THAT_APPLY = {
    "swarm": {"no_repeat"},
    "central": {"restarted", "quiet", "no_repeat"},
    "durable-max": {"restarted", "quiet", "consumed", "own_calls", "no_repeat"},
    "durable": {"restarted", "quiet", "consumed", "own_calls", "no_repeat"},
}


def violations(events: list[Event], check: str) -> list[str]:
    """The kinds of violation ``fractalswarm recovery`` finds in a (tampered) log."""
    report = recovery_report(events)
    return [v.kind for c in report.checks if c.name == check for v in c.violations]


def without(events: list[Event], dropped: Event) -> list[Event]:
    return [e for e in events if e.seq != dropped.seq]


def test_the_recovery_check_holds_on_every_system_and_applies_what_each_one_promises(
    arena: dict[str, Path],
) -> None:
    for mode, run in arena.items():
        report = check_run(run)
        assert report.system == mode and report.supervised == (mode != "swarm"), mode
        assert {c.name for c in report.checks if c.applies} == CHECKS_THAT_APPLY[mode], mode
        assert report.ok, (mode, [v.detail for c in report.checks for v in c.violations])
        assert report.metrics.crashes == 5 and len(report.metrics.outages) == 5, mode


@pytest.mark.parametrize("mode", DURABLE_MODES)
def test_the_recovery_check_reports_each_restart_it_finds(
    arena: dict[str, Path], mode: str
) -> None:
    report = check_run(arena[mode])
    assert [r.crash for r in report.restarts] == [1, 2, 3, 4, 5]
    assert all(r.down_s == r.announced_s == RESTART_DELAY_MS / 1000 for r in report.restarts)
    assert all(r.workers_stopped == 0 for r in report.restarts)
    assert sum(r.results_logged for r in report.restarts) > 0
    assert all(r.results_consumed == r.results_logged for r in report.restarts)
    in_flight = sum(r.own_in_flight for r in report.restarts)
    cancelled = sum(r.own_cancelled for r in report.restarts)
    assert in_flight > 0 and cancelled == (in_flight if mode == "durable" else 0)


def test_the_process_tree_restart_respawns_the_workers_it_stopped(arena: dict[str, Path]) -> None:
    report = check_run(arena["central"])
    assert [r.workers_stopped for r in report.restarts] == [12] * 5
    assert report.ok, "the respawn after the restart timer is not the coordinator's doing"


def test_a_coordinator_that_acts_while_down_is_caught(arena: dict[str, Path]) -> None:
    log = load_events(arena["durable-max"])
    crashed, restarted, _ = outages(log)[0]
    sent = next(e for e in during(log, crashed, restarted) if e.type == "msg.sent")
    forged = [e.model_copy(update={"actor": "o0"}) if e.seq == sent.seq else e for e in log]
    assert violations(forged, "quiet") == ["authored-while-down"]
    assert violations(log, "quiet") == []


def test_a_result_logged_while_down_that_is_never_consumed_is_caught(
    arena: dict[str, Path],
) -> None:
    log = load_events(arena["durable-max"])
    crashed, restarted, adopted = next(o for o in outages(log) if o[2].payload["results"])
    result = next(
        e
        for e in during(log, crashed, restarted)
        if e.type == "msg.sent" and e.payload["topic"] == "contract.result"
    )
    body = result.payload["body"]
    consumed = next(
        e
        for e in of(log, "contract.completed")
        if e.seq > restarted.seq
        and (e.payload["goal_id"], e.payload["contract_id"], e.payload["attempt"])
        == (body["goal_id"], body["contract_id"], body["attempt"])
    )
    assert violations(without(log, consumed), "consumed") == ["result-not-consumed"]
    unnamed = adopted.model_copy(update={"payload": adopted.payload | {"results": []}})
    swapped = [unnamed if e.seq == adopted.seq else e for e in log]
    assert set(violations(swapped, "consumed")) == {"adoption-mismatch"}


def test_a_durable_max_that_loses_an_own_call_is_caught(arena: dict[str, Path]) -> None:
    # The durable log, told it is a durable-max: its cancelled plan and judge calls are a fault.
    log = load_events(arena["durable"])
    started = of(log, "run.started")[0]
    payload = started.payload | {"scenario": "fractalswarm.actors.swarm:DURABLE_MAX"}
    claimed = [
        e.model_copy(update={"payload": payload}) if e.seq == started.seq else e for e in log
    ]
    found = violations(claimed, "own_calls")
    assert found and set(found) == {"own-call-cancelled"}
    assert violations(log, "own_calls") == []


def test_a_durable_that_keeps_an_own_call_it_should_have_lost_is_caught(
    arena: dict[str, Path],
) -> None:
    log = load_events(arena["durable"])
    cancelled = next(
        e for e in of(log, "effect.cancelled") if e.actor == "o0" and e.payload["kind"] != "timer"
    )
    # The call it kept stays in flight in the log, so every later crash sees it as well.
    found = violations(without(log, cancelled), "own_calls")
    assert found and set(found) == {"own-calls-mismatch"}


def test_an_attempt_dispatched_twice_is_caught_in_a_swarm_log_too(arena: dict[str, Path]) -> None:
    for mode in ("swarm", "durable-max"):
        log = load_events(arena[mode])
        sent = of(log, "contract.dispatched")[0]
        again = sent.model_copy(update={"seq": log[-1].seq + 1, "idem_key": "again"})
        assert "contract-redispatched" in violations([*log, again], "no_repeat"), mode
        assert violations(log, "no_repeat") == [], mode


def test_a_crash_with_no_restart_in_the_log_is_caught(arena: dict[str, Path]) -> None:
    log = load_events(arena["durable"])
    last = of(log, "baseline.restarted")[-1]
    assert violations(without(log, last), "restarted") == ["no-restart"]


def test_the_commands_send_a_supervisor_log_to_recovery(arena: dict[str, Path], tmp_path) -> None:
    runner = CliRunner()
    for mode in ("central", *DURABLE_MODES):
        told = runner.invoke(cli, ["takeover", str(arena[mode])])
        assert told.exit_code == 2, mode
        assert "supervisor log: use `fractalswarm recovery" in told.output, mode
        assert "VIOLATION" not in told.output, mode
        shown = runner.invoke(cli, ["recovery", str(arena[mode]), "--json", str(tmp_path / mode)])
        assert shown.exit_code == 0 and "RECOVERY OK" in shown.output, shown.output
        saved = json.loads((tmp_path / mode).read_text(encoding="utf-8"))
        assert saved["system"] == mode and saved["ok"] is True
        assert [c["name"] for c in saved["checks"]][0] == "restarted"
    kills = runner.invoke(cli, ["takeover", str(arena["swarm"])])
    assert kills.exit_code == 0, kills.output  # a swarm log is still read by takeover
