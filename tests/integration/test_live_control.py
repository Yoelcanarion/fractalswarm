"""Live control (step 7): a person's controls enter the log as ``control.injected`` (an outside
event, like a completion or a halt) and replay puts each one in the same place.

The person is a stand-in for the API: it drops requests into the run's control inbox, which is
what ``fractalswarm halt`` and ``POST /api/runs/{id}/chaos`` do from another process, each one
once the log shows what the person would have seen (a proposal to answer, a coordinator that
died). Fake LLM only; every run here is launched with ``live_control``, as the API launches them.
"""

import json
import shutil
import sqlite3
import subprocess
import sys
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from fractalswarm.actors.orchestrator import APPROVAL_TICK_MS, APPROVAL_TIMEOUT_MS
from fractalswarm.bench.tasks.t2_conference.fake import t2_script
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import ENV, Event, validate_payload
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.resume import resume_run
from fractalswarm.runs import RunPaths, RunResult, record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
LAUNCH = [sys.executable, "-c", "from fractalswarm.cli import app; app()"]

Request = dict[str, Any] | list[dict[str, Any]]
Step = tuple[dict[str, int], Request | Callable[[RunPaths], Request]]


def inject(control: dict[str, Any]) -> dict[str, Any]:
    """The inbox request that carries a control (``api/controls.py`` writes the same)."""
    return {"op": "inject", "control": control}


def counted(paths: RunPaths) -> dict[str, int] | None:
    """How many events of each type the log has now, or None while it has no events yet."""
    if not paths.events.exists():
        return None
    try:
        with closing(sqlite3.connect(f"file:{paths.events}?mode=ro", uri=True)) as db:
            return dict(db.execute("SELECT type, COUNT(*) FROM events GROUP BY type"))
    except sqlite3.Error:
        return None


def person(monkeypatch: pytest.MonkeyPatch, *steps: Step) -> None:
    """A person at the UI. Each step is ``(needs, request)``: the request goes into the inbox,
    in order and one step per poll, once the log has ``needs`` events (type -> at least n). A
    request may be a function of the run's paths, for what the person has to look up first."""
    sent: list[int] = []

    def poll(self: RunPaths) -> list[dict[str, Any]]:
        counts = counted(self)
        if counts is None or len(sent) == len(steps):
            return []
        needs, request = steps[len(sent)]
        if any(counts.get(kind, 0) < n for kind, n in needs.items()):
            return []
        sent.append(1)
        request = request(self) if callable(request) else request
        return request if isinstance(request, list) else [request]

    monkeypatch.setattr(RunPaths, "poll_control", poll)


def agents_of(paths: RunPaths) -> list[str]:
    """The agents the log has spawned, as the UI lists them."""
    with closing(sqlite3.connect(f"file:{paths.events}?mode=ro", uri=True)) as db:
        rows = db.execute("SELECT payload FROM events WHERE type = 'actor.spawned'").fetchall()
    spawned = [json.loads(row[0]) for row in rows]
    return [found["actor_id"] for found in spawned if found["kind"] == "agent"]


def events_of(result: RunResult) -> list[Event]:
    with EventStore(result.paths.events) as store:
        return list(store.read())


def of_type(events: list[Event], event_type: str) -> list[Event]:
    return [event for event in events if event.type == event_type]


def fresh_process_replay(run_dir: Path) -> str:
    """``fractalswarm replay RUN --verify`` in a process that has never seen the run."""
    done = subprocess.run(
        [*LAUNCH, "replay", str(run_dir), "--verify"], capture_output=True, text=True, timeout=300
    )
    assert done.returncode == 0, done.stdout + done.stderr
    return done.stdout


async def replays(result: RunResult) -> None:
    """The run replays to the same head, in this process and in a fresh one."""
    report = await replay_run(result.paths.root)
    assert report.ok and report.replayed_head == result.head_hash, report.detail
    assert fresh_process_replay(result.paths.root).startswith("MATCH")


def held_spec() -> TaskSpec:
    return TaskSpec.load(TASKSPEC).model_copy(update={"auto_approve": False})


