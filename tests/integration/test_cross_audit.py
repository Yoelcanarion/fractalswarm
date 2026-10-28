"""The cross-squad audit on the real T2 slice (spec §11.3), fake LLM.

A sibling of each squad's owner, chosen by HRW, audits the contracts a seeded draw selects
(all of the critical path), before they are booked and verified. The run must still complete
with a valid program and replay bit for bit, at C0 and at C3, and a takeover must not lose or
double an audit when the auditor or the audited squad dies.
"""

import asyncio
import json
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from fractalswarm.bench.scoring import RunMetrics, load_events, score_run
from fractalswarm.bench.workflows import CALIBRATION, bench_script, fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan, plan_from
from fractalswarm.kernel.events import Event
from fractalswarm.llm.calibrate import Calibration
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.transport import ApiFaults, FaultyBackend
from fractalswarm.planning.planner import read_blocks
from fractalswarm.planning.risk import failure_rate
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run
from fractalswarm.verify.cross_audit import audit_rate, draw

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
AUDIT_TYPES = {"verify.sampled", "verify.audited"}


def params_for(
    audit: bool = True, chaos: dict[str, Any] | None = None, **extra: Any
) -> dict[str, Any]:
    params = run_params(TaskSpec.load(TASKSPEC)) | extra
    if audit:
        params["cross_audit"] = True
    if chaos is not None:
        params["chaos"] = chaos
    return params


def chaos_backend(params: dict[str, Any], seed: str = "1") -> FaultyBackend:
    rate = plan_from(params).api_fault_rate
    return FaultyBackend(fake_backend(), ApiFaults(seed=seed, rate=rate))


async def record(run_dir: Path, params: dict[str, Any], backend: Any = None) -> Path:
    await record_run(
        "swarm",
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=backend if backend is not None else fake_backend(),
        seed="1",
        params=params,
        run_cap_usd=2.0,
    )
    return run_dir


def of_type(log: list[Event], *types: str) -> list[Event]:
    return [e for e in log if e.type in types]


def audit_calls(log: list[Event]) -> list[Event]:
    return [
        e
        for e in log
        if e.type == "effect.started" and (e.payload["tag"] or "").startswith("audit|")
    ]


def kills(log: list[Event]) -> list[str]:
    return [
        e.payload["target"]
        for e in log
        if e.type == "chaos.injected" and e.payload["fault"] == "kill_coordinator"
    ]


def check_the_audit(log: list[Event]) -> dict[str, int]:
    """What every audited run must show, whatever happened to its orchestrators."""
    result = next(e.payload for e in log if e.type == "task.result")
    assert result["status"] == "ok", result["report"]["gaps"]
    assert result["report"]["placed"] == result["report"]["expected"] == 48
    assert result["report"]["hard_violations"] == 0

    sampled = {
        (e.payload["work"], e.payload["attempt"]): e.payload for e in of_type(log, "verify.sampled")
    }
    audited = of_type(log, "verify.audited")
    verdicts = {
        (f"{e.payload['goal_id']}/{e.payload['contract_id']}", e.payload["attempt"]): e.payload
        for e in audited
    }
    assert len(verdicts) == len(audited), "an attempt was audited twice"
    seed = log[0].payload["seed"]
    for (work, attempt), found in sampled.items():
        # The log's decision is the pure function of the seed, the contract and its risk.
        assert found["draw"] == draw(seed, work, attempt)
        if "failed its audit" not in found["basis"]:
            assert found["rate"] == audit_rate(found["risk"], found["critical_path"])[0]
        assert found["selected"] == (found["draw"] < found["rate"])

    for event in of_type(log, "contract.verified"):
        attempt = event.payload["attempt"]
        work = f"{event.payload['goal_id']}/{event.payload['contract_id']}"
        found = sampled[(work, attempt)]  # nothing is verified without a sampling decision
        if found["critical_path"]:
            assert found["selected"], f"{work} is on the critical path and was not audited"
        if found["selected"]:  # and an audited contract is verified only after a verdict
            assert verdicts[(work, attempt)]["verdict"] in ("pass", "skipped")
    return {
        "sampled": len(sampled),
        "audited": len(verdicts),
        "failed": sum(v["verdict"] == "fail" for v in verdicts.values()),
    }


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("cross-audit")
    c0 = {"profile": "C0", "seed": "1"}
    c3 = {"profile": "C3", "seed": "1"}
    c3_params = params_for(chaos=c3)
    return {
        "plain": asyncio.run(record(root / "plain", params_for())),
        "c0": asyncio.run(record(root / "c0", params_for(chaos=c0))),
        "c3": asyncio.run(record(root / "c3", c3_params, chaos_backend(c3_params))),
        "off": asyncio.run(record(root / "off", params_for(audit=False))),
    }


