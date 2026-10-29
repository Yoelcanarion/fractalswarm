"""The recovery numbers over HTTP: ``recovery`` in ``/metrics`` and ``GET /api/runs/{id}/recovery``.

Both are read from a run's own log (``bench/recovery.py``, ``verify/recovery.py``), and nothing
here calls a model. ``/recovery`` is shaped like ``/takeover``: 409 until the run has completed,
404 for a run that is not there, and one computation per run head.
"""

import asyncio
import shutil
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from fractalswarm.api.app import create_app
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import COLUMNS, EventStore, _to_row
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run
from fractalswarm.verify import recovery as recovery_check

REPO = Path(__file__).resolve().parents[2]
GOLDEN = REPO / "tests" / "golden"
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"


def api_over(tmp_path: Path, demo: Path) -> tuple[TestClient, Path]:
    runs = tmp_path / "runs"
    runs.mkdir()
    app = create_app(runs, demo, tmp_path / "bench", tmp_path / "static")
    return TestClient(app), runs


@pytest.fixture
def recorded(tmp_path: Path) -> TestClient:
    """The repository's own recorded runs: ``demo/backup`` is a real C3 swarm run, five kills."""
    return api_over(tmp_path, REPO / "demo")[0]


@pytest.fixture
def toy(tmp_path: Path) -> TestClient:
    demo = tmp_path / "demo"
    shutil.copytree(GOLDEN / "toy", demo / "toy")
    return api_over(tmp_path, demo)[0]


@pytest.fixture
def live(tmp_path: Path) -> TestClient:
    """A run that is still recording: the first ten events of the toy run, no end, and a LIVE
    marker that its process keeps touching."""
    client, runs = api_over(tmp_path, tmp_path / "demo")
    with EventStore.import_jsonl(GOLDEN / "toy" / "events.jsonl") as source:
        events: list[Event] = list(source.read())[:10]
    store = EventStore(runs / "live" / "events.sqlite")
    for event in events:
        store.db.execute(
            f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", _to_row(event)
        )
    store.close()
    (runs / "live" / "LIVE").write_text("1", encoding="utf-8")
    return client


