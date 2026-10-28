"""Process-crash recovery with real kills (spec §8, docs/resume.md).

Each test starts a real ``fractalswarm run`` in a child process (T2, fake LLM, $0), hard-kills
it (``Popen.kill()``, which is ``TerminateProcess`` on Windows) at a chosen point, then runs
``fractalswarm resume`` in a new child. The fake LLM appends every request it receives to a
counter file shared by all the processes, so the provider's side is counted, not assumed.

The oracle is computed from a copy of the run directory taken right after the kill, before
the resume touches it:

- (a) completed in the log, and (b) answered in the cassette but not completed: no request may
  follow them, so the counter must not move;
- (c) sent with no reply on record, and (d) started and never sent: the resume sends each of
  them once more. They cannot be told apart from the files, so both must be listed in
  ``run.resumed`` and in an ``effect.reissued``, and counted in ``possible_extra_usd``;
- every effect that started after the crash is sent exactly once;
- the program is complete and valid, the hash chain verifies and ``replay --verify`` matches.

The children run in a sandbox home, so they see no secrets and no real project ledger.
"""

import contextlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pytest

from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import EventStore
from fractalswarm.runs import replay_run

REPO = Path(__file__).resolve().parents[2]
WORKER = Path(__file__).with_name("resume_worker.py")
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
RUN_ID = "crash"
TIMEOUT_S = 300
LOCAL = {"timer", "firewall"}


