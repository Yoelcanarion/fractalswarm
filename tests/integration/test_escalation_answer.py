"""The answer path of ``escalation.opened`` on the real T2 slice, fake LLM (actors/arbitration.py).

A doubtful arbiter (confidence 0.4) rules on a forced dispute and opens an escalation: a person may
still answer within ``timeout_ms``. The person here is a stand-in for the API: it drops
``control.injected`` requests into the run's control inbox, each once the log shows what the person
would have seen (the escalation opened, the owner dead, the heir in charge). The owner of the
escalation's goal judges the answer against the log:

- a choice that names the ruling confirms it and nothing else moves;
- another candidate overrules it: the board replaces the verified fact, contracts already placed
  keep their value and those not yet dispatched take the person's;
- an answer that is not an option, names an unknown escalation, comes second or comes after
  ``timeout_ms`` is logged with ``accepted: false`` and changes nothing;
- the owner may die between the escalation and the answer: its heir acts, also on an answer that
  reached nobody while the heir was not yet in charge (the log holds it).

Every run replays bit for bit, in this process and in a fresh one.
"""

import asyncio
import json
import sqlite3
import subprocess
import sys
import threading
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from fractalswarm.actors import arbitration
from fractalswarm.api.app import create_app
from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.tasks.t2_conference.arbitration import with_dispute
from fractalswarm.bench.workflows import bench_script, fake_backend
from fractalswarm.kernel.events import ENV, Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import RunPaths, record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
LAUNCH = [sys.executable, "-c", "from fractalswarm.cli import app; app()"]
SCHEMA = "arbitration_ruling"

# S02 has talks in track-hci/d1 and track-ai/d1; track-ai/d1 misreads the email, so candidate A is
# track-hci/d1's (right) reading and candidate B track-ai/d1's (wrong) one.
KEY, SPEAKER, SESSION = "speaker:S02:availability", "S02", "track-ai/d1"
ESCALATION = f"arbitration:{KEY}"
HOLDER = "track-hci/d1"  # the session that published first: its work is candidate A
CALM = {"profile": "C0", "seed": "live"}  # no chaos planned: the monkey is there for the person
LATE_WORK_MS = 50_000  # every blurb answers this much later: the run outlasts the escalation


def schema_of(body: dict[str, Any]) -> str:
    return ((body.get("text") or {}).get("format") or {}).get("name", "")


def doubt(winner: str) -> str:
    """What a doubtful arbiter says: ``winner`` at confidence 0.4, so the ruling stands and a
    person is asked."""
    text = {"winner": winner, "reason": "not sure", "confidence": 0.4, "evidence": []}
    return json.dumps(text)


def script(winner: str) -> Callable[..., Any]:
    base = with_dispute(bench_script, SPEAKER, SESSION)

    def says(body: dict[str, Any], attempt: int):
        return doubt(winner) if schema_of(body) == SCHEMA else base(body, attempt)

    return says


class Later:
    """The fake LLM, except that the calls of one schema answer ``extra_ms`` later."""

    def __init__(self, inner: Any, schema: str, extra_ms: int) -> None:
        self.inner, self.schema, self.extra_ms = inner, schema, extra_ms

    async def send(self, effect_id: str, body: dict[str, Any], sleep: Any):
        attempt = await self.inner.send(effect_id, body, sleep)
        if schema_of(body) == self.schema:
            attempt = attempt.model_copy(update={"latency_ms": attempt.latency_ms + self.extra_ms})
        return attempt


# -- the person at the UI -------------------------------------------------------------------------


class Log:
    """What a person watching the run could see: the events the log has so far."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _ask(self, query: str, *args: Any) -> list[tuple[Any, ...]]:
        with closing(sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)) as db:
            return db.execute(query, args).fetchall()

    def count(self, event_type: str) -> int:
        return self._ask("SELECT COUNT(*) FROM events WHERE type = ?", event_type)[0][0]

    def payloads(self, event_type: str) -> list[dict[str, Any]]:
        rows = self._ask("SELECT payload FROM events WHERE type = ? ORDER BY seq", event_type)
        return [json.loads(row[0]) for row in rows]

    @property
    def now(self) -> int:
        """The virtual time of the last event."""
        return self._ask("SELECT MAX(ts_virtual) FROM events")[0][0] or 0

    def adopted(self, goal: str) -> bool:
        return any(p["goal_id"] == goal for p in self.payloads("tree.adopted"))

    def killed(self) -> bool:
        return any(p["fault"] == "kill_coordinator" for p in self.payloads("chaos.injected"))

    def deadline(self) -> int | None:
        """The virtual time the first escalation's time to answer runs out, once it is open."""
        rows = self._ask("SELECT ts_virtual, payload FROM events WHERE type = 'escalation.opened'")
        return rows[0][0] + json.loads(rows[0][1])["timeout_ms"] if rows else None


