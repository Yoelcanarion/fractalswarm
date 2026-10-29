"""The answer path of ``escalation.opened`` (actors/arbitration.py: ``judge``, ``answer``, ``step``;
actors/board.py: ``fact.overrule``; api/lens.py: the sentences and the disputes' answers): the parts
that need no run. The runs are in tests/integration/test_escalation_answer.py.

A person answers an escalation with ``control.injected{op: "answer", to: "goal:<id>", body:
{escalation_id, choice}}``. The owner of the goal judges it against the log alone: an answer is
accepted when the escalation exists at that goal, nobody had answered it, its ``timeout_ms`` had
not run out when the person answered and the choice is one of its options. Either way the verdict
is ``escalation.answered``; an accepted choice other than the ruling's also overrules it.
"""

import json
from types import SimpleNamespace
from typing import Any

import pytest

from fractalswarm.actors import arbitration
from fractalswarm.actors.arbitration import (
    ESCALATION_TIMEOUT_MS,
    HUMAN,
    IDEM_ANSWERED,
    MAX_ANSWER_CHARS,
    OP_ANSWER,
    TOPIC_OVERRULE,
    Dispute,
    DisputesView,
    Tools,
    answer,
    gate,
    judge,
    step,
)
from fractalswarm.actors.board import board_handle, board_init
from fractalswarm.api.lens import describe, disputes_view
from fractalswarm.kernel.events import ENV, Event, validate_payload
from fractalswarm.kernel.scheduler import Emit, Send, View

KEY = "speaker:S02:availability"
ESCALATION = f"arbitration:{KEY}"
READ_A = {"available": [{"day": 1, "slots": [0, 1, 2]}], "preference": "morning"}
READ_B = {"available": [{"day": 1, "slots": [0, 1, 2, 3]}], "preference": "morning"}
OPENED = 1_000  # the virtual time the escalation opened
DEADLINE = OPENED + ESCALATION_TIMEOUT_MS
INSIDE = OPENED + 5_000  # a person answers in time
TREE = {"track-hci/d1": "track-hci", "track-ai/d1": "track-ai", "track-hci": "root"}


def event(
    seq: int,
    event_type: str,
    payload: dict[str, Any],
    actor: str = "o0",
    ts: int | None = None,
    idem: str | None = None,
) -> Event:
    return Event(
        run_id="r",
        ts_virtual=seq * 10 if ts is None else ts,
        lamport=seq,
        type=event_type,
        actor=actor,
        idem_key=idem or f"k{seq}",
        payload=payload,
        seq=seq,
        prev_hash="0",
        hash="0",
    )


def view_of(disputes: DisputesView, *, now: int = 0, **views: Any) -> View:
    return View(
        run_id="r",
        seed="1",
        actor_id="o0",
        now=now,
        lamport=7,
        alive=("o0", "o1"),
        views={"disputes": disputes} | views,
    )


def candidate(label: str, value: Any, goal: str, contract: str, lamport: int) -> dict[str, Any]:
    by = {
        "work": f"{goal}/extract",
        "contract": contract,
        "goal": goal,
        "agent": f"agent-of-{contract}",
        "squad": "s",
        "sources": ["E02"],
        "lamport": lamport,
    }
    return {"label": label, "value": value, "by": [by]}


CANDIDATES = (
    candidate("A", READ_A, "track-hci/d1", "c-hci", 5),
    candidate("B", READ_B, "track-ai/d1", "c-ai", 9),
)


def contested(seq: int = 1) -> Event:
    conflict = {"key": KEY, "subject": "S02", "candidates": list(CANDIDATES)}
    payload = {"kind": "semantic", "goal_id": "track-ai/d1", "holder": "agent-of-c-ai"}
    return event(seq, "collision.detected", payload | {"conflicts": [conflict]}, actor="board")


def ruling(winner: str = "A") -> dict[str, Any]:
    chosen = next(c for c in CANDIDATES if c["label"] == winner)
    return {
        "key": KEY,
        "subject": "S02",
        "winner": winner,
        "work": chosen["by"][0]["work"],
        "contract": chosen["by"][0]["contract"],
        "value": chosen["value"],
        "reason": "the email is not clear",
        "confidence": 0.4,
        "evidence": ["E02"],
        "attempt": 1,
        "by": "arbiter",
        "arbiter": "o0",
        "lca": "root",
        "reused": False,
    }


def escalation_payload(goal: str = "root") -> dict[str, Any]:
    return {
        "id": ESCALATION,
        "kind": "arbitration",
        "key": KEY,
        "goal_id": goal,
        "question": f"Which value of {KEY} is right?",
        "options": ["A", "B"],
        "confidence": 0.4,
        "timeout_ms": ESCALATION_TIMEOUT_MS,
        "default": "A",
    }


def escalated(winner: str = "A") -> DisputesView:
    """A dispute the arbiter ruled on doubtfully (``winner``), whose escalation opened at OPENED."""
    disputes = DisputesView()
    disputes.apply(contested())
    disputes.apply(event(5, "arbitration.ruled", ruling(winner)))
    disputes.apply(event(6, "escalation.opened", escalation_payload(), ts=OPENED))
    return disputes


def control(
    seq: int,
    choice: Any,
    ts: int = INSIDE,
    *,
    escalation_id: Any = ESCALATION,
    to: str = "goal:root",
    op: str = OP_ANSWER,
) -> Event:
    body = {"escalation_id": escalation_id, "choice": choice}
    return event(seq, "control.injected", {"op": op, "body": body, "to": to}, actor=ENV, ts=ts)