class Sandbox:
    """What a child process sees: its own runs directory, home and request counter."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.home = root / "home"
        self.home.mkdir()
        self.runs = root / "runs"
        self.counter = root / "requests.jsonl"
        self.signal = root / "signal.json"
        self.children: list[subprocess.Popen[bytes]] = []

    @property
    def run_dir(self) -> Path:
        return self.runs / RUN_ID

    @property
    def log_db(self) -> Path:
        return self.run_dir / "events.sqlite"

    def spawn(self, *args: str, **hooks: str) -> subprocess.Popen[bytes]:
        env = os.environ | {
            "FRACTALSWARM_RUNS_DIR": str(self.runs),
            "USERPROFILE": str(self.home),
            "HOME": str(self.home),
            "RESUME_COUNTER": str(self.counter),
            "RESUME_SIGNAL": str(self.signal),
        }
        env |= {f"RESUME_{name.upper()}": value for name, value in hooks.items()}
        output = (self.root / f"child-{len(self.children)}.log").open("wb")
        child = subprocess.Popen(
            [sys.executable, str(WORKER), *args],
            env=env,
            cwd=REPO,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        child.log_path = output.name  # type: ignore[attr-defined]
        self.children.append(child)
        return child

    def output(self, child: subprocess.Popen[bytes]) -> str:
        return Path(child.log_path).read_text(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

    def run(self, *extra: str, **hooks: str) -> subprocess.Popen[bytes]:
        return self.spawn("run", str(TASKSPEC), "--run-id", RUN_ID, *extra, **hooks)

    def resume(self, *extra: str, **hooks: str) -> subprocess.Popen[bytes]:
        return self.spawn("resume", RUN_ID, *extra, **hooks)

    def served(self) -> Counter[str]:
        if not self.counter.exists():
            return Counter()
        lines = self.counter.read_text(encoding="utf-8").splitlines()
        return Counter(json.loads(line)["effect_id"] for line in lines if line.strip())

    def finish(self, child: subprocess.Popen[bytes], expect: int = 0) -> str:
        code = child.wait(timeout=TIMEOUT_S)
        text = self.output(child)
        assert code == expect, f"exit {code}, wanted {expect}\n{text[-3000:]}"
        return text

    def kill(self, child: subprocess.Popen[bytes]) -> None:
        assert child.poll() is None, f"the child ended on its own\n{self.output(child)[-3000:]}"
        child.kill()
        child.wait(timeout=60)

    def cleanup(self) -> None:
        for child in self.children:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=60)


@pytest.fixture
def box(tmp_path: Path):
    sandbox = Sandbox(tmp_path)
    yield sandbox
    sandbox.cleanup()


def query(db: Path, sql: str, *args: object) -> tuple | None:
    """One row of the live log, without ever creating it (the child must find it absent)."""
    if not db.exists():
        return None
    try:
        conn = sqlite3.connect(f"{db.as_uri()}?mode=rw", uri=True, timeout=2)
    except sqlite3.OperationalError:
        return None
    try:
        return conn.execute(sql, args).fetchone()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()


def wait_for(
    box: Sandbox, child: subprocess.Popen[bytes], condition: Callable[[], bool], what: str
) -> None:
    deadline = time.monotonic() + TIMEOUT_S
    while time.monotonic() < deadline:
        if condition():
            return
        if child.poll() is not None:
            pytest.fail(f"the child ended before {what}\n{box.output(child)[-3000:]}")
        time.sleep(0.005)
    pytest.fail(f"timed out waiting for {what}")


def log_reaches(box: Sandbox, seq: int) -> Callable[[], bool]:
    def reached() -> bool:
        row = query(box.log_db, "SELECT MAX(seq) FROM events")
        return bool(row and row[0] and row[0] >= seq)

    return reached


def log_has(box: Sandbox, event_type: str) -> Callable[[], bool]:
    return lambda: query(box.log_db, "SELECT 1 FROM events WHERE type = ?", event_type) is not None


def signalled(box: Sandbox) -> Callable[[], bool]:
    return box.signal.exists


@dataclass
class Crash:
    """The run directory right after the kill, and what the provider had received."""

    events: list[Event]
    cassette: set[str]
    served: Counter[str]

    @property
    def started(self) -> dict[str, Event]:
        return {e.payload["effect_id"]: e for e in self.events if e.type == "effect.started"}

    @property
    def closed(self) -> set[str]:
        types = ("effect.completed", "effect.cancelled")
        return {e.payload["effect_id"] for e in self.events if e.type in types}

    def kind(self, effect_id: str) -> str:
        return self.started[effect_id].payload["kind"]

    @property
    def open(self) -> set[str]:
        return set(self.started) - self.closed

    @property
    def open_llm(self) -> set[str]:
        return {e for e in self.open if self.kind(e) == "llm"}

    @property
    def a(self) -> set[str]:
        return {e for e in self.closed if self.kind(e) == "llm"}

    @property
    def b(self) -> set[str]:
        return {e for e in self.open_llm if e in self.cassette}

    @property
    def c(self) -> set[str]:
        return {e for e in self.open_llm - self.cassette if self.served[e]}

    @property
    def d(self) -> set[str]:
        return {e for e in self.open_llm - self.cassette if not self.served[e]}

    @property
    def local(self) -> Counter[str]:
        return Counter(self.kind(e) for e in self.open if self.kind(e) in LOCAL)

    @property
    def max_ts(self) -> int:
        return max(e.ts_virtual for e in self.events)


def snapshot(box: Sandbox, name: str = "snapshot") -> Crash:
    """Copy the run directory as the dead process left it, and read it."""
    copy = box.root / name
    shutil.rmtree(copy, ignore_errors=True)
    shutil.copytree(box.run_dir, copy)
    with EventStore(copy / "events.sqlite") as log:
        events = list(log.read())
    cassette: set[str] = set()
    path = copy / "cassette.jsonl"
    for line in path.read_text(encoding="utf-8").splitlines() if path.exists() else []:
        with contextlib.suppress(ValueError):  # a torn last line: that call has no reply on record
            cassette.add(json.loads(line)["effect_id"])
    return Crash(events, cassette, box.served())


def read_log(box: Sandbox) -> list[Event]:
    with EventStore(box.log_db) as log:
        assert log.verify_chain().ok
        return list(log.read())


async def check_resumed(box: Sandbox, crash: Crash, attempt: int = 1) -> list[Event]:
    """Everything a resume promises, against the oracle of the crash it recovered from."""
    events = read_log(box)
    assert events[-1].type == "run.completed"
    markers = [e for e in events if e.type == "run.resumed"]
    assert len(markers) == attempt
    marker = markers[-1]
    resumed = marker.payload
    served = box.served()

    # No request follows a completed effect or a reply that is already in the cassette.
    for effect_id in crash.a | crash.b:
        assert served[effect_id] == crash.served[effect_id], effect_id
    # An effect with no reply on record is sent once more, and says so.
    for effect_id in crash.c | crash.d:
        assert served[effect_id] == crash.served[effect_id] + 1, effect_id
    assert set(resumed["ambiguous"]) == crash.c | crash.d
    assert set(resumed["from_cassette"]) == crash.b
    assert resumed["rerun"] == dict(crash.local)
    reissued = [e for e in events if e.type == "effect.reissued" and e.causation_id == marker.seq]
    assert {e.payload["effect_id"] for e in reissued} == set(resumed["ambiguous"])
    assert all(e.payload["ambiguous"] for e in reissued)
    # ...and counts it as possible extra cost: the worst case it reserved.
    reserved = {
        e.payload["effect_id"]: e.payload["usd"] for e in events if e.type == "budget.reserved"
    }
    owed = sum(reserved[effect_id] for effect_id in resumed["ambiguous"])
    assert resumed["possible_extra_usd"] == pytest.approx(owed, abs=1e-6)
    assert sum(e.payload["reserved_usd"] for e in reissued) == pytest.approx(owed, abs=1e-6)
    # Every effect that started after the crash was sent exactly once.
    for effect_id, count in served.items():
        if effect_id not in crash.started:
            assert count == 1, effect_id

    # Virtual time goes on from the last event and never goes back.
    assert marker.ts_virtual == crash.max_ts
    stamps = [e.ts_virtual for e in events]
    assert stamps == sorted(stamps)

    result = next(e.payload for e in events if e.type == "task.result")
    assert result["report"]["placed"] == result["report"]["expected"] == 48
    assert result["report"]["hard_violations"] == 0
    report = await replay_run(box.run_dir)
    assert report.ok, report.detail
    assert report.replayed_events == len(events)
    return events


def effect_ids(events: list[Event], event_type: str) -> list[str]:
    return [e.payload["effect_id"] for e in events if e.type == event_type]


async def test_a_kill_in_the_middle_of_a_run_resumes_to_the_same_program(box: Sandbox) -> None:
    child = box.run()
    wait_for(box, child, log_reaches(box, 2500), "the log to reach 2500 events")
    box.kill(child)
    crash = snapshot(box)
    assert crash.events[-1].type != "run.completed"
    assert crash.open  # something was in flight: timers at least

    text = box.finish(box.resume())
    assert "resuming:" in text and "MATCH" not in text  # the plan is printed before it goes on
    events = await check_resumed(box, crash)
    print(
        f"killed at {len(crash.events)} events: a={len(crash.a)} b={len(crash.b)} "
        f"c={len(crash.c)} d={len(crash.d)} local={dict(crash.local)}"
    )

    # Resuming a run that finished is a no-op, and says so.
    before = box.served()
    again = box.finish(box.resume())
    assert "already completed" in again
    assert box.served() == before
    assert len(read_log(box)) == len(events)


def signalled_effect(box: Sandbox) -> str:
    return json.loads(box.signal.read_text(encoding="utf-8"))["effect_id"]


async def test_a_request_in_flight_is_sent_again_and_listed(box: Sandbox) -> None:
    child = box.run(hold_at="20")  # the 20th request is received and never answered
    wait_for(box, child, signalled(box), "a request to be held")
    held = signalled_effect(box)
    box.kill(child)
    crash = snapshot(box)
    assert held in crash.c  # sent (the provider counted it), no reply anywhere
    assert crash.served[held] == 1

    box.finish(box.resume())
    events = await check_resumed(box, crash)
    assert box.served()[held] == 2  # at-least-once: the request really went out twice
    marker = next(e.payload for e in events if e.type == "run.resumed")
    assert held in marker["ambiguous"]
    assert marker["possible_extra_usd"] > 0


async def test_a_reply_in_the_cassette_but_not_in_the_log_is_not_sent_again(box: Sandbox) -> None:
    child = box.run(freeze_after_record="20")  # stop dead right after the 20th cassette record
    wait_for(box, child, signalled(box), "a cassette record")
    recorded = signalled_effect(box)
    box.kill(child)
    crash = snapshot(box)
    # The window is real: the reply is on disk, the completion is not.
    assert recorded in crash.cassette
    assert recorded in crash.open_llm
    assert recorded in crash.b
    assert crash.served[recorded] == 1

    box.finish(box.resume())
    events = await check_resumed(box, crash)
    assert box.served()[recorded] == 1  # answered from the cassette: no second request
    marker = next(e.payload for e in events if e.type == "run.resumed")
    assert recorded in marker["from_cassette"]
    assert recorded not in marker["ambiguous"]
    completed = [e for e in events if e.type == "effect.completed" and e.correlation_id == recorded]
    assert [e.payload["status"] for e in completed] == ["ok"]


@pytest.mark.parametrize("trigger", ["ownership.remapped", "tree.adopted"])
async def test_a_kill_during_a_takeover_neither_repeats_nor_loses_it(
    box: Sandbox, trigger: str
) -> None:
    child = box.run("--chaos", "kill-half")
    wait_for(box, child, log_has(box, trigger), f"the first {trigger}")
    box.kill(child)
    crash = snapshot(box)
    assert any(e.type == trigger for e in crash.events)
    assert crash.events[-1].type != "run.completed"

    box.finish(box.resume())
    events = await check_resumed(box, crash)
    killed = [
        e.payload["target"]
        for e in events
        if e.type == "chaos.injected" and e.payload["fault"] == "kill_coordinator"
    ]
    assert killed == ["o0", "o2.1", "o1", "o3.2", "o2"]  # five brains, each killed once
    remaps = [
        (e.payload["key"], e.payload["previous"]) for e in events if e.type == "ownership.remapped"
    ]
    assert len(remaps) == len(set(remaps))  # every goal moved once per death
    root = [
        e.payload["owner"]
        for e in events
        if e.type == "ownership.remapped" and e.payload["key"] == "root"
    ]
    assert root and all(owner in ("o1", "o2", "o3") for owner in root)
    assert any(
        e.type == "tree.adopted" and "final integration" in e.payload["duties"] for e in events
    )


async def test_the_live_clock_does_not_count_the_time_the_process_was_dead(box: Sandbox) -> None:
    speed = "10"  # 6 s of wall time are 60 s of virtual time: a whole T2 run is 70 s
    child = box.run("--clock", "live", "--speed", speed, hold_at="30")
    wait_for(box, child, signalled(box), "a request to be held")
    held = signalled_effect(box)
    box.kill(child)
    crash = snapshot(box)
    assert held in crash.c

    time.sleep(6)
    box.finish(box.resume("--speed", speed))
    events = await check_resumed(box, crash)
    assert box.served()[held] == 2
    # Virtual time went on from the last event: the detectors never saw the gap, so nobody
    # was declared dead. Had the downtime counted, every peer would have been silent for 60 s
    # (a few false suspicions under load are possible, deaths need five missed heartbeats).
    assert not [e for e in events if e.type == "member.dead"]
    assert events[-1].ts_virtual < 105_000  # a counted downtime would give 130 000 and more


async def test_a_second_crash_during_the_resume_is_resumed_in_turn(box: Sandbox) -> None:
    child = box.run()
    wait_for(box, child, log_reaches(box, 2500), "the log to reach 2500 events")
    box.kill(child)
    first = snapshot(box, "first")

    second_child = box.resume(hold_at="3")  # the resumed process dies holding its 3rd request
    wait_for(box, second_child, signalled(box), "the resumed process to hold a request")
    held = signalled_effect(box)
    box.signal.unlink()
    box.kill(second_child)
    second = snapshot(box, "second")
    assert held in second.c
    assert [e.payload["attempt"] for e in second.events if e.type == "run.resumed"] == [1]

    box.finish(box.resume())
    events = await check_resumed(box, second, attempt=2)
    assert [e.payload["attempt"] for e in events if e.type == "run.resumed"] == [1, 2]
    served = box.served()
    assert served[held] == 2
    # What was safe after the first crash was not sent in either resume.
    for effect_id in first.a | first.b:
        assert served[effect_id] == first.served[effect_id], effect_id


def test_a_run_that_is_still_alive_is_not_resumed(box: Sandbox) -> None:
    child = box.run(hold_at="20")
    wait_for(box, child, signalled(box), "a request to be held")
    served, events = box.served(), len(snapshot(box).events)

    text = box.finish(box.resume(), expect=2)  # exit status 2: cannot be resumed
    assert "another process has events.sqlite open" in text
    assert box.served() == served
    assert len(snapshot(box).events) == events

    box.kill(child)  # once it is dead the same command goes ahead
    box.finish(box.resume())


def ledger_rows(path: Path) -> dict[str, tuple]:
    conn = sqlite3.connect(path)
    try:
        query = "SELECT reservation_id, status, reserved_usd, actual_usd FROM entries"
        return {row[0]: row[1:] for row in conn.execute(query)}
    finally:
        conn.close()


async def test_the_lost_call_stays_reserved_in_the_project_ledger(box: Sandbox) -> None:
    ledger = box.root / "ledger.sqlite"
    child = box.run(hold_at="20", ledger=str(ledger))
    wait_for(box, child, signalled(box), "a request to be held")
    held = signalled_effect(box)
    box.kill(child)
    crash = snapshot(box)
    assert held in crash.c

    # The reservation was committed before the request left and never settled: the bill that
    # may exist stays committed against the project cap.
    before = ledger_rows(ledger)
    stale = {key for key, row in before.items() if row[0] == "reserved"}
    assert stale == {f"{RUN_ID}/{effect_id}" for effect_id in crash.c}

    box.finish(box.resume(ledger=str(ledger)))
    events = await check_resumed(box, crash)
    after = ledger_rows(ledger)
    # The lost call keeps its reservation; the second send has its own, and settles.
    assert {key for key, row in after.items() if row[0] == "reserved"} == stale
    for effect_id in crash.c | crash.d:
        assert after[f"{RUN_ID}/{effect_id}#r1"][0] == "settled"
    completed = [e for e in events if e.type == "effect.completed" and e.correlation_id == held]
    assert [e.payload["status"] for e in completed] == ["ok"]  # sent again, not an error
    # The log and the ledger agree on what the lost calls may have cost.
    reserved = {
        e.payload["effect_id"]: e.payload["usd"] for e in events if e.type == "budget.reserved"
    }
    assert sum(after[key][1] for key in stale) == pytest.approx(
        sum(reserved[effect_id] for effect_id in crash.c)
    )


async def test_a_kill_that_tears_a_reaction_before_its_effect_started_is_completed(
    box: Sandbox,
) -> None:
    # The 25th reservation is appended; the process stops before the effect.started that
    # follows it in the same reaction. Its effect was never launched.
    child = box.run(freeze_after_event="budget.reserved:25")
    wait_for(box, child, signalled(box), "the 25th reservation to be appended")
    box.kill(child)
    crash = snapshot(box)
    assert crash.events[-1].type == "budget.reserved"
    unlaunched = crash.events[-1].payload["effect_id"]
    assert unlaunched not in crash.started  # the log has its reservation, not its start
    assert unlaunched not in crash.cassette and crash.served[unlaunched] == 0

    box.finish(box.resume())
    events = await check_resumed(box, crash)
    marker = next(e.payload for e in events if e.type == "run.resumed")
    assert marker["completed_tail"] >= 1  # the reaction was finished, not cut
    started = [
        e for e in events if e.type == "effect.started" and e.payload["effect_id"] == unlaunched
    ]
    assert [e.seq for e in started] == [crash.events[-1].seq + 1]  # right after the reservation
    assert unlaunched not in marker["ambiguous"]  # it was never sent: not ambiguous
    assert box.served()[unlaunched] == 1  # and it was sent exactly once


async def test_a_kill_between_a_completion_and_its_settlement_finishes_the_pair(
    box: Sandbox,
) -> None:
    # The 20th LLM completion is appended; the process stops before the budget.settled that
    # Runtime.complete appends right after it.
    child = box.run(freeze_after_event="effect.completed:20:llm")
    wait_for(box, child, signalled(box), "the 20th LLM completion to be appended")
    box.kill(child)
    crash = snapshot(box)
    assert crash.events[-1].type == "effect.completed"
    done = crash.events[-1].payload["effect_id"]
    assert done in crash.a  # completed: never to be sent again
    assert not [
        e for e in crash.events if e.type == "budget.settled" and e.payload["effect_id"] == done
    ]

    box.finish(box.resume())
    events = await check_resumed(box, crash)
    marker = next(e.payload for e in events if e.type == "run.resumed")
    assert marker["completed_tail"] >= 1
    settled = [e for e in events if e.type == "budget.settled" and e.payload["effect_id"] == done]
    assert [e.causation_id for e in settled] == [crash.events[-1].seq]  # settled once, after it
    assert box.served()[done] == crash.served[done]


def test_the_real_backend_needs_the_spend_flag_and_a_key(box: Sandbox) -> None:
    # The sandbox home has no .env, so there is no key and nothing could be billed anyway.
    text = box.finish(box.spawn("resume", RUN_ID, "--backend", "real"), expect=2)
    assert "add --confirm-real-spend" in text
    flagged = box.spawn("resume", RUN_ID, "--backend", "real", "--confirm-real-spend")
    assert "MODEL_API_KEY is not set" in box.finish(flagged, expect=2)
    assert not box.counter.exists()  # nothing was sent


def test_resume_says_so_when_there_is_no_such_run(box: Sandbox) -> None:
    text = box.finish(box.resume(), expect=2)
    assert "no run directory" in text
