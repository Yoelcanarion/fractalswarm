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
        try:
            cassette.add(json.loads(line)["effect_id"])
        except ValueError:  # a torn last line: that call has no reply on record
            pass
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
    reserved = {e.payload["effect_id"]: e.payload["usd"] for e in events if e.type == "budget.reserved"}
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
