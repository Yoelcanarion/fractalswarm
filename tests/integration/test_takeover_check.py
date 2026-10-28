"""The takeover checker proves a kill-half run from its log alone (verify/takeover.py).

The fake kill-half run (the one ``test_kill_half.py`` records) must pass every check. Each check
also has a negative test: an edited copy of that log must be flagged, and the unedited log must
not be, so the test fails if the check is removed.
"""

import asyncio
import importlib.util
import json
import shutil
from pathlib import Path
from types import ModuleType

import pytest
from typer.testing import CliRunner

from fractalswarm.bench.scoring import load_events
from fractalswarm.cli import app
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.coord.hrw import rank
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.ids import canonical_json
from fractalswarm.kernel.replay import ReplayReport
from fractalswarm.verify.takeover import TakeoverReport, analyze


def kill_half_module() -> ModuleType:
    """``test_kill_half.py`` as a module, to reuse its recording (the suite imports test files
    by path, so they cannot import each other)."""
    path = Path(__file__).with_name("test_kill_half.py")
    spec = importlib.util.spec_from_file_location("kill_half_fixture", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def run_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    kill_half = kill_half_module()
    actions = tuple(
        ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in kill_half.KILLS
    )
    plan = ChaosPlan(profile="kill-half", seed="1", actions=actions)
    root = tmp_path_factory.mktemp("takeover")
    return asyncio.run(kill_half.record(root / "kill", plan.model_dump(mode="json")))


@pytest.fixture(scope="module")
def log(run_dir: Path) -> list[Event]:
    return load_events(run_dir)


@pytest.fixture(scope="module")
def cassette(run_dir: Path) -> list[dict]:
    lines = (run_dir / "cassette.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


@pytest.fixture(scope="module")
def base(log: list[Event], cassette: list[dict]) -> TakeoverReport:
    return analyze(log, cassette=cassette)


# -- helpers: edited copies of the log ----------------------------------------------------


def kinds(report: TakeoverReport) -> set[str]:
    return {violation.kind for violation in report.violations}


def first(log: list[Event], event_type: str, **payload) -> Event:
    return next(
        e
        for e in log
        if e.type == event_type and all(e.payload.get(k) == v for k, v in payload.items())
    )


def edit(log: list[Event], seq: int, **payload_changes) -> list[Event]:
    """The log with one event's payload changed."""
    return [
        e.model_copy(update={"payload": e.payload | payload_changes}) if e.seq == seq else e
        for e in log
    ]


def drop(log: list[Event], *seqs: int) -> list[Event]:
    return [e for e in log if e.seq not in seqs]


def add(log: list[Event], event_type: str, actor: str, payload: dict, **fields) -> list[Event]:
    """The log with one more event at the end."""
    last = max(log, key=lambda e: e.seq)
    new = Event(
        seq=last.seq + 1,
        run_id=last.run_id,
        ts_virtual=last.ts_virtual,
        lamport=last.lamport + 1,
        member_epoch=last.member_epoch,
        type=event_type,
        actor=actor,
        idem_key=f"edit:{last.seq + 1}",
        payload=payload,
        prev_hash="edited",
        hash="edited",
        **fields,
    )
    return [*log, new]


def insert_after(
    log: list[Event], after_seq: int, event_type: str, actor: str, payload: dict
) -> list[Event]:
    """The log with one more event right after ``after_seq``; later events move up by one."""
    anchor = next(e for e in log if e.seq == after_seq)
    new = Event(
        seq=after_seq + 1,
        run_id=anchor.run_id,
        ts_virtual=anchor.ts_virtual,
        lamport=anchor.lamport + 1,
        member_epoch=anchor.member_epoch,
        type=event_type,
        actor=actor,
        idem_key=f"edit:insert:{after_seq}",
        payload=payload,
        prev_hash="edited",
        hash="edited",
    )

    def moved(e: Event) -> Event:
        cause = e.causation_id
        update = {"causation_id": cause + 1 if cause is not None and cause > after_seq else cause}
        return e.model_copy(update={"seq": e.seq + 1} | update) if e.seq > after_seq else e

    return [
        *(e for e in log if e.seq <= after_seq),
        new,
        *(moved(e) for e in log if e.seq > after_seq),
    ]


def flagged(report: TakeoverReport, kind: str) -> bool:
    return kind in kinds(report)


# -- the fake kill-half run passes ----------------------------------------------------------


def test_the_report_finds_the_roots_death_and_everyone_elses(base: TakeoverReport) -> None:
    kill_half = kill_half_module()
    assert [k.target for k in base.kills] == [target for _, target in kill_half.KILLS]
    root = base.kills[0]
    assert root.fault == "kill_coordinator" and root.target == "o0"
    assert root.stopped_seq is not None and root.stopped_reason == "chaos"
    # Proof of death: nothing authored by a victim after it stopped, no call of its completing.
    assert all(k.events_after_stop == 0 and k.completions_after_stop == 0 for k in base.kills)
    assert [v.subject for v in base.verdicts] == [target for _, target in kill_half.KILLS]
    assert {v.truth for v in base.verdicts} == {"true"}
    assert all(v.rejoins == [] and v.delay_ms is not None for v in base.verdicts)
    assert all(4000 <= v.delay_ms <= 5000 for v in base.verdicts)  # spec §5.2: 5 missed beats


def test_every_recomputed_heir_is_the_recorded_owner(
    base: TakeoverReport, log: list[Event]
) -> None:
    remaps = [e.payload for e in log if e.type == "ownership.remapped"]
    assert len(base.successions) == len(remaps) > 0
    for succession, recorded in zip(base.successions, remaps, strict=True):
        assert succession.heir == recorded["owner"], succession
        assert succession.ok and succession.kind == "takeover"
        assert succession.works == recorded["works"]
    root = [s for s in base.successions if s.root]
    assert root[0].previous == "o0"
    # The root goes to the best-ranked live level-1 orchestrator, from first principles.
    for s in root:
        assert s.owner == rank("root", s.pool)[0]
        assert [x.member for x in s.scores] == rank("root", s.pool)
    assert base.chains["root"][0] == "o0" and len(base.chains["root"]) == len(root) + 1


def test_nothing_is_lost_paid_twice_or_left_running(base: TakeoverReport) -> None:
    assert base.violations == [] and base.ok
    assert all(c.status == "verified" for c in base.lost_work.contracts)
    assert len(base.lost_work.contracts) == 18
    assert all(g.status == "ok" for g in base.lost_work.goals)
    task = base.lost_work.task
    assert (task.results, task.status, task.placed, task.expected) == (1, "ok", 48, 48)
    assert task.hard_violations == 0
    d = base.duplicates
    assert d.groups == [] and d.idem_key_reuse == [] and d.contract_redispatched == []
    assert d.llm_paid == d.llm_started > 0
    assert d.cassette.checked and d.cassette.entries == d.llm_started
    assert base.fencing.owner_writes_checked > 0 and base.fencing.owner_writes_unchecked == 0


def test_orphan_results_are_adopted_for_free(base: TakeoverReport) -> None:
    assert len(base.orphan_results) == 2
    assert {o.fate for o in base.orphan_results} == {"adopted"}
    assert all(o.sent_after_death and o.consumer and o.verified_seq for o in base.orphan_results)
    assert sum(s.adopted_results for s in base.successions) == 2
    assert any("final integration" in a.duties for a in base.adoptions)


def test_costs_are_settled_by_role_and_nothing_stays_reserved(base: TakeoverReport) -> None:
    c = base.costs
    assert c.open_reservations == [] and c.cancelled_llm_calls == 0
    assert set(c.by_role) == {"agent", "judge", "root_planner", "sub_planner"}
    assert sum(c.by_role.values()) == pytest.approx(c.settled_usd)
    assert sum(c.by_actor.values()) == pytest.approx(c.settled_usd)
    assert c.settled_usd < c.peak_committed_usd < (c.run_cap_usd or 0)


def test_the_cli_exits_zero_and_writes_both_reports(run_dir: Path, tmp_path: Path) -> None:
    json_path, md_path = tmp_path / "takeover.json", tmp_path / "takeover.md"
    result = CliRunner().invoke(
        app, ["takeover", str(run_dir), "--json", str(json_path), "--md", str(md_path)]
    )
    assert result.exit_code == 0, result.output
    assert "TAKEOVER OK" in result.output and "o0" in result.output
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["ok"] is True and data["violations"] == []
    assert [k["target"] for k in data["kills"]][0] == "o0"
    markdown = md_path.read_text(encoding="utf-8")
    assert "## 3. Succession" in markdown and "HRW score" in markdown


# -- negative tests, one per check ------------------------------------------------------------


def test_an_event_of_the_dead_root_after_its_stop_is_a_zombie(log, base) -> None:
    assert not flagged(base, "zombie")
    ghost = add(
        log, "artifact.written", "o0", {"path": "x", "version": 1, "author": "o0", "size": 1}
    )
    report = analyze(ghost)
    assert flagged(report, "zombie")
    assert "o0 authored 1 event" in next(v for v in report.violations if v.kind == "zombie").detail


def test_a_call_of_the_dead_root_completing_after_its_stop_is_flagged(log, base) -> None:
    assert not flagged(base, "ghost-effect")
    cancelled = first(
        log, "effect.cancelled", tag="member.tick"
    )  # o0's timer, cancelled by the kill
    completion = {"effect_id": cancelled.payload["effect_id"], "kind": "timer", "status": "ok"}
    report = analyze(add(log, "effect.completed", "@env", completion | {"tag": "member.tick"}))
    assert flagged(report, "ghost-effect")


def test_a_kill_without_a_stop_is_flagged(log, base) -> None:
    assert not flagged(base, "kill-not-stopped")
    stop = first(log, "actor.stopped", actor_id="o0")
    assert flagged(analyze(drop(log, stop.seq)), "kill-not-stopped")


def test_a_remap_whose_owner_is_not_the_hrw_heir_is_flagged(log, base) -> None:
    assert not flagged(base, "heir-mismatch")
    remap = first(log, "ownership.remapped", key="root")
    wrong = next(m for m in ("o1", "o2", "o3") if m != remap.payload["owner"])
    report = analyze(edit(log, remap.seq, owner=wrong))
    assert flagged(report, "heir-mismatch")
    found = next(v for v in report.violations if v.kind == "heir-mismatch")
    assert f"HRW heir is {remap.payload['owner']}" in found.detail


def test_two_owners_for_the_same_orphan_is_split_brain(log, base) -> None:
    assert not flagged(base, "split-brain")
    remap = first(log, "ownership.remapped", key="root")
    rival = next(m for m in ("o1", "o2", "o3") if m != remap.payload["owner"])
    twin = remap.payload | {"owner": rival, "fence": remap.payload["fence"] | {"member": rival}}
    report = analyze(add(log, "ownership.remapped", rival, twin, causation_id=remap.causation_id))
    assert flagged(report, "split-brain")


def test_a_takeover_that_claims_other_works_than_the_log_holds_is_flagged(log, base) -> None:
    assert not flagged(base, "adopted-results-mismatch")
    remap = first(log, "ownership.remapped", key="track-ai/d1")
    assert remap.payload["adopted_results"] == 1
    assert remap.payload["works"] == ["track-ai/d1/place", "track-ai/d1/blurb"]
    claims = analyze(edit(log, remap.seq, adopted_results=0))
    assert flagged(claims, "adopted-results-mismatch")
    assert any("claims 0 adopted result" in p for s in claims.successions for p in s.problems)
    works = analyze(edit(log, remap.seq, works=["track-ai/d1/place"]))
    assert flagged(works, "adopted-results-mismatch")
    assert any("claims works" in p for s in works.successions for p in s.problems)


def test_taking_over_a_live_owners_goal_is_flagged(log, base) -> None:
    assert not flagged(base, "remap-precondition")
    remap = first(log, "ownership.remapped", key="track-ai/d1")
    report = analyze(edit(log, remap.seq, previous="o3.1"))  # alive, and not this goal's owner
    assert flagged(report, "remap-precondition")
    assert any("not dead" in problem for s in report.successions for problem in s.problems)


def test_an_adoption_without_a_takeover_or_with_the_wrong_duties_is_flagged(log, base) -> None:
    assert not flagged(base, "adoption-without-takeover") and not flagged(base, "duties-mismatch")
    adopted = first(log, "tree.adopted", goal_id="root")
    remap = first(log, "ownership.remapped", key="root")
    assert flagged(analyze(drop(log, remap.seq)), "adoption-without-takeover")
    assert flagged(analyze(edit(log, adopted.seq, duties=[])), "duties-mismatch")


def test_a_write_for_a_goal_by_a_non_owner_is_flagged(log, base) -> None:
    assert not flagged(base, "stale-write")
    done = first(log, "goal.completed", goal_id="track-ai/d2")
    owner = done.payload["owner"]
    other = "o1.1" if owner != "o1.1" else "o1.2"
    forged = [e.model_copy(update={"actor": other}) if e.seq == done.seq else e for e in log]
    report = analyze(forged)
    assert flagged(report, "stale-write") and flagged(report, "forged-token")


def test_a_write_by_the_dead_old_owner_after_the_remap_is_flagged(log, base) -> None:
    assert not flagged(base, "unrefused-stale-write")
    remap = first(log, "ownership.remapped", key="root")
    old = remap.payload["previous"]
    stale = {"goal_id": "root", "owner": old, "status": "ok", "gaps": []}
    stale["fence"] = {"member": old, "incarnation": 0, "epoch": 1, "resource": "root"}
    report = analyze(add(log, "goal.completed", old, stale))
    assert flagged(report, "stale-write") and flagged(report, "unrefused-stale-write")


def test_a_valid_write_refused_as_stale_is_flagged(log, base) -> None:
    owner = first(log, "goal.completed", goal_id="track-ai/d2")
    token = owner.payload["fence"]
    refused = {"type": "goal.completed", "actor": owner.actor, "reason": "made up", "fence": token}
    report = analyze(add(log, "write.fenced", owner.actor, refused | {"member": owner.actor}))
    assert flagged(report, "fenced-without-cause")
    assert report.fencing.fenced[0].justified is False


def test_a_contract_never_verified_is_named(log, base) -> None:
    assert not flagged(base, "contract-unfinished")
    verified = first(log, "contract.verified", goal_id="track-data/d1", contract_id="blurb")
    report = analyze(drop(log, verified.seq))
    assert flagged(report, "contract-unfinished")
    lost = [c for c in report.lost_work.contracts if c.status == "unfinished"]
    assert [c.work for c in lost] == ["track-data/d1/blurb"] and lost[0].why


def test_a_goal_that_never_completes_is_named(log, base) -> None:
    assert not flagged(base, "goal-incomplete")
    done = first(log, "goal.completed", goal_id="track-ai")
    report = analyze(drop(log, done.seq))
    assert flagged(report, "goal-incomplete")
    assert [g.goal for g in report.lost_work.goals if g.status == "missing"] == ["track-ai"]


def test_a_task_result_with_fewer_placed_than_expected_is_flagged(log, base) -> None:
    assert not flagged(base, "task-result")
    result = first(log, "task.result")
    short = result.payload["report"] | {"placed": 47}
    report = analyze(edit(log, result.seq, report=short))
    assert flagged(report, "task-result")
    assert report.lost_work.task.placed == 47 and report.lost_work.task.expected == 48
    assert "placed 47 of 48" in next(v for v in report.violations if v.kind == "task-result").detail
    hard = analyze(edit(log, result.seq, report=result.payload["report"] | {"hard_violations": 2}))
    assert any("hard violation" in v.detail for v in hard.violations)
    assert flagged(analyze(drop(log, result.seq)), "task-result")


def llm_pair(log: list[Event]) -> tuple[Event, Event]:
    started = next(e for e in log if e.type == "effect.started" and e.payload["kind"] == "llm")
    done = next(
        e
        for e in log
        if e.payload.get("effect_id") == started.payload["effect_id"]
        and e.type == "effect.completed"
    )
    return started, done


def with_call(log: list[Event], name: str, request: dict, outcome: str) -> list[Event]:
    """A synthetic llm call: started, then completed or cancelled."""
    _, done = llm_pair(log)
    effect = {"effect_id": name, "kind": "llm", "tag": f"edit|{name}"}
    log = add(log, "effect.started", "o9", effect | {"request": request})
    if outcome == "cancelled":
        return add(log, "effect.cancelled", "chaos", effect)
    result = done.payload["result"]
    return add(log, "effect.completed", "@env", effect | {"status": "ok", "result": result})


def test_a_completed_llm_call_duplicated_is_paid_twice(log, base) -> None:
    assert not flagged(base, "duplicate-call")
    started, _ = llm_pair(log)
    twin = with_call(log, "eff-dup.0", started.payload["request"], "completed")
    report = analyze(twin)
    assert flagged(report, "duplicate-call")
    group = report.duplicates.groups[0]
    assert len(group.calls) == 2 and group.wasted_usd > 0


def test_a_cancelled_call_redone_once_is_the_expected_cost_of_a_crash(log) -> None:
    request = llm_pair(log)[0].payload["request"] | {"instructions": "edited: never seen before"}
    once = with_call(log, "eff-x.0", request, "cancelled")
    once = with_call(once, "eff-x.1", request, "completed")
    report = analyze(once)
    assert not flagged(report, "cancelled-redone-twice") and not flagged(report, "duplicate-call")
    assert [len(c.redone) for c in report.duplicates.cancelled] == [1]


def test_a_cancelled_call_redone_twice_is_flagged(log) -> None:
    request = llm_pair(log)[0].payload["request"] | {"instructions": "edited: never seen before"}
    twice = with_call(log, "eff-x.0", request, "cancelled")
    twice = with_call(twice, "eff-x.1", request, "completed")
    twice = with_call(twice, "eff-x.2", request, "completed")
    report = analyze(twice)
    assert flagged(report, "cancelled-redone-twice") and flagged(report, "duplicate-call")
    assert [len(c.redone) for c in report.duplicates.cancelled] == [2]


def test_idem_key_reuse_among_effect_starts_is_flagged(log, base) -> None:
    assert not flagged(base, "idem-key-reuse")
    starts = [e for e in log if e.type == "effect.started"]
    reused = [
        e.model_copy(update={"idem_key": starts[0].idem_key}) if e.seq == starts[1].seq else e
        for e in log
    ]
    report = analyze(reused)
    assert flagged(report, "idem-key-reuse")
    assert report.duplicates.idem_key_reuse == [starts[0].idem_key]


def test_a_contract_dispatched_again_after_its_result_reached_a_dead_owner_is_paid_twice(
    log, base
) -> None:
    assert not flagged(base, "orphan-redispatched") and not flagged(base, "contract-redispatched")
    orphan = base.orphan_results[0]
    dispatched = first(log, "contract.dispatched", goal_id=orphan.goal, contract_id=orphan.contract)
    again = add(log, "contract.dispatched", orphan.consumer, dispatched.payload)
    report = analyze(again)
    assert flagged(report, "orphan-redispatched") and flagged(report, "contract-redispatched")
    # An heir that consumes the result but never verifies the contract adopted nothing.
    verified = first(log, "contract.verified", goal_id=orphan.goal, contract_id=orphan.contract)
    assert flagged(analyze(drop(log, verified.seq)), "orphan-unfinished")


def test_cassette_entries_must_match_completed_effects_exactly(log, cassette, base) -> None:
    assert base.duplicates.cassette.duplicated == [] and base.duplicates.cassette.orphans == []
    twice = analyze(log, cassette=[*cassette, cassette[0]])
    assert flagged(twice, "cassette-duplicate")
    orphan = analyze(log, cassette=[*cassette, cassette[0] | {"effect_id": "eff-0.0"}])
    assert flagged(orphan, "cassette-orphan")
    missing = analyze(log, cassette=cassette[1:])
    assert flagged(missing, "cassette-missing")
    foreign = analyze(log, cassette=[c | {"run_id": "another"} for c in cassette])
    assert flagged(foreign, "cassette-foreign")


def test_a_false_verdict_is_classified_and_its_rejoin_listed(log, base) -> None:
    alive = "o2.2"  # nobody stopped it before this early verdict
    after = max(e.seq for e in log if e.type == "member.joined")
    member_dead = {"member": alive, "incarnation": 0, "by": "o2", "by_incarnation": 0}
    member_dead |= {"missed": 5, "last_heard_ms": 1}
    verdict = insert_after(log, after, "member.dead", "o2", member_dead)
    joined = insert_after(
        verdict, after + 1, "member.joined", alive, {"member": alive, "incarnation": 1}
    )
    report = analyze(joined)
    false = [v for v in report.verdicts if v.truth == "false"]
    assert [v.subject for v in false] == [alive] and false[0].kill_seq is None
    assert [(r.member, r.incarnation) for r in false[0].rejoins] == [(alive, 1)]
    assert {v.truth for v in base.verdicts} == {"true"}


def test_an_open_reservation_and_a_breached_cap_are_flagged(log, base) -> None:
    assert not flagged(base, "open-reservation") and not flagged(base, "cap-exceeded")
    settled = first(log, "budget.settled")
    assert flagged(analyze(drop(log, settled.seq)), "open-reservation")
    started = log[0]
    tight = [
        e.model_copy(update={"payload": e.payload | {"run_cap_usd": 0.1}}) if e is started else e
        for e in log
    ]
    assert flagged(analyze(tight), "cap-exceeded")


def test_a_log_that_never_completed_is_flagged(log, base) -> None:
    assert not flagged(base, "run-incomplete")
    completed = first(log, "run.completed")
    assert flagged(analyze(drop(log, completed.seq)), "run-incomplete")


def test_a_false_verdict_before_a_later_kill_is_not_about_the_kill(log) -> None:
    """A member declared dead while alive, then killed: only the second verdict follows a kill."""
    victim, kill = "o1", first(log, "chaos.injected", target="o1")
    after = max(e.seq for e in log if e.type == "member.joined")
    early = {"member": victim, "incarnation": 0, "by": "o2", "by_incarnation": 0}
    early |= {"missed": 5, "last_heard_ms": 1}
    report = analyze(insert_after(log, after, "member.dead", "o2", early))
    first_verdict = next(v for v in report.verdicts if v.subject == victim)
    assert first_verdict.truth == "false" and first_verdict.seq < kill.seq
    assert first_verdict.kill_seq is None and first_verdict.delay_ms is None


def test_a_cancelled_agent_call_is_followed_to_its_contract(log) -> None:
    """The redo of a lost contract is a new attempt, so its requests differ: the report names the
    contract and counts its later dispatches."""
    dispatched = first(log, "contract.dispatched", goal_id="track-data/d1", contract_id="place")
    request = llm_pair(log)[0].payload["request"] | {"instructions": "agent step"}
    tag = f"{dispatched.payload['idem_key']}:1"
    effect = {"effect_id": "eff-agent.0", "kind": "llm", "tag": tag}
    edited = add(
        log, "effect.started", dispatched.payload["assignee"], effect | {"request": request}
    )
    edited = add(edited, "effect.cancelled", "chaos", effect)
    edited = add(edited, "contract.dispatched", "o1.1", dispatched.payload | {"attempt": 1})
    call = analyze(edited).duplicates.cancelled[0]
    assert call.work == "track-data/d1/place" and call.work_dispatched_again == 1
    assert call.redone == []


def test_a_replay_that_diverges_is_flagged(log, base) -> None:
    diverged = ReplayReport(
        ok=False,
        chain_ok=True,
        recorded_events=len(log),
        replayed_events=10,
        recorded_head="a",
        replayed_head="b",
        first_divergence=10,
        detail="boom",
    )
    assert flagged(analyze(log, replay=diverged), "replay-diverged")
    assert not flagged(base, "replay-diverged")


def test_a_tampered_log_fails_the_hash_chain_and_the_cli_exits_one(
    run_dir: Path, tmp_path: Path
) -> None:
    tampered = tmp_path / "tampered"
    shutil.copytree(run_dir, tampered)
    (tampered / "events.sqlite").unlink()
    path = tampered / "events.jsonl"
    lines = path.read_text(encoding="utf-8").splitlines()
    index = next(i for i, line in enumerate(lines) if '"type":"task.result"' in line)
    event = json.loads(lines[index])
    event["payload"]["report"]["placed"] = 99
    lines[index] = canonical_json(event)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result = CliRunner().invoke(app, ["takeover", str(tampered)])
    assert result.exit_code == 1, result.output
    assert "chain-broken" in result.output and "TAKEOVER FAILED" in result.output
