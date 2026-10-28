"""Resuming from every crash state of a log (docs/resume.md), in process.

An event store commits one event at a time, so any prefix of a finished run's log is a log that
a killed process could have left. These tests cut a finished run at chosen sequence numbers,
trim its cassette to the effects that had started, and resume it. The cassette of a crash is
one of: every open effect has its reply (all of them are (b)), none has ("all of them are (c)
or (d)"), or a mix. The real process kills are in test_resume_kill.py.

After every resume: the log is one valid hash chain, ``replay --verify`` matches from the first
event, the run finished with the same result, and the fake LLM received each request exactly
once, and none for an effect that was completed or answered in the cassette.
"""

import asyncio
import json
import random
import shutil
import sqlite3
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import pytest

from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.clock import LiveClock
from fractalswarm.kernel.events import Event, EventDraft, validate_payload
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.market.ledger import ProjectLedger
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.resume import (
    AlreadyCompleted,
    ReissueLedger,
    ResumeRefused,
    ResumeResult,
    _timer_effect,
    repair_cassette,
    resume_run,
)
from fractalswarm.runs import RunPaths, record_run, replay_run
from fractalswarm.verify.audit import audit_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
KILLS = [(0.20, "o0"), (0.35, "o2.1"), (0.50, "o1"), (0.65, "o3.2"), (0.80, "o2")]


class Counting:
    """A backend that counts the requests it receives, by effect."""

    def __init__(self, inner) -> None:
        self.inner = inner
        self.served: Counter[str] = Counter()

    async def send(self, effect_id, body, sleep):
        self.served[effect_id] += 1
        return await self.inner.send(effect_id, body, sleep)


def read_events(run_dir: Path) -> list[Event]:
    with RunPaths(run_dir).open_log() as log:
        return list(log.read())


def crashed_copy(
    source: Path, dest: Path, cut: int, keep_reply: Callable[[str], bool] = lambda _: True
) -> tuple[set[str], set[str]]:
    """Copy a finished run as if its process had died after event ``cut``.

    Returns the open LLM effects, and those whose reply is in the cassette. ``keep_reply``
    decides it for each open one; effects that completed always keep theirs.
    """
    shutil.copytree(source, dest)
    paths = RunPaths(dest)
    paths.events_jsonl.unlink()
    db = sqlite3.connect(paths.events, isolation_level=None)
    db.execute("DELETE FROM events WHERE seq > ?", (cut,))
    db.close()
    prefix = read_events(dest)
    started = {e.payload["effect_id"]: e for e in prefix if e.type == "effect.started"}
    closed = {
        e.payload["effect_id"] for e in prefix if e.type in ("effect.completed", "effect.cancelled")
    }
    open_llm = {i for i, e in started.items() if i not in closed and e.payload["kind"] == "llm"}
    kept_open = {i for i in open_llm if keep_reply(i)}
    lines = []
    for line in paths.cassette.read_text(encoding="utf-8").splitlines():
        effect_id = json.loads(line)["effect_id"]
        # A call that had not started yet has no entry; an open one has it only if kept.
        if effect_id in started and (effect_id not in open_llm or effect_id in kept_open):
            lines.append(line)
    paths.cassette.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    return open_llm, kept_open


async def resume_and_check(
    dest: Path,
    cut: int,
    open_llm: set[str],
    kept_open: set[str],
    result_of: Callable[[list[Event]], object],
    expected_result: object,
) -> tuple[ResumeResult, Counting]:
    backend = Counting(fake_backend())
    resumed = await resume_run(dest, backend=backend)
    events = read_events(dest)
    with EventStore(RunPaths(dest).events) as log:
        assert log.verify_chain().ok
    assert events[-1].type == "run.completed"
    plan = resumed.resumed
    assert set(plan.ambiguous) == {i for i in open_llm if i not in kept_open}, f"cut {cut}"
    assert set(plan.from_cassette) == kept_open, f"cut {cut}"
    # The requests the resume sent: the ambiguous effects, and the effects that started after
    # the crash (the completed tail included), each once; nothing for the other open ones.
    new = {e.payload["effect_id"] for e in events if e.type == "effect.started" and e.seq > cut}
    sent = {i for i in new if _kind(events, i) == "llm"} | set(plan.ambiguous)
    assert backend.served == Counter(dict.fromkeys(sent, 1)), f"cut {cut}"
    assert result_of(events) == expected_result, f"cut {cut}"
    report = await replay_run(dest)
    assert report.ok, f"cut {cut}: {report.detail}"
    return resumed, backend


