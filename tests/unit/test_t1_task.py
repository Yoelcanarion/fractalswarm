"""T1 for the engine: planning parsers, deterministic checks, the F1 report, the fake's reading
of the documents, the fixtures and the TaskSpec."""

import json
import random
from pathlib import Path
from typing import get_args

import pytest

from fractalswarm.actors.swarm import expected_contracts
from fractalswarm.bench.tasks.t1_extraction import (
    FIELDS,
    MIN_F1,
    generate,
    load_fixture,
    make_checker,
    score,
)
from fractalswarm.bench.tasks.t1_extraction.fake import mentions_in, newest
from fractalswarm.bench.tasks.t1_extraction.task import (
    CONTRACT_KINDS,
    T1,
    FieldName,
    company_of,
    table_of,
)
from fractalswarm.bench.tasks.t2_conference.generator import generate as generate_t2
from fractalswarm.bench.workflows import bench_script
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.verify.checks import run_checks

REPO = Path(__file__).resolve().parents[2]
SPEC = REPO / "tasks" / "examples" / "t1-extraction.yaml"


def goal(seed: int = 1) -> dict:
    instance = generate(seed)
    corpus = instance.model_dump(include={"seed", "fields", "companies", "docs"})
    corpus |= {"groups": 3, "batches": 2}
    return {"id": "root", "goal": "extract", "corpus": corpus, "truth": instance.truth}


def tree(seed: int = 1) -> tuple[dict, list[dict], list[dict]]:
    """(root goal, its three group goals, their six session goals), by the fallback plans."""
    root = goal(seed)
    groups = T1.root_children(root, T1.root_fallback(root))
    sessions = [s for g in groups for s in T1.split_children(g, T1.split_fallback(g))]
    return root, groups, sessions


# -- the task's shape -------------------------------------------------------------------------


def test_the_field_names_of_the_output_schemas_are_the_generators() -> None:
    assert get_args(FieldName) == FIELDS


def test_the_tree_has_three_groups_and_six_sessions_that_split_the_companies() -> None:
    root, groups, sessions = tree()
    assert [g["id"] for g in groups] == ["g1", "g2", "g3"]
    assert [s["id"] for s in sessions] == [f"g{g}/b{b}" for g in (1, 2, 3) for b in (1, 2)]
    companies = sorted(c for s in sessions for c in s["companies"])
    assert companies == sorted(root["corpus"]["companies"])
    docs = sorted(d["id"] for s in sessions for d in s["data"]["docs"])
    assert docs == sorted(d["id"] for d in root["corpus"]["docs"])  # every document, once
    assert T1.sessions(root["corpus"]) == 6
    assert expected_contracts("t1_extraction", root["corpus"]) == 18


def test_t2_still_has_eighteen_contracts_for_the_chaos_clock() -> None:
    corpus, _ = generate_t2(1)
    assert expected_contracts("t2_conference", corpus) == 18


def test_a_session_prompt_carries_its_documents_as_untrusted_and_never_the_truth() -> None:
    _, _, sessions = tree()
    session = sessions[0]
    contract = T1.contracts(session, T1.contracts_fallback(session), "o", "scope")[0]
    inputs = T1.contract_inputs(session, contract, {})
    assert list(inputs["untrusted"]) == ["documents"]
    assert len(inputs["untrusted"]["documents"]) == len(session["data"]["docs"])
    assert "truth" not in json.dumps(inputs) and "doc_facts" not in json.dumps(inputs)
    assert set(session) == {"id", "priority", "group", "batch", "companies", "data"}


# -- planning parsers -------------------------------------------------------------------------


def test_the_fallback_plans_pass_their_own_parsers() -> None:
    root, groups, sessions = tree()
    plan, errors = T1.root_parse(root, json.dumps(T1.root_fallback(root)))
    assert errors == [] and plan == T1.root_fallback(root)
    for group in groups:
        assert T1.split_parse(group, json.dumps(T1.split_fallback(group)))[1] == []
    for session in sessions:
        assert T1.contracts_parse(session, json.dumps(T1.contracts_fallback(session)))[1] == []


