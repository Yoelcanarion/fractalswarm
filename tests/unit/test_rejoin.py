"""A falsely declared member that is back before any heir took its goals (found by a real
C3 run: o2 was declared dead and rejoined in the same millisecond, dropped ``track-ai`` as a
zombie, nobody adopted it because o2 was alive again, and the root waited forever).

A member back from a false death can also own the same goal again, so every takeover needs
its own idem key: the kernel drops an event whose key is already in the log."""

from fractalswarm.actors.chaos_toy import PROGRESS, _take_over, coord_init
from fractalswarm.actors.orchestrator import _reconcile, orchestrator_init
from fractalswarm.comms.chaos import ProgressView
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


def logs(finished: bool = True) -> tuple[TreeView, MembersView]:
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
        (
            "member.joined",
            {"member": "o1", "incarnation": 0, "role": "coordinator", "group": "o0"},
            "o1",
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
    for day in (1, 2) if finished else ():
        result = {"goal_id": f"track-ai/d{day}", "status": "ok", "output": {"placements": []}}
        items.append(("msg.sent", sent("o2", "result", result), f"o2.{day}"))
    for seq, (event_type, payload, actor) in enumerate(items, start=1):
        for view in (tree, members):
            view.apply(event(seq, event_type, payload, actor))
    return tree, members


def track_lead(actor_id: str) -> dict:
    args = {"level": 1, "fanout": [3, 2], "agents_per_leaf": 2, "parent": "o0"}
    args |= {"membership": True, "max_attempts": 6, "max_steps": 8}
    return orchestrator_init(actor_id, args | {"task": "t2_conference"})


def view_of(actor_id: str, tree: TreeView, members: MembersView, epoch: int) -> View:
    return View(
        run_id="r",
        seed="1",
        actor_id=actor_id,
        now=100 + epoch,
        lamport=100 + epoch,
        alive=("o0", "o1", "o2", "o2.1", "o2.2"),
        member_epoch=epoch,
        views={"tree": tree, "members": members},
    )


def test_a_member_back_alive_takes_back_the_goals_it_dropped() -> None:
    tree, members = logs()
    state = track_lead("o2")
    state["det"].incarnation = 1  # it rejoined
    state = {**state, "dropped": ["track-ai"]}
    view = view_of("o2", tree, members, epoch=3)
    state, commands = _reconcile(state, view)
    remaps = [c.payload for c in commands if isinstance(c, Emit) and c.type == "ownership.remapped"]
    assert remaps and remaps[0]["key"] == "track-ai" and remaps[0]["owner"] == "o2"
    # Both session results were already in the log: the track completes and reports up.
    results = [c for c in commands if isinstance(c, Send) and c.topic == "result"]
    assert [(c.to, c.body["goal_id"], c.body["status"]) for c in results] == [
        ("o0", "track-ai", "ok")
    ]
    assert state["dropped"] == []


def test_every_takeover_of_a_goal_reaches_the_log() -> None:
    """o2 takes ``track-ai`` back, dies again, and o1 inherits it from o2 a second time. The
    kernel drops an event whose idem key is already in the log, so each takeover needs its
    own key, or the tree keeps a dead owner and nobody watches the goal."""
    tree, members = logs(finished=False)
    seen: set[str] = set()

    def logged(actor: str, commands: list) -> None:
        for command in commands:
            if not isinstance(command, Emit) or command.idem_key in seen:
                continue  # what the event store does with a known key
            if command.idem_key is not None:
                seen.add(command.idem_key)
            for view in (tree, members):
                view.apply(event(len(seen) + 100, command.type, command.payload, actor))

    o2 = {**track_lead("o2"), "dropped": ["track-ai"]}
    o2["det"].incarnation = 1
    o2, commands = _reconcile(o2, view_of("o2", tree, members, epoch=3))
    logged("o2", commands)
    assert tree.owner_of("track-ai") == "o2"

    verdict = {"member": "o2", "incarnation": 1, "by": "o3", "by_incarnation": 0}
    logged("o3", [Emit(type="member.dead", payload=verdict | {"missed": 5, "last_heard_ms": 0})])
    o1, commands = _reconcile(track_lead("o1"), view_of("o1", tree, members, epoch=4))
    logged("o1", commands)
    remaps = [c for c in commands if isinstance(c, Emit) and c.type == "ownership.remapped"]
    assert [(c.payload["previous"], c.payload["owner"]) for c in remaps] == [("o2", "o1")]
    assert tree.owner_of("track-ai") == "o1"


def test_a_toy_coordinator_back_from_a_false_death_owns_a_contract_again() -> None:
    """c1 loses k00 to c2, comes back and takes it when c2 dies, then dies again. c2's second
    takeover from c1 must reach the log, or k00 stays with a dead owner and the run stalls."""
    members, progress = MembersView(), ProgressView(PROGRESS)
    seen: set[str] = set()
    epoch = 0

    def log(actor: str, event_type: str, payload: dict, key: str | None = None) -> None:
        nonlocal epoch
        if key in seen:
            return  # what the event store does with a known key
        if key is not None:
            seen.add(key)
        epoch += event_type in ("member.joined", "member.dead")
        for view in (members, progress):
            view.apply(event(200 + len(seen) + epoch, event_type, payload, actor))

    def joined(member: str, incarnation: int) -> None:
        payload = {"member": member, "incarnation": incarnation, "role": "coordinator"}
        log(member, "member.joined", payload | {"group": "root"})

    def dead(member: str, incarnation: int, by: str, by_incarnation: int) -> None:
        verdict = {"member": member, "incarnation": incarnation, "by": by}
        verdict |= {"by_incarnation": by_incarnation, "missed": 5, "last_heard_ms": 0}
        log(by, "member.dead", verdict)

    def take_over(actor: str, incarnation: int) -> str | None:
        state = coord_init(actor, {"coordinators": ["c1", "c2"], "deadline_ms": 1000})
        state.det.incarnation = incarnation
        views = {"members": members, "progress": progress}
        view = View(
            run_id="r",
            seed="1",
            actor_id=actor,
            now=100,
            lamport=100,
            alive=("c1", "c2"),
            member_epoch=epoch,
            views=views,
        )
        for command in _take_over(state, view):
            log(actor, command.type, command.payload, command.idem_key)
        return progress.items["k00"].owner

    joined("c1", 0)
    joined("c2", 0)
    log("c1", "toy.contract.created", {"keys": ["k00"]})
    log("c1", "toy.ownership.assigned", {"owner": "c1", "keys": ["k00"]})
    dead("c1", 0, by="c2", by_incarnation=0)
    assert take_over("c2", 0) == "c2"
    joined("c1", 1)
    dead("c2", 0, by="c1", by_incarnation=1)
    assert take_over("c1", 1) == "c1"
    joined("c2", 1)
    dead("c1", 1, by="c2", by_incarnation=1)
    assert take_over("c2", 1) == "c2"