Needs = Callable[[Log], bool]
Request = dict[str, Any]


def person(monkeypatch: pytest.MonkeyPatch, *steps: tuple[Needs, Request]) -> None:
    """A person at the UI. Each step is ``(needs, request)``: the request goes into the control
    inbox, in order and one step per poll, once the log is what ``needs`` says it should be."""
    sent: list[int] = []

    def poll(self: RunPaths) -> list[dict[str, Any]]:
        if len(sent) == len(steps) or not self.events.exists():
            return []
        needs, request = steps[len(sent)]
        try:
            ready = needs(Log(self.events))
        except sqlite3.Error:  # the run has not made its log yet
            return []
        if not ready:
            return []
        sent.append(1)
        return [{"op": "inject", "control": request}]

    monkeypatch.setattr(RunPaths, "poll_control", poll)


def opened(log: Log) -> bool:
    return log.count("escalation.opened") >= 1


def verdicts(n: int) -> Needs:
    """The log holds ``n`` verdicts on answers."""
    return lambda log: log.count("escalation.answered") >= n


def past_the_deadline(log: Log) -> bool:
    deadline = log.deadline()
    return deadline is not None and log.now > deadline


def killed(log: Log) -> bool:
    return log.killed()


def adopted_root(log: Log) -> bool:
    return log.adopted("root")


def crashed(log: Log) -> bool:
    """A rival's coordinator is down."""
    return log.count("baseline.crashed") >= 1


def answer(choice: str, escalation_id: str = ESCALATION, goal: str = "root") -> Request:
    """The control ``POST /api/runs/{id}/escalations/{eid}`` sends (api/controls.py)."""
    body = {"escalation_id": escalation_id, "choice": choice}
    return {"op": "answer", "body": body, "to": f"goal:{goal}"}


def kill(target: str) -> Request:
    body = {"kind": "kill_coordinator", "at": 0.0, "target": target}
    return {"op": "chaos", "body": body, "to": "chaos"}


# -- recordings, one per scenario (a module-scoped fixture each, made when first asked for) ------


def params_for(**extra: Any) -> dict[str, Any]:
    spec = TaskSpec.load(TASKSPEC)
    spec.arbitration = True
    return run_params(spec) | {"live_control": True} | extra


def record(
    out: Path,
    name: str,
    winner: str,
    *steps: tuple[Needs, Request],
    scenario: str = "swarm",
    late_work_ms: int = 0,
    **extra: Any,
) -> Path:
    backend: Any = fake_backend(script(winner))
    if late_work_ms:
        backend = Later(backend, "t2_blurb", late_work_ms)
    with pytest.MonkeyPatch.context() as patch:
        if steps:
            person(patch, *steps)
        asyncio.run(
            record_run(
                scenario,
                run_id=name,
                run_dir=out / name,
                backend=backend,
                seed="1",
                params=params_for(**extra),
                run_cap_usd=2.0,
            )
        )
    return out / name


