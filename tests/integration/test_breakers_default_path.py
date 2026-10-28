"""The breakers are opt-in (spec §8), and on the swarm's default path they cannot trip.

The same T2 run (depth 2, five of its ten orchestrators killed, the root among them) is
recorded with ``channel_breakers`` off and on. The orchestrators' only bus traffic is the
heartbeat gossip, which the breakers neither count nor hold back, so the two logs must be the
same apart from the flag itself, and neither may hold a ``breaker.*`` or ``mailbox.*`` event.
A run that never asked for the breakers records nothing about them.
"""

import asyncio
import copy
from pathlib import Path
from typing import Any

import pytest

from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
KILLS = [(0.20, "o0"), (0.35, "o2.1"), (0.50, "o1"), (0.65, "o3.2"), (0.80, "o2")]


async def record(run_dir: Path, breakers: bool) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    spec.channel_breakers = breakers
    actions = tuple(ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in KILLS)
    plan = ChaosPlan(profile="kill-half", seed="1", actions=actions)
    params = run_params(spec) | {"chaos": plan.model_dump(mode="json"), "membership": True}
    await record_run(
        "swarm",
        run_id="breakers-default-path",
        run_dir=run_dir,
        backend=fake_backend(),
        seed=spec.seed,
        params=params,
        run_cap_usd=spec.budget_usd,
    )
    return run_dir


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("default-path")
    return {
        "off": asyncio.run(record(root / "off", False)),
        "on": asyncio.run(record(root / "on", True)),
    }


def without_the_flag(log: list[Event]) -> list[dict[str, Any]]:
    """Each event as a dict, with what the flag itself adds taken out."""
    rows = []
    for event in log:
        row = event.model_dump(exclude={"seq", "prev_hash", "hash"})
        payload = copy.deepcopy(row["payload"])
        if event.type == "run.started":
            payload["params"]["spec"].pop("channel_breakers")
        if event.type == "actor.spawned":
            payload["args"].pop("channel_breakers", None)
        rows.append(row | {"payload": payload})
    return rows


def test_a_run_that_never_asked_for_the_breakers_records_nothing_new_in_its_spawns(runs) -> None:
    log = load_events(runs["off"])
    spawned = [e.payload for e in log if e.type == "actor.spawned"]
    assert spawned and not [p for p in spawned if "channel_breakers" in p["args"]]
    started = log[0].payload
    assert started["params"]["spec"]["channel_breakers"] is False


def test_with_the_breakers_on_every_orchestrator_is_told_so(runs) -> None:
    log = load_events(runs["on"])
    orchestrators = [
        e.payload["args"]
        for e in log
        if e.type == "actor.spawned" and e.payload["kind"] == "orchestrator"
    ]
    assert len(orchestrators) == 10
    assert all(args["channel_breakers"] is True for args in orchestrators)
    assert log[0].payload["params"]["spec"]["channel_breakers"] is True


def test_the_breakers_never_trip_on_the_default_path_and_change_nothing_else(runs) -> None:
    off, on = load_events(runs["off"]), load_events(runs["on"])
    for log in (off, on):
        assert not [e for e in log if e.type.startswith(("breaker.", "mailbox."))]
        assert not [
            e for e in log if e.type == "msg.sent" and e.payload["topic"].startswith("mailbox")
        ]
    assert without_the_flag(on) == without_the_flag(off)


@pytest.mark.parametrize("name", ["off", "on"])
async def test_both_replay_to_their_recorded_heads(runs, name: str) -> None:
    report = await replay_run(runs[name])
    assert report.ok, report.detail
