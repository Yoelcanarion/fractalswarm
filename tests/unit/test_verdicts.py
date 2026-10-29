"""The verdict tool (``bench/verdicts.py``) against the rules of ``bench/PREREG.md``, on synthetic
rows with hand-computed answers. Nothing here asserts that the swarm beats a rival: the rows say
what they say, and the tests check that the rules read them as written."""

import json
from pathlib import Path
from typing import Any

import pytest

from fractalswarm.bench.harness import CellResult
from fractalswarm.bench.recovery import RecoveryMetrics
from fractalswarm.bench.scoring import RunMetrics
from fractalswarm.bench.verdicts import (
    HYPOTHESIS,
    PLAUSIBLE,
    RULES,
    Honesty,
    Regime,
    combine,
    compare,
    decide,
    evaluate,
    judge,
    level_of,
    locality,
    parse_knobs,
    prereg_sha,
    read_ratio,
    render_text,
    value,
    verdicts,
    write_json,
)

T2 = "t2_conference"


# -- one seed (PREREG §3) --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("key", "swarm", "rival", "expected"),
    [
        ("stall_s", 10, 13, "win"),  # 3 s better: the minimum effect
        ("stall_s", 10, 12.9, "tie"),
        ("stall_s", 13, 10, "loss"),
        ("extra_cost_pct", 5, 10, "win"),
        ("extra_cost_pct", 10, 14.9, "tie"),
        ("ttr_own_mean_s", 5.0, 6.0, "win"),
        ("ttr_own_mean_s", 6.5, 5.0, "loss"),
        ("ttr_own_mean_s", 5.4, 5.0, "tie"),
        ("unnecessary_reassignments", 0, 1, "win"),
        ("unnecessary_reassignments", 2, 0, "loss"),
        ("preserved_pct", 100, 85, "win"),  # higher is better
        ("preserved_pct", 85, 100, "loss"),
        ("preserved_pct", 90, 95, "tie"),
        ("cdt_s", 2, 10, "win"),  # half or less, the rival above the floor
        ("cdt_s", 5, 10, "win"),
        ("cdt_s", 6, 10, "tie"),
        ("cdt_s", 10, 2, "loss"),
        ("cdt_s", 0.2, 0.9, "tie"),  # both under the floor of one contract-second
        ("cdt_s", 0, 3, "win"),
        ("cdt_s", 3, 0, "loss"),
        ("blast_sessions_mean_pct", 16.7, 100, "win"),
        ("blast_sessions_mean_pct", 2, 4, "tie"),  # under the floor of five points
        ("idle_agent_s", 20, 8, "loss"),
    ],
)
def test_one_seed_is_judged_by_the_rule_of_its_metric(
    key: str, swarm: float, rival: float, expected: str
) -> None:
    assert judge(RULES[key], swarm, rival) == expected


def test_the_minimum_effects_are_the_preregistered_ones() -> None:
    assert {k: r.minimum for k, r in RULES.items() if r.kind == "difference"} == {
        "stall_s": 3.0,
        "extra_cost_pct": 5.0,
        "ttr_own_mean_s": 1.0,
        "dup_chaos_pct": 5.0,
        "unnecessary_reassignments": 1.0,
        "preserved_pct": 10.0,
    }
    ratios = {k: (r.minimum, r.floor) for k, r in RULES.items() if r.kind == "ratio"}
    assert ratios == {
        "cdt_s": (0.5, 1.0),
        "blast_sessions_mean_pct": (0.5, 5.0),
        "blast_agents_mean_pct": (0.5, 5.0),
        "idle_agent_s": (0.5, 1.0),
    }
    assert [h.metric for h in HYPOTHESIS.values() if h.id.startswith("H4")] == [
        "cdt_s",
        "blast_sessions_mean_pct",
        "idle_agent_s",
    ]


# -- the seeds together ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("outcomes", "expected"),
    [
        ([], ("n/a", False)),
        (["win", "win", "win"], ("win", False)),
        (["loss", "loss"], ("loss", False)),
        (["tie", "tie"], ("tie", False)),
        (["win", "tie"], ("tie", True)),  # one seed short of the effect: a tie, marked mixed
        (["win", "loss"], ("tie", True)),
        (["win"], ("win", False)),
    ],
)
def test_a_result_is_a_tie_unless_every_seed_agrees(
    outcomes: list[str], expected: tuple[str, bool]
) -> None:
    assert combine(outcomes) == expected


