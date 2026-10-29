"""The recovery metrics (``bench/recovery.py``) on synthetic event logs with hand-computed answers.

Each scenario is a short script of events at known times, in seconds, and every expected number
below is worked out from the definitions in the module's docstring, not read back from the code.
The same functions run on swarm-shaped logs (one coordinator dies and an heir remaps its goals)
and on supervisor-shaped ones (``baseline.crashed`` / ``baseline.restarted``), which is the point
of the metrics: one rule, two kinds of log. Nothing here says which system is better.
"""

import pytest

from fractalswarm.bench.recovery import RecoveryMetrics, analyze
from fractalswarm.bench.scoring import LLMCall, llm_calls
from fractalswarm.kernel.events import ENV, KERNEL, Event

SECOND = 1000


class Log:
    """A script of events in time order; each helper writes one event the actors would."""

    def __init__(self) -> None:
        self.events: list[Event] = []
        self.calls: dict[str, tuple[str, str | None]] = {}  # effect id -> (actor, tag)

    def add(self, t: float, event_type: str, actor: str, **payload) -> Event:
        seq = len(self.events) + 1
        ts = round(t * SECOND)
        assert not self.events or ts >= self.events[-1].ts_virtual, "events go in time order"
        event = Event(
            run_id="r",
            ts_virtual=ts,
            lamport=seq,
            type=event_type,
            actor=actor,
            idem_key=f"k{seq}",
            payload=payload,
            seq=seq,
            prev_hash="0",
            hash="0",
        )
        self.events.append(event)
        return event

    # -- the cast ----------------------------------------------------------------------

    def start(self, t: float = 0) -> None:
        self.add(t, "run.started", KERNEL, seed="1", scenario="s", clock="sim")

    def done(self, t: float) -> None:
        self.add(t, "run.completed", KERNEL, events=len(self.events), alive=[], spent_usd=0.0)

    def spawn(self, t: float, actor: str, kind: str, parent: str | None = None) -> None:
        self.add(t, "actor.spawned", KERNEL, actor_id=actor, kind=kind, args={}, parent=parent)

    def stop(self, t: float, actor: str, reason: str) -> None:
        self.add(t, "actor.stopped", KERNEL, actor_id=actor, reason=reason)

    def kill(self, t: float, victim: str, fault: str = "kill_coordinator") -> None:
        self.add(t, "chaos.injected", "chaos", fault=fault, target=victim, progress=0.5, detail={})
        self.stop(t, victim, "chaos")

    # -- who owns what -----------------------------------------------------------------

    def assigned(self, t: float, goal: str, owner: str) -> None:
        self.add(t, "ownership.assigned", "o0", group="g", key=goal, owner=owner)

    def opened(self, t: float, goal: str, owner: str = "o0") -> None:
        self.add(
            t, "goal.opened", owner, goal_id=goal, owner=owner, parent="root", level=1, goal={}
        )

    def remapped(self, t: float, goal: str, owner: str, previous: str) -> None:
        self.add(
            t, "ownership.remapped", owner, group="g", key=goal, owner=owner, previous=previous
        )

    def goal_done(self, t: float, owner: str, goal: str) -> None:
        self.add(t, "goal.completed", owner, goal_id=goal, owner=owner, status="ok")

    # -- contracts ---------------------------------------------------------------------

    def created(
        self,
        t: float,
        owner: str,
        goal: str,
        cid: str,
        assignee: str,
        deps: tuple[str, ...] = (),
    ) -> None:
        contract = {"goal_id": goal, "id": cid, "depends_on": list(deps), "assignee": assignee}
        self.add(t, "contract.created", owner, contract=contract, work=f"{goal}/{cid}", owner=owner)

    def dispatched(self, t: float, owner: str, goal: str, cid: str, attempt: int, agent: str):
        self.add(
            t,
            "contract.dispatched",
            owner,
            goal_id=goal,
            contract_id=cid,
            attempt=attempt,
            assignee=agent,
            idem_key=f"{goal}/{cid}/{attempt}",
        )

    def result(self, t: float, agent: str, goal: str, cid: str, attempt: int) -> None:
        body = {"goal_id": goal, "contract_id": cid, "attempt": attempt}
        self.add(t, "msg.sent", agent, to="owner", topic="contract.result", body=body)

    def book(self, t: float, goal: str, cid: str, attempt: int) -> None:
        body = {"goal_id": goal, "contract_id": cid, "attempt": attempt}
        self.add(t, "msg.sent", "board", to="owner", topic="book.result", body=body)

    def completed(self, t: float, owner: str, goal: str, cid: str, attempt: int, agent: str):
        self.add(
            t,
            "contract.completed",
            owner,
            goal_id=goal,
            contract_id=cid,
            attempt=attempt,
            agent=agent,
            status="ok",
        )

    def judged(self, t: float, owner: str, goal: str, cid: str, attempt: int) -> None:
        self.add(
            t,
            "verify.judged",
            owner,
            goal_id=goal,
            contract_id=cid,
            attempt=attempt,
            verdict="pass",
            score=1.0,
            reasons=[],
        )

    def verified(self, t: float, owner: str, goal: str, cid: str, attempt: int) -> None:
        self.add(
            t, "contract.verified", owner, goal_id=goal, contract_id=cid, attempt=attempt, work=""
        )

    def rejected(
        self, t: float, owner: str, goal: str, cid: str, attempt: int, stage: str, why: str = ""
    ):
        self.add(
            t,
            "contract.rejected",
            owner,
            goal_id=goal,
            contract_id=cid,
            attempt=attempt,
            stage=stage,
            reasons=[why],
        )

    def plan_refined(self, t: float, owner: str, goal: str) -> None:
        self.add(t, "plan.refined", owner, goal_id=goal, owner=owner, children=[], plan={})

    # -- LLM calls ---------------------------------------------------------------------

    def call_start(
        self, t: float, actor: str, tag: str, name: str, again: str | None = None
    ) -> None:
        """``name`` is the effect id. A call asked again (``again``: the id of the first) sends the
        same request, which is what makes it a duplicate."""
        self.calls[name] = (actor, tag)
        request = {"role": "agent", "input": again or name}
        self.add(t, "effect.started", actor, effect_id=name, kind="llm", request=request, tag=tag)

    def call_end(self, t: float, name: str, cost: float = 0.1, status: str = "ok") -> None:
        tag = self.calls[name][1]
        result = {"cost_usd": cost, "usage": {"input_tokens": 10, "output_tokens": 10}}
        self.add(
            t,
            "effect.completed",
            ENV,
            effect_id=name,
            kind="llm",
            status=status,
            result=result,
            tag=tag,
        )

    def call_cancel(self, t: float, name: str, by: str) -> None:
        tag = self.calls[name][1]
        self.add(t, "effect.cancelled", by, effect_id=name, kind="llm", tag=tag)

    # -- supervisors -------------------------------------------------------------------

    def crashed(self, t: float, crash: int, lost: tuple[str, ...] = ()) -> None:
        self.add(
            t,
            "baseline.crashed",
            "o0",
            coordinator="o0",
            crash=crash,
            dispatched=0,
            lost=list(lost),
            restart_in_ms=5000,
        )

    def restarted(self, t: float, crash: int) -> None:
        self.add(t, "baseline.restarted", "o0", coordinator="o0", crash=crash, redo=[])