# -- at C0 and at C3: complete, valid, MATCH ----------------------------------------------


@pytest.mark.parametrize("name", ["plain", "c0", "c3"])
def test_the_audited_run_completes_with_a_valid_program(runs, name: str) -> None:
    log = load_events(runs[name])
    found = check_the_audit(log)
    assert found["sampled"] >= 18  # every contract was sampled; retries and heirs add more
    assert found["audited"] >= 6  # at least the six critical-path place contracts
    assert found["failed"] == 0


@pytest.mark.parametrize("name", ["plain", "c0", "c3"])
async def test_the_audited_run_replays_bit_for_bit(runs, name: str) -> None:
    report = await replay_run(runs[name])
    assert report.ok, report.detail


def test_c3_killed_half_the_orchestrators_and_still_audited(runs) -> None:
    log = load_events(runs["c3"])
    assert len(kills(log)) == 5
    assert any(e.type == "ownership.remapped" for e in log)
    assert audit_calls(log)


@pytest.mark.parametrize("name", ["plain", "c0", "c3"])
def test_the_audit_costs_no_coordination_tokens(runs, name: str) -> None:
    metrics = score_run(runs[name])
    assert isinstance(metrics, RunMetrics)
    assert metrics.coordination_tokens == 0


# -- who audits, and what ---------------------------------------------------------------


@pytest.mark.parametrize("name", ["plain", "c0"])
def test_a_sibling_of_the_owner_audits_each_contract(runs, name: str) -> None:
    log = load_events(runs[name])
    requests = [e for e in log if e.type == "msg.sent" and e.payload["topic"] == "audit.request"]
    assert requests
    for e in requests:
        owner, auditor = e.payload["body"]["owner"], e.payload["to"]
        assert auditor != owner
        assert auditor.rsplit(".", 1)[0] == owner.rsplit(".", 1)[0], (owner, auditor)
        assert e.actor == owner  # the owner asks, and nobody else


def test_each_audit_is_one_call_of_the_auditor_role_billed_to_the_audited_squad(runs) -> None:
    log = load_events(runs["plain"])
    calls = audit_calls(log)
    assert len(calls) == len(of_type(log, "verify.audited"))  # one call per audited attempt
    requests = {
        (e.payload["body"]["goal_id"], e.payload["body"]["contract_id"]): e.payload["body"]
        for e in log
        if e.type == "msg.sent" and e.payload["topic"] == "audit.request"
    }
    reserved = {
        e.payload["effect_id"]: e.payload["scopes"] for e in of_type(log, "budget.reserved")
    }
    for call in calls:
        assert call.payload["kind"] == "llm" and call.payload["request"]["role"] == "auditor"
        _, gid, cid, _ = call.payload["tag"].split("|")
        assert reserved[call.payload["effect_id"]]["squad"] == requests[(gid, cid)]["owner"]


def test_the_critical_path_is_always_audited_and_the_rest_by_the_draw(runs) -> None:
    log = load_events(runs["plain"])
    sampled = [e.payload for e in of_type(log, "verify.sampled")]
    places = [s for s in sampled if s["contract_id"] == "place"]
    assert len(places) == 6
    assert all(s["selected"] and s["basis"] == "critical path" for s in places)
    others = [s for s in sampled if s["contract_id"] != "place"]
    assert others and all(s["rate"] == 0.15 and s["basis"] == "risk < 0.4" for s in others)
    assert all(0.0 <= s["risk"] < 0.4 for s in others)
    assert set(sampled[0]["terms"]) == {
        "cost_uncertainty",
        "critical_path",
        "tool",
        "planner",
        "role_failure",
    }