def _kind(events: list[Event], effect_id: str) -> str:
    return next(
        e.payload["kind"]
        for e in events
        if e.type == "effect.started" and e.payload["effect_id"] == effect_id
    )


# -- the toy run: every prefix --------------------------------------------------------------


@pytest.fixture(scope="module")
def toy(tmp_path_factory: pytest.TempPathFactory) -> Path:
    run_dir = tmp_path_factory.mktemp("toy") / "toy"
    asyncio.run(
        record_run(
            "toy", run_id="toy", run_dir=run_dir, backend=FakeBackend(), params={"rounds": 3}
        )
    )
    return run_dir


def toy_result(events: list[Event]) -> object:
    done = next(e.payload for e in events if e.type == "toy.done")
    return done["rounds"], done["summary"], done["results"]


@pytest.mark.parametrize("variant", ["every reply kept", "no reply kept", "every other reply kept"])
async def test_every_prefix_of_a_toy_run_resumes_and_replays(
    toy: Path, tmp_path: Path, variant: str
) -> None:
    events = read_events(toy)
    expected = toy_result(events)
    keep = {
        "every reply kept": lambda _: True,
        "no reply kept": lambda _: False,
        "every other reply kept": lambda effect_id: int(effect_id.split("-")[1].split(".")[0]) % 2,
    }[variant]
    tails = 0
    for cut in range(1, len(events)):  # a log that ends in run.completed is not a crash
        dest = tmp_path / f"cut-{cut}"
        open_llm, kept_open = crashed_copy(toy, dest, cut, keep)
        resumed, _ = await resume_and_check(dest, cut, open_llm, kept_open, toy_result, expected)
        tails += resumed.resumed.completed_tail > 0
    assert tails  # some of these cuts left a reaction half written


# -- T2 with five coordinators killed: the cuts that matter ----------------------------------


@pytest.fixture(scope="module")
def t2(tmp_path_factory: pytest.TempPathFactory) -> Path:
    run_dir = tmp_path_factory.mktemp("t2") / "t2"
    spec = TaskSpec.load(TASKSPEC)
    actions = tuple(ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in KILLS)
    chaos = ChaosPlan(profile="kill-half", seed=spec.seed, actions=actions).model_dump(mode="json")
    asyncio.run(
        record_run(
            "swarm",
            run_id="t2",
            run_dir=run_dir,
            backend=fake_backend(),
            seed=spec.seed,
            params=run_params(spec) | {"chaos": chaos, "membership": True},
            run_cap_usd=spec.budget_usd,
        )
    )
    return run_dir


def t2_result(events: list[Event]) -> object:
    report = next(e.payload["report"] for e in events if e.type == "task.result")
    return report["placed"], report["expected"], report["hard_violations"]


def cuts_that_tear(events: list[Event]) -> dict[str, int]:
    """Cuts that leave a reaction half written, by what the missing part holds."""
    found: dict[str, int] = {}
    for before, after in zip(events, events[1:], strict=False):
        same_reaction = after.causation_id is not None and after.causation_id == before.causation_id
        if after.type == "effect.started" and same_reaction:
            found.setdefault(f"effect.started {after.payload['kind']} in the tail", before.seq)
        if after.type == "budget.settled" and before.type == "effect.completed":
            found.setdefault("budget.settled after its completion", before.seq)
        if after.type == "tree.adopted" and same_reaction:
            found.setdefault("tree.adopted in the tail", before.seq)
    return found


async def test_t2_resumes_from_the_cuts_that_tear_a_reaction(t2: Path, tmp_path: Path) -> None:
    events = read_events(t2)
    expected = (48, 48, 0)
    assert t2_result(events) == expected
    cuts = cuts_that_tear(events)
    assert {"effect.started llm in the tail", "budget.settled after its completion"} <= set(cuts)
    cuts |= {"boot": 1, "the last event before run.completed": len(events) - 1}
    for name, cut in cuts.items():
        dest = tmp_path / f"cut-{cut}"
        open_llm, kept_open = crashed_copy(t2, dest, cut, lambda _: False)
        resumed, backend = await resume_and_check(
            dest, cut, open_llm, kept_open, t2_result, expected
        )
        if "in the tail" in name or "after its completion" in name:
            assert resumed.resumed.completed_tail > 0, name
        if name == "effect.started llm in the tail":
            # Died before launching it: it is not ambiguous, and it was sent once.
            tail_started = [
                e for e in read_events(dest) if e.type == "effect.started" and e.seq > cut
            ]
            assert tail_started
            assert not set(resumed.resumed.ambiguous) & {
                e.payload["effect_id"] for e in tail_started
            }


