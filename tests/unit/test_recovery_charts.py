"""The recovery chart and the regime chart (``bench/charts.py``) on synthetic result rows.

The data behind a chart is its JSON twin, which the UI reads; the PNG is checked to exist and to
have been drawn from the same series. Nothing here says which system is better: the rows say
what they say.
"""

import json
from pathlib import Path
from typing import Any

from fractalswarm.bench.charts import (
    CHAOS_AXIS,
    KNOWN_WORKFLOWS,
    axis_label,
    axis_series,
    axis_value,
    recovery_chart,
    regime_chart,
    regime_series,
    style_slot,
)
from fractalswarm.bench.harness import Matrix, draw_charts
from fractalswarm.bench.verdicts import parse_knobs

T2 = "t2_conference"


def row(workflow: str, seed: str, killed: int, **values: Any) -> dict[str, Any]:
    base = {
        "workflow": workflow,
        "task": T2,
        "profile": f"C{min(killed, 3)}",
        "coordinators_killed": killed,
        "seed": seed,
        "run_dir": f"runs/{workflow}-{killed}-{seed}",
        "knobs": None,
        "completed": True,
        "valid": True,
        "stall_s": 0.0,
        "extra_cost_pct": 0.0,
        "coordination_tokens": 0,
        "cost_usd": 0.3,
        "crashes": killed,
        "ttr_own_mean_s": 5.0,
        "cdt_s": 0.0,
        "blast_sessions_mean_pct": 0.0,
        "idle_agent_s": 0.0,
        "preserved_pct": 100.0,
        "dup_usd": 0.0,
    }
    return base | values


def test_the_durable_rivals_have_their_own_colours_and_the_old_ones_keep_theirs() -> None:
    assert KNOWN_WORKFLOWS[:5] == ("swarm", "central", "single", "pipeline", "langgraph")
    order = ["central", "durable", "durable-max", "swarm"]
    assert len({style_slot(name, order) for name in order}) == 4


def test_a_rows_place_on_each_axis() -> None:
    plain = row("swarm", "1", 3)
    swept = row("swarm", "1", 3, knobs="recovery_ms=2500;rival_restart_ms=0")
    wide = row("swarm", "1", 3, agents=12)
    assert axis_value(plain, CHAOS_AXIS) == 3 and axis_value(plain, "recovery_ms") is None
    assert axis_value(swept, "recovery_ms") == 2500 and axis_value(swept, "rival_restart_ms") == 0
    assert axis_value(swept, CHAOS_AXIS) is None, "a sweep row is not a point of the chaos axis"
    assert axis_value(wide, "agents") == 12 and axis_value(wide, CHAOS_AXIS) is None
    assert parse_knobs("a=1;b=0.5") == {"a": 1.0, "b": 0.5} and parse_knobs(None) == {}


def test_the_labels_read_in_the_unit_of_the_axis() -> None:
    assert axis_label("recovery_ms", 2500) == "2.5"
    assert axis_label("rival_restart_ms", 0) == "0"
    assert axis_label("agent_latency_scale", 0.25) == "0.25x"
    assert axis_label("agents", 12) == "12"
    assert axis_label(CHAOS_AXIS, 3) == "3"
    assert axis_label("crash_jitter_pct", 10) == "±10" and axis_label("crash_jitter_pct", 0) == "0"


def test_the_series_of_the_chaos_axis_average_the_seeds_and_skip_sweep_rows() -> None:
    rows = [
        row("swarm", "1", 3, cdt_s=2.0, preserved_pct=100.0),
        row("swarm", "2", 3, cdt_s=6.0, preserved_pct=80.0),
        row("swarm", "1", 0, crashes=0, ttr_own_mean_s=None, preserved_pct=None),
        row("swarm", "1", 3, cdt_s=99.0, knobs="recovery_ms=500"),
        row("central", "1", 3, cdt_s=30.0),
    ]
    data = axis_series(rows, T2, CHAOS_AXIS)
    assert sorted(data) == ["central", "swarm"]
    by_x = {p["x"]: p for p in data["swarm"]}
    assert sorted(by_x) == [0, 3]
    three = by_x[3]
    assert (three["cdt_s"], three["cdt_s_min"], three["cdt_s_max"]) == (4.0, 2.0, 6.0)
    assert three["preserved_pct"] == 90.0 and three["seeds"] == ["1", "2"]
    assert by_x[0]["ttr_own_mean_s"] is None, "no crash, no mean"
    assert axis_series(rows, "t1_extraction", CHAOS_AXIS) == {}


def test_the_series_of_a_sweep_axis_are_read_at_one_chaos_profile() -> None:
    rows = [
        row("swarm", "1", 5, knobs=f"recovery_ms={ms}", cdt_s=ms / 1000, profile="C3")
        for ms in (500, 5000)
    ] + [row("swarm", "1", 0, knobs="recovery_ms=500", profile="C0", cdt_s=7.0)]
    points = axis_series(rows, T2, "recovery_ms", "C3")["swarm"]
    assert [(p["x"], p["cdt_s"]) for p in points] == [(500, 0.5), (5000, 5.0)]
    assert axis_series(rows, T2, "recovery_ms", "C0")["swarm"][0]["cdt_s"] == 7.0


