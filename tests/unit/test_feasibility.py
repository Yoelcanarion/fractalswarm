"""The feasibility report at plan approval (spec §12): cost P50/P90 against the budget, the
expected duration, bottlenecks, tools that are not allowed, policy flags, limitations."""

from pathlib import Path
from typing import Any

import pytest

from fractalswarm.bench.tasks.t2_conference.task import T2
from fractalswarm.kernel.events import EVENT_TYPES, Event, validate_payload
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.prices import PriceTable
from fractalswarm.planning import scope as scoping
from fractalswarm.planning.feasibility import (
    MAX_NOTE_CHARS,
    MAX_NOTES,
    FeasibilityReport,
    RunConfigView,
    build,
    prompt_tokens,
    render,
)
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.safety.scope_check import ApprovedNode, ApprovedPlan

REPO = Path(__file__).resolve().parents[2]
# The one real T2 run at C0 (progress notes, Day 9): what the model is fitted to.
REAL = {"cost_usd": 0.454, "calls": 80, "makespan_s": 117.3}


@pytest.fixture(scope="module")
def t2() -> dict[str, Any]:
    spec = TaskSpec.load(REPO / "tasks" / "examples" / "t2-conference.yaml")
    params = run_params(spec)
    goal = {"id": "root", "goal": spec.goal, "corpus": params["corpus"], "truth": params["truth"]}
    plan = T2.root_fallback(goal)
    envelope = scoping.approve(goal["goal"], T2.envelope(goal, plan))
    return {"goal": goal, "plan": plan, "envelope": envelope}


def started(budget: float | None = 2.0) -> Event:
    config = {
        "llm": {
            "roles": RoleTable.load().model_dump(mode="json"),
            "prices": PriceTable.load().model_dump(mode="json"),
        }
    }
    return Event(
        seq=1,
        run_id="r",
        ts_virtual=0,
        lamport=1,
        type="run.started",
        actor="@kernel",
        idem_key="run.started",
        payload={"seed": "1", "scenario": "swarm", "clock": "sim", "config": config}
        | {"run_cap_usd": budget},
        prev_hash="0",
        hash="1",
    )


def config(budget: float | None = 2.0) -> RunConfigView:
    view = RunConfigView()
    view.apply(started(budget))
    return view


def report(t2: dict[str, Any], budget: float | None = 2.0, **change: Any) -> FeasibilityReport:
    args: dict[str, Any] = {
        "fanout": [3, 2],
        "max_steps": 8,
        "max_attempts": 6,
        "contributor": False,
        "audit": False,
        "config": config(budget),
        "scans": {},
    }
    found = build(T2, t2["goal"], t2["plan"], t2["envelope"], **(args | change))
    assert found is not None
    return found


# -- the tables, from the log -------------------------------------------------------------


def test_the_run_config_view_reads_the_tables_and_the_budget_from_run_started() -> None:
    view = RunConfigView()
    assert view.roles is None and view.prices is None and view.budget_usd is None
    view.apply(started(1.5))
    assert view.roles is not None and view.prices is not None and view.budget_usd == 1.5
    assert view.roles.resolve("judge").model.startswith("muse-spark")
    other = Event(
        seq=2,
        run_id="r",
        ts_virtual=0,
        lamport=1,
        type="msg.sent",
        actor="o0",
        idem_key="x",
        payload={"to": "o1", "topic": "t", "body": {}},
        prev_hash="0",
        hash="1",
    )
    view.apply(other)
    assert view.budget_usd == 1.5


def test_a_log_without_the_tables_gets_no_report(t2: dict[str, Any]) -> None:
    kwargs = {"fanout": [3, 2], "max_steps": 8, "max_attempts": 6, "contributor": False}
    kwargs |= {"audit": False, "scans": {}}
    assert build(T2, t2["goal"], t2["plan"], t2["envelope"], config=None, **kwargs) is None
    assert (
        build(T2, t2["goal"], t2["plan"], t2["envelope"], config=RunConfigView(), **kwargs) is None
    )


def test_a_role_the_table_lacks_gets_no_report_instead_of_a_crash(t2: dict[str, Any]) -> None:
    view = config()
    assert view.roles is not None
    del view.roles.roles["judge"]
    kwargs = {"fanout": [3, 2], "max_steps": 8, "max_attempts": 6, "contributor": False}
    assert (
        build(
            T2, t2["goal"], t2["plan"], t2["envelope"], audit=False, scans={}, config=view, **kwargs
        )
        is None
    )


# -- cost -------------------------------------------------------------------------------