# -- the values a row gives ------------------------------------------------------------------


def row(workflow: str, profile: str = "C3", seed: str = "1", **values: Any) -> dict[str, Any]:
    base = {
        "workflow": workflow,
        "task": T2,
        "profile": profile,
        "seed": seed,
        "completed": True,
        "valid": True,
        "agents": None,
        "knobs": None,
        "crashes": 5,
        "stall_s": 0.0,
        "cost_usd": 0.3,
        "extra_cost_pct": 0.0,
        "ttr_own_mean_s": 5.0,
        "cdt_s": 0.0,
        "blast_sessions_mean_pct": 0.0,
        "blast_agents_mean_pct": 0.0,
        "idle_agent_s": 0.0,
        "unnecessary_reassignments": 0,
        "dup_crash_usd": 0.0,
        "dup_false_death_usd": 0.0,
        "preserved_pct": 100.0,
    }
    return base | values


def test_spend_duplicated_by_failures_is_read_as_points_of_the_c0_cost() -> None:
    r = row(
        "swarm", cost_usd=0.5, extra_cost_pct=25.0, dup_crash_usd=0.01, dup_false_death_usd=0.01
    )
    assert value(r, "dup_chaos_pct") == pytest.approx(5.0)  # 0.02 of a C0 cost of 0.40
    assert value(row("swarm", extra_cost_pct=None), "dup_chaos_pct") is None  # no C0 twin


def test_a_run_that_logged_no_crash_has_no_per_crash_value() -> None:
    quiet = row("swarm", crashes=0, cdt_s=0.0, stall_s=2.0, extra_cost_pct=1.0)
    assert value(quiet, "cdt_s") is None and value(quiet, "preserved_pct") is None
    assert value(quiet, "stall_s") == 2.0 and value(quiet, "extra_cost_pct") == 1.0
    assert value(row("swarm", crashes=None), "cdt_s") is None  # a result scored before the arena


# -- one comparison --------------------------------------------------------------------------

POINT = ("gate", T2, "C3", None, None, "", None)


def seeds(workflow: str, **by_seed: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {seed: row(workflow, seed=seed, **values) for seed, values in by_seed.items()}


def test_a_comparison_pairs_the_seeds_and_takes_the_mean_of_each_side() -> None:
    swarm = seeds("swarm", **{"1": {"cdt_s": 4.0}, "2": {"cdt_s": 6.0}, "3": {"cdt_s": 2.0}})
    rival = seeds("durable-max", **{"1": {"cdt_s": 20.0}, "2": {"cdt_s": 30.0}})
    c = compare(HYPOTHESIS["H4a"], "durable-max", POINT, swarm, rival)
    assert c.seeds == ["1", "2"]  # seed 3 has no partner
    assert (c.swarm, c.rival_value) == (5.0, 25.0)
    assert (c.ratio, c.difference, c.verdict, c.mixed) == (0.2, 20.0, "win", False)


def test_one_seed_short_of_the_effect_makes_the_result_a_tie() -> None:
    swarm = seeds("swarm", **{"1": {"cdt_s": 4.0}, "2": {"cdt_s": 6.0}})
    rival = seeds("durable-max", **{"1": {"cdt_s": 20.0}, "2": {"cdt_s": 9.0}})
    c = compare(HYPOTHESIS["H4a"], "durable-max", POINT, swarm, rival)
    assert (c.verdict, c.mixed) == ("tie", True)


def test_a_loss_is_reported_as_a_loss() -> None:
    swarm = seeds("swarm", **{"1": {"ttr_own_mean_s": 6.5}, "2": {"ttr_own_mean_s": 7.0}})
    rival = seeds("durable", **{"1": {"ttr_own_mean_s": 5.0}, "2": {"ttr_own_mean_s": 5.0}})
    c = compare(HYPOTHESIS["H3"], "durable", POINT, swarm, rival)
    assert (c.verdict, c.difference) == ("loss", pytest.approx(-1.75))


def test_a_seed_without_a_crash_is_left_out_and_none_left_is_not_applicable() -> None:
    swarm = seeds("swarm", **{"1": {"cdt_s": 1.0}, "2": {"crashes": 0}})
    rival = seeds("durable-max", **{"1": {"cdt_s": 9.0}, "2": {"cdt_s": 9.0}})
    c = compare(HYPOTHESIS["H4a"], "durable-max", POINT, swarm, rival)
    assert (c.seeds, c.verdict) == (["1"], "win")
    none = compare(HYPOTHESIS["H4a"], "durable-max", POINT, {"2": swarm["2"]}, {"2": rival["2"]})
    assert (none.seeds, none.verdict, none.swarm) == ([], "n/a", None)


def test_a_run_that_did_not_complete_makes_the_comparison_incomplete() -> None:
    swarm = seeds("swarm", **{"1": {"cdt_s": 1.0}, "2": {"cdt_s": 1.0, "completed": False}})
    rival = seeds("durable-max", **{"1": {"cdt_s": 9.0}, "2": {"cdt_s": 9.0}})
    assert compare(HYPOTHESIS["H4a"], "durable-max", POINT, swarm, rival).verdict == "incomplete"


# -- locality and the outcome ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("a", "b", "c", "expected"),
    [
        ("win", "win", "win", "holds"),
        ("win", "win", "tie", "holds"),
        ("win", "win", "loss", "ties"),  # idle is a loss: it does not hold, and it does not fail
        ("win", "tie", "win", "ties"),
        ("tie", "tie", "tie", "ties"),
        ("loss", "win", "win", "fails"),
        ("win", "loss", "tie", "fails"),
        ("loss", "n/a", "win", "fails"),  # a loss decides it, whatever the other has
        ("n/a", "loss", "tie", "fails"),
        ("n/a", "win", "win", "n/a"),
        ("win", "incomplete", "win", "n/a"),
    ],
)
def test_locality_holds_fails_or_ties(a: str, b: str, c: str, expected: str) -> None:
    assert locality(a, b, c) == expected  # type: ignore[arg-type]