def test_the_audit_adds_calls_only_to_the_selected_contracts(runs) -> None:
    on, off = load_events(runs["plain"]), load_events(runs["off"])

    def calls(log: list[Event], role: str) -> int:
        return sum(
            1
            for e in log
            if e.type == "effect.started"
            and e.payload["kind"] == "llm"
            and e.payload["request"].get("role") == role
        )

    assert calls(on, "auditor") == len(of_type(on, "verify.audited")) > 0
    assert calls(off, "auditor") == 0
    for role in ("sub_planner", "root_planner"):
        assert calls(on, role) == calls(off, role)  # the plans do not depend on the audit
    assert on[-1].payload["spent_usd"] > off[-1].payload["spent_usd"]


# -- off by default ---------------------------------------------------------------------


def test_without_the_flag_the_log_has_no_audit_events_and_the_same_spawn_args(runs) -> None:
    log = load_events(runs["off"])
    assert not AUDIT_TYPES & {e.type for e in log}
    assert not [e for e in log if e.type == "msg.sent" and e.payload["topic"].startswith("audit.")]
    assert not audit_calls(log)
    for e in of_type(log, "actor.spawned"):
        assert "audit" not in e.payload["args"] and "feasibility" not in e.payload["args"]
    assert next(e.payload for e in log if e.type == "task.result")["status"] == "ok"


async def test_a_log_that_lacks_the_params_replays_as_off(tmp_path: Path) -> None:
    params = params_for(audit=False)
    params["spec"] = {
        key: value
        for key, value in params["spec"].items()
        if key not in ("cross_audit", "feasibility_report")
    }
    run = await record(tmp_path / "old", params)
    log = load_events(run)
    assert not AUDIT_TYPES & {e.type for e in log}
    report = await replay_run(run)
    assert report.ok, report.detail


async def test_the_baselines_have_no_sibling_squad_to_audit_them(tmp_path: Path) -> None:
    await record_run(
        "central",
        run_id="central",
        run_dir=tmp_path / "central",
        backend=fake_backend(),
        seed="1",
        params=params_for(chaos={"profile": "C0", "seed": "1"}),
        run_cap_usd=2.0,
    )
    log = load_events(tmp_path / "central")
    assert not AUDIT_TYPES & {e.type for e in log}
    assert next(e.payload for e in log if e.type == "task.result")["status"] == "ok"


def test_the_flag_comes_from_the_taskspec_and_a_param_overrides_it(tmp_path: Path) -> None:
    spec = TaskSpec.load(TASKSPEC)
    assert spec.cross_audit is False and spec.feasibility_report is False
    on = run_params(spec.model_copy(update={"cross_audit": True}))
    assert on["spec"]["cross_audit"] is True
    from fractalswarm.actors.swarm import SWARM

    def spawned(params: dict[str, Any]) -> dict[str, Any]:
        return next(c.args for c in SWARM.boot(params) if getattr(c, "actor_id", "") == "o0")

    assert spawned(on).get("audit") is True
    assert "audit" not in spawned(run_params(spec))
    assert spawned(run_params(spec) | {"cross_audit": True}).get("audit") is True
    assert "audit" not in spawned(on | {"cross_audit": False})


# -- scripted fakes: a failing audit, a risky plan, slow audits ---------------------------


def scripted(fail: str | None = None, risk: float | None = None) -> Callable[..., Any]:
    """The bench's fake LLM, except that the audit of ``fail`` (a goal/contract) fails on its
    first attempt, and every session plan reports ``risk`` as its contracts' risk."""

    def script(body: dict[str, Any], attempt: int):
        reply = bench_script(body, attempt)
        name = ((body.get("text") or {}).get("format") or {}).get("name", "")
        if name == "audit_verdict" and fail is not None:
            found = read_blocks(body["input"])["audit"]
            if found["work"] == fail and found["attempt"] == 0:
                reasons = ["slot 0 holds 2 talks of one session"]
                return json.dumps({"verdict": "fail", "score": 0.1, "reasons": reasons})
        if name == "t2_session_plan" and risk is not None:
            plan = json.loads(reply)
            plan["contracts"] = [c | {"risk": risk} for c in plan["contracts"]]
            return json.dumps(plan, sort_keys=True)
        return reply

    return script