class Written:
    """What an orchestrator's fenced writes come to: the events it would emit, in order."""

    def __init__(self) -> None:
        self.emitted: list[tuple[str, str, dict[str, Any], str | None]] = []

    def tools(self) -> Tools:
        def emit(gid: str, event_type: str, payload: dict[str, Any], idem_key=None):
            self.emitted.append((gid, event_type, payload, idem_key))
            return Emit(type=event_type, payload=payload, idem_key=idem_key)

        return Tools(emit=emit, route=lambda r: r, parent_of=TREE.get, board="board")

    def types(self) -> list[str]:
        return [item[1] for item in self.emitted]

    def payload(self, event_type: str) -> dict[str, Any]:
        return next(p for _, t, p, _ in self.emitted if t == event_type)

    def idem(self, event_type: str) -> str | None:
        return next(i for _, t, _, i in self.emitted if t == event_type)

    def land(self, disputes: DisputesView, first_seq: int) -> None:
        """The log takes what was emitted: the view sees it."""
        for offset, (_, kind, payload, idem) in enumerate(self.emitted):
            disputes.apply(event(first_seq + offset, kind, payload, idem=idem))
        self.emitted.clear()


def owner_state(actor: str = "o0", goals: tuple[str, ...] = ("root",)) -> dict[str, Any]:
    return {"id": actor, "task": "t2_conference", "goals": {g: {"phase": "running"} for g in goals}}


def answered(
    disputes: DisputesView,
    command: Event,
    state: dict[str, Any] | None = None,
    **views: Any,
) -> tuple[Written, list[Any]]:
    written = Written()
    view = view_of(disputes, **views)
    commands = answer(state or owner_state(), view, command, written.tools())
    return written, commands


def verdict_of(written: Written) -> dict[str, Any]:
    return written.payload("escalation.answered")


# -- the events are valid payloads ------------------------------------------------------------


def test_the_new_events_validate_have_their_defaults_and_refuse_extra_fields() -> None:
    logged = {"id": ESCALATION, "choice": "B", "by": HUMAN, "accepted": True, "overruled": True}
    found = validate_payload("escalation.answered", logged)
    assert (found["reason"], found["fence"]) == ("", None)
    chose = {"key": KEY, "winner": "B", "contract": "c-ai", "value": READ_B}
    found = validate_payload("arbitration.overruled", chose)
    assert (found["work"], found["fence"]) == ("", None)
    for name, payload in (("escalation.answered", logged), ("arbitration.overruled", chose)):
        with pytest.raises(ValueError):
            validate_payload(name, payload | {"surprise": 1})
    with pytest.raises(ValueError):
        validate_payload("escalation.answered", {"id": ESCALATION, "choice": "B"})


# -- the view: what the log says about an escalation and its answers --------------------------


def test_an_answer_attaches_to_its_dispute_accepted_or_not() -> None:
    disputes = escalated()
    ignored = {"id": ESCALATION, "choice": "C", "by": HUMAN, "accepted": False, "overruled": False}
    taken = {"id": ESCALATION, "choice": "B", "by": HUMAN, "accepted": True, "overruled": True}
    disputes.apply(event(10, "escalation.answered", ignored, idem="escalation.answered:9"))
    disputes.apply(event(11, "escalation.answered", taken, idem="escalation.answered:8"))
    (dispute,) = disputes.disputes.values()
    assert [a["choice"] for a in dispute.answers] == ["C", "B"]
    assert dispute.answers[0]["seq"] == 10 and dispute.answers[1]["ts_virtual"] == 110
    assert dispute.answer() == dispute.answers[1], "the first accepted answer is the one"


def test_an_answer_to_an_id_nobody_opened_has_nothing_to_attach_to() -> None:
    disputes = escalated()
    stray = {"id": "arbitration:speaker:S99:availability", "choice": "A", "by": HUMAN}
    disputes.apply(
        event(10, "escalation.answered", stray | {"accepted": False, "overruled": False})
    )
    assert all(d.answers == [] for d in disputes.disputes.values())


def test_the_escalation_is_recorded_once_with_the_time_it_opened() -> None:
    disputes = escalated()
    disputes.apply(event(7, "escalation.opened", escalation_payload("track-ai"), ts=OPENED + 99))
    dispute = disputes.escalated(ESCALATION)
    assert dispute is not None and dispute.escalation is not None
    assert dispute.escalation["opened_ms"] == OPENED and dispute.escalation["goal_id"] == "root"
    assert disputes.escalated("arbitration:unknown") is None


def test_an_overruling_replaces_the_value_the_fact_stands_on_once() -> None:
    disputes = escalated("A")
    (dispute,) = disputes.disputes.values()
    assert dispute.value() == READ_A
    chose = {"key": KEY, "winner": "B", "contract": "c-ai", "value": READ_B, "work": "w"}
    disputes.apply(event(10, "arbitration.overruled", chose))
    assert dispute.value() == READ_B
    again = chose | {"winner": "A", "contract": "c-hci", "value": READ_A}
    disputes.apply(event(11, "arbitration.overruled", again))
    assert dispute.value() == READ_B, "the first overruling is the one"


def test_an_overruling_of_a_dispute_with_no_ruling_is_not_recorded() -> None:
    disputes = DisputesView()
    disputes.apply(contested())
    chose = {"key": KEY, "winner": "B", "contract": "c-ai", "value": READ_B}
    disputes.apply(event(10, "arbitration.overruled", chose))
    (dispute,) = disputes.disputes.values()
    assert dispute.overruled is None


