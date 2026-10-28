"""Budget ledgers: caps are never exceeded, however reserves and settles interleave."""

import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from typer.testing import CliRunner

from fractalswarm.cli import app
from fractalswarm.market.ledger import Ledger, ProjectLedger, stale_reservations

CAPS = {("run", "r"): 1.0, ("squad", "s1"): 0.4, ("squad", "s2"): 0.5, ("contract", "c1"): 0.15}

reserve_op = st.tuples(
    st.just("reserve"),
    st.sampled_from(["c1", "c2", "c3"]),
    st.sampled_from(["s1", "s2"]),
    st.floats(min_value=0, max_value=0.3, allow_nan=False),
)
settle_op = st.tuples(st.just("settle"), st.integers(0, 50), st.floats(0, 1, allow_nan=False))


def committed_within_caps(ledger: Ledger) -> bool:
    return all(ledger.committed(scope) <= cap + 1e-9 for scope, cap in CAPS.items())


@settings(max_examples=300, deadline=None)
@given(st.lists(st.one_of(reserve_op, settle_op), max_size=60))
def test_caps_hold_for_any_sequence_of_reserves_and_settles(ops) -> None:
    ledger = Ledger()
    for (level, key), cap in CAPS.items():
        ledger.set_cap(level, key, cap)
    next_id = 0
    for op in ops:
        if op[0] == "reserve":
            _, contract, squad, usd = op
            scopes = {"contract": contract, "squad": squad, "run": "r"}
            refusal = ledger.reserve(f"x{next_id}", scopes, usd)
            next_id += 1
            if refusal is not None:
                cap = CAPS[(refusal.level, refusal.key)]
                assert refusal.committed_usd + usd > cap
        elif ledger.open:
            _, index, fraction = op
            ids = sorted(ledger.open)
            reservation_id = ids[index % len(ids)]
            # Reservations are worst cases, so the real cost never exceeds them.
            ledger.settle(reservation_id, ledger.open[reservation_id].usd * fraction)
        assert committed_within_caps(ledger)


def test_settle_releases_the_difference() -> None:
    ledger = Ledger()
    ledger.set_cap("run", "r", 1.0)
    assert ledger.reserve("a", {"run": "r"}, 0.8) is None
    assert ledger.reserve("b", {"run": "r"}, 0.3) is not None
    ledger.settle("a", 0.1)
    assert ledger.committed(("run", "r")) == pytest.approx(0.1)
    assert ledger.reserve("b", {"run": "r"}, 0.3) is None


def test_reserve_rejects_unknown_levels_and_reused_ids() -> None:
    ledger = Ledger()
    with pytest.raises(ValueError):
        ledger.reserve("a", {"galaxy": "g"}, 0.1)
    ledger.reserve("a", {"run": "r"}, 0.1)
    with pytest.raises(ValueError):
        ledger.reserve("a", {"run": "r"}, 0.1)


def test_project_ledger_never_overshoots_under_concurrent_reserves(tmp_path: Path) -> None:
    cap, amount, workers, per_worker = 1.0, 0.07, 8, 6
    ledger = ProjectLedger(tmp_path / "ledger.sqlite", cap)
    accepted: list[str] = []
    lock = threading.Lock()

    def work(worker: int) -> None:
        own = ProjectLedger(tmp_path / "ledger.sqlite", cap)
        for n in range(per_worker):
            reservation_id = f"w{worker}-{n}"
            if own.reserve(reservation_id, "run", "muse-spark-1.3", amount) is None:
                with lock:
                    accepted.append(reservation_id)

    threads = [threading.Thread(target=work, args=(w,)) for w in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(accepted) == int(cap / amount)  # 14 fit, 34 are refused
    assert ledger.committed_usd() <= cap + 1e-9


def test_project_ledger_settle_and_summary(tmp_path: Path) -> None:
    ledger = ProjectLedger(tmp_path / "ledger.sqlite", 150.0)
    assert ledger.reserve("a", "run-1", "muse-spark-1.3", 0.02, at="t0") is None
    assert ledger.reserve("b", "run-2", "muse-wonder-1.0", 0.5) is None
    ledger.settle("a", 0.004, at="t1")
    with pytest.raises(KeyError):
        ledger.settle("a", 0.004)
    summary = ledger.summary()
    assert summary.spent_usd == pytest.approx(0.004)
    assert summary.reserved_usd == pytest.approx(0.5)
    assert summary.remaining_usd == pytest.approx(150 - 0.504)
    assert [row.key for row in summary.by_run] == ["run-1", "run-2"]
    assert ledger.reserve("c", "run-3", "muse-wonder-1.0", 149.6) is not None


def test_open_reservations_older_than_an_hour_are_stale_and_stay_open(tmp_path: Path) -> None:
    now = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
    ledger = ProjectLedger(tmp_path / "ledger.sqlite", 150.0)
    ledger.reserve("old", "run-1", "muse-spark-1.3", 0.03, at="2026-10-29T10:00:00+00:00")
    ledger.reserve("done", "run-1", "muse-spark-1.3", 0.03, at="2026-10-29T10:00:00+00:00")
    ledger.settle("done", 0.01)
    ledger.reserve("fresh", "run-2", "muse-spark-1.3", 0.05, at="2026-10-29T11:30:00+00:00")
    ledger.reserve("undated", "run-3", "muse-wonder-1.0", 0.20)

    open_rows = ledger.open_reservations()
    assert [row.reservation_id for row in open_rows] == ["old", "fresh", "undated"]
    stale = stale_reservations(open_rows, now, timedelta(hours=1))
    assert [row.reservation_id for row in stale] == ["old", "undated"]
    # Naming them releases nothing.
    assert ledger.summary().reserved_usd == pytest.approx(0.28)


def test_spend_reports_stale_reservations_without_releasing_them(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "ledger.sqlite"
    ledger = ProjectLedger(path, 150.0)
    ledger.reserve("cut", "run-1", "muse-spark-1.3", 0.04, at="2026-10-28T17:00:00+00:00")
    ledger.reserve("live", "run-2", "muse-spark-1.3", 0.02, at=datetime.now(UTC).isoformat())
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(path))
    result = CliRunner().invoke(app, ["spend"])
    assert result.exit_code == 0, result.output
    assert "stale: 1 reservations ($0.0400) in 1 runs" in result.output
    assert ledger.summary().reserved_usd == pytest.approx(0.06)
