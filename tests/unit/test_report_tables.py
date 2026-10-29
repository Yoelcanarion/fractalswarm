"""The tables of ``bench/REPORT.md`` are the committed results, laid out (``bench/tables.py``).

The report is prose written by hand around tables that a script lays out from
``bench/results/honesty.json`` and ``bench/results/rivals-gate/results.json``. If either file is
derived again and a number moves, the report has to move with it: this is the check.
"""

from pathlib import Path

from typer.testing import CliRunner

from fractalswarm.bench.harness import write_results
from fractalswarm.bench.tables import missing, report_tables
from fractalswarm.cli import app as cli

REPO = Path(__file__).resolve().parents[2]
RESULTS = REPO / "bench" / "results"
REPORT = REPO / "bench" / "REPORT.md"


def test_every_table_the_generator_lays_out_is_in_the_report_word_for_word() -> None:
    made = report_tables(RESULTS)
    assert all(text.strip() for text in made.values())  # an empty block is in every report
    assert missing(REPORT.read_text(encoding="utf-8"), made) == []


def drifted_report(tmp_path: Path) -> Path:
    """The report with one number of the ``stall`` table changed."""
    made = report_tables(RESULTS)
    row = made["stall"].splitlines()[-1]
    report = REPORT.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert report.count(row) == 1
    path = tmp_path / "REPORT.md"
    path.write_text(report.replace(row, row[:-2] + "0 |"), encoding="utf-8")
    return path


def test_a_table_whose_number_moved_is_named(tmp_path: Path) -> None:
    moved = drifted_report(tmp_path).read_text(encoding="utf-8")
    assert missing(moved, report_tables(RESULTS)) == ["stall"]


def test_the_cli_checks_a_report_and_prints_one_table(tmp_path: Path) -> None:
    runner = CliRunner()
    base = ["bench", "tables", "--results", str(RESULTS)]
    clean = runner.invoke(cli, [*base, "--check", str(REPORT)])
    assert clean.exit_code == 0 and "are in" in clean.output
    stale = runner.invoke(cli, [*base, "--check", str(drifted_report(tmp_path))])
    assert stale.exit_code == 1 and "word for word: stall" in stale.output
    one = runner.invoke(cli, [*base[:2], "stall", *base[2:]])
    assert one.exit_code == 0 and one.output.strip() == report_tables(RESULTS)["stall"]
    assert runner.invoke(cli, [*base[:2], "no-such-table", *base[2:]]).exit_code != 0


# -- the exploratory crash-time jitter tables ------------------------------------------------


def jitter_row(workflow: str, setting: int, seed: str, profile: str = "C3", **values) -> dict:
    base = {
        "workflow": workflow,
        "task": "t2_conference",
        "profile": profile,
        "seed": seed,
        "completed": True,
        "valid": True,
        "agents": None,
        "knobs": f"crash_jitter_pct={setting}",
        "crashes": 0 if profile == "C0" else 5,
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


def jitter_sweep() -> list[dict]:
    """Swarm, durable-max and durable at settings 0, 5 and 15, two seeds. The swarm waits a
    fifth as long as the supervisors, but at 15 on seed 2 as long as durable-max does."""
    rows = []
    for setting in (0, 5, 15):
        for seed in ("1", "2"):
            for w in ("swarm", "durable-max", "durable"):
                rows.append(jitter_row(w, setting, seed, "C0"))
                slow = w == "swarm" and setting == 15 and seed == "2"
                supervisor = w != "swarm"
                rows.append(
                    jitter_row(
                        w,
                        setting,
                        seed,
                        cdt_s=10.0 if supervisor or slow else 2.0,
                        blast_sessions_mean_pct=100.0 if supervisor else 20.0,
                        idle_agent_s=40.0 if supervisor else 8.0,
                        extra_cost_pct=10.0,
                    )
                )
    return rows


def test_the_jitter_tables_are_laid_out_from_the_sweeps_own_rows(tmp_path: Path) -> None:
    for name in ("honesty.json", "rivals-gate/results.json"):
        (tmp_path / name).parent.mkdir(exist_ok=True)
        (tmp_path / name).write_bytes((RESULTS / name).read_bytes())
    assert not [n for n in report_tables(tmp_path) if n.startswith("jitter")]  # not run: no table
    out = tmp_path / "exploratory" / "crash_jitter_pct"
    out.mkdir(parents=True)
    write_results(jitter_sweep(), out)
    made = {n: t.splitlines() for n, t in report_tables(tmp_path).items() if n.startswith("jitter")}
    assert list(made) == [
        "jitter_plans",
        "jitter_locality",
        "jitter_tally",
        "jitter_means",
        "jitter_seeds",
    ]
    assert made["jitter_plans"][2:] == [  # the crash points of the plan, by seed and setting
        "| 1 | 20 / 35 / 50 / 65 / 80 | 21 / 34 / 54 / 64 / 80 | 22 / 33 / 62 / 63 / 80 |",
        "| 2 | 20 / 35 / 50 / 65 / 80 | 25 / 37 / 54 / 69 / 77 | 34 / 42 / 62 / 72 / 78 |",
    ]
    assert made["jitter_locality"][2:] == [
        "| 0 | holds | 0.20 | 0.20 | 0.20 | holds | 0.20 | 0.20 | 0.20 |",
        "| ±5 | holds | 0.20 | 0.20 | 0.20 | holds | 0.20 | 0.20 | 0.20 |",
        "| ±15 | ties | 0.60 | 0.20 | 0.20 | ties | 0.60 | 0.20 | 0.20 |",  # (2 + 10) / 2 / 10
    ]
    assert len(made["jitter_tally"]) == 2 + 9  # H1-H6 and the stall, one row each
    assert "| H4a Dependency time (s) | 2 / 1 / 0 | 2 / 1 / 0 |" in made["jitter_tally"]  # 0, 5, 15
    assert len(made["jitter_means"]) == 2 + 3 * 3
    assert "| 0 | swarm | 2.0 | 20.0 | 8.0 | 10.0 | 0.0 |" in made["jitter_means"]
    assert "| ±15 | swarm | 6.0 | 20.0 | 8.0 | 10.0 | 0.0 |" in made["jitter_means"]
    assert made["jitter_seeds"][3] == (
        "| cdt | 2 | 2.0 / 10.0 = 0.20 | 2.0 / 10.0 = 0.20 | 10.0 / 10.0 = 1.00 (no win) |"
    )
