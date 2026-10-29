"""Wonder arbitration of a semantic dispute (actors/arbitration.py), on the real T2 slice, fake LLM.

A fake script variant makes one session misread one speaker's email, so two contracts publish
different availability for the same speaker. The board marks the fact disputed, the owner of the
lowest common ancestor goal asks the arbiter (Wonder, effort high), and the speaker's ``place``
contracts wait for the ruling and take the ruled value. A speaker with talks in two tracks is
settled at the root; one with talks on two days of one track, at the track.

Arbitration is log-driven: a kill of the arbiter between ``arbitration.requested`` and
``arbitration.ruled`` leaves the heir (swarm) or the restarted coordinator (the central
baseline and the two durable rivals) to finish it. Off, a run is what it always was.
"""

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from fractalswarm.actors import arbitration
from fractalswarm.api.app import create_app
from fractalswarm.bench.scoring import load_events, score_run
from fractalswarm.bench.tasks.t2_conference.arbitration import with_dispute
from fractalswarm.bench.workflows import bench_script, fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
SCHEMA = "arbitration_ruling"

# S02 has talks in track-hci/d1 and track-ai/d1; track-ai/d1 misreads the email.
ROOT_KEY, ROOT_SPEAKER, ROOT_SESSION = "speaker:S02:availability", "S02", "track-ai/d1"
# S04 has talks on both days of track-data; day 2 misreads the email.
TRACK_KEY, TRACK_SPEAKER, TRACK_SESSION = "speaker:S04:availability", "S04", "track-data/d2"
# The arbiter answers this much later than the fake model would. A kill at 30% of the contracts
# (33 s) lands in the call that began at 24.7 s; the heir's call (from 39 s) is done well before
# the hold ends (54.7 s). The hold test uses a slower arbiter; the late test one slower still.
SLOW_MS = 8_000
HOLD_TEST_MS = 12_000
LATE_MS = 35_000
OPEN_MS = 200_000  # the run is over long before this arbiter answers


class SlowArbiter:
    """The arbiter's calls answer ``extra_ms`` later in virtual time (the attempt's latency)."""

    def __init__(self, inner: Any, extra_ms: int) -> None:
        self.inner, self.extra_ms = inner, extra_ms

    async def send(self, effect_id: str, body: dict[str, Any], sleep: Any):
        attempt = await self.inner.send(effect_id, body, sleep)
        if schema_of(body) == SCHEMA:
            attempt = attempt.model_copy(update={"latency_ms": attempt.latency_ms + self.extra_ms})
        return attempt


def schema_of(body: dict[str, Any]) -> str:
    return ((body.get("text") or {}).get("format") or {}).get("name", "")


def arbiter_says(script: Callable[..., Any], text: str) -> Callable[..., Any]:
    """The fake LLM, except that the arbiter always gives this answer."""

    def says(body: dict[str, Any], attempt: int):
        return text if schema_of(body) == SCHEMA else script(body, attempt)

    return says


def params_for(
    arbitration_on: bool = True, kill: str | None = None, **extra: Any
) -> dict[str, Any]:
    spec = TaskSpec.load(TASKSPEC)
    spec.arbitration = arbitration_on
    params = run_params(spec) | extra
    if kill is not None:
        action = ChaosAction(at=0.30, kind="kill_coordinator", target=kill)
        plan = ChaosPlan(profile="arbiter-kill", seed="1", actions=(action,))
        params["chaos"] = plan.model_dump(mode="json")
    return params


def record(
    out: Path,
    name: str,
    params: dict[str, Any],
    script: Callable[..., Any],
    *,
    scenario: str = "swarm",
    slow: int = 0,
    run_id: str | None = None,
) -> Path:
    backend: Any = fake_backend(script)
    if slow:
        backend = SlowArbiter(backend, slow)
    run_dir = out / name
    asyncio.run(
        record_run(
            scenario,
            run_id=run_id or name,
            run_dir=run_dir,
            backend=backend,
            seed="1",
            params=params,
            run_cap_usd=2.0,
        )
    )
    return run_dir


def root_script() -> Callable[..., Any]:
    return with_dispute(bench_script, ROOT_SPEAKER, ROOT_SESSION)