def test_a_dispute_with_no_ruling_has_no_value_to_stand_on() -> None:
    disputes = DisputesView()
    disputes.apply(contested())
    (dispute,) = disputes.disputes.values()
    with pytest.raises(AssertionError):
        dispute.value()


def test_the_view_keeps_an_answer_until_some_owner_logs_its_verdict() -> None:
    disputes = escalated()
    disputes.apply(control(20, "B"))
    disputes.apply(control(21, "A"))
    assert [c["seq"] for c in disputes.unjudged()] == [20, 21]
    first = disputes.unjudged()[0]
    assert (first["ts_virtual"], first["to"]) == (INSIDE, "goal:root")
    assert first["body"] == {"escalation_id": ESCALATION, "choice": "B"}
    verdict = {"id": ESCALATION, "choice": "B", "by": HUMAN, "accepted": True, "overruled": True}
    disputes.apply(event(30, "escalation.answered", verdict, idem=f"{IDEM_ANSWERED}:20"))
    assert [c["seq"] for c in disputes.unjudged()] == [21], "the verdict of 20 judged 20 only"


def test_a_verdict_of_any_orchestrator_clears_the_answer() -> None:
    disputes = escalated()
    disputes.apply(control(20, "B"))
    verdict = {"id": ESCALATION, "choice": "B", "by": HUMAN, "accepted": False, "overruled": False}
    disputes.apply(
        event(30, "escalation.answered", verdict, actor="o1", idem=f"{IDEM_ANSWERED}:20")
    )
    assert disputes.unjudged() == []


@pytest.mark.parametrize(
    "found",
    [
        control(20, "B", op="approve"),
        control(20, "B", to="*"),
        control(20, "B", to="o0"),
        control(20, 5),
        control(20, "B", escalation_id=None),
        event(20, "control.injected", {"op": "answer", "body": {}, "to": "goal:root"}, actor=ENV),
    ],
)
def test_a_control_that_is_not_an_answer_to_a_goal_is_not_kept(found: Event) -> None:
    disputes = escalated()
    disputes.apply(found)
    assert disputes.unjudged() == []


# -- judge: the log's verdict -----------------------------------------------------------------


def verdict(disputes: DisputesView, choice: str = "B", at: int = INSIDE, **over: Any):
    arguments = {"goal": "root", "asked": ESCALATION, "chosen": choice, "at": at} | over
    return judge(
        disputes, arguments["goal"], arguments["asked"], arguments["chosen"], arguments["at"]
    )


def test_an_answer_in_time_naming_an_option_is_accepted() -> None:
    dispute, picked, why = verdict(escalated())
    assert why == "" and dispute is not None
    assert picked is not None and picked["label"] == "B" and picked["value"] == READ_B


def test_an_unknown_escalation_is_ignored() -> None:
    dispute, picked, why = verdict(escalated(), asked="arbitration:speaker:S99:availability")
    assert (dispute, picked) == (None, None)
    assert why == "no escalation arbitration:speaker:S99:availability is open at root"


def test_an_escalation_of_another_goal_is_ignored() -> None:
    dispute, picked, why = verdict(escalated(), goal="track-ai")
    assert dispute is None and picked is None and "no escalation" in why and "track-ai" in why


def test_an_escalation_that_has_no_ruling_yet_is_ignored() -> None:
    disputes = DisputesView()
    disputes.apply(contested())
    disputes.apply(event(6, "escalation.opened", escalation_payload(), ts=OPENED))
    _, picked, why = verdict(disputes)
    assert picked is None and why.startswith("no escalation")


def test_a_choice_that_is_not_an_option_is_ignored() -> None:
    for choice in ("C", "a", "", "A "):
        dispute, picked, why = verdict(escalated(), choice=choice)
        assert dispute is not None and picked is None, repr(choice)
        assert why == f"{choice} is not one of the options (A, B)"


def test_an_option_that_names_no_candidate_is_ignored() -> None:
    disputes = escalated()
    (dispute,) = disputes.disputes.values()
    assert dispute.escalation is not None
    dispute.escalation["options"] = ["A", "B", "C"]  # an option the board has no value for
    assert verdict(disputes, choice="C")[1] is None


def test_a_second_answer_is_ignored_but_an_ignored_first_does_not_count() -> None:
    disputes = escalated()
    fumble = {"id": ESCALATION, "choice": "C", "by": HUMAN, "accepted": False, "overruled": False}
    disputes.apply(event(10, "escalation.answered", fumble, idem="escalation.answered:9"))
    assert verdict(disputes)[2] == "", "an answer that was ignored did not answer anything"
    taken = fumble | {"choice": "B", "accepted": True, "overruled": True}
    disputes.apply(event(11, "escalation.answered", taken, idem="escalation.answered:10"))
    _, picked, why = verdict(disputes, choice="A")
    assert picked is None and why == "the escalation was already answered (B)"


def test_an_answer_is_in_time_up_to_the_deadline_and_late_after_it() -> None:
    disputes = escalated()
    assert verdict(disputes, at=DEADLINE)[2] == "", "exactly at the end is in time"
    _, picked, why = verdict(disputes, at=DEADLINE + 1)
    assert picked is None
    assert why == f"the answer came 1 ms after the time to answer ({ESCALATION_TIMEOUT_MS} ms)"
    assert verdict(disputes, at=OPENED)[2] == "", "even the moment it opened"