@pytest.fixture(scope="module")
def supervised_run(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A ``durable-max`` run on T2 whose coordinator o0 crashes once, halfway."""
    runs = tmp_path_factory.mktemp("supervised-runs")
    run_dir = runs / "durable-crash"
    spec = TaskSpec.load(TASKSPEC)
    action = ChaosAction(at=0.5, kind="kill_coordinator", target="o0")
    chaos = ChaosPlan(profile="one-crash", seed="1", actions=(action,)).model_dump(mode="json")
    asyncio.run(
        record_run(
            "durable-max",
            run_id=run_dir.name,
            run_dir=run_dir,
            backend=fake_backend(),
            seed=spec.seed,
            params=run_params(spec) | {"chaos": chaos},
            run_cap_usd=spec.budget_usd,
        )
    )
    return runs


def supervised_api(supervised_run: Path, tmp_path: Path) -> TestClient:
    app = create_app(supervised_run, tmp_path / "demo", tmp_path / "bench", tmp_path / "static")
    return TestClient(app)


def test_metrics_carry_the_recovery_numbers_of_the_run(recorded: TestClient) -> None:
    body = recorded.get("/api/runs/demo-backup/metrics").json()
    recovery = body["recovery"]
    assert recovery is not None and recovery == body["metrics"]["recovery"]
    assert recovery["crashes"] == 5 and recovery["partitions"] == 0
    assert len(recovery["outages"]) == 5
    assert recovery["ttr_own_mean_s"] == pytest.approx(4.734, abs=1e-3)
    assert {"idle_agent_s", "cdt_s", "blast_sessions_mean_pct", "dup_usd", "preserved_pct"} <= set(
        recovery
    )
    assert recovery["false_death_remaps"] == 0 and recovery["dup_false_death_usd"] == 0.0


def test_a_run_without_a_crash_has_null_means_and_zero_totals(toy: TestClient) -> None:
    recovery = toy.get("/api/runs/demo-toy/metrics").json()["recovery"]
    assert recovery is not None
    assert recovery["crashes"] == 0 and recovery["outages"] == []
    assert recovery["ttr_own_mean_s"] is None and recovery["blast_sessions_mean_pct"] is None
    assert recovery["preserved_pct"] is None
    assert recovery["idle_agent_s"] == 0.0 and recovery["cdt_s"] == 0.0


def test_metrics_of_a_run_still_recording_have_recovery_too(live: TestClient) -> None:
    """A run in flight is scored from the log it has so far, as ``/metrics`` always did."""
    body = live.get("/api/runs/live/metrics").json()
    assert body["status"] != "completed"
    assert body["recovery"]["crashes"] == 0 and body["recovery"] == body["metrics"]["recovery"]


def test_recovery_reports_what_the_outages_of_a_swarm_run_cost(recorded: TestClient) -> None:
    answer = recorded.get("/api/runs/demo-backup/recovery")
    assert answer.status_code == 200
    report = answer.json()
    assert report["ok"] is True and report["events"] == 8177
    assert report["system"] == "swarm" and report["supervised"] is False
    assert report["restarts"] == []
    assert [check["name"] for check in report["checks"]] == [
        "restarted",
        "quiet",
        "consumed",
        "own_calls",
        "no_repeat",
    ]
    assert all("ok" in check and "violations" in check for check in report["checks"])
    outages = report["metrics"]["outages"]
    assert [row["coordinator"] for row in outages][0] == "o0"
    assert all(row["recovered"] for row in outages)
    assert recorded.get("/api/runs/demo-backup/metrics").json()["recovery"] == report["metrics"]


def test_recovery_reports_a_supervisors_restart_and_its_checks(
    supervised_run: Path, tmp_path: Path
) -> None:
    client = supervised_api(supervised_run, tmp_path)
    report = client.get("/api/runs/durable-crash/recovery").json()
    assert report["system"] == "durable-max" and report["supervised"] is True
    assert report["ok"] is True and all(check["ok"] for check in report["checks"])
    [restart] = report["restarts"]
    assert restart["coordinator"] == "o0" and restart["restarted_seq"] > restart["crashed_seq"]
    assert restart["down_s"] == pytest.approx(restart["announced_s"])
    [outage] = report["metrics"]["outages"]
    assert outage["kind"] == "crash" and outage["recovered"] and outage["level"] == 0
    metrics = client.get("/api/runs/durable-crash/metrics").json()
    assert metrics["recovery"] == report["metrics"]
    assert metrics["recovery"]["ttr_own_mean_s"] == pytest.approx(restart["down_s"])


def test_recovery_waits_for_the_run_to_end_and_knows_the_runs(live: TestClient) -> None:
    refused = live.get("/api/runs/live/recovery")
    assert refused.status_code == 409 and "not completed" in refused.json()["error"]
    assert live.get("/api/runs/nope/recovery").status_code == 404


def test_recovery_is_computed_once_per_run_head(
    recorded: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[Path] = []
    real = recovery_check.check_run

    def counting(run: Path | str):
        calls.append(Path(run))
        return real(run)

    monkeypatch.setattr(recovery_check, "check_run", counting)
    first = recorded.get("/api/runs/demo-backup/recovery").json()
    assert recorded.get("/api/runs/demo-backup/recovery").json() == first
    assert len(calls) == 1


def test_honesty_is_the_committed_file(tmp_path: Path) -> None:
    import json

    client, _ = api_over(tmp_path, tmp_path / "demo")
    (tmp_path / "bench").mkdir()
    committed = REPO / "bench" / "results" / "honesty.json"
    shutil.copy(committed, tmp_path / "bench" / "honesty.json")
    answer = client.get("/api/bench/honesty")
    assert answer.status_code == 200
    assert answer.json() == json.loads(committed.read_text(encoding="utf-8"))


def test_honesty_is_404_until_the_file_exists(tmp_path: Path) -> None:
    client, _ = api_over(tmp_path, tmp_path / "demo")
    answer = client.get("/api/bench/honesty")
    assert answer.status_code == 404 and "honesty.json" in answer.json()["error"]
