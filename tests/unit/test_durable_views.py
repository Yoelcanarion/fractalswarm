"""The durable rivals' two views of the log: their own calls, and the goals they opened."""

from fractalswarm.baselines.durable import OwnEffectsView
from fractalswarm.coord.tree import TreeView
from fractalswarm.kernel.events import ENV, Event, validate_payload

ROOT = {"id": "root", "goal": "plan the conference"}
TRACK = {"id": "track-ai", "goal": "the AI track"}


def event(seq: int, event_type: str, payload: dict, actor: str = "o0") -> Event:
    return Event(
        run_id="r",
        ts_virtual=seq,
        lamport=seq,
        type=event_type,
        actor=actor,
        idem_key=f"k{seq}",
        payload=payload,
        seq=seq,
        prev_hash="0",
        hash="0",
    )


def started(seq: int, effect_id: str, tag: str | None, actor: str = "o0") -> Event:
    payload = {"effect_id": effect_id, "kind": "llm", "request": {}, "tag": tag}
    return event(seq, "effect.started", payload, actor)


def completed(seq: int, effect_id: str, tag: str | None, actor: str = ENV, **extra) -> Event:
    payload = {"effect_id": effect_id, "kind": "llm", "status": "ok", "result": {}, "tag": tag}
    return event(seq, "effect.completed", payload | extra, actor)


def cancelled(seq: int, effect_id: str, tag: str | None) -> Event:
    return event(seq, "effect.cancelled", {"effect_id": effect_id, "kind": "llm", "tag": tag})


def feed(view: OwnEffectsView, *events: Event) -> OwnEffectsView:
    for item in events:
        view.apply(item)
    return view


# -- OwnEffectsView ----------------------------------------------------------------------


def test_a_call_is_in_flight_from_its_start_to_its_completion() -> None:
    view = feed(OwnEffectsView(), started(1, "e1", "plan|root|0"))
    assert view.in_flight("o0", "plan|root|0")
    assert view.completion("o0", "plan|root|0") is None
    done = completed(2, "e1", "plan|root|0", result={"output_text": "the plan"})
    view.apply(done)
    assert not view.in_flight("o0", "plan|root|0")
    assert view.completion("o0", "plan|root|0") is done


def test_a_cancelled_call_is_neither_in_flight_nor_completed() -> None:
    view = feed(
        OwnEffectsView(), started(1, "e1", "judge|g|c|0"), cancelled(2, "e1", "judge|g|c|0")
    )
    assert not view.in_flight("o0", "judge|g|c|0")
    assert view.completion("o0", "judge|g|c|0") is None


def test_the_answers_are_per_actor_and_per_tag() -> None:
    view = feed(
        OwnEffectsView(),
        started(1, "e1", "plan|root|0", actor="o0"),
        started(2, "e2", "plan|root|0", actor="o1"),
        started(3, "e3", "plan|root|1", actor="o0"),
    )
    assert view.in_flight("o0", "plan|root|0") and view.in_flight("o1", "plan|root|0")
    assert view.tags_in_flight("o0") == ["plan|root|0", "plan|root|1"]
    view.apply(completed(4, "e2", "plan|root|0"))
    assert view.in_flight("o0", "plan|root|0") and not view.in_flight("o1", "plan|root|0")
    assert view.completion("o0", "plan|root|0") is None


def test_only_the_coordinators_own_calls_are_tracked() -> None:
    view = feed(
        OwnEffectsView(),
        started(1, "e1", "c-abc123:1", actor="o0.a1"),  # an agent's work call
        started(2, "e2", None),
        started(3, "e3", "central.tick"),
        started(4, "e4", "scan|root|notes.txt"),
    )
    assert view.tags_in_flight("o0") == ["scan|root|notes.txt"]
    assert view.tags_in_flight("o0.a1") == []
    view.apply(completed(5, "e1", "c-abc123:1"))
    assert view.completion("o0.a1", "c-abc123:1") is None


def test_a_call_started_again_supersedes_the_earlier_completion() -> None:
    view = feed(
        OwnEffectsView(),
        started(1, "e1", "plan|root|0"),
        completed(2, "e1", "plan|root|0"),
        started(3, "e2", "plan|root|0"),
    )
    assert view.in_flight("o0", "plan|root|0")
    assert view.completion("o0", "plan|root|0") is None