@pytest.fixture(scope="module")
def out(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("escalation-answer")


@pytest.fixture(scope="module")
def unanswered_run(out: Path) -> Path:
    """The arbiter rules for A with doubt and nobody answers."""
    return record(out, "unanswered", "A")


@pytest.fixture(scope="module")
def confirm_run(out: Path) -> Path:
    """The person agrees with the ruling (A)."""
    return record(out, "confirm", "A", (opened, answer("A")))


@pytest.fixture(scope="module")
def overrule_run(out: Path) -> Path:
    """The arbiter rules for B (the misreading) with doubt; the person puts A in its place."""
    return record(out, "overrule", "B", (opened, answer("A")))


STRAY = "arbitration:speaker:S99:availability"  # an escalation nobody opened


@pytest.fixture(scope="module")
def fumbled_run(out: Path) -> Path:
    """The same ruling. The person answers an escalation nobody opened, names a candidate that does
    not exist, gets it right (A), and then answers once more (B)."""
    return record(
        out,
        "fumbled",
        "B",
        (opened, answer("A", escalation_id=STRAY)),
        (verdicts(1), answer("C")),
        (verdicts(2), answer("A")),
        (verdicts(3), answer("B")),
    )


@pytest.fixture(scope="module")
def slow_run(out: Path) -> Path:
    """The ruling of the overrule run, and the work after it so slow that the run outlasts the
    time to answer. Nobody answers."""
    return record(out, "slow", "B", late_work_ms=LATE_WORK_MS)


@pytest.fixture(scope="module")
def late_run(out: Path) -> Path:
    """The slow run, and the person answers (A) once the time to answer has run out."""
    return record(out, "late", "B", (past_the_deadline, answer("A")), late_work_ms=LATE_WORK_MS)


@pytest.fixture(scope="module")
def heir_run(out: Path) -> Path:
    """The person kills o0, the owner of the root goal, after the escalation opened, and answers
    (A) once the heir is in charge."""
    steps = ((opened, kill("o0")), (adopted_root, answer("A")))
    return record(out, "heir", "B", *steps, chaos=CALM)


@pytest.fixture(scope="module")
def gap_run(out: Path) -> Path:
    """The person kills o0 and answers (A) at once, while nobody owns the root goal."""
    steps = ((opened, kill("o0")), (killed, answer("A")))
    return record(out, "gap", "B", *steps, chaos=CALM)


RIVALS = ["central", "durable-max", "durable"]


@pytest.fixture(scope="module", params=RIVALS)
def rival_run(request: pytest.FixtureRequest, out: Path) -> Path:
    """The coordinator of a rival crashes after the escalation opened and the person answers (A)
    while it is down: the control reaches nobody."""
    scenario = request.param
    steps = ((opened, kill("o0")), (crashed, answer("A")))
    return record(out, f"{scenario}-gap", "B", *steps, scenario=scenario, chaos=CALM)


@pytest.fixture(scope="module")
def central_run(out: Path) -> Path:
    """The central baseline's coordinator is up when the person answers (A)."""
    return record(out, "central-answer", "B", (opened, answer("A")), scenario="central")


# -- reading a log ------------------------------------------------------------------------------


def of(log: list[Event], *types: str) -> list[Event]:
    return [e for e in log if e.type in types]


def the_one(events: list[Event]) -> Event:
    assert len(events) == 1, [(e.seq, e.type, e.payload) for e in events]
    return events[0]


def controls(log: list[Event]) -> list[Event]:
    return of(log, "control.injected")


def answers(log: list[Event]) -> list[Event]:
    """The answers a person sent, not their other controls."""
    return [e for e in controls(log) if e.payload["op"] == arbitration.OP_ANSWER]


def verdict_events(log: list[Event]) -> list[Event]:
    return of(log, "escalation.answered")


def place_of(
    log: list[Event], session: str, speaker: str = SPEAKER
) -> tuple[Event, dict[str, Any]]:
    """The first ``place`` message a session sent out, and the speaker's row in it."""
    for event in of(log, "msg.sent"):
        if event.payload["topic"] != "contract":
            continue
        contract = event.payload["body"]["contract"]
        if contract["goal_id"] == session and contract["id"] == "place":
            rows = contract["inputs"]["data"]["constraints"]["speakers"]
            return event, next(row for row in rows if row["speaker_id"] == speaker)
    raise AssertionError(f"{session} never dispatched a place")


def reading(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key != "speaker_id"}


def candidates_of(log: list[Event]) -> dict[str, dict[str, Any]]:
    """The values in dispute by label, as the board last logged them."""
    collisions = [e for e in of(log, "collision.detected") if e.payload["kind"] == "semantic"]
    found = collisions[-1].payload["conflicts"][0]["candidates"]
    return {c["label"]: c["value"] for c in found}


def kinds(log: list[Event], *skip: str) -> list[str]:
    return [e.type for e in log if e.type not in skip]


def fact_versions(log: list[Event]) -> list[dict[str, Any]]:
    return [e.payload for e in of(log, "fact.resolved")]


async def replays(run: Path) -> None:
    """The run replays to the same head, in this process and in a fresh one."""
    report = await replay_run(run)
    assert report.ok, report.detail
    done = subprocess.run(
        [*LAUNCH, "replay", str(run), "--verify"], capture_output=True, text=True, timeout=300
    )
    assert done.returncode == 0 and done.stdout.startswith("MATCH"), done.stdout + done.stderr


def assert_finished(log: list[Event]) -> dict[str, Any]:
    (result,) = of(log, "task.result")
    assert result.payload["status"] == "ok", result.payload
    assert of(log, "run.completed")
    return result.payload


def assert_valid_program(log: list[Event]) -> None:
    assert assert_finished(log)["report"]["hard_violations"] == 0


# -- the person agrees ---------------------------------------------------------------------


def test_the_escalation_opens_after_a_doubtful_ruling(unanswered_run: Path) -> None:
    log = load_events(unanswered_run)
    ruled = the_one(of(log, "arbitration.ruled"))
    assert ruled.payload["winner"] == "A" and ruled.payload["confidence"] == 0.4
    opened_ = the_one(of(log, "escalation.opened"))
    assert opened_.payload["id"] == ESCALATION and opened_.payload["goal_id"] == "root"
    assert opened_.payload["options"] == ["A", "B"] and opened_.payload["default"] == "A"
    assert controls(log) == [] and verdict_events(log) == []
    assert_valid_program(log)


def test_an_answer_that_confirms_the_ruling_moves_nothing_but_its_verdict(
    confirm_run: Path, unanswered_run: Path
) -> None:
    log = load_events(confirm_run)
    control = the_one(controls(log))
    assert control.actor == ENV and control.payload == answer("A")
    logged = the_one(verdict_events(log))
    assert logged.actor == "o0" and logged.seq > control.seq
    assert logged.payload["id"] == ESCALATION and logged.payload["by"] == "human"
    assert (logged.payload["choice"], logged.payload["accepted"]) == ("A", True)
    assert (logged.payload["overruled"], logged.payload["reason"]) == (
        False,
        "confirms the ruling",
    )
    assert logged.idem_key == f"{arbitration.IDEM_ANSWERED}:{control.seq}"
    assert of(log, "arbitration.overruled") == []
    # Nothing else moved: the run is the unanswered one with the control and its verdict added.
    added = ("control.injected", "escalation.answered")
    assert kinds(log, *added) == kinds(load_events(unanswered_run))
    assert fact_versions(log) == fact_versions(load_events(unanswered_run))
    assert_valid_program(log)


async def test_the_confirmed_run_replays_bit_for_bit(confirm_run: Path) -> None:
    await replays(confirm_run)


# -- the person overrules ------------------------------------------------------------------------


def test_an_answer_that_names_another_candidate_overrules_the_ruling(overrule_run: Path) -> None:
    log = load_events(overrule_run)
    ruled = the_one(of(log, "arbitration.ruled"))
    assert ruled.payload["winner"] == "B", "the arbiter was wrong, and doubtful"
    control = the_one(controls(log))
    logged = the_one(verdict_events(log))
    assert (logged.payload["accepted"], logged.payload["overruled"]) == (True, True)
    assert logged.payload["reason"] == "overrules B with A"
    chose = the_one(of(log, "arbitration.overruled"))
    assert control.seq < logged.seq < chose.seq
    assert chose.actor == "o0" and chose.payload["winner"] == "A"
    assert chose.payload["work"] == f"{HOLDER}/extract"
    assert chose.payload["value"] == candidates_of(log)["A"]
    assert chose.idem_key == f"arbitration.overruled:{KEY}"
    assert ruled.payload["value"] == candidates_of(log)["B"], "the ruling itself stays in the log"


def test_the_board_replaces_the_verified_fact_with_the_persons_choice(overrule_run: Path) -> None:
    log = load_events(overrule_run)
    first, second = fact_versions(log)
    assert first["contract"] != second["contract"] and first["key"] == second["key"] == KEY
    assert (first["version"], second["version"]) == (3, 4)
    order = [e for e in of(log, "msg.sent") if e.payload["topic"] == arbitration.TOPIC_OVERRULE]
    chose = the_one(of(log, "arbitration.overruled"))
    assert [(e.actor, e.payload["body"]["key"]) for e in order] == [("o0", KEY)]
    assert order[0].seq > chose.seq and second["contract"] == order[0].payload["body"]["contract"]
    assert the_one([e for e in of(log, "fact.resolved") if e.seq > chose.seq]).actor == "board"


def test_contracts_placed_before_the_answer_keep_their_value_and_later_ones_take_the_new_one(
    overrule_run: Path,
) -> None:
    log = load_events(overrule_run)
    found = candidates_of(log)
    control = the_one(controls(log))
    early, early_row = place_of(log, HOLDER)
    late, late_row = place_of(log, SESSION)
    assert early.seq < control.seq < late.seq, "one place went out before the answer, one after"
    assert reading(early_row) == found["B"], "placed with the ruled value; it stays"
    assert reading(late_row) == found["A"], "not yet dispatched: it takes the person's choice"
    assert_finished(log)


async def test_the_overruled_run_replays_bit_for_bit(overrule_run: Path) -> None:
    await replays(overrule_run)


# -- answers that are ignored ----------------------------------------------------------------------


def test_answers_that_cannot_be_accepted_are_logged_and_move_nothing(
    fumbled_run: Path, overrule_run: Path
) -> None:
    log = load_events(fumbled_run)
    sent, logged = controls(log), verdict_events(log)
    assert [c.payload["body"]["choice"] for c in sent] == ["A", "C", "A", "B"]
    assert [
        (v.payload["choice"], v.payload["accepted"], v.payload["overruled"]) for v in logged
    ] == [
        ("A", False, False),
        ("C", False, False),
        ("A", True, True),
        ("B", False, False),
    ]
    assert [v.payload["reason"] for v in logged] == [
        f"no escalation {STRAY} is open at root",
        "C is not one of the options (A, B)",
        "overrules B with A",
        "the escalation was already answered (A)",
    ]
    assert [v.payload["id"] for v in logged] == [STRAY, ESCALATION, ESCALATION, ESCALATION]
    assert all(v.payload["by"] == "human" and v.actor == "o0" for v in logged)
    assert [v.idem_key for v in logged] == [f"{arbitration.IDEM_ANSWERED}:{c.seq}" for c in sent]
    assert all(c.seq < v.seq for c, v in zip(sent, logged, strict=True))


def test_only_the_good_answer_moves_anything(fumbled_run: Path, overrule_run: Path) -> None:
    log, plain = load_events(fumbled_run), load_events(overrule_run)
    chose = the_one(of(log, "arbitration.overruled"))
    assert chose.payload["winner"] == "A" and chose.seq > verdict_events(log)[2].seq
    assert [f["version"] for f in fact_versions(log)] == [3, 4]
    assert fact_versions(log) == fact_versions(plain)
    here = ("control.injected", "escalation.answered")
    assert kinds(log, *here) == kinds(plain, *here), "the three that were ignored left no trace"
    assert_finished(log)


async def test_the_fumbled_run_replays_bit_for_bit(fumbled_run: Path) -> None:
    await replays(fumbled_run)


def test_an_answer_after_the_time_to_answer_is_logged_and_moves_nothing(
    late_run: Path, slow_run: Path
) -> None:
    log, plain = load_events(late_run), load_events(slow_run)
    opened_ = the_one(of(log, "escalation.opened"))
    limit = opened_.ts_virtual + opened_.payload["timeout_ms"]
    control = the_one(controls(log))
    assert control.ts_virtual > limit, "the person answered after the time ran out"
    logged = the_one(verdict_events(log))
    assert (logged.payload["accepted"], logged.payload["overruled"]) == (False, False)
    late = control.ts_virtual - limit
    assert logged.payload["reason"] == (
        f"the answer came {late} ms after the time to answer ({opened_.payload['timeout_ms']} ms)"
    )
    assert of(log, "arbitration.overruled") == []
    assert fact_versions(log) == fact_versions(plain) and len(fact_versions(log)) == 1
    here = ("control.injected", "escalation.answered")
    assert kinds(log, *here) == kinds(plain, *here)
    assert assert_finished(log)


async def test_the_late_run_replays_bit_for_bit(late_run: Path) -> None:
    await replays(late_run)


# -- the owner of the goal dies before the answer --------------------------------------------------


def adoption_of(log: list[Event], goal: str = "root") -> Event:
    return the_one([e for e in of(log, "tree.adopted") if e.payload["goal_id"] == goal])


def test_the_heir_of_a_dead_owner_judges_the_answer(heir_run: Path) -> None:
    log = load_events(heir_run)
    escalation = the_one(of(log, "escalation.opened"))
    (strike,) = [e for e in of(log, "chaos.injected") if e.payload["fault"] == "kill_coordinator"]
    assert strike.payload["target"] == "o0" and strike.seq > escalation.seq
    adoption = adoption_of(log)
    assert adoption.payload["dead"] == "o0" and adoption.payload["adopter"] != "o0"
    control = the_one(answers(log))
    assert control.seq > adoption.seq, "the person answered once the heir was in charge"
    logged = the_one(verdict_events(log))
    assert logged.actor == adoption.payload["adopter"] != "o0"
    assert (logged.payload["accepted"], logged.payload["overruled"]) == (True, True)
    assert logged.payload["fence"] is not None, "written under the heir's own fence"
    chose = the_one(of(log, "arbitration.overruled"))
    assert (chose.actor, chose.payload["winner"]) == (logged.actor, "A")
    assert [f["version"] for f in fact_versions(log)] == [3, 4]
    assert assert_finished(log)


async def test_the_heirs_run_replays_bit_for_bit(heir_run: Path) -> None:
    await replays(heir_run)


def test_an_answer_that_reached_nobody_is_judged_by_the_heir_once_it_is_in_charge(
    gap_run: Path,
) -> None:
    log = load_events(gap_run)
    control = the_one(answers(log))
    adoption = adoption_of(log)
    assert control.seq < adoption.seq, "nobody owned the root goal when the person answered"
    logged = the_one(verdict_events(log))
    assert logged.seq > adoption.seq and logged.actor == adoption.payload["adopter"]
    assert logged.idem_key == f"{arbitration.IDEM_ANSWERED}:{control.seq}"
    assert (logged.payload["accepted"], logged.payload["overruled"]) == (True, True)
    assert [f["version"] for f in fact_versions(log)] == [3, 4]
    assert assert_finished(log)


async def test_the_gap_run_replays_bit_for_bit(gap_run: Path) -> None:
    await replays(gap_run)


# -- the rivals ------------------------------------------------------------------------------------


def test_the_central_coordinator_judges_an_answer_like_the_swarms_owner(central_run: Path) -> None:
    log = load_events(central_run)
    logged = the_one(verdict_events(log))
    assert logged.actor == "o0" and logged.payload["accepted"] is True
    assert the_one(of(log, "arbitration.overruled")).payload["winner"] == "A"
    assert [f["version"] for f in fact_versions(log)] == [3, 4]
    assert assert_finished(log)


async def test_the_central_run_replays_bit_for_bit(central_run: Path) -> None:
    await replays(central_run)


def test_a_restarted_coordinator_judges_the_answer_it_missed(rival_run: Path) -> None:
    log = load_events(rival_run)
    crash = the_one(of(log, "baseline.crashed"))
    control = the_one(answers(log))
    assert control.seq > crash.seq, "the person answered while the coordinator was down"
    logged = the_one(verdict_events(log))
    assert logged.actor == "o0" and logged.seq > control.seq
    assert logged.ts_virtual >= crash.ts_virtual + crash.payload["restart_in_ms"]
    assert logged.idem_key == f"{arbitration.IDEM_ANSWERED}:{control.seq}"
    assert (logged.payload["accepted"], logged.payload["overruled"]) == (True, True)
    assert [f["version"] for f in fact_versions(log)] == [3, 4]
    assert assert_finished(log)


async def test_the_restarted_run_replays_bit_for_bit(rival_run: Path) -> None:
    await replays(rival_run)


# -- through the API ---------------------------------------------------------------------------


def disputes_of(client: TestClient, run_id: str) -> dict[str, Any]:
    response = client.get(f"/api/runs/{run_id}/disputes")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_person_answers_through_the_api_and_the_run_goes_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The route a person's click takes: ``POST /api/runs/{id}/escalations/{eid}`` drops an answer
    into the inbox of the live run, which the driver reads at its next poll. The driver here
    waits, once the escalation is open, until the test has looked at the run through the API and
    answered it."""
    runs = tmp_path / "runs"
    for name in ("runs", "demo", "bench", "s"):
        (tmp_path / name).mkdir(exist_ok=True)
    app = create_app(runs, tmp_path / "demo", tmp_path / "bench", tmp_path / "s")
    arrived, released = threading.Event(), threading.Event()
    poll_inbox = RunPaths.poll_control

    def poll(self: RunPaths) -> list[dict[str, Any]]:
        if not arrived.is_set() and self.events.exists():
            try:
                ready = opened(Log(self.events))
            except sqlite3.Error:  # the run has not made its log yet
                ready = False
            if ready:
                arrived.set()
                released.wait(timeout=120)
        return poll_inbox(self)

    monkeypatch.setattr(RunPaths, "poll_control", poll)
    failed: list[BaseException] = []

    def run() -> None:
        try:
            asyncio.run(
                record_run(
                    "swarm",
                    run_id="http",
                    run_dir=runs / "http",
                    backend=fake_backend(script("B")),
                    seed="1",
                    params=params_for(),
                    run_cap_usd=2.0,
                )
            )
        except BaseException as exc:  # the test thread says what went wrong
            failed.append(exc)
            arrived.set()

    recording = threading.Thread(target=run, name="recording")
    recording.start()
    try:
        with TestClient(app) as client:
            assert arrived.wait(timeout=120) and not failed, failed
            waiting = disputes_of(client, "http")
            (dispute,) = waiting["disputes"]
            escalation = dispute["escalation"]
            assert escalation["id"] == ESCALATION and escalation["goal_id"] == "root"
            assert escalation["options"] == ["A", "B"] and escalation["state"] == "waiting"
            assert escalation["deadline_ts"] == escalation["ts_virtual"] + 60_000
            assert escalation["question"] and escalation["answers"] == []
            assert (dispute["status"], dispute["answer"]) == ("ruled", None)
            assert (waiting["waiting"], waiting["now_ts"] <= escalation["deadline_ts"]) == (1, True)
            for choice in ("C", "A", "B"):  # not an option, the right one, a second answer
                url = f"/api/runs/http/escalations/{ESCALATION}"
                response = client.post(url, json={"choice": choice})
                assert response.status_code == 200 and response.json()["ok"], response.text
            released.set()
            recording.join(timeout=300)
            assert not recording.is_alive() and not failed, failed
            settled = disputes_of(client, "http")
    finally:
        released.set()
        recording.join(timeout=300)
    (dispute,) = settled["disputes"]
    assert dispute["status"] == "overruled" and settled["waiting"] == 0
    assert dispute["ruling"]["winner"] == "B", "what the arbiter ruled stays in the log"
    assert dispute["standing"] == {"winner": "A", "by": "human"}
    assert dispute["answer"]["choice"] == "A" and dispute["answer"]["by"] == "human"
    assert dispute["answer"]["overruled"] is True
    assert dispute["escalation"]["state"] == "overruled"
    found = [(a["choice"], a["accepted"]) for a in dispute["escalation"]["answers"]]
    assert found == [("C", False), ("A", True), ("B", False)]
    assert dispute["escalation"]["answers"][0]["reason"] == "C is not one of the options (A, B)"
    log = load_events(runs / "http")
    assert [c.payload["body"]["choice"] for c in answers(log)] == ["C", "A", "B"]
    assert [f["version"] for f in fact_versions(log)] == [3, 4]
    assert assert_finished(log)
    done = subprocess.run(
        [*LAUNCH, "replay", str(runs / "http"), "--verify"], capture_output=True, text=True
    )
    assert done.returncode == 0 and done.stdout.startswith("MATCH"), done.stdout + done.stderr