def test_the_report_prices_every_stage_of_the_plan(t2: dict[str, Any]) -> None:
    found = report(t2)
    stages = [line.stage for line in found.breakdown]
    assert stages == [
        "root plan",
        "track plans",
        "session plans",
        "agents: blurb",
        "agents: extract",
        "agents: place",
        "judge",
    ]
    assert 0 < found.cost_p50_usd < found.cost_p90_usd
    assert sum(line.p50_usd for line in found.breakdown) == pytest.approx(
        found.cost_p50_usd, abs=1e-5
    )
    assert sum(line.share for line in found.breakdown) == pytest.approx(1.0, abs=2e-3)
    by_stage = {line.stage: line for line in found.breakdown}
    assert by_stage["root plan"].calls == 1 and by_stage["track plans"].calls == 3
    assert by_stage["session plans"].calls == 6
    assert all(line.p90_usd > line.p50_usd for line in found.breakdown)
    # The root planner is Wonder: one call costs more than a Spark planning call.
    assert by_stage["root plan"].p50_usd > by_stage["track plans"].p50_usd / 3


def test_the_estimate_lands_near_the_one_real_run(t2: dict[str, Any]) -> None:
    found = report(t2)
    assert found.cost_p50_usd == pytest.approx(REAL["cost_usd"], rel=0.15)
    assert found.calls_p50 == pytest.approx(REAL["calls"], rel=0.10)
    assert found.duration_p50_s == pytest.approx(REAL["makespan_s"], rel=0.20)
    assert found.cost_p90_usd > REAL["cost_usd"]  # the real run was an ordinary one
    assert found.duration_p90_s > REAL["makespan_s"]


@pytest.mark.parametrize(
    ("budget", "verdict"),
    [(None, "unbudgeted"), (50.0, "fits"), (0.6, "tight"), (0.1, "over")],
)
def test_the_verdict_compares_p50_and_p90_with_the_budget(
    t2: dict[str, Any], budget: float | None, verdict: str
) -> None:
    found = report(t2, budget)
    assert found.verdict == verdict
    assert found.budget_usd == budget
    if budget is None:
        assert found.p50_share is None and found.p90_share is None
    else:
        assert found.p50_share == pytest.approx(found.cost_p50_usd / budget, abs=1e-3)
        assert found.p90_share == pytest.approx(found.cost_p90_usd / budget, abs=1e-3)
        assert (found.p90_share <= 1.0) == (verdict == "fits")


def test_a_longer_prompt_costs_more() -> None:
    short = {"instructions": "x", "input": "y"}
    assert prompt_tokens(short | {"input": "y" * 4000}) > prompt_tokens(short) + 900
    assert prompt_tokens(short | {"tools": [{"name": "t" * 400}]}) > prompt_tokens(short)


def test_the_audit_adds_its_calls_to_the_estimate(t2: dict[str, Any]) -> None:
    off, on = report(t2), report(t2, audit=True)
    audit = next(line for line in on.breakdown if line.stage == "cross-squad audit")
    # Six critical-path contracts are always audited, the other twelve by the 15% draw.
    assert audit.calls == pytest.approx(6 + 12 * 0.15, abs=0.1)
    assert on.cost_p50_usd == pytest.approx(off.cost_p50_usd + audit.p50_usd, abs=1e-5)
    assert on.duration_p50_s > off.duration_p50_s
    assert "cross-squad audit" not in [line.stage for line in off.breakdown]
    assert any("cross-squad audit is on" in flag for flag in on.policy_flags)


# -- duration and bottlenecks -------------------------------------------------------------


def test_the_critical_path_runs_from_the_root_plan_through_one_session(t2: dict[str, Any]) -> None:
    found = report(t2)
    names = [step.split(":")[0] for step in found.critical_path]
    assert names[0] == "root plan" and names[1].startswith("track plan ")
    assert names[2].startswith("session plan ")
    assert [n.split(" of ")[0] for n in names[3:]] == ["extract", "place", "blurb"]
    seconds = [float(step.rsplit(": ", 1)[1].removesuffix(" s")) for step in found.critical_path]
    assert sum(seconds) == pytest.approx(found.duration_p50_s, abs=0.6)
    assert found.duration_p90_s > found.duration_p50_s


def test_the_bottlenecks_name_the_root_plan_and_the_dearest_stage(t2: dict[str, Any]) -> None:
    found = report(t2)
    assert "root plan" in found.bottlenecks[0] and "critical path" in found.bottlenecks[0]
    top = max(found.breakdown, key=lambda line: line.p50_usd)
    assert any(top.stage in text and f"{top.share:.0%}" in text for text in found.bottlenecks)


def test_an_uneven_track_is_a_bottleneck(t2: dict[str, Any]) -> None:
    plan = {**t2["plan"], "tracks": [dict(track) for track in t2["plan"]["tracks"]]}
    big, small = plan["tracks"][0], plan["tracks"][1]
    moved = small["talk_ids"][:4]
    big["talk_ids"] = [*big["talk_ids"], *moved]
    small["talk_ids"] = small["talk_ids"][4:]
    found = report({**t2, "plan": plan})
    assert any(
        f"Track {big['track_id']} has {len(big['talk_ids'])} talks" in text
        and "finishes last" in text
        for text in found.bottlenecks
    )


def test_more_sessions_than_owners_queue_up(t2: dict[str, Any]) -> None:
    found = report(t2, fanout=[3, 1])
    assert any("more sessions than session owners" in text for text in found.bottlenecks)
    assert found.duration_p50_s > report(t2).duration_p50_s
    assert any("one wave after another" in step for step in found.critical_path)