def test_the_time_to_answer_is_the_escalations_own() -> None:
    disputes = escalated()
    (dispute,) = disputes.disputes.values()
    assert dispute.escalation is not None
    dispute.escalation["timeout_ms"] = 10
    assert verdict(disputes, at=OPENED + 10)[2] == "" and verdict(disputes, at=OPENED + 11)[2]


# -- answer: the owner's turn ---------------------------------------------------------------


def test_an_answer_that_names_the_ruling_confirms_it_and_nothing_else_moves() -> None:
    written, commands = answered(escalated("A"), control(20, "A"))
    assert written.types() == ["escalation.answered"]
    assert commands == [
        Emit(
            type="escalation.answered", payload=verdict_of(written), idem_key=f"{IDEM_ANSWERED}:20"
        )
    ]
    assert verdict_of(written) == {
        "id": ESCALATION,
        "choice": "A",
        "by": HUMAN,
        "accepted": True,
        "overruled": False,
        "reason": "confirms the ruling",
    }
    assert written.emitted[0][0] == "root", "written under the goal's fence"


def test_an_answer_that_names_another_candidate_overrules_the_ruling() -> None:
    written, commands = answered(escalated("A"), control(20, "B"))
    assert written.types() == ["escalation.answered", "arbitration.overruled"]
    assert verdict_of(written)["accepted"] is True and verdict_of(written)["overruled"] is True
    assert verdict_of(written)["reason"] == "overrules A with B"
    assert written.payload("arbitration.overruled") == {
        "key": KEY,
        "winner": "B",
        "contract": "c-ai",
        "value": READ_B,
        "work": "track-ai/d1/extract",
    }
    assert written.idem("arbitration.overruled") == f"arbitration.overruled:{KEY}"
    order = commands[-1]
    assert isinstance(order, Send) and (order.to, order.topic) == ("board", TOPIC_OVERRULE)
    assert order.body == {"key": KEY, "contract": "c-ai", "by": "o0"}


def test_the_other_ruling_can_be_overruled_the_other_way() -> None:
    written, _ = answered(escalated("B"), control(20, "A"))
    assert written.payload("arbitration.overruled")["contract"] == "c-hci"
    assert verdict_of(written)["reason"] == "overrules B with A"


def test_the_verdict_has_one_idem_key_per_control_whoever_writes_it() -> None:
    first, _ = answered(escalated(), control(20, "B"))
    second, _ = answered(escalated(), control(21, "B"))
    assert first.idem("escalation.answered") == f"{IDEM_ANSWERED}:20"
    assert second.idem("escalation.answered") == f"{IDEM_ANSWERED}:21"


IGNORED = {
    "a choice that is not an option": (control(20, "C"), "C is not one of the options"),
    "an unknown escalation": (control(20, "A", escalation_id="arbitration:nope"), "no escalation"),
    "an escalation of another goal": (control(20, "A", to="goal:track-ai"), "no escalation"),
    "an answer after the time to answer": (control(20, "B", ts=DEADLINE + 1), "after the time"),
}


@pytest.mark.parametrize("name", sorted(IGNORED))
def test_an_answer_that_cannot_be_accepted_is_logged_and_changes_nothing(name: str) -> None:
    command, why = IGNORED[name]
    state = owner_state(goals=("root", "track-ai"))
    written, commands = answered(escalated(), command, state)
    assert written.types() == ["escalation.answered"], "no overruling, no order to the board"
    logged = verdict_of(written)
    assert logged["accepted"] is False and logged["overruled"] is False
    assert logged["choice"] == command.payload["body"]["choice"] and logged["by"] == HUMAN
    assert why in logged["reason"]
    assert [c.type for c in commands if isinstance(c, Emit)] == ["escalation.answered"]
    assert not [c for c in commands if isinstance(c, Send)]


def test_a_second_answer_is_logged_and_changes_nothing() -> None:
    disputes = escalated("A")
    first, _ = answered(disputes, control(20, "B"))
    first.land(disputes, 30)
    second, commands = answered(disputes, control(21, "A"))
    assert second.types() == ["escalation.answered"]
    logged = verdict_of(second)
    assert (logged["accepted"], logged["overruled"]) == (False, False)
    assert logged["reason"] == "the escalation was already answered (B)"
    assert not [c for c in commands if isinstance(c, Send)]


def test_an_answer_for_a_goal_the_orchestrator_does_not_hold_is_not_its_business() -> None:
    written, commands = answered(escalated(), control(20, "B"), owner_state(goals=("track-ai",)))
    assert commands == [] and written.emitted == []


def test_only_the_owner_of_the_goal_by_the_tree_acts() -> None:
    mine = SimpleNamespace(owner_of=lambda goal: "o0")
    theirs = SimpleNamespace(owner_of=lambda goal: "o1")
    assert answered(escalated(), control(20, "B"), tree=mine)[1] != []
    assert answered(escalated(), control(20, "B"), tree=theirs)[1] == []
    unknown = SimpleNamespace(owner_of=lambda goal: None)
    assert answered(escalated(), control(20, "B"), tree=unknown)[1] != [], (
        "no tree seat: it holds it"
    )


@pytest.mark.parametrize("to", ["*", "o0", "chaos", "goal"])
def test_an_answer_not_addressed_to_a_goal_is_not_judged(to: str) -> None:
    assert answered(escalated(), control(20, "B", to=to))[1] == []


def test_a_body_that_is_not_an_answer_is_left_alone() -> None:
    for command in (control(20, 5), control(20, "B", escalation_id=7)):
        assert answered(escalated(), command)[1] == []


