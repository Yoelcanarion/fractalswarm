"""The model ladder, wired in (spec §7.4): the market view keeps the run on a rung from the money
settled, each move is reported once, LLM requests carry the level, and at L2 and at the stop
the leaves drop what the ladder says to drop. Pure pieces and glue; the runs are in
tests/integration/test_market_ladder.py."""

from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.actors import market_maker
from fractalswarm.actors.agent import _call, agent_handle, agent_init
from fractalswarm.actors.orchestrator import _route
from fractalswarm.bench.tasks.t2_conference.task import T2  # noqa: F401  (registers the schemas)
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Emit, View
from fractalswarm.market.ladder import actions, critical_closure, request_level
from fractalswarm.market.view import MarketView
from fractalswarm.planning.contracts import Contract, Produce

RUNGS = {"L1": 0.8, "L2": 0.9, "stop": 0.95}
_seq = 0


def event(kind: str, payload: dict[str, Any], at: int = 0) -> Event:
    global _seq
    _seq += 1
    return Event(
        seq=_seq, run_id="r", ts_virtual=at, lamport=_seq, type=kind, actor="x",
        idem_key=f"k{_seq}", payload=payload, prev_hash="", hash="",
    )  # fmt: skip


def started(cap: float, ladder: dict | None = RUNGS) -> Event:
    params = {"market": {"ladder": ladder}} if ladder is not None else {}
    return event("run.started", {"seed": "s", "scenario": "x", "clock": "sim",
                                 "run_cap_usd": cap, "params": params})  # fmt: skip


def spend(
    view: MarketView, effect: str, usd: float, at: int, reserved: float | None = None
) -> None:
    scopes = {"squad": "s"}
    held = {"effect_id": effect, "usd": reserved or usd, "scopes": scopes}
    view.apply(event("budget.reserved", held, at=at))
    view.apply(event("budget.settled", {"effect_id": effect, "reserved_usd": reserved or usd,
                                        "actual_usd": usd}, at=at))  # fmt: skip


# -- the pure parts -----------------------------------------------------


def contracts(spec: dict[str, tuple[list[str], bool]]) -> dict[str, dict[str, Any]]:
    return {
        cid: {"depends_on": deps, "critical_path": critical}
        for cid, (deps, critical) in spec.items()
    }


def test_the_critical_path_is_the_flagged_contracts_and_everything_they_need() -> None:
    chain = contracts(
        {"extract": ([], False), "place": (["extract"], True), "blurb": (["place"], False)}
    )
    assert critical_closure(chain) == {"extract", "place"}  # the blurb is dropped, not the extract
    wide = contracts({"a": ([], False), "b": (["a"], False), "c": (["b"], True), "d": ([], False)})
    assert critical_closure(wide) == {"a", "b", "c"}


def test_a_plan_that_flags_nothing_has_no_critical_path_to_prune_to() -> None:
    plain = contracts({"a": ([], False), "b": (["a"], False)})
    assert critical_closure(plain) == {"a", "b"}
    assert critical_closure({}) == set()


def test_a_dependency_that_is_not_in_the_plan_is_ignored() -> None:
    assert critical_closure(contracts({"p": (["ghost"], True)})) == {"p"}


@given(
    st.dictionaries(
        st.sampled_from("abcdefgh"),
        st.tuples(st.lists(st.sampled_from("abcdefgh"), max_size=3), st.booleans()),
        max_size=8,
    )
)
def test_the_critical_closure_contains_what_is_flagged_and_is_closed_under_dependencies(
    spec,
) -> None:
    found = contracts(spec)
    keep = critical_closure(found)
    assert keep <= set(found)
    flagged = {cid for cid, c in found.items() if c["critical_path"]}
    assert (flagged <= keep) if flagged else (keep == set(found))
    for cid in keep:
        assert set(found[cid]["depends_on"]) & set(found) <= keep


def test_requests_take_the_cheapest_specs_at_the_stop_and_the_ladders_level_below_it() -> None:
    assert [request_level(level) for level in ("L0", "L1", "L2", "stop")] == [
        "L0",
        "L1",
        "L2",
        "L2",
    ]
    assert actions("L0") == ["normal operation"]
    assert "cheaper model and effort" in actions("L1")
    assert "only the critical path continues" not in actions("L1")
    assert "only the critical path continues" in actions("L2")
    assert any("no new contracts" in step for step in actions("stop"))


# -- the market view keeps the run on a rung -----------------------------------------------------


def test_the_run_climbs_the_ladder_as_money_is_settled_and_each_move_is_recorded() -> None:
    view = MarketView()
    view.apply(started(1.0))
    assert view.ladder.level == "L0" and view.changes == []
    for effect, (usd, level) in enumerate(
        [(0.79, "L0"), (0.02, "L1"), (0.09, "L2"), (0.05, "stop")]
    ):
        spend(view, f"e{effect}", usd, at=1_000 * (effect + 1))
        assert view.ladder.level == level
    assert [(c["previous"], c["level"]) for c in view.changes] == [
        ("L0", "L1"),
        ("L1", "L2"),
        ("L2", "stop"),
    ]
    first = view.changes[0]
    assert first["at_ms"] == 2_000 and first["cap_usd"] == 1.0
    assert 0.8 <= first["share"] < 0.9 and abs(first["spent_usd"] - 0.81) < 1e-9


def test_a_worst_case_reservation_in_flight_does_not_move_the_ladder() -> None:
    view = MarketView()
    view.apply(started(1.0))
    held = {"effect_id": "big", "usd": 0.9, "scopes": {"squad": "s"}}
    view.apply(event("budget.reserved", held))  # 90% committed, nothing spent
    assert view.ladder.level == "L0" and view.changes == []
    view.apply(
        event("budget.settled", {"effect_id": "big", "reserved_usd": 0.9, "actual_usd": 0.03})
    )
    assert view.ladder.level == "L0" and view.changes == []  # and it did not flap on the way