async def test_t2_resumes_from_random_cuts_with_any_mix_of_replies(
    t2: Path, tmp_path: Path
) -> None:
    events = read_events(t2)
    rng = random.Random("resume-cuts")
    for _ in range(4):
        cut = rng.randrange(2, len(events) - 1)
        chance = rng.choice([0.0, 0.5, 1.0])  # how likely an open effect's reply was recorded
        dest = tmp_path / f"cut-{cut}"
        keep = random.Random(f"{cut}:{chance}")
        open_llm, kept_open = crashed_copy(
            t2, dest, cut, lambda _, keep=keep, chance=chance: keep.random() < chance
        )
        await resume_and_check(dest, cut, open_llm, kept_open, t2_result, (48, 48, 0))


# -- what resume refuses ---------------------------------------------------------------------


def toy_cut(toy: Path, tmp_path: Path, cut: int = 30) -> Path:
    dest = tmp_path / "crashed"
    crashed_copy(toy, dest, cut)
    return dest


async def test_a_completed_run_is_not_resumed(toy: Path, tmp_path: Path) -> None:
    dest = tmp_path / "done"
    shutil.copytree(toy, dest)
    with pytest.raises(AlreadyCompleted):
        await resume_run(dest, backend=FakeBackend())


async def test_a_log_with_a_broken_chain_is_not_resumed(toy: Path, tmp_path: Path) -> None:
    dest = toy_cut(toy, tmp_path)
    db = sqlite3.connect(RunPaths(dest).events, isolation_level=None)
    db.execute("UPDATE events SET payload = REPLACE(payload, 'worker', 'w0rker') WHERE seq = 9")
    db.close()
    with pytest.raises(ResumeRefused, match="corrupt at seq 9"):
        await resume_run(dest, backend=FakeBackend())


async def test_a_resealed_forgery_diverges_and_is_not_resumed(toy: Path, tmp_path: Path) -> None:
    """Rewrite a completion and re-hash the chain: valid chain, not a run this code produced."""
    dest = toy_cut(toy, tmp_path)
    events = read_events(dest)
    target = next(
        e.seq for e in events if e.type == "effect.completed" and e.payload["kind"] == "llm"
    )
    paths = RunPaths(dest)
    paths.events.unlink()
    forged = EventStore(paths.events)
    for event in events:
        payload = event.payload
        if event.seq == target:
            payload = payload | {"result": payload["result"] | {"output_text": "forged answer"}}
        forged.append(
            EventDraft(
                **event.model_dump(exclude={"seq", "prev_hash", "hash"}) | {"payload": payload}
            )
        )
    forged.close()
    with pytest.raises(ResumeRefused, match=f"first divergence at seq {target}"):
        await resume_run(dest, backend=FakeBackend())


async def test_a_cassette_without_a_completed_reply_is_not_resumed(
    toy: Path, tmp_path: Path
) -> None:
    dest = toy_cut(toy, tmp_path)
    paths = RunPaths(dest)
    lines = paths.cassette.read_text(encoding="utf-8").splitlines()
    paths.cassette.write_text("\n".join(lines[1:]) + "\n", encoding="utf-8", newline="\n")
    with pytest.raises(ResumeRefused, match="does not replay"):
        await resume_run(dest, backend=FakeBackend())


