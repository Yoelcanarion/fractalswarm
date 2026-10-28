"""The risk score r of a contract (spec §12): bounds, monotonicity in every term, the history."""

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.kernel.events import Event
from fractalswarm.planning.contracts import Contract, ContractBudget
from fractalswarm.planning.risk import (
    DEFAULT_WEIGHTS,
    PRIOR_ATTEMPTS,
    PRIOR_FAILURES,
    TOOL_RISK,
    RiskWeights,
    RoleHistoryView,
    contract_risk,
    cost_uncertainty,
    failure_rate,
    loop_cost_band,
    risk_score,
    risk_terms,
    role_key,
    tool_risk,
)

TOOLS = [*TOOL_RISK, "shell.exec"]  # the last one is not a known tool
money = st.floats(min_value=0.0, max_value=1e3, allow_nan=False)
unit = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)
tool_lists = st.lists(st.sampled_from(TOOLS), max_size=6)
weights_st = st.lists(
    st.floats(min_value=0.0, max_value=1.0, allow_nan=False), min_size=5, max_size=5
).filter(lambda parts: sum(parts) > 1e-3)

BASE = {
    "cost_p50_usd": 1.0,
    "cost_p90_usd": 2.0,
    "critical_path": False,
    "tools": ["memory.search"],
    "planner_risk": 0.3,
    "role_failure_rate": 0.1,
}


def r(**changes) -> float:
    return risk_score(**(BASE | changes))


@given(money, money, st.booleans(), tool_lists, unit, unit)
def test_r_stays_in_the_unit_interval(p50, p90, critical, tools, planner, failures) -> None:
    value = risk_score(
        cost_p50_usd=p50,
        cost_p90_usd=p90,
        critical_path=critical,
        tools=tools,
        planner_risk=planner,
        role_failure_rate=failures,
    )
    assert 0.0 <= value <= 1.0


@given(money, money, st.booleans(), tool_lists, st.floats(-5, 5), st.floats(-5, 5))
def test_r_stays_in_the_unit_interval_for_out_of_range_inputs(
    p50, p90, critical, tools, planner, failures
) -> None:
    value = risk_score(
        cost_p50_usd=p50,
        cost_p90_usd=p90,
        critical_path=critical,
        tools=tools,
        planner_risk=planner,
        role_failure_rate=failures,
    )
    assert 0.0 <= value <= 1.0


def test_the_extremes_reach_both_ends() -> None:
    calm = risk_score(
        cost_p50_usd=1.0,
        cost_p90_usd=1.0,
        critical_path=False,
        tools=[],
        planner_risk=0.0,
        role_failure_rate=0.0,
    )
    worst = risk_score(
        cost_p50_usd=0.0,
        cost_p90_usd=1.0,
        critical_path=True,
        tools=["shell.exec"],
        planner_risk=1.0,
        role_failure_rate=1.0,
    )
    assert calm == 0.0
    assert worst == pytest.approx(1.0)


@given(money, money, money)
def test_r_grows_with_cost_uncertainty(p50, p90, more) -> None:
    # Same median, a longer tail: the P90/P50 ratio and so r can only grow.
    assert r(cost_p50_usd=p50, cost_p90_usd=p90 + more) >= r(cost_p50_usd=p50, cost_p90_usd=p90)
    # Same tail, a smaller median: the ratio grows too.
    assert r(cost_p50_usd=max(p50 - more, 0.0), cost_p90_usd=p90) >= r(
        cost_p50_usd=p50, cost_p90_usd=p90
    )


@given(st.booleans(), tool_lists, unit, unit)
def test_r_grows_with_the_critical_path(_, tools, planner, failures) -> None:
    kwargs = {"tools": tools, "planner_risk": planner, "role_failure_rate": failures}
    off, on = r(critical_path=False, **kwargs), r(critical_path=True, **kwargs)
    assert on >= off
    assert on - off == pytest.approx(DEFAULT_WEIGHTS.critical_path)


@given(tool_lists, st.sampled_from(TOOLS))
def test_r_grows_with_every_tool_added(tools, extra) -> None:
    assert r(tools=[*tools, extra]) >= r(tools=tools)
    assert tool_risk([*tools, extra]) >= tool_risk(tools)


@given(unit, unit)
def test_r_grows_with_the_planners_risk(low, high) -> None:
    low, high = sorted((low, high))
    assert r(planner_risk=high) >= r(planner_risk=low)


@given(unit, unit)
def test_r_grows_with_the_roles_failure_rate(low, high) -> None:
    low, high = sorted((low, high))
    assert r(role_failure_rate=high) >= r(role_failure_rate=low)


