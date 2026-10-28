"""Random traffic through two guarded endpoints and the real mailbox (spec §5.4, §8).

The network is lossless and the blackboard is the real ``Mailbox``, so whatever the breakers do
(pace the critical lane, divert to the mailbox, coalesce a storm into digests), nothing may be
lost, nothing delivered twice, the critical lane keeps its order, liveness gossip is never held
back, and once the traffic stops everything drains. The thresholds are small so that every
example trips something.
"""

from collections import deque
from dataclasses import dataclass, field
from typing import Any

from hypothesis import event as note
from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.comms import bus
from fractalswarm.comms.bus import Delivery, Endpoint, Envelope
from fractalswarm.comms.channel_breakers import Guard
from fractalswarm.comms.mailbox import MAIL_ITEMS, MAIL_NOTIFY, MAIL_POLL, MAIL_PUT, Mailbox
from fractalswarm.comms.topics import Lane
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Send, View

STEP_MS = 100
POLICY = {
    "channel": {
        "max_msgs": 6,
        "max_bytes": 4000,
        "window_ms": 2000,
        "pingpong_alternations": 4,
        "half_open_after_ms": 3000,
    },
    "storm": {
        "max_msgs": 9,
        "window_ms": 2000,
        "half_open_after_ms": 3000,
        "digest_every_ms": 400,
        "digest_max_items": 5,
    },
}
# (topic, lane override): normal, critical and low lanes, and liveness gossip
KINDS = [
    ("chat", None),
    ("budget.epoch", None),
    ("fact.verified", None),
    ("member.heartbeat", None),
    ("news", Lane.LOW),
]


def event(topic: str, body: dict[str, Any], now: int) -> Event:
    return Event(
        seq=1,
        run_id="r",
        ts_virtual=now,
        lamport=1,
        type="msg.sent",
        actor="board",
        idem_key="k",
        payload={"to": "x", "topic": topic, "body": body},
        prev_hash="0",
        hash="0",
    )


@dataclass
class Rig:
    a: Endpoint
    b: Endpoint
    mail: Mailbox = field(default_factory=Mailbox)
    now: int = 0
    seen: dict[str, list[tuple[int, Delivery]]] = field(default_factory=lambda: {"a": [], "b": []})

    @property
    def endpoints(self) -> dict[str, Endpoint]:
        return {"a": self.a, "b": self.b}

    def view(self, ep: Endpoint) -> View:
        return View("r", "s", ep.owner, self.now, 0, ())

    def settle(self, commands: list[Command], origin: Endpoint) -> None:
        """Carry out what an endpoint asked for until nothing more is in flight."""
        queue = deque((origin, command) for command in commands)
        while queue:
            origin, command = queue.popleft()
            if not isinstance(command, Send):
                continue  # emits and timers are the kernel's business
            body = command.body
            if bus.ENVELOPE_KEY in body:
                target = self.endpoints[command.to]
                env = Envelope.model_validate(body[bus.ENVELOPE_KEY])
                self.take(target, bus.on_frame(target, env, self.view(target)), queue)
            elif command.topic == MAIL_PUT:
                if self.mail.put(body["to"], body["env"], self.now):
                    notice = event(MAIL_NOTIFY, {"waiting": 1}, self.now)
                    self.hand(self.endpoints[body["to"]], notice, queue)
            elif command.topic == MAIL_POLL:
                items, remaining, _ = self.mail.take(origin.owner, body["batch"])
                reply = event(MAIL_ITEMS, {"items": items, "more": remaining}, self.now)
                self.hand(origin, reply, queue)

    def hand(self, target: Endpoint, ev: Event, queue: deque) -> None:
        out = bus.handle(target, ev, self.view(target))
        if out is not None:
            self.take(target, out, queue)

    def take(self, target: Endpoint, out: bus.BusOutcome, queue: deque) -> None:
        self.seen[target.owner] += [(self.now, d) for d in out.deliveries]
        queue.extend((target, command) for command in out.commands)

    def tick(self) -> None:
        for ep in (self.a, self.b):
            out = bus.on_tick(ep, self.view(ep))
            queue: deque = deque()
            self.take(ep, out, queue)
            self.settle([c for _, c in queue], ep)

    @property
    def quiet(self) -> bool:
        return self.a.idle and self.b.idle and self.mail.depth("b") == 0


@settings(max_examples=150, deadline=None)
@given(
    steps=st.lists(
        st.lists(
            st.tuples(st.sampled_from([0, 1, 1, 1, 2, 3, 4]), st.integers(0, 1500)), max_size=12
        ),
        min_size=1,
        max_size=14,
    )
)
def test_nothing_is_lost_or_doubled_the_critical_lane_keeps_its_order_and_it_all_drains(
    steps,
) -> None:
    rig = Rig(
        Endpoint("a", guard=Guard.create("a", POLICY)),
        Endpoint("b", guard=Guard.create("b", POLICY)),
    )
    sent: dict[int, tuple[str, int]] = {}  # n -> (topic, when)
    for step in steps:
        rig.now += STEP_MS
        for kind, pad in step:
            topic, lane = KINDS[kind]
            n = len(sent) + 1
            sent[n] = (topic, rig.now)
            payload = {"n": n, "pad": "p" * pad}
            rig.settle(bus.send(rig.a, rig.view(rig.a), "b", topic, payload, lane=lane), rig.a)
        rig.tick()
    for _ in range(5000):  # then no more traffic: it must settle by itself
        if rig.quiet:
            break
        rig.now += STEP_MS
        rig.tick()
    assert rig.quiet, (rig.a.idle, rig.b.idle, rig.mail.depth("b"), rig.a.paced)

    for name in ("diverted", "paced", "coalesced"):  # what this example exercised
        if rig.a.stats.get(name):
            note(name)
    if rig.b.stats.get("mail_in"):
        note("mail pulled")

    singles = [(at, d) for at, d in rig.seen["b"] if d.kind == "msg"]
    digests = [d for _, d in rig.seen["b"] if d.kind == "digest"]
    ids = [d.payload["n"] for _, d in singles]
    assert len(ids) == len(set(ids)), "a message was delivered twice"
    assert set(ids) <= set(sent)
    folded = sum(d.payload["count"] for d in digests)
    assert len(ids) + folded == len(sent), "a message was lost"
    for digest in digests:
        listed = [item["payload"]["n"] for item in digest.payload["items"]]
        assert not set(listed) & set(ids) and len(listed) == len(set(listed))
        assert (
            sum(i["count"] for i in digest.payload["items"]) + digest.payload["elided"]
            == (digest.payload["count"])
        )

    critical = [d.payload["n"] for _, d in singles if d.topic == "fact.verified"]
    assert critical == sorted(critical), "the critical lane lost its order"
    for at, delivery in singles:  # liveness gossip is never held back, even mid-storm
        if delivery.topic == "member.heartbeat":
            assert at == sent[delivery.payload["n"]][1]
    heartbeats = [n for n, (topic, _) in sent.items() if topic == "member.heartbeat"]
    assert sorted(n for n in ids if sent[n][0] == "member.heartbeat") == heartbeats
