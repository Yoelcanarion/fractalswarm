"""A minimal central coordinator under the best-case supervisor, end to end on the fake LLM.

The coordinator runs N contracts with K worker calls in flight. Each worker call runs inside
the coordinator (process-tree semantics), so a crash cancels it and the restart redoes it.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fractalswarm.baselines import supervisor as sup
from fractalswarm.bench.profiles import RESTART_DELAY_MS, profile
from fractalswarm.bench.scoring import Outcome, load_events, score_run, time_lost_s
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.scheduler import (
    ActorKind,
    Command,
    Emit,
    Spawn,
    StartEffect,
    Stop,
    View,
    register_scenario,
)
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.runs import record_run, replay_run

CONTRACTS = 12
CONCURRENCY = 3


@register("test.supervised_done")
class SupervisedDone(Payload):
    results: dict[str, str]


def boss_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    contracts = [f"c{n:02d}" for n in range(1, int(args["contracts"]) + 1)]
    return {
        "sup": sup.supervised(actor_id, len(contracts), profile(args["profile"])),
        "todo": contracts,
        "redo": [],
        "attempts": {},
        "results": {},
        "k": int(args["concurrency"]),
    }


def _fill(state: dict[str, Any]) -> tuple[dict[str, Any], list[Command]]:
    commands: list[Command] = []
    s = state["sup"]
    todo, redo, attempts = list(state["todo"]), list(state["redo"]), dict(state["attempts"])
    while s.up and len(s.inflight) < state["k"] and (redo or todo):
        contract = redo.pop(0) if redo else todo.pop(0)
        attempts[contract] = attempts.get(contract, 0) + 1
        tag = f"work:{contract}#{attempts[contract]}"
        s = sup.dispatch(s, contract, tag)
        request = {"role": "agent", "input": f"Do contract {contract}."}
        commands.append(StartEffect(kind="llm", request=request, tag=tag))
        if sup.crash_due(s):
            s, crashed = sup.crash(s)
            commands += crashed
    return {**state, "sup": s, "todo": todo, "redo": redo, "attempts": attempts}, commands


def boss_handle(state: dict[str, Any], event: Event, view: View):
    if event.type == "actor.spawned":
        return _fill(state)
    if sup.is_restart(event):
        s, commands, lost = sup.restart(state["sup"])
        state, more = _fill({**state, "sup": s, "redo": [*state["redo"], *lost]})
        return state, commands + more
    if event.type == "effect.completed":
        tag = event.payload["tag"]
        contract = tag.split(":")[1].split("#")[0]
        results = {**state["results"], contract: event.payload["result"].get("output_text", "")}
        state = {**state, "sup": sup.settle(state["sup"], tag), "results": results}
        if len(results) == CONTRACTS:
            return state, [Emit(type="test.supervised_done", payload={"results": results}), Stop()]
        return _fill(state)
    return state, []


@dataclass(frozen=True)
class SupervisedScenario:
    kinds = {"boss": ActorKind(boss_init, boss_handle)}

    def boot(self, params: dict[str, Any]) -> list[Command]:
        return [Spawn(actor_id="boss", kind="boss", args=params)]


register_scenario("test-supervised", SupervisedScenario())


def checker(events: list[Event]) -> Outcome:
    done = [e for e in events if e.type == "test.supervised_done"]
    ok = bool(done) and len(done[0].payload["results"]) == CONTRACTS
    return Outcome(completed=ok, valid=ok)


async def run(tmp_path: Path, name: str) -> Path:
    params = {"contracts": CONTRACTS, "concurrency": CONCURRENCY, "profile": name}
    result = await record_run(
        "test-supervised",
        run_id=f"sup-{name}",
        run_dir=tmp_path / name,
        backend=FakeBackend(),
        seed="7",
        params=params,
    )
    return result.paths.root


async def test_crashes_stall_for_the_restart_delay_and_redo_lost_work(tmp_path: Path) -> None:
    c0 = score_run(await run(tmp_path, "C0"), checker)
    assert c0.completed and c0.valid
    assert c0.stall_s == 0 and c0.cancelled_llm_calls == 0
    assert c0.work_calls == CONTRACTS

    c2_dir = await run(tmp_path, "C2")
    c2 = score_run(c2_dir, checker)
    assert c2.completed and c2.valid
    events = load_events(c2_dir)
    crashes = [e for e in events if e.type == "baseline.crashed"]
    restarts = [e for e in events if e.type == "baseline.restarted"]
    assert len(crashes) == len(restarts) == 3
    for crashed, restarted in zip(crashes, restarts, strict=True):
        assert restarted.ts_virtual - crashed.ts_virtual == RESTART_DELAY_MS
        assert restarted.payload["redo"] == crashed.payload["lost"]

    lost = sum(len(e.payload["lost"]) for e in crashes)
    assert c2.cancelled_llm_calls == lost > 0
    assert c2.work_calls == CONTRACTS + lost  # completed work is never redone
    # Nothing runs while the coordinator is down: each crash stalls the whole restart delay.
    assert c2.stall_s >= 3 * RESTART_DELAY_MS / 1000
    assert time_lost_s(c2.makespan_s, c0.makespan_s) >= 3 * RESTART_DELAY_MS / 1000

    report = await replay_run(c2_dir)
    assert report.ok, report.detail