def test_the_root_plan_must_cover_every_company_once_in_g1_to_g3() -> None:
    root = goal()
    plan = T1.root_fallback(root)

    def errors_of(change) -> str:
        edited = json.loads(json.dumps(plan))
        change(edited)
        parsed, errors = T1.root_parse(root, json.dumps(edited))
        assert parsed is None
        return " ".join(errors)

    moved = plan["groups"][0]["companies"][0]
    assert "no group" in errors_of(lambda p: p["groups"][0]["companies"].remove(moved))
    assert "several groups" in errors_of(lambda p: p["groups"][1]["companies"].append(moved))
    assert "several groups" in errors_of(lambda p: p["groups"][1]["companies"].append("Ghost Inc"))
    assert "ids" in errors_of(lambda p: p["groups"][0].update(group_id="north"))
    assert "at least 2" in errors_of(
        lambda p: (p["groups"][1]["companies"].append(moved), p["groups"][0].update(companies=[]))
    )
    assert T1.root_parse(root, "not json")[0] is None


def test_the_group_plan_must_partition_its_companies_into_numbered_batches() -> None:
    _, groups, _ = tree()
    group = groups[0]
    plan = T1.split_fallback(group)
    assert sorted(c for b in plan["batches"] for c in b["companies"]) == sorted(group["companies"])
    swapped = {"batches": [plan["batches"][0] | {"batch": 2}, plan["batches"][1] | {"batch": 2}]}
    assert "numbered 1 to 2" in " ".join(T1.split_parse(group, json.dumps(swapped))[1])
    lost = {"batches": [plan["batches"][0], plan["batches"][1] | {"companies": []}]}
    errors = " ".join(T1.split_parse(group, json.dumps(lost))[1])
    assert "partition" in errors and "empty" in errors


def test_the_session_plan_needs_extract_resolve_report_in_a_chain() -> None:
    _, _, sessions = tree()
    plan = T1.contracts_fallback(sessions[0])
    resolve = next(c for c in plan["contracts"] if c["kind"] == "resolve")
    resolve["depends_on"] = []
    assert "resolve must depend on extract" in " ".join(
        T1.contracts_parse(sessions[0], json.dumps(plan))[1]
    )
    plan["contracts"].pop()
    assert "exactly three" in " ".join(T1.contracts_parse(sessions[0], json.dumps(plan))[1])


def test_contracts_carry_the_checks_the_tools_and_the_judge() -> None:
    _, _, sessions = tree()
    made = {
        c.kind: c for c in T1.contracts(sessions[0], T1.contracts_fallback(sessions[0]), "o", "s")
    }
    assert made["extract"].acceptance.checks == ["schema:t1_extract", "t1.mentions"]
    assert made["resolve"].acceptance.checks == ["schema:t1_resolve", "t1.records"]
    assert made["resolve"].critical_path and T1.needs_judge(made["resolve"])
    assert not T1.needs_judge(made["extract"]) and not T1.needs_judge(made["report"])
    assert made["extract"].tools == [] and made["report"].tools == ["workspace.write"]
    assert all(T1.bookings(sessions[0], c, {}) == [] for c in made.values())
    assert set(CONTRACT_KINDS) == set(made)


# -- the fake reads the documents, not the truth ----------------------------------------------


@pytest.mark.parametrize("seed", range(1, 6))
def test_the_fake_extracts_exactly_what_each_document_states(seed: int) -> None:
    instance = generate(seed)
    for doc in instance.docs:
        company, stated = instance.doc_facts[doc.id]
        mentions = mentions_in(doc.model_dump())
        assert {m["company"] for m in mentions} == {company}  # never a rival
        assert {(m["field"], m["value"]) for m in mentions} == set(stated.items())