def regime(locality_: str, axis: str | None = None, setting: float | None = None, **kw) -> Regime:
    base = {
        "source": "s",
        "axis": axis,
        "value": setting,
        "plausible": axis in PLAUSIBLE and setting in PLAUSIBLE[axis],
        "task": T2,
        "profile": "C3",
        "rival": "durable-max",
        "locality": locality_,
        "cdt_ratio": 0.1,
        "blast_ratio": 0.2,
        "idle_ratio": 0.3,
    }
    return Regime(**(base | kw))


def test_the_plausible_region_is_the_one_prereg_fixes() -> None:
    assert PLAUSIBLE == {
        "recovery_ms": (1000, 2000, 2500, 5000, 10000),
        "rival_restart_ms": (0, 1000, 3000),
        "rival_recovery_ms": (500, 1000),  # a hot standby restarted at once is plausible
    }


def full_region(locality_: str = "holds") -> list[Regime]:
    gate = [regime(locality_, profile=p) for p in ("C2", "C3")]
    swept = [regime(locality_, axis, v) for axis, vs in PLAUSIBLE.items() for v in vs]
    return gate + swept


def test_outcome_a_needs_locality_at_the_gate_and_at_every_plausible_point() -> None:
    outcome = decide(full_region())
    assert outcome.label == "A" and outcome.against == "durable-max" and not outcome.conditions
    assert {(g["profile"], g["locality"]) for g in outcome.gate} == {
        ("C2", "holds"),
        ("C3", "holds"),
    }


def test_one_plausible_point_that_ties_makes_it_outcome_b_with_the_condition() -> None:
    region = [r for r in full_region() if (r.axis, r.value) != ("rival_recovery_ms", 1000)]
    region.append(regime("ties", "rival_recovery_ms", 1000))
    outcome = decide(region)
    assert outcome.label == "B"
    assert outcome.conditions == ["locality ties at rival_recovery_ms=1000 (t2_conference, C3)"]


def test_a_failing_gate_makes_it_outcome_b() -> None:
    region = [r for r in full_region() if r.axis is not None] + [
        regime("holds", profile="C2"),
        regime("fails", profile="C3"),
    ]
    outcome = decide(region)
    assert outcome.label == "B" and outcome.conditions == [
        "locality fails at gate (t2_conference, C3)"
    ]


