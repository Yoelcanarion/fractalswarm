"""The HTTP API, the event WebSocket and ``fractalswarm demo`` (spec §16, §17).

Everything here reads recorded bundles or a temp log; nothing calls a model.
"""

import json
import shutil
import threading
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient
from typer.testing import CliRunner

from fractalswarm.api import ws
from fractalswarm.api.app import create_app
from fractalswarm.cli import app as cli
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import COLUMNS, EventStore, _to_row

GOLDEN = Path(__file__).resolve().parents[1] / "golden"
TOY_HEAD = (GOLDEN / "toy" / "HEAD").read_text(encoding="utf-8").strip()


@pytest.fixture
def dirs(tmp_path: Path) -> dict[str, Path]:
    demo = tmp_path / "demo"
    shutil.copytree(GOLDEN / "toy", demo / "toy")
    runs = tmp_path / "runs"
    runs.mkdir()
    return {"runs": runs, "demo": demo, "bench": tmp_path / "bench", "static": tmp_path / "s"}


@pytest.fixture
def client(dirs: dict[str, Path]) -> TestClient:
    return TestClient(create_app(dirs["runs"], dirs["demo"], dirs["bench"], dirs["static"]))


def golden_events(name: str = "toy") -> list[Event]:
    with EventStore.import_jsonl(GOLDEN / name / "events.jsonl") as store:
        return list(store.read())


def write_sqlite(path: Path, events: list[Event]) -> EventStore:
    store = EventStore(path)
    append(store, events)
    return store


def append(store: EventStore, events: list[Event]) -> None:
    for event in events:
        store.db.execute(
            f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", _to_row(event)
        )
        store.last_seq, store.head_hash = event.seq, event.hash


def test_lists_and_summarizes_the_demo_bundle(client: TestClient) -> None:
    runs = client.get("/api/runs").json()
    assert [run["id"] for run in runs] == ["demo-toy"]
    toy = runs[0]
    assert toy["status"] == "completed" and toy["events"] == 56 and toy["head"] == TOY_HEAD
    summary = client.get("/api/runs/demo-toy").json()
    assert summary["chain"]["ok"] and summary["recorded_head"] == TOY_HEAD
    assert summary["counts"]["actor.spawned"] == 3
    assert client.get("/api/runs/nope").status_code == 404


def test_events_are_paged_by_seq(client: TestClient) -> None:
    page = client.get("/api/runs/demo-toy/events?from_seq=50&limit=5").json()
    assert [event["seq"] for event in page["events"]] == [50, 51, 52, 53, 54]
    assert page["next_seq"] == 55 and page["last_seq"] == 56 and not page["done"]
    rest = client.get("/api/runs/demo-toy/events?from_seq=55").json()
    assert rest["done"] and rest["events"][-1]["type"] == "run.completed"
    assert client.get("/api/runs/demo-toy/events?limit=0").status_code == 422


def test_verify_replays_the_bundle(client: TestClient) -> None:
    report = client.post("/api/runs/demo-toy/verify").json()
    assert report["ok"] and report["replayed_head"] == TOY_HEAD and report["bundle_head_ok"]


def test_verify_reports_a_tampered_bundle(client: TestClient, dirs: dict[str, Path]) -> None:
    log = dirs["demo"] / "toy" / "events.jsonl"
    log.write_text(log.read_text(encoding="utf-8").replace("worker-a-r1", "worker-a-rX"))
    report = client.post("/api/runs/demo-toy/verify").json()
    assert not report["ok"] and report["first_divergence"] is not None


def test_bench_results_fall_back_to_the_fixture(client: TestClient, dirs) -> None:
    body = client.get("/api/bench/results").json()
    assert body["fixture"] and body["data"]["schema"] == "fractalswarm.hero/v1"
    dirs["bench"].mkdir()
    (dirs["bench"] / "hero_chart.json").write_text(json.dumps({"x": [0, 1]}))
    body = client.get("/api/bench/results").json()
    assert not body["fixture"] and body["data"] == {"x": [0, 1]}


@pytest.mark.parametrize(
    "path",
    [
        "/api/tasks",
        "/api/runs/demo-toy/approve",
        "/api/runs/demo-toy/budget",
        "/api/runs/demo-toy/halt",
        "/api/runs/demo-toy/escalations/e1",
    ],
)
def test_control_endpoints_answer_501_until_wired(client: TestClient, path: str) -> None:
    response = client.post(path, json={})
    assert response.status_code == 501
    assert "not wired yet" in response.json()["detail"]