@pytest.mark.parametrize("seed", range(1, 6))
def test_newer_wins_over_the_fakes_mentions_is_the_truth(seed: int) -> None:
    instance = generate(seed)
    mentions = [m for doc in instance.docs for m in mentions_in(doc.model_dump())]
    dates = {doc.id: doc.date for doc in instance.docs}
    records = newest(mentions, dates)
    assert score(table_of(records), instance.truth).f1 == 1.0
    oldest = {
        (m["company"], m["field"]): m
        for m in sorted(mentions, key=lambda m: dates[m["doc_id"]], reverse=True)
    }
    assert score(table_of(list(oldest.values())), instance.truth).f1 < MIN_F1


def test_each_planning_request_gets_its_own_scripted_answer() -> None:
    root, groups, sessions = tree()
    cases = [
        (T1.root_request(root, []), T1.root_parse, root),
        (T1.split_request(groups[0], []), T1.split_parse, groups[0]),
        (T1.contracts_request(sessions[0], []), T1.contracts_parse, sessions[0]),
    ]
    for request, parse, parent in cases:
        body = {"text": {"format": request["text_format"]}, "input": request["input"]}
        plan, errors = parse(parent, bench_script(body, 0))
        assert errors == [] and plan is not None


# -- deterministic checks (spec §11) ----------------------------------------------------------


def contexts() -> tuple[dict, dict, dict, list[dict]]:
    """(session goal, its check context, its extract output, its resolve output)."""
    _, _, sessions = tree()
    session = sessions[0]
    context = T1.check_context(session)
    mentions = [m for doc in session["data"]["docs"] for m in mentions_in(doc)]
    dates = {d["id"]: d["date"] for d in session["data"]["docs"]}
    return session, context, {"mentions": mentions}, {"records": newest(mentions, dates)}


def test_a_faithful_extraction_and_resolution_pass_their_checks() -> None:
    session, context, extracted, resolved = contexts()
    contract = {c.kind: c for c in T1.contracts(session, T1.contracts_fallback(session), "o", "s")}
    assert run_checks(contract["extract"].acceptance.checks, extracted, context) == []
    assert run_checks(contract["resolve"].acceptance.checks, resolved, context) == []


def test_extract_rejects_a_fact_of_a_rival_an_unknown_document_and_gaps() -> None:
    session, context, extracted, _ = contexts()
    first, other = session["companies"][0], "Somebody Else"
    mentions = [dict(m) for m in extracted["mentions"]]
    rival = next(m for m in mentions if m["company"] == first)
    rival["company"] = other  # the sentence was about a rival: attributed to another company
    mentions.append(mentions[0] | {"doc_id": "doc-99"})
    failures = " | ".join(run_checks(["t1.mentions"], {"mentions": mentions}, context))
    assert f"{rival['doc_id']} is about {first}, not {other}" in failures
    assert "doc-99 is not a document of this session" in failures

    slot = (first, "ticker")  # every document that states it, left out: nothing covers the slot
    gap = [m for m in extracted["mentions"] if (m["company"], m["field"]) != slot]
    assert len(gap) < len(extracted["mentions"])
    failures = run_checks(["t1.mentions"], {"mentions": gap}, context)
    assert failures == [f"no document mentions {first}.ticker"]


def test_formats_are_checked_on_the_numbers_and_the_length_of_every_value() -> None:
    _, context, extracted, resolved = contexts()
    bad = [dict(m) for m in extracted["mentions"]]
    year = next(m for m in bad if m["field"] == "founded_year")
    ticker = next(m for m in bad if m["field"] == "ticker")
    employees = next(m for m in bad if m["field"] == "employees")
    year["value"], ticker["value"], employees["value"] = "last year", "AC-1", "n/a"
    failures = run_checks(["t1.mentions"], {"mentions": bad}, context)
    for slot in (year, ticker, employees):
        assert any(
            f"{slot['company']}.{slot['field']}" in f and "well-formed" in f for f in failures
        )
    long = [dict(m) for m in extracted["mentions"]]
    long[0]["value"] = "x" * 81
    assert any(
        "over 80 characters" in f for f in run_checks(["t1.mentions"], {"mentions": long}, context)
    )


