"""Chaos runs finish and replay bit for bit (spec §15.4, §19): the chaos-toy test-bed.

Coordinators are killed by the monkey (targeted at the most remaining work), agents are
killed, the bus drops, delays, duplicates and reorders frames, one coordinator is partitioned
and comes back as a zombie, and the fake LLM sees seeded API faults. Every contract must still
be verified, ownership must move without any LLM call, and the run must replay to MATCH.
"""

from collections import Counter
from pathlib import Path
from typing import Any

from fractalswarm.actors.chaos_toy import plan_from
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.transport import ApiFaults, FaultyBackend
from fractalswarm.runs import RunResult, record_run, replay_run


async def chaos_run(
    tmp_path: Path, name: str, params: dict[str, Any], seed: str = "s1", run_id: str | None = None
) -> RunResult:
    plan = plan_from(params)
    backend = FaultyBackend(FakeBackend(), ApiFaults(seed=seed, rate=plan.api_fault_rate))
    return await record_run(
        "chaos-toy",
        run_id=run_id or name,
        run_dir=tmp_path / name,
        backend=backend,
        seed=seed,
        params=params,
        run_cap_usd=100.0,
    )


def events_of(result: RunResult) -> list[Event]:
    with EventStore.import_jsonl(result.paths.events_jsonl) as store:
        return list(store.read())


def finished(events: list[Event]) -> dict[str, Any]:
    return next(e.payload for e in events if e.type == "toy.finished")


async def test_c3_kills_half_the_brains_and_the_run_still_finishes_and_replays(
    tmp_path: Path,
) -> None:
    params = {"coordinators": 8, "contracts": 24, "chaos": {"profile": "C3", "seed": "s1"}}
    result = await chaos_run(tmp_path, "c3", params)
    events = events_of(result)
    faults = Counter(e.payload["fault"] for e in events if e.type == "chaos.injected")

    assert finished(events) | {"by": None} == {
        "by": None,
        "complete": True,
        "verified": 24,
        "contracts": 24,
    }
    assert faults["kill_coordinator"] == 5
    assert faults["kill_agent"] > 0
    assert {"drop", "duplicate", "delay", "reorder", "partition", "heal"} <= set(faults)
    killed = {e.payload["target"] for e in events if e.payload.get("fault") == "kill_coordinator"}
    dead = {e.payload["member"] for e in events if e.type == "member.dead"}
    assert killed <= dead
    assert any(e.type == "toy.ownership.remapped" for e in events)
    # Zero coordination tokens: only agents ever call the LLM.
    callers = {e.actor for e in events if e.type == "effect.started" and e.payload["kind"] == "llm"}
    assert callers and all(actor.startswith("agent-") for actor in callers)
    verified = [e.payload["contract_id"] for e in events if e.type == "toy.contract.verified"]
    assert sorted(verified) == sorted(set(verified))

    report = await replay_run(result.paths.root)
    assert report.ok, report.detail
    assert report.replayed_head == result.head_hash


async def test_the_same_seed_gives_the_same_chaos_run(tmp_path: Path) -> None:
    params = {"coordinators": 5, "contracts": 12, "chaos": {"profile": "C2", "seed": "again"}}
    first = await chaos_run(tmp_path, "one", params, seed="again", run_id="same")
    second = await chaos_run(tmp_path, "two", params, seed="again", run_id="same")
    assert first.head_hash == second.head_hash
    assert first.events == second.events


async def test_orphaned_results_are_adopted_not_paid_twice(tmp_path: Path) -> None:
    # Kill a coordinator once all the work is dispatched: its agents finish as orphans.
    plan = ChaosPlan(actions=(ChaosAction(at=1.0, kind="kill_coordinator"),))
    params = {"coordinators": 4, "contracts": 4, "chaos": plan.model_dump(mode="json")}
    result = await chaos_run(tmp_path, "orphans", params)
    events = events_of(result)
    remapped = [e.payload for e in events if e.type == "toy.ownership.remapped"]
    assert remapped and all(p["adopted"] for p in remapped)
    dispatched = [e for e in events if e.type == "toy.contract.dispatched"]
    assert len(dispatched) == 4  # nobody redid the orphaned work
    assert finished(events)["complete"]
    assert (await replay_run(result.paths.root)).ok


async def test_zombie_fenced(tmp_path: Path) -> None:
    # Partition c1 long enough to be declared dead, then heal: the zombie's writes are
    # fenced, it learns it was declared dead, and rejoins as incarnation 1.
    action = ChaosAction(at=0.0, kind="partition", target="c1", duration_ms=6000)
    params = {
        "coordinators": 4,
        "contracts": 40,
        "checkpoint_every": 1,
        "chaos": ChaosPlan(actions=(action,)).model_dump(mode="json"),
    }
    result = await chaos_run(tmp_path, "zombie", params)
    events = events_of(result)

    dead = [e for e in events if e.type == "member.dead" and e.payload["member"] == "c1"]
    assert len(dead) == 1 and dead[0].payload["incarnation"] == 0
    fenced = [e for e in events if e.type == "write.fenced" and e.actor == "c1"]
    assert fenced and all(e.seq > dead[0].seq for e in fenced)
    assert {e.payload["reason"] for e in fenced} == {"the writer's incarnation is dead"}
    heal = next(e for e in events if e.type == "chaos.injected" and e.payload["fault"] == "heal")
    rejoined = [
        e
        for e in events
        if e.type == "member.joined"
        and e.payload["member"] == "c1"
        and e.payload["incarnation"] == 1
    ]
    assert len(rejoined) == 1 and rejoined[0].seq > heal.seq
    # After the rejoin, c1's writes carry incarnation 1 and are accepted again.
    accepted = [
        e
        for e in events
        if e.type == "toy.checkpoint" and e.actor == "c1" and e.seq > rejoined[0].seq
    ]
    assert accepted and all(e.payload["fence"]["incarnation"] == 1 for e in accepted)
    assert not [e for e in fenced if e.seq > rejoined[0].seq]
    # Survivors re-owned c1's contracts while it was gone.
    assert any(e.payload["previous"] == "c1" for e in events if e.type == "toy.ownership.remapped")
    assert finished(events)["complete"]

    report = await replay_run(result.paths.root)
    assert report.ok, report.detail
