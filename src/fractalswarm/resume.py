"""Process-crash recovery: continue a killed run from its own log and cassette (spec §8).

What happens to each effect that is open when the process dies is decided in docs/resume.md:
completed effects are never run again, replies already in the cassette are served from it, and
an effect that was sent with no reply on record is sent again, named in the log and counted as
possible extra cost.

The mechanism is replay. The log is replayed into a scratch store, and every regenerated event
must hash like the recorded one. If the kill cut a reaction in half, the events it still owed
come out of that replay and are appended to the real log. Then the normal drivers take over.
"""

import sqlite3
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from fractalswarm.comms.chaos import plan_from
from fractalswarm.kernel.clock import Clock, LiveClock, ManualClock
from fractalswarm.kernel.effects import EffectContext, EffectFn, EffectOutcome, EffectRunner, drive
from fractalswarm.kernel.events import Event, EventDraft, RunResumed
from fractalswarm.kernel.replay import replay_runtime
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.cassette import Cassette, CassetteBackend
from fractalswarm.llm.client import Backend, LLMClient
from fractalswarm.llm.transport import ApiFaults, FaultyBackend
from fractalswarm.market.ledger import ProjectLedger, Refusal
from fractalswarm.runs import LiveMarker, RunPaths, RunResult, replay_setup
from fractalswarm.safety.firewall import Firewall

# Effects with no outside world: running them again costs nothing and changes nothing.
LOCAL_KINDS = frozenset({"timer", "firewall"})


class ResumeRefused(Exception):
    """The run cannot be resumed; the message says why."""


class AlreadyCompleted(ResumeRefused):
    """``run.completed`` is already in the log: there is nothing to resume."""


@dataclass(frozen=True)
class ResumeResult:
    run: RunResult
    resumed: RunResumed


class ReissueLedger:
    """The project ledger, with each re-sent effect under a fresh reservation id.

    The first send of an ambiguous effect reserved ``run/effect`` before it left, and the
    reservation is still open: it stays open, so the possible bill stays committed. The
    second send must not reuse the id (``reservation_id`` is UNIQUE).
    """

    def __init__(self, inner: ProjectLedger, reissued: set[str], suffix: str) -> None:
        self.inner = inner
        self.reissued = reissued
        self.suffix = suffix

    def _id(self, reservation_id: str) -> str:
        return reservation_id + self.suffix if reservation_id in self.reissued else reservation_id

    def reserve(
        self, reservation_id: str, run_id: str, model: str, usd: float, at: str | None = None
    ) -> Refusal | None:
        return self.inner.reserve(self._id(reservation_id), run_id, model, usd, at)

    def settle(self, reservation_id: str, actual_usd: float, at: str | None = None) -> None:
        self.inner.settle(self._id(reservation_id), actual_usd, at)

    def remaining_usd(self) -> float:
        return self.inner.remaining_usd()


def ensure_log_unused(path: Path) -> None:
    """Refuse to resume a run whose log another process has open: that process is alive.

    A connection in exclusive locking mode can only read the log when no other process has it
    open. The operating system lets go of the lock when a process dies, so a killed run passes.
    """
    probe = sqlite3.connect(path, timeout=0, isolation_level=None)
    try:
        probe.execute("PRAGMA locking_mode=EXCLUSIVE")
        probe.execute("SELECT count(*) FROM events").fetchone()
    except sqlite3.OperationalError as exc:
        raise ResumeRefused(
            f"another process has {path.name} open: the run is still alive, or another resume is"
        ) from exc
    finally:
        probe.close()


def repair_cassette(path: Path) -> int:
    """Cut a half-written last line (a kill during the write) off the cassette.

    The call it belonged to has no reply on record. Returns the number of bytes removed.
    """
    if not path.exists():
        return 0
    data = path.read_bytes()
    if not data or data.endswith(b"\n"):
        return 0
    keep = data.rfind(b"\n") + 1
    with path.open("r+b") as out:
        out.truncate(keep)
    return len(data) - keep


async def _no_sleep(virtual_ms: int) -> None:
    return None


def _resume_clock(mode: str, vtime: int, speed: float) -> Clock:
    """Virtual time goes on from the last event; the time the process was dead does not count."""
    return ManualClock("sim", start=vtime) if mode == "sim" else LiveClock(speed, start_ms=vtime)


def _timer_effect(open_ids: frozenset[str], vtime: int) -> EffectFn:
    """A timer that was open at the crash waits only what it had left."""

    async def run(started: Event, ctx: EffectContext) -> EffectOutcome:
        delay = int(started.payload["request"]["delay_ms"])
        left = started.ts_virtual + delay - vtime
        await ctx.sleep(max(left, 0) if started.payload["effect_id"] in open_ids else delay)
        return EffectOutcome(status="ok", latency_ms=delay)

    return run


def _llm_effect(client: LLMClient, from_cassette: dict[str, EffectOutcome]) -> EffectFn:
    """Replies already in the cassette are served from it; every other call is sent."""

    async def run(started: Event, ctx: EffectContext) -> EffectOutcome:
        effect_id = started.payload["effect_id"]
        if effect_id in from_cassette:
            return from_cassette[effect_id]
        return await client.call(
            effect_id, started.payload["request"], run_id=ctx.run_id, sleep=ctx.sleep
        )

    return run


