"""``any_survivor`` (docs/any-survivor.md): a run keeps going while any coordinator lives.

Four rules, each off unless the run asks for it. The ring is checked as a property: it is mutual,
it adds nothing until the log holds a death, and from any live member a verdict reaches every
crashed one.
"""

from pathlib import Path
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.actors.orchestrator import _child_group, _detector, _opt_ins, _peers, _ring
from fractalswarm.actors.swarm import SwarmScenario
from fractalswarm.comms.bus import Endpoint
from fractalswarm.coord import membership
from fractalswarm.coord.membership import ISOLATION_LIMIT_MS, Detector, MembersView
from fractalswarm.coord.tree import ROLE, TreeView, heir, successors
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Emit, Spawn, View
from fractalswarm.planning.taskspec import TaskSpec, run_params

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
NAMES = ("o0", "o1", "o1.1", "o1.2", "o2", "o2.1", "o2.2", "o3", "o3.1", "o3.2")
GROUPS: dict[str, str | None] = {
    "o0": None,
    "o1": "o0",
    "o2": "o0",
    "o3": "o0",
    "o1.1": "o1",
    "o1.2": "o1",
    "o2.1": "o2",
    "o2.2": "o2",
    "o3.1": "o3",
    "o3.2": "o3",
}


def event(seq: int, event_type: str, payload: dict[str, Any], actor: str = "x") -> Event:
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


def members(dead: set[str] | frozenset[str] = frozenset(), names=NAMES) -> MembersView:
    view = MembersView()
    seq = 0
    for member in names:
        seq += 1
        joined = {"member": member, "incarnation": 0, "role": ROLE, "group": GROUPS[member]}
        view.apply(event(seq, "member.joined", joined))
    for member in sorted(dead):
        seq += 1
        verdict = {"member": member, "incarnation": 0, "by": "x", "by_incarnation": 0}
        view.apply(event(seq, "member.dead", verdict | {"missed": 5, "last_heard_ms": 0}))
    return view


def goals(owners: dict[str, tuple[str, str | None, int]]) -> TreeView:
    """A tree view with these goals: id -> (owner, parent goal, level)."""
    tree = TreeView()
    seq = 0
    spawned = {
        "actor_id": "o0",
        "kind": "orchestrator",
        "args": {"root_goal": {"id": "root", "goal": "g"}},
        "parent": None,
    }
    tree.apply(event(1, "actor.spawned", spawned, "@kernel"))
    for gid, (owner, parent, level) in owners.items():
        seq += 2
        if parent is None:
            body = {"group": None, "key": gid, "owner": owner, "previous": "o0"}
            tree.apply(event(seq, "ownership.remapped", body, owner))
            continue
        assign = {"goal": {"id": gid}, "parent": parent, "level": level}
        sent = {"to": owner, "topic": "assign", "body": assign}
        tree.apply(event(seq, "msg.sent", sent, "o0"))
    return tree


def view_of(me: str, member_view: MembersView, tree: TreeView | None = None) -> View:
    views: dict[str, Any] = {"members": member_view}
    if tree is not None:
        views["tree"] = tree
    return View(run_id="r", seed="s", actor_id=me, now=0, lamport=0, alive=(), views=views)


def dead_sets(min_size: int = 1):
    return st.sets(st.sampled_from(NAMES), min_size=min_size, max_size=len(NAMES) - 1)


# -- the ring ------------------------------------------------------------------------------


@settings(max_examples=200, deadline=None)
@given(dead=dead_sets())
def test_the_ring_is_mutual(dead: set[str]) -> None:
    view = members(dead)
    alive = view.alive(role=ROLE)
    for one in alive:
        for other in alive:
            if one != other:
                assert (other in _ring(one, view)) == (one in _ring(other, view))


@settings(max_examples=200, deadline=None)
@given(dead=dead_sets())
def test_the_ring_gives_each_member_at_most_two_more_peers(dead: set[str]) -> None:
    view = members(dead)
    for me in view.alive(role=ROLE):
        ring = _ring(me, view) - {me}
        assert len(ring) <= 2
        assert not ring & dead