def test_what_a_person_typed_is_cut_to_a_logged_size() -> None:
    long = "x" * (4 * MAX_ANSWER_CHARS)
    written, _ = answered(escalated(), control(20, long, escalation_id=long))
    logged = verdict_of(written)
    assert len(logged["id"]) == len(logged["choice"]) == MAX_ANSWER_CHARS
    assert logged["accepted"] is False


def test_an_answer_is_judged_at_the_time_it_was_given_not_the_time_it_is_handled() -> None:
    disputes = escalated()
    command = control(20, "B", ts=INSIDE)
    written = Written()
    late_view = view_of(disputes, now=DEADLINE + 50_000)  # the owner got to it long after
    answer(owner_state(), late_view, command, written.tools())
    assert verdict_of(written)["accepted"] is True


# -- step: an answer that reached no owner ------------------------------------------------------


def stepped(disputes: DisputesView, state: dict[str, Any] | None = None, **views: Any):
    written = Written()
    commands = step(
        state or owner_state(), view_of(disputes, now=DEADLINE * 3, **views), written.tools()
    )
    return written, commands


def test_an_answer_with_no_verdict_is_judged_by_the_owner_that_finds_it() -> None:
    disputes = escalated("A")
    disputes.apply(control(20, "B", ts=INSIDE))
    written, _ = stepped(disputes)
    assert written.types() == ["escalation.answered", "arbitration.overruled"]
    assert verdict_of(written)["accepted"] is True, "given in time, however late it is found"
    assert written.idem("escalation.answered") == f"{IDEM_ANSWERED}:20"


def test_an_answer_given_too_late_is_judged_late_however_soon_it_is_found() -> None:
    disputes = escalated("A")
    disputes.apply(control(20, "B", ts=DEADLINE + 1))
    written, _ = stepped(disputes)
    logged = verdict_of(written)
    assert logged["accepted"] is False and "after the time to answer" in logged["reason"]
    assert written.types() == ["escalation.answered"]


def test_an_answer_somebody_judged_is_not_judged_again() -> None:
    disputes = escalated("A")
    disputes.apply(control(20, "B"))
    first, _ = stepped(disputes)
    first.land(disputes, 30)
    again, commands = stepped(disputes)
    assert again.emitted == [] and commands == []


def test_a_goal_this_orchestrator_does_not_own_leaves_its_answer_for_its_owner() -> None:
    disputes = escalated()
    disputes.apply(control(20, "B"))
    written, commands = stepped(disputes, owner_state(goals=("track-ai",)))
    assert written.emitted == [] and commands == []
    assert [c["seq"] for c in disputes.unjudged()] == [20]


def test_one_answer_is_judged_per_turn_so_two_answers_cannot_both_be_accepted() -> None:
    disputes = escalated("A")
    disputes.apply(control(20, "B", ts=INSIDE))
    disputes.apply(control(21, "A", ts=INSIDE + 1))
    first, _ = stepped(disputes)
    assert first.types() == ["escalation.answered", "arbitration.overruled"]
    assert first.idem("escalation.answered") == f"{IDEM_ANSWERED}:20", "the oldest first"
    first.land(disputes, 30)
    second, _ = stepped(disputes)
    assert second.types() == ["escalation.answered"]
    assert verdict_of(second)["accepted"] is False
    assert second.idem("escalation.answered") == f"{IDEM_ANSWERED}:21"


def test_a_turn_without_answers_is_what_it_was() -> None:
    disputes = escalated()
    written, commands = stepped(disputes)
    assert written.emitted == [] and commands == []


# -- the gate: contracts not yet dispatched take the person's choice --------------------------


def place_inputs() -> dict[str, Any]:
    speakers = [{"speaker_id": "S02", **READ_B}]
    return {"data": {"constraints": {"speakers": speakers}, "talks": ["T1"]}}


def test_a_contract_not_yet_dispatched_takes_the_value_the_person_chose() -> None:
    disputes = escalated("A")
    state = {"task": "t2_conference"}
    _, ruled = gate(state, "place", place_inputs(), view_of(disputes, now=INSIDE))
    assert ruled["data"]["constraints"]["speakers"][0]["available"] == READ_A["available"]
    chose = {"key": KEY, "winner": "B", "contract": "c-ai", "value": READ_B, "work": "w"}
    disputes.apply(event(10, "arbitration.overruled", chose))
    until, inputs = gate(state, "place", place_inputs(), view_of(disputes, now=INSIDE))
    assert until is None
    assert inputs["data"]["constraints"]["speakers"][0]["available"] == READ_B["available"]


def test_a_confirmed_ruling_leaves_the_values_as_they_were() -> None:
    disputes = escalated("A")
    state = {"task": "t2_conference"}
    before = gate(state, "place", place_inputs(), view_of(disputes, now=INSIDE))
    verdict_event = {
        "id": ESCALATION,
        "choice": "A",
        "by": HUMAN,
        "accepted": True,
        "overruled": False,
    }
    disputes.apply(event(10, "escalation.answered", verdict_event, idem=f"{IDEM_ANSWERED}:9"))
    assert gate(state, "place", place_inputs(), view_of(disputes, now=INSIDE)) == before


# -- the board: the person's choice replaces the verified fact -----------------------------


def dispatched(disputes: DisputesView, seq: int, goal: str, cid: str, idem: str) -> None:
    payload = {"goal_id": goal, "contract_id": cid, "attempt": 0, "assignee": "a", "idem_key": idem}
    disputes.apply(event(seq, "contract.dispatched", payload | {"work": f"{goal}/{cid}"}))