async def resume_run(
    run_dir: Path,
    *,
    backend: Backend,
    speed: float = 1.0,
    project_ledger: ProjectLedger | None = None,
    secrets: list[str] | None = None,
    firewall: Firewall | None = None,
    announce: Callable[[RunResumed], None] | None = None,
) -> ResumeResult:
    """Continue the run in ``run_dir``. ``announce`` gets the plan before anything is sent."""
    paths = RunPaths(run_dir)
    if not paths.events.exists():
        raise ResumeRefused(f"{run_dir} has no events.sqlite: only a live log can be resumed")
    ensure_log_unused(paths.events)

    with EventStore(paths.events) as log:
        chain = log.verify_chain()
        if not chain.ok:
            raise ResumeRefused(f"the log is corrupt at seq {chain.first_bad_seq}: {chain.reason}")
        if chain.events == 0:
            raise ResumeRefused("the log is empty: the process died before run.started; run again")
        last = log.get(log.last_seq)
        if last is not None and last.type == "run.completed":
            raise AlreadyCompleted(f"run {last.run_id} is already completed")

        dropped = repair_cassette(paths.cassette)
        try:
            cassette = Cassette(paths.cassette, secrets or [])
        except ValueError as exc:  # a corrupt line before the last one is not a torn write
            raise ResumeRefused(f"the cassette is corrupt: {exc}") from exc

        scratch = EventStore()
        runtime, report = await replay_runtime(log, replay_setup(cassette), scratch, resuming=True)
        if runtime is None or not report.ok:
            raise ResumeRefused(
                f"the log does not replay: first divergence at seq {report.first_divergence}\n"
                f"{report.detail}"
            )
        # Events past the old tail finish the reaction the kill cut; the log stays append-only.
        completed_tail = scratch.last_seq - log.last_seq
        for event in scratch.read(log.last_seq + 1):
            appended = log.append(
                EventDraft(**event.model_dump(exclude={"seq", "prev_hash", "hash"}))
            )
            if appended.hash != event.hash:
                raise ResumeRefused(f"the replayed tail differs from the log at seq {event.seq}")
        scratch.close()
        runtime.store = log

        # What the dead process would have delivered next. The effects that deliveries start now
        # are new. So are those the completed tail started: it died before launching them.
        open_before = set(runtime.inflight)
        while runtime.step():
            pass
        open_effects = sorted(
            (
                started
                for effect_id, started in runtime.inflight.items()
                if effect_id in open_before and started.seq <= chain.events
            ),
            key=lambda started: started.seq,
        )

        started_event = runtime.started_event
        assert started_event is not None
        roles, prices = LLMClient.config_from_snapshot(started_event.payload["config"]["llm"])
        from_cassette_client = LLMClient(
            CassetteBackend(cassette), roles=roles, prices=prices, mode="replay", cassette=cassette
        )
        from_cassette: dict[str, EffectOutcome] = {}
        ambiguous: list[str] = []
        rerun: Counter[str] = Counter()
        for started in open_effects:
            effect_id, kind = started.payload["effect_id"], started.payload["kind"]
            if kind in LOCAL_KINDS:
                rerun[kind] += 1
            elif kind == "llm" and effect_id in cassette.entries:
                try:
                    from_cassette[effect_id] = await from_cassette_client.call(
                        effect_id,
                        started.payload["request"],
                        run_id=runtime.run_id,
                        sleep=_no_sleep,
                    )
                except Exception as exc:  # the recorded reply does not fit this request
                    raise ResumeRefused(f"{effect_id}: {type(exc).__name__}: {exc}") from exc
            else:
                ambiguous.append(effect_id)

        attempt = (
            1
            + log.db.execute("SELECT COUNT(*) FROM events WHERE type = 'run.resumed'").fetchone()[0]
        )
        possible_extra = round(
            sum(
                runtime.ledger.open[effect_id].usd
                for effect_id in ambiguous
                if effect_id in runtime.ledger.open
            ),
            6,
        )
        plan = RunResumed(
            attempt=attempt,
            log_events=chain.events,
            completed_tail=completed_tail,
            from_cassette=list(from_cassette),
            ambiguous=ambiguous,
            rerun=dict(sorted(rerun.items())),
            possible_extra_usd=possible_extra,
            cassette_dropped_bytes=dropped,
        )
        if announce is not None:
            announce(plan)

        rate = plan_from(runtime.params).api_fault_rate
        if rate:
            backend = FaultyBackend(backend, ApiFaults(seed=runtime.seed, rate=rate))
        reissued = {f"{runtime.run_id}/{effect_id}" for effect_id in ambiguous}
        ledger = ReissueLedger(project_ledger, reissued, f"#r{attempt}") if project_ledger else None
        client = LLMClient(
            backend,
            roles=roles,
            prices=prices,
            mode="record",
            cassette=cassette,
            project_ledger=ledger,  # type: ignore[arg-type]
        )

        runtime.resume(plan.model_dump(mode="json"), runtime.vtime)
        open_ids = frozenset(started.payload["effect_id"] for started in open_effects)
        clock = _resume_clock(runtime.clock_mode, runtime.vtime, speed)
        effects = {
            "llm": _llm_effect(client, from_cassette),
            "firewall": (firewall or Firewall()).effect(),
            "timer": _timer_effect(open_ids, runtime.vtime),
        }
        runner = EffectRunner(effects, EffectContext(runtime.run_id, clock))
        with LiveMarker(paths.live):
            completed = await drive(runtime, runner, control=paths.poll_control)
        log.export_jsonl(paths.events_jsonl)
        run = RunResult(runtime.run_id, paths, completed, log.head_hash, log.last_seq)
        return ResumeResult(run, plan)