def priced(log: Log, **cancelled_cost: float) -> list[LLMCall]:
    """The scored calls, with the estimate a cancelled call would cost (the log has no prices)."""
    return [
        call.model_copy(update={"cost_usd": cancelled_cost.get(call.effect_id, call.cost_usd)})
        for call in llm_calls(log.events)
    ]


def run(log: Log, **cancelled_cost: float) -> RecoveryMetrics:
    return analyze(log.events, priced(log, **cancelled_cost))


# -- a swarm: one session coordinator dies, its sibling takes over --------------------------


def swarm_cast(log: Log) -> None:
    """o0 > o1 > {o1.1, o1.2}; two agents per session. Sessions s1 (c1, then c2) and s2 (c1, then
    c2), each contract one agent call. s1 is o1.1's, s2 is o1.2's."""
    log.start()
    log.spawn(0, "o0", "orchestrator")
    log.spawn(0, "o1", "orchestrator", "o0")
    log.spawn(0, "o1.1", "orchestrator", "o1")
    log.spawn(0, "o1.2", "orchestrator", "o1")
    for agent, owner in (("a1", "o1.1"), ("a2", "o1.1"), ("a3", "o1.2"), ("a4", "o1.2")):
        log.spawn(0, agent, "agent", owner)
    log.assigned(1, "t1", "o1")
    log.assigned(1, "s1", "o1.1")
    log.assigned(1, "s2", "o1.2")
    log.created(2, "o1.1", "s1", "c1", "a1")
    log.created(2, "o1.1", "s1", "c2", "a2", ("c1",))
    log.created(2, "o1.2", "s2", "c1", "a3")
    log.created(2, "o1.2", "s2", "c2", "a4", ("c1",))
    log.dispatched(2, "o1.1", "s1", "c1", 0, "a1")
    log.dispatched(2, "o1.2", "s2", "c1", 0, "a3")
    log.call_start(2, "a1", "s1/c1/0:0", "E1")
    log.call_start(2, "a3", "s2/c1/0:0", "E2")
    log.call_end(10, "E1")
    log.result(10, "a1", "s1", "c1", 0)
    log.completed(10, "o1.1", "s1", "c1", 0, "a1")
    log.verified(10, "o1.1", "s1", "c1", 0)
    log.dispatched(10, "o1.1", "s1", "c2", 0, "a2")
    log.call_start(10, "a2", "s1/c2/0:0", "E4")
    log.call_end(14, "E2")
    log.result(14, "a3", "s2", "c1", 0)
    log.completed(14, "o1.2", "s2", "c1", 0, "a3")
    log.verified(14, "o1.2", "s2", "c1", 0)
    log.dispatched(14, "o1.2", "s2", "c2", 0, "a4")
    log.call_start(14, "a4", "s2/c2/0:0", "E6")