def board_with_works() -> tuple[dict[str, Any], View]:
    disputes = DisputesView()
    dispatched(disputes, 1, "track-hci/d1", "extract", "c-hci")
    dispatched(disputes, 2, "track-ai/d1", "extract", "c-ai")
    return board_init("board", {"arbitration": True}), view_of(disputes)


def publish(state: dict[str, Any], view: View, contract: str, value: Any) -> list[Any]:
    body = {
        "name": "memory.publish_fact",
        "squad": f"squad-of-{contract}",
        "contract": contract,
        "agent": f"agent-of-{contract}",
        "call_id": f"call-{contract}",
        "args": {"key": KEY, "subject": "S02", "value_json": json.dumps(value), "sources": ["E02"]},
    }
    msg = {"topic": "tool", "body": body, "to": "board"}
    commands = board_handle(state, event(1, "msg.sent", msg, actor=f"agent-of-{contract}"), view)[1]
    for command in commands:  # what the board emits is in the log, and so in the view
        if isinstance(command, Emit) and command.type == "collision.detected":
            view.views["disputes"].apply(event(2, command.type, command.payload, actor="board"))
    return commands


def fact_resolved(commands: list[Any]) -> list[dict[str, Any]]:
    return [c.payload for c in commands if isinstance(c, Emit) and c.type == "fact.resolved"]


def settle(state: dict[str, Any], view: View, winner: str = "c-hci") -> list[Any]:
    """The arbiter ruled for ``winner`` and told the board (the log holds the ruling)."""
    chosen = "A" if winner == "c-hci" else "B"
    view.views["disputes"].apply(event(5, "arbitration.ruled", ruling(chosen)))
    body = {"key": KEY, "contract": winner, "by": "o0"}
    msg = {"topic": arbitration.TOPIC_RESOLVE, "body": body, "to": "board"}
    return board_handle(state, event(6, "msg.sent", msg, actor="o0"), view)[1]


def overrule(
    state: dict[str, Any], view: View, contract: str, *, by: str = "o0", logged: bool = True
) -> list[Any]:
    if logged:
        chose = {"key": KEY, "winner": "?", "contract": contract, "value": None}
        view.views["disputes"].apply(event(7, "arbitration.overruled", chose))
    body = {"key": KEY, "contract": contract, "by": by}
    msg = {"topic": TOPIC_OVERRULE, "body": body, "to": "board"}
    return board_handle(state, event(8, "msg.sent", msg, actor=by), view)[1]


def ruled_board() -> tuple[dict[str, Any], View]:
    """A board whose dispute the arbiter settled for c-hci (version 3 of the fact)."""
    state, view = board_with_works()
    publish(state, view, "c-hci", READ_A)
    publish(state, view, "c-ai", READ_B)
    assert fact_resolved(settle(state, view, "c-hci"))[0]["version"] == 3
    return state, view


def test_the_chosen_candidates_value_replaces_the_verified_fact() -> None:
    state, view = ruled_board()
    (resolved,) = fact_resolved(overrule(state, view, "c-ai"))
    assert resolved == {"key": KEY, "contract": "c-ai", "version": 4, "by": "o0"}
    fact = state["board"].facts[KEY]
    assert (fact.status, fact.visibility, fact.value) == ("verified", "global", READ_B)
    assert fact.provenance.contract == "c-ai" and fact.version == 4
    assert state["board"].search("S02 availability", squad="anyone")[0].value == READ_B


def test_a_second_order_for_the_same_choice_does_nothing() -> None:
    state, view = ruled_board()
    overrule(state, view, "c-ai")
    assert overrule(state, view, "c-ai") == []
    assert state["board"].facts[KEY].version == 4


def test_an_order_the_log_does_not_back_is_ignored() -> None:
    state, view = ruled_board()
    assert overrule(state, view, "c-ai", logged=False) == [], "no overruling in the log"
    assert state["board"].facts[KEY].value == READ_A


def test_an_order_for_another_contract_than_the_logged_choice_is_ignored() -> None:
    state, view = ruled_board()
    view.views["disputes"].apply(
        event(
            7, "arbitration.overruled", {"key": KEY, "winner": "B", "contract": "c-ai", "value": 0}
        )
    )
    assert overrule(state, view, "c-hci", logged=False) == []
    assert state["board"].facts[KEY].value == READ_A
    assert fact_resolved(overrule(state, view, "c-ai", logged=False))


def test_an_order_for_a_key_with_no_ruling_applied_does_nothing() -> None:
    state, view = board_with_works()
    publish(state, view, "c-hci", READ_A)
    publish(state, view, "c-ai", READ_B)
    assert overrule(state, view, "c-ai") == [], "the key is still in dispute: nothing to overrule"
    assert state["board"].facts[KEY].status == "disputed"


def test_an_order_for_a_contract_that_is_no_candidate_does_nothing() -> None:
    state, view = ruled_board()
    assert overrule(state, view, "c-nobody") == []
    assert state["board"].facts[KEY].value == READ_A


def test_an_overruled_key_is_never_disputed_again() -> None:
    state, view = ruled_board()
    overrule(state, view, "c-ai")
    late = publish(state, view, "c-late", {"available": [], "preference": None})
    assert not [c for c in late if isinstance(c, Emit) and c.type == "collision.detected"]
    assert state["board"].facts[KEY].value == READ_B


def test_a_board_that_arbitrates_nothing_has_no_settled_keys() -> None:
    state = board_init("board", {})
    assert state["settled"] == {} and state["arbitration"] is False


