"""A run's status in the catalog: a crashed run must stop showing "running" forever.

``record_run`` keeps ``<run>/LIVE`` (the pid) touched while its process lives and deletes it on
exit. Fresh LIVE means running; a log that stops without an end and without a fresh LIVE was
interrupted.
"""

import asyncio
import os
import signal
import sqlite3
import subprocess
import sys
import textwrap
import time
from contextlib import closing
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from fractalswarm.api.app import create_app
from fractalswarm.api.catalog import Catalog
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.runs import LiveMarker, RunPaths, record_run

# A recording process whose "model" never answers: it blocks in its first call until killed.
VICTIM = textwrap.dedent(
    """
    import asyncio
    import sys
    import time
    from pathlib import Path

    import fractalswarm.runs
    from fractalswarm.llm.fake import FakeBackend
    from fractalswarm.runs import record_run

    fractalswarm.runs.LIVE_TOUCH_S = 0.1


    def script(body, attempt):
        time.sleep(120)
        return "never"


    asyncio.run(
        record_run(
            "toy",
            run_id="victim",
            run_dir=Path(sys.argv[1]),
            backend=FakeBackend(script=script),
            params={"rounds": 2},
        )
    )
    """
)


def status_of(catalog: Catalog, run_id: str) -> str:
    entry = catalog.get(run_id)
    return catalog.status(entry, catalog.last(entry))


def wait_for(condition, timeout_s: float = 60.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError("timed out waiting for the recording process")


def logged_events(run_dir: Path) -> int:
    path = run_dir / "events.sqlite"
    if not path.exists():
        return 0
    try:
        with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as db:
            return db.execute("SELECT count(*) FROM events").fetchone()[0]
    except sqlite3.Error:  # being created
        return 0


def kill_tree(pid: int) -> None:
    """Kill a process and its children. The venv's python.exe on Windows is a launcher that
    starts the real interpreter as a child, so killing the Popen pid alone leaves the run going."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        os.killpg(os.getpgid(pid), signal.SIGKILL)


def test_a_killed_recording_process_stops_showing_as_running(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    script = tmp_path / "victim.py"
    script.write_text(VICTIM, encoding="utf-8")
    run_dir = runs / "victim"
    live = run_dir / "LIVE"
    catalog = Catalog(runs, live_stale_s=0.5)

    process = subprocess.Popen(
        [sys.executable, str(script), str(run_dir)], start_new_session=os.name != "nt"
    )
    try:
        wait_for(lambda: live.exists() and logged_events(run_dir) > 0)
        assert live.read_text(encoding="utf-8").strip().isdigit()  # the pid
        assert status_of(catalog, "victim") == "running"
    finally:
        kill_tree(process.pid)
        process.wait()

    # The process could not clean up after itself: its pid file stays, and nobody touches it.
    time.sleep(0.4)
    assert live.exists()
    last_touch = live.stat().st_mtime
    time.sleep(0.4)
    assert live.stat().st_mtime == last_touch
    assert status_of(catalog, "victim") == "interrupted"
    assert catalog.listing(catalog.get("victim"))["status"] == "interrupted"

    # And nobody is left to read a control request. (The API judges by the default staleness.)
    long_ago = time.time() - 600
    os.utime(live, (long_ago, long_ago))
    app = create_app(runs, None, tmp_path / "bench", tmp_path / "static")
    answer = TestClient(app).post("/api/runs/victim/halt", json={})
    assert answer.status_code == 409 and "interrupted" in answer.json()["error"]
    assert not (run_dir / "control").exists()


def test_a_live_file_that_is_still_touched_means_running(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "toy"
    asyncio.run(record_run("toy", run_id="toy", run_dir=run_dir, backend=FakeBackend()))
    assert status_of(Catalog(tmp_path / "runs"), "toy") == "completed"
    assert not (run_dir / "LIVE").exists()  # a clean exit removes it

    # The log of an unfinished run: cut the export and the end off a finished one.
    (run_dir / "events.jsonl").unlink()
    with RunPaths(run_dir).open_log() as log:
        log.db.execute("DELETE FROM events WHERE type = 'run.completed'")
    catalog = Catalog(tmp_path / "runs", live_stale_s=5.0)
    assert status_of(catalog, "toy") == "interrupted"
    (run_dir / "LIVE").write_text("1", encoding="utf-8")
    assert status_of(catalog, "toy") == "running"
    stale = time.time() - 6
    os.utime(run_dir / "LIVE", (stale, stale))
    assert status_of(catalog, "toy") == "interrupted"


def test_the_marker_is_touched_while_the_process_lives_and_removed_on_exit(tmp_path: Path) -> None:
    live = tmp_path / "LIVE"
    with LiveMarker(live, period_s=0.02):
        assert live.read_text(encoding="utf-8") == str(os.getpid())
        old = time.time() - 600
        os.utime(live, (old, old))
        wait_for(lambda: time.time() - live.stat().st_mtime < 5, timeout_s=5)
    assert not live.exists()


def test_the_marker_is_removed_when_the_recording_raises(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(self) -> list:
        raise RuntimeError("the driver died")

    monkeypatch.setattr(RunPaths, "poll_control", boom)
    run_dir = tmp_path / "runs" / "boom"
    with pytest.raises(RuntimeError, match="the driver died"):
        asyncio.run(record_run("toy", run_id="boom", run_dir=run_dir, backend=FakeBackend()))
    assert not (run_dir / "LIVE").exists()
    assert status_of(Catalog(tmp_path / "runs"), "boom") == "interrupted"


async def test_a_halted_run_is_halted_not_completed(tmp_path: Path) -> None:
    runs = tmp_path / "runs"
    requested: list[bool] = []

    def script(body, attempt):
        if "item 2" in str(body["input"]) and not requested:
            RunPaths(runs / "stopped").request_control({"op": "halt", "reason": "enough"})
            requested.append(True)
        return "ok"

    await record_run(
        "toy",
        run_id="stopped",
        run_dir=runs / "stopped",
        backend=FakeBackend(script=script),
        params={"rounds": 3},
    )
    catalog = Catalog(runs)
    assert status_of(catalog, "stopped") == "halted"
    assert catalog.last(catalog.get("stopped"))["type"] == "run.completed"