def swarm_tail(log: Log) -> None:
    log.call_end(39, "E6")
    log.result(40, "a4", "s2", "c2", 0)
    log.completed(40, "o1.2", "s2", "c2", 0, "a4")
    log.verified(40, "o1.2", "s2", "c2", 0)
    log.goal_done(40, "o1.2", "s2")
    log.goal_done(41, "o1", "t1")
    log.goal_done(42, "o0", "root")
    log.done(45)


def a_session_coordinator_dies() -> Log:
    """o1.1 is killed at 20 s with a2 midway through s1/c2. a2 finishes at 21 and sends its result
    at 22, to a dead owner. o1.2 remaps s1 at 25 s and consumes the result."""
    log = Log()
    swarm_cast(log)
    log.kill(20, "o1.1")
    log.call_end(21, "E4", cost=0.2)
    log.result(22, "a2", "s1", "c2", 0)
    log.remapped(25, "s1", "o1.2", "o1.1")
    log.completed(25, "o1.2", "s1", "c2", 0, "a2")
    log.verified(25, "o1.2", "s1", "c2", 0)
    log.goal_done(25, "o1.2", "s1")
    swarm_tail(log)
    return log


def test_a_swarm_session_coordinator_dying() -> None:
    m = run(a_session_coordinator_dies())
    (row,) = m.outages
    # The window runs from the kill (20 s) to the remap (25 s) of the one goal o1.1 still owned.
    assert (row.kind, row.coordinator, row.level, row.goals) == ("crash", "o1.1", 2, 1)
    assert (row.onset_s, row.end_s, row.recovered) == (20.0, 25.0, True)
    assert row.ttr_own_s == pytest.approx(5.0)
    # a2's result waited from 22 s to 25 s for a coordinator; nothing else was waiting.
    assert row.blocked_items == 1 and row.cdt_s == pytest.approx(3.0)
    assert row.ttr_drain_s == pytest.approx(5.0)
    assert m.cdt_s == pytest.approx(3.0) and m.blocked_total_s == pytest.approx(3.0)
    # One of the two sessions is held up, and the two agents it was given of the four alive.
    assert (row.blast_sessions, row.blast_sessions_pct) == (1, pytest.approx(50.0))
    assert (row.blast_agents, row.blast_agents_pct) == (2, pytest.approx(50.0))
    # a1 and a2 are free for the 3 s the result waits (a2 holds nothing since it sent its result).
    assert row.idle_agent_s == pytest.approx(6.0)
    assert row.idle_agent_own_s == pytest.approx(3.0)  # only a2, the sender of the waiting result
    assert row.idle_agent_wide_s == pytest.approx(6.0)  # o1.1's two agents; o1.2's are not counted
    # The call in flight at the kill (a2's, 10 s to 21 s) completed and was used.
    assert (row.at_risk_calls, row.preserved_calls) == (1, 1) and m.preserved_pct == 100.0
    # After the remap, o1.2 owns both unfinished sessions.
    assert (m.exposure_peak_sessions, m.exposure_peak_pct) == (2, pytest.approx(100.0))
    assert m.crashes == 1 and m.partitions == 0 and m.unrecovered == 0
    assert m.ttr_own_mean_s == m.ttr_own_max_s == pytest.approx(5.0)
    assert m.blast_sessions_mean_pct == pytest.approx(50.0)


def test_nothing_is_duplicated_or_reassigned_when_the_work_survives_the_crash() -> None:
    m = run(a_session_coordinator_dies())
    assert (m.dup_calls, m.dup_usd, m.unconsumed_calls) == (0, 0.0, 0)
    assert (m.lost_redispatches, m.unnecessary_reassignments, m.false_death_remaps) == (0, 0, 0)


# -- an agent killed during the outage -------------------------------------------------------


def an_agent_dies_while_its_coordinator_is_down() -> Log:
    """As above, but a2 is killed at 22 s, in the middle of its call, while o1.1 is down. o1.2
    remaps s1 at 25 s, gives up on a2's attempt as lost and sends attempt 1 to a1."""
    log = Log()
    swarm_cast(log)
    log.kill(20, "o1.1")
    log.kill(22, "a2", "kill_agent")
    log.call_cancel(22, "E4", "a2")
    log.remapped(25, "s1", "o1.2", "o1.1")
    log.rejected(25, "o1.2", "s1", "c2", 0, "lost", "agent a2 was lost")
    log.dispatched(25, "o1.2", "s1", "c2", 1, "a1")
    log.call_start(25, "a1", "s1/c2/1:0", "E5")
    log.call_end(33, "E5", cost=0.2)
    log.result(34, "a1", "s1", "c2", 1)
    log.completed(34, "o1.2", "s1", "c2", 1, "a1")
    log.verified(34, "o1.2", "s1", "c2", 1)
    log.goal_done(34, "o1.2", "s1")
    swarm_tail(log)
    return log


