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
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.runs import RunPaths, record_run

REPO = Path(__file__).resolve().parents[2]
GOLDEN = REPO / "tests" / "golden"
TOY_HEAD = (GOLDEN / "toy" / "HEAD").read_text(encoding="utf-8").strip()
AS_JSON = {"Content-Type": "application/json"}  # what the UI sends on every POST


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
    report = client.post("/api/runs/demo-toy/verify", json={}).json()
    assert report["ok"] and report["replayed_head"] == TOY_HEAD and report["bundle_head_ok"]


def test_verify_reports_a_tampered_bundle(client: TestClient, dirs: dict[str, Path]) -> None:
    log = dirs["demo"] / "toy" / "events.jsonl"
    log.write_text(log.read_text(encoding="utf-8").replace("worker-a-r1", "worker-a-rX"))
    report = client.post("/api/runs/demo-toy/verify", json={}).json()
    assert not report["ok"] and report["first_divergence"] is not None


def test_bench_results_fall_back_to_the_fixture(client: TestClient, dirs) -> None:
    body = client.get("/api/bench/results").json()
    assert body["fixture"] and body["data"]["schema"] == "fractalswarm.hero/v1"
    dirs["bench"].mkdir()
    (dirs["bench"] / "hero_chart.json").write_text(json.dumps({"x": [0, 1]}))
    body = client.get("/api/bench/results").json()
    assert not body["fixture"] and body["data"] == {"x": [0, 1]}
    assert body["sets"] == []  # none of the recorded matrices is in this bench dir


def test_bench_results_serve_the_recorded_sets_not_the_placeholder(dirs) -> None:
    """The Charts page draws the committed matrices, never the placeholder while they exist."""
    app = create_app(dirs["runs"], dirs["demo"], REPO / "bench" / "results", dirs["static"])
    body = TestClient(app).get("/api/bench/results").json()
    assert not body["fixture"]
    assert [s["name"] for s in body["sets"]] == ["v1", "headline", "rivals-gate"]
    assert body["sets"][0]["source"] == "bench/results/v1/hero-t2_conference.json"
    assert body["data"] == body["sets"][0]["data"]  # the first set is the default
    v1, headline, _gate = (s["data"] for s in body["sets"])
    # The recorded shape: series keyed by workflow, each point with its seeds and their min and max.
    assert {"swarm", "central", "durable-max"} <= set(v1["series"])
    point = v1["series"]["swarm"]["points"][-1]
    assert point["profile"] == "C3" and point["seeds"] == ["1", "2"]
    assert point["stall_s_min"] <= point["stall_s"] <= point["stall_s_max"]
    assert set(headline["series"]) == {"swarm", "durable-max", "durable"}
    assert headline["series"]["swarm"]["points"][-1]["seeds"] == ["1", "2", "3"]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/api/runs/demo-toy/approve", {"approve": True}),
        ("/api/runs/demo-toy/chaos", {"kind": "kill_coordinator"}),
        ("/api/runs/demo-toy/escalations/e1", {"choice": "yes", "goal_id": "root"}),
    ],
)
def test_control_endpoints_refuse_a_recording(client: TestClient, path: str, body: dict) -> None:
    """The bundled demo is history: there is nothing live to control (test_live_control_api.py
    has the controls themselves)."""
    response = client.post(path, json=body)
    assert response.status_code == 409
    assert "recording" in response.json()["error"]


def test_capabilities_say_which_controls_are_real(
    client: TestClient, dirs: dict[str, Path], tmp_path: Path
) -> None:
    caps = client.get("/api/capabilities").json()
    # Without a private directory nothing can be launched; the controls act on live runs.
    assert caps == {
        "tasks": False,
        "chaos": True,
        "approve": True,
        "budget": True,
        "halt": True,
        "real": False,  # a billed launch needs the server flag and a key (api/spend.py)
    }
    assert client.get("/api/jobs").status_code == 503  # what "tasks: false" means

    # What it calls true is wired: a recording is refused for what it is, not for a stub.
    assert client.post("/api/runs/demo-toy/approve", json={}).status_code == 409
    assert client.post("/api/runs/demo-toy/chaos", json={"kind": "kill_half"}).status_code == 409
    assert client.post("/api/runs/demo-toy/halt", json={}).status_code == 409  # a recording

    launching = create_app(
        dirs["runs"], dirs["demo"], dirs["bench"], dirs["static"], private_dir=tmp_path / "private"
    )
    with TestClient(launching) as launch_client:
        assert launch_client.get("/api/capabilities").json()["tasks"] is True
        assert launch_client.get("/api/jobs").status_code == 200