async def t2_run(
    tmp_path: Path,
    name: str,
    *,
    scenario: str = "swarm",
    spec: TaskSpec | None = None,
    live: bool = True,
    chaos: Any = None,
    seen: list[str] | None = None,
    **params: Any,
) -> RunResult:
    """The T2 conference run, launched as the API launches one (``live_control``)."""
    spec = spec or TaskSpec.load(TASKSPEC)

    def script(body: dict[str, Any], attempt: int) -> str:
        if seen is not None:
            seen.append(json.dumps(body))
        return t2_script(body, attempt)

    extra: dict[str, Any] = {"live_control": True} if live else {}
    if chaos is not None:
        extra["chaos"] = chaos
    return await record_run(
        scenario,
        run_id=name,
        run_dir=tmp_path / name,
        backend=FakeBackend(script=script),
        seed=spec.seed,
        params=run_params(spec) | extra | params,
        run_cap_usd=spec.budget_usd,
    )


def outcome(events: list[Event]) -> dict[str, Any]:
    (result,) = of_type(events, "task.result")
    return result.payload


# -- a kill at a progress point (the chaos monkey) -----------------------------------------------

CALM = {"profile": "C0", "seed": "live"}  # no chaos planned: the monkey is there for the person


def kill(at: float, **body: Any) -> dict[str, Any]:
    return {"op": "chaos", "body": {"kind": "kill_coordinator", "at": at} | body, "to": "chaos"}


def kills_of(events: list[Event]) -> list[Event]:
    return [e for e in events if e.type == "chaos.injected" and e.payload["fault"] != "heal"]


async def test_a_kill_injected_at_a_progress_point_fires_there_and_replays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    order = kill(0.5)
    person(monkeypatch, ({}, inject(order)))
    result = await t2_run(tmp_path, "injected", chaos=CALM)
    events = events_of(result)

    (control,) = of_type(events, "control.injected")
    assert control.actor == ENV and control.payload == order
    (strike,) = kills_of(events)
    assert strike.payload["fault"] == "kill_coordinator" and strike.seq > control.seq
    assert strike.payload["progress"] >= 0.5  # not before the run got there
    assert outcome(events)["status"] == "ok"
    assert of_type(events, "ownership.remapped")  # the survivors took the work, with no election
    await replays(result)


