"""The arena: two runs on one input under one failure plan, started together ($0, fake LLM).

Each run is a real subprocess (``fractalswarm run``) in a temp directory. The tests hold the
promises of the pair: both ``run.started`` events are identical except for the scenario, the plan
is the same file for both, the live clocks start together behind a barrier, a pair that cannot
start is stopped as a whole, and a pair on live input stays private.
"""

import json
import os
import subprocess
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import typer
from starlette.testclient import TestClient
from typer.testing import CliRunner

from fractalswarm.api import arena, jobs
from fractalswarm.api.app import create_app
from fractalswarm.api.catalog import Catalog
from fractalswarm.api.jobs import JobManager
from fractalswarm.bench.profiles import CRASH_POINTS, half_the_brains_plan
from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.tasks.t2_conference.generator import live_sample
from fractalswarm.cli import app as cli
from fractalswarm.cli import chaos_plan_params, kill_half_plan
from fractalswarm.comms.chaos import ChaosPlan
from fractalswarm.intake.store import PrivateDir
from fractalswarm.planning.taskspec import TaskSpec
from fractalswarm.runs import BARRIER_GO, SCENARIOS, wait_at_barrier

REPO = Path(__file__).resolve().parents[2]
T2_EXAMPLE = REPO / "tasks" / "examples" / "t2-conference.yaml"
SPEC = {
    "goal": "Program the conference",
    "inputs": {"fixture": "tasks/fixtures/t2/seed-1", "generate_seed": 1},
    "seed": "1",
}
PATIENCE_S = 180.0


class Api:
    def __init__(self, tmp_path: Path) -> None:
        self.runs, self.private = tmp_path / "runs", tmp_path / "private"
        self.runs.mkdir()
        app = create_app(self.runs, None, tmp_path / "bench", tmp_path / "s", self.private)
        self.client = TestClient(app)

    def post(self, path: str, body: dict[str, Any] | None = None):
        return self.client.post(path, json=body or {})

    def get(self, path: str):
        return self.client.get(path)

    def wait(self, until: Callable[[], Any], what: str) -> Any:
        deadline = time.monotonic() + PATIENCE_S
        while time.monotonic() < deadline:
            if found := until():
                return found
            time.sleep(0.25)
        raise AssertionError(f"timed out waiting for {what}")

    def wait_job(self, job_id: str) -> dict[str, Any]:
        def ended() -> dict[str, Any] | None:
            job = self.get(f"/api/jobs/{job_id}").json()
            gone = all(run["exit_code"] is not None for run in job["runs"])
            return job if job["state"] not in ("starting", "running") and gone else None

        return self.wait(ended, f"job {job_id} to end")


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Api]:
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "ledger.sqlite"))
    found = Api(tmp_path)
    yield found
    for job in found.get("/api/jobs").json():  # a failed test must not leave runs behind
        if job["state"] in jobs.ACTIVE:
            found.post(f"/api/jobs/{job['id']}/cancel")


def started(directory: Path) -> dict[str, Any]:
    return load_events(directory)[0].payload


# -- the CLI flags ---------------------------------------------------------------------------


def test_a_chaos_plan_file_is_the_same_run_as_the_profile_it_holds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "ledger.sqlite"))
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps(kill_half_plan(TaskSpec.load(T2_EXAMPLE).seed)))
    by_profile = CliRunner().invoke(
        cli, ["run", str(T2_EXAMPLE), "--chaos", "kill-half", "--run-id", "by-profile"]
    )
    by_file = CliRunner().invoke(
        cli, ["run", str(T2_EXAMPLE), "--chaos-plan", str(plan), "--run-id", "by-file"]
    )
    assert by_profile.exit_code == by_file.exit_code == 0, by_file.output

    def shape(name: str) -> list[str]:  # the run's own name is in its budget scopes
        events = load_events(tmp_path / "runs" / name)
        return [repr((e.type, e.actor, e.payload)).replace(name, "RUN") for e in events]

    assert shape("by-profile") == shape("by-file")


@pytest.mark.parametrize(
    ("content", "needle"),
    [
        (None, "No such file"),
        ("not json", "Expecting value"),
        ('{"actions": [{"at": 2, "kind": "kill_coordinator"}]}', "less than or equal to 1"),
        ('{"actions": [{"at": 0.5, "kind": "explode"}]}', "actions.0.kind"),
        ('{"profile": "x", "bogus": 1}', "Extra inputs"),
        ("[]", "valid dictionary"),
    ],
)
def test_a_bad_chaos_plan_file_is_refused(tmp_path: Path, content: str | None, needle: str) -> None:
    plan = tmp_path / "plan.json"
    if content is not None:
        plan.write_text(content)
    with pytest.raises(typer.BadParameter, match="--chaos-plan") as refused:
        chaos_plan_params(plan)
    assert needle in refused.value.message