def test_resolve_rejects_gaps_duplicates_and_values_cited_from_another_company() -> None:
    _, context, _, resolved = contexts()
    records = [dict(r) for r in resolved["records"]]
    first = records[0]
    cited = next(r for r in records if r["company"] != first["company"])
    first["doc_id"] = cited["doc_id"]
    records.pop(1)
    records.append(dict(records[2]))
    records.append(records[3] | {"company": "Ghost Inc"})
    failures = " | ".join(run_checks(["t1.records"], {"records": records}, context))
    assert "not a document of" in failures
    assert "no record for" in failures
    assert "more than one record for" in failures
    assert "outside the session" in failures


def test_the_t1_judge_fails_a_value_that_only_an_older_document_states() -> None:
    from fractalswarm.verify.judge import judge_request

    _, _, sessions = tree()
    for session in sessions:  # the first session whose documents contradict each other
        mentions = [m for doc in session["data"]["docs"] for m in mentions_in(doc)]
        values: dict[tuple[str, str], set[str]] = {}
        for m in mentions:
            values.setdefault((m["company"], m["field"]), set()).add(m["value"])
        if any(len(found) > 1 for found in values.values()):
            break
    else:
        pytest.fail("no contradiction in seed 1")
    dates = {d["id"]: d["date"] for d in session["data"]["docs"]}
    contract = {c.kind: c for c in T1.contracts(session, T1.contracts_fallback(session), "o", "s")}[
        "resolve"
    ]
    inputs = T1.contract_inputs(session, contract, {"extract": {"mentions": mentions}})
    contract = contract.model_copy(update={"inputs": inputs})

    def verdict(records: list[dict]) -> dict:
        request = judge_request(contract, {"records": records}, inputs["data"])
        body = {"text": {"format": request["text_format"]}, "input": request["input"]}
        return json.loads(bench_script(body, 0))

    right = newest(mentions, dates)
    assert verdict(right) == {"verdict": "pass", "score": 0.9, "reasons": []}
    oldest = {}
    for m in sorted(mentions, key=lambda m: dates[m["doc_id"]], reverse=True):
        oldest[(m["company"], m["field"])] = m  # the oldest document wins
    stale = verdict(sorted(oldest.values(), key=lambda m: (m["company"], m["field"])))
    assert stale["verdict"] == "fail" and "the newest document says" in stale["reasons"][0]
    gap = verdict(right[1:])
    assert gap["verdict"] == "fail" and "no record for" in gap["reasons"][-1]


# -- the report, and what "valid" means -------------------------------------------------------


def checker_for(instance, table):
    return make_checker(instance.truth, lambda events: table)([])


def wrong(truth: dict, count: int, seed: int = 0) -> dict:
    """A table with ``count`` misread slots: each holds another company's (well-formed) value
    for the same field, the way a rival's sentence misleads a reader."""
    rng = random.Random(seed)
    table = {c: dict(f) for c, f in truth.items()}
    for company, field in rng.sample(sorted((c, f) for c in table for f in table[c]), count):
        rivals = [
            truth[c][field] for c in sorted(truth) if truth[c][field] != truth[company][field]
        ]
        table[company][field] = rng.choice(rivals)
    return table


@pytest.mark.parametrize(
    ("wrong_slots", "valid"), [(0, True), (4, True), (7, True), (9, False), (16, False)]
)
def test_valid_tolerates_a_few_misreads_but_not_many(wrong_slots: int, valid: bool) -> None:
    instance = generate(1)
    outcome = checker_for(instance, wrong(instance.truth, wrong_slots))
    assert outcome.completed and outcome.valid is valid
    assert outcome.score == pytest.approx((80 - wrong_slots) / 80)