def test_chaos_validates_its_kind(client: TestClient) -> None:
    response = client.post("/api/runs/demo-toy/chaos", json={"kind": "kill_half"})
    assert response.status_code == 501 and response.json()["request"] == {"kind": "kill_half"}
    assert client.post("/api/runs/demo-toy/chaos", json={"kind": "boom"}).status_code == 422


def receive_all(socket) -> tuple[dict, list[dict], dict]:
    hello = socket.receive_json()
    events: list[dict] = []
    while True:
        message = socket.receive_json()
        if message["kind"] == "end":
            return hello, events, message
        events.extend(message["events"])


def test_ws_replays_a_finished_run_paced_by_virtual_time(client: TestClient) -> None:
    started = time.perf_counter()
    with client.websocket_connect("/api/runs/demo-toy/events?speed=5") as socket:
        hello, events, end = receive_all(socket)
    elapsed = time.perf_counter() - started
    assert hello["run"]["id"] == "demo-toy" and hello["speed"] == 5
    assert [event["seq"] for event in events] == list(range(1, 57))
    assert end["last_seq"] == 56
    # The toy run spans 1692 virtual ms; Windows timers are coarse (~16 ms), hence the margin.
    assert elapsed >= 1.692 / 5 * 0.6


def test_ws_resumes_from_seq(client: TestClient) -> None:
    with client.websocket_connect("/api/runs/demo-toy/events?from_seq=50&pace=none") as socket:
        _, events, _ = receive_all(socket)
    assert [event["seq"] for event in events] == list(range(50, 57))


def test_ws_tails_a_live_sqlite_log(client: TestClient, dirs, monkeypatch) -> None:
    monkeypatch.setattr(ws, "POLL_S", 0.02)
    events = golden_events()
    path = dirs["runs"] / "live" / "events.sqlite"
    write_sqlite(path, events[:10]).close()
    assert client.get("/api/runs/live").json()["status"] == "running"

    def writer_thread() -> None:  # another "process" keeps recording (own connection)
        time.sleep(0.1)
        with EventStore(path) as store:
            append(store, events[10:30])
            time.sleep(0.1)
            append(store, events[30:])

    with client.websocket_connect("/api/runs/live/events?from_seq=3") as socket:
        assert socket.receive_json()["kind"] == "hello"
        backlog = socket.receive_json()["events"]
        assert [event["seq"] for event in backlog] == list(range(3, 11))
        writer = threading.Thread(target=writer_thread)
        writer.start()
        _, tail, end = receive_all_after_hello(socket)
        writer.join()
    assert [event["seq"] for event in tail] == list(range(11, 57))
    assert end["last_seq"] == 56


def receive_all_after_hello(socket) -> tuple[None, list[dict], dict]:
    events: list[dict] = []
    while True:
        message = socket.receive_json()
        if message["kind"] == "end":
            return None, events, message
        events.extend(message["events"])


def test_ws_rejects_an_unknown_run(client: TestClient) -> None:
    with client.websocket_connect("/api/runs/nope/events") as socket:
        assert socket.receive_json()["kind"] == "error"


def test_static_ui_is_served_when_built(dirs: dict[str, Path]) -> None:
    dirs["static"].mkdir()
    (dirs["static"] / "index.html").write_text("<html>fractal</html>")
    client = TestClient(create_app(dirs["runs"], dirs["demo"], dirs["bench"], dirs["static"]))
    assert "fractal" in client.get("/").text
    assert client.get("/api/runs").status_code == 200


def test_demo_verify_prints_match_without_a_key(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_API_KEY", "")
    result = CliRunner().invoke(cli, ["demo", "--verify", "--no-serve"])
    assert result.exit_code == 0, result.output
    assert result.output.startswith("MATCH")


def test_demo_bundle_matches_the_golden_toy() -> None:
    demo = Path(__file__).resolve().parents[2] / "demo" / "toy"
    for name in ("events.jsonl", "cassette.jsonl", "HEAD"):
        assert (demo / name).read_bytes() == (GOLDEN / "toy" / name).read_bytes()
