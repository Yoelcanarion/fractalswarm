"""The tables of ``bench/REPORT.md`` are the committed results, laid out (``bench/tables.py``).

The report is prose written by hand around tables that a script lays out from
``bench/results/honesty.json`` and ``bench/results/rivals-gate/results.json``. If either file is
derived again and a number moves, the report has to move with it: this is the check.
"""

from pathlib import Path

from typer.testing import CliRunner

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