def test_valid_rejects_the_oldest_wins_rule_even_though_every_slot_is_filled() -> None:
    instance = generate(1)
    dates = {doc.id: doc.date for doc in instance.docs}
    mentions = [m for doc in instance.docs for m in mentions_in(doc.model_dump())]
    stale = {}
    for mention in sorted(mentions, key=lambda m: dates[m["doc_id"]], reverse=True):
        stale.setdefault(mention["company"], {})[mention["field"]] = mention["value"]
    outcome = checker_for(instance, stale)
    assert outcome.valid is False and outcome.score < 0.85


def test_valid_rejects_a_lost_company_although_its_f1_clears_the_threshold() -> None:
    instance = generate(1)
    table = {c: f for i, (c, f) in enumerate(instance.truth.items()) if i}
    outcome = checker_for(instance, table)
    assert outcome.score == pytest.approx(0.947, abs=1e-3) and outcome.score >= MIN_F1
    assert outcome.valid is False and "8 slots empty" in outcome.detail


def test_valid_rejects_a_malformed_value_even_when_it_is_the_right_slot() -> None:
    instance = generate(1)
    table = {c: dict(f) for c, f in instance.truth.items()}
    company = next(iter(table))
    table[company]["founded_year"] = "long ago"
    outcome = checker_for(instance, table)
    assert outcome.valid is False and f"{company}.founded_year" in outcome.detail


def test_the_final_report_scores_the_table_against_the_truth() -> None:
    root, _, _ = tree()
    instance = generate(1)
    records = [
        {"company": c, "field": f, "value": v, "doc_id": "doc-01"}
        for c, fields in wrong(instance.truth, 3).items()
        for f, v in fields.items()
    ]
    report = T1.final_report(root, {"records": records})
    assert (report["expected"], report["placed"]) == (80, 80)
    assert (report["tp"], report["fp"], report["fn"]) == (77, 3, 3)
    assert report["soft_score"] == pytest.approx(77 / 80, abs=1e-4)
    assert report["hard_violations"] == 0
    assert report["table"] == table_of(records)
    report = T1.final_report(root, {"records": records[:-8]})
    assert report["placed"] == 72 and report["expected"] == 80


# -- safety: the documents are scanned attachments --------------------------------------------


def test_every_document_is_an_attachment_and_quarantine_hides_its_text_and_title() -> None:
    root = goal()
    attachments = T1.attachments(root)
    assert [source for source, _ in attachments] == [d["id"] for d in root["corpus"]["docs"]]
    victim = root["corpus"]["docs"][0]
    assert victim["title"] in attachments[0][1] and victim["text"] in attachments[0][1]
    stubbed = T1.quarantine(root, {victim["id"]: "[quarantined: injection]"})
    doc = stubbed["corpus"]["docs"][0]
    assert doc["text"] == "[quarantined: injection]"
    assert doc["title"] == f"{company_of(victim)}: [quarantined]"
    assert company_of(doc) == company_of(victim)  # still routed to its company's session
    assert stubbed["corpus"]["docs"][1:] == root["corpus"]["docs"][1:]
    assert T1.quarantine(root, {}) is root

    # A title the verdict covered that does not name a company routes nowhere.
    root["corpus"]["companies"] = [
        c for c in root["corpus"]["companies"] if c != company_of(victim)
    ]
    assert (
        T1.quarantine(root, {victim["id"]: "stub"})["corpus"]["docs"][0]["title"] == "[quarantined]"
    )


def test_the_envelope_covers_every_group_session_and_contract_kind() -> None:
    root, _, _ = tree()
    nodes = {n.node_id: n for n in T1.envelope(root, T1.root_fallback(root))}
    assert sorted(nodes) == [
        "contract:extract",
        "contract:report",
        "contract:resolve",
        "group:g1",
        "group:g2",
        "group:g3",
        "session",
    ]
    assert nodes["contract:resolve"].tools == ["memory.publish_fact"]
    assert nodes["contract:report"].writes == [
        f"sessions/g{g}/b{b}/audit.md" for g in (1, 2, 3) for b in (1, 2)
    ]