def test_an_agent_killed_during_an_outage_is_not_idle_and_its_loss_is_not_unnecessary() -> None:
    m = run(an_agent_dies_while_its_coordinator_is_down(), E4=0.15)
    (row,) = m.outages
    assert row.ttr_own_s == pytest.approx(5.0)
    # The lost attempt counts as ready for a coordinator from the agent's stop (22 s) to the new
    # dispatch (25 s): 3 s inside the window.
    assert row.blocked_items == 1 and row.cdt_s == pytest.approx(3.0)
    # a2 is dead from 22 s, so only a1 can be idle; all three readings agree.
    assert row.idle_agent_s == pytest.approx(3.0)
    assert row.idle_agent_own_s == pytest.approx(3.0)
    assert row.idle_agent_wide_s == pytest.approx(3.0)
    # The call a2 had in flight was cut off by the agent's death, not kept.
    assert (row.at_risk_calls, row.preserved_calls) == (1, 0) and m.preserved_pct == 0.0
    # The re-dispatch was necessary: a2 really died, and chaos killed it.
    assert (m.lost_redispatches, m.redispatch_agent_kill, m.redispatch_crash_stop) == (1, 1, 0)
    assert (m.unnecessary_redispatches, m.unnecessary_reassignments) == (0, 0)
    # The cancelled call is duplicated work, charged to the agent kill and not to the crash.
    assert (m.dup_calls, m.dup_agent_kill_calls, m.dup_crash_calls) == (1, 1, 0)
    assert m.dup_usd == pytest.approx(0.15) and m.dup_agent_kill_usd == pytest.approx(0.15)
    assert m.unconsumed_calls == 0


# -- a false death ---------------------------------------------------------------------------


def a_coordinator_is_declared_dead_while_alive() -> Log:
    """Nobody is killed. At 20 s o1.2 takes s1 from o1.1, which is alive, rejects a2's attempt as
    lost and sends attempt 1 to a1. a2 finishes attempt 0 anyway, at 29 s, and it is not used."""
    log = Log()
    swarm_cast(log)
    log.remapped(20, "s1", "o1.2", "o1.1")
    log.rejected(20, "o1.2", "s1", "c2", 0, "lost", "agent a2 was lost")
    log.dispatched(20, "o1.2", "s1", "c2", 1, "a1")
    log.call_start(20, "a1", "s1/c2/1:0", "E5")
    log.call_end(29, "E4", cost=0.2)
    log.result(29, "a2", "s1", "c2", 0)
    log.call_end(33, "E5", cost=0.2)
    log.result(34, "a1", "s1", "c2", 1)
    log.completed(34, "o1.2", "s1", "c2", 1, "a1")
    log.verified(34, "o1.2", "s1", "c2", 1)
    log.goal_done(34, "o1.2", "s1")
    swarm_tail(log)
    return log


def test_a_false_death_is_an_unnecessary_reassignment_and_not_an_outage() -> None:
    m = run(a_coordinator_is_declared_dead_while_alive())
    assert m.outages == [] and m.crashes == 0 and m.cdt_s == 0.0
    assert m.false_death_remaps == 1
    # The goal was taken from a live owner, and its live agent's attempt was given up as lost.
    assert m.lost_redispatches == 1 and m.unnecessary_redispatches == 1
    assert m.unnecessary_reassignments == 2
    # a2's finished attempt was paid and never used: duplicated work, caused by the false death.
    assert (m.dup_calls, m.dup_false_death_calls) == (1, 1)
    assert m.dup_false_death_usd == pytest.approx(0.2) and m.dup_usd == pytest.approx(0.2)
    assert (m.dup_crash_calls, m.dup_agent_kill_calls, m.dup_other_calls) == (0, 0, 0)


# -- a crash with nothing in flight ----------------------------------------------------------


def a_coordinator_dies_with_nothing_to_decide() -> Log:
    """The track lead o1 is killed at 20 s. It owns t1, which only waits for its sessions; no
    contract, call or result is waiting for it. o0 takes t1 over at 25 s."""
    log = Log()
    swarm_cast(log)
    log.call_end(19, "E4", cost=0.2)
    log.result(19, "a2", "s1", "c2", 0)
    log.completed(19, "o1.1", "s1", "c2", 0, "a2")
    log.verified(19, "o1.1", "s1", "c2", 0)
    log.goal_done(19, "o1.1", "s1")
    log.kill(20, "o1")
    log.remapped(25, "t1", "o0", "o1")
    swarm_tail(log)
    return log