def test_a_shock_that_cuts_the_cap_climbs_the_ladder_and_one_that_raises_it_falls_back() -> None:
    view = MarketView()
    view.apply(started(2.0))
    spend(view, "a", 0.9, at=1_000)
    assert view.ladder.level == "L0"
    view.apply(
        event("budget.shock", {"level": "run", "key": "r", "usd": 1.0, "reason": ""}, at=2_000)
    )
    assert view.ladder.level == "L2"  # 0.9 of 1.0 is 90%: exactly the L2 rung
    view.apply(
        event("budget.shock", {"level": "run", "key": "r", "usd": 0.9, "reason": ""}, at=3_000)
    )
    assert view.ladder.level == "stop"
    view.apply(
        event("budget.shock", {"level": "run", "key": "r", "usd": 5.0, "reason": ""}, at=4_000)
    )
    assert view.ladder.level == "L0"
    assert [c["level"] for c in view.changes][-1] == "L0" and view.changes[-1]["at_ms"] == 4_000


def test_a_run_without_rungs_stays_on_l0() -> None:
    view = MarketView()
    view.apply(started(1.0, ladder=None))
    spend(view, "a", 0.99, at=1)
    assert view.ladder.level == "L0" and view.changes == []


# -- reporting the moves -----------------------------------------------------


def climbed() -> MarketView:
    view = MarketView()
    view.apply(started(1.0))
    spend(view, "a", 0.81, at=1_000)
    spend(view, "b", 0.10, at=2_000)
    return view


def test_each_move_is_reported_once_with_a_key_that_dedupes_other_reporters() -> None:
    view = climbed()
    state = {"ladder_seen": 0}
    state, commands = market_maker._ladder_events(state, view)
    assert [c.idem_key for c in commands] == ["budget.threshold:0", "budget.threshold:1"]
    first, second = commands
    assert isinstance(first, Emit) and first.type == "budget.threshold"
    assert (first.payload["previous"], first.payload["level"]) == ("L0", "L1")
    assert (second.payload["previous"], second.payload["level"]) == ("L1", "L2")
    assert first.payload["actions"] == actions("L1") and first.payload["at_ms"] == 1_000
    assert state["ladder_seen"] == 2
    assert market_maker._ladder_events(state, view)[1] == []  # nothing new, nothing written
    spend(view, "c", 0.05, at=3_000)
    state, commands = market_maker._ladder_events(state, view)
    assert [c.idem_key for c in commands] == ["budget.threshold:2"]


def test_a_late_reporter_still_writes_the_moves_it_missed_under_the_same_keys() -> None:
    state, commands = market_maker._ladder_events({"ladder_seen": 1}, climbed())
    assert [c.idem_key for c in commands] == ["budget.threshold:1"]  # the first was reported before


# -- the level reaches the calls -----------------------------------------------------


def state_with(market: bool, rung: str = "L0") -> dict[str, Any]:
    return {"market": {"ladder": RUNGS} if market else None, "rung": rung, "contributor": False}


def test_the_ladder_is_l0_when_the_economy_is_off_and_the_views_level_when_it_is_on() -> None:
    market = climbed()
    view = View(
        run_id="r", seed="s", actor_id="o", now=0, lamport=0, alive=(), views={"market": market}
    )
    assert market_maker.ladder(state_with(True), view).level == "L2"
    assert market_maker.ladder(state_with(False), view).level == "L0"  # a default run never climbs
    bare = View(run_id="r", seed="s", actor_id="o", now=0, lamport=0, alive=(), views={})
    assert market_maker.ladder(state_with(True), bare).level == "L0"


def test_a_contract_message_adds_the_level_only_above_l0() -> None:
    assert market_maker.level_body(state_with(True, "L0")) == {}
    assert market_maker.level_body(state_with(True, "L1")) == {"level": "L1"}
    assert market_maker.level_body(state_with(True, "stop")) == {"level": "L2"}


def test_an_orchestrators_own_calls_carry_the_level_and_a_run_at_l0_sends_what_it_always_did() -> (
    None
):
    request = {"role": "sub_planner", "input": "x"}
    assert _route(state_with(True, "L0"), request) == request
    assert _route(state_with(True, "L1"), request) == request | {"level": "L1"}
    assert _route(state_with(True, "stop"), request) == request | {"level": "L2"}


def agent_contract() -> Contract:
    return Contract(
        id="extract", goal_id="g", kind="extract", owner="o1.1", objective="x",
        produces=[Produce(key="g/extract", schema_name="t2_extract")],
    )  # fmt: skip


def agent_request(body: dict[str, Any]) -> dict[str, Any]:
    state = agent_init("o1.1.a1", {"owner": "o1.1", "squad": "o1.1"})
    state, commands = agent_handle(state, event("msg.sent", {"to": "o1.1.a1", "topic": "contract",
                                                             "body": body}), None)  # fmt: skip
    [call] = [c for c in commands if getattr(c, "kind", "") == "llm"]
    return call.request


def test_an_agent_takes_the_level_of_the_contract_it_is_sent() -> None:
    contract = agent_contract().model_dump()
    assert "level" not in agent_request({"contract": contract})  # as before at L0
    assert agent_request({"contract": contract, "level": "L1"})["level"] == "L1"
    assert agent_request({"contract": contract, "level": "L2"})["level"] == "L2"
    state = agent_init("a", {"owner": "o", "squad": "o"}) | {"level": "L1"}
    cur = {"items": [], "step": 1}
    assert _call(state, agent_contract(), cur).request["level"] == "L1"
