"""The cross-squad audit (spec §11.3): sampling, the auditor pick, the verdict, the view of the
log, and the fake auditor that answers the ``auditor`` role."""

import json
import math
from collections import Counter

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.bench.tasks.t2_conference.fake import t2_script
from fractalswarm.kernel.events import Event
from fractalswarm.planning.contracts import Acceptance, Contract
from fractalswarm.planning.planner import read_blocks
from fractalswarm.verify.cross_audit import (
    HIGH_RISK,
    MID_RISK,
    AuditView,
    audit_rate,
    audit_request,
    draw,
    pick_auditor,
    read_audit,
    sample,
    skipped,
)

SEED = "1"
KEYS = [f"track-{i % 7}/d{i % 2}/c{i}" for i in range(6000)]


def share(rate: float, r: float, critical: bool = False, forced: bool = False) -> float:
    picked = sum(sample(SEED, key, 0, r, critical, forced).selected for key in KEYS)
    return picked / len(KEYS)


def tolerance(rate: float) -> float:
    """Six standard errors of the share of ``len(KEYS)`` draws."""
    return 6 * math.sqrt(rate * (1 - rate) / len(KEYS)) + 1e-12


# -- the rates ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("r", "critical", "forced", "rate"),
    [
        (0.0, True, False, 1.0),  # the critical path, whatever its risk
        (0.0, False, False, 0.15),
        (0.39, False, False, 0.15),
        (MID_RISK, False, False, 0.5),
        (0.55, False, False, 0.5),
        (0.699, False, False, 0.5),
        (HIGH_RISK, False, False, 1.0),
        (1.0, False, False, 1.0),
        (0.1, False, True, 1.0),  # an earlier attempt failed its audit
    ],
)
def test_the_audit_rate_by_band(r: float, critical: bool, forced: bool, rate: float) -> None:
    assert audit_rate(r, critical, forced)[0] == rate


def test_the_basis_says_why() -> None:
    assert audit_rate(0.1, True)[1] == "critical path"
    assert audit_rate(0.8, False)[1] == "risk >= 0.7"
    assert audit_rate(0.5, False)[1] == "0.4 <= risk < 0.7"
    assert audit_rate(0.1, False)[1] == "risk < 0.4"
    assert "failed its audit" in audit_rate(0.1, False, forced=True)[1]


@given(st.floats(min_value=0.0, max_value=1.0, allow_nan=False), st.booleans())
def test_a_riskier_contract_is_never_audited_less(r: float, critical: bool) -> None:
    low, _ = audit_rate(r, critical)
    higher, _ = audit_rate(min(r + 0.1, 1.0), critical)
    assert higher >= low
    assert audit_rate(r, True)[0] >= low  # the critical path is never audited less


# -- the sampling matches the rates -------------------------------------------------------


@pytest.mark.parametrize(
    ("r", "critical", "rate"),
    [(0.1, False, 0.15), (0.39, False, 0.15), (0.4, False, 0.5), (0.6, False, 0.5)],
)
def test_the_sampled_share_matches_the_rate_for_a_fixed_seed(
    r: float, critical: bool, rate: float
) -> None:
    assert abs(share(rate, r, critical) - rate) <= tolerance(rate)


def test_the_critical_path_and_high_risk_contracts_are_all_audited() -> None:
    assert share(1.0, 0.0, critical=True) == 1.0
    assert share(1.0, HIGH_RISK) == 1.0
    assert share(1.0, 0.95) == 1.0
    assert share(1.0, 0.05, forced=True) == 1.0


def test_the_draw_is_seeded_per_contract_and_attempt_not_per_call() -> None:
    assert draw("1", "g/place", 0) == draw("1", "g/place", 0)
    assert draw("1", "g/place", 0) != draw("2", "g/place", 0)  # another run seed
    assert draw("1", "g/place", 0) != draw("1", "g/place", 1)  # a retry draws again
    assert draw("1", "g/place", 0) != draw("1", "g/extract", 0)
    assert 0.0 <= draw("1", "g/place", 0) < 1.0
    forward = [draw(SEED, key, 0) for key in KEYS[:200]]
    backward = [draw(SEED, key, 0) for key in reversed(KEYS[:200])]
    assert forward == backward[::-1]  # the order contracts are verified in does not matter