def test_a_crash_with_nothing_in_flight_blocks_nothing() -> None:
    m = run(a_coordinator_dies_with_nothing_to_decide())
    (row,) = m.outages
    assert (row.coordinator, row.level, row.goals) == ("o1", 1, 1)
    assert row.ttr_own_s == pytest.approx(5.0) and row.ttr_drain_s == pytest.approx(5.0)
    assert (row.blocked_items, row.cdt_s) == (0, 0.0)
    assert (row.blast_sessions, row.blast_agents) == (0, 0)
    assert (row.idle_agent_own_s, row.idle_agent_s, row.idle_agent_wide_s) == (0.0, 0.0, 0.0)
    assert (row.at_risk_calls, row.preserved_calls) == (0, 0)
    assert m.preserved_pct is None, "nothing was at risk, so there is no share to report"
    assert (m.cdt_s, m.blocked_total_s, m.idle_agent_s) == (0.0, 0.0, 0.0)
    assert m.crashes == 1 and m.ttr_own_mean_s == pytest.approx(5.0)


def test_a_coordinator_that_owned_nothing_unfinished_has_an_empty_window() -> None:
    log = Log()
    swarm_cast(log)
    log.call_end(19, "E4", cost=0.2)
    log.result(19, "a2", "s1", "c2", 0)
    log.completed(19, "o1.1", "s1", "c2", 0, "a2")
    log.verified(19, "o1.1", "s1", "c2", 0)
    log.goal_done(19, "o1.1", "s1")
    log.kill(20, "o1.1")  # s1 is done and o1.1 owns no other goal
    swarm_tail(log)
    m = run(log)
    (row,) = m.outages
    assert row.goals == 0 and row.ttr_own_s == 0.0 and row.ttr_drain_s == 0.0 and row.recovered
    assert m.crashes == 1 and m.cdt_s == 0.0 and m.preserved_pct is None


# -- a coordinator that is never replaced ----------------------------------------------------


def test_an_outage_that_is_never_repaired_ends_with_the_run() -> None:
    log = Log()
    swarm_cast(log)
    log.kill(20, "o1.1")
    log.done(30)
    m = run(log)
    (row,) = m.outages
    assert not row.recovered and row.end_s == 30.0 and row.ttr_own_s == pytest.approx(10.0)
    assert m.unrecovered == 1


# -- partitions ------------------------------------------------------------------------------


def a_partition(heal_at: float | None, remap_at: float | None) -> Log:
    """o1.1 is cut off from 20 s with a2's result (sent at 22 s) in its inbox. The partition heals
    at ``heal_at``, or o1.2 takes s1 at ``remap_at`` (whichever the test sets)."""
    log = Log()
    swarm_cast(log)
    log.add(
        20,
        "chaos.injected",
        "chaos",
        fault="partition",
        target="o1.1",
        progress=0.5,
        detail={"partition": "p1", "duration_ms": 8000},
    )
    log.call_end(21, "E4", cost=0.2)
    log.result(22, "a2", "s1", "c2", 0)
    if remap_at is not None:
        log.remapped(remap_at, "s1", "o1.2", "o1.1")
        log.completed(remap_at, "o1.2", "s1", "c2", 0, "a2")
        log.verified(remap_at, "o1.2", "s1", "c2", 0)
        log.goal_done(remap_at, "o1.2", "s1")
    if heal_at is not None:
        detail = {"partition": "p1"}
        log.add(heal_at, "chaos.injected", "chaos", fault="heal", target="o1.1", detail=detail)
        if remap_at is None:
            log.completed(heal_at, "o1.1", "s1", "c2", 0, "a2")
            log.verified(heal_at, "o1.1", "s1", "c2", 0)
            log.goal_done(heal_at, "o1.1", "s1")
    swarm_tail(log)
    return log


def test_a_partition_that_heals_is_an_outage_that_ends_at_the_heal() -> None:
    m = run(a_partition(heal_at=23, remap_at=None))
    (row,) = m.outages
    assert row.kind == "partition" and row.coordinator == "o1.1" and row.recovered
    assert row.ttr_own_s == pytest.approx(3.0) and row.cdt_s == pytest.approx(1.0)
    assert (m.crashes, m.partitions, m.false_death_remaps) == (0, 1, 0)
    # a1 and a2 are free for the 1 s the result waits.
    assert row.idle_agent_s == pytest.approx(2.0) and row.idle_agent_own_s == pytest.approx(1.0)
    assert (row.at_risk_calls, row.preserved_calls) == (0, 0), "at-risk work is a crash's figure"
    assert m.ttr_own_mean_s is None, "the means are over crashes, and there was none"