@pytest.mark.parametrize(
    ("allow_real", "has_key", "real"),
    [(True, True, True), (False, True, False), (True, False, False)],
)
def test_capabilities_say_whether_a_billed_launch_can_pass_the_gate(
    dirs: dict[str, Path], tmp_path: Path, allow_real: bool, has_key: bool, real: bool
) -> None:
    from fractalswarm.api.spend import Spend, SpendGate

    gate = SpendGate(tmp_path / "ledger.sqlite", 150.0, allow_real=allow_real, has_key=has_key)
    app = create_app(
        dirs["runs"],
        dirs["demo"],
        dirs["bench"],
        dirs["static"],
        private_dir=tmp_path / "private",
        spend=Spend(gate),
    )
    caps = TestClient(app).get("/api/capabilities").json()
    assert caps["real"] is real and caps["tasks"] is True
    assert not gate.ledger_path.exists()  # asking never opens the ledger


@pytest.fixture
def recorded(dirs: dict[str, Path]) -> TestClient:
    """The API over the repository's own recorded runs: ``demo/backup`` is a real C3 run."""
    return TestClient(create_app(dirs["runs"], REPO / "demo", dirs["bench"], dirs["static"]))


def test_takeover_reports_what_a_finished_runs_log_proves(recorded: TestClient) -> None:
    answer = recorded.get("/api/runs/demo-backup/takeover")
    assert answer.status_code == 200
    report = answer.json()
    assert report["ok"] is True and report["violations"] == []
    assert report["run_id"] and report["events"] == 8177
    assert len(report["kills"]) == 5 and report["kills"][0]["target"] == "o0"
    assert recorded.get("/api/runs/demo-backup/takeover").json() == report  # the same, cached


def test_takeover_lists_the_violations_that_make_it_false(client: TestClient) -> None:
    report = client.get("/api/runs/demo-toy/takeover").json()  # a toy run: it wrote no task result
    assert report["ok"] is False
    kinds = {(v["check"], v["kind"]) for v in report["violations"]}
    assert ("lost-work", "task-result") in kinds
    assert all({"check", "kind", "seq", "detail"} <= set(v) for v in report["violations"])


def test_takeover_waits_for_the_run_to_end_and_knows_the_runs(
    client: TestClient, live: Path
) -> None:
    refused = client.get("/api/runs/live/takeover")
    assert refused.status_code == 409 and "not completed" in refused.json()["error"]
    assert client.get("/api/runs/nope/takeover").status_code == 404


@pytest.fixture
def live(client: TestClient, dirs: dict[str, Path]) -> Path:
    """A run that is still recording: its log has no end and no export yet, and its process
    keeps touching LIVE."""
    run_dir = dirs["runs"] / "live"
    write_sqlite(run_dir / "events.sqlite", golden_events()[:10]).close()
    (run_dir / "LIVE").write_text("1", encoding="utf-8")
    return run_dir


def test_halt_and_budget_drop_requests_into_the_live_runs_control_inbox(
    client: TestClient, live: Path
) -> None:
    halt = client.post("/api/runs/live/halt", json={"reason": "operator pressed stop"})
    assert halt.status_code == 200 and halt.json()["ok"]
    shock = client.post("/api/runs/live/budget", json={"usd": 0.5})
    assert shock.status_code == 200 and shock.json()["ok"]
    squad = {"usd": 0, "level": "squad", "key": "o2", "reason": "too hot"}
    assert client.post("/api/runs/live/budget", json=squad).status_code == 200
    assert client.post("/api/runs/live/halt", json={}).status_code == 200
    # The same requests ``fractalswarm halt`` and ``budget`` write, in the order they came.
    assert RunPaths(live).poll_control() == [
        {"op": "halt", "reason": "operator pressed stop", "by": "human"},
        {"op": "budget", "level": "run", "key": None, "usd": 0.5, "reason": "budget shock"},
        {"op": "budget", "level": "squad", "key": "o2", "usd": 0.0, "reason": "too hot"},
        {"op": "halt", "reason": "kill switch", "by": "human"},
    ]


