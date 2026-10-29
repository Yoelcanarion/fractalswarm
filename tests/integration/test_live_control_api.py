"""The control routes of step 7: what the UI posts becomes a control in the run's inbox.

Nothing here runs a model or a process: a live run is a log with a ``LIVE`` file, as in
test_api.py, and the inbox is read back the way the run's driver reads it.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from fractalswarm.api.app import create_app
from fractalswarm.api.controls import KILL_HALF_TARGETS
from fractalswarm.cli import kill_half_plan
from fractalswarm.kernel.events import Event, EventDraft
from fractalswarm.kernel.store import COLUMNS, EventStore, _to_row
from fractalswarm.runs import RunPaths

GOLDEN = Path(__file__).resolve().parents[2] / "tests" / "golden"
AS_JSON = {"Content-Type": "application/json"}


def golden_events() -> list[Event]:
    with EventStore.import_jsonl(GOLDEN / "toy" / "events.jsonl") as store:
        return list(store.read())


def write_log(path: Path, events: list[Event]) -> None:
    with EventStore(path) as store:
        for event in events:
            store.db.execute(
                f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                _to_row(event),
            )


def draft(run: str, n: int, kind: str, payload: dict[str, Any]) -> EventDraft:
    return EventDraft(
        run_id=run,
        ts_virtual=n,
        lamport=n,
        type=kind,
        actor="o0",
        idem_key=f"{kind}:{n}",
        payload=payload,
    )


def live_run(
    runs: Path,
    name: str,
    *,
    live_control: bool = True,
    auto_approve: bool = False,
    extra: tuple[tuple[str, dict[str, Any]], ...] = (),
) -> Path:
    """A run that is still recording, launched (or not) to take a person's controls. ``extra``
    are events of types this branch does not know (an escalation): the log is not chained."""
    params: dict[str, Any] = {"spec": {"auto_approve": auto_approve}}
    if live_control:
        params["live_control"] = True
    run_dir = runs / name
    with EventStore(run_dir / "events.sqlite") as store:
        started = {"seed": "0", "scenario": "swarm", "clock": "sim", "params": params}
        store.append(draft(name, 0, "run.started", started))
        for n, (kind, payload) in enumerate(extra, start=1):
            made = draft(name, n, kind, payload)
            row = Event(**made.model_dump(), seq=store.next_seq, prev_hash="-", hash=f"loose-{n}")
            store.db.execute(
                f"INSERT INTO events ({COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                _to_row(row),
            )
    (run_dir / "LIVE").write_text("1", encoding="utf-8")
    return run_dir


@pytest.fixture
def world(tmp_path: Path) -> dict[str, Any]:
    runs = tmp_path / "runs"
    runs.mkdir()
    demo = tmp_path / "demo"
    (demo).mkdir()
    private = tmp_path / "private"
    app = create_app(runs, demo, tmp_path / "bench", tmp_path / "s", private_dir=private)
    with TestClient(app) as client:
        yield {"client": client, "runs": runs, "private": private}


def inbox(run_dir: Path) -> list[dict[str, Any]]:
    return RunPaths(run_dir).poll_control()


def sent(run_dir: Path) -> list[dict[str, Any]]:
    """The controls in a run's inbox, without the envelope."""
    return [request["control"] for request in inbox(run_dir)]


# -- chaos ----------------------------------------------------------------------------------------


