"""Chaos (spec §15.2, §15.4): seeded plans, the faulty network and the targeting rule."""

from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.comms.bus import ENVELOPE_KEY, RELAY_TOPIC
from fractalswarm.comms.chaos import (
    CONFIG_TOPIC,
    PROFILES,
    NetFaults,
    NetState,
    TargetContext,
    build_plan,
    most_remaining_work,
    net_handle,
)
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Emit, Send, SetTimer, View


def view(now: int = 0, seed: str = "s") -> View:
    return View(run_id="r", seed=seed, actor_id="net", now=now, lamport=0, alive=())


def msg(topic: str, body: dict, seq: int = 1) -> Event:
    payload = {"to": "net", "topic": topic, "body": body}
    return Event(
        run_id="r",
        ts_virtual=0,
        lamport=0,
        type="msg.sent",
        actor="x",
        idem_key=f"k{seq}",
        payload=payload,
        seq=seq,
        prev_hash="0",
        hash="0",
    )


def frame(n: int, source: str = "a", target: str = "b", attempt: int = 0) -> dict:
    return {
        "id": f"{source}#0:{n}",
        "kind": "msg",
        "sender": source,
        "to": target,
        "topic": "t",
        "attempt": attempt,
    }


def relay(state: NetState, f: dict, seed: str = "s") -> list:
    _, commands = net_handle(state, msg(RELAY_TOPIC, {ENVELOPE_KEY: f}), view(seed=seed))
    return commands


def faults_of(commands: list) -> list[str]:
    return [c.payload["fault"] for c in commands if isinstance(c, Emit)]


@settings(max_examples=50, deadline=None)
@given(profile=st.sampled_from(sorted(PROFILES)), seed=st.text(max_size=8))
def test_a_profile_and_seed_always_give_the_same_plan(profile: str, seed: str) -> None:
    plan = build_plan(profile, seed)
    assert plan == build_plan(profile, seed)
    spec = PROFILES[profile]
    kills = [a for a in plan.actions if a.kind == "kill_coordinator"]
    assert len(kills) == spec.crashes
    assert all(a.at in (0.20, 0.35, 0.50, 0.65, 0.80) for a in kills)
    partitions = [a for a in plan.actions if a.kind == "partition"]
    assert len(partitions) == (1 if spec.partition else 0)
    assert list(plan.actions) == sorted(plan.actions, key=lambda a: (a.at, a.kind))
    assert plan.net.drop == spec.message_loss and plan.api_fault_rate == spec.api_faults


def test_c3_kills_five_coordinators_and_half_the_agents() -> None:
    plan = build_plan("C3", "x")
    assert [a.at for a in plan.actions if a.kind == "kill_coordinator"] == [
        0.2,
        0.35,
        0.5,
        0.65,
        0.8,
    ]
    assert {a.agent_share for a in plan.actions if a.kind == "kill_agents"} == {0.5}


def test_the_network_decides_each_frame_the_same_way_every_time() -> None:
    faults = NetFaults(drop=0.2, duplicate=0.2, delay=0.2, reorder=0.2)
    first = [relay(NetState(faults), frame(n)) for n in range(200)]
    again = [relay(NetState(faults), frame(n)) for n in range(200)]
    assert first == again
    kinds = {kind for commands in first for kind in faults_of(commands)}
    assert kinds == {"drop", "duplicate", "delay", "reorder"}
    # A resend is a fresh decision.
    resent = [relay(NetState(faults), frame(n, attempt=1)) for n in range(200)]
    assert resent != first


@settings(max_examples=20, deadline=None)
@given(drop=st.floats(0.05, 0.6), seed=st.text(max_size=6))
def test_the_drop_rate_matches_the_plan(drop: float, seed: str) -> None:
    state = NetState(NetFaults(drop=drop))
    dropped = sum("drop" in faults_of(relay(state, frame(n), seed)) for n in range(1500))
    assert abs(dropped / 1500 - drop) < 0.06


def test_a_clean_network_forwards_frames_unchanged() -> None:
    f = frame(1)
    assert relay(NetState(NetFaults()), f) == [Send(to="b", topic="t", body={ENVELOPE_KEY: f})]


def test_delayed_frames_are_held_and_forwarded_when_their_timer_fires() -> None:
    state = NetState(NetFaults(delay=1.0, delay_ms=(300, 300)))
    commands = relay(state, frame(1))
    timer = next(c for c in commands if isinstance(c, SetTimer))
    assert timer.delay_ms == 300 and faults_of(commands) == ["delay"]
    fired = Event(
        run_id="r",
        ts_virtual=300,
        lamport=0,
        type="effect.completed",
        actor="@env",
        idem_key="t",
        payload={"effect_id": "e", "kind": "timer", "status": "ok", "result": {}, "tag": timer.tag},
        seq=2,
        prev_hash="0",
        hash="0",
    )
    _, forwarded = net_handle(state, fired, view(300))
    assert [c.to for c in forwarded] == ["b"] and state.held == {}


def test_a_partition_cuts_both_ways_until_healed() -> None:
    state = NetState(NetFaults())
    net_handle(state, msg(CONFIG_TOPIC, {"partition": {"id": "p1", "isolated": ["b"]}}), view())
    assert faults_of(relay(state, frame(1, "a", "b"))) == ["partition_drop"]
    assert faults_of(relay(state, frame(2, "b", "a"))) == ["partition_drop"]
    assert faults_of(relay(state, frame(3, "a", "c"))) == []
    net_handle(state, msg(CONFIG_TOPIC, {"heal": "p1"}, seq=2), view())
    assert faults_of(relay(state, frame(4, "a", "b"))) == []


def test_the_default_target_is_the_coordinator_with_the_most_remaining_work() -> None:
    ctx = TargetContext(("a", "b", "c"), {"a": 2, "b": 5, "c": 5}, "seed", "kill:1")
    target = most_remaining_work(ctx)
    assert target in ("b", "c")
    assert target == most_remaining_work(ctx)  # ties broken by a seeded hash, not by luck
    assert most_remaining_work(TargetContext((), {}, "seed", "kill:1")) is None