def test_a_run_with_a_bad_chaos_plan_never_starts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "ledger.sqlite"))
    (tmp_path / "plan.json").write_text("{}x")
    refused = CliRunner().invoke(
        cli, ["run", str(T2_EXAMPLE), "--chaos-plan", str(tmp_path / "plan.json")]
    )
    assert refused.exit_code != 0 and not (tmp_path / "runs").exists()


def test_a_plan_that_crashes_coordinators_turns_membership_on(tmp_path: Path) -> None:
    crashing, calm = tmp_path / "crashing.json", tmp_path / "calm.json"
    crashing.write_text(json.dumps(arena.half_the_brains("1").model_dump(mode="json")))
    calm.write_text(json.dumps({"profile": "calm", "actions": []}))
    assert chaos_plan_params(crashing)["membership"] is True
    assert chaos_plan_params(crashing)["chaos"]["profile"] == "half-the-brains"
    assert "membership" not in chaos_plan_params(calm)


def test_a_run_parks_at_the_start_barrier_until_go(tmp_path: Path) -> None:
    barrier, runs = tmp_path / "barrier", tmp_path / "runs"
    env = os.environ | {
        "FRACTALSWARM_RUNS_DIR": str(runs),
        "FRACTALSWARM_LEDGER_PATH": str(tmp_path / "ledger.sqlite"),
        "FRACTALSWARM_PRIVATE_DIR": str(tmp_path / "private"),
        "PYTHONUNBUFFERED": "1",
    }
    command = [*jobs.LAUNCH, "run", str(T2_EXAMPLE), "--run-id", "parked", "--start-barrier"]
    proc = subprocess.Popen(
        [*command, str(barrier)],
        cwd=REPO,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        ready = barrier / "parked.ready"
        deadline = time.monotonic() + 90
        while not ready.exists():
            assert proc.poll() is None and time.monotonic() < deadline, "never got ready"
            time.sleep(0.1)
        time.sleep(1.0)  # given every chance to start without go
        assert proc.poll() is None and not (runs / "parked" / "events.sqlite").exists()
        (barrier / BARRIER_GO).write_text("go")
        output, _ = proc.communicate(timeout=120)
        assert proc.returncode == 0, output.decode()
        assert (runs / "parked" / "events.sqlite").exists()
    finally:
        if proc.poll() is None:
            jobs.kill_tree(proc.pid)


def test_a_barrier_that_nobody_releases_times_out(tmp_path: Path) -> None:
    with pytest.raises(TimeoutError, match="nobody released"):
        wait_at_barrier(tmp_path / "barrier", "lonely", timeout_s=0.3)
    assert (tmp_path / "barrier" / "lonely.ready").exists()


# -- the pair --------------------------------------------------------------------------------


def test_a_pair_runs_one_input_under_one_plan(api: Api) -> None:
    answer = api.post("/api/arena", {"spec": SPEC, "pair_id": "p1"})  # the default rival
    assert answer.status_code == 202, answer.text
    launched = answer.json()
    assert (launched["left"], launched["right"]) == ("p1-swarm", "p1-durable-max")
    job = api.wait_job(launched["job_id"])
    assert job["kind"] == "arena" and job["pair_id"] == "p1" and job["state"] == "completed"
    assert [run["status"] for run in job["runs"]] == ["completed", "completed"]

    left, right = started(api.runs / "p1-swarm"), started(api.runs / "p1-durable-max")
    assert (left["scenario"], right["scenario"]) == (SCENARIOS["swarm"], SCENARIOS["durable-max"])
    assert left | {"scenario": None} == right | {"scenario": None}  # nothing else differs
    plan = left["params"]["chaos"]
    assert [action["kind"] for action in plan["actions"]] == ["kill_coordinator"] * 5
    assert [action["at"] for action in plan["actions"]] == list(CRASH_POINTS)
    assert [action["target"] for action in plan["actions"]] == ["o0", None, None, None, None]
    assert plan["profile"] == "half-the-brains" and plan["api_fault_rate"] == 0.0
    assert left["params"]["membership"] is True

    for name in ("p1-swarm", "p1-durable-max"):
        assert api.post(f"/api/runs/{name}/verify").json()["ok"] is True  # replay MATCH
        assert api.get(f"/api/runs/{name}/metrics").json()["metrics"]["completed"] is True


def test_the_pairs_are_listed_for_the_ui(api: Api) -> None:
    assert api.get("/api/pairs").json() == []
    api.post("/api/arena", {"spec": SPEC, "rival": "central", "pair_id": "p2"})
    api.wait(lambda: api.get("/api/pairs/p2").json()["state"] == "completed", "the pair to end")
    [pair] = api.get("/api/pairs").json()
    assert pair == api.get("/api/pairs/p2").json()
    assert pair["pair_id"] == "p2" and pair["rival"] == "central" and pair["clock"] == "sim"
    assert pair["left"]["run_id"] == "p2-swarm" and pair["left"]["scenario"] == "swarm"
    assert pair["right"]["run_id"] == "p2-central" and pair["right"]["status"] == "completed"
    assert pair["chaos"] == {"name": "half-the-brains", "actions": 5}
    assert pair["input"] is None and pair["private"] is False and pair["seed"] == "1"
    assert api.get("/api/pairs/nope").status_code == 404


def test_a_pair_takes_the_plan_it_is_given(api: Api) -> None:
    custom = {
        "profile": "two-crashes",
        "seed": "1",
        "actions": [{"at": 0.3, "kind": "kill_coordinator"}],
    }
    body = {"spec": SPEC, "rival": "central", "pair_id": "p3", "chaos_plan": custom}
    api.wait_job(api.post("/api/arena", body).json()["job_id"])
    for name in ("p3-swarm", "p3-central"):
        assert started(api.runs / name)["params"]["chaos"]["profile"] == "two-crashes"

    calm = {"spec": SPEC, "rival": "central", "pair_id": "p4", "chaos": "C0"}
    api.wait_job(api.post("/api/arena", calm).json()["job_id"])
    assert started(api.runs / "p4-swarm")["params"]["chaos"]["actions"] == []


def test_the_default_rival_is_durable_max_and_the_default_plan_is_w1s() -> None:
    assert arena.pick_rival(None) == "durable-max"
    assert arena.rivals_available() == ["durable-max", "durable", "central", "single", "pipeline"]
    assert arena.half_the_brains("7") == ChaosPlan.model_validate(half_the_brains_plan("7"))
    assert arena.half_the_brains("7").seed == "7"


def test_a_pair_on_live_input_stays_private(api: Api) -> None:
    sample = live_sample(1)
    body = {k: sample[k] for k in ("conference", "talks", "notes")}
    intake_id = api.post("/api/intake", body).json()["intake_id"]
    api.wait(lambda: api.get(f"/api/intake/{intake_id}").json()["state"] == "proposed", "intake")
    assert api.post(f"/api/intake/{intake_id}/approve").status_code == 200

    spec = {"goal": "Program the live conference", "inputs": {"intake": intake_id}, "seed": "1"}
    launched = api.post("/api/arena", {"spec": spec, "rival": "central", "pair_id": "live1"}).json()
    assert launched["private"] is True
    api.wait_job(launched["job_id"])
    left, right = (started(api.private / "runs" / f"live1-{name}") for name in ("swarm", "central"))
    assert left["params"]["input"] == right["params"]["input"]
    assert left["params"]["input"]["source"] == "intake"
    assert left | {"scenario": None} == right | {"scenario": None}
    assert not (api.runs / "live1-swarm").exists() and not (api.runs / "live1-central").exists()
    [pair] = api.get("/api/pairs").json()
    assert pair["private"] is True and pair["input"]["truth_mode"] == "approved"
    assert pair["left"]["private"] is True


@pytest.mark.parametrize(
    ("body", "status", "needle"),
    [
        ({"rival": "central"}, 422, "spec"),
        ({"spec": SPEC, "rival": "swarm"}, 422, "rival must be one of"),
        ({"spec": SPEC, "rival": "nonsense"}, 422, "rival must be one of"),
        ({"spec": SPEC, "chaos": "C9"}, 422, "chaos"),
        ({"spec": SPEC, "chaos_plan": {"actions": [{"at": 3, "kind": "x"}]}}, 422, "chaos_plan"),
        (
            {"spec": SPEC, "chaos_plan": {"actions": [{"at": 0.5, "kind": "x"}]}},
            422,
            "actions.0.kind",
        ),
        ({"spec": SPEC, "chaos_plan": []}, 422, "chaos_plan"),
        ({"spec": SPEC, "pair_id": "a" * 75}, 422, "pair id"),
        ({"spec": SPEC, "pair_id": "../x"}, 422, "pair id"),
        ({"spec": SPEC, "backend": "real"}, 403, "preflight"),
        ({"spec": {"goal": "x"}}, 422, "give the input"),
    ],
)
def test_a_bad_pair_is_refused_before_anything_starts(
    api: Api, body: dict[str, Any], status: int, needle: str
) -> None:
    answer = api.post("/api/arena", body)
    assert answer.status_code == status, answer.text
    assert needle in answer.json()["error"]
    assert api.get("/api/jobs").json() == [] and api.get("/api/pairs").json() == []


def test_a_pair_id_can_be_used_once(api: Api) -> None:
    api.wait_job(
        api.post("/api/arena", {"spec": SPEC, "rival": "central", "pair_id": "p5"}).json()["job_id"]
    )
    again = api.post("/api/arena", {"spec": SPEC, "rival": "central", "pair_id": "p5"})
    assert again.status_code == 409 and "already used" in again.json()["error"]


# -- the live clock --------------------------------------------------------------------------


def live_pair(api: Api, pair_id: str, speed: float = 1.0) -> dict[str, Any]:
    body = {"spec": SPEC, "rival": "central", "pair_id": pair_id, "clock": "live", "speed": speed}
    answer = api.post("/api/arena", body)
    assert answer.status_code == 202, answer.text
    return answer.json()


def test_a_live_pair_starts_behind_a_barrier_and_finishes(api: Api) -> None:
    launched = live_pair(api, "l1", speed=20)
    job = api.wait_job(launched["job_id"])
    assert job["state"] == "completed", job
    barrier = api.private / "jobs" / launched["job_id"] / "barrier"
    assert sorted(path.name for path in barrier.iterdir()) == [
        BARRIER_GO,
        "l1-central.ready",
        "l1-swarm.ready",
    ]
    assert started(api.runs / "l1-swarm")["clock"] == "live"
    for name in ("l1-swarm", "l1-central"):
        assert api.get(f"/api/runs/{name}/metrics").json()["metrics"]["completed"] is True


def test_one_live_job_at_a_time_covers_the_pair(api: Api) -> None:
    launched = live_pair(api, "l2")
    try:
        other = api.post("/api/tasks", {"spec": SPEC, "clock": "live", "run_id": "other"})
        assert other.status_code == 409 and launched["job_id"] in other.json()["error"]
        second = api.post("/api/arena", {"spec": SPEC, "rival": "central", "clock": "live"})
        assert second.status_code == 409
    finally:
        assert api.post(f"/api/jobs/{launched['job_id']}/cancel").status_code == 200


def test_cancelling_a_pair_before_it_starts_kills_both_parked_processes(api: Api) -> None:
    launched = live_pair(api, "l3")
    cancelled = api.post(f"/api/jobs/{launched['job_id']}/cancel").json()
    assert cancelled["state"] == "cancelled"
    assert all(run["exit_code"] is not None for run in cancelled["runs"])
    assert api.get("/api/pairs/l3").json()["state"] == "cancelled"
    assert not (api.private / "jobs" / launched["job_id"] / "barrier" / BARRIER_GO).exists()


def test_cancelling_a_running_pair_halts_both_runs(api: Api) -> None:
    launched = live_pair(api, "l4")
    api.wait(
        lambda: all(
            run["status"] == "running"
            for run in api.get(f"/api/jobs/{launched['job_id']}").json()["runs"]
        ),
        "both runs to start",
    )
    assert api.post(f"/api/jobs/{launched['job_id']}/cancel").json()["state"] == "cancelled"
    for name in ("l4-swarm", "l4-central"):
        assert api.get(f"/api/runs/{name}").json()["status"] == "halted"


# -- a pair that cannot start ----------------------------------------------------------------


def test_a_pair_whose_process_dies_before_the_barrier_is_stopped(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(jobs, "LAUNCH", [jobs.sys.executable, "-c", "import sys; sys.exit(3)"])
    launched = live_pair(api, "l5")
    job = api.wait_job(launched["job_id"])
    assert job["state"] == "failed"
    api.wait(  # the job reads as failed as soon as both processes are gone; the reason follows
        lambda: any(
            "ended before the start barrier" in warning
            for warning in api.get(f"/api/jobs/{launched['job_id']}").json()["warnings"]
        ),
        "the reason the pair was stopped",
    )
    assert api.get("/api/pairs/l5").json()["state"] == "failed"


class Alive:
    pid = 4242

    def poll(self) -> None:
        return None


def test_a_pair_that_never_gets_ready_is_stopped(tmp_path: Path, monkeypatch) -> None:
    killed: list[int] = []
    monkeypatch.setattr(jobs, "kill_tree", killed.append)  # never signal a made-up pid
    manager = JobManager(PrivateDir(tmp_path / "private"), tmp_path / "runs", Catalog(tmp_path))
    job = manager.new_job("arena", "stand-in", "live", False, False)
    for name in ("a", "b"):
        run = {"run_id": name, "role": "x", "scenario": "swarm", "pid": 4242, "exit_code": None}
        job["runs"].append(run | {"dir": str(tmp_path / "runs" / name), "log": f"{name}.log"})
        manager.procs[(job["id"], name)] = Alive()  # type: ignore[assignment]
    manager.finish_launch(job, [])

    arena.release_when_ready(manager, job["id"], tmp_path / "barrier", ["a", "b"], timeout_s=0.3)
    assert manager.jobs[job["id"]]["state"] == "failed" and killed == [4242, 4242]
    assert "did not get ready" in manager.jobs[job["id"]]["warnings"][-1]
    assert not (tmp_path / "barrier" / BARRIER_GO).exists()