def test_the_recovery_chart_writes_its_picture_and_the_data_behind_it(tmp_path: Path) -> None:
    rows = [
        row(w, seed, killed, cdt_s=float(killed) * (2 if w == "swarm" else 9))
        for w in ("swarm", "durable-max")
        for seed in ("1", "2")
        for killed in (0, 1, 3, 5)
    ]
    png, js = recovery_chart(rows, tmp_path / "recovery", task=T2, title="gate")
    assert png.stat().st_size > 5_000 and png.suffix == ".png"
    data = json.loads(js.read_text(encoding="utf-8"))
    assert data["axis"] == CHAOS_AXIS and data["profile"] is None
    assert data["x"] == [0, 1, 3, 5] and data["x_labels"] == ["0", "1", "3", "5"]
    assert [p["metric"] for p in data["panels"]][:2] == ["ttr_own_mean_s", "cdt_s"]
    assert sorted(data["series"]) == ["durable-max", "swarm"]
    five = {p["x"]: p for p in data["series"]["swarm"]["points"]}[5]
    assert five["cdt_s"] == 10.0
    assert data["series"]["swarm"]["color"] != data["series"]["durable-max"]["color"]


def test_the_recovery_chart_of_a_sweep_labels_its_axis_in_seconds(tmp_path: Path) -> None:
    rows = [
        row(w, "1", 5, knobs=f"recovery_ms={ms}", profile="C3", cdt_s=float(ms))
        for w in ("swarm", "durable")
        for ms in (500, 2500, 20000)
    ]
    _, js = recovery_chart(
        rows, tmp_path / "sweep", task=T2, title="sweep", axis="recovery_ms", profile="C3"
    )
    data = json.loads(js.read_text(encoding="utf-8"))
    assert data["axis"] == "recovery_ms" and data["profile"] == "C3"
    assert data["x_labels"] == ["0.5", "2.5", "20"]
    assert "(s)" in data["x_label"]


def test_the_recovery_chart_of_the_crash_jitter_reads_its_settings_in_points(
    tmp_path: Path,
) -> None:
    rows = [
        row(w, "1", 5, knobs=f"crash_jitter_pct={j}", profile="C3", cdt_s=float(j))
        for w in ("swarm", "durable-max")
        for j in (0, 5, 15)
    ]
    _, js = recovery_chart(
        rows, tmp_path / "jitter", task=T2, title="jitter", axis="crash_jitter_pct", profile="C3"
    )
    data = json.loads(js.read_text(encoding="utf-8"))
    assert data["axis"] == "crash_jitter_pct" and data["profile"] == "C3"
    assert data["x_labels"] == ["0", "±5", "±15"]
    assert "points of progress" in data["x_label"]


def test_a_chart_with_nothing_to_draw_is_still_written(tmp_path: Path) -> None:
    png, js = recovery_chart([], tmp_path / "empty", task=T2)
    assert png.exists() and json.loads(js.read_text(encoding="utf-8"))["series"] == {}


# -- the regime chart ------------------------------------------------------------------------


def regime(
    rival: str,
    locality: str,
    axis: str | None = None,
    value: float | None = None,
    profile: str = "C3",
    task: str = T2,
    plausible: bool = False,
    cdt: float | None = 0.1,
    blast: float | None = 0.2,
) -> dict[str, Any]:
    return {
        "source": "s",
        "axis": axis,
        "value": value,
        "plausible": plausible,
        "task": task,
        "profile": profile,
        "rival": rival,
        "locality": locality,
        "cdt_ratio": cdt,
        "blast_ratio": blast,
        "idle_ratio": 0.3,
    }


def honesty(regimes: list[dict[str, Any]], label: str = "B") -> dict[str, Any]:
    return {"regimes": regimes, "outcome": {"label": label, "against": "durable-max"}}


REGIMES = [
    regime("durable-max", "holds", profile="C2"),
    regime("durable-max", "holds", profile="C3"),
    regime("durable-max", "ties", profile="C3", task="t1_extraction", cdt=0.9, blast=1.0),
    regime("durable", "holds", profile="C3"),
    regime("durable-max", "holds", "recovery_ms", 1000, plausible=True),
    regime("durable-max", "ties", "recovery_ms", 20000, cdt=0.8, blast=0.7),
    regime("durable-max", "fails", "recovery_ms", 500, cdt=None, blast=1.6),
    regime("durable-max", "holds", "agents", 4),
]


