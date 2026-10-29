"""The API refuses the ways a web page could reach it (``api/guard.py``): a Host that is not ours
(DNS rebinding), a POST that is not JSON (a cross-site form), a WebSocket from another origin."""

import json
import re
import shutil
from pathlib import Path
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from typer.testing import CliRunner

from fractalswarm.api.app import create_app
from fractalswarm.cli import app as cli

GOLDEN = Path(__file__).resolve().parents[1] / "golden"
SPEC = {
    "goal": "Program the conference",
    "inputs": {"fixture": "tasks/fixtures/t2/seed-1", "generate_seed": 1},
    "seed": "1",
}
EVIL = "evil.example"
NOTHING = {"colour": "red"}  # a body no route can act on
POLICY_VIOLATION = 1008


@pytest.fixture
def server(tmp_path: Path) -> Starlette:
    """The API with a private directory, so the launch routes are real."""
    demo = tmp_path / "demo"
    shutil.copytree(GOLDEN / "toy", demo / "toy")
    runs = tmp_path / "runs"
    runs.mkdir()
    return create_app(
        runs, demo, tmp_path / "bench", tmp_path / "s", private_dir=tmp_path / "private"
    )


def reached_as(app: Starlette, host: str) -> TestClient:
    """A client whose requests say ``Host: host``, as a browser sends it."""
    return TestClient(app, headers={"Host": host})


def route_paths(app: Starlette) -> list[tuple[Any, str]]:
    return [(route, re.sub(r"\{[^}]+\}", "x", route.path)) for route in app.routes]


# -- Host: DNS rebinding -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "host", ["127.0.0.1", "127.0.0.1:8765", "localhost", "LocalHost:5173", "[::1]:8765", "[::1]"]
)
def test_the_loopback_names_reach_the_api(server: Starlette, host: str) -> None:
    assert reached_as(server, host).get("/api/capabilities").status_code == 200


@pytest.mark.parametrize(
    "host",
    [
        EVIL,
        f"{EVIL}:8765",
        "127.0.0.1.evil.example",  # starts like ours
        "localhost.evil.example",
        "evil.example.localhost.",
        "localhost:8765@evil.example",  # not the shape of a Host header
        "127.0.0.1@evil.example",
        "0.0.0.0",
        "192.168.1.20:8765",
        "[::2]",
        "testserver",
        "",
    ],
)
def test_a_name_that_is_not_ours_is_refused(server: Starlette, host: str) -> None:
    refused = reached_as(server, host).get("/api/capabilities")
    assert refused.status_code == 400 and refused.json() == {"error": "invalid host header"}


def test_a_rebound_page_cannot_read_what_is_private_or_start_a_run(server: Starlette) -> None:
    """The point of the check: the page is same-origin with the API after the name re-resolves."""
    own, rebound = TestClient(server), reached_as(server, EVIL)
    assert own.get("/api/intake/nope").status_code == 404  # the route answers a name that is ours
    assert rebound.get("/api/intake/nope").status_code == 400
    assert rebound.get("/api/jobs").status_code == 400
    assert rebound.post("/api/tasks", json={"spec": SPEC}).status_code == 400
    assert own.get("/api/jobs").json() == []  # nothing was started


def test_every_route_checks_the_host(server: Starlette) -> None:
    client = reached_as(server, EVIL)
    checked = 0
    for route, path in route_paths(server):
        if isinstance(route, WebSocketRoute):
            with pytest.raises(WebSocketDisconnect) as refused, client.websocket_connect(path):
                pass
            assert refused.value.code == POLICY_VIOLATION
        else:
            for method in sorted((route.methods or {"GET"}) - {"HEAD"}):
                answer = client.request(method, path, json={} if method == "POST" else None)
                assert answer.status_code == 400, (method, path)
        checked += 1
    assert checked >= 25  # the loop is not vacuous: every route of the app, the UI included


def test_the_address_serve_was_given_is_allowed_too(tmp_path: Path) -> None:
    app = create_app(
        tmp_path / "runs",
        None,
        tmp_path / "b",
        tmp_path / "s",
        allowed_hosts=("DevBox.lan", "[fe80::1]"),
    )
    for host in ("devbox.lan", "DEVBOX.LAN:8765", "[fe80::1]:8765"):
        assert reached_as(app, host).get("/api/capabilities").status_code == 200, host
    for host in ("other.lan", "devbox.lan.evil.example", EVIL):
        assert reached_as(app, host).get("/api/capabilities").status_code == 400, host


def test_serve_and_demo_pass_their_host_to_the_guard(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    started: list[Any] = []
    monkeypatch.setattr("uvicorn.run", lambda app, **kwargs: started.append(app))
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("FRACTALSWARM_PRIVATE_DIR", str(tmp_path / "private"))
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "ledger.sqlite"))
    monkeypatch.delenv("FRACTALSWARM_ALLOW_UI_REAL", raising=False)
    for command in (["serve"], ["demo", "--no-browser"]):
        result = CliRunner().invoke(cli, [*command, "--host", "192.168.1.20", "--port", "9999"])
        assert result.exit_code == 0, result.output
    assert len(started) == 2
    for app in started:
        assert reached_as(app, "192.168.1.20:9999").get("/api/capabilities").status_code == 200
        assert reached_as(app, "localhost:9999").get("/api/capabilities").status_code == 200
        assert reached_as(app, EVIL).get("/api/capabilities").status_code == 400


