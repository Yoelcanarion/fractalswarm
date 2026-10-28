"""Membership (spec §5.2): heartbeats, suspicion and death timing, first verdict wins, fencing.

Detectors are driven directly: every ``interval`` each live detector ticks, and its
heartbeats are handed to the peers it can reach.
"""

from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.comms import bus
from fractalswarm.comms.bus import Endpoint, Envelope
from fractalswarm.coord import membership
from fractalswarm.coord.membership import Detector, FencingToken, MembersView
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Admission, Emit, Send, View

NAMES = ("a", "b", "c")


def view(actor: str, now: int, members: MembersView | None = None) -> View:
    views = {} if members is None else {"members": members}
    return View(run_id="r", seed="s", actor_id=actor, now=now, lamport=0, alive=(), views=views)


def event(event_type: str, payload: dict, seq: int = 1, ts: int = 0, actor: str = "x") -> Event:
    return Event(
        run_id="r",
        ts_virtual=ts,
        lamport=0,
        type=event_type,
        actor=actor,
        idem_key=f"k{seq}",
        payload=payload,
        seq=seq,
        prev_hash="0",
        hash="0",
    )


class Cluster:
    def __init__(self, interval: int = 1000) -> None:
        self.dets = {n: Detector(member=n, interval_ms=interval) for n in NAMES}
        self.eps = {n: Endpoint(owner=n) for n in NAMES}
        self.down: set[str] = set()  # crashed: neither ticks nor hears
        self.cut: set[str] = set()  # partitioned: ticks, but nothing in or out
        self.emitted: list[tuple[int, str, Emit]] = []
        for name, det in self.dets.items():
            membership.watch(det, [n for n in NAMES if n != name], 0)

    def tick(self, now: int) -> None:
        outgoing: list[tuple[str, Envelope]] = []
        for name in NAMES:
            if name in self.down:
                continue
            out = membership.tick(self.dets[name], self.eps[name], view(name, now))
            for command in out.commands:
                if isinstance(command, Emit):
                    self.emitted.append((now, name, command))
                elif isinstance(command, Send):
                    outgoing.append((name, Envelope.model_validate(command.body[bus.ENVELOPE_KEY])))
        for sender, env in outgoing:
            if {sender, env.to} & (self.down | self.cut):
                continue
            out = bus.on_frame(self.eps[env.to], env, view(env.to, now))
            for delivery in out.deliveries:
                membership.heard(self.dets[env.to], delivery, now)

    def verdicts(self, kind: str) -> list[tuple[int, str, str]]:
        return [
            (now, by, emit.payload["member"])
            for now, by, emit in self.emitted
            if emit.type == f"member.{kind}"
        ]


@settings(max_examples=40, deadline=None)
@given(crash_tick=st.integers(1, 8), interval=st.sampled_from([500, 1000, 2000]))
def test_suspected_after_three_missed_and_dead_after_five(crash_tick: int, interval: int) -> None:
    cluster = Cluster(interval)
    last_heard = 0
    for n in range(1, 20):
        now = n * interval
        if n == crash_tick:
            cluster.down.add("c")
        if "c" not in cluster.down:
            last_heard = now
        cluster.tick(now)

    for kind, missed in (("suspected", 3), ("dead", 5)):
        found = {by: now for now, by, member in cluster.verdicts(kind) if member == "c"}
        assert sorted(found) == ["a", "b"]
        for now in found.values():
            assert now - last_heard == missed * interval
    assert all(member == "c" for _, _, member in cluster.verdicts("suspected"))


def test_a_cut_off_detector_issues_no_verdicts() -> None:
    cluster = Cluster()
    cluster.cut.add("c")
    for n in range(1, 10):
        cluster.tick(n * 1000)
    assert {by for _, by, _ in cluster.verdicts("dead")} == {"a", "b"}
    assert cluster.dets["c"].isolated


def test_a_recovered_peer_is_no_longer_suspected() -> None:
    cluster = Cluster()
    cluster.cut.add("c")
    for n in range(1, 4):
        cluster.tick(n * 1000)
    assert cluster.dets["a"].peers["c"].status == "suspected"
    cluster.cut.clear()
    cluster.tick(4000)
    assert cluster.dets["a"].peers["c"].status == "alive"
    assert cluster.verdicts("dead") == []


# -- the members view and fencing -------------------------------------------------------


def joined(member: str, incarnation: int = 0) -> dict:
    return {"member": member, "incarnation": incarnation, "role": "coordinator", "group": None}


def verdict(member: str, by: str, incarnation: int = 0, by_incarnation: int = 0) -> dict:
    return {
        "member": member,
        "incarnation": incarnation,
        "by": by,
        "by_incarnation": by_incarnation,
        "missed": 5,
        "last_heard_ms": 0,
    }


def admit_and_apply(members: MembersView, event_type: str, payload: dict, actor: str) -> Admission:
    admission = members.admit(actor, event_type, payload) or Admission()
    if admission.accept:
        members.apply(event(event_type, payload, actor=actor))
    return admission


def test_the_first_death_verdict_wins_and_bumps_the_epoch() -> None:
    members = MembersView()
    for name in NAMES:
        assert admit_and_apply(members, "member.joined", joined(name), name).bump_member_epoch
    epoch = members.epoch

    first = admit_and_apply(members, "member.dead", verdict("c", "a"), "a")
    second = admit_and_apply(members, "member.dead", verdict("c", "b"), "b")
    assert first.accept and first.bump_member_epoch
    assert not second.accept and second.instead is None  # already decided: dropped silently
    assert members.epoch == epoch + 1
    assert members.alive() == ["a", "b"] and members.is_gone("c")


