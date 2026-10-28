"""A falsely declared member that is back before any heir took its goals (found by a real
C3 run: o2 was declared dead and rejoined in the same millisecond, dropped ``track-ai`` as a
zombie, nobody adopted it because o2 was alive again, and the root waited forever)."""

from fractalswarm.actors.orchestrator import _reconcile, orchestrator_init
from fractalswarm.coord.membership import MembersView
from fractalswarm.coord.tree import TreeView
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Emit, Send, View

ROOT = {"id": "root", "goal": "g"}
TRACK = {"id": "track-ai", "priority": 1}


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


def sent(to: str, topic: str, body: dict) -> dict:
    return {"to": to, "topic": topic, "body": body}


def spawned(actor: str, kind: str, parent: str | None, args: dict | None = None) -> dict:
    return {"actor_id": actor, "kind": kind, "args": args or {}, "parent": parent}


def logs() -> tuple[TreeView, MembersView]:
    tree, members = TreeView(), MembersView()
    items = [
        ("actor.spawned", spawned("o0", "orchestrator", None, {"root_goal": ROOT}), "@k"),
        ("actor.spawned", spawned("o2", "orchestrator", "o0"), "o0"),
        (
            "member.joined",
            {"member": "o0", "incarnation": 0, "role": "coordinator", "group": None},
            "o0",
        ),
        (
            "member.joined",
            {"member": "o2", "incarnation": 0, "role": "coordinator", "group": "o0"},
            "o2",
        ),
        ("plan.proposed", {"goal_id": "root", "plan": {"p": 1}}, "o0"),
        ("msg.sent", sent("o2", "assign", {"goal": TRACK, "parent": "root", "level": 1}), "o0"),
        ("plan.refined", {"goal_id": "track-ai", "plan": {"s": 2}, "children": []}, "o2"),
    ]
    for day in (1, 2):
        session = {"id": f"track-ai/d{day}", "priority": 1}
        body = {"goal": session, "parent": "track-ai", "level": 2}
        items.append(("msg.sent", sent(f"o2.{day}", "assign", body), "o2"))
    verdict = {"member": "o2", "incarnation": 0, "by": "o3", "by_incarnation": 0}
    items.append(("member.dead", verdict | {"missed": 5, "last_heard_ms": 0}, "o3"))
    items.append(
        (
            "member.joined",
            {"member": "o2", "incarnation": 1, "role": "coordinator", "group": "o0"},
            "o2",
        )
    )
    # The sessions finish and report to o2, which no longer holds the track.
    for day in (1, 2):
        result = {"goal_id": f"track-ai/d{day}", "status": "ok", "output": {"placements": []}}
        items.append(("msg.sent", sent("o2", "result", result), f"o2.{day}"))
    for seq, (event_type, payload, actor) in enumerate(items, start=1):
        for view in (tree, members):
            view.apply(event(seq, event_type, payload, actor))
    return tree, members


def test_a_member_back_alive_takes_back_the_goals_it_dropped() -> None:
    tree, members = logs()
    args = {"level": 1, "fanout": [3, 2], "agents_per_leaf": 2, "parent": "o0"}
    args |= {"membership": True, "max_attempts": 6, "max_steps": 8}
    state = orchestrator_init("o2", args | {"task": "t2_conference"})
    state["det"].incarnation = 1  # it rejoined
    state = {**state, "dropped": ["track-ai"]}
    view = View(
        run_id="r",
        seed="1",
        actor_id="o2",
        now=100,
        lamport=100,
        alive=("o0", "o2", "o2.1", "o2.2"),
        views={"tree": tree, "members": members},
    )
    state, commands = _reconcile(state, view)
    remaps = [c.payload for c in commands if isinstance(c, Emit) and c.type == "ownership.remapped"]
    assert remaps and remaps[0]["key"] == "track-ai" and remaps[0]["owner"] == "o2"
    # Both session results were already in the log: the track completes and reports up.
    results = [c for c in commands if isinstance(c, Send) and c.topic == "result"]
    assert [(c.to, c.body["goal_id"], c.body["status"]) for c in results] == [
        ("o0", "track-ai", "ok")
    ]
    assert state["dropped"] == []