def test_the_ring_adds_nothing_until_the_log_holds_a_death() -> None:
    view = members()
    assert all(_ring(me, view) == set() for me in NAMES)


def test_a_member_the_log_calls_dead_stands_outside_the_ring() -> None:
    assert _ring("o1", members({"o1"})) == set()


@settings(max_examples=300, deadline=None)
@given(
    declared=st.sets(st.sampled_from(NAMES), min_size=1, max_size=8),
    crashed=st.sets(st.sampled_from(NAMES), min_size=1, max_size=8),
    data=st.data(),
)
def test_from_any_survivor_a_verdict_reaches_every_crashed_member(
    declared: set[str], crashed: set[str], data: st.DataObject
) -> None:
    """``declared`` are dead in the log; ``crashed`` have stopped but the log calls them alive.
    Each step, a live member next to a crashed one writes the verdict. The recovery only ends
    when no crashed member is left, whichever survivors there are."""
    crashed -= declared
    survivors = sorted(set(NAMES) - declared - crashed)
    if not survivors:
        return
    keep = data.draw(st.sets(st.sampled_from(survivors), min_size=1))
    crashed |= set(survivors) - keep
    while crashed:
        view = members(declared)
        reachable = sorted({n for me in keep for n in _ring(me, view) if n in crashed})
        assert reachable, f"nobody watches {sorted(crashed)}, survivors {sorted(keep)}"
        victim = data.draw(st.sampled_from(reachable))
        crashed.discard(victim)
        declared = {*declared, victim}


def state_of(me: str, on: bool, **more: Any) -> dict[str, Any]:
    det = Detector(member=me, group=GROUPS[me])
    return {
        "id": me,
        "det": det,
        "any_survivor": on,
        "parent": GROUPS[me],
        "leaf": me.count(".") == 1,
        "children": [],
    } | more


def test_the_peers_gain_the_ring_only_with_the_param_and_a_death() -> None:
    dead, quiet = members({"o1"}), members()
    for me in ("o1.2", "o2", "o3.2"):
        off = _peers(state_of(me, False), view_of(me, dead))
        assert set(off) < set(_peers(state_of(me, True), view_of(me, dead)))
    # Nobody dead: the same peers, so a run with the param logs the run it always did.
    for me in NAMES:
        assert _peers(state_of(me, True), view_of(me, quiet)) == _peers(
            state_of(me, False), view_of(me, quiet)
        )


# -- a planner with no live child group ----------------------------------------------------


def planner(on: bool) -> dict[str, Any]:
    return state_of("o1", on, mode="swarm", membership=True, autoscale=None, children=[])


def test_a_dead_child_group_is_named_so_the_goal_takes_the_respawn_path() -> None:
    view = view_of("o1", members({"o1.1", "o1.2"}))
    assert _child_group(planner(True), {"group": "o1"}, view) == ["o1.1", "o1.2"]


def test_without_the_param_the_planner_keeps_the_goal_it_cannot_run() -> None:
    view = view_of("o1", members({"o1.1", "o1.2"}))
    assert _child_group(planner(False), {"group": "o1"}, view) == ["o1"]


def test_a_live_child_is_chosen_with_or_without_the_param() -> None:
    view = view_of("o1", members({"o1.1"}))
    for on in (False, True):
        assert _child_group(planner(on), {"group": "o1"}, view) == ["o1.2"]


def test_a_group_nobody_ever_joined_stays_with_the_planner() -> None:
    view = view_of("o1", members(names=("o0", "o1")))
    assert _child_group(planner(True), {"group": "o1"}, view) == ["o1"]


# -- the last resort for the root ----------------------------------------------------------


def test_a_root_whose_owner_lost_its_whole_group_goes_to_any_survivor() -> None:
    tree = goals({"root": ("o1", None, 0)})
    view = members({"o0", "o1", "o2", "o3"})
    assert heir(tree, "root", view) is None
    found = heir(tree, "root", view, any_survivor=True)
    assert found in view.alive(role=ROLE)
    assert all(heir(tree, "root", view, True) == found for _ in range(5))
    assert successors(tree.goals["root"], view, True) == view.alive(role=ROLE)