# -- tools, policy flags, limitations -----------------------------------------------------


def test_the_tools_of_the_t2_contracts_are_all_allowed(t2: dict[str, Any]) -> None:
    found = report(t2)
    assert found.tools_requested == {
        "blurb": ["workspace.write"],
        "extract": ["memory.publish_fact", "memory.search"],
        "place": ["memory.search"],
    }
    assert found.tools_denied == []


def test_a_tool_the_approved_plan_does_not_list_is_not_allowed(t2: dict[str, Any]) -> None:
    nodes = [
        node.model_copy(update={"tools": [t for t in node.tools if t != "memory.publish_fact"]})
        if node.node_id == "contract:extract"
        else node
        for node in t2["envelope"].nodes
        if node.node_id != "contract:blurb"
    ]
    envelope = ApprovedPlan(root_goal=t2["envelope"].root_goal, nodes=nodes)
    found = report({**t2, "envelope": envelope})
    assert found.tools_denied == ["blurb: workspace.write", "extract: memory.publish_fact"]


def test_the_policy_flags_say_what_a_human_should_look_at(t2: dict[str, Any]) -> None:
    quiet = report(t2)
    assert quiet.policy_flags == []
    loud = report(
        t2,
        None,
        contributor=True,
        scans={
            "e2": {"decision": "quarantine", "score": 0.9, "surface": "attachment", "backend": "x"},
            "e1": {"decision": "allow", "score": 0.0, "surface": "attachment", "backend": "x"},
            "e7": {"decision": "block", "score": 1.0, "surface": "attachment", "backend": "x"},
        },
    )
    text = " | ".join(loud.policy_flags)
    assert "No run budget" in text and "Contributor routing is on" in text
    assert "2 attachment(s) were quarantined" in text and "e2, e7" in text
    assert "e1" not in text


def test_a_sensitive_data_category_needs_a_human(t2: dict[str, Any]) -> None:
    node = ApprovedNode(node_id="contract:extra", objective="x", data_categories=["pii.contact"])
    envelope = ApprovedPlan(root_goal="g", nodes=[*t2["envelope"].nodes, node])
    found = report({**t2, "envelope": envelope})
    assert "contract:extra touches pii.contact: it needs a human approval." in found.policy_flags


def test_the_budget_flags(t2: dict[str, Any]) -> None:
    assert "over the budget" in " ".join(report(t2, 0.1).policy_flags)
    assert "not the P90" in " ".join(report(t2, 0.6).policy_flags)


def test_the_limitations_are_stated_and_the_planners_own_are_clipped(t2: dict[str, Any]) -> None:
    plan = {
        **t2["plan"],
        "feasibility": "f" * 900,
        "limitations": [f"l{n}" + "x" * 500 for n in range(20)],
    }
    found = report({**t2, "plan": plan})
    assert len(found.planner_notes) == MAX_NOTES
    assert all(len(note) <= MAX_NOTE_CHARS for note in found.planner_notes)
    assert any("estimates" in text for text in found.limitations)
    assert any("fallback decomposition" in text for text in found.limitations)
    assert any("of at most 6" in text for text in found.limitations)
    empty = report(
        {
            **t2,
            "plan": {
                k: v for k, v in t2["plan"].items() if k not in ("feasibility", "limitations")
            },
        }
    )
    assert empty.planner_notes == []


# -- determinism and the event ------------------------------------------------------------


def test_the_report_is_a_pure_function_of_its_inputs(t2: dict[str, Any]) -> None:
    scans = {"e2": {"decision": "quarantine", "score": 0.9, "surface": "a", "backend": "b"}}
    again = {"e2": dict(scans["e2"])}
    assert report(t2, scans=scans) == report(t2, scans=again)
    assert report(t2).model_dump_json() == report(t2).model_dump_json()


def test_plan_feasibility_is_a_registered_event_that_takes_the_report(t2: dict[str, Any]) -> None:
    assert EVENT_TYPES["plan.feasibility"] is FeasibilityReport
    payload = report(t2).model_dump(mode="json")
    assert validate_payload("plan.feasibility", payload) == payload
    fenced = payload | {"fence": {"member": "o0", "incarnation": 0, "epoch": 1, "resource": "root"}}
    assert validate_payload("plan.feasibility", fenced)["fence"]["member"] == "o0"
    with pytest.raises(ValueError):
        validate_payload("plan.feasibility", payload | {"surprise": 1})


def test_render_shows_the_report_for_the_terminal(t2: dict[str, Any]) -> None:
    text = render(report(t2, audit=True).model_dump(mode="json"))
    assert text.startswith("Feasibility of root: fits")
    for needle in (
        "cost      P50 $",
        "of $2.00)",
        "root plan",
        "cross-squad audit",
        "Critical path",
        "Bottlenecks",
        "Tools not allowed",
        "  - none",
        "Policy flags",
        "Limitations",
        "The planner says",
    ):
        assert needle in text, needle
    unbudgeted = render(report(t2, None).model_dump(mode="json"))
    assert "of $" not in unbudgeted.splitlines()[1]