# -- Content-Type: a cross-site form -------------------------------------------------------------

NOT_JSON = [
    None,
    "text/plain",
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=x",
    "application/jsonx",
    "application/json-patch+json",
    "json",
]


@pytest.mark.parametrize("content_type", NOT_JSON)
def test_a_post_that_is_not_json_is_refused(server: Starlette, content_type: str | None) -> None:
    client = TestClient(server)
    headers = {} if content_type is None else {"Content-Type": content_type}
    refused = client.post("/api/tasks", content=b'{"spec": {}}', headers=headers)
    assert refused.status_code == 415
    assert "application/json" in refused.json()["error"]


def test_a_cross_site_form_cannot_start_a_run_or_a_job_or_a_halt(server: Starlette) -> None:
    """What a page can send without a CORS preflight: a body of any of the three simple types,
    which a person's browser sends with their cookies and from their machine."""
    client = TestClient(server)
    body = json.dumps({"spec": SPEC})
    for content_type in ("text/plain", "application/x-www-form-urlencoded", None):
        headers = {} if content_type is None else {"Content-Type": content_type}
        for path in ("/api/tasks", "/api/arena", "/api/intake", "/api/runs/demo-toy/halt"):
            assert client.post(path, content=body, headers=headers).status_code == 415, path
        assert client.post("/api/jobs/nope/cancel", headers=headers).status_code == 415
    assert client.get("/api/jobs").json() == []  # not one job was started


@pytest.mark.parametrize(
    "content_type",
    [
        "application/json",
        "application/json; charset=utf-8",
        "APPLICATION/JSON",
        "Application/Json;charset=UTF-8",
    ],
)
def test_a_json_post_reaches_the_route(server: Starlette, content_type: str) -> None:
    answer = TestClient(server).post(
        "/api/tasks", content=b"{}", headers={"Content-Type": content_type}
    )
    assert answer.status_code == 422  # the route ran, and found no spec


def test_every_post_route_asks_for_json(server: Starlette) -> None:
    client = TestClient(server)
    posts = [
        path
        for route, path in route_paths(server)
        if isinstance(route, Route) and "POST" in (route.methods or ())
    ]
    assert len(posts) >= 14
    for path in posts:
        text = client.post(path, content=b"{}", headers={"Content-Type": "text/plain"})
        assert text.status_code == 415, path
        assert client.post(path, json=NOTHING).status_code != 415, path


def test_a_get_needs_no_content_type(server: Starlette) -> None:
    assert TestClient(server).get("/api/runs").status_code == 200


# -- Origin: a cross-site WebSocket --------------------------------------------------------------

EVENTS = "/api/runs/demo-toy/events?pace=none"


def open_socket(app: Starlette, host: str, origin: str | None) -> str:
    """Connect as a browser on ``host`` would, from a page at ``origin``; returns the first
    message's kind."""
    headers = {"Host": host} | ({} if origin is None else {"Origin": origin})
    with TestClient(app).websocket_connect(EVENTS, headers=headers) as socket:
        return socket.receive_json()["kind"]


@pytest.mark.parametrize(
    ("host", "origin"),
    [
        ("127.0.0.1:8765", "http://127.0.0.1:8765"),  # the UI the server itself serves
        ("localhost:8765", "http://localhost:8765"),
        ("localhost:5173", "http://localhost:5173"),  # the Vite dev server, proxying /api
        ("[::1]:8765", "http://[::1]:8765"),
        ("127.0.0.1", None),  # a CLI client sends no Origin
    ],
)
def test_a_page_this_server_served_may_open_the_socket(
    server: Starlette, host: str, origin: str | None
) -> None:
    assert open_socket(server, host, origin) == "hello"


@pytest.mark.parametrize(
    ("host", "origin"),
    [
        ("127.0.0.1:8765", "https://evil.example"),  # a page on the web
        ("127.0.0.1:8765", "http://evil.example:8765"),
        ("127.0.0.1:8765", "null"),  # a sandboxed frame, a local file
        ("127.0.0.1:8765", "http://127.0.0.1:9999"),  # another local server
        ("127.0.0.1:8765", "http://localhost:8765"),  # same machine, not the same origin
        ("127.0.0.1:8765", "ftp://127.0.0.1:8765"),
        ("127.0.0.1:8765", ""),
        (EVIL, f"http://{EVIL}"),  # rebinding: same origin for the browser, not for us
    ],
)
def test_any_other_origin_is_refused(server: Starlette, host: str, origin: str) -> None:
    with pytest.raises(WebSocketDisconnect) as refused:
        open_socket(server, host, origin)
    assert refused.value.code == POLICY_VIOLATION
