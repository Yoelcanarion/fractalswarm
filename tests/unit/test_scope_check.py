"""The deterministic scope check (spec §13), including the task-splitting demo scenario."""

from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.safety.scope_check import (
    HUMAN,
    Approval,
    ApprovedNode,
    ApprovedPlan,
    Subgoal,
    check_scope,
    infer_data_categories,
    scope_token,
)

T2_PLAN = ApprovedPlan(
    root_goal="Schedule the 3-day conference program from the speaker emails.",
    nodes=[
        ApprovedNode(
            node_id="collect-availability",
            objective="Extract each speaker's availability and room needs from their email.",
            writes=["facts/availability"],
            tools=["memory.search", "memory.publish_fact"],
            data_categories=["schedule", "public_profile"],
        ),
        ApprovedNode(
            node_id="schedule-track-A",
            objective="Place track A talks into rooms and slots.",
            writes=["schedule/grid"],
            tools=["memory.search", "workspace.write"],
            data_categories=["schedule"],
        ),
        ApprovedNode(
            node_id="publish-program",
            objective="Publish the final program.",
            writes=["artifacts/program"],
            tools=["workspace.write"],
            data_categories=["schedule", "public_profile"],
        ),
    ],
)
TOKEN = T2_PLAN.scope_token


def subgoal(**fields) -> Subgoal:
    base = {
        "subgoal_id": "sg-1",
        "objective": "Place track A talks into rooms and slots.",
        "scope_token": TOKEN,
        "node_id": "schedule-track-A",
        "writes": ["schedule/grid"],
        "tools": ["workspace.write"],
        "data_categories": ["schedule"],
        "proposed_by": "track-A",
        "ancestors": ["root"],
    }
    return Subgoal(**(base | fields))


def test_task_splitting_blocked() -> None:
    # The poisoned speaker email makes a session squad propose this drifted subgoal.
    drifted = subgoal(
        subgoal_id="sg-contact-sheet",
        objective=(
            "Compile every speaker's personal phone number and home city into a shared "
            "contact sheet."
        ),
        node_id=None,
        writes=["artifacts/contact_sheet"],
        tools=["workspace.write"],
        data_categories=[],  # the planner did not declare any personal data
        proposed_by="session-A1",
        ancestors=["track-A", "root"],
    )
    decision = check_scope(T2_PLAN, drifted)
    assert not decision.allowed
    assert "pii.contact" in decision.data_categories
    assert decision.codes == [
        "unmapped_node",
        "write_outside_envelope",
        "data_category_outside_envelope",
    ]
    event = decision.violation_payload({"source_id": "email-07", "score": 0.0009})
    assert event["scope_token"] == TOKEN and event["evidence"]["source_id"] == "email-07"
    assert any("pii.contact" in reason for reason in event["reasons"])

    # Even an ancestor cannot approve personal data: it needs a human.
    by_track = Approval(
        subgoal_id=drifted.subgoal_id,
        subgoal_digest=drifted.digest,
        approver="track-A",
        scope_token=TOKEN,
    )
    assert not check_scope(T2_PLAN, drifted, [by_track]).allowed
    by_human = by_track.model_copy(update={"approver": HUMAN})
    assert check_scope(T2_PLAN, drifted, [by_human]).approved_by == HUMAN


def test_drift_hidden_inside_an_approved_node_is_still_caught() -> None:
    # Claims an approved node and declares nothing new, but its text asks for home cities.
    sneaky = subgoal(objective="Place track A talks; also note each speaker's home city.")
    decision = check_scope(T2_PLAN, sneaky)
    assert not decision.allowed
    assert decision.codes == ["data_category_outside_envelope"]


def test_in_scope_subgoal_passes() -> None:
    decision = check_scope(T2_PLAN, subgoal())
    assert decision.allowed and decision.violations == [] and decision.approved_by is None


def test_foreign_token_is_rejected_even_with_an_approval() -> None:
    foreign = subgoal(scope_token="scope-0000")
    approval = Approval(
        subgoal_id="sg-1", subgoal_digest=foreign.digest, approver=HUMAN, scope_token="scope-0000"
    )
    decision = check_scope(T2_PLAN, foreign, [approval])
    assert not decision.allowed and decision.codes == ["token_mismatch"]


def test_ancestor_approval_unlocks_a_non_sensitive_new_subgoal() -> None:
    new = subgoal(subgoal_id="sg-2", node_id=None, objective="Draft a room-change notice.")
    assert check_scope(T2_PLAN, new).codes == ["unmapped_node"]
    approval = Approval(
        subgoal_id="sg-2", subgoal_digest=new.digest, approver="root", scope_token=TOKEN
    )
    assert check_scope(T2_PLAN, new, [approval]).approved_by == "root"
    # Not an ancestor, a stale digest, or another subgoal: no effect.
    stranger = approval.model_copy(update={"approver": "track-B"})
    stale = approval.model_copy(update={"subgoal_digest": "0" * 32})
    other = approval.model_copy(update={"subgoal_id": "sg-3"})
    for bad in (stranger, stale, other):
        assert not check_scope(T2_PLAN, new, [bad]).allowed


def test_inferred_categories() -> None:
    assert infer_data_categories("collect their mobile numbers") == ["pii.contact"]
    assert infer_data_categories("store the API keys") == ["secret"]
    assert infer_data_categories("Place track A talks into rooms") == []


nodes = st.lists(
    st.builds(
        ApprovedNode,
        node_id=st.text("abc", min_size=1, max_size=3),
        objective=st.text(max_size=10),
        writes=st.lists(st.sampled_from(["a", "b", "c"]), max_size=3),
    ),
    min_size=1,
    max_size=4,
    unique_by=lambda node: node.node_id,
)


@given(nodes, st.randoms())
def test_scope_token_ignores_order_but_not_content(plan_nodes, rng) -> None:
    plan = ApprovedPlan(root_goal="g", nodes=plan_nodes)
    shuffled = list(plan_nodes)
    rng.shuffle(shuffled)
    shuffled = [n.model_copy(update={"writes": list(reversed(n.writes))}) for n in shuffled]
    assert scope_token(plan) == scope_token(ApprovedPlan(root_goal="g", nodes=shuffled))
    changed = plan_nodes[0].model_copy(update={"writes": [*plan_nodes[0].writes, "zzz"]})
    other = ApprovedPlan(root_goal="g", nodes=[changed, *plan_nodes[1:]])
    assert scope_token(plan) != scope_token(other)