def test_a_dead_incarnation_is_fenced_and_rejoins_as_the_next_one() -> None:
    members = MembersView()
    for name in NAMES:
        admit_and_apply(members, "member.joined", joined(name), name)
    admit_and_apply(members, "member.dead", verdict("c", "a"), "a")

    # The zombie's own verdicts and its old incarnation are fenced.
    zombie_verdict = admit_and_apply(members, "member.dead", verdict("a", "c"), "c")
    assert zombie_verdict.instead is not None and zombie_verdict.instead[0] == "write.fenced"
    same = admit_and_apply(members, "member.joined", joined("c", 0), "c")
    assert (
        same.instead is not None and same.instead[1]["reason"] == "a dead incarnation cannot rejoin"
    )

    rejoined = admit_and_apply(members, "member.joined", joined("c", 1), "c")
    assert rejoined.accept and rejoined.bump_member_epoch
    assert members.alive() == ["a", "b", "c"]
    assert members.is_dead("c", 0) and not members.is_dead("c", 1)


def test_fencing_tokens_reject_stale_writers_and_superseded_owners() -> None:
    members = MembersView()
    for name in NAMES:
        admit_and_apply(members, "member.joined", joined(name), name)
    old = FencingToken(member="c", incarnation=0, epoch=3, resource="k1").model_dump()
    assert admit_and_apply(members, "toy.write", {"fence": old}, "c").accept

    admit_and_apply(members, "member.dead", verdict("c", "a"), "a")
    stale = admit_and_apply(members, "toy.write", {"fence": old}, "c")
    assert stale.instead is not None
    assert stale.instead[1]["reason"] == "the writer's incarnation is dead"

    # A newer owner writes k1 at a higher epoch: an older-epoch write to k1 is now fenced.
    new = FencingToken(member="a", incarnation=0, epoch=4, resource="k1").model_dump()
    assert admit_and_apply(members, "toy.write", {"fence": new}, "a").accept
    older = FencingToken(member="b", incarnation=0, epoch=3, resource="k1").model_dump()
    superseded = admit_and_apply(members, "toy.write", {"fence": older}, "b")
    assert superseded.instead is not None
    assert superseded.instead[1]["reason"] == "a newer owner has already written this resource"
    # Other resources are unaffected.
    other = FencingToken(member="b", incarnation=0, epoch=3, resource="k2").model_dump()
    assert admit_and_apply(members, "toy.write", {"fence": other}, "b").accept


def test_a_fenced_notice_makes_the_detector_rejoin_with_a_new_incarnation() -> None:
    det, ep = Detector(member="z"), Endpoint(owner="z")
    membership.watch(det, ["a", "b"], 0)
    notice = {"member": "z", "incarnation": 0}
    env = Envelope(
        id="a#0:1", n=1, kind="fenced", sender="a", to="z", topic="t", idem_key="x", payload=notice
    )
    msg = event(
        "msg.sent",
        {"to": "z", "topic": "t", "body": {bus.ENVELOPE_KEY: env.model_dump(mode="json")}},
    )
    out = membership.handle(det, ep, msg, view("z", 7000))
    assert out is not None
    assert [(c.member, c.status, c.incarnation) for c in out.changes] == [("z", "rejoined", 1)]
    emits = [c for c in out.commands if isinstance(c, Emit)]
    assert emits[0].type == "member.joined" and emits[0].payload["incarnation"] == 1
    assert det.incarnation == ep.incarnation == 1
    # A second copy of the same notice does not bump the incarnation again.
    again = membership.handle(det, ep, msg, view("z", 7100))
    assert again is not None and again.changes == [] and det.incarnation == 1


def test_sync_adopts_the_logs_verdict() -> None:
    members = MembersView()
    for name in NAMES:
        admit_and_apply(members, "member.joined", joined(name), name)
    admit_and_apply(members, "member.dead", verdict("c", "b"), "b")
    det = Detector(member="a")
    membership.watch(det, ["b", "c"], 0)
    changes = membership.sync(det, view("a", 100, members))
    assert [(c.member, c.status) for c in changes] == [("c", "dead")]
    admit_and_apply(members, "member.joined", joined("c", 1), "c")
    changes = membership.sync(det, view("a", 200, members))
    assert [(c.member, c.status, c.incarnation) for c in changes] == [("c", "alive", 1)]


def test_sync_withdraws_a_verdict_the_log_fenced() -> None:
    # A cut-off zombie judges its parent dead, but it is a dead incarnation itself, so the
    # verdict is fenced. After it rejoins, it must heartbeat the parent again.
    members = MembersView()
    for name in NAMES:
        admit_and_apply(members, "member.joined", joined(name), name)
    admit_and_apply(members, "member.dead", verdict("a", "b"), "b")
    det = Detector(member="a")
    membership.watch(det, ["b", "c"], 0)
    det.peers["b"].status = "dead"  # its own verdict on b, which the log refused
    assert not admit_and_apply(members, "member.dead", verdict("b", "a"), "a").accept
    changes = membership.sync(det, view("a", 9000, members))
    assert [(c.member, c.status) for c in changes] == [("b", "alive")]
    assert det.peers["b"].last_heard == 9000
    out = membership.tick(det, Endpoint(owner="a"), view("a", 9000, members))
    sent = [
        Envelope.model_validate(c.body[bus.ENVELOPE_KEY]).to
        for c in out.commands
        if isinstance(c, Send)
    ]
    assert sorted(sent) == ["b", "c"]