def test_a_call_the_budget_refused_is_completed_without_having_started() -> None:
    # A refusal is the actor's own reaction: no ``effect.started``, attributed to the actor.
    refused = completed(1, "e1", "plan|root|0", actor="o0", status="refused")
    view = feed(OwnEffectsView(), refused)
    assert not view.in_flight("o0", "plan|root|0")
    assert view.completion("o0", "plan|root|0") is refused


def test_a_completion_nobody_started_is_ignored() -> None:
    view = feed(OwnEffectsView(), completed(1, "e9", "c-abc123:1"), completed(2, "e8", None))
    assert view.tags_in_flight("o0") == []
    assert view.completion("o0", "plan|root|0") is None


# -- goal.opened -------------------------------------------------------------------------


def opened(seq: int, goal: dict, owner: str, parent: str | None, level: int) -> Event:
    payload = {"goal_id": goal["id"], "owner": owner, "parent": parent, "level": level}
    return event(seq, "goal.opened", payload | {"goal": goal}, owner)


def result_for(seq: int, goal_id: str, contract_id: str, attempt: int = 0) -> Event:
    body = {"goal_id": goal_id, "contract_id": contract_id, "attempt": attempt, "output": {"x": 1}}
    return event(seq, "msg.sent", {"to": "o0", "topic": "contract.result", "body": body}, "o0.a1")


def test_goal_opened_registers_the_goal_so_its_results_are_found() -> None:
    tree = TreeView()
    for item in (
        opened(1, ROOT, "o0", None, 0),
        opened(2, TRACK, "o0", "root", 1),
        event(
            3, "contract.created", {"contract": {"id": "c1", "goal_id": "track-ai", "attempt": 0}}
        ),
        result_for(4, "track-ai", "c1"),
    ):
        tree.apply(item)
    record = tree.goals["track-ai"]
    assert (record.owner, record.parent, record.level, record.goal) == ("o0", "root", 1, TRACK)
    assert tree.goals["root"].parent is None and tree.goals["root"].level == 0
    assert tree.children_goals("root") == ["track-ai"]
    assert tree.goals["track-ai"].contracts["c1"].results[0]["output"] == {"x": 1}


def test_a_result_for_a_goal_the_log_never_opened_is_dropped() -> None:
    # What the central baseline's restart sees: TreeView knows only the root goal.
    tree = TreeView()
    tree.apply(opened(1, ROOT, "o0", None, 0))
    tree.apply(
        event(
            2, "contract.created", {"contract": {"id": "c1", "goal_id": "track-ai", "attempt": 0}}
        )
    )
    tree.apply(result_for(3, "track-ai", "c1"))
    assert "track-ai" not in tree.goals


def test_the_first_record_of_a_goal_wins() -> None:
    tree = TreeView()
    tree.apply(opened(1, TRACK, "o0", "root", 1))
    tree.apply(opened(2, {**TRACK, "goal": "changed"}, "o9", "elsewhere", 5))
    tree.apply(
        event(
            3,
            "msg.sent",
            {"to": "o1", "topic": "assign", "body": {"goal": TRACK, "parent": "root", "level": 1}},
        )
    )
    record = tree.goals["track-ai"]
    assert (record.owner, record.parent, record.level) == ("o0", "root", 1)
    assert record.goal == TRACK


def test_an_assignment_registers_a_goal_as_it_always_did() -> None:
    tree = TreeView()
    tree.apply(opened(1, ROOT, "o0", None, 0))
    assign = {"goal": TRACK, "parent": "root", "level": 1}
    tree.apply(event(2, "msg.sent", {"to": "o1", "topic": "assign", "body": assign}))
    record = tree.goals["track-ai"]
    assert (record.owner, record.parent, record.level) == ("o1", "root", 1)


def test_goal_opened_is_a_registered_payload_with_every_field_required() -> None:
    good = {"goal_id": "root", "owner": "o0", "parent": None, "level": 0, "goal": ROOT}
    assert validate_payload("goal.opened", good) == good
    for missing in good:
        bad = {key: value for key, value in good.items() if key != missing}
        try:
            validate_payload("goal.opened", bad)
        except ValueError:
            continue
        raise AssertionError(f"goal.opened accepted a payload without {missing}")