def test_another_seed_selects_another_set_at_the_same_rate() -> None:
    chosen = {
        seed: {key for key in KEYS if sample(seed, key, 0, 0.1, False).selected}
        for seed in ("1", "2")
    }
    assert chosen["1"] != chosen["2"]
    for picked in chosen.values():
        assert abs(len(picked) / len(KEYS) - 0.15) <= tolerance(0.15)


def test_the_selection_is_exactly_the_draw_below_the_rate() -> None:
    for key in KEYS[:300]:
        found = sample(SEED, key, 2, 0.5, False)
        assert found.draw == draw(SEED, key, 2)
        assert found.rate == 0.5
        assert found.selected == (found.draw < 0.5)


# -- the auditor --------------------------------------------------------------------------

members_st = st.lists(
    st.sampled_from([f"o{i}.{j}" for i in range(1, 4) for j in range(1, 4)]), min_size=1
)


@given(members_st, st.permutations(range(5)))
def test_the_pick_is_in_the_pool_and_independent_of_its_order(pool, order) -> None:
    unique = sorted(set(pool))
    shuffled = [unique[i % len(unique)] for i in order]
    assert pick_auditor("g/place", 0, unique) in unique
    assert pick_auditor("g/place", 0, unique) == pick_auditor("g/place", 0, shuffled + unique[::-1])


@given(members_st)
def test_when_the_auditor_dies_only_its_contracts_move(pool) -> None:
    unique = sorted(set(pool))
    for key in KEYS[:40]:
        chosen = pick_auditor(key, 0, unique)
        rest = [member for member in unique if member != chosen]
        if not rest:
            assert pick_auditor(key, 0, rest) is None
            continue
        # A member that was not the pick leaves: the pick does not move (minimal remap).
        assert pick_auditor(key, 0, [chosen, *rest[1:]]) == chosen
        assert pick_auditor(key, 0, rest) in rest


def test_the_picks_spread_over_the_pool() -> None:
    pool = ["o1.1", "o1.2", "o1.3"]
    counts = Counter(pick_auditor(key, 0, pool) for key in KEYS[:3000])
    assert set(counts) == set(pool)
    assert min(counts.values()) > 800  # a third each, within sampling noise


def test_the_retry_of_a_contract_can_go_to_another_auditor() -> None:
    pool = ["o1.1", "o1.2", "o1.3"]
    moved = [key for key in KEYS[:200] if pick_auditor(key, 0, pool) != pick_auditor(key, 1, pool)]
    assert moved


def test_an_empty_pool_has_no_auditor() -> None:
    assert pick_auditor("g/place", 0, []) is None


# -- the verdict --------------------------------------------------------------------------


def test_read_audit_passes_and_fails_on_the_auditors_word() -> None:
    ok = json.dumps({"verdict": "pass", "score": 0.9, "reasons": []})
    bad = json.dumps({"verdict": "fail", "score": 0.1, "reasons": ["slot 3 holds 2 talks"]})
    assert read_audit("ok", ok, "o2.2").verdict == "pass"
    failed = read_audit("ok", bad, "o2.2")
    assert (failed.verdict, failed.reasons, failed.auditor) == (
        "fail",
        ["slot 3 holds 2 talks"],
        "o2.2",
    )


@pytest.mark.parametrize("status", ["error", "refused", "incomplete"])
def test_an_auditor_that_cannot_answer_does_not_block_the_contract(status: str) -> None:
    outcome = read_audit(status, "", "o2.2")
    assert outcome.verdict == "skipped" and status in outcome.reasons[0]


def test_an_unusable_answer_is_skipped_with_the_reason() -> None:
    outcome = read_audit("ok", "I think it is fine", "o2.2")
    assert outcome.verdict == "skipped"
    assert "unusable" in outcome.reasons[0]
    assert skipped("no live auditor").auditor == ""


def test_reasons_are_clipped() -> None:
    reasons = [f"{'x' * 900} {n}" for n in range(30)]
    text = json.dumps({"verdict": "fail", "score": 0.0, "reasons": reasons})
    outcome = read_audit("ok", text, "o2.2")
    assert len(outcome.reasons) == 8 and all(len(r) <= 400 for r in outcome.reasons)


# -- the view of the log ------------------------------------------------------------------


def event(event_type: str, payload: dict, actor: str = "o1.1", seq: int = 1) -> Event:
    return Event(
        seq=seq,
        run_id="r",
        ts_virtual=0,
        lamport=0,
        type=event_type,
        actor=actor,
        idem_key=f"k{seq}",
        payload=payload,
        prev_hash="0",
        hash="1",
    )