def test_an_ordinary_heir_does_not_change_with_the_param() -> None:
    tree = goals({"root": ("o1", None, 0), "t2": ("o2", "root", 1)})
    view = members({"o0", "o1"})
    assert heir(tree, "root", view, True) == heir(tree, "root", view) in ("o2", "o3")


def test_a_goal_below_the_root_still_waits_for_the_respawn() -> None:
    tree = goals({"root": ("o0", None, 0), "t1": ("o1", "root", 1), "t1/d": ("o1.1", "t1", 2)})
    view = members({"o1.1", "o1.2"})
    assert heir(tree, "t1/d", view, True) is None


# -- the isolation rule expires ------------------------------------------------------------


def tick(det: Detector, now: int) -> list[str]:
    view = View(run_id="r", seed="s", actor_id=det.member, now=now, lamport=0, alive=(), views={})
    out = membership.tick(det, Endpoint(owner=det.member), view)
    return [
        command.payload["member"]
        for command in out.commands
        if isinstance(command, Emit) and command.type == "member.dead"
    ]


def alone(limit: int | None) -> Detector:
    det = Detector(member="a", isolation_limit_ms=limit)
    membership.watch(det, ["b", "c"], 0)
    return det


def test_a_member_that_hears_nobody_stays_silent_until_the_limit() -> None:
    det = alone(ISOLATION_LIMIT_MS)
    for now in range(1000, ISOLATION_LIMIT_MS, 1000):
        assert tick(det, now) == []
    assert det.isolated
    assert tick(det, ISOLATION_LIMIT_MS) == ["b", "c"]
    assert not det.isolated


def test_without_a_limit_it_stays_silent_for_ever() -> None:
    det = alone(None)
    assert all(tick(det, now * 1000) == [] for now in range(1, 200))
    assert det.isolated


def test_the_limit_counts_from_the_last_peer_heard() -> None:
    det = alone(ISOLATION_LIMIT_MS)
    det.last_contact = 20_000
    assert tick(det, 49_000) == []
    assert tick(det, 50_000) == ["b", "c"]


def test_a_peer_that_joins_the_watch_does_not_restart_the_limit() -> None:
    det = alone(ISOLATION_LIMIT_MS)
    assert tick(det, 29_000) == []
    membership.watch(det, ["b", "c", "d"], 29_000)
    assert tick(det, 30_000) == ["b", "c"]
    assert tick(det, 34_000) == ["d"]


def test_the_limit_is_the_runs_choice() -> None:
    assert _detector("o1", {"parent": "o0"}).isolation_limit_ms is None
    args = {"parent": "o0", "any_survivor": True}
    assert _detector("o1", args).isolation_limit_ms == ISOLATION_LIMIT_MS


# -- the param -----------------------------------------------------------------------------


def test_the_param_is_recorded_only_when_asked() -> None:
    spec = TaskSpec.load(TASKSPEC)
    params = run_params(spec)
    assert "any_survivor" not in params and "any_survivor" not in params["spec"]
    params = run_params(spec.model_copy(update={"any_survivor": True}))
    assert params["any_survivor"] is True and "any_survivor" not in params["spec"]


def test_the_spawned_orchestrators_inherit_it_only_when_on() -> None:
    state = {"audit": False, "feasibility": False, "arbitration": False, "detect_ms": None}
    assert "any_survivor" not in _opt_ins({**state, "any_survivor": False})
    assert _opt_ins({**state, "any_survivor": True})["any_survivor"] is True


def root_args(mode: str, params: dict[str, Any]) -> dict[str, Any]:
    commands = SwarmScenario(mode=mode).boot(run_params(TaskSpec.load(TASKSPEC)) | params)
    return next(c.args for c in commands if isinstance(c, Spawn) and c.actor_id == "o0")


def test_the_root_gets_it_only_on_the_swarm() -> None:
    assert "any_survivor" not in root_args("swarm", {})
    assert root_args("swarm", {"any_survivor": True})["any_survivor"] is True
    assert "any_survivor" not in root_args("durable-max", {"any_survivor": True})