def test_each_term_moves_r_by_its_weight_when_it_moves_alone() -> None:
    w = DEFAULT_WEIGHTS
    assert r(planner_risk=0.8) - r(planner_risk=0.3) == pytest.approx(w.planner * 0.5)
    assert r(role_failure_rate=0.6) - r(role_failure_rate=0.1) == pytest.approx(
        w.role_failure * 0.5
    )
    assert r(critical_path=True) - r(critical_path=False) == pytest.approx(w.critical_path)
    assert r(cost_p90_usd=4.0) - r(cost_p90_usd=2.0) == pytest.approx(
        w.cost_uncertainty * (0.75 - 0.5)
    )
    assert r(tools=["memory.search", "fetch"]) > r(tools=["memory.search"])


@given(money, money, money, st.booleans(), tool_lists, unit, unit, weights_st)
def test_monotonic_under_any_valid_weights(
    p50, p90, more, critical, tools, planner, failures, parts
) -> None:
    shares = dict(zip(RiskWeights.model_fields, parts, strict=True))
    weights = RiskWeights(**{k: v / sum(parts) for k, v in shares.items()})
    base = {
        "cost_p50_usd": p50,
        "cost_p90_usd": p90,
        "critical_path": critical,
        "tools": tools,
        "planner_risk": planner,
        "role_failure_rate": failures,
        "weights": weights,
    }
    value = risk_score(**base)
    assert 0.0 <= value <= 1.0
    assert risk_score(**base | {"cost_p90_usd": p90 + more}) >= value - 1e-12
    assert risk_score(**base | {"planner_risk": min(planner + 0.1, 1.0)}) >= value - 1e-12
    assert risk_score(**base | {"critical_path": True}) >= value - 1e-12


def test_weights_must_be_non_negative_and_sum_to_one() -> None:
    assert sum(DEFAULT_WEIGHTS.model_dump().values()) == pytest.approx(1.0)
    with pytest.raises(ValueError):
        RiskWeights(planner=0.5)  # the sum is no longer 1
    with pytest.raises(ValueError):
        RiskWeights(
            cost_uncertainty=-0.15, critical_path=0.4, tool=0.15, planner=0.4, role_failure=0.2
        )


def test_cost_uncertainty_is_the_share_of_the_p90_above_the_median() -> None:
    assert cost_uncertainty(1.0, 1.0) == 0.0
    assert cost_uncertainty(1.0, 2.0) == 0.5
    assert cost_uncertainty(1.0, 4.0) == 0.75
    assert cost_uncertainty(0.0, 1.0) == 1.0
    assert cost_uncertainty(0.0, 0.0) == 0.0  # free work is not uncertain
    assert cost_uncertainty(3.0, 1.0) == 0.0  # a median above the P90 is no uncertainty


def test_an_unknown_tool_is_the_riskiest_and_no_tool_is_safe() -> None:
    assert tool_risk([]) == 0.0
    assert tool_risk(["shell.exec"]) == 1.0
    assert tool_risk(["memory.search"]) == pytest.approx(TOOL_RISK["memory.search"])
    assert tool_risk(["memory.search", "memory.search"]) == tool_risk(["memory.search"])
    assert tool_risk(["fetch", "memory.search"]) == tool_risk(["memory.search", "fetch"])


def test_the_failure_rate_starts_at_the_prior_and_follows_the_observations() -> None:
    assert failure_rate(0, 0) == PRIOR_FAILURES / PRIOR_ATTEMPTS
    assert failure_rate(0, 90) < failure_rate(0, 0) < failure_rate(10, 10)
    assert failure_rate(50, 100) == pytest.approx(51 / 110)
    for failures, attempts in ((0, 0), (5, 5), (0, 1000), (1000, 1000)):
        assert 0.0 < failure_rate(failures, attempts) <= 1.0


def contract(kind: str, tools: list[str], risk: float, critical: bool = False) -> Contract:
    return Contract(
        id=kind,
        goal_id="g",
        kind=kind,
        owner="o",
        objective=kind,
        tools=tools,
        risk=risk,
        critical_path=critical,
    )


def t2_contracts() -> dict[str, Contract]:
    return {
        "extract": contract("extract", ["memory.search", "memory.publish_fact"], 0.4),
        "place": contract("place", ["memory.search"], 0.6, critical=True),
        "blurb": contract("blurb", ["workspace.write"], 0.1),
    }