# -- the lens words the controls and the answers ------------------------------------------------


def control_event(op: str, body: dict[str, Any], to: str) -> Event:
    return event(1, "control.injected", {"op": op, "body": body, "to": to}, actor=ENV)


def sentence(op: str, body: dict[str, Any], to: str) -> str:
    return describe(control_event(op, body, to))


def test_the_lens_words_a_kill_a_person_asked_for() -> None:
    kill = {"kind": "kill_coordinator", "at": 0.5}
    assert (
        sentence("chaos", kill, "chaos")
        == "a person asked for a coordinator kill at 50% of the run"
    )
    now = sentence("chaos", {"kind": "kill_coordinator", "at": 0, "target": "o2"}, "chaos")
    assert now == "a person asked for a coordinator kill of o2 now"
    agents = {"kind": "kill_agent", "at": 0.25, "count": 3}
    assert (
        sentence("chaos", agents, "chaos")
        == "a person asked for a kill of 3 agents at 25% of the run"
    )
    one = sentence("chaos", {"kind": "kill_agents", "at": 0.1, "target": "a4"}, "chaos")
    assert one == "a person asked for an agent kill of a4 at 10% of the run"
    cut = sentence("chaos", {"kind": "partition", "at": 1}, "chaos")
    assert cut == "a person asked for a network partition at 100% of the run"
    odd = sentence("chaos", {"kind": "set_fire", "at": "soon"}, "chaos")
    assert odd == "a person asked for a set_fire fault now"


def test_the_lens_words_an_approval_and_a_plan_sent_back() -> None:
    assert sentence("approve", {}, "goal:root") == "a person approved the plan for root"
    back = sentence("replan", {"feedback": "too  many\nsessions"}, "goal:root")
    assert back == "a person sent the plan for root back: too many sessions"
    assert sentence("replan", {}, "goal:root").endswith("back: no reason given")
    long = sentence("replan", {"feedback": "x" * 500}, "goal:root")
    assert long.endswith("…") and len(long) < 200


def test_the_lens_words_an_answer_and_any_other_control() -> None:
    answer_body = {"escalation_id": ESCALATION, "choice": "B"}
    assert sentence("answer", answer_body, "goal:root") == f"a person answered {ESCALATION} with B"
    assert sentence("dance", {}, "chaos") == "a person sent dance to chaos"
    assert sentence("approve", {}, "*") == "a person sent approve to *", "an approval needs a goal"


def test_a_control_the_lens_cannot_read_is_named_by_its_type() -> None:
    unreadable = event(1, "control.injected", {"op": "chaos", "to": "chaos", "body": [1]})
    assert describe(unreadable) == "control.injected"


def test_a_chaos_control_with_no_kind_is_worded_without_one() -> None:
    assert sentence("chaos", {}, "chaos") == "a person sent a chaos control"
    assert sentence("chaos", {"kind": 7, "at": 0.5}, "chaos") == "a person sent a chaos control"


def test_the_lens_words_the_verdicts() -> None:
    base = {"id": ESCALATION, "by": HUMAN}
    confirmed = describe(
        event(
            1, "escalation.answered", base | {"choice": "A", "accepted": True, "overruled": False}
        )
    )
    assert confirmed == f"a person confirmed the ruling for {ESCALATION}: A stands"
    overruled = describe(
        event(2, "escalation.answered", base | {"choice": "B", "accepted": True, "overruled": True})
    )
    assert overruled == f"a person overruled the ruling for {ESCALATION} with B"
    ignored = base | {"choice": "C", "accepted": False, "overruled": False}
    ignored |= {"reason": "C is not one of the options (A, B)"}
    assert describe(event(3, "escalation.answered", ignored)) == (
        f"the answer C to {ESCALATION} was ignored: C is not one of the options (A, B)"
    )
    chose = {"key": KEY, "winner": "B", "work": "track-ai/d1/extract"}
    assert describe(event(4, "arbitration.overruled", chose)) == (
        f"the ruling for {KEY} was overruled: B (track-ai/d1/extract) now stands"
    )


# -- the lens lists the answer (api/lens.py: disputes_view) ----------------------------------


def verdict_event(
    seq: int, choice: str, *, accepted: bool, overruled: bool, reason: str = ""
) -> Event:
    payload = {"id": ESCALATION, "choice": choice, "by": HUMAN, "accepted": accepted}
    return event(seq, "escalation.answered", payload | {"overruled": overruled, "reason": reason})


def listing(*more: Event, ended: bool = True, last: int = 9_000) -> dict[str, Any]:
    events = [
        contested(1),
        event(5, "arbitration.ruled", ruling("A")),
        event(6, "escalation.opened", escalation_payload(), ts=OPENED),
        *more,
    ]
    index = (
        [event(900, "run.completed", {}, ts=last)]
        if ended
        else [event(900, "effect.completed", {}, ts=last)]
    )
    lens = SimpleNamespace(rows=[], events=index, halted=None, entry=SimpleNamespace(id="a-run"))
    return disputes_view(lens, events)  # type: ignore[arg-type]


def the_dispute(listed: dict[str, Any]) -> dict[str, Any]:
    (dispute,) = listed["disputes"]
    return dispute