def test_points_outside_the_plausible_region_scope_the_claim_but_do_not_decide_it() -> None:
    extra = [
        regime("ties", "recovery_ms", 500),
        regime("fails", "agent_latency_scale", 0.25),
        regime("holds", "agents", 48),
    ]
    outcome = decide(full_region() + extra)
    assert outcome.label == "A"
    assert outcome.conditions == [
        "locality ties at recovery_ms=500 (t2_conference, C3), outside the plausible region",
        "locality fails at agent_latency_scale=0.25 (t2_conference, C3), "
        "outside the plausible region",
    ]


def test_the_half_second_hot_standby_is_a_point_the_outcome_needs() -> None:
    outcome = decide([r for r in full_region() if (r.axis, r.value) != ("rival_recovery_ms", 500)])
    assert outcome.label == "pending"
    assert any("rival_recovery_ms=500" in c for c in outcome.conditions)
    tied = [r for r in full_region() if (r.axis, r.value) != ("rival_recovery_ms", 500)]
    tied.append(regime("ties", "rival_recovery_ms", 500))
    assert decide(tied).label == "B"


def test_the_outcome_is_pending_while_a_point_it_needs_has_no_data() -> None:
    outcome = decide([r for r in full_region() if r.axis != "rival_restart_ms"])
    assert outcome.label == "pending"
    assert outcome.conditions[0] == (
        "no data for rival_restart_ms=0, rival_restart_ms=1000, rival_restart_ms=3000"
    )
    assert decide([]).label == "pending"


def test_only_the_deciding_rival_and_task_decide() -> None:
    other = [r.model_copy(update={"locality": "fails", "rival": "durable"}) for r in full_region()]
    assert decide(full_region() + other).label == "A"
    t1 = [
        r.model_copy(update={"locality": "fails", "task": "t1_extraction"}) for r in full_region()
    ]
    assert decide(full_region() + t1).label == "A"


# -- the whole tool on rows ------------------------------------------------------------------


def gate_rows(seed_list: tuple[str, ...] = ("1", "2")) -> list[dict[str, Any]]:
    """Swarm and durable-max at the gate: the swarm waits a fifth as long as the supervisor."""
    rows = []
    for seed in seed_list:
        for profile in ("C0", "C2", "C3"):
            crashes = 0 if profile == "C0" else 3
            rows.append(
                row(
                    "swarm",
                    profile,
                    seed,
                    crashes=crashes,
                    cdt_s=2.0,
                    blast_sessions_mean_pct=20.0,
                    idle_agent_s=5.0,
                )
            )
            rows.append(
                row(
                    "durable-max",
                    profile,
                    seed,
                    crashes=crashes,
                    cdt_s=10.0,
                    blast_sessions_mean_pct=100.0,
                    idle_agent_s=40.0,
                )
            )
    return rows


def test_the_tool_reads_a_gate_into_verdicts_a_regime_and_a_tally() -> None:
    honesty = evaluate([("gate", gate_rows())])
    assert {(r.profile, r.locality) for r in honesty.regimes} == {("C2", "holds"), ("C3", "holds")}
    h4a = next(b for b in honesty.hypotheses if b.id == "H4a")
    assert h4a.tally["durable-max"].win == 2 and h4a.tally["durable-max"].tie == 0
    assert h4a.tally["durable"].win == 0  # no such rival in these rows: nothing counted
    ties = next(b for b in honesty.hypotheses if b.id == "H2").tally["durable-max"]
    assert (ties.win, ties.tie, ties.loss) == (0, 2, 0)  # equal extra cost: a tie, reported
    assert honesty.outcome.label == "pending"  # no sweep yet: the plausible region has no data
    assert len(honesty.comparisons) == 2 * len(HYPOTHESIS)
    first = honesty.comparisons[0]
    assert (first.profile, first.rival) == ("C2", "durable-max")


def test_the_c0_rows_are_never_compared() -> None:
    honesty = evaluate([("gate", gate_rows())])
    assert {c.profile for c in honesty.comparisons} == {"C2", "C3"}


def sweep_rows(axis: str, settings: list[float], swarm_cdt: float = 2.0) -> list[dict[str, Any]]:
    rows = []
    for setting in settings:
        knobs = f"{axis}={setting:g}"
        for seed in ("1", "2", "3"):
            rows.append(
                row(
                    "swarm",
                    "C3",
                    seed,
                    knobs=knobs,
                    cdt_s=swarm_cdt,
                    blast_sessions_mean_pct=20.0,
                    idle_agent_s=5.0,
                )
            )
            rows.append(
                row(
                    "durable-max",
                    "C3",
                    seed,
                    knobs=knobs,
                    cdt_s=10.0,
                    blast_sessions_mean_pct=100.0,
                    idle_agent_s=40.0,
                )
            )
    return rows


