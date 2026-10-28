"""The Muse lens API (arena spec §E): every LLM call of a run, joined from its log and cassette.

The numbers asserted for ``demo/backup`` were summed from its ``events.jsonl`` by a separate
script, not by the lens. A fake run (chaos kills and the Contributor mode on) covers what the
bundle has none of: cancelled calls with their cause, and routing decisions. Nothing calls a
model, and nothing here touches the ledger or the shared runs dir.
"""

import asyncio
import json
from collections import Counter
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from fractalswarm.api.app import create_app
from fractalswarm.api.lens import (
    Facts,
    badge,
    best_sentence,
    call_ref,
    rationale,
    sentence_spans,
    split_prompt,
    utf16_offset,
)
from fractalswarm.bench.scoring import load_events, score_run
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan, plan_from
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.roles import CONTRIBUTOR_SUFFIX, RoleTable
from fractalswarm.llm.transport import ApiFaults, FaultyBackend
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "demo"
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
KILLS = [(0.20, "o0"), (0.35, "o2.1"), (0.50, "o1"), (0.65, "o3.2"), (0.80, "o2")]


def record(run_dir: Path, scenario: str, chaos: dict, **extra) -> None:
    spec = TaskSpec.load(TASKSPEC)
    params = run_params(spec) | {"chaos": chaos, "membership": True} | extra.pop("params", {})
    backend = fake_backend()
    if rate := plan_from(params).api_fault_rate:  # as the CLI does: the plan's failing API
        backend = FaultyBackend(backend, ApiFaults(seed=spec.seed, rate=rate))
    asyncio.run(
        record_run(
            scenario,
            run_id=run_dir.name,
            run_dir=run_dir,
            backend=backend,
            seed=spec.seed,
            params=params,
            run_cap_usd=spec.budget_usd,
            **extra,
        )
    )