def test_a_partition_that_ends_in_a_takeover_is_also_a_false_death() -> None:
    m = run(a_partition(heal_at=28, remap_at=25))
    (row,) = m.outages
    assert row.kind == "partition" and row.ttr_own_s == pytest.approx(5.0)
    assert row.cdt_s == pytest.approx(3.0)
    # o1.1 was alive on the other side of the cut when o1.2 took its goal.
    assert m.false_death_remaps == 1 and m.unnecessary_reassignments == 1


# -- supervisors: one process, a restart -----------------------------------------------------


def supervisor_cast(log: Log) -> None:
    """o0 leads four agents and two sessions: s1 (c1) and s2 (c1, then c2)."""
    log.start()
    log.spawn(0, "o0", "orchestrator")
    for agent in ("a1", "a2", "a3", "a4"):
        log.spawn(0, agent, "agent", "o0")
    log.opened(1, "s1")
    log.opened(1, "s2")
    log.created(2, "o0", "s1", "c1", "a1")
    log.created(2, "o0", "s2", "c1", "a2")
    log.created(2, "o0", "s2", "c2", "a3", ("c1",))
    log.dispatched(2, "o0", "s1", "c1", 0, "a1")
    log.dispatched(2, "o0", "s2", "c1", 0, "a2")
    log.call_start(2, "a1", "s1/c1/0:0", "E1")
    log.call_start(2, "a2", "s2/c1/0:0", "E2")
    log.call_end(18, "E2")
    log.result(18, "a2", "s2", "c1", 0)
    log.completed(18, "o0", "s2", "c1", 0, "a2")
    log.call_start(18, "o0", "judge|s2|c1|0", "J1")


def durable_max_outage() -> Log:
    """o0 crashes at 20 s and is back at 25 s. Its workers go on: a1 sends its result at 21 s,
    and the judge call o0 had in flight completes at 23 s. At the restart o0 adopts the result
    and the verdict from the log, with no call asked again."""
    log = Log()
    supervisor_cast(log)
    log.crashed(20, 1)
    log.call_end(21, "E1")
    log.result(21, "a1", "s1", "c1", 0)
    log.call_end(23, "J1", cost=0.02)
    log.restarted(25, 1)
    log.completed(25, "o0", "s1", "c1", 0, "a1")
    log.verified(25, "o0", "s1", "c1", 0)
    log.goal_done(25, "o0", "s1")
    log.judged(25, "o0", "s2", "c1", 0)
    log.verified(25, "o0", "s2", "c1", 0)
    log.dispatched(25, "o0", "s2", "c2", 0, "a3")
    log.call_start(25, "a3", "s2/c2/0:0", "E3")
    log.call_end(35, "E3")
    log.result(35, "a3", "s2", "c2", 0)
    log.completed(35, "o0", "s2", "c2", 0, "a3")
    log.verified(35, "o0", "s2", "c2", 0)
    log.goal_done(35, "o0", "s2")
    log.goal_done(36, "o0", "root")
    log.done(37)
    return log


def durable_outage() -> Log:
    """The same, except the judge call o0 had in flight is lost with the process: it is cut off at
    20 s and asked again at 25 s, and answers at 27 s."""
    log = Log()
    supervisor_cast(log)
    log.crashed(20, 1, lost=("judge|s2|c1|0",))
    log.call_cancel(20, "J1", "o0")
    log.call_end(21, "E1")
    log.result(21, "a1", "s1", "c1", 0)
    log.restarted(25, 1)
    log.completed(25, "o0", "s1", "c1", 0, "a1")
    log.verified(25, "o0", "s1", "c1", 0)
    log.goal_done(25, "o0", "s1")
    log.call_start(25, "o0", "judge|s2|c1|0", "J1b", again="J1")
    log.call_end(27, "J1b", cost=0.02)
    log.judged(27, "o0", "s2", "c1", 0)
    log.verified(27, "o0", "s2", "c1", 0)
    log.dispatched(27, "o0", "s2", "c2", 0, "a3")
    log.call_start(27, "a3", "s2/c2/0:0", "E3")
    log.call_end(37, "E3")
    log.result(37, "a3", "s2", "c2", 0)
    log.completed(37, "o0", "s2", "c2", 0, "a3")
    log.verified(37, "o0", "s2", "c2", 0)
    log.goal_done(37, "o0", "s2")
    log.goal_done(38, "o0", "root")
    log.done(39)
    return log