async def test_an_empty_log_and_a_bundle_are_not_resumed(toy: Path, tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    EventStore(RunPaths(empty).events).close()
    with pytest.raises(ResumeRefused, match="empty"):
        await resume_run(empty, backend=FakeBackend())
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    shutil.copy(toy / "events.jsonl", bundle / "events.jsonl")
    with pytest.raises(ResumeRefused, match="only a live log"):
        await resume_run(bundle, backend=FakeBackend())


async def test_a_log_that_another_connection_holds_open_is_not_resumed(
    toy: Path, tmp_path: Path
) -> None:
    dest = toy_cut(toy, tmp_path)
    with EventStore(RunPaths(dest).events) as alive:
        assert alive.last_seq == 30
        with pytest.raises(ResumeRefused, match="another process has events.sqlite open"):
            await resume_run(dest, backend=FakeBackend())
    await resume_run(dest, backend=FakeBackend())  # let go, and it goes ahead


# -- the pieces ------------------------------------------------------------------------------


async def test_a_torn_cassette_line_is_cut_off_and_that_call_is_sent_again(
    t2: Path, tmp_path: Path
) -> None:
    events = read_events(t2)
    cut = next(e.seq for e in events if e.seq > 2500 and e.type == "effect.started")
    dest = tmp_path / "torn"
    open_llm, kept_open = crashed_copy(t2, dest, cut)
    victim = sorted(kept_open)[0]
    paths = RunPaths(dest)
    lines = paths.cassette.read_text(encoding="utf-8").splitlines()
    entry = next(line for line in lines if json.loads(line)["effect_id"] == victim)
    torn = entry[: len(entry) // 2]  # the kill landed in the middle of the write
    lines = [line for line in lines if line != entry]
    paths.cassette.write_text("\n".join([*lines, torn]), encoding="utf-8", newline="\n")

    backend = Counting(fake_backend())
    resumed = await resume_run(dest, backend=backend)
    assert resumed.resumed.cassette_dropped_bytes == len(torn.encode("utf-8"))
    assert victim in resumed.resumed.ambiguous  # no reply on record: sent again
    assert backend.served[victim] == 1
    assert (await replay_run(dest)).ok
    assert all(json.loads(line) for line in paths.cassette.read_text(encoding="utf-8").splitlines())


def test_repair_cassette_cuts_a_half_written_last_line(tmp_path: Path) -> None:
    path = tmp_path / "cassette.jsonl"
    assert repair_cassette(path) == 0  # no file
    path.write_bytes(b'{"a":1}\n{"b":2}\n')
    assert repair_cassette(path) == 0  # clean
    path.write_bytes(b'{"a":1}\n{"b":2}\n{"c":')
    assert repair_cassette(path) == 5
    assert path.read_bytes() == b'{"a":1}\n{"b":2}\n'
    path.write_bytes(b'{"half')
    assert repair_cassette(path) == 6
    assert path.read_bytes() == b""


def test_a_second_reservation_under_the_same_id_is_refused_so_a_resend_needs_its_own(
    tmp_path: Path,
) -> None:
    ledger = ProjectLedger(tmp_path / "ledger.sqlite", 10.0)
    assert ledger.reserve("r/eff-1.0", "r", "m", 1.0) is None
    with pytest.raises(sqlite3.IntegrityError):  # re-using the id would fail the re-send
        ledger.reserve("r/eff-1.0", "r", "m", 1.0)

    reissue = ReissueLedger(ledger, {"r/eff-1.0"}, "#r1")
    assert reissue.reserve("r/eff-1.0", "r", "m", 1.0) is None  # goes in as r/eff-1.0#r1
    assert reissue.reserve("r/eff-2.0", "r", "m", 2.0) is None  # not re-sent: its own id
    reissue.settle("r/eff-1.0", 0.25)
    summary = ledger.summary()
    assert summary.spent_usd == pytest.approx(0.25)
    assert summary.reserved_usd == pytest.approx(3.0)  # the lost call and eff-2.0 stay committed


def test_the_live_clock_can_start_where_the_run_left_off() -> None:
    clock = LiveClock(speed=1.0, start_ms=70_000)
    assert 70_000 <= clock.now() < 71_000
    assert LiveClock().now() < 1_000  # unchanged for a new run


def test_the_resume_events_have_a_fixed_shape() -> None:
    payload = {"attempt": 1, "log_events": 10, "ambiguous": ["eff-3.0"], "rerun": {"timer": 2}}
    assert validate_payload("run.resumed", payload)["completed_tail"] == 0
    with pytest.raises(ValueError):
        validate_payload("run.resumed", payload | {"surprise": 1})
    reissued = {"effect_id": "eff-3.0", "kind": "llm", "ambiguous": True}
    assert validate_payload("effect.reissued", reissued)["reserved_usd"] == 0.0


# -- the kill switch and the budget shock survive a crash -------------------------------------


def control_on_round_2(run_dir: Path, request: dict):
    sent = []

    def script(body, attempt):
        if "item 2" in str(body["input"]) and not sent:
            sent.append(RunPaths(run_dir).request_control(request))
        return "ok"

    return script


async def record_with_control(root: Path, name: str, request: dict) -> Path:
    run_dir = root / name
    await record_run(
        "toy",
        run_id=name,
        run_dir=run_dir,
        backend=FakeBackend(script=control_on_round_2(run_dir, request)),
        params={"rounds": 3},
    )
    return run_dir


async def test_a_halt_that_a_crash_cut_short_is_finished_and_nothing_runs_after_it(
    tmp_path: Path,
) -> None:
    halted = await record_with_control(tmp_path, "halted", {"op": "halt", "reason": "stop"})
    events = read_events(halted)
    halt = next(e.seq for e in events if e.type == "run.halted")
    assert halt < len(events) - 1
    for cut in range(halt, len(events)):  # from the halt itself to the last event before the end
        dest = tmp_path / f"cut-{cut}"
        crashed_copy(halted, dest, cut)
        resumed = await resume_run(dest, backend=FakeBackend())
        after = [e.type for e in read_events(dest) if e.seq > halt]
        allowed = {"effect.cancelled", "budget.settled", "actor.stopped", "run.resumed"}
        assert set(after) <= allowed | {"run.completed"}, f"cut {cut}"
        assert after[-1] == "run.completed" and resumed.run.completed.payload["alive"] == []
        audit = await audit_run(dest, with_replay=True)
        assert audit.ok and audit.replay_ok, f"cut {cut}: {audit.problems}"
        # The halt was finished, not repeated: one reservation released per open effect.
        assert [e.type for e in read_events(dest)].count("run.halted") == 1


async def test_every_prefix_after_a_budget_shock_resumes_with_the_new_cap(tmp_path: Path) -> None:
    shock = {"op": "budget", "level": "run", "key": None, "usd": 0.0, "reason": "CFO says stop"}
    shocked = await record_with_control(tmp_path, "shocked", shock)
    events = read_events(shocked)
    at = next(e.seq for e in events if e.type == "budget.shock")
    expected = [e.type for e in events if e.type == "budget.refused"]
    assert expected
    for cut in range(at, len(events)):
        dest = tmp_path / f"cut-{cut}"
        crashed_copy(shocked, dest, cut)
        await resume_run(dest, backend=FakeBackend())
        resumed = read_events(dest)
        assert [e.type for e in resumed if e.type == "budget.shock"] == ["budget.shock"]
        # Nothing was reserved after the shock; what it refused stays refused.
        assert "budget.reserved" not in [e.type for e in resumed if e.seq > at]
        assert (await replay_run(dest)).ok, f"cut {cut}"


async def test_a_timer_open_at_the_crash_waits_only_what_it_had_left() -> None:
    class Waits:  # stands in for the effect context: records the waits instead of making them
        run_id = "r"

        def __init__(self) -> None:
            self.waited: list[int] = []

        async def sleep(self, virtual_ms: int) -> None:
            self.waited.append(virtual_ms)

    def timer(effect_id: str, ts_virtual: int) -> Event:
        payload = {"effect_id": effect_id, "kind": "timer", "request": {"delay_ms": 2000}}
        return Event(
            run_id="r", ts_virtual=ts_virtual, lamport=1, type="effect.started", actor="a",
            idem_key=effect_id, payload=payload | {"tag": None}, seq=5, prev_hash="p", hash="h",
        )  # fmt: skip

    handler = _timer_effect(frozenset({"eff-1.0", "eff-2.0"}), vtime=10_000)
    waits = Waits()
    outcomes = [
        await handler(timer("eff-1.0", 9_000), waits),  # open: 1 s of its 2 s is left
        await handler(timer("eff-2.0", 1_000), waits),  # open and already due
        await handler(timer("eff-3.0", 9_000), waits),  # started after the resume: all of it
    ]
    assert waits.waited == [1_000, 0, 2_000]
    assert [outcome.latency_ms for outcome in outcomes] == [2_000, 2_000, 2_000]