def test_a_full_region_that_holds_gives_outcome_a() -> None:
    sources = [("gate", gate_rows())]
    sources += [(axis, sweep_rows(axis, list(vs))) for axis, vs in PLAUSIBLE.items()]
    honesty = evaluate(sources)
    assert honesty.outcome.label == "A" and honesty.outcome.conditions == []
    assert [r for r in honesty.regimes if r.axis == "recovery_ms"][0].plausible
    assert all(r.locality == "holds" for r in honesty.regimes)


def test_a_slow_swarm_at_one_setting_is_outcome_b_and_says_where() -> None:
    sources = [("gate", gate_rows())]
    sources += [
        (axis, sweep_rows(axis, list(vs)))
        for axis, vs in PLAUSIBLE.items()
        if axis != "recovery_ms"
    ]
    sources.append(
        (
            "recovery_ms",
            sweep_rows("recovery_ms", [1000, 2000, 2500, 5000], 2.0)
            + sweep_rows("recovery_ms", [10000], 8.0),
        )
    )
    honesty = evaluate(sources)
    assert honesty.outcome.label == "B"
    assert honesty.outcome.conditions == ["locality ties at recovery_ms=10000 (t2_conference, C3)"]


# -- the per-process view --------------------------------------------------------------------


def probe(workflow: str, target: str, cdt: float, seed: str = "1", crashes: int = 1) -> dict:
    return row(
        workflow,
        f"K-{target}",
        seed,
        crashes=crashes,
        cdt_s=cdt,
        idle_agent_s=cdt / 2,
        ttr_own_mean_s=5.0,
        blast_agents_mean_pct=10.0,
    )


def probes(root: float, tracks: float, sessions: float, rival: float) -> list[dict]:
    rows = [probe("swarm", "o0", root)]
    rows += [probe("swarm", t, tracks) for t in ("o1", "o2", "o3")]
    rows += [probe("swarm", t, sessions) for t in ("o1.1", "o1.2", "o2.1", "o2.2", "o3.1", "o3.2")]
    rows += [probe(w, "o0", rival) for w in ("durable-max", "durable")]
    return rows


def test_the_levels_of_the_tree_are_counted_by_the_swarms_coordinators() -> None:
    assert [level_of(t) for t in ("o0", "o2", "o1.1", "o3.2")] == [0, 1, 2, 2]
    view = evaluate([("per-process", probes(10, 6, 2, 40))]).per_process[0]
    assert [(lv.level, lv.count, lv.runs, lv.skipped) for lv in view.swarm_levels] == [
        (0, 1, 1, 0),
        (1, 3, 3, 0),
        (2, 6, 6, 0),
    ]
    assert view.swarm_expected["cdt_s"] == pytest.approx(10 + 3 * 6 + 6 * 2)  # 40
    assert view.rivals["durable-max"]["cdt_s"] == 40.0
    assert view.ratio["durable-max"]["cdt_s"] == pytest.approx(1.0)
    assert view.reading["durable-max"]["cdt_s"] == "comparable"


def test_ten_coordinators_can_overtake_one_supervisor_per_process() -> None:
    view = evaluate([("per-process", probes(10, 6, 2, 12))]).per_process[0]
    assert view.ratio["durable"]["cdt_s"] == pytest.approx(40 / 12)
    assert view.reading["durable"]["cdt_s"] == "rival lower"
    assert (
        view.reading["durable"]["ttr_own_mean_s"] == "rival lower"
    )  # 10 crashes of 5 s against one


def test_a_local_swarm_can_stay_ahead_per_process() -> None:
    view = evaluate([("per-process", probes(10, 4, 1, 100))]).per_process[0]
    assert view.swarm_expected["cdt_s"] == pytest.approx(10 + 12 + 6)
    assert view.reading["durable-max"]["cdt_s"] == "swarm lower"


def test_a_probe_that_found_nothing_to_crash_is_counted_and_left_out() -> None:
    rows = probes(10, 6, 2, 40)
    rows.append(probe("swarm", "o1.1", 0.0, seed="2", crashes=0))
    view = evaluate([("per-process", rows)]).per_process[0]
    level2 = view.swarm_levels[2]
    assert (level2.runs, level2.skipped) == (6, 1)
    assert level2.impact["cdt_s"] == 2.0  # the skipped run does not drag the mean down