def request_message(to: str, attempt: int = 0) -> Event:
    body = {"goal_id": "g", "contract_id": "place", "attempt": attempt}
    return event("msg.sent", {"to": to, "topic": "audit.request", "body": body})


def test_the_view_follows_a_request_from_ask_to_verdict() -> None:
    view = AuditView()
    key = ("g/place", 0)
    view.apply(request_message("o1.2"))
    assert view.asked(key) == ["o1.2"] and view.working(key) == [] and key not in view.verdicts
    started = {"effect_id": "e1", "kind": "llm", "request": {}, "tag": "audit|g|place|0"}
    view.apply(event("effect.started", started, actor="o1.2"))
    assert view.working(key) == ["o1.2"]
    done = {"effect_id": "e1", "kind": "llm", "status": "ok", "result": {"output_text": "{}"}}
    view.apply(event("effect.completed", done | {"tag": "audit|g|place|0"}, actor="@env"))
    assert view.working(key) == []
    assert view.verdicts[key] == ("ok", "{}", "o1.2")  # who answered comes from the start


def test_a_killed_auditors_call_leaves_no_verdict_and_the_first_answer_wins() -> None:
    view = AuditView()
    key = ("g/place", 0)
    tag = "audit|g|place|0"
    view.apply(
        event(
            "effect.started", {"effect_id": "e1", "kind": "llm", "request": {}, "tag": tag}, "o1.2"
        )
    )
    view.apply(event("effect.cancelled", {"effect_id": "e1", "kind": "llm", "tag": tag}, "o1.2"))
    assert view.working(key) == [] and key not in view.verdicts
    for number, auditor, text in ((2, "o1.3", "first"), (3, "o1.1", "second")):
        effect = f"e{number}"
        view.apply(
            event(
                "effect.started",
                {"effect_id": effect, "kind": "llm", "request": {}, "tag": tag},
                auditor,
            )
        )
        done = {"effect_id": effect, "kind": "llm", "status": "ok", "result": {"output_text": text}}
        view.apply(event("effect.completed", done | {"tag": tag}, "@env"))
    assert view.verdicts[key] == ("ok", "first", "o1.3")


def test_other_effects_and_other_attempts_are_not_audits() -> None:
    view = AuditView()
    view.apply(
        event(
            "effect.started",
            {"effect_id": "e1", "kind": "llm", "request": {}, "tag": "judge|g|place|0"},
        )
    )
    view.apply(
        event("effect.started", {"effect_id": "e2", "kind": "timer", "request": {}, "tag": None})
    )
    assert view.running == {}
    view.apply(request_message("o1.2", attempt=1))
    assert view.asked(("g/place", 0)) == [] and view.asked(("g/place", 1)) == ["o1.2"]


def test_the_view_keeps_the_first_sampling_decision_and_the_failed_attempts() -> None:
    view = AuditView()
    first = {"work": "g/place", "attempt": 0, "selected": True, "rate": 1.0}
    view.apply(event("verify.sampled", first))
    view.apply(event("verify.sampled", first | {"selected": False}))
    assert view.sampled[("g/place", 0)]["selected"] is True
    assert not view.failed_before("g/place", 1)
    view.apply(
        event(
            "verify.audited",
            {"goal_id": "g", "contract_id": "place", "attempt": 0, "verdict": "pass"},
        )
    )
    assert not view.failed_before("g/place", 1)
    view.apply(
        event(
            "verify.audited",
            {"goal_id": "g", "contract_id": "place", "attempt": 0, "verdict": "fail"},
        )
    )
    assert view.failed_before("g/place", 1) and not view.failed_before("g/place", 0)
    assert not view.failed_before("g/extract", 1)


# -- the fake auditor: the ``auditor`` role answers ---------------------------------------

ROOMS = [{"id": "A", "capacity": 50}, {"id": "B", "capacity": 150}]
SLOTS = [{"index": n, "start": f"09:{n}0", "end": f"09:{n}5"} for n in range(3)]
PLACE_DATA = {
    "session": {"id": "s", "day": 1, "talk_ids": ["T1", "T2"]},
    "talks": [{"talk_id": "T1", "speaker_id": "S1"}, {"talk_id": "T2", "speaker_id": "S2"}],
    "constraints": {
        "speakers": [
            {"speaker_id": "S1", "available": [{"day": 1, "slots": [0, 1]}], "preference": "none"},
            {"speaker_id": "S2", "available": [{"day": 1, "slots": [1, 2]}], "preference": "none"},
        ],
        "talks": [
            {"talk_id": "T1", "expected_attendance": 40},
            {"talk_id": "T2", "expected_attendance": 120},
        ],
    },
    "rooms": ROOMS,
    "slots": SLOTS,
}
GOOD = [
    {"talk_id": "T1", "day": 1, "slot": 0, "room": "A"},
    {"talk_id": "T2", "day": 1, "slot": 1, "room": "B"},
]