def test_an_escalation_lists_what_a_person_needs_to_answer_it() -> None:
    listed = listing(ended=False, last=OPENED + 10)
    dispute = the_dispute(listed)
    escalation = dispute["escalation"]
    assert (escalation["id"], escalation["goal_id"], escalation["options"]) == (
        ESCALATION,
        "root",
        ["A", "B"],
    )
    assert escalation["question"] == f"Which value of {KEY} is right?"
    assert (escalation["ts_virtual"], escalation["timeout_ms"]) == (OPENED, ESCALATION_TIMEOUT_MS)
    assert escalation["deadline_ts"] == DEADLINE and escalation["state"] == "waiting"
    assert escalation["answers"] == [] and dispute["answer"] is None
    assert dispute["status"] == "ruled" and dispute["standing"] == {"winner": "A", "by": "arbiter"}
    assert (listed["now_ts"], listed["waiting"], listed["open"]) == (OPENED + 10, 1, 0)


def test_the_escalation_state_follows_the_clock_and_the_end_of_the_run() -> None:
    assert the_dispute(listing(ended=False, last=DEADLINE))["escalation"]["state"] == "waiting"
    assert the_dispute(listing(ended=False, last=DEADLINE + 1))["escalation"]["state"] == "expired"
    assert the_dispute(listing(ended=True, last=DEADLINE - 1))["escalation"]["state"] == "closed"
    assert the_dispute(listing(ended=True, last=DEADLINE + 1))["escalation"]["state"] == "expired"
    assert listing(ended=True, last=DEADLINE - 1)["waiting"] == 0


def test_a_confirmed_ruling_is_listed_as_answered() -> None:
    listed = listing(verdict_event(10, "A", accepted=True, overruled=False))
    dispute = the_dispute(listed)
    assert dispute["status"] == "answered" and dispute["escalation"]["state"] == "answered"
    assert dispute["answer"] == {
        "choice": "A",
        "by": HUMAN,
        "overruled": False,
        "seq": 10,
        "ts_virtual": 100,
    }
    assert dispute["standing"] == {"winner": "A", "by": "arbiter"}
    assert dispute["ruling"]["winner"] == "A", "the ruling stays what the arbiter said"
    assert listed["waiting"] == 0


def test_an_overruled_ruling_is_listed_as_overruled_and_what_stands_is_the_persons() -> None:
    listed = listing(verdict_event(10, "B", accepted=True, overruled=True))
    dispute = the_dispute(listed)
    assert dispute["status"] == "overruled" and dispute["escalation"]["state"] == "overruled"
    assert dispute["answer"]["choice"] == "B" and dispute["answer"]["overruled"] is True
    assert dispute["standing"] == {"winner": "B", "by": HUMAN}
    assert dispute["ruling"]["winner"] == "A"


def test_ignored_answers_are_listed_but_do_not_settle_the_escalation() -> None:
    fumble = verdict_event(
        10, "C", accepted=False, overruled=False, reason="C is not one of the options (A, B)"
    )
    listed = listing(fumble, ended=False, last=OPENED + 10)
    dispute = the_dispute(listed)
    assert dispute["status"] == "ruled" and dispute["answer"] is None
    assert dispute["escalation"]["state"] == "waiting" and listed["waiting"] == 1
    (found,) = dispute["escalation"]["answers"]
    assert (found["choice"], found["accepted"], found["seq"]) == ("C", False, 10)
    assert found["reason"] == "C is not one of the options (A, B)"


def test_the_first_accepted_answer_settles_it_and_a_later_one_is_only_listed() -> None:
    taken = verdict_event(10, "B", accepted=True, overruled=True)
    later = verdict_event(
        11, "A", accepted=False, overruled=False, reason="the escalation was already answered (B)"
    )
    dispute = the_dispute(listing(taken, later))
    assert dispute["answer"]["choice"] == "B" and dispute["status"] == "overruled"
    assert [(a["choice"], a["accepted"]) for a in dispute["escalation"]["answers"]] == [
        ("B", True),
        ("A", False),
    ]


def test_an_answer_to_an_unknown_escalation_is_listed_nowhere() -> None:
    stray = verdict_event(10, "A", accepted=False, overruled=False)
    stray = stray.model_copy(
        update={"payload": stray.payload | {"id": "arbitration:speaker:S99:availability"}}
    )
    dispute = the_dispute(listing(stray))
    assert dispute["escalation"]["answers"] == [] and dispute["status"] == "ruled"


def test_a_dispute_with_no_escalation_has_no_answer_to_list() -> None:
    events = [contested(1), event(5, "arbitration.ruled", ruling("A") | {"confidence": 0.9})]
    lens = SimpleNamespace(rows=[], events=[], halted=None, entry=SimpleNamespace(id="a-run"))
    listed = disputes_view(lens, events)  # type: ignore[arg-type]
    dispute = the_dispute(listed)
    assert dispute["escalation"] is None and dispute["answer"] is None
    assert dispute["status"] == "ruled" and dispute["standing"] == {"winner": "A", "by": "arbiter"}
    assert (listed["waiting"], listed["now_ts"]) == (0, 50)


def test_a_dispute_with_no_ruling_has_no_standing_and_no_answer() -> None:
    lens = SimpleNamespace(rows=[], events=[], halted=None, entry=SimpleNamespace(id="a-run"))
    dispute = the_dispute(disputes_view(lens, [contested(1)]))  # type: ignore[arg-type]
    assert dispute["status"] == "open" and dispute["standing"] is None and dispute["answer"] is None


def test_the_disputes_dataclass_has_no_answer_before_one_is_given() -> None:
    dispute = Dispute(key=KEY, subject="S02", goal_id="g", holder="a", opened_ms=0, candidates=[])
    assert dispute.answer() is None and dispute.answers == [] and dispute.overruled is None