# -- recordings, one per scenario (a module-scoped fixture each, made when first asked for) --


@pytest.fixture(scope="module")
def out(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("arbitration")


@pytest.fixture(scope="module")
def root_run(out: Path) -> Path:
    return record(out, "swarm-root", params_for(), root_script())


@pytest.fixture(scope="module")
def track_run(out: Path) -> Path:
    script = with_dispute(bench_script, TRACK_SPEAKER, TRACK_SESSION)
    return record(out, "swarm-track", params_for(), script)


@pytest.fixture(scope="module")
def off_run(out: Path) -> Path:
    return record(out, "swarm-off", params_for(arbitration_on=False), root_script())


@pytest.fixture(scope="module")
def quiet_run(out: Path) -> Path:
    return record(out, "swarm-quiet", params_for(), bench_script, run_id="the-same-run")


@pytest.fixture(scope="module")
def default_run(out: Path) -> Path:
    params = params_for(arbitration_on=False)
    return record(out, "swarm-default", params, bench_script, run_id="the-same-run")


@pytest.fixture(scope="module")
def slow_run(out: Path) -> Path:
    return record(out, "swarm-slow", params_for(), root_script(), slow=HOLD_TEST_MS)


@pytest.fixture(scope="module")
def late_run(out: Path) -> Path:
    return record(out, "swarm-late", params_for(), root_script(), slow=LATE_MS)


@pytest.fixture(scope="module")
def open_run(out: Path) -> Path:
    return record(out, "swarm-open", params_for(), root_script(), slow=OPEN_MS)


@pytest.fixture(scope="module")
def heir_run(out: Path) -> Path:
    return record(out, "swarm-heir", params_for(kill="o0"), root_script(), slow=SLOW_MS)


@pytest.fixture(scope="module")
def central_run(out: Path) -> Path:
    return record(
        out, "central-kill", params_for(kill="o0"), root_script(), scenario="central", slow=SLOW_MS
    )


@pytest.fixture(scope="module")
def durable_max_run(out: Path) -> Path:
    return record(
        out,
        "durable-max-kill",
        params_for(kill="o0"),
        root_script(),
        scenario="durable-max",
        slow=SLOW_MS,
    )


@pytest.fixture(scope="module")
def durable_run(out: Path) -> Path:
    return record(
        out, "durable-kill", params_for(kill="o0"), root_script(), scenario="durable", slow=SLOW_MS
    )


@pytest.fixture(scope="module")
def doubtful_run(out: Path) -> Path:
    doubt = {"winner": "A", "reason": "unsure", "confidence": 0.4, "evidence": []}
    return record(
        out, "swarm-doubtful", params_for(), arbiter_says(root_script(), json.dumps(doubt))
    )


@pytest.fixture(scope="module")
def garbage_run(out: Path) -> Path:
    script = arbiter_says(root_script(), "I cannot decide.")
    return record(out, "swarm-garbage", params_for(), script)


# -- reading a log ------------------------------------------------------------------------


def of(log: list[Event], *types: str) -> list[Event]:
    return [e for e in log if e.type in types]


def collisions(log: list[Event], kind: str = "semantic") -> list[Event]:
    return [e for e in of(log, "collision.detected") if e.payload["kind"] == kind]


def tag_of(event: Event) -> str:
    return event.payload.get("tag") or ""


def calls(log: list[Event], kind: str = "effect.started") -> list[Event]:
    return [e for e in of(log, kind) if tag_of(e).startswith(f"{arbitration.TAG}|")]


def holds(log: list[Event], kind: str) -> list[Event]:
    return [e for e in of(log, kind) if tag_of(e).startswith(f"{arbitration.HOLD_TAG}|")]


def the_one(events: list[Event]) -> Event:
    assert len(events) == 1, [(e.seq, e.type) for e in events]
    return events[0]


def place_of(log: list[Event], session: str, speaker: str) -> tuple[Event, dict[str, Any]]:
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


def candidates_of(log: list[Event], key: str) -> dict[str, dict[str, Any]]:
    """The values in dispute, by the work that published them."""
    (collision,) = [c for c in collisions(log) if c.payload["conflicts"][0]["key"] == key]
    found = collision.payload["conflicts"][0]["candidates"]
    return {c["by"][0]["work"]: c["value"] for c in found}


def result_of(log: list[Event]) -> dict[str, Any]:
    return the_one(of(log, "task.result")).payload


def assert_valid_program(log: list[Event]) -> None:
    result = result_of(log)
    assert result["status"] == "ok", result
    assert result["report"]["hard_violations"] == 0
    assert of(log, "run.completed")


async def assert_replays(run: Path) -> None:
    report = await replay_run(run)
    assert report.ok, report.detail


# -- the flag --------------------------------------------------------------------------------


def test_the_flag_is_recorded_only_when_asked() -> None:
    default = run_params(TaskSpec.load(TASKSPEC))
    assert "arbitration" not in default and "arbitration" not in default["spec"]
    asked = params_for()
    assert asked["arbitration"] is True
    assert "arbitration" not in asked["spec"], "the recorded spec stays as it was"


def test_the_taskspec_file_can_ask_for_it(tmp_path: Path) -> None:
    path = tmp_path / "arbitrated.yaml"
    path.write_text(
        TASKSPEC.read_text(encoding="utf-8") + "\narbitration: true\n", encoding="utf-8"
    )
    spec = TaskSpec.load(path)
    assert spec.arbitration is True
    assert run_params(spec)["arbitration"] is True


# -- a dispute between two tracks goes to the root ------------------------------------------


def test_a_misreading_is_caught_as_a_semantic_collision(root_run: Path) -> None:
    log = load_events(root_run)
    found = candidates_of(log, ROOT_KEY)
    assert set(found) == {"track-hci/d1/extract", "track-ai/d1/extract"}
    assert found["track-hci/d1/extract"] != found["track-ai/d1/extract"]
    (collision,) = collisions(log)
    assert collision.actor == "board" and collision.payload["goal_id"] == ROOT_SESSION
    published = [e for e in of(log, "fact.published") if e.payload["status"] == "disputed"]
    assert [p.payload["key"] for p in published] == [ROOT_KEY]


def test_the_owner_of_the_root_asks_wonder_at_high_effort(root_run: Path) -> None:
    log = load_events(root_run)
    requested = the_one(of(log, "arbitration.requested"))
    payload = requested.payload
    assert (payload["key"], payload["attempt"], payload["lca"]) == (ROOT_KEY, 1, "root")
    assert payload["arbiter"] == requested.actor == "o0"
    started = the_one(calls(log))
    assert tag_of(started) == f"arbitrate|{ROOT_KEY}|1" and started.actor == "o0"
    assert started.payload["request"]["role"] == "arbiter"
    entries = [json.loads(line) for line in (root_run / "cassette.jsonl").read_text().splitlines()]
    entry = next(e for e in entries if e["effect_id"] == started.payload["effect_id"])
    assert entry["model"] == "muse-wonder-1.0"
    assert entry["request"]["reasoning"] == {"effort": "high"}
    assert the_one(calls(log, "effect.completed")).payload["status"] == "ok"


def test_the_ruling_keeps_the_reading_the_email_supports(root_run: Path) -> None:
    log = load_events(root_run)
    found = candidates_of(log, ROOT_KEY)
    ruled = the_one(of(log, "arbitration.ruled"))
    payload = ruled.payload
    assert payload["by"] == "arbiter" and payload["attempt"] == 1 and payload["reused"] is False
    assert payload["work"] == "track-hci/d1/extract", "the session that read the email right"
    assert payload["value"] == found["track-hci/d1/extract"]
    assert payload["confidence"] >= arbitration.MIN_CONFIDENCE
    assert payload["evidence"] == ["E02"] and "E02" in payload["reason"]
    assert (payload["lca"], payload["arbiter"]) == ("root", "o0")
    assert of(log, "escalation.opened") == []


def test_the_ruling_is_logged_with_the_resolution_and_the_boards_answer(root_run: Path) -> None:
    log = load_events(root_run)
    ruled = the_one(of(log, "arbitration.ruled"))
    (resolved,) = [e for e in of(log, "collision.resolved") if e.payload["kind"] == "semantic"]
    assert resolved.seq > ruled.seq and resolved.payload["goal_id"] == ROOT_SESSION
    order = [e for e in of(log, "msg.sent") if e.payload["topic"] == arbitration.TOPIC_RESOLVE]
    assert [(e.actor, e.payload["body"]["key"]) for e in order] == [("o0", ROOT_KEY)]
    fact = the_one(of(log, "fact.resolved"))
    assert fact.actor == "board" and fact.seq > order[0].seq
    assert fact.payload["contract"] == ruled.payload["contract"]


def test_both_sessions_of_the_speaker_place_with_the_ruled_value(root_run: Path) -> None:
    log = load_events(root_run)
    found = candidates_of(log, ROOT_KEY)
    right, wrong = found["track-hci/d1/extract"], found["track-ai/d1/extract"]
    _, hci = place_of(log, "track-hci/d1", ROOT_SPEAKER)
    _, ai = place_of(log, ROOT_SESSION, ROOT_SPEAKER)
    assert reading(hci) == right
    assert reading(ai) == right != wrong, "track-ai/d1 misread the email; its place does not"


def test_the_arbitrated_run_is_a_valid_program(root_run: Path) -> None:
    assert_valid_program(load_events(root_run))


async def test_the_arbitrated_run_replays_bit_for_bit(root_run: Path) -> None:
    await assert_replays(root_run)


def test_arbitration_costs_no_coordination_tokens(root_run: Path) -> None:
    metrics = score_run(root_run)
    assert metrics.coordination_tokens == 0 and metrics.completed


# -- a dispute inside one track goes to the track ---------------------------------------------


def test_a_dispute_of_one_track_is_settled_by_the_track(track_run: Path) -> None:
    log = load_events(track_run)
    found = candidates_of(log, TRACK_KEY)
    assert set(found) == {"track-data/d1/extract", "track-data/d2/extract"}
    requested = the_one(of(log, "arbitration.requested"))
    assert requested.payload["lca"] == "track-data"
    assert requested.actor != "o0", "the root takes no part"
    ruled = the_one(of(log, "arbitration.ruled"))
    assert ruled.actor == requested.actor and ruled.payload["work"] == "track-data/d1/extract"
    assert the_one(calls(log)).actor == requested.actor
    for session in ("track-data/d1", "track-data/d2"):
        _, row = place_of(log, session, TRACK_SPEAKER)
        assert reading(row) == ruled.payload["value"], session
    assert_valid_program(log)


async def test_the_track_run_replays_bit_for_bit(track_run: Path) -> None:
    await assert_replays(track_run)


# -- off, a run is what it always was -----------------------------------------------------------


def test_without_the_flag_a_misreading_goes_unnoticed(off_run: Path, root_run: Path) -> None:
    log = load_events(off_run)
    new = {
        "arbitration.requested",
        "arbitration.ruled",
        "fact.resolved",
        "escalation.opened",
    }
    assert not new & {e.type for e in log}
    assert collisions(log) == [] and calls(log) == [] and holds(log, "effect.started") == []
    wrong = candidates_of(load_events(root_run), ROOT_KEY)["track-ai/d1/extract"]
    _, row = place_of(log, ROOT_SESSION, ROOT_SPEAKER)
    assert reading(row) == wrong, "the misreading reaches the place contract"


def test_without_the_flag_nothing_is_passed_to_the_actors(off_run: Path) -> None:
    log = load_events(off_run)
    assert "arbitration" not in the_one(of(log, "run.started")).payload["params"]
    for spawned in of(log, "actor.spawned"):
        assert "arbitration" not in spawned.payload["args"], spawned.payload["actor_id"]


def test_with_the_flag_the_board_and_every_orchestrator_are_told(root_run: Path) -> None:
    spawned = of(load_events(root_run), "actor.spawned")
    told = {e.payload["actor_id"] for e in spawned if e.payload["args"].get("arbitration")}
    assert "board" in told and "o0" in told
    assert told == {e.payload["actor_id"] for e in spawned if e.payload["kind"] != "agent"}


def shape(log: list[Event]) -> list[tuple[Any, ...]]:
    """What happened, but for the run's parameters and the actors' spawn arguments."""
    kept = ("run.started", "actor.spawned")
    return [
        (e.seq, e.ts_virtual, e.actor, e.type, None if e.type in kept else e.payload) for e in log
    ]


def test_with_nothing_in_dispute_arbitration_changes_nothing(
    quiet_run: Path, default_run: Path
) -> None:
    quiet, default = load_events(quiet_run), load_events(default_run)
    assert collisions(quiet) == [] and calls(quiet) == []
    assert shape(quiet) == shape(default)


# -- the wait for the ruling ---------------------------------------------------------------------


def test_a_place_waits_for_the_ruling_and_then_goes_with_the_ruled_value(slow_run: Path) -> None:
    log = load_events(slow_run)
    opened = the_one(collisions(log))
    ruled = the_one(of(log, "arbitration.ruled"))
    assert 0 < ruled.ts_virtual - opened.ts_virtual < arbitration.HOLD_MS
    found = candidates_of(log, ROOT_KEY)
    for session in ("track-hci/d1", ROOT_SESSION):
        sent, row = place_of(log, session, ROOT_SPEAKER)
        assert sent.ts_virtual >= ruled.ts_virtual, f"{session} did not wait"
        assert reading(row) == found["track-hci/d1/extract"], session
    assert_valid_program(log)


def test_the_wait_leaves_no_timer_behind(slow_run: Path) -> None:
    log = load_events(slow_run)
    started, cancelled = holds(log, "effect.started"), holds(log, "effect.cancelled")
    assert {tag_of(e) for e in started} == {"arb.hold|track-hci/d1", "arb.hold|track-ai/d1"}
    assert {e.payload["effect_id"] for e in cancelled} == {e.payload["effect_id"] for e in started}
    assert holds(log, "effect.completed") == [], "no timer fired: the ruling came first"


async def test_the_slow_run_replays_bit_for_bit(slow_run: Path) -> None:
    await assert_replays(slow_run)


def test_after_the_hold_a_place_goes_with_its_own_values(late_run: Path) -> None:
    log = load_events(late_run)
    opened = the_one(collisions(log))
    ruled = the_one(of(log, "arbitration.ruled"))
    deadline = opened.ts_virtual + arbitration.HOLD_MS
    assert ruled.ts_virtual > deadline, "the arbiter was too slow for the hold"
    found = candidates_of(log, ROOT_KEY)
    for session, work in (
        ("track-hci/d1", "track-hci/d1/extract"),
        (ROOT_SESSION, ROOT_SESSION + "/extract"),
    ):
        sent, row = place_of(log, session, ROOT_SPEAKER)
        assert deadline <= sent.ts_virtual < ruled.ts_virtual, session
        assert reading(row) == found[work], f"{session} goes with what its own extraction said"
    fired = holds(log, "effect.completed")
    assert {tag_of(e) for e in fired} == {"arb.hold|track-hci/d1", "arb.hold|track-ai/d1"}
    assert {e.ts_virtual for e in fired} == {deadline}


def test_a_late_ruling_still_settles_the_fact_and_the_run_completes(late_run: Path) -> None:
    log = load_events(late_run)
    assert the_one(of(log, "fact.resolved")).payload["key"] == ROOT_KEY
    assert_valid_program(log)


async def test_the_late_run_replays_bit_for_bit(late_run: Path) -> None:
    await assert_replays(late_run)


# -- a doubtful arbiter, and one that cannot answer ------------------------------------------------


def test_a_doubtful_ruling_stands_and_asks_a_person(doubtful_run: Path) -> None:
    log = load_events(doubtful_run)
    ruled = the_one(of(log, "arbitration.ruled"))
    assert ruled.payload["by"] == "arbiter" and ruled.payload["confidence"] == 0.4
    opened = the_one(of(log, "escalation.opened"))
    assert opened.seq > ruled.seq and opened.payload["kind"] == "arbitration"
    assert opened.payload["key"] == ROOT_KEY and opened.payload["goal_id"] == "root"
    assert opened.payload["options"] == ["A", "B"] and opened.payload["default"] == "A"
    assert opened.payload["timeout_ms"] == arbitration.ESCALATION_TIMEOUT_MS
    assert opened.payload["confidence"] == 0.4
    assert len(calls(log)) == 1, "the arbiter is not asked again"
    assert the_one(of(log, "fact.resolved")), "nobody waits for a person: the ruling stands"
    assert_valid_program(log)


async def test_the_doubtful_run_replays_bit_for_bit(doubtful_run: Path) -> None:
    await assert_replays(doubtful_run)


def test_an_arbiter_that_cannot_answer_is_asked_twice_and_then_the_oldest_value_stands(
    garbage_run: Path,
) -> None:
    log = load_events(garbage_run)
    assert [tag_of(e) for e in calls(log)] == [f"arbitrate|{ROOT_KEY}|1", f"arbitrate|{ROOT_KEY}|2"]
    ruled = the_one(of(log, "arbitration.ruled"))
    payload = ruled.payload
    assert (payload["by"], payload["attempt"], payload["confidence"]) == ("fallback", 0, 0.0)
    assert payload["work"] == "track-hci/d1/extract", "the oldest value"
    assert "attempt 2" in payload["reason"]
    assert the_one(of(log, "escalation.opened")).payload["default"] == payload["winner"]
    _, row = place_of(log, ROOT_SESSION, ROOT_SPEAKER)
    assert reading(row) == payload["value"]
    assert_valid_program(log)


async def test_the_garbage_run_replays_bit_for_bit(garbage_run: Path) -> None:
    await assert_replays(garbage_run)


# -- the arbiter dies between the request and the ruling -----------------------------------------


def chaos_kill(log: list[Event]) -> Event:
    return the_one(
        [e for e in of(log, "chaos.injected") if e.payload["fault"] == "kill_coordinator"]
    )


def test_the_kill_lands_between_the_request_and_the_ruling(heir_run: Path) -> None:
    log = load_events(heir_run)
    kill = chaos_kill(log)
    first = next(e for e in of(log, "arbitration.requested") if e.payload["attempt"] == 1)
    ruled = the_one(of(log, "arbitration.ruled"))
    assert kill.payload["target"] == "o0" and first.actor == "o0"
    assert first.seq < kill.seq < ruled.seq


def test_the_heir_finishes_the_arbitration_the_dead_owner_began(heir_run: Path) -> None:
    log = load_events(heir_run)
    kill = chaos_kill(log)
    lost = the_one(calls(log, "effect.cancelled"))  # the kill cancels the dead owner's call
    assert tag_of(lost) == f"arbitrate|{ROOT_KEY}|1" and lost.seq > kill.seq
    again = [e for e in of(log, "arbitration.requested") if e.payload["attempt"] == 2]
    heir = the_one(again)
    assert heir.actor != "o0" and heir.payload["lca"] == "root" and heir.seq > kill.seq
    adopted = [e for e in of(log, "ownership.remapped") if e.payload["key"] == "root"]
    assert adopted and adopted[-1].payload["owner"] == heir.actor
    assert heir.payload["fence"]["member"] == heir.actor, "the heir writes under its own token"
    ruled = the_one(of(log, "arbitration.ruled"))
    assert (ruled.actor, ruled.payload["attempt"], ruled.payload["by"]) == (
        heir.actor,
        2,
        "arbiter",
    )
    assert ruled.payload["work"] == "track-hci/d1/extract"
    assert not [
        e
        for e in of(log, "arbitration.requested", "arbitration.ruled")
        if e.actor == "o0" and e.seq > kill.seq
    ]


def test_the_takeover_rules_once(heir_run: Path) -> None:
    log = load_events(heir_run)
    assert len(of(log, "arbitration.ruled")) == 1
    assert len(of(log, "fact.resolved")) == 1
    assert len([e for e in of(log, "collision.resolved") if e.payload["kind"] == "semantic"]) == 1
    assert [tag_of(e) for e in calls(log)] == [f"arbitrate|{ROOT_KEY}|1", f"arbitrate|{ROOT_KEY}|2"]


def test_the_held_places_take_the_heirs_ruling(heir_run: Path) -> None:
    log = load_events(heir_run)
    ruled = the_one(of(log, "arbitration.ruled"))
    found = candidates_of(log, ROOT_KEY)
    for session in ("track-hci/d1", ROOT_SESSION):
        sent, row = place_of(log, session, ROOT_SPEAKER)
        assert reading(row) == found["track-hci/d1/extract"], session
        assert sent.ts_virtual <= ruled.ts_virtual + arbitration.HOLD_MS
    assert_valid_program(log)


async def test_the_heir_run_replays_bit_for_bit(heir_run: Path) -> None:
    await assert_replays(heir_run)


# -- the same, for a restarted coordinator -------------------------------------------------------


def crash_and_restart(log: list[Event]) -> tuple[Event, Event]:
    return the_one(of(log, "baseline.crashed")), the_one(of(log, "baseline.restarted"))


def test_a_restarted_central_coordinator_asks_again(central_run: Path) -> None:
    log = load_events(central_run)
    crashed, restarted = crash_and_restart(log)
    first = next(e for e in of(log, "arbitration.requested") if e.payload["attempt"] == 1)
    assert first.seq < crashed.seq
    (lost,) = calls(log, "effect.cancelled")
    assert tag_of(lost) == f"arbitrate|{ROOT_KEY}|1" and crashed.seq < lost.seq < restarted.seq
    again = the_one([e for e in of(log, "arbitration.requested") if e.payload["attempt"] == 2])
    assert again.seq > crashed.seq and again.actor == "o0"
    ruled = the_one(of(log, "arbitration.ruled"))
    assert (ruled.actor, ruled.payload["attempt"]) == ("o0", 2) and ruled.seq > restarted.seq
    assert_valid_program(log)


def test_durable_max_keeps_the_call_through_the_crash(durable_max_run: Path) -> None:
    log = load_events(durable_max_run)
    crashed, restarted = crash_and_restart(log)
    assert calls(log, "effect.cancelled") == [], "the call is a durable job"
    assert [tag_of(e) for e in calls(log)] == [f"arbitrate|{ROOT_KEY}|1"]
    ruled = the_one(of(log, "arbitration.ruled"))
    assert ruled.payload["attempt"] == 1 and ruled.seq > restarted.seq > crashed.seq
    assert ruled.payload["reused"] is False, "the same coordinator, back"
    assert_valid_program(log)


def test_durable_loses_the_call_with_the_process_and_asks_again(durable_run: Path) -> None:
    log = load_events(durable_run)
    crashed, restarted = crash_and_restart(log)
    (lost,) = calls(log, "effect.cancelled")
    assert tag_of(lost) == f"arbitrate|{ROOT_KEY}|1" and lost.seq > crashed.seq
    assert tag_of(lost) in crashed.payload["lost"]
    ruled = the_one(of(log, "arbitration.ruled"))
    assert ruled.payload["attempt"] == 2 and ruled.seq > restarted.seq
    assert_valid_program(log)


@pytest.mark.parametrize("run_name", ["central_run", "durable_max_run", "durable_run"])
async def test_the_restarted_runs_replay_bit_for_bit(
    run_name: str, request: pytest.FixtureRequest
) -> None:
    await assert_replays(request.getfixturevalue(run_name))


# -- the lens lists the disputes, the open ones at the end included ----------------------------


@pytest.fixture(scope="module")
def client(
    out: Path, root_run: Path, quiet_run: Path, open_run: Path, heir_run: Path, doubtful_run: Path
) -> TestClient:
    return TestClient(create_app(out, REPO / "demo", out / "bench", Path("none")))


def disputes_of(client: TestClient, run: Path) -> dict[str, Any]:
    response = client.get(f"/api/runs/{run.name}/disputes")
    assert response.status_code == 200, response.text
    return response.json()


def test_a_ruled_dispute_is_listed_with_its_candidates_call_and_ruling(
    client: TestClient, root_run: Path
) -> None:
    listed = disputes_of(client, root_run)
    assert (listed["ended"], listed["count"], listed["open"]) == (True, 1, 0)
    (dispute,) = listed["disputes"]
    assert (dispute["key"], dispute["subject"], dispute["status"]) == (ROOT_KEY, "S02", "ruled")
    assert dispute["lca"] == "root" and dispute["goal_id"] in {"track-hci/d1", ROOT_SESSION}
    assert [c["label"] for c in dispute["candidates"]] == ["A", "B"]
    assert {w for c in dispute["candidates"] for w in c["works"]} == {
        "track-hci/d1/extract",
        ROOT_SESSION + "/extract",
    }
    (call,) = dispute["calls"]
    assert (call["attempt"], call["status"], call["cancel"]) == (1, "ok", None)
    assert call["model"] == "muse-wonder-1.0"
    ruling = dispute["ruling"]
    assert ruling["by"] == "arbiter" and ruling["attempt"] == 1 and ruling["reused"] is False
    assert ruling["winner"] in {"A", "B"} and ruling["confidence"] > 0.6
    assert dispute["escalation"] is None and dispute["why_open"] is None


def test_the_listed_ruling_is_the_one_in_the_log(client: TestClient, root_run: Path) -> None:
    (dispute,) = disputes_of(client, root_run)["disputes"]
    ruled = the_one(of(load_events(root_run), "arbitration.ruled"))
    assert dispute["ruling"]["seq"] == ruled.seq
    assert dispute["ruling"]["work"] == ruled.payload["work"]
    assert dispute["ruling"]["reason"] == ruled.payload["reason"]
    opened = the_one(collisions(load_events(root_run)))
    assert (dispute["opened_seq"], dispute["opened_ts"]) == (opened.seq, opened.ts_virtual)


def test_a_run_without_a_dispute_lists_none(client: TestClient, quiet_run: Path) -> None:
    listed = disputes_of(client, quiet_run)
    assert (listed["ended"], listed["count"], listed["open"], listed["disputes"]) == (
        True,
        0,
        0,
        [],
    )


def test_a_dispute_still_open_when_the_run_ends_is_listed_and_says_why(
    client: TestClient, open_run: Path
) -> None:
    log = load_events(open_run)
    assert of(log, "arbitration.ruled") == []
    assert_valid_program(log)
    listed = disputes_of(client, open_run)
    assert (listed["ended"], listed["count"], listed["open"]) == (True, 1, 1)
    (dispute,) = listed["disputes"]
    assert dispute["status"] == "open" and dispute["ruling"] is None
    (call,) = dispute["calls"]
    assert call["attempt"] == 1 and call["status"] == "cancelled" and call["estimated"] is True
    assert call["cancel"]["kind"] == "actor_stopped" and call["cancel"]["reason"] == "done"
    assert dispute["why_open"] == (
        "o0 finished its work before the arbiter answered; its call was cancelled"
    )
    assert [c["label"] for c in dispute["candidates"]] == ["A", "B"]


def test_the_heirs_second_attempt_is_listed_after_the_first_that_died(
    client: TestClient, heir_run: Path
) -> None:
    listed = disputes_of(client, heir_run)
    assert (listed["count"], listed["open"]) == (1, 0)
    (dispute,) = listed["disputes"]
    first, second = dispute["calls"]
    assert (first["attempt"], first["actor"], first["status"]) == (1, "o0", "cancelled")
    assert first["cancel"]["kind"] == "actor_stopped" and "chaos" in first["cancel"]["detail"]
    assert (second["attempt"], second["status"], second["cancel"]) == (2, "ok", None)
    assert second["actor"] != "o0"
    assert dispute["ruling"]["attempt"] == 2 and dispute["ruling"]["arbiter"] == second["actor"]


def test_a_doubtful_ruling_lists_the_question_a_person_may_answer(
    client: TestClient, doubtful_run: Path
) -> None:
    (dispute,) = disputes_of(client, doubtful_run)["disputes"]
    assert dispute["status"] == "ruled" and dispute["ruling"]["confidence"] == 0.4
    escalation = dispute["escalation"]
    assert escalation["id"] == f"arbitration:{ROOT_KEY}" and escalation["options"] == ["A", "B"]
    assert (escalation["default"], escalation["timeout_ms"]) == ("A", 60_000)


def test_an_unknown_run_has_no_disputes(client: TestClient) -> None:
    assert client.get("/api/runs/no-such-run/disputes").status_code == 404
