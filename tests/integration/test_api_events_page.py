"""``GET /api/runs/{id}/events``: a page of a log that is still growing says if it is the end.

The UI opens a run, and the e2e test follows one, by paging until ``done``. ``done`` has to mean
"this page reached the end of the log as the page saw it". A run commits thousands of events a
second, so a ``done`` taken from a later look at the log (a second connection, after the page) is
false whenever anything was recorded in between, and a reader that pages until ``done`` runs
behind the run until the run is over.

A live log here is a log with a ``LIVE`` file and a second connection that goes on appending.
"The log never sits still" is a commit that lands the moment each reader connection is gone, the
worst moment for a reader that looks twice.
"""

import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from fractalswarm.api import catalog as catalog_module
from fractalswarm.api.app import create_app
from fractalswarm.kernel.events import Event, EventDraft
from fractalswarm.kernel.store import COLUMNS, EventStore, _to_row

RUN = "hot"
INSERT = f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"


def tick(n: int) -> Event:
    """The n-th event of the log, of a type the store does not check (the log is not chained)."""
    made = EventDraft(
        run_id=RUN,
        ts_virtual=n,
        lamport=n,
        type="test.tick",
        actor="o0",
        idem_key=f"tick:{n}",
        payload={"n": n},
    )
    return Event(**made.model_dump(), seq=n, prev_hash="-", hash=f"loose-{n}")


class Log:
    """A run that is recording: ``count`` events on disk, its ``LIVE`` file, and a connection that
    stays open (the recording process). ``append`` is another process writing: it takes a
    connection of its own, so the app's thread may call it."""

    def __init__(self, runs: Path, count: int, first: EventDraft | None = None) -> None:
        self.dir = runs / RUN
        self.path = self.dir / "events.sqlite"
        self.recorder = EventStore(self.path)
        self.count = 0
        if first is not None:
            self.recorder.append(first)
            self.count = 1
        while self.count < count:
            self.append()
        (self.dir / "LIVE").write_text("1", encoding="utf-8")

    def append(self) -> None:
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            self.count += 1
            db.execute(INSERT, _to_row(tick(self.count)))

    def export(self) -> None:
        """Leave the run as a recorded bundle: ``events.jsonl`` and nothing else."""
        self.recorder.close()
        with EventStore(self.path) as store:
            store.export_jsonl(self.dir / "events.jsonl")
        for name in ("events.sqlite", "events.sqlite-wal", "events.sqlite-shm"):
            (self.dir / name).unlink(missing_ok=True)


@pytest.fixture
def world(tmp_path: Path) -> dict[str, Any]:
    runs = tmp_path / "runs"
    runs.mkdir()
    app = create_app(runs, None, tmp_path / "bench", tmp_path / "s")
    return {"client": TestClient(app), "runs": runs}


def never_sits_still(monkeypatch: pytest.MonkeyPatch, log: Log, until: int = 10_000) -> list[int]:
    """Every reader connection that closes is followed by one more event, up to ``until`` events.
    The list counts the connections."""
    opened: list[int] = []

    class Growing(catalog_module._readonly):
        def __exit__(self, *exc: object) -> None:
            super().__exit__(*exc)
            opened.append(1)
            if log.count < until:
                log.append()

    monkeypatch.setattr(catalog_module, "_readonly", Growing)
    return opened


def page_until_done(client: TestClient, limit: int, most: int) -> tuple[list[dict[str, Any]], int]:
    """What the e2e test and the UI do: pages from seq 1 until ``done``. Stops after ``most``."""
    found: list[dict[str, Any]] = []
    seq, requests = 1, 0
    while requests < most:
        requests += 1
        page = client.get(f"/api/runs/{RUN}/events?from_seq={seq}&limit={limit}").json()
        found += page["events"]
        if page["done"]:
            break
        seq = page["next_seq"]
    return found, requests