def test_a_missing_level_leaves_the_expected_impact_unknown() -> None:
    view = evaluate([("per-process", probes(10, 6, 2, 40)[:4])]).per_process[0]
    assert view.swarm_expected["cdt_s"] is None
    assert view.reading == {}  # no rival probes either, in these rows


@pytest.mark.parametrize(
    ("swarm", "rival", "expected"),
    [
        (4, 10, "swarm lower"),
        (5, 10, "swarm lower"),
        (6, 10, "comparable"),
        (19, 10, "comparable"),
        (20, 10, "rival lower"),
        (0, 0, "comparable"),
        (3, 0, "rival lower"),
        (None, 5, "n/a"),
    ],
)
def test_the_per_process_ratio_reads_as_the_preregistration_says(
    swarm: float | None, rival: float, expected: str
) -> None:
    assert read_ratio(swarm, rival) == expected


# -- files -----------------------------------------------------------------------------------


def write_cell(out: Path, workflow: str, profile: str, seed: str, **recovery) -> None:
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
    metrics = RunMetrics(
        run_id="r",
        events=1,
        completed=True,
        valid=True,
        score=1.0,
        makespan_s=60,
        stall_s=0,
        work_window_s=60,
        work_busy_s=60,
        cost_usd=0.3,
        recovery=RecoveryMetrics(**recovery),
        **zero,
    )
    result = CellResult(
        cell=f"{workflow}__{T2}__{profile}__s{seed}",
        workflow=workflow,
        task=T2,
        profile=profile,
        coordinators_killed=0 if profile == "C0" else 5,
        seed=seed,
        run_dir="runs/x",
        metrics=metrics,
    )
    (out / "cells").mkdir(parents=True, exist_ok=True)
    (out / "cells" / f"{result.cell}.json").write_text(result.model_dump_json(), encoding="utf-8")


def test_the_tool_reads_results_directories_and_writes_honesty_json(tmp_path: Path) -> None:
    gate = tmp_path / "rivals-gate"
    for seed in ("1", "2"):
        write_cell(gate, "swarm", "C0", seed)
        write_cell(gate, "durable-max", "C0", seed)
        for profile in ("C2", "C3"):
            write_cell(
                gate,
                "swarm",
                profile,
                seed,
                crashes=3,
                cdt_s=2.0,
                blast_sessions_mean_pct=20.0,
                idle_agent_s=4.0,
                ttr_own_mean_s=5.2,
            )
            write_cell(
                gate,
                "durable-max",
                profile,
                seed,
                crashes=3,
                cdt_s=12.0,
                blast_sessions_mean_pct=100.0,
                idle_agent_s=30.0,
                ttr_own_mean_s=5.0,
            )
    honesty = verdicts([gate], prereg=None)
    assert honesty.sources == ["rivals-gate"]
    assert {r.locality for r in honesty.regimes} == {"holds"}
    assert honesty.prereg["path"] == "bench/PREREG.md" and len(honesty.prereg["sha"]) == 12
    out = tmp_path / "honesty.json"
    write_json(honesty, out)
    again = Honesty.model_validate(json.loads(out.read_text(encoding="utf-8")))
    assert again == honesty
    text = render_text(honesty)
    assert "Outcome PENDING" in text and "H4a" in text and "rivals-gate" in text
    assert verdicts([tmp_path], prereg=None).sources == ["rivals-gate"]  # a directory of them


def test_a_directory_without_results_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no results"):
        verdicts([tmp_path])


def test_the_knobs_column_reads_back_as_numbers() -> None:
    assert parse_knobs(None) == {} and parse_knobs("") == {}
    assert parse_knobs("recovery_ms=500;agent_latency_scale=0.5") == {
        "recovery_ms": 500.0,
        "agent_latency_scale": 0.5,
    }


def test_the_file_hash_ignores_the_line_endings(tmp_path: Path) -> None:
    unix, dos = tmp_path / "a.md", tmp_path / "b.md"
    unix.write_bytes(b"one\ntwo\n")
    dos.write_bytes(b"one\r\ntwo\r\n")
    assert prereg_sha(unix) == prereg_sha(dos)