@pytest.mark.parametrize("action", ["halt", "budget"])
def test_control_refuses_recordings_and_unknown_runs(
    client: TestClient, dirs: dict[str, Path], action: str
) -> None:
    body = {"usd": 1}
    assert client.post(f"/api/runs/demo-toy/{action}", json=body).status_code == 409
    assert client.post(f"/api/runs/nope/{action}", json=body).status_code == 404
    finished = dirs["runs"] / "finished"
    shutil.copytree(GOLDEN / "toy", finished)
    assert client.post(f"/api/runs/finished/{action}", json=body).status_code == 409
    # A run whose log already ends is finished even before its export lands.
    ended = dirs["runs"] / "ended"
    write_sqlite(ended / "events.sqlite", golden_events()).close()
    assert client.post(f"/api/runs/ended/{action}", json=body).status_code == 409
    for refused in (dirs["demo"] / "toy", finished, ended):
        assert not (refused / "control").exists()  # nothing was requested


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"usd": -1},
        {"usd": "a lot"},
        {"usd": True},
        {"usd": 1, "level": "galaxy"},
        {"usd": 1, "key": 7},
    ],
)
def test_budget_shock_validates_its_body(client: TestClient, live: Path, body: dict) -> None:
    response = client.post("/api/runs/live/budget", json=body)
    assert response.status_code == 422
    assert not (live / "control").exists()  # nothing was requested


@pytest.mark.parametrize("raw", [b'{"usd": Infinity}', b'{"usd": NaN}'])
def test_budget_shock_refuses_numbers_that_are_not_finite(
    client: TestClient, live: Path, raw: bytes
) -> None:
    assert client.post("/api/runs/live/budget", content=raw, headers=AS_JSON).status_code == 422
    assert not (live / "control").exists()


def test_halt_and_budget_need_a_json_object(client: TestClient, live: Path) -> None:
    halted = client.post("/api/runs/live/halt", content=b"{nope", headers=AS_JSON)
    assert halted.status_code == 422
    assert client.post("/api/runs/live/budget", json=[1]).status_code == 422
    assert not (live / "control").exists()


@pytest.mark.parametrize(
    ("action", "request_body"),
    [
        ("halt", {"reason": "operator pressed stop"}),
        ("budget", {"usd": 0.0, "reason": "CFO says stop"}),
    ],
)
async def test_the_endpoints_reach_a_run_that_is_recording(
    tmp_path: Path, action: str, request_body: dict
) -> None:
    """What the endpoint writes is what the live driver polls: the run records the request."""
    runs = tmp_path / "runs"
    client = TestClient(create_app(runs, None, tmp_path / "bench", tmp_path / "static"))
    answers: list[int] = []

    def script(body, attempt):  # the UI presses the button while round 2 is in flight
        if "item 2" in str(body["input"]) and not answers:
            answers.append(client.post(f"/api/runs/live/{action}", json=request_body).status_code)
        return "ok"

    await record_run(
        "toy",
        run_id="live",
        run_dir=runs / "live",
        backend=FakeBackend(script=script),
        params={"rounds": 3},
    )
    with RunPaths(runs / "live").open_log() as log:
        events = list(log.read())
    types = [event.type for event in events]
    assert answers == [200]
    if action == "halt":
        halted = next(event for event in events if event.type == "run.halted")
        assert halted.payload == {"reason": "operator pressed stop", "by": "human"}
        assert "toy.done" not in types
    else:
        shock = next(event for event in events if event.type == "budget.shock")
        capped = {"level": "run", "key": "live", "usd": 0.0, "reason": "CFO says stop"}
        assert shock.payload == capped
        assert "budget.refused" in types[types.index("budget.shock") :]


def test_chaos_validates_its_kind(client: TestClient) -> None:
    response = client.post("/api/runs/demo-toy/chaos", json={"kind": "kill_half"})
    assert response.status_code == 409  # a recording: the kind is fine
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
    assert client.get("/api/runs/live").json()["status"] == "interrupted"  # nobody records it
    (path.parent / "LIVE").write_text("1", encoding="utf-8")  # the recording process starts
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
