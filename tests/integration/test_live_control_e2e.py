"""End to end: a run the API launched takes a person's controls from the API, and replays.

The run is a real subprocess on the fake backend ($0) on the live clock, so there is time between
the plan and the end of the run for a person to act. The person is the API client: the same POSTs
the UI makes, in the same order the demo makes them.
"""

import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from fractalswarm.api.app import create_app

T2_FIXTURE = "tasks/fixtures/t2/seed-1"
LAUNCH = [sys.executable, "-c", "from fractalswarm.cli import app; app()"]
PATIENCE_S = 180.0


class Api:
    def __init__(self, tmp_path: Path) -> None:
        self.runs = tmp_path / "runs"
        self.private = tmp_path / "private"
        self.runs.mkdir()
        app = create_app(
            self.runs, None, tmp_path / "bench", tmp_path / "static", private_dir=self.private
        )
        self.client = TestClient(app)

    def post(self, path: str, body: dict[str, Any] | None = None):
        return self.client.post(path, json=body or {})

    def get(self, path: str):
        return self.client.get(path)

    def wait(self, until: Callable[[], Any], what: str) -> Any:
        deadline = time.monotonic() + PATIENCE_S
        while time.monotonic() < deadline:
            found = until()
            if found:
                return found
            time.sleep(0.2)
        raise AssertionError(f"timed out waiting for {what}")

    def events(self, run_id: str, after: int = 0) -> list[dict[str, Any]]:
        """The events after seq ``after``, page by page, up to the end of the log as the first
        page saw it. A run that holds its plan logs thousands of events a second, so the end is
        fixed when the read starts: a read that followed the log until it stopped growing would
        last as long as the hold does."""
        found: list[dict[str, Any]] = []
        seq, end = after + 1, None
        while end is None or seq <= end:
            page = self.get(f"/api/runs/{run_id}/events?from_seq={seq}&limit=5000")
            if page.status_code != 200:
                return found
            body = page.json()
            if end is None:
                end = body["last_seq"]
            if not body["events"]:
                break
            found += body["events"]
            seq = body["next_seq"]
        return found


class Tail:
    """What the test has read of a run's log. Each look reads on from the last seq seen."""

    def __init__(self, api: Api, run_id: str) -> None:
        self.api, self.run_id = api, run_id
        self.last_seq = 0
        self.kinds: set[str] = set()

    def has(self, kind: str) -> bool:
        found = self.api.events(self.run_id, after=self.last_seq)
        if found:
            self.last_seq = found[-1]["seq"]
            self.kinds.update(event["type"] for event in found)
        return kind in self.kinds


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Api:
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "ledger.sqlite"))
    return Api(tmp_path)


def test_a_run_launched_from_the_api_is_killed_and_approved_from_the_api(api: Api) -> None:
    spec = {
        "goal": "Program the conference",
        "inputs": {"fixture": T2_FIXTURE, "generate_seed": 1},
        "seed": "1",
        "auto_approve": False,  # the plan waits for the person at the UI
    }
    launched = api.post(
        "/api/tasks", {"spec": spec, "run_id": "ui-live", "clock": "live", "speed": 40}
    )
    assert launched.status_code == 202, launched.text
    job_id = launched.json()["job_id"]

    log = Tail(api, "ui-live")
    api.wait(lambda: log.has("plan.proposed"), "the root's plan")
    time.sleep(1.0)  # the person reads it; the run waits meanwhile
    assert not log.has("plan.approved"), "the run went on without the person"

    kill = api.post(
        "/api/runs/ui-live/chaos", {"kind": "kill_coordinator", "at": 0.3, "target": "o1"}
    )
    assert kill.status_code == 200, kill.text
    approval = api.post("/api/runs/ui-live/approve", {"goal_id": "root", "approve": True})
    assert approval.status_code == 200, approval.text

    def ended() -> dict[str, Any] | None:
        job = api.get(f"/api/jobs/{job_id}").json()
        gone = all(run["exit_code"] is not None for run in job["runs"])
        return job if job["state"] not in ("starting", "running") and gone else None

    job = api.wait(ended, "the run to end")
    assert job["state"] == "completed", job

    events = api.events("ui-live")
    kinds = [event["type"] for event in events]
    controls = [e["payload"] for e in events if e["type"] == "control.injected"]
    assert [c["op"] for c in controls] == ["chaos", "approve"] and controls[1]["to"] == "goal:root"
    (approved,) = [e for e in events if e["type"] == "plan.approved"]
    assert approved["payload"]["by"] == "human"
    assert approved["seq"] > next(e["seq"] for e in events if e["type"] == "control.injected")
    kills = [e for e in events if e["type"] == "chaos.injected"]
    assert kills and kills[0]["payload"]["fault"] == "kill_coordinator"
    assert kills[0]["payload"]["target"] == "o1" and kills[0]["payload"]["progress"] >= 0.3
    assert kinds[-1] == "run.completed" and "task.result" in kinds

    assert api.post("/api/runs/ui-live/verify").json()["ok"] is True
    done = subprocess.run(
        [*LAUNCH, "replay", str(api.runs / "ui-live"), "--verify"],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert done.returncode == 0 and done.stdout.startswith("MATCH"), done.stdout + done.stderr