def test_a_durable_max_restart_blocks_what_it_has_not_yet_adopted() -> None:
    m = run(durable_max_outage())
    (row,) = m.outages
    assert (row.kind, row.coordinator, row.level) == ("crash", "o0", 0)
    assert row.goals == 3, "o0 owns the root and both sessions"
    assert row.ttr_own_s == pytest.approx(5.0) and row.ttr_drain_s == pytest.approx(5.0)
    # a1's result waited from 21 s to the restart (4 s) and the verdict from 23 s (2 s).
    assert row.blocked_items == 2 and row.cdt_s == pytest.approx(6.0)
    assert m.cdt_s == pytest.approx(6.0) and m.blocked_total_s == pytest.approx(6.0)
    assert (row.blast_sessions, row.blast_sessions_pct) == (2, pytest.approx(100.0))
    assert (row.blast_agents, row.blast_agents_pct) == (3, pytest.approx(75.0))
    # a1 free from 21 s (4 s), a2 and a3 free while s2's verdict waits (2 s each); a4 has none.
    assert row.idle_agent_s == pytest.approx(8.0)
    assert row.idle_agent_own_s == pytest.approx(4.0)
    assert row.idle_agent_wide_s == pytest.approx(16.0), "the four agents, for the 4 s of waiting"
    # Both calls in flight at the crash (a1's, o0's judge) completed and were used.
    assert (row.at_risk_calls, row.preserved_calls) == (2, 2) and m.preserved_pct == 100.0
    assert (m.dup_calls, m.dup_usd, m.unconsumed_calls) == (0, 0.0, 0)
    assert m.unnecessary_reassignments == 0
    assert (m.exposure_peak_sessions, m.exposure_peak_pct) == (2, pytest.approx(100.0))


def test_a_durable_restart_that_asks_a_lost_call_again() -> None:
    m = run(durable_outage(), J1=0.03)
    (row,) = m.outages
    assert row.ttr_own_s == pytest.approx(5.0)
    # The lost judge call counts as waiting from the cut to the re-issue (5 s, on s2), next to
    # a1's result (4 s).
    assert row.blocked_items == 2 and row.cdt_s == pytest.approx(9.0)
    assert row.idle_agent_s == pytest.approx(14.0) and row.idle_agent_own_s == pytest.approx(4.0)
    assert row.idle_agent_wide_s == pytest.approx(19.0)
    # Of the two calls in flight, the judge's was lost.
    assert (row.at_risk_calls, row.preserved_calls) == (2, 1) and m.preserved_pct == 50.0
    # The cut-off call was paid for and asked again: duplicated work, caused by the crash.
    assert (m.dup_calls, m.dup_crash_calls) == (1, 1)
    assert m.dup_usd == pytest.approx(0.03) and m.dup_crash_usd == pytest.approx(0.03)
    assert m.unconsumed_calls == 0


# -- the process-tree supervisor: its crash stops the workers --------------------------------


def a_process_tree_crash() -> Log:
    """The in-process supervisor. Its crash at 20 s stops every agent (reason ``crash``) and cuts
    a1's call. At 25 s it is back, the agents are spawned again, and s1/c1 goes out as attempt 1."""
    log = Log()
    log.start()
    log.spawn(0, "o0", "orchestrator")
    for agent in ("a1", "a2", "a3", "a4"):
        log.spawn(0, agent, "agent", "o0")
    log.created(2, "o0", "s1", "c1", "a1")  # no goal.opened: a central log has none
    log.dispatched(2, "o0", "s1", "c1", 0, "a1")
    log.call_start(2, "a1", "s1/c1/0:0", "E1")
    log.crashed(20, 1)
    for agent in ("a1", "a2", "a3", "a4"):
        log.stop(20, agent, "crash")
    log.call_cancel(20, "E1", "a1")
    log.restarted(25, 1)
    for agent in ("a1", "a2", "a3", "a4"):
        log.spawn(25, agent, "agent", "o0")
    log.rejected(25, "o0", "s1", "c1", 0, "lost", "agent a1 was lost")
    log.dispatched(25, "o0", "s1", "c1", 1, "a1")
    log.call_start(25, "a1", "s1/c1/1:0", "E1b")
    log.call_end(35, "E1b")
    log.result(35, "a1", "s1", "c1", 1)
    log.completed(35, "o0", "s1", "c1", 1, "a1")
    log.verified(35, "o0", "s1", "c1", 1)
    log.goal_done(35, "o0", "s1")
    log.goal_done(36, "o0", "root")
    log.done(37)
    return log


def test_a_process_tree_crash_loses_the_work_and_idles_nobody() -> None:
    m = run(a_process_tree_crash(), E1=0.04)
    (row,) = m.outages
    assert row.goals == 2 and row.ttr_own_s == pytest.approx(5.0)
    # The lost attempt was ready from the agent's stop: 5 s of waiting for the dead coordinator.
    assert row.blocked_items == 1 and row.cdt_s == pytest.approx(5.0)
    # Every agent is dead during the outage, so none is idle: what the crash costs is the work.
    assert (row.idle_agent_own_s, row.idle_agent_s, row.idle_agent_wide_s) == (0.0, 0.0, 0.0)
    assert (row.at_risk_calls, row.preserved_calls) == (1, 0) and m.preserved_pct == 0.0
    assert (m.lost_redispatches, m.redispatch_crash_stop, m.redispatch_agent_kill) == (1, 1, 0)
    assert m.unnecessary_reassignments == 0, "the workers really were stopped"
    assert (m.dup_calls, m.dup_crash_calls) == (1, 1) and m.dup_crash_usd == pytest.approx(0.04)
    # A log with no goal.opened still gives the exposure: its sessions all belong to o0.
    assert (m.exposure_peak_sessions, m.exposure_peak_pct) == (1, pytest.approx(100.0))