def test_the_t2_contracts_rank_by_how_much_can_go_wrong() -> None:
    scores = {kind: contract_risk(c).r for kind, c in t2_contracts().items()}
    assert scores["place"] > scores["extract"] > scores["blurb"]
    assert all(0.0 <= value <= 1.0 for value in scores.values())
    # Only the critical-path contract reaches the audit band by itself; the others need a
    # history of failures or a riskier plan to get there.
    assert scores["place"] < 0.7
    assert scores["extract"] < 0.4 and scores["blurb"] < 0.4


def test_contract_risk_reports_the_terms_that_make_it() -> None:
    score = contract_risk(t2_contracts()["place"])
    assert score.terms.critical_path == 1.0
    assert score.terms.planner == 0.6
    assert score.terms.role_failure == failure_rate(0, 0)
    assert score.r == pytest.approx(
        DEFAULT_WEIGHTS.cost_uncertainty * score.terms.cost_uncertainty
        + DEFAULT_WEIGHTS.critical_path
        + DEFAULT_WEIGHTS.tool * score.terms.tool
        + DEFAULT_WEIGHTS.planner * 0.6
        + DEFAULT_WEIGHTS.role_failure * score.terms.role_failure
    )


def test_the_cost_band_follows_the_tools_and_respects_max_steps() -> None:
    plain = contract("blurb", [], 0.1)
    p50, p90 = loop_cost_band(plain)
    assert 0 < p50 < p90
    busy = contract("extract", ["memory.search", "memory.publish_fact"], 0.4)
    assert loop_cost_band(busy)[0] > p50
    capped = busy.model_copy(update={"budget": ContractBudget(max_steps=1)})
    low, high = loop_cost_band(capped)
    assert low == high  # one call at most: nothing to be uncertain about
    assert contract_risk(capped).terms.cost_uncertainty == 0.0


def test_the_role_is_the_kind_and_falls_back_to_the_role() -> None:
    assert role_key(contract("place", [], 0.1)) == "place"
    assert role_key({"kind": "", "role": "reviewer"}) == "reviewer"
    assert role_key({"id": "x"}) == "agent"


def event(event_type: str, payload: dict, seq: int = 1) -> Event:
    return Event(
        seq=seq,
        run_id="r",
        ts_virtual=0,
        lamport=0,
        type=event_type,
        actor="o",
        idem_key=f"k{seq}",
        payload=payload,
        prev_hash="0",
        hash="1",
    )


def test_the_history_counts_attempts_by_role_from_the_log() -> None:
    view = RoleHistoryView()
    for cid, kind in (("a", "place"), ("b", "place"), ("c", "blurb")):
        made = {"goal_id": "g", "id": cid, "kind": kind, "role": "agent"}
        view.apply(event("contract.created", {"contract": made}))
    assert view.failure_rate("place") == failure_rate(0, 0)

    def verified(cid: str) -> Event:
        return event("contract.verified", {"goal_id": "g", "contract_id": cid})

    def rejected(cid: str, stage: str) -> Event:
        payload = {"goal_id": "g", "contract_id": cid, "stage": stage}
        return event("contract.rejected", payload)

    view.apply(rejected("a", "judge"))
    view.apply(rejected("a", "audit"))
    view.apply(verified("a"))
    view.apply(verified("b"))
    view.apply(rejected("c", "lost"))  # lost with its agent: neither success nor failure
    view.apply(verified("c"))
    assert view.attempts == {"place": 4, "blurb": 1}
    assert view.failures == {"place": 2}
    assert view.failure_rate("place") == failure_rate(2, 4)
    assert view.failure_rate("blurb") == failure_rate(0, 1)
    assert view.failure_rate("extract") == failure_rate(0, 0)  # never seen
    view.apply(verified("unknown"))  # a contract the view never saw created
    assert view.attempts == {"place": 4, "blurb": 1}


def test_a_failing_role_raises_the_risk_of_its_next_contract() -> None:
    view = RoleHistoryView()
    made = {"goal_id": "g", "id": "p", "kind": "extract", "role": "agent"}
    view.apply(event("contract.created", {"contract": made}))
    extract = t2_contracts()["extract"]
    before = contract_risk(extract, view).r
    for _ in range(6):
        view.apply(event("contract.rejected", {"goal_id": "g", "contract_id": "p", "stage": "x"}))
    after = contract_risk(extract, view).r
    assert after > before
    assert after - before == pytest.approx(
        DEFAULT_WEIGHTS.role_failure * (failure_rate(6, 6) - failure_rate(0, 0))
    )


def test_risk_terms_are_pure() -> None:
    args = {**BASE, "tools": ["fetch", "memory.search"]}
    assert risk_terms(**args) == risk_terms(**args)
    assert risk_score(**args) == risk_score(**args)