def contract(kind: str) -> Contract:
    return Contract(
        id=kind,
        goal_id="s",
        kind=kind,
        owner="o1.1",
        objective=f"{kind} the session",
        acceptance=Acceptance(checks=["schema:x"], rubric=["every talk is placed"]),
    )


def ask(kind: str, data: dict, output: dict) -> dict:
    request = audit_request(contract(kind), output, data)
    body = {"input": request["input"], "text": {"format": request["text_format"]}}
    return json.loads(t2_script(body, 0))


def placed(**change) -> dict:
    rows = [dict(row) for row in GOOD]
    rows[0] |= change
    return {"placements": rows, "notes": ""}


def test_the_audit_request_asks_the_auditor_role_in_the_judges_schema() -> None:
    request = audit_request(contract("place"), {"placements": GOOD}, PLACE_DATA)
    assert request["role"] == "auditor"
    assert request["text_format"]["name"] == "audit_verdict"
    blocks = read_blocks(request["input"])
    assert blocks["audit"]["work"] == "s/place" and blocks["audit"]["attempt"] == 0
    assert blocks["contract_data"] == PLACE_DATA
    assert "UNTRUSTED agent_output" in request["input"]  # the output is spotlighted


def test_a_correct_placement_passes_the_audit() -> None:
    assert ask("place", PLACE_DATA, {"placements": GOOD, "notes": ""})["verdict"] == "pass"


@pytest.mark.parametrize(
    ("output", "reason"),
    [
        (placed(day=2), "T1 is on day 2"),
        (placed(slot=9), "slot 9 does not exist"),
        (placed(room="Z"), "unknown room Z"),
        (
            placed(room="A", slot=1)
            | {"placements": [GOOD[0] | {"slot": 1}, GOOD[1] | {"room": "A"}]},
            "capacity 50",
        ),
        (placed(slot=2), "speaker S1 is not available at slot 2"),
        ({"placements": [GOOD[0], GOOD[1] | {"slot": 0}], "notes": ""}, "slot 0 holds 2 talks"),
        ({"placements": GOOD[:1], "notes": ""}, "but the session has"),
    ],
)
def test_the_auditor_fails_what_the_data_contradicts(output: dict, reason: str) -> None:
    answer = ask("place", PLACE_DATA, output)
    assert answer["verdict"] == "fail"
    assert any(reason in found for found in answer["reasons"]), answer["reasons"]


def test_the_auditor_checks_extractions_and_blurbs_too() -> None:
    extract_data = {
        "session": {"id": "s", "talk_ids": ["T1"]},
        "speaker_ids": ["S1"],
        "days": [1, 2],
        "slots": SLOTS,
    }
    good = {
        "speakers": [
            {"speaker_id": "S1", "available": [{"day": 1, "slots": [0]}], "preference": "none"}
        ],
        "talks": [{"talk_id": "T1", "expected_attendance": 30}],
        "reused_fact_keys": [],
    }
    assert ask("extract", extract_data, good)["verdict"] == "pass"
    assert ask("extract", extract_data, good | {"talks": []})["verdict"] == "fail"
    out_of_range = good["speakers"][0] | {"available": [{"day": 3, "slots": [0]}]}
    assert ask("extract", extract_data, good | {"speakers": [out_of_range]})["verdict"] == "fail"

    blurb_data = {"path": "sessions/s/blurb.md"}
    assert (
        ask("blurb", blurb_data, {"blurb": "A fine session.", "path": "sessions/s/blurb.md"})[
            "verdict"
        ]
        == "pass"
    )
    assert (
        ask("blurb", blurb_data, {"blurb": " ", "path": "sessions/s/blurb.md"})["verdict"] == "fail"
    )
    assert (
        ask("blurb", blurb_data, {"blurb": "A fine session.", "path": "elsewhere.md"})["verdict"]
        == "fail"
    )