# -- one rule for both kinds of log ----------------------------------------------------------


def one_session(shape: str) -> Log:
    """The same outage, 20 s to 25 s, in a swarm log (the session's coordinator o1 dies and the
    root takes over) and in a supervisor log (o0 crashes and restarts): one session with two
    contracts, a2's result sent at 22 s and consumed at 25 s."""
    log = Log()
    log.start()
    log.spawn(0, "o0", "orchestrator")
    owner = "o1" if shape == "swarm" else "o0"
    if shape == "swarm":
        log.spawn(0, "o1", "orchestrator", "o0")
    for agent in ("a1", "a2"):
        log.spawn(0, agent, "agent", owner)
    if shape == "swarm":
        log.assigned(1, "s1", "o1")
    else:
        log.opened(1, "s1")
    log.created(2, owner, "s1", "c1", "a1")
    log.created(2, owner, "s1", "c2", "a2", ("c1",))
    log.dispatched(2, owner, "s1", "c1", 0, "a1")
    log.call_start(2, "a1", "s1/c1/0:0", "E1")
    log.call_end(10, "E1")
    log.result(10, "a1", "s1", "c1", 0)
    log.completed(10, owner, "s1", "c1", 0, "a1")
    log.verified(10, owner, "s1", "c1", 0)
    log.dispatched(10, owner, "s1", "c2", 0, "a2")
    log.call_start(10, "a2", "s1/c2/0:0", "E2")
    if shape == "swarm":
        log.kill(20, "o1")
    else:
        log.crashed(20, 1)
    log.call_end(21, "E2", cost=0.2)
    log.result(22, "a2", "s1", "c2", 0)
    if shape == "swarm":
        log.remapped(25, "s1", "o0", "o1")
    else:
        log.restarted(25, 1)
    log.completed(25, "o0", "s1", "c2", 0, "a2")
    log.verified(25, "o0", "s1", "c2", 0)
    log.goal_done(25, "o0", "s1")
    log.goal_done(26, "o0", "root")
    log.done(27)
    return log


def test_the_same_outage_gives_the_same_figures_in_a_swarm_and_a_supervisor_log() -> None:
    swarm = run(one_session("swarm")).outages[0]
    supervisor = run(one_session("supervisor")).outages[0]
    ignore = {"coordinator", "level", "goals"}  # who died and what it owned differ by design
    assert swarm.model_dump(exclude=ignore) == supervisor.model_dump(exclude=ignore)
    assert swarm.ttr_own_s == pytest.approx(5.0) and swarm.cdt_s == pytest.approx(3.0)
    assert swarm.idle_agent_s == pytest.approx(6.0)
    assert (swarm.goals, supervisor.goals) == (1, 2), "the supervisor also owns the root"


# -- structural waiting ----------------------------------------------------------------------


def test_a_single_worker_waits_without_any_crash() -> None:
    """Two contracts are ready at 2 s but the one worker takes the second only at 12 s. No
    coordinator is down, so the wait is in ``blocked_total_s`` and not in the dependency time."""
    log = Log()
    log.start()
    log.spawn(0, "o0", "orchestrator")
    log.spawn(0, "a1", "agent", "o0")
    log.opened(1, "s1")
    log.created(2, "o0", "s1", "c1", "a1")
    log.created(2, "o0", "s1", "c2", "a1")
    log.dispatched(2, "o0", "s1", "c1", 0, "a1")
    log.result(12, "a1", "s1", "c1", 0)
    log.completed(12, "o0", "s1", "c1", 0, "a1")
    log.verified(12, "o0", "s1", "c1", 0)
    log.dispatched(12, "o0", "s1", "c2", 0, "a1")
    log.done(20)
    m = run(log)
    assert m.crashes == 0 and m.cdt_s == 0.0
    assert m.blocked_total_s == pytest.approx(10.0)
    assert m.preserved_pct is None and m.idle_agent_s == 0.0 and m.outages == []


# -- empty and odd logs ----------------------------------------------------------------------


def test_an_empty_log_has_no_metrics() -> None:
    assert analyze([]) == RecoveryMetrics()


def test_a_log_without_any_chaos_has_no_outage_and_no_means() -> None:
    log = Log()
    swarm_cast(log)
    swarm_tail(log)
    m = run(log)
    assert m.outages == [] and m.crashes == 0 and m.ttr_own_mean_s is None
    assert m.blast_sessions_mean_pct is None and m.preserved_pct is None
    assert m.cdt_s == 0.0 and m.exposure_peak_pct == pytest.approx(50.0)  # o1.1 and o1.2: 1 of 2