def backend_with(script: Callable[..., Any]) -> FakeBackend:
    return Calibration.load(CALIBRATION).backend(script=script)


class SlowAudits:
    """Audit calls take ``extra_ms`` longer, so they are in flight when a kill lands."""

    def __init__(self, inner: Any, extra_ms: int) -> None:
        self.inner, self.extra_ms = inner, extra_ms

    async def send(self, effect_id: str, body: dict[str, Any], sleep: Any):
        if ((body.get("text") or {}).get("format") or {}).get("name") == "audit_verdict":
            await sleep(self.extra_ms)
        return await self.inner.send(effect_id, body, sleep)


def kill_params(target: str, at: float) -> dict[str, Any]:
    plan = ChaosPlan(
        profile="audit-kill",
        seed="1",
        actions=(ChaosAction(at=at, kind="kill_coordinator", target=target),),
    )
    return params_for(chaos=plan.model_dump(mode="json"), membership=True)


@pytest.fixture(scope="module")
def scenarios(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("audit-scenarios")
    failing = backend_with(scripted(fail="track-ai/d1/place"))
    return {
        "fail": asyncio.run(record(root / "fail", params_for(), failing)),
        "risky": asyncio.run(
            record(root / "risky", params_for(), backend_with(scripted(risk=1.0)))
        ),
        "auditor-dies": asyncio.run(
            record(
                root / "auditor",
                kill_params("o2.2", 0.45),
                SlowAudits(backend_with(bench_script), 20_000),
            )
        ),
        "audited-dies": asyncio.run(
            record(
                root / "audited",
                kill_params("o2.1", 0.45),
                SlowAudits(backend_with(bench_script), 20_000),
            )
        ),
    }


# -- a failed audit goes back up the replanning ladder ------------------------------------


def of_contract(log: list[Event], gid: str, cid: str) -> list[Event]:
    return [
        e for e in log if e.payload.get("goal_id") == gid and e.payload.get("contract_id") == cid
    ]


def test_a_failed_audit_rejects_the_contract_and_the_retry_is_audited_again(scenarios) -> None:
    log = load_events(scenarios["fail"])
    check_the_audit(log)
    verdicts = [e.payload for e in of_type(log, "verify.audited")]
    (failed,) = [v for v in verdicts if v["verdict"] == "fail"]
    assert (failed["goal_id"], failed["contract_id"], failed["attempt"]) == (
        "track-ai/d1",
        "place",
        0,
    )
    assert failed["reasons"] == ["slot 0 holds 2 talks of one session"]
    mine = of_contract(log, "track-ai/d1", "place")

    # Step 1 of the ladder: the contract is rejected at the audit stage with the auditor's
    # reasons, and goes again as attempt 1.
    rejected = [e.payload for e in mine if e.type == "contract.rejected"]
    assert [(r["stage"], r["attempt"], r["reasons"]) for r in rejected] == [
        ("audit", 0, failed["reasons"])
    ]
    assert [e.payload["attempt"] for e in mine if e.type == "contract.dispatched"] == [0, 1]
    assert [e.payload["attempt"] for e in mine if e.type == "contract.verified"] == [1]

    # Nothing was booked for the attempt that failed its audit: the audit is before booking.
    booked = [
        e
        for e in log
        if e.type == "msg.sent"
        and e.payload["topic"] == "book"
        and e.payload["body"]["goal_id"] == "track-ai/d1"
    ]
    assert [e.payload["body"]["attempt"] for e in booked] == [1]

    # The retry is sampled again, and always audited: an earlier attempt failed.
    second = next(
        e.payload for e in mine if e.type == "verify.sampled" and e.payload["attempt"] == 1
    )
    assert second["selected"] and second["rate"] == 1.0
    assert "failed its audit" in second["basis"]
    passed = [
        e.payload["verdict"]
        for e in mine
        if e.type == "verify.audited" and e.payload["attempt"] == 1
    ]
    assert passed == ["pass"]
    result = next(e.payload for e in log if e.type == "task.result")
    assert result["status"] == "ok" and result["report"]["hard_violations"] == 0


def test_the_failure_enters_the_role_history_that_feeds_the_next_risk(scenarios) -> None:
    log = load_events(scenarios["fail"])
    retried = next(
        e.payload
        for e in of_type(log, "verify.sampled")
        if e.payload["work"] == "track-ai/d1/place" and e.payload["attempt"] == 1
    )
    # One failed attempt in the place role so far: its rate is above the no-history prior.
    assert retried["terms"]["role_failure"] > failure_rate(0, 0)


async def test_the_run_with_a_failed_audit_replays_bit_for_bit(scenarios) -> None:
    report = await replay_run(scenarios["fail"])
    assert report.ok, report.detail


# -- the 50% band ------------------------------------------------------------------------


def test_a_plan_that_calls_its_contracts_very_risky_puts_them_in_the_half_band(scenarios) -> None:
    log = load_events(scenarios["risky"])
    check_the_audit(log)
    sampled = [e.payload for e in of_type(log, "verify.sampled")]
    rest = [s for s in sampled if not s["critical_path"]]
    assert len(rest) == 12
    assert all(s["basis"] == "0.4 <= risk < 0.7" and s["rate"] == 0.5 for s in rest), rest
    assert all(0.4 <= s["risk"] < 0.7 for s in rest)
    chosen = [s["selected"] for s in rest]
    assert any(chosen) and not all(chosen)  # about half, by the seeded draw
    audited = {
        f"{e.payload['goal_id']}/{e.payload['contract_id']}" for e in of_type(log, "verify.audited")
    }
    expected = {s["work"] for s in sampled if s["selected"]}
    assert audited == expected


# -- takeover: the auditor dies, the audited squad dies -----------------------------------


async def test_when_the_auditor_dies_mid_audit_the_owner_asks_the_next_one(scenarios) -> None:
    run = scenarios["auditor-dies"]
    log = load_events(run)
    check_the_audit(log)
    assert kills(log) == ["o2.2"]
    started = {e.payload["effect_id"]: e.actor for e in audit_calls(log)}
    cancelled = [
        e.payload
        for e in log
        if e.type == "effect.cancelled" and (e.payload["tag"] or "").startswith("audit|")
    ]
    assert cancelled, "the kill did not land on a running audit"
    assert all(started[lost["effect_id"]] == "o2.2" for lost in cancelled)
    dead = next(e.seq for e in log if e.type == "member.dead" and e.payload["member"] == "o2.2")
    for lost in cancelled:
        _, gid, cid, attempt = lost["tag"].split("|")
        asks = [
            e
            for e in log
            if e.type == "msg.sent"
            and e.payload["topic"] == "audit.request"
            and (e.payload["body"]["goal_id"], e.payload["body"]["contract_id"]) == (gid, cid)
            and e.payload["body"]["attempt"] == int(attempt)
        ]
        assert len(asks) == 2
        # Nobody asks again until the log says the auditor is dead; then it is the next pick.
        assert asks[1].seq > dead and asks[1].payload["to"] != "o2.2"
        verdicts = [e.payload for e in of_contract(log, gid, cid) if e.type == "verify.audited"]
        assert [v["auditor"] for v in verdicts] == [asks[1].payload["to"]]
    report = await replay_run(run)
    assert report.ok, report.detail


async def test_when_the_audited_squad_dies_its_heir_adopts_the_verdict_not_a_second_call(
    scenarios,
) -> None:
    run = scenarios["audited-dies"]
    log = load_events(run)
    check_the_audit(log)
    assert kills(log) == ["o2.1"]
    adopted = [e.payload for e in of_type(log, "verify.audited") if e.payload["reused"]]
    assert adopted, "no verdict was adopted from the log"
    # The audited attempt's one call ran once: the heir read the answer, it did not ask again.
    calls = Counter(e.payload["tag"] for e in audit_calls(log))
    for verdict in adopted:
        tag = f"audit|{verdict['goal_id']}|{verdict['contract_id']}|{verdict['attempt']}"
        assert calls[tag] == 1
    assert all(n == 1 for n in calls.values())
    report = await replay_run(run)
    assert report.ok, report.detail