def test_a_kill_is_a_chaos_control_for_the_monkey(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    body = {"kind": "kill_coordinator", "at": 0.5, "target": "o1"}
    response = world["client"].post("/api/runs/r/chaos", json=body)
    assert response.status_code == 200 and response.json()["ok"]
    assert inbox(run) == [
        {
            "op": "inject",
            "control": {
                "op": "chaos",
                "body": {"kind": "kill_coordinator", "at": 0.5, "target": "o1"},
                "to": "chaos",
            },
        }
    ]


def test_a_kill_with_no_progress_point_is_for_now(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    assert world["client"].post("/api/runs/r/chaos", json={"kind": "kill_coordinator"}).is_success
    (control,) = sent(run)
    assert control["body"] == {"kind": "kill_coordinator", "at": 0.0}


def test_kill_half_kills_the_five_the_chaos_profile_does(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    body = {"kind": "kill_half", "profile": "C3", "at": 0.25}  # the UI sends a profile too
    assert world["client"].post("/api/runs/r/chaos", json=body).is_success
    controls = sent(run)
    assert [c["body"]["target"] for c in controls] == list(KILL_HALF_TARGETS)
    assert {c["body"]["at"] for c in controls} == {0.25}
    assert all(c["to"] == "chaos" and c["body"]["kind"] == "kill_coordinator" for c in controls)
    planned = [action["target"] for action in kill_half_plan("0")["actions"]]
    assert list(KILL_HALF_TARGETS) == planned  # the half is the same as the plan's


def test_an_agent_kill_names_its_agent_or_says_how_many(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    client = world["client"]
    assert client.post("/api/runs/r/chaos", json={"kind": "kill_agent", "target": "a1"}).is_success
    assert client.post("/api/runs/r/chaos", json={"kind": "kill_agent", "target": None}).is_success
    assert client.post("/api/runs/r/chaos", json={"kind": "kill_agent", "count": 3}).is_success
    named, anyone, several = (c["body"] for c in sent(run))
    assert named == {"kind": "kill_agent", "at": 0.0, "target": "a1"}
    assert anyone == {"kind": "kill_agent", "at": 0.0}
    assert several == {"kind": "kill_agent", "at": 0.0, "count": 3}


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "boom"},
        {},
        {"kind": "kill_coordinator", "at": 1.5},
        {"kind": "kill_coordinator", "at": -0.1},
        {"kind": "kill_coordinator", "at": "soon"},
        {"kind": "kill_coordinator", "at": True},
        {"kind": "kill_coordinator", "at": float("nan")},
        {"kind": "kill_coordinator", "target": 7},
        {"kind": "kill_coordinator", "target": "../x"},
        {"kind": "kill_agent", "count": 0},
        {"kind": "kill_agent", "count": 1.5},
        {"kind": "kill_agent", "count": True},
        {"kind": "api_storm"},
        {"kind": "net_fault"},
    ],
)
def test_a_chaos_request_that_is_not_a_kill_is_refused_and_sends_nothing(
    world: dict[str, Any], body: dict[str, Any]
) -> None:
    run = live_run(world["runs"], "r")
    response = world["client"].post(
        "/api/runs/r/chaos", content=json.dumps(body, allow_nan=True), headers=AS_JSON
    )
    assert response.status_code == 422, response.text
    assert inbox(run) == []


def test_a_storm_says_why_it_cannot_be_injected(world: dict[str, Any]) -> None:
    live_run(world["runs"], "r")
    answer = world["client"].post("/api/runs/r/chaos", json={"kind": "api_storm"}).json()
    assert "chaos plan a run starts with" in answer["error"]


# -- the run must be live and launched to take controls -------------------------------------------


@pytest.mark.parametrize(
    ("route", "body"),
    [
        ("chaos", {"kind": "kill_coordinator"}),
        ("approve", {"approve": True}),
        ("escalations/e1", {"choice": "yes", "goal_id": "root"}),
    ],
)
def test_a_run_not_launched_to_take_controls_answers_409(
    world: dict[str, Any], route: str, body: dict[str, Any]
) -> None:
    run = live_run(world["runs"], "cli", live_control=False)
    response = world["client"].post(f"/api/runs/cli/{route}", json=body)
    assert (
        response.status_code == 409 and "not launched to take controls" in response.json()["error"]
    )
    assert inbox(run) == []


@pytest.mark.parametrize(
    "route", ["chaos", "approve", "escalations/e1"]
)  # a recording, as the bundled demo run is
def test_a_recording_and_an_unknown_run_take_no_controls(world: dict[str, Any], route: str) -> None:
    client = world["client"]
    body = {"kind": "kill_coordinator", "choice": "yes", "goal_id": "root"}
    run_dir = world["runs"] / "done"
    write_log(run_dir / "events.sqlite", golden_events())  # finished, and nobody records it
    assert client.post(f"/api/runs/done/{route}", json=body).status_code == 409
    assert client.post(f"/api/runs/nope/{route}", json=body).status_code == 404


# -- approve ---------------------------------------------------------------------------------------


def test_an_approval_is_a_control_for_the_goal(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    body = {"goal_id": "root", "approve": True, "reason": ""}  # what the UI's button posts
    assert world["client"].post("/api/runs/r/approve", json=body).is_success
    assert sent(run) == [{"op": "approve", "body": {}, "to": "goal:root"}]


def test_a_rejection_sends_the_plan_back_with_its_reason(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    client = world["client"]
    reject = {"goal_id": "root", "approve": False, "reason": "keep the keynote out of slot one"}
    assert client.post("/api/runs/r/approve", json=reject).is_success
    assert client.post("/api/runs/r/approve", json={"approve": False}).is_success
    first, second = sent(run)
    assert first == {
        "op": "replan",
        "body": {"feedback": "keep the keynote out of slot one"},
        "to": "goal:root",
    }
    assert second["body"] == {"feedback": "the plan was not approved"} and second["op"] == "replan"


def test_an_approval_can_name_the_plan_it_approves(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    body = {"approve": True, "plan_hash": "abc123"}
    assert world["client"].post("/api/runs/r/approve", json=body).is_success
    assert sent(run) == [{"op": "approve", "body": {"plan_hash": "abc123"}, "to": "goal:root"}]


@pytest.mark.parametrize(
    "body",
    [
        {"approve": "yes"},
        {"approve": 1},
        {"goal_id": "no spaces"},
        {"goal_id": 3},
        {"reason": "x" * 2001, "approve": False},
        {"plan_hash": 7},
    ],
)
def test_an_approval_that_is_not_one_is_refused(
    world: dict[str, Any], body: dict[str, Any]
) -> None:
    run = live_run(world["runs"], "r")
    assert world["client"].post("/api/runs/r/approve", json=body).status_code == 422
    assert inbox(run) == []


def test_a_run_that_does_not_wait_for_approval_says_so(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "auto", auto_approve=True)
    response = world["client"].post("/api/runs/auto/approve", json={"approve": True})
    assert response.status_code == 409 and "does not wait for approval" in response.json()["error"]
    assert inbox(run) == []


# -- escalations -----------------------------------------------------------------------------------


def test_an_answer_goes_to_the_goal_that_opened_the_escalation(world: dict[str, Any]) -> None:
    opened = ("escalation.opened", {"escalation_id": "e1", "goal_id": "g7", "reason": "stuck"})
    run = live_run(world["runs"], "r", extra=(opened,))
    response = world["client"].post("/api/runs/r/escalations/e1", json={"choice": "retry"})
    assert response.status_code == 200, response.text
    assert sent(run) == [
        {
            "op": "answer",
            "body": {"escalation_id": "e1", "choice": "retry"},
            "to": "goal:g7",
        }
    ]


def test_an_answer_finds_its_escalation_by_any_of_the_ids_the_log_uses(
    world: dict[str, Any],
) -> None:
    run = live_run(world["runs"], "r", extra=(("escalation.raised", {"eid": "e9", "goal": "g2"}),))
    assert world["client"].post("/api/runs/r/escalations/e9", json={"choice": "skip"}).is_success
    assert sent(run)[0]["to"] == "goal:g2"


def test_an_answer_for_an_escalation_the_log_does_not_know_needs_its_goal(
    world: dict[str, Any],
) -> None:
    run = live_run(world["runs"], "r")
    client = world["client"]
    assert client.post("/api/runs/r/escalations/e1", json={"choice": "x"}).status_code == 404
    named = {"choice": "x", "goal_id": "g3"}
    assert client.post("/api/runs/r/escalations/e1", json=named).is_success
    assert sent(run)[0]["to"] == "goal:g3"


def test_an_answer_needs_a_choice_and_a_valid_id(world: dict[str, Any]) -> None:
    run = live_run(world["runs"], "r")
    client = world["client"]
    body = {"goal_id": "g3"}
    assert client.post("/api/runs/r/escalations/e1", json=body).status_code == 422
    assert client.post("/api/runs/r/escalations/e1", json=body | {"choice": 5}).status_code == 422
    assert (
        client.post("/api/runs/r/escalations/a%20b", json=body | {"choice": "x"}).status_code == 422
    )
    assert inbox(run) == []


# -- pairs -----------------------------------------------------------------------------------------


def make_pair(world: dict[str, Any], pair_id: str, left: Path, right: Path) -> None:
    pairs = world["private"] / "pairs"
    pairs.mkdir(parents=True, exist_ok=True)
    side = lambda run: {"run_id": run.name, "scenario": "x", "dir": str(run), "private": False}  # noqa: E731
    manifest = {
        "pair_id": pair_id,
        "created_at": "2026-10-29T12:00:00Z",
        "job_id": "none",
        "left": side(left),
        "right": side(right),
    }
    (pairs / f"{pair_id}.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_a_pair_gets_the_same_control_in_both_runs(world: dict[str, Any]) -> None:
    left = live_run(world["runs"], "p-swarm")
    right = live_run(world["runs"], "p-central")
    make_pair(world, "p", left, right)
    body = {"kind": "kill_coordinator", "at": 0.4}
    response = world["client"].post("/api/pairs/p/chaos", json=body)
    assert response.status_code == 200, response.text
    assert response.json()["runs"] == {"p-swarm": "requested", "p-central": "requested"}
    assert (
        sent(left)
        == sent(right)
        == [{"op": "chaos", "body": {"kind": "kill_coordinator", "at": 0.4}, "to": "chaos"}]
    )
    assert world["client"].post("/api/pairs/p/approve", json={"approve": True}).is_success
    assert sent(left) == sent(right) == [{"op": "approve", "body": {}, "to": "goal:root"}]


def test_a_pair_skips_a_run_that_cannot_take_it_and_needs_one_that_can(
    world: dict[str, Any],
) -> None:
    left = live_run(world["runs"], "q-swarm")
    done = world["runs"] / "q-central"
    write_log(done / "events.sqlite", golden_events())
    make_pair(world, "q", left, done)
    client = world["client"]
    answer = client.post("/api/pairs/q/chaos", json={"kind": "kill_coordinator"}).json()
    assert answer["runs"]["q-swarm"] == "requested" and answer["runs"]["q-central"].startswith(
        "skipped"
    )
    assert len(sent(left)) == 1

    (left / "LIVE").unlink()  # now neither is live
    assert client.post("/api/pairs/q/chaos", json={"kind": "kill_coordinator"}).status_code == 409
    assert (
        client.post("/api/pairs/nope/chaos", json={"kind": "kill_coordinator"}).status_code == 404
    )
    assert client.post("/api/pairs/q/chaos", json={"kind": "boom"}).status_code == 422


# -- what the server says it can do ----------------------------------------------------------------


def test_the_capabilities_say_the_controls_are_real(world: dict[str, Any]) -> None:
    caps = world["client"].get("/api/capabilities").json()
    assert caps["chaos"] is True and caps["approve"] is True
    assert caps["budget"] is True and caps["halt"] is True and caps["tasks"] is True
