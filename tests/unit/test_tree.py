"""The tree view of the log, and the heir rule of leaderless takeover (spec §5.3)."""

from fractalswarm.coord.membership import MembersView
from fractalswarm.coord.tree import TreeView, candidates, heir
from fractalswarm.kernel.events import Event

GOAL = {"id": "root", "goal": "g"}


def event(seq: int, event_type: str, payload: dict, actor: str = "x") -> Event:
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


def spawned(actor: str, kind: str, parent: str | None, args: dict | None = None) -> dict:
    return {"actor_id": actor, "kind": kind, "args": args or {}, "parent": parent}


def sent(to: str, topic: str, body: dict) -> dict:
    return {"to": to, "topic": topic, "body": body}


def build(*items: tuple[str, dict, str]) -> TreeView:
    view = TreeView()
    for seq, (event_type, payload, actor) in enumerate(items, start=1):
        view.apply(event(seq, event_type, payload, actor))
    return view


def contract(cid: str, attempt: int = 0, assignee: str = "o1.a1") -> dict:
    return {"id": cid, "goal_id": "t1", "attempt": attempt, "assignee": assignee, "owner": "o1"}


def test_the_view_rebuilds_goals_contracts_and_results_from_the_log() -> None:
    tree = build(
        ("actor.spawned", spawned("o0", "orchestrator", None, {"root_goal": GOAL}), "@kernel"),
        ("actor.spawned", spawned("o1", "orchestrator", "o0"), "o0"),
        ("actor.spawned", spawned("o1.a1", "agent", "o1"), "o1"),
        ("plan.proposed", {"goal_id": "root", "plan": {"p": 1}}, "o0"),
        (
            "msg.sent",
            sent("o1", "assign", {"goal": {"id": "t1"}, "parent": "root", "level": 1}),
            "o0",
        ),
        ("plan.refined", {"goal_id": "t1", "plan": {"p": 2}, "children": ["c1"]}, "o1"),
        ("contract.created", {"contract": contract("c1")}, "o1"),
        ("msg.sent", sent("o1.a1", "contract", {"contract": contract("c1")}), "o1"),
        (
            "msg.sent",
            sent(
                "o1",
                "contract.result",
                {"goal_id": "t1", "contract_id": "c1", "attempt": 0, "output": {"x": 1}},
            ),
            "o1.a1",
        ),
        (
            "effect.completed",
            {"tag": "judge|t1|c1|0", "status": "ok", "result": {"output_text": "pass"}},
            "@env",
        ),
        (
            "msg.sent",
            sent(
                "o1",
                "book.result",
                {"goal_id": "t1", "contract_id": "c1", "attempt": 0, "conflicts": []},
            ),
            "board",
        ),
        ("contract.verified", {"goal_id": "t1", "contract_id": "c1", "attempt": 0}, "o1"),
        ("msg.sent", sent("o0", "result", {"goal_id": "t1", "status": "ok", "output": {}}), "o1"),
    )
    assert tree.goals["root"].owner == "o0" and tree.goals["root"].plan == {"p": 1}
    t1 = tree.goals["t1"]
    assert (t1.owner, t1.parent, t1.level, t1.children) == ("o1", "root", 1, ["c1"])
    record = t1.contracts["c1"]
    assert record.status == "verified"
    assert record.results[0]["output"] == {"x": 1}
    assert record.judged[0] == ("ok", "pass")
    assert record.booked[0] == []
    assert t1.result == {"goal_id": "t1", "status": "ok", "output": {}}
    assert tree.children_goals("root") == ["t1"]
    assert tree.child_actors("o1", "agent") == ["o1.a1"]


def test_remaps_and_adoptions_rewire_owners_and_parents() -> None:
    tree = build(
        ("actor.spawned", spawned("o0", "orchestrator", None, {"root_goal": GOAL}), "@kernel"),
        ("actor.spawned", spawned("o1", "orchestrator", "o0"), "o0"),
        ("actor.spawned", spawned("o1.1", "orchestrator", "o1"), "o1"),
        (
            "ownership.remapped",
            {"group": None, "key": "root", "owner": "o1", "previous": "o0"},
            "o1",
        ),
        (
            "tree.adopted",
            {"dead": "o0", "adopter": "o1", "goal_id": "root", "children": ["o1.1"]},
            "o1",
        ),
    )
    assert tree.owner_of("root") == "o1"
    assert tree.parents["o1.1"] == "o1"
    # Only the first result upward counts, like the first contract result of an attempt.
    tree.apply(event(9, "msg.sent", sent("o0", "result", {"goal_id": "root", "n": 1}), "o1"))
    tree.apply(event(10, "msg.sent", sent("o0", "result", {"goal_id": "root", "n": 2}), "o1"))
    assert tree.goals["root"].result == {"goal_id": "root", "n": 1}


def members(alive: dict[str, str | None], dead: dict[str, str | None]) -> MembersView:
    view = MembersView()
    seq = 0
    for member, group in {**alive, **dead}.items():
        seq += 1
        joined = {"member": member, "incarnation": 0, "role": "coordinator", "group": group}
        view.apply(event(seq, "member.joined", joined))
    for member in dead:
        seq += 1
        verdict = {"member": member, "incarnation": 0, "by": "x", "by_incarnation": 0}
        view.apply(event(seq, "member.dead", verdict | {"missed": 5, "last_heard_ms": 0}))
    return view


def sessions(owners: dict[str, str]) -> TreeView:
    items = [("actor.spawned", spawned("o0", "orchestrator", None, {"root_goal": GOAL}), "@k")]
    items.append(
        (
            "msg.sent",
            sent("o1", "assign", {"goal": {"id": "t1"}, "parent": "root", "level": 1}),
            "o0",
        )
    )
    for gid, owner in owners.items():
        body = {"goal": {"id": gid}, "parent": "t1", "level": 2}
        items.append(("msg.sent", sent(owner, "assign", body), "o1"))
    return build(*items)


def test_the_heir_is_a_live_sibling_and_every_survivor_agrees() -> None:
    tree = sessions({"t1/d1": "o1.1", "t1/d2": "o1.2", "t1/d3": "o1.3"})
    view = members({"o0": None, "o1": "o0", "o1.2": "o1", "o1.3": "o1"}, {"o1.1": "o1"})
    assert candidates("o1.1", view) == ["o1.2", "o1.3"]
    first = heir(tree, "t1/d1", view)
    assert first in ("o1.2", "o1.3")
    assert all(heir(tree, "t1/d1", view) == first for _ in range(5))


def test_the_roots_heir_comes_from_its_children() -> None:
    tree = sessions({})
    view = members({"o1": "o0", "o2": "o0"}, {"o0": None})
    assert candidates("o0", view) == ["o1", "o2"]
    assert heir(tree, "root", view) in ("o1", "o2")


def test_a_dead_sibling_group_has_no_heir_until_the_parent_respawns_one() -> None:
    tree = sessions({"t1/d1": "o1.1", "t1/d2": "o1.2"})
    view = members({"o0": None, "o1": "o0"}, {"o1.1": "o1", "o1.2": "o1"})
    assert heir(tree, "t1/d1", view) is None
    view.apply(
        event(
            99,
            "member.joined",
            {"member": "o1.3", "incarnation": 0, "role": "coordinator", "group": "o1"},
        )
    )
    assert heir(tree, "t1/d1", view) == heir(tree, "t1/d2", view) == "o1.3"