# -- fixtures and the TaskSpec ----------------------------------------------------------------


@pytest.mark.parametrize("seed", [1, 2])
def test_the_committed_fixture_is_the_generators_instance(seed: int) -> None:
    instance = generate(seed)
    corpus, truth = load_fixture(REPO / "tasks" / "fixtures" / "t1" / f"seed-{seed}")
    assert truth == instance.truth
    assert corpus == json.loads(
        json.dumps(instance.model_dump(include={"seed", "fields", "companies", "docs"}))
    )


def test_run_params_load_the_fixture_and_shape_the_tree_from_the_fanout() -> None:
    spec = TaskSpec.load(SPEC)
    params = run_params(spec)
    assert (params["corpus"]["groups"], params["corpus"]["batches"]) == (3, 2)
    assert params["spec"]["task"] == "t1_extraction"
    assert params["spec"]["inputs"]["fixture"] == "tasks/fixtures/t1/seed-1"  # no machine paths
    assert len(params["corpus"]["docs"]) == 40 and len(params["truth"]) == 10
    assert "truth" not in json.dumps(params["corpus"])
    spec.scaling.fanout = [2, 2, 2]
    with pytest.raises(ValueError, match="depth 2"):
        run_params(spec)


def test_run_params_generate_a_missing_fixture_from_its_seed(tmp_path: Path) -> None:
    spec = TaskSpec.load(SPEC)
    spec.inputs.fixture, spec.inputs.generate_seed = str(tmp_path / "seed-5"), 5
    params = run_params(spec)
    assert (tmp_path / "seed-5" / "docs.json").exists()
    assert params["truth"] == generate(5).truth
    spec.inputs.fixture, spec.inputs.generate_seed = str(tmp_path / "none"), None
    with pytest.raises(FileNotFoundError, match="no T1 fixture"):
        run_params(spec)


@pytest.mark.parametrize(
    ("task", "schemas"),
    [
        (
            "t1_extraction",
            {"t1_root_plan", "t1_group_plan", "t1_session_plan"}
            | {"t1_extract", "t1_resolve", "t1_report", "judge_verdict"},
        ),
        (
            "t2_conference",
            {"t2_root_plan", "t2_track_plan", "t2_session_plan"}
            | {"t2_extract", "t2_place", "t2_blurb", "judge_verdict"},
        ),
    ],
)
def test_each_tasks_preflight_prices_that_tasks_requests(task: str, schemas: set[str]) -> None:
    from fractalswarm.bench.profiles import profile
    from fractalswarm.bench.registry import Cell, get_workflow

    cell = Cell("swarm", task, profile("C3"), "1")
    requests = get_workflow("swarm").preflight(cell, True)
    assert len(requests) == 560 and all(r["contributor"] for r in requests)
    assert {r["text_format"]["name"] for r in requests} == schemas
    if task == "t1_extraction":  # the extract prompts carry the real documents
        prompts = " ".join(
            json.dumps(r["input"]) for r in requests if r["text_format"]["name"] == "t1_extract"
        )
        assert all(doc.title in prompts for doc in generate(1).docs)


def test_a_t2_judge_request_still_reaches_the_t2_script() -> None:
    from fractalswarm.planning.contracts import Contract
    from fractalswarm.verify.judge import judge_request

    contract = Contract(id="place", goal_id="g", kind="place", owner="o", objective="x")
    request = judge_request(contract, {"placements": []}, {"session": {"talk_ids": ["T01"]}})
    body = {"text": {"format": request["text_format"]}, "input": request["input"]}
    assert json.loads(bench_script(body, 0))["verdict"] == "fail"  # T2's judge: T01 is unplaced