def test_the_regime_map_is_grouped_by_axis_in_a_fixed_order() -> None:
    columns = regime_series(REGIMES)
    assert [c["axis"] for c in columns] == ["gate", "recovery_ms", "agents"]
    gate, sweep, _ = columns
    assert gate["x"] == ["C2", "C3"]
    assert sweep["x"] == [500, 1000, 20000]
    assert sorted(gate["series"]) == [
        "durable-max|t1_extraction",
        "durable-max|t2_conference",
        "durable|t2_conference",
    ]
    points = sweep["series"]["durable-max|t2_conference"]
    assert [p["x"] for p in points] == [500, 1000, 20000], "in the order of the axis"
    one = {p["x"]: p for p in points}
    assert one[1000]["plausible"] and not one[20000]["plausible"]
    assert one[500]["cdt_ratio"] is None and one[500]["locality"] == "fails"


def test_the_regime_chart_writes_its_picture_and_the_data_behind_it(tmp_path: Path) -> None:
    png, js = regime_chart(honesty(REGIMES), tmp_path / "regime", title="gate and sweeps")
    assert png.stat().st_size > 5_000
    data = json.loads(js.read_text(encoding="utf-8"))
    assert (data["outcome"], data["against"], data["threshold"]) == ("B", "durable-max", 0.5)
    assert [r["hypothesis"] for r in data["rows"]] == ["H4a", "H4b"]
    assert [c["axis"] for c in data["columns"]] == ["gate", "recovery_ms", "agents"]


def test_a_regime_chart_without_regimes_is_still_written(tmp_path: Path) -> None:
    png, js = regime_chart(honesty([], "pending"), tmp_path / "none")
    assert png.exists() and json.loads(js.read_text(encoding="utf-8"))["columns"] == []


# -- the charts a matrix draws ---------------------------------------------------------------


def matrix(**kwargs: Any) -> Matrix:
    spec = {
        "name": "m",
        "workflows": ["swarm", "durable-max"],
        "tasks": [T2],
        "profiles": ["C0", "C3"],
        "seeds": ["1"],
        "out_dir": "o",
    }
    return Matrix.model_validate(spec | kwargs)


def gate_rows(**values: Any) -> list[dict[str, Any]]:
    return [
        row(w, "1", killed, profile=f"C{killed}", **values)
        for w in ("swarm", "durable-max")
        for killed in (0, 3)
    ]


def test_a_matrix_draws_the_hero_chart_and_the_recovery_chart(tmp_path: Path) -> None:
    drawn = draw_charts(matrix(), gate_rows(), tmp_path)
    stems = [Path(p).stem for p in drawn if p.endswith(".png")]
    assert stems == ["hero-t2_conference", "recovery-t2_conference"]
    assert all(Path(p).exists() for p in drawn)


def test_a_sweep_draws_the_recovery_chart_along_its_axis_and_no_hero_chart(tmp_path: Path) -> None:
    rows = [
        row(w, "1", killed, profile=f"C{killed}", knobs=f"recovery_ms={ms}")
        for w in ("swarm", "durable-max")
        for killed in (0, 3)
        for ms in (500, 1000)
    ]
    sweep = matrix(knobs=[{"recovery_ms": 500}, {"recovery_ms": 1000}])
    drawn = draw_charts(sweep, rows, tmp_path)
    assert [Path(p).name for p in drawn] == [
        "recovery-t2_conference-recovery_ms.png",
        "recovery-t2_conference-recovery_ms.json",
    ]
    data = json.loads(Path(drawn[1]).read_text(encoding="utf-8"))
    assert data["profile"] == "C3" and data["x_labels"] == ["0.5", "1"]


def test_the_recovery_chart_is_drawn_for_every_task_of_the_matrix(tmp_path: Path) -> None:
    rows = gate_rows() + gate_rows(task="t1_extraction")
    two = matrix(tasks=[T2, "t1_extraction"])
    drawn = draw_charts(two, rows, tmp_path)
    stems = sorted(Path(p).stem for p in drawn if p.endswith(".png"))
    assert stems == ["hero-t2_conference", "recovery-t1_extraction", "recovery-t2_conference"]


def test_single_crash_probes_get_no_chart(tmp_path: Path) -> None:
    probes = matrix(profiles=["K-o0", "K-o1"])
    rows = [row(w, "1", 1, profile=p) for w in ("swarm", "durable-max") for p in ("K-o0", "K-o1")]
    assert draw_charts(probes, rows, tmp_path) == []
    assert not list(tmp_path.iterdir())


def test_probes_beside_their_c0_twin_get_no_chart_either(tmp_path: Path) -> None:
    """A per-process matrix keeps C0 as the extra-cost base; a chart would still average probes."""
    names = ["C0", "K-o0", "K-o1"]
    probes = matrix(profiles=names)
    rows = [row(w, "1", int(p != "C0"), profile=p) for w in ("swarm", "durable-max") for p in names]
    assert draw_charts(probes, rows, tmp_path) == []
    assert not list(tmp_path.iterdir())


def test_a_matrix_whose_runs_logged_no_crash_draws_the_hero_chart_alone(tmp_path: Path) -> None:
    rows = [row("swarm", "1", killed, crashes=0) for killed in (0, 3)]
    drawn = draw_charts(matrix(), rows, tmp_path)
    assert [Path(p).name for p in drawn] == ["hero-t2_conference.png", "hero-t2_conference.json"]