@pytest.fixture(scope="module")
def fake_run(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A T2 swarm run on the calibrated fake at the C3 profile (agents and coordinators die,
    the API fails and retries), every call opted in to the Contributor mode."""
    run_dir = tmp_path_factory.mktemp("runs") / "lens-fake"
    record(
        run_dir,
        "swarm",
        {"profile": "C3", "seed": "1"},
        params={"contributor": True},
        roles=RoleTable.load().contributor_mode(),
    )
    return run_dir


@pytest.fixture(scope="module")
def central_run(fake_run: Path) -> Path:
    """The central baseline losing its coordinator five times (its own calls die with it)."""
    actions = tuple(ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in KILLS)
    plan = ChaosPlan(profile="kill-half", seed="1", actions=actions)
    record(fake_run.parent / "lens-central", "central", plan.model_dump(mode="json"))
    return fake_run.parent / "lens-central"


@pytest.fixture(scope="module")
def client(fake_run: Path, central_run: Path) -> TestClient:
    return TestClient(create_app(fake_run.parent, DEMO, fake_run.parent / "bench", Path("none")))


def calls(client: TestClient, run: str, **query: str) -> list[dict]:
    response = client.get(f"/api/runs/{run}/calls", params=query)
    assert response.status_code == 200, response.text
    return response.json()["calls"]


def detail(client: TestClient, run: str, effect_id: str) -> dict:
    response = client.get(f"/api/runs/{run}/calls/{effect_id}")
    assert response.status_code == 200, response.text
    return response.json()


# -- demo/backup: the recorded real run ---------------------------------------------------------


def test_the_backup_has_one_row_per_llm_effect(client: TestClient) -> None:
    body = client.get("/api/runs/demo-backup/calls").json()
    rows = body["calls"]
    assert body["count"] == len(rows) == 79 and body["refused"] == []
    assert Counter(row["role"] for row in rows) == {
        "agent": 58,
        "judge": 11,
        "sub_planner": 9,
        "root_planner": 1,
    }
    assert Counter(row["model"] for row in rows) == {"muse-spark-1.3": 78, "muse-wonder-1.0": 1}
    assert Counter(row["effort"] for row in rows) == {"low": 69, "medium": 9, "high": 1}
    assert {row["status"] for row in rows} == {"ok"} and not any(row["cancel"] for row in rows)
    assert [row["seq"] for row in rows] == sorted(row["seq"] for row in rows)


def test_the_root_planner_row_carries_the_numbers_of_the_log(client: TestClient) -> None:
    (row,) = calls(client, "demo-backup", role="root_planner")
    assert (row["effect_id"], row["actor"], row["tag"]) == ("eff-408.1", "o0", "plan|root|0")
    assert row["ref"] == {"kind": "plan", "goal_id": "root", "attempt": 0}
    assert (row["model"], row["badge"], row["effort"]) == ("muse-wonder-1.0", "wonder", "high")
    assert (row["level"], row["max_output_tokens"], row["purpose"]) == ("L0", 16384, "planning")
    assert row["usage"] == {
        "input_tokens": 2037,
        "cached_tokens": 2036,
        "output_tokens": 2333,
        "reasoning_tokens": 1685,
        "searches": 0,
    }
    assert row["cost_usd"] == pytest.approx(0.0470712) and not row["estimated"]
    assert (row["latency_ms"], row["attempts"], row["http_status"]) == (14612, 1, 200)
    assert (row["started_ts"], row["ended_ts"], row["elapsed_ms"]) == (3390, 18031, 14641)
    assert row["routing"] is None and row["cancel"] is None


def test_an_agent_turn_says_which_contract_it_serves(client: TestClient) -> None:
    row = next(
        r for r in calls(client, "demo-backup", actor="o1.2.a2") if r["effect_id"] == "eff-3707.0"
    )
    assert row["ref"] == {
        "kind": "agent",
        "goal_id": "track-data/d2",
        "contract_id": "extract",
        "contract_kind": "extract",
        "attempt": 0,
        "step": 1,
    }
    assert row["tag"] == "c-9b7709bb13e2:1" and row["purpose"] == "work"
    (judge,) = [
        r for r in calls(client, "demo-backup", role="judge") if r["effect_id"] == "eff-5840.1"
    ]
    assert judge["ref"] == {
        "kind": "judge",
        "goal_id": "track-data/d1",
        "contract_id": "place",
        "attempt": 0,
    }


def test_calls_can_be_filtered(client: TestClient) -> None:
    assert len(calls(client, "demo-backup", role="agent")) == 58
    assert len(calls(client, "demo-backup", model="muse-wonder-1.0")) == 1
    assert calls(client, "demo-backup", status="cancelled") == []
    assert len(calls(client, "demo-backup", purpose="verification")) == 11


def test_the_muse_meter_sums_the_log(client: TestClient) -> None:
    meter = client.get("/api/runs/demo-backup/models").json()
    totals = meter["totals"]
    assert totals["calls"] == totals["completed"] == 79 and totals["cancelled"] == 0
    assert totals["input_tokens"] == 198719 and totals["cached_tokens"] == 120350
    assert totals["output_tokens"] == 80448 and totals["reasoning_tokens"] == 52501
    assert totals["cost_usd"] == pytest.approx(0.49476705) and totals["estimated_cost_usd"] == 0
    assert totals["cache_hit_share"] == pytest.approx(120350 / 198719)
    assert totals["coordination_tokens"] == 0 and totals["recovery_tokens"] == 0
    assert totals["lost_to_cancellation"] == {"calls": 0, "cost_usd": 0, "tokens": 0}
    by_model = {item["model"]: item for item in meter["models"]}
    wonder, spark = by_model["muse-wonder-1.0"], by_model["muse-spark-1.3"]
    assert (wonder["badge"], wonder["calls"]) == ("wonder", 1)
    assert wonder["cost_usd"] == pytest.approx(0.0470712) and wonder["output_tokens"] == 2333
    assert (spark["badge"], spark["calls"]) == ("spark", 78)
    assert spark["cost_usd"] == pytest.approx(0.44769585) and spark["cached_tokens"] == 118314
    assert spark["share_of_cost"] == pytest.approx(0.44769585 / 0.49476705)
    by_role = {item["role"]: item for item in meter["by_role"]}
    assert by_role["agent"]["cost_usd"] == pytest.approx(0.3010019)
    assert by_role["agent"]["input_tokens"] == 170647 and by_role["agent"]["purpose"] == "work"
    assert by_role["judge"]["reasoning_tokens"] == 9881
    assert by_role["root_planner"]["efforts"] == {"high": 1}


def test_the_meter_agrees_with_the_bench_scoring(client: TestClient) -> None:
    metrics = score_run(DEMO / "backup")
    totals = client.get("/api/runs/demo-backup/models").json()["totals"]
    assert totals["cost_usd"] == pytest.approx(metrics.cost_usd)
    assert totals["input_tokens"] == metrics.input_tokens
    assert totals["output_tokens"] == metrics.output_tokens
    assert totals["coordination_tokens"] == metrics.coordination_tokens == 0


def test_the_root_planner_detail_shows_prompt_output_and_decision(client: TestClient) -> None:
    call = detail(client, "demo-backup", "eff-408.1")
    prompt = call["prompt"]
    assert prompt["instructions"].startswith("You are the root planner of FractalSwarm")
    assert prompt["text"].startswith("GOAL\nBuild the two-day program")
    assert sorted(prompt["data"]) == ["conference"] and sorted(prompt["untrusted"]) == [
        "submissions"
    ]
    assert len(prompt["untrusted"]["submissions"]) == 48 and prompt["turns"] == []
    assert prompt["schema"] == "t2_root_plan" and prompt["tools"] == []

    output = call["output"]
    assert len(output["parsed"]["tracks"]) == 3 and output["tool_calls"] == []
    assert [item["type"] for item in output["items"]] == ["reasoning", "message"]
    assert output["items"][0]["encrypted"] and "encrypted_content" not in json.dumps(call)

    decision = call["decision"]
    assert [event["seq"] for event in decision["events"]] == list(range(1645, 1654))
    assert [event["type"] for event in decision["events"]] == [
        "budget.settled",
        "plan.proposed",
        "plan.approved",
        "ownership.assigned",
        "ownership.assigned",
        "ownership.assigned",
        "msg.sent",
        "msg.sent",
        "msg.sent",
    ]
    assert [event["bookkeeping"] for event in decision["events"]] == [True] + [False] * 8
    assert decision["events"][1]["summary"] == "o0 proposed a plan for root with 3 subgoals"
    assert [event["summary"] for event in decision["events"][3:]] == [
        "o2 now owns track-ai (group o0)",
        "o1 now owns track-data (group o0)",
        "o3 now owns track-hci (group o0)",
        "o0 assigned a goal to o2",
        "o0 assigned a goal to o1",
        "o0 assigned a goal to o3",
    ]
    assert [s["field"] for s in decision["sentences"]][:2] == ["feasibility", "limitations[0]"]
    assert decision["sentences"][0]["text"].startswith("Balanced and prima facie feasible")


def test_the_detail_has_the_attempts_of_the_cassette_and_the_cost_split(client: TestClient) -> None:
    call = detail(client, "demo-backup", "eff-408.1")
    assert call["attempt_log"] == [
        {"status": 200, "latency_ms": 14612, "error": None, "retry_after_ms": None}
    ]
    split = call["cost_breakdown"]
    assert split["input_usd"] == pytest.approx(1 * 4.0 / 1e6)
    assert split["cached_input_usd"] == pytest.approx(2036 * 0.2 / 1e6)
    assert split["output_usd"] == pytest.approx(2333 * 20.0 / 1e6)
    assert split["reasoning_usd"] == pytest.approx(1685 * 20.0 / 1e6)
    paid = split["input_usd"] + split["cached_input_usd"] + split["output_usd"]
    assert paid == pytest.approx(call["cost_usd"])


def test_an_extraction_call_pairs_each_fact_with_its_source_sentence(client: TestClient) -> None:
    call = detail(client, "demo-backup", "eff-3895.0")
    facts = {fact["key"]: fact for fact in call["facts"]}
    assert len(facts) == 8 and {fact["via"] for fact in facts.values()} == {"publish"}
    sources = call["sources"]

    def sentences(key: str) -> dict[str, str]:
        found = {}
        for evidence in facts[key]["evidence"]:
            text = sources[evidence["source_id"]]["text"]
            assert text[evidence["start"] : evidence["end"]] == evidence["text"]
            found[evidence["field"]] = evidence["text"]
        return found

    assert sentences("speaker:S12:availability") == {
        "available": "My train arrives late on day 2, so nothing before 10:30 that day "
        "(the other day is fine).",
        "preference": "No preference on the time otherwise.",
    }
    assert sentences("speaker:S22:availability")["available"] == (
        "On day 1 I have to leave by 12:00; the other day is fully open."
    )
    assert sentences("speaker:S13:availability") == {
        "available": "I can only attend on day 2.",
        "preference": "If you can, put me in the afternoon.",
    }
    assert sentences("speaker:S32:availability") == {
        "available": "Any slot on either day works for me.",
        "preference": "If possible I'd prefer a morning slot.",
    }
    assert facts["speaker:S12:availability"]["reading"] == (
        "day 1: all day; day 2: 10:30-17:00; no time preference"
    )
    assert facts["speaker:S22:availability"]["reading"] == (
        "day 1: 09:00-12:00; day 2: all day; no time preference"
    )
    assert facts["speaker:S13:availability"]["reading"] == (
        "day 1: not free; day 2: all day; prefers afternoon"
    )
    assert facts["speaker:S12:availability"]["sources"] == ["E12"]
    assert sources["E12"]["kind"] == "email" and sources["E12"]["speaker_id"] == "S12"
    assert all(not fact["unmatched"] for fact in facts.values())


def test_the_final_answer_of_an_extraction_lists_attendance_facts_too(client: TestClient) -> None:
    call = detail(client, "demo-backup", "eff-4781.0")
    facts = {fact["key"]: fact for fact in call["facts"]}
    assert {fact["via"] for fact in facts.values()} == {"answer"}
    assert len([k for k in facts if k.startswith("speaker:")]) == 8
    t03 = facts["talk:T03:attendance"]
    assert t03["value"] == {"expected_attendance": 146} and t03["reading"] == "about 146 attendees"
    (evidence,) = t03["evidence"]
    assert evidence["text"] == "Organizers of past editions told us to plan for around 146 people."
    assert call["sources"]["T03"]["kind"] == "abstract"
    assert call["sources"]["T03"]["text"][evidence["start"] : evidence["end"]] == evidence["text"]
    assert facts["talk:T34:attendance"]["evidence"][0]["text"] == (
        "Expected audience: about 73 participants."
    )


def test_a_tool_step_of_an_extraction_has_no_facts_and_a_judge_none(client: TestClient) -> None:
    search = detail(client, "demo-backup", "eff-3707.0")
    assert search["facts"] == [] and search["output"]["tool_calls"][0]["name"] == "memory.search"
    assert search["decision"]["sentences"][0]["field"] == "message"
    judge = detail(client, "demo-backup", "eff-5840.1")
    assert judge["facts"] is None and judge["sources"] is None
    verdict = next(e for e in judge["decision"]["events"] if e["type"] == "verify.judged")
    assert verdict["payload"]["verdict"] in ("pass", "fail")
    reasons = judge["output"]["parsed"]["reasons"]
    assert [s["field"] for s in judge["decision"]["sentences"]] == [
        f"reasons[{i}]" for i in range(len(reasons))
    ]
    assert [s["text"] for s in judge["decision"]["sentences"]] == reasons
    assert judge["prompt"]["untrusted"]["agent_output"]


def test_a_later_agent_turn_keeps_the_conversation_without_the_encrypted_blobs(client) -> None:
    call = detail(client, "demo-backup", "eff-3895.0")
    kinds = [turn["type"] for turn in call["prompt"]["turns"]]
    assert kinds == ["reasoning", "message", "function_call", "function_call_output"]
    assert call["prompt"]["turns"][2]["name"] == "memory.search"
    assert isinstance(call["prompt"]["turns"][3]["output"], dict)
    assert call["prompt"]["tools"] == ["memory.search", "memory.publish_fact"]


def test_unknown_runs_and_calls_are_404(client: TestClient) -> None:
    assert client.get("/api/runs/nope/calls").status_code == 404
    assert client.get("/api/runs/nope/models").status_code == 404
    missing = client.get("/api/runs/demo-backup/calls/eff-nope")
    assert missing.status_code == 404 and "eff-nope" in missing.json()["error"]


def test_the_toy_bundle_works_too(client: TestClient) -> None:
    rows = calls(client, "demo-toy")
    assert len(rows) == 5 and {row["model"] for row in rows} == {"muse-spark-1.3"}
    meter = client.get("/api/runs/demo-toy/models").json()
    assert meter["totals"]["calls"] == 5
    assert meter["totals"]["cost_usd"] == pytest.approx(0.00101375)


# -- a fake run with kills and the Contributor mode ---------------------------------------------


def test_every_fake_call_is_listed_with_its_routing(client: TestClient, fake_run: Path) -> None:
    log = load_events(fake_run)
    started = [e for e in log if e.type == "effect.started" and e.payload["kind"] == "llm"]
    rows = calls(client, fake_run.name)
    assert [row["effect_id"] for row in rows] == [e.payload["effect_id"] for e in started]
    routed = {e.payload["request_id"]: e.payload for e in log if e.type == "security.routed"}
    assert len(routed) == len(rows)
    for row in rows:
        assert row["routing"]["contributor"] == routed[row["effect_id"]]["contributor"]
        assert row["model"].endswith(CONTRIBUTOR_SUFFIX) == row["routing"]["contributor"]
        assert row["badge"] == (
            "contributor" if row["routing"]["contributor"] else badge(row["model"])
        )
        assert row["routing"]["reason"]
    assert {row["badge"] for row in rows} >= {"contributor", "wonder"}
    flagged = [row for row in rows if row["routing"]["findings"]]
    assert flagged and not any(row["routing"]["contributor"] for row in flagged)


def cancelled_ids(run: Path) -> set[str]:
    return {
        e.payload["effect_id"]
        for e in load_events(run)
        if e.type == "effect.cancelled" and e.payload["kind"] == "llm"
    }


def test_killed_calls_say_why_they_never_completed(client: TestClient, fake_run: Path) -> None:
    rows = calls(client, fake_run.name, status="cancelled")
    assert {row["effect_id"] for row in rows} == cancelled_ids(fake_run) and rows
    victims = {e.payload["target"] for e in load_events(fake_run) if e.type == "chaos.injected"}
    for row in rows:
        cancel = row["cancel"]
        assert cancel["kind"] == "actor_stopped" and cancel["reason"] == "chaos"
        assert cancel["fault"] in ("kill_agent", "kill_coordinator") and row["actor"] in victims
        assert cancel["detail"] == f"{row['actor']} was killed by chaos ({cancel['fault']})"
        assert row["estimated"] and row["ended_ts"] == cancel["ts_virtual"]
        assert row["usage"]["cached_tokens"] == 0 and row["usage"]["input_tokens"] > 0
    one = detail(client, fake_run.name, rows[0]["effect_id"])
    assert one["decision"] == {"events": [], "sentences": []} and one["cost_breakdown"] is None
    assert one["output"]["text"] == "" and one["status"] == "cancelled"


def test_the_central_baseline_loses_its_own_calls_with_its_coordinator(client, central_run) -> None:
    rows = calls(client, central_run.name, status="cancelled")
    assert {row["effect_id"] for row in rows} == cancelled_ids(central_run) and rows
    own = [row for row in rows if row["actor"] == "o0"]
    assert own and {row["cancel"]["kind"] for row in own} == {"coordinator_crash"}
    assert {row["role"] for row in own} <= {"sub_planner", "judge", "root_planner"}
    assert {row["cancel"]["detail"] for row in own} == {"o0 crashed and lost this call in flight"}
    workers = [row for row in rows if row["actor"] != "o0"]
    for row in workers:  # its workers die with it: the baseline stops its whole process tree
        assert row["cancel"]["kind"] == "actor_stopped" and row["cancel"]["reason"] == "crash"
        assert row["cancel"]["detail"] == f"{row['actor']} was stopped when its coordinator crashed"
    totals = client.get(f"/api/runs/{central_run.name}/models").json()["totals"]
    assert totals["lost_to_cancellation"]["calls"] == len(rows)
    assert totals["lost_to_cancellation"]["cost_usd"] > 0


def test_the_fake_meter_matches_the_bench_and_counts_the_lost_calls(client, fake_run) -> None:
    metrics = score_run(fake_run)
    meter = client.get(f"/api/runs/{fake_run.name}/models").json()
    totals = meter["totals"]
    assert totals["cost_usd"] == pytest.approx(metrics.cost_usd)
    assert totals["input_tokens"] == metrics.input_tokens
    assert totals["output_tokens"] == metrics.output_tokens
    assert totals["calls"] == metrics.llm_calls
    assert totals["cancelled"] == metrics.cancelled_llm_calls > 0
    assert totals["coordination_tokens"] == metrics.coordination_tokens == 0
    assert totals["recovery_tokens"] == 0
    lost = totals["lost_to_cancellation"]
    assert lost["calls"] == totals["cancelled"] and lost["cost_usd"] == pytest.approx(
        totals["estimated_cost_usd"]
    )
    models = {item["model"]: item for item in meter["models"]}
    assert models["muse-wonder-1.0"]["calls"] == 1
    assert any(name.endswith(CONTRIBUTOR_SUFFIX) for name in models)
    assert sum(item["cost_usd"] for item in meter["models"]) == pytest.approx(totals["cost_usd"])


def test_every_fake_attempt_log_matches_the_attempts_of_the_result(client, fake_run) -> None:
    rows = [row for row in calls(client, fake_run.name) if row["status"] == "ok"]
    retried = [row for row in rows if row["attempts"] > 1]
    assert retried  # the C3 profile fails some requests, and the client retries them
    for row in [*rows[:10], *retried]:
        one = detail(client, fake_run.name, row["effect_id"])
        assert len(one["attempt_log"]) == one["attempts"] == row["attempts"]
        assert one["attempt_log"][-1]["status"] == 200
        assert all(a["status"] in (0, 429, 500, 503) for a in one["attempt_log"][:-1])
        assert one["reported_model"] == row["model"]
        assert one["latency_ms"] >= sum(a["latency_ms"] for a in one["attempt_log"])


def test_coordination_and_recovery_tokens_come_from_roles_and_tags(tmp_path: Path) -> None:
    """The meter reads 0 on the swarm because no call has such a role or tag, not because it
    says so: give one call each and the tokens show."""
    table = RoleTable.load()
    table.roles["recovery"] = table.roles["judge"]
    found = {}
    for role in ("supervisor", "recovery", "judge"):
        run_dir = tmp_path / role
        asyncio.run(
            record_run(
                "one-call",
                run_id=role,
                run_dir=run_dir,
                backend=FakeBackend(),
                params={"role": role},
                roles=table,
            )
        )
        found[role] = run_dir
    other = TestClient(create_app(tmp_path, tmp_path / "none", tmp_path / "bench", Path("none")))
    totals = {role: other.get(f"/api/runs/{role}/models").json()["totals"] for role in found}
    (row,) = other.get("/api/runs/supervisor/calls").json()["calls"]
    tokens = row["usage"]["input_tokens"] + row["usage"]["output_tokens"]
    assert tokens > 0 and row["purpose"] == "coordination"
    assert totals["supervisor"]["coordination_tokens"] == tokens
    assert totals["supervisor"]["recovery_tokens"] == 0
    assert (
        totals["recovery"]["recovery_tokens"] > 0 and totals["recovery"]["coordination_tokens"] > 0
    )
    assert totals["judge"]["coordination_tokens"] == totals["judge"]["recovery_tokens"] == 0
    for role in found:
        assert totals[role]["coordination_tokens"] == score_run(found[role]).coordination_tokens


# -- pure helpers ---------------------------------------------------------------------------------


def test_sentences_split_on_line_breaks_and_stops() -> None:
    text = "Hello!\nI can only attend on day 2.  Cheers, Ana\nAround 12.5 people (maybe)."
    assert [text[a:b] for a, b in sentence_spans(text)] == [
        "Hello!",
        "I can only attend on day 2.",
        "Cheers, Ana",
        "Around 12.5 people (maybe).",
    ]
    assert sentence_spans("") == [] and sentence_spans("\n\n") == []


def test_the_best_sentence_is_the_first_of_the_highest_score() -> None:
    import re

    text = "Afternoons are great.\nMornings are bad.\nNo mornings, no mornings."
    cues = [(re.compile(r"\bmornings?\b"), 3)]
    start, end, score = best_sentence(text, cues)
    assert text[start:end] == "Mornings are bad." and score == 3
    assert best_sentence(text, [(re.compile(r"\bevenings\b"), 3)]) is None


def test_prompts_split_into_free_text_data_and_untrusted_blocks() -> None:
    text = (
        "CONTRACT g/c (attempt 1)\nKind: extract\n\n<<<DATA days\n[1,2]\nEND DATA days>>>\n\n"
        '<<<UNTRUSTED emails\n[{"id":"E1"}]\nEND UNTRUSTED emails>>>\n\n'
        "<<<DATA odd\nnot json\nEND DATA odd>>>"
    )
    split = split_prompt(text)
    assert split["text"] == "CONTRACT g/c (attempt 1)\nKind: extract"
    assert split["data"] == {"days": [1, 2], "odd": "not json"}
    assert split["untrusted"] == {"emails": [{"id": "E1"}]}
    assert call_ref("c-0a1b:3", text) == {
        "kind": "agent",
        "goal_id": "g",
        "contract_id": "c",
        "contract_kind": "extract",
        "attempt": 1,
        "step": 3,
    }
    assert call_ref("judge|g|c|2", "") == {
        "kind": "judge",
        "goal_id": "g",
        "contract_id": "c",
        "attempt": 2,
    }
    assert call_ref("arbitrate|speaker:S1:availability|0", "")["kind"] == "arbitrate"
    assert call_ref(None, "") == {"kind": None}


def test_rationale_collects_the_reasons_a_model_wrote() -> None:
    answer = {
        "verdict": "fail",
        "reasons": ["T03 overlaps T14", ""],
        "sessions": [{"day": 1, "notes": "balanced"}, {"day": 2, "notes": "  "}],
        "feasibility": "tight but possible",
    }
    assert rationale(answer) == [
        {"field": "feasibility", "text": "tight but possible"},
        {"field": "reasons[0]", "text": "T03 overlaps T14"},
        {"field": "sessions[0].notes", "text": "balanced"},
    ]
    assert rationale(None) == [] and rationale("text") == []


def facts_prompt(email: str) -> dict:
    return {
        "data": {
            "days": [1, 2],
            "slots": [
                {"index": i, "start": f"{9 + i}:00", "end": f"{10 + i}:00"} for i in range(4)
            ],
        },
        "untrusted": {"emails": [{"id": "E1", "speaker_id": "S1", "body": email}], "abstracts": []},
    }


def publish(value: dict) -> dict:
    arguments = {"key": "speaker:S1:availability", "subject": "S1", "sources": ["E1"]}
    arguments["value_json"] = json.dumps(value)
    return {"tool_calls": [{"name": "memory.publish_fact", "arguments": arguments}]}


def test_a_fact_with_no_matching_sentence_says_so() -> None:
    value = {
        "available": [{"day": 1, "slots": [0, 1, 2, 3]}, {"day": 2, "slots": [0, 1, 2, 3]}],
        "preference": "morning",
    }
    facts = Facts(facts_prompt("Hi,\nSee you there.\nBest, Ana"), publish(value)).build()
    (fact,) = facts
    assert fact["evidence"] == [] and fact["unmatched"] == ["available", "preference"]
    assert fact["reading"] == "day 1: all day; day 2: all day; prefers morning"


def test_a_reused_fact_is_listed_without_evidence() -> None:
    answer = {
        "parsed": {
            "speakers": [{"speaker_id": "S1", "available": [], "preference": "none"}],
            "talks": [],
            "reused_fact_keys": ["speaker:S1:availability"],
        },
        "tool_calls": [],
    }
    (fact,) = Facts(facts_prompt("Any slot works for me."), answer).build()
    assert fact["reused"] and fact["via"] == "answer" and fact["evidence"] == []
    assert fact["reading"] == "day 1: not free; day 2: not free; no time preference"


def test_evidence_offsets_count_utf16_units_as_a_browser_slices() -> None:
    email = "😅 Hi!\nI can only attend on day 2.\nBest"
    value = {"available": [{"day": 2, "slots": [0, 1, 2, 3]}], "preference": "none"}
    (fact,) = Facts(facts_prompt(email), publish(value)).build()
    (found,) = [item for item in fact["evidence"] if item["field"] == "available"]
    assert found["text"] == "I can only attend on day 2."
    assert found["start"] == email.index("I can") + 1  # the emoji is one code point, two units
    units = email.encode("utf-16-le")
    assert units[2 * found["start"] : 2 * found["end"]].decode("utf-16-le") == found["text"]
    assert utf16_offset("a😅b", 2) == 3 and utf16_offset("abc", 2) == 2 and utf16_offset("", 0) == 0