async def test_an_injected_kill_takes_its_place_among_the_planned_ones(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    planned = ChaosPlan(
        actions=(
            ChaosAction(at=0.3, kind="kill_coordinator"),
            ChaosAction(at=0.8, kind="kill_coordinator"),
        )
    )
    person(monkeypatch, ({}, inject(kill(0.5))))
    result = await t2_run(tmp_path, "between", chaos=planned.model_dump(mode="json"))
    events = events_of(result)
    strikes = kills_of(events)
    progress = [s.payload["progress"] for s in strikes]
    assert len(strikes) == 3 and progress == sorted(progress)  # in order of `at`, not of arrival
    assert all(found >= at for found, at in zip(progress, (0.3, 0.5, 0.8), strict=True))
    assert outcome(events)["status"] == "ok"
    await replays(result)


async def test_a_kill_that_names_its_target_kills_that_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(monkeypatch, ({}, inject(kill(0.2, target="o2"))))
    result = await t2_run(tmp_path, "named", chaos=CALM)
    (strike,) = kills_of(events_of(result))
    assert strike.payload["target"] == "o2"
    await replays(result)


async def test_a_run_not_launched_to_take_controls_ignores_them(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(monkeypatch, ({}, inject(kill(0.2))))
    result = await t2_run(tmp_path, "deaf", chaos=CALM, live=False)
    events = events_of(result)
    assert len(of_type(events, "control.injected")) == 1  # the log says the person acted
    assert not kills_of(events)  # and nothing came of it
    await replays(result)


async def test_a_control_nobody_understands_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = await t2_run(tmp_path, "calm", chaos=CALM)
    nonsense = [
        {"op": "chaos", "body": {"kind": "kill_coordinator"}, "to": "chaos"},  # no `at`
        {"op": "chaos", "body": {"kind": "set_fire", "at": 0.1}, "to": "chaos"},
        {"op": "dance", "body": {}, "to": "chaos"},
        {"op": "chaos", "body": {"kind": "kill_coordinator", "at": 0.1}, "to": "nobody"},
        {"op": "approve", "body": {}, "to": "goal:root"},  # nothing waits for approval
        {"op": "approve", "body": {}, "to": "*"},
    ]
    person(monkeypatch, *[({}, inject(control)) for control in nonsense])
    result = await t2_run(tmp_path, "noise", chaos=CALM)
    events = events_of(result)
    assert len(of_type(events, "control.injected")) == len(nonsense)  # all of them are in the log
    assert not kills_of(events)
    plain = [e.type for e in events if e.type != "control.injected"]
    assert plain == [e.type for e in events_of(baseline)]  # and nothing else moved
    await replays(result)


async def test_an_answer_to_an_escalation_is_recorded_for_the_arbiter_and_replays(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``answer`` is the arbiter's (W3: an escalation's choice, for the goal it names). This layer
    records it as the person sent it and puts it in front of every live actor; the handlers that
    have no escalation to answer leave it alone."""
    answer = {
        "op": "answer",
        "body": {"escalation_id": "arbitration:talk.room", "choice": "B"},
        "to": "goal:root",
    }
    baseline = await t2_run(tmp_path, "unasked", chaos=CALM)
    person(monkeypatch, ({}, inject(answer)))
    result = await t2_run(tmp_path, "answered", chaos=CALM)
    events = events_of(result)
    (control,) = of_type(events, "control.injected")
    assert control.actor == ENV and control.payload == answer
    assert [e.type for e in events if e.type != "control.injected"] == [
        e.type for e in events_of(baseline)
    ]
    await replays(result)


async def test_a_halted_run_only_records_the_halt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    halt = {"op": "halt", "reason": "stop", "by": "human"}
    person(monkeypatch, ({}, [halt, inject(kill(0.1))]))
    result = await t2_run(tmp_path, "halted", chaos=CALM)
    seen = [e.type for e in events_of(result)]
    assert "run.halted" in seen and "control.injected" not in seen
    await replays(result)


def test_a_control_is_a_registered_event_with_no_surprise_fields() -> None:
    assert validate_payload("control.injected", {"op": "approve", "to": "goal:root"})["body"] == {}
    with pytest.raises(ValidationError):
        validate_payload("control.injected", {"op": "approve", "to": "goal:root", "extra": 1})
    with pytest.raises(ValidationError):
        validate_payload("control.injected", {"op": "approve"})  # it is for someone


# -- a person approves the plan (auto_approve: false) --------------------------------------------

APPROVE = {"op": "approve", "body": {}, "to": "goal:root"}
PROPOSED = {"plan.proposed": 1}


def replan(feedback: str) -> dict[str, Any]:
    return {"op": "replan", "body": {"feedback": feedback}, "to": "goal:root"}


def story(events: list[Event]) -> list[str]:
    keep = ("plan.proposed", "plan.rejected", "plan.approved", "control.injected")
    return [
        f"{e.type}:{e.payload.get('by', e.payload.get('op', ''))}" for e in events if e.type in keep
    ]


def humans(events: list[Event]) -> list[Event]:
    return [e for e in of_type(events, "plan.approved") if e.payload["by"] == "human"]


async def test_a_plan_waits_for_a_person_and_goes_on_when_they_approve(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(monkeypatch, (PROPOSED, inject(APPROVE)))
    result = await t2_run(tmp_path, "approved", spec=held_spec())
    events = events_of(result)
    assert story(events) == ["plan.proposed:", "control.injected:approve", "plan.approved:human"]

    proposed, control, approved = (
        of_type(events, "plan.proposed")[0],
        of_type(events, "control.injected")[0],
        of_type(events, "plan.approved")[0],
    )
    assert proposed.seq < control.seq < approved.seq
    assert approved.payload["scope_token"] == proposed.payload["plan_hash"]
    assert approved.payload["envelope"]  # the same envelope the automatic path records
    # Nothing was handed out before the person said yes.
    assigned = of_type(events, "ownership.assigned")
    assert assigned and all(e.seq > approved.seq for e in assigned)
    assert outcome(events)["status"] == "ok" and outcome(events)["report"]["placed"] == 48
    await replays(result)


async def test_the_approved_run_does_the_work_of_the_automatic_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    automatic = await t2_run(tmp_path, "auto")
    person(monkeypatch, (PROPOSED, inject(APPROVE)))
    held = await t2_run(tmp_path, "held", spec=held_spec())
    assert story(events_of(automatic)) == ["plan.proposed:", "plan.approved:auto"]
    for key in ("placed", "hard_violations", "expected"):
        assert (
            outcome(events_of(held))["report"][key] == outcome(events_of(automatic))["report"][key]
        )


async def test_a_run_that_cannot_get_an_answer_never_waits_for_one(tmp_path: Path) -> None:
    result = await t2_run(tmp_path, "cli", spec=held_spec(), live=False)  # a CLI run
    events = events_of(result)
    assert story(events) == ["plan.proposed:", "plan.approved:auto"]
    tags = [e.payload["tag"] for e in of_type(events, "effect.started") if e.payload.get("tag")]
    assert not [tag for tag in tags if tag.startswith("approval")]
    await replays(result)


async def test_a_plan_sent_back_is_planned_again_with_the_feedback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    feedback = "keep the keynote out of the first slot"
    person(
        monkeypatch,
        (PROPOSED, inject(replan(feedback))),
        ({"plan.proposed": 2}, inject(APPROVE)),
    )
    prompts: list[str] = []
    result = await t2_run(tmp_path, "sent-back", spec=held_spec(), seen=prompts)
    events = events_of(result)
    assert story(events) == [
        "plan.proposed:",
        "control.injected:replan",
        "plan.rejected:",
        "plan.proposed:",
        "control.injected:approve",
        "plan.approved:human",
    ]
    (rejected,) = of_type(events, "plan.rejected")
    assert rejected.payload["errors"] == [feedback] and rejected.payload["attempt"] == 0
    assert feedback not in prompts[0] and feedback in prompts[1]  # the planner was told
    assert outcome(events)["report"]["placed"] == 48
    await replays(result)


async def test_a_control_for_another_plan_or_another_goal_changes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stale = {"op": "approve", "body": {"plan_hash": "not-this-plan"}, "to": "goal:root"}
    person(
        monkeypatch,
        (PROPOSED, inject(stale)),
        (PROPOSED, inject({"op": "approve", "body": {}, "to": "goal:elsewhere"})),
        (PROPOSED, inject({"op": "approve", "body": {}, "to": "*"})),  # not by goal
        (PROPOSED, inject({"op": "approve", "body": {}, "to": "o0"})),  # not by goal
        (PROPOSED, inject(APPROVE)),
    )
    result = await t2_run(tmp_path, "mistaken", spec=held_spec())
    events = events_of(result)
    controls = of_type(events, "control.injected")
    assert len(controls) == 5
    (approved,) = of_type(events, "plan.approved")
    assert approved.payload["by"] == "human" and approved.seq > controls[4].seq
    await replays(result)


async def test_the_hash_of_the_held_plan_is_the_one_an_approval_may_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    named: list[str] = []

    def poll(self: RunPaths) -> list[dict[str, Any]]:
        counts = counted(self)
        if named or counts is None or not counts.get("plan.proposed"):
            return []
        with closing(sqlite3.connect(f"file:{self.events}?mode=ro", uri=True)) as db:
            row = db.execute("SELECT payload FROM events WHERE type = 'plan.proposed'").fetchone()
        named.append(json.loads(row[0])["plan_hash"])
        body = {"plan_hash": named[0]}
        return [inject({"op": "approve", "body": body, "to": "goal:root"})]

    monkeypatch.setattr(RunPaths, "poll_control", poll)
    result = await t2_run(tmp_path, "hashed", spec=held_spec())
    (approved,) = humans(events_of(result))
    assert approved.payload["scope_token"] == named[0]


async def test_a_plan_nobody_answers_is_approved_when_the_wait_runs_out(tmp_path: Path) -> None:
    result = await t2_run(tmp_path, "unanswered", spec=held_spec())  # nobody comes
    events = events_of(result)
    assert story(events) == ["plan.proposed:", "plan.approved:timeout"]
    ticks = [
        e for e in events if e.type == "effect.started" and e.payload["tag"] == "approval|root"
    ]
    assert len(ticks) == APPROVAL_TIMEOUT_MS // APPROVAL_TICK_MS  # a timer kept the run alive
    assert outcome(events)["report"]["placed"] == 48
    await replays(result)


@pytest.mark.parametrize("scenario", ["central", "durable-max", "durable", "single", "pipeline"])
async def test_the_rivals_wait_for_a_person_too(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    person(monkeypatch, (PROPOSED, inject(APPROVE)))
    result = await t2_run(tmp_path, scenario, scenario=scenario, spec=held_spec())
    events = events_of(result)
    assert story(events) == ["plan.proposed:", "control.injected:approve", "plan.approved:human"]
    assert outcome(events)["status"] == "ok" and outcome(events)["report"]["placed"] == 48
    await replays(result)


# -- the addressee dies: its heir handles the control --------------------------------------------

KILL_ROOT = kill(0.0, target="o0")


async def test_the_heir_of_a_root_that_died_holding_the_plan_handles_the_approval(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(
        monkeypatch,
        (PROPOSED, inject(KILL_ROOT)),
        ({"plan.proposed": 2}, inject(APPROVE)),  # the heir proposed again
    )
    result = await t2_run(tmp_path, "heir", spec=held_spec(), chaos=CALM)
    events = events_of(result)
    (strike,) = kills_of(events)
    assert strike.payload["target"] == "o0"
    heir = next(e for e in of_type(events, "ownership.remapped") if e.payload["key"] == "root")
    first, second = of_type(events, "plan.proposed")
    assert first.actor == "o0" and second.actor == heir.payload["owner"] != "o0"
    (approved,) = humans(events)
    assert approved.actor == heir.payload["owner"]  # the heir answered, not the dead root
    assert strike.seq < heir.seq < second.seq < approved.seq
    assert outcome(events)["status"] == "ok" and outcome(events)["report"]["placed"] == 48
    await replays(result)


async def test_an_approval_that_beats_the_heir_is_lost_with_the_plan_and_asked_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(
        monkeypatch,
        (PROPOSED, inject(KILL_ROOT)),
        ({"chaos.injected": 1}, inject(APPROVE)),  # the root is dead, its heir has not come
        ({"plan.proposed": 2}, inject(APPROVE)),
    )
    result = await t2_run(tmp_path, "gap", spec=held_spec(), chaos=CALM)
    events = events_of(result)
    early, late = of_type(events, "control.injected")[1:]
    heir = next(e for e in of_type(events, "ownership.remapped") if e.payload["key"] == "root")
    assert early.seq < heir.seq < late.seq  # the first answer came before anyone owned the plan
    (approved,) = humans(events)
    assert approved.seq > late.seq
    assert outcome(events)["status"] == "ok"
    await replays(result)


@pytest.mark.parametrize("scenario", ["central", "durable-max", "durable"])
async def test_a_rival_that_crashed_holding_the_plan_waits_on_after_its_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, scenario: str
) -> None:
    person(
        monkeypatch,
        (PROPOSED, inject(KILL_ROOT)),
        ({"baseline.restarted": 1}, inject(APPROVE)),
    )
    result = await t2_run(
        tmp_path, f"crash-{scenario}", scenario=scenario, spec=held_spec(), chaos=CALM
    )
    events = events_of(result)
    assert of_type(events, "baseline.crashed") and of_type(events, "baseline.restarted")
    assert story(events)[-1] == "plan.approved:human" and len(humans(events)) == 1
    assert outcome(events)["status"] == "ok" and outcome(events)["report"]["placed"] == 48
    await replays(result)


# -- resume: the control is in the log ------------------------------------------------------------


def cut_after(source: Path, dest: Path, cut: int) -> None:
    """Copy a finished run as if its process had died after event ``cut``: the log is cut, and
    the cassette keeps the replies of the effects that had started (all of them: case (b))."""
    shutil.copytree(source, dest)
    paths = RunPaths(dest)
    paths.events_jsonl.unlink()
    with closing(sqlite3.connect(paths.events, isolation_level=None)) as db:
        db.execute("DELETE FROM events WHERE seq > ?", (cut,))
    with paths.open_log() as log:
        started = {e.payload["effect_id"] for e in log.read() if e.type == "effect.started"}
    kept = [
        line
        for line in paths.cassette.read_text(encoding="utf-8").splitlines()
        if json.loads(line)["effect_id"] in started
    ]
    paths.cassette.write_text("\n".join(kept) + "\n", encoding="utf-8", newline="\n")


async def test_a_run_resumed_after_the_approval_goes_on_from_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(monkeypatch, (PROPOSED, inject(APPROVE)))
    spec = held_spec()
    whole = tmp_path / "whole"
    await record_run(
        "swarm",
        run_id="whole",
        run_dir=whole,
        backend=fake_backend(),
        seed=spec.seed,
        params=run_params(spec) | {"live_control": True},
        run_cap_usd=spec.budget_usd,
    )
    monkeypatch.undo()  # nobody at the UI while the dead process is replaced
    with RunPaths(whole).open_log() as log:
        events = list(log.read())
    control = of_type(events, "control.injected")[0]
    wanted = outcome(events)

    for name, cut in (("on-the-approval", control.seq), ("before-the-approval", control.seq - 1)):
        dest = tmp_path / name
        cut_after(whole, dest, cut)
        await resume_run(dest, backend=fake_backend())
        with RunPaths(dest).open_log() as log:
            resumed = list(log.read())
            assert log.verify_chain().ok
        assert resumed[-1].type == "run.completed"
        assert outcome(resumed) == wanted, name
        report = await replay_run(dest)
        assert report.ok, f"{name}: {report.detail}"
        if cut == control.seq:  # the control was in the cut log: the resume kept it
            assert [e.payload["by"] for e in of_type(resumed, "plan.approved")] == ["human"], name


# -- agents and half the brains ------------------------------------------------------------------


def kill_agent(at: float = 0.0, **body: Any) -> dict[str, Any]:
    return {"op": "chaos", "body": {"kind": "kill_agent", "at": at} | body, "to": "chaos"}


def agent_kills(events: list[Event]) -> list[Event]:
    return [e for e in events if e.type == "chaos.injected" and e.payload["fault"] == "kill_agent"]


async def test_a_person_kills_the_agent_they_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dispatched = {"contract.dispatched": 1}
    person(monkeypatch, (dispatched, lambda paths: inject(kill_agent(target=agents_of(paths)[0]))))
    result = await t2_run(tmp_path, "agent", chaos=CALM)
    events = events_of(result)
    (strike,) = agent_kills(events)
    spawned = next(e for e in of_type(events, "actor.spawned") if e.payload["kind"] == "agent")
    assert strike.payload["target"] == spawned.payload["actor_id"]
    stopped = [
        e
        for e in of_type(events, "actor.stopped")
        if e.payload["actor_id"] == strike.payload["target"]
    ]
    assert stopped and stopped[0].seq > strike.seq
    assert outcome(events)["status"] == "ok"
    await replays(result)


async def test_a_person_kills_some_agents_and_the_log_says_which(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(monkeypatch, ({"contract.dispatched": 3}, inject(kill_agent(count=2))))
    result = await t2_run(tmp_path, "agents", chaos=CALM)
    events = events_of(result)
    victims = [e.payload["target"] for e in agent_kills(events)]
    assert len(victims) == 2 and len(set(victims)) == 2  # drawn once each, by name
    assert outcome(events)["status"] == "ok"
    await replays(result)


async def test_a_kill_of_an_agent_that_is_not_there_is_logged_as_skipped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    person(monkeypatch, ({}, inject(kill_agent(target="o9.9.a9"))))
    result = await t2_run(tmp_path, "ghost", chaos=CALM)
    events = events_of(result)
    (skipped,) = [
        e for e in of_type(events, "chaos.injected") if e.payload["detail"].get("skipped")
    ]
    assert skipped.payload["fault"] == "kill_agents" and not agent_kills(events)
    assert outcome(events)["status"] == "ok"
    await replays(result)


async def test_kill_half_the_brains_from_the_button_still_finishes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fractalswarm.api.controls import KILL_HALF_TARGETS

    half = [inject(kill(0.3, target=target)) for target in KILL_HALF_TARGETS]
    person(monkeypatch, ({}, half))
    result = await t2_run(tmp_path, "half", chaos=CALM)
    events = events_of(result)
    killed = [e.payload["target"] for e in kills_of(events)]
    assert killed == list(KILL_HALF_TARGETS)  # the root first, all five
    assert min(e.payload["progress"] for e in kills_of(events)) >= 0.3
    assert outcome(events)["status"] == "ok" and outcome(events)["report"]["placed"] == 48
    await replays(result)


# -- the owner of a goal acts on a control for it, and nobody else -------------------------------


def test_only_the_owner_of_a_goal_acts_on_a_control_for_it() -> None:
    from fractalswarm.actors.orchestrator import _controlled
    from fractalswarm.kernel.scheduler import View

    class Owners:
        def __init__(self, owner: str) -> None:
            self.owner = owner

        def owner_of(self, gid: str) -> str:
            return self.owner

    def view(owner: str) -> View:
        return View(
            run_id="r",
            seed="s",
            actor_id="o0",
            now=0,
            lamport=0,
            alive=("o0", "o1"),
            views={"tree": Owners(owner)},
        )

    state = {"id": "o0", "goals": {"root": {"phase": "awaiting", "token": "t"}}}
    control = {"op": "approve", "body": {}, "to": "goal:root"}
    assert _controlled(state, control, view("o1")) == (state, [])  # o1 owns it now: not o0's
    with pytest.raises(KeyError):  # o0 owns it: it acts (this state has no plan to go on with)
        _controlled(state, control, view("o0"))