def test_a_reader_reaches_done_on_a_log_that_never_sits_still(
    world: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    log = Log(world["runs"], count=30)
    never_sits_still(monkeypatch, log)
    found, requests = page_until_done(world["client"], limit=10, most=12)
    assert requests <= 5, "done was never true: the reader chased the log"
    assert [event["seq"] for event in found] == list(range(1, len(found) + 1))
    assert len(found) >= 30  # what was there when it started, and what came while it read


def test_done_is_the_end_of_the_snapshot_the_page_came_from(
    world: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    log = Log(world["runs"], count=25)
    client = world["client"]

    def page(from_seq: int) -> dict[str, Any]:
        return client.get(f"/api/runs/{RUN}/events?from_seq={from_seq}&limit=10").json()

    first = page(1)
    assert (first["next_seq"], first["last_seq"], first["done"]) == (11, 25, False)
    last = page(21)
    assert [event["seq"] for event in last["events"]] == [21, 22, 23, 24, 25]
    assert (last["next_seq"], last["last_seq"], last["done"]) == (26, 25, True)
    exact = page(16)  # the page ends where the log does
    assert (exact["next_seq"], exact["last_seq"], exact["done"]) == (26, 25, True)
    beyond = page(40)
    assert (beyond["events"], beyond["next_seq"], beyond["last_seq"]) == ([], 40, 25)
    assert beyond["done"] is True

    never_sits_still(monkeypatch, log)
    # a commit after the page was read does not change what that page said: the next page has it
    assert (page(21)["last_seq"], page(21)["done"]) == (25, True)
    after = page(26)
    assert after["events"][0]["seq"] == 26 and after["last_seq"] >= 26


def test_a_commit_between_the_page_and_the_last_seq_is_not_in_the_last_seq(
    world: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The page and the last seq are one snapshot: a commit that lands after the page was read,
    before the last seq is, does not move the last seq the page reports."""
    log = Log(world["runs"], count=25)

    class Between:
        """The reader's connection; the run commits just before it asks for the last seq."""

        def __init__(self, db: sqlite3.Connection) -> None:
            self.db = db

        def execute(self, sql: str, *params: Any) -> sqlite3.Cursor:
            if "max(seq)" in sql:
                log.append()
            return self.db.execute(sql, *params)

    class Interleaved(catalog_module._readonly):
        def __enter__(self) -> Any:
            return Between(super().__enter__())

    monkeypatch.setattr(catalog_module, "_readonly", Interleaved)
    client = world["client"]
    page = client.get(f"/api/runs/{RUN}/events?from_seq=21&limit=10").json()
    assert log.count == 26, "the commit did not land between the two reads"
    assert [event["seq"] for event in page["events"]] == [21, 22, 23, 24, 25]
    assert (page["next_seq"], page["last_seq"], page["done"]) == (26, 25, True)


def test_a_page_is_read_in_one_connection(
    world: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    Log(world["runs"], count=12)
    connections: list[sqlite3.Connection] = []
    original = sqlite3.connect

    def counting(*args: Any, **kwargs: Any) -> sqlite3.Connection:
        connection = original(*args, **kwargs)
        connections.append(connection)
        return connection

    monkeypatch.setattr(catalog_module.sqlite3, "connect", counting)
    page = world["client"].get(f"/api/runs/{RUN}/events?from_seq=1&limit=5").json()
    assert len(page["events"]) == 5 and page["last_seq"] == 12
    assert len(connections) == 1


def test_a_recorded_bundle_pages_to_its_end(world: dict[str, Any]) -> None:
    """An exported log (no sqlite file) has the same pages: ``last_seq`` is its last event."""
    Log(world["runs"], count=12).export()
    client = world["client"]
    page = client.get(f"/api/runs/{RUN}/events?from_seq=8&limit=3").json()
    assert [event["seq"] for event in page["events"]] == [8, 9, 10]
    assert (page["next_seq"], page["last_seq"], page["done"]) == (11, 12, False)
    rest = client.get(f"/api/runs/{RUN}/events?from_seq=11&limit=3").json()
    assert (rest["next_seq"], rest["last_seq"], rest["done"]) == (13, 12, True)


def test_the_scan_for_an_escalation_ends_on_a_log_that_never_sits_still(
    world: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """``POST .../escalations/{eid}`` reads the log to find the goal the escalation was opened
    for. On a live run that scan must end, not follow the log until the run does."""
    started = EventDraft(
        run_id=RUN,
        ts_virtual=0,
        lamport=0,
        type="run.started",
        actor="o0",
        idem_key="run.started",
        payload={
            "seed": "0",
            "scenario": "swarm",
            "clock": "live",
            "params": {"live_control": True},
        },
    )
    log = Log(world["runs"], count=40, first=started)
    opened = never_sits_still(monkeypatch, log, until=400)
    response = world["client"].post(f"/api/runs/{RUN}/escalations/nope", json={"choice": "A"})
    assert response.status_code == 404, response.text
    assert len(opened) < 20, f"the scan opened {len(opened)} connections: it followed the log"
