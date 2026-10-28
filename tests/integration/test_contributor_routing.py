"""Every Contributor routing decision is an audit event (spec §7.5).

A T2 run in the bench's Contributor mode logs one ``security.routed`` per LLM call before the
call starts, and the call goes to the model the decision names. Content the scanners flag
(the email addresses in T2's attachments) stays on Standard.
"""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.bench.scoring import load_events
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.llm.roles import CONTRIBUTOR_SUFFIX, RoleTable
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[bool, Path]:
    spec = TaskSpec.load(TASKSPEC)
    root = tmp_path_factory.mktemp("routing")
    found = {}
    for contributor in (True, False):
        run_dir = root / f"contributor-{contributor}"
        roles = RoleTable.load()
        asyncio.run(
            record_run(
                "swarm",
                run_id=run_dir.name,
                run_dir=run_dir,
                backend=fake_backend(),
                seed=spec.seed,
                params=run_params(spec) | {"contributor": contributor},
                run_cap_usd=spec.budget_usd,
                roles=roles.contributor_mode() if contributor else roles,
            )
        )
        found[contributor] = run_dir
    return found


def test_every_llm_call_is_routed_before_it_starts(runs) -> None:
    log = load_events(runs[True])
    routed = {}
    for event in log:
        if event.type == "security.routed":
            routed[event.payload["request_id"]] = event.payload
        elif event.type == "effect.started" and event.payload["kind"] == "llm":
            assert event.payload["effect_id"] in routed
    started = {e.payload["effect_id"] for e in log if e.type == "effect.started"}
    assert set(routed) <= started

    completed = [e.payload for e in log if e.type == "effect.completed"]
    models = {p["effect_id"]: p["result"]["model"] for p in completed if p["effect_id"] in routed}
    assert models
    for effect_id, model in models.items():
        assert model.endswith(CONTRIBUTOR_SUFFIX) == routed[effect_id]["contributor"]

    decisions = list(routed.values())
    assert any(p["contributor"] for p in decisions)
    flagged = [p for p in decisions if p["findings"]]
    assert flagged and not any(p["contributor"] for p in flagged)
    assert all(p["reason"] for p in decisions)


def test_a_run_that_did_not_opt_in_has_no_routing_decisions(runs) -> None:
    assert not [e for e in load_events(runs[False]) if e.type == "security.routed"]


async def test_the_routing_audit_replays_bit_for_bit(runs) -> None:
    report = await replay_run(runs[True])
    assert report.ok, report.detail
