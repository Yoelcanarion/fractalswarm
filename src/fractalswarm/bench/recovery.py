"""Recovery metrics (arena spec §B, backend-design §2): what a coordinator outage cost a run.

Pure functions of the event log, with the same rule for every workflow: a swarm log and a
supervisor log (``central``, ``durable-max``, ``durable``, ``single``, ``pipeline``) go through
the same code, and a metric only reads events both can produce. Times are virtual milliseconds
inside, seconds in the models. ``analyze`` returns every metric of a run; ``verify/recovery.py``
prints the per-outage table and checks the supervisor invariants.

**Outage window.** A coordinator X is *down for a goal* from the onset to the event that gives
that goal a live decider again. An onset is one of:

- a ``chaos.injected`` ``kill_coordinator`` that hit X (a swarm log), or a ``baseline.crashed``
  (a supervisor log, where the coordinator is ``o0``);
- a ``chaos.injected`` ``partition`` whose target is a coordinator that is still up (kind
  ``partition``).

The goals concerned are the unfinished goals X owned at the onset (the ownership log: ``ownership
.assigned``, ``ownership.remapped``, ``goal.opened``, the root goal belongs to the first
orchestrator). Each goal's down span ends at:

- the first ``ownership.remapped`` of that goal with ``previous == X``, in a swarm log;
- the matching ``baseline.restarted`` (same ``crash`` number), in a supervisor log;
- for a partition: the ``heal``, or the remap if that comes first.

A goal that completes first ends its span at the completion, and one that never recovers ends
at the run's end (the outage is then ``recovered = False``). The outage's window runs from the
onset to the latest end of its goals; it is empty when X owned nothing unfinished (a crash with
nothing in flight).

**Time to recover.** ``ttr_own_s`` is the window's length. ``ttr_drain_s`` runs from the onset to
the end of the last wait interval (below) that overlaps one of the outage's down spans, and is
never shorter than ``ttr_own_s``: the time until the work the outage held up is released.

**Wait intervals.** A decision is something only the goal's coordinator can do; the interval is
the time the work waited for it, counted per contract attempt:

- *result*: the agent's ``contract.result`` message → ``contract.completed``;
- *judge*: the judge call's ``effect.completed`` (tag ``judge|goal|contract|attempt``) → the
  ``verify.judged`` that used it;
- *book*: the ``book.result`` message → ``contract.verified`` or ``contract.rejected``;
- *plan*: the plan call's ``effect.completed`` (tag ``plan|goal|attempt``) → the ``plan.proposed``
  or ``plan.refined`` of that goal;
- *dispatch*: ready → ``contract.dispatched``. Ready is the creation or the verification of the
  last dependency for a first attempt, and the loss (the assignee's ``actor.stopped``, else the
  ``contract.rejected``) for a retry;
- *lost call*: an own call (plan, judge, scan) cancelled by a stop or a crash → the next
  ``effect.started`` with the same tag.

An interval's goal is the goal it belongs to. Scan completions are not intervals (scans end
before the first dispatch); a cancelled scan is a lost call.

**Coordinator-dependency time.** ``cdt_s`` is the sum, over wait intervals, of their overlap with
the down spans of their goal, in contract-seconds (a span counts once per interval, however many
outages cover it). ``cdt_s`` is 0 at C0. ``blocked_total_s`` is the sum of the whole intervals,
outage or not: the structural waiting of ``single`` and ``pipeline``, and the failure detection
of dead agents, show up here.

**Blast radius**, per crash: the sessions (leaf goals, the ones with contracts) that have a wait
interval inside a down span, and the agents of those sessions (every assignee of their contracts)
that were alive at the onset, as a share of all sessions and of the agents alive at the onset.

**Exposure.** The most unfinished sessions one coordinator owned at any time, as a share of all
the sessions of the run.

**Idle agent-seconds** (``idle_agent_s``, backend-design §2): the time an agent is alive, holds no
dispatched attempt (dispatch → its result sent, or its stop), and one of its sessions has a wait
interval inside a down span. An agent's sessions are the goals it was given contracts in (the
assignee of ``contract.created`` or ``contract.dispatched``), so a swarm session's two agents and
a supervisor's pooled agents follow the same rule. This is the **primary reading** (fixed in
``bench/PREREG.md`` before any gate run): it counts an agent only when work it could take is held
up, and it is the definition the design gives. Two other readings bracket it, and the verdicts
report all three: ``idle_agent_own_s`` (a lower bound) counts only the wait intervals that name
the agent, the assignee of a *dispatch* that nobody has sent or the sender of a *result* that
nobody has consumed; ``idle_agent_wide_s`` (an upper bound) counts every alive agent without an
attempt that belongs to the outage's coordinator (the parent that spawned it, or the heir that
adopted it) for as long as any wait interval of the outage is inside a down span, so a
supervisor's whole pool counts against the two agents of a swarm session, whether or not its own
session was held up.

**Reassignments.** A *lost* re-dispatch follows a ``contract.rejected`` with stage ``lost``. It is
*unnecessary* when the assignee was never stopped, or when its result for that attempt was in the
log, unconsumed. Its other causes are reported apart: the assignee was killed by chaos, or was
stopped by its coordinator's crash (the in-process supervisor). A second dispatch of the same
attempt is unnecessary too. A *false-death remap* is an ``ownership.remapped`` to a new owner
while the previous owner had not stopped. ``unnecessary_reassignments`` adds the two.

**Duplicated work.** Every LLM call is classified once:

- *consumed*: a call of the attempt that was verified, or of the own call that was used;
- *duplicated*: a call whose work was done again, by the cause below (the calls of an attempt that
  a later attempt replaced, own calls issued again under the same tag, and completed calls with
  an identical request beyond the first);
- *unconsumed*: paid or cancelled work that nothing used and nothing redid;
- failed calls (errors, refusals) are not counted.

The cause of a duplicate is ``coordinator_crash`` (the call's actor was stopped by a kill or a
crash of a coordinator, or its agent by its coordinator's crash), ``agent_kill`` (a chaos kill of
the agent), ``false_death`` (the first worker had not stopped when the work was given to another)
or ``other`` (a rejected verdict, an API retry). Cancelled calls cost their estimate
(``bench/scoring.py``).

**Preserved work**, per crash: of the calls in flight at the onset that belonged to the crashed
coordinator or to the agents it owned, the share that completed and was consumed.
"""

from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel

from fractalswarm.kernel.events import ENV, Event
from fractalswarm.kernel.ids import digest

if TYPE_CHECKING:  # bench/scoring.py imports this module for RunMetrics
    from fractalswarm.bench.scoring import LLMCall

SECOND = 1000
PAID = ("ok", "incomplete")
OWN_PREFIXES = ("plan|", "judge|", "scan|")  # baselines/durable.py: OWN_TAG_PREFIXES
PLAN_EVENTS = ("plan.proposed", "plan.refined")
CAUSES = ("coordinator_crash", "agent_kill", "false_death", "other")

Span = tuple[int, int]
LAST = 1 << 62  # a sequence number after every event


# -- results ---------------------------------------------------------------------------------


class OutageRow(BaseModel):
    """One coordinator outage: a crash or a partition."""

    number: int  # 1-based, per kind, in onset order
    kind: Literal["crash", "partition"]
    coordinator: str
    level: int  # depth of the coordinator in the tree: 0 the root, 1 a track lead, 2 a session
    onset_s: float
    end_s: float
    recovered: bool
    goals: int  # unfinished goals the coordinator owned at the onset
    ttr_own_s: float
    ttr_drain_s: float
    blocked_items: int
    cdt_s: float
    blast_sessions: int
    blast_sessions_pct: float
    blast_agents: int
    blast_agents_pct: float
    idle_agent_own_s: float
    idle_agent_s: float
    idle_agent_wide_s: float
    at_risk_calls: int
    preserved_calls: int


class RecoveryMetrics(BaseModel):
    """Every recovery metric of one run. ``None`` is a mean over no crashes."""

    crashes: int = 0
    partitions: int = 0
    unrecovered: int = 0
    ttr_own_mean_s: float | None = None
    ttr_own_max_s: float | None = None
    ttr_drain_mean_s: float | None = None
    ttr_drain_max_s: float | None = None
    cdt_s: float = 0.0
    blocked_total_s: float = 0.0
    blast_sessions_mean_pct: float | None = None
    blast_sessions_max_pct: float | None = None
    blast_agents_mean_pct: float | None = None
    blast_agents_max_pct: float | None = None
    exposure_peak_pct: float = 0.0
    exposure_peak_sessions: int = 0
    idle_agent_own_s: float = 0.0
    idle_agent_s: float = 0.0
    idle_agent_wide_s: float = 0.0
    lost_redispatches: int = 0
    redispatch_agent_kill: int = 0
    redispatch_crash_stop: int = 0
    unnecessary_redispatches: int = 0
    false_death_remaps: int = 0
    unnecessary_reassignments: int = 0
    dup_calls: int = 0
    dup_usd: float = 0.0
    dup_crash_calls: int = 0
    dup_crash_usd: float = 0.0
    dup_agent_kill_calls: int = 0
    dup_agent_kill_usd: float = 0.0
    dup_false_death_calls: int = 0
    dup_false_death_usd: float = 0.0
    dup_other_calls: int = 0
    dup_other_usd: float = 0.0
    unconsumed_calls: int = 0
    unconsumed_usd: float = 0.0
    at_risk_calls: int = 0
    preserved_calls: int = 0
    preserved_pct: float | None = None
    outages: list[OutageRow] = []


# -- the log ---------------------------------------------------------------------------------


@dataclass
class _Call:
    effect_id: str
    actor: str
    tag: str | None
    request: str
    start_seq: int
    start: int
    close_seq: int | None = None
    close: int | None = None
    status: str = "inflight"
    cost: float = 0.0


@dataclass
class _Log:
    events: list[Event]
    start: int = 0
    end: int = 0
    root: str = "o0"
    kind: dict[str, str] = field(default_factory=dict)
    parent: dict[str, str | None] = field(default_factory=dict)
    spawns: dict[str, list[Event]] = field(default_factory=lambda: defaultdict(list))
    stops: dict[str, list[Event]] = field(default_factory=lambda: defaultdict(list))
    by_type: dict[str, list[Event]] = field(default_factory=lambda: defaultdict(list))
    created: dict[tuple[str, str], Event] = field(default_factory=dict)
    dispatches: dict[tuple[str, str], list[Event]] = field(
        default_factory=lambda: defaultdict(list)
    )
    verified: dict[tuple[str, str], list[Event]] = field(default_factory=lambda: defaultdict(list))
    completed: dict[tuple[str, str, int], list[Event]] = field(
        default_factory=lambda: defaultdict(list)
    )
    rejected: dict[tuple[str, str, int], list[Event]] = field(
        default_factory=lambda: defaultdict(list)
    )
    results: dict[tuple[str, str, int], list[Event]] = field(
        default_factory=lambda: defaultdict(list)
    )
    judged: dict[tuple[str, str, int], list[Event]] = field(
        default_factory=lambda: defaultdict(list)
    )
    booked: dict[tuple[str, str, int], list[Event]] = field(
        default_factory=lambda: defaultdict(list)
    )
    judge_done: dict[tuple[str, str, int], list[Event]] = field(
        default_factory=lambda: defaultdict(list)
    )
    plan_done: dict[str, list[Event]] = field(default_factory=lambda: defaultdict(list))
    plans: dict[str, list[Event]] = field(default_factory=lambda: defaultdict(list))
    goal_done: dict[str, Event] = field(default_factory=dict)
    starts: dict[str, Event] = field(default_factory=dict)
    ends: dict[str, Event] = field(default_factory=dict)
    calls: dict[str, _Call] = field(default_factory=dict)

    @classmethod
    def build(cls, events: Iterable[Event]) -> "_Log":
        log = cls(events=sorted(events, key=lambda event: event.seq))
        started = completed = None
        for event in log.events:
            log._add(event)
            if event.type == "run.started" and started is None:
                started = event.ts_virtual
            elif event.type == "run.completed" and completed is None:
                completed = event.ts_virtual
        first = log.events[0].ts_virtual if log.events else 0
        last = max((event.ts_virtual for event in log.events), default=0)
        log.start = first if started is None else started
        log.end = last if completed is None else completed
        orchestrators = [a for a, kind in log.kind.items() if kind == "orchestrator"]
        roots = [a for a in orchestrators if log.parent.get(a) is None]
        log.root = (roots or orchestrators or ["o0"])[0]
        return log

    def _add(self, event: Event) -> None:
        p, kind = event.payload, event.type
        self.by_type[kind].append(event)
        if kind == "actor.spawned":
            self.kind.setdefault(p["actor_id"], p["kind"])
            self.parent.setdefault(p["actor_id"], p.get("parent"))
            self.spawns[p["actor_id"]].append(event)
        elif kind == "actor.stopped":
            self.stops[p["actor_id"]].append(event)
        elif kind == "contract.created":
            contract = p["contract"]
            self.created.setdefault((contract["goal_id"], contract["id"]), event)
        elif kind == "contract.dispatched":
            self.dispatches[(p["goal_id"], p["contract_id"])].append(event)
        elif kind == "contract.verified":
            self.verified[(p["goal_id"], p["contract_id"])].append(event)
        elif kind in ("contract.completed", "contract.rejected", "verify.judged"):
            key = (p["goal_id"], p["contract_id"], p["attempt"])
            target = {
                "contract.completed": self.completed,
                "contract.rejected": self.rejected,
                "verify.judged": self.judged,
            }[kind]
            target[key].append(event)
        elif kind == "msg.sent" and p["topic"] in ("contract.result", "book.result"):
            body = p["body"]
            key = (body["goal_id"], body["contract_id"], body["attempt"])
            (self.results if p["topic"] == "contract.result" else self.booked)[key].append(event)
        elif kind in PLAN_EVENTS:
            self.plans[p["goal_id"]].append(event)
        elif kind == "goal.completed":
            self.goal_done.setdefault(p["goal_id"], event)
        elif kind == "effect.started":
            self._start(event)
        elif kind in ("effect.completed", "effect.cancelled"):
            self._close(event)

    def _start(self, event: Event) -> None:
        p = event.payload
        self.starts.setdefault(p["effect_id"], event)
        if p["kind"] == "llm":
            self.calls[p["effect_id"]] = _Call(
                effect_id=p["effect_id"],
                actor=event.actor,
                tag=p.get("tag"),
                request=digest(p["request"]),
                start_seq=event.seq,
                start=event.ts_virtual,
            )

    def _close(self, event: Event) -> None:
        p = event.payload
        self.ends.setdefault(p["effect_id"], event)
        call = self.calls.get(p["effect_id"])
        if call is not None and call.close_seq is None:
            call.close_seq, call.close = event.seq, event.ts_virtual
            call.status = "cancelled" if event.type == "effect.cancelled" else p["status"]
        tag = p.get("tag") or ""
        if event.type == "effect.completed" and event.actor == ENV and p["status"] in PAID:
            parts = tag.split("|")
            if parts[0] == "judge" and len(parts) == 4:
                self.judge_done[(parts[1], parts[2], int(parts[3]))].append(event)
            elif parts[0] == "plan" and len(parts) == 3:
                self.plan_done[parts[1]].append(event)

    # -- helpers --------------------------------------------------------------------------

    def of(self, event_type: str) -> list[Event]:
        return self.by_type.get(event_type, [])

    def stop_after(self, actor: str, seq: int) -> Event | None:
        """The first stop of ``actor`` after ``seq``: the end of the incarnation alive then."""
        return next((stop for stop in self.stops.get(actor, ()) if stop.seq > seq), None)

    def alive_at(self, actor: str, seq: int) -> bool:
        spawns = [e.seq for e in self.spawns.get(actor, ()) if e.seq < seq]
        stops = [e.seq for e in self.stops.get(actor, ()) if e.seq < seq]
        return bool(spawns) and (not stops or stops[-1] < spawns[-1])

    def level(self, actor: str) -> int:
        """How many parents above ``actor`` (its spawn chain; the root has none)."""
        depth, seen = 0, {actor}
        parent = self.parent.get(actor)
        while parent is not None and parent not in seen:
            depth += 1
            seen.add(parent)
            parent = self.parent.get(parent)
        return depth

    def lifetimes(self, actor: str) -> list[Span]:
        """The spans in which ``actor`` was alive (one per incarnation)."""
        spans = []
        for spawn in self.spawns.get(actor, ()):
            stop = self.stop_after(actor, spawn.seq)
            spans.append((spawn.ts_virtual, self.end if stop is None else stop.ts_virtual))
        return spans

    @property
    def agents(self) -> list[str]:
        return sorted(a for a, kind in self.kind.items() if kind == "agent")

    @property
    def coordinators(self) -> set[str]:
        return {a for a, kind in self.kind.items() if kind == "orchestrator"}

    @property
    def sessions(self) -> list[str]:
        return sorted({goal for goal, _ in self.created})


class _Owners:
    """Who owned each goal, and each agent, at any point of the log (by ``seq``)."""

    def __init__(self, log: _Log) -> None:
        self.log = log
        self.goal: dict[str, list[tuple[int, str]]] = defaultdict(list)
        self.agent: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for event in log.events:
            p = event.payload
            if event.type in ("ownership.assigned", "ownership.remapped"):
                self.goal[p["key"]].append((event.seq, p["owner"]))
            elif event.type == "goal.opened":
                self.goal[p["goal_id"]].append((event.seq, p["owner"]))
            elif event.type == "tree.adopted":
                for child in p["children"]:
                    self.agent[child].append((event.seq, p["adopter"]))
        self.fallback: dict[str, str] = {}
        self.first: dict[str, int] = {}
        for created in sorted(log.created.values(), key=lambda e: e.seq):
            goal = created.payload["contract"]["goal_id"]
            self.fallback.setdefault(goal, created.payload.get("owner") or log.root)
            self.first.setdefault(goal, created.seq)

    def of_goal(self, goal: str, seq: int) -> str | None:
        owner: str | None = None
        for at, name in self.goal.get(goal, ()):
            if at > seq:
                break
            owner = name
        if owner is not None:
            return owner
        if goal == "root":
            return self.log.root
        return None if goal in self.goal else self.fallback.get(goal)

    def opened(self, goal: str, seq: int) -> bool:
        if goal == "root":
            return True
        if goal in self.goal:
            return self.goal[goal][0][0] <= seq
        return goal in self.first and self.first[goal] <= seq

    def of_agent(self, agent: str, seq: int) -> str | None:
        owner = self.log.parent.get(agent)
        for at, name in self.agent.get(agent, ()):
            if at > seq:
                break
            owner = name
        return owner

    def goals(self) -> list[str]:
        return sorted({"root", *self.goal, *self.fallback})

    def unfinished(self, coordinator: str, seq: int) -> list[str]:
        """The goals ``coordinator`` owned at ``seq`` that were not completed yet."""
        out = []
        for goal in self.goals():
            done = self.log.goal_done.get(goal)
            if (
                self.opened(goal, seq)
                and self.of_goal(goal, seq) == coordinator
                and (done is None or done.seq > seq)
            ):
                out.append(goal)
        return out


# -- spans -----------------------------------------------------------------------------------


def _merge(spans: Iterable[Span]) -> list[Span]:
    merged: list[Span] = []
    for start, end in sorted(spans):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _length(spans: Iterable[Span]) -> int:
    return sum(end - start for start, end in _merge(spans))


def _overlap(span: Span, within: Iterable[Span]) -> int:
    return sum(max(0, min(span[1], end) - max(span[0], start)) for start, end in within)


def _clip(spans: Iterable[Span], within: Span) -> list[Span]:
    return [
        (max(start, within[0]), min(end, within[1]))
        for start, end in spans
        if min(end, within[1]) > max(start, within[0])
    ]


def _within(spans: Iterable[Span], inside: Iterable[Span]) -> list[Span]:
    """The parts of ``spans`` that lie in any of ``inside``."""
    spans = list(spans)
    return [part for window in inside for part in _clip(spans, window)]


def _minus(spans: Iterable[Span], holes: Iterable[Span]) -> list[Span]:
    out = _merge(spans)
    for hole_start, hole_end in _merge(holes):
        cut: list[Span] = []
        for start, end in out:
            if hole_end <= start or hole_start >= end:
                cut.append((start, end))
                continue
            if start < hole_start:
                cut.append((start, hole_start))
            if hole_end < end:
                cut.append((hole_end, end))
        out = cut
    return out


# -- wait intervals --------------------------------------------------------------------------


@dataclass(frozen=True)
class _Item:
    kind: str  # dispatch | result | judge | book | plan | lost
    goal: str
    start: int
    end: int
    agent: str | None = None


def _items(log: _Log) -> list[_Item]:
    items: list[_Item] = []
    for (goal, cid), sent in sorted(log.dispatches.items()):
        for index, dispatch in enumerate(sent):
            ready = _ready(log, goal, cid, sent, index)
            if ready is not None:
                assignee = dispatch.payload["assignee"]
                items.append(_Item("dispatch", goal, ready, dispatch.ts_virtual, assignee))
    for (goal, cid, attempt), results in sorted(log.results.items()):
        sent = next(
            (d for d in log.dispatches[(goal, cid)] if d.payload["attempt"] == attempt), None
        )
        first = next((r for r in results if sent is None or r.seq > sent.seq), None)
        done = None if first is None else _after(log.completed[(goal, cid, attempt)], first.seq)
        if first is not None and done is not None:
            items.append(_Item("result", goal, first.ts_virtual, done.ts_virtual, first.actor))
    for key, verdicts in sorted(log.judged.items()):
        used = 0
        for verdict in verdicts:
            calls = [c for c in log.judge_done.get(key, []) if used < c.seq < verdict.seq]
            if calls:
                used = calls[-1].seq
                items.append(_Item("judge", key[0], calls[-1].ts_virtual, verdict.ts_virtual))
    for key, books in sorted(log.booked.items()):
        goal, cid, attempt = key
        ended = [*log.verified.get((goal, cid), []), *log.rejected.get(key, [])]
        ended = [e for e in ended if e.payload["attempt"] == attempt]
        done = _after(sorted(ended, key=lambda e: e.seq), books[0].seq)
        if done is not None:
            items.append(_Item("book", goal, books[0].ts_virtual, done.ts_virtual))
    for goal, done_calls in sorted(log.plan_done.items()):
        used = 0
        for call in done_calls:
            plan = _after(log.plans.get(goal, []), max(call.seq, used))
            if plan is not None:
                used = plan.seq
                items.append(_Item("plan", goal, call.ts_virtual, plan.ts_virtual))
    items += _lost_calls(log)
    return items


def _after(events: Sequence[Event], seq: int) -> Event | None:
    return next((event for event in events if event.seq > seq), None)


def _ready(log: _Log, goal: str, cid: str, sent: list[Event], index: int) -> int | None:
    """When the dispatch ``index`` of a contract could first have gone out."""
    dispatch = sent[index]
    if index == 0:
        created = log.created.get((goal, cid))
        if created is None:
            return None
        ready = created.ts_virtual
        for dep in created.payload["contract"].get("depends_on") or []:
            done = next(
                (v for v in log.verified.get((goal, dep), []) if v.seq < dispatch.seq), None
            )
            if done is not None:
                ready = max(ready, done.ts_virtual)
        return min(ready, dispatch.ts_virtual)
    previous = sent[index - 1]
    key = (goal, cid, previous.payload["attempt"])
    rejection = next((r for r in reversed(log.rejected[key]) if r.seq < dispatch.seq), None)
    if rejection is None:
        return None
    ready = rejection.ts_virtual
    stop = log.stop_after(previous.payload["assignee"], previous.seq)
    if rejection.payload["stage"] == "lost" and stop is not None and stop.seq < rejection.seq:
        ready = min(ready, stop.ts_virtual)
    return min(ready, dispatch.ts_virtual)


def _lost_calls(log: _Log) -> list[_Item]:
    """Own calls (any kind: a scan is a firewall effect) cancelled and then asked again."""
    items = []
    started = sorted(log.starts.values(), key=lambda e: e.seq)
    for event in started:
        tag = event.payload.get("tag") or ""
        end = log.ends.get(event.payload["effect_id"])
        if not tag.startswith(OWN_PREFIXES) or end is None or end.type != "effect.cancelled":
            continue
        again = next((s for s in started if s.seq > end.seq and s.payload.get("tag") == tag), None)
        if again is not None:
            items.append(_Item("lost", tag.split("|")[1], end.ts_virtual, again.ts_virtual))
    return items


# -- outages ---------------------------------------------------------------------------------


@dataclass
class _Outage:
    kind: str
    coordinator: str
    onset_seq: int
    onset: int
    spans: dict[str, Span]  # goal -> its down span
    recovered: bool = True

    @property
    def end(self) -> int:
        return max((end for _, end in self.spans.values()), default=self.onset)


def _outages(log: _Log, owners: _Owners) -> list[_Outage]:
    outages: list[_Outage] = []
    supervised = bool(log.of("baseline.crashed"))
    if supervised:
        for crashed in log.of("baseline.crashed"):
            p = crashed.payload
            back = next(
                (
                    r
                    for r in log.of("baseline.restarted")
                    if r.payload["crash"] == p["crash"] and r.seq > crashed.seq
                ),
                None,
            )
            end = log.end if back is None else back.ts_virtual
            goals = owners.unfinished(p["coordinator"], crashed.seq)
            outages.append(
                _Outage(
                    "crash",
                    p["coordinator"],
                    crashed.seq,
                    crashed.ts_virtual,
                    {goal: (crashed.ts_virtual, end) for goal in goals},
                    back is not None,
                )
            )
    else:
        for kill in log.of("chaos.injected"):
            p = kill.payload
            if p["fault"] == "kill_coordinator" and p.get("target"):
                outages.append(_swarm_outage(log, owners, "crash", kill, p["target"], None))
    outages += _partitions(log, owners, supervised)
    return sorted(outages, key=lambda o: (o.onset_seq, o.kind))


def _swarm_outage(
    log: _Log, owners: _Owners, kind: str, kill: Event, victim: str, heal: int | None
) -> _Outage:
    spans: dict[str, Span] = {}
    recovered = True
    for goal in owners.unfinished(victim, kill.seq):
        remap = next(
            (
                r
                for r in log.of("ownership.remapped")
                if r.seq > kill.seq
                and r.payload["key"] == goal
                and r.payload["previous"] == victim
                and r.payload["owner"] != victim
            ),
            None,
        )
        done = log.goal_done.get(goal)
        ends = [remap.ts_virtual] if remap is not None else []
        if heal is not None:
            ends.append(heal)
        elif remap is None and done is not None and done.seq > kill.seq:
            ends.append(done.ts_virtual)
        if not ends:
            ends.append(log.end)
            recovered = False
        spans[goal] = (kill.ts_virtual, max(min(ends), kill.ts_virtual))
    return _Outage(kind, victim, kill.seq, kill.ts_virtual, spans, recovered)


def _partitions(log: _Log, owners: _Owners, supervised: bool) -> list[_Outage]:
    outages = []
    crashes = log.of("baseline.crashed")
    for event in log.of("chaos.injected"):
        p = event.payload
        target = p.get("target")
        if p["fault"] != "partition" or target not in log.coordinators:
            continue
        if not log.alive_at(target, event.seq):
            continue  # already down: its crash covers the goals
        ident = (p.get("detail") or {}).get("partition")
        healed = next(
            (
                h.ts_virtual
                for h in log.of("chaos.injected")
                if h.payload["fault"] == "heal"
                and (h.payload.get("detail") or {}).get("partition") == ident
                and h.seq > event.seq
            ),
            None,
        )
        if healed is None:
            lasts = (p.get("detail") or {}).get("duration_ms")
            healed = log.end if lasts is None else min(log.end, event.ts_virtual + int(lasts))
        if supervised and any(
            c.payload["coordinator"] == target and c.seq < event.seq and _down(log, c, event.seq)
            for c in crashes
        ):
            continue
        if supervised:
            goals = owners.unfinished(target, event.seq)
            outages.append(
                _Outage(
                    "partition",
                    target,
                    event.seq,
                    event.ts_virtual,
                    {goal: (event.ts_virtual, healed) for goal in goals},
                )
            )
        else:
            outages.append(_swarm_outage(log, owners, "partition", event, target, healed))
    return outages


def _down(log: _Log, crashed: Event, seq: int) -> bool:
    back = next(
        (
            r
            for r in log.of("baseline.restarted")
            if r.payload["crash"] == crashed.payload["crash"] and r.seq > crashed.seq
        ),
        None,
    )
    return back is None or back.seq > seq


# -- the per-outage and per-run figures ------------------------------------------------------


def _held(log: _Log) -> dict[str, list[Span]]:
    """The spans in which each agent holds a dispatched attempt: dispatch → its result sent, or
    its stop."""
    held: dict[str, list[Span]] = defaultdict(list)
    for (goal, cid), sent in log.dispatches.items():
        for dispatch in sent:
            agent, attempt = dispatch.payload["assignee"], dispatch.payload["attempt"]
            result = _after(log.results.get((goal, cid, attempt), []), dispatch.seq)
            ends = [log.end]
            if result is not None:
                ends.append(result.ts_virtual)
            stop = log.stop_after(agent, dispatch.seq)
            if stop is not None:
                ends.append(stop.ts_virtual)
            held[agent].append((dispatch.ts_virtual, max(min(ends), dispatch.ts_virtual)))
    return held


def _lifetimes(log: _Log) -> dict[str, list[Span]]:
    return {agent: log.lifetimes(agent) for agent in log.agents}


@dataclass
class _Figures:
    """What one outage cost, from the wait intervals it overlaps."""

    blocked: list[tuple[_Item, int]] = field(default_factory=list)  # (item, overlap ms)
    cdt: int = 0
    drain_end: int = 0


def _figures(outage: _Outage, by_goal: dict[str, list[_Item]]) -> _Figures:
    figures = _Figures(drain_end=outage.end)
    for goal, span in outage.spans.items():
        for item in by_goal.get(goal, ()):
            overlap = _overlap((item.start, item.end), [span])
            if overlap > 0:
                figures.blocked.append((item, overlap))
                figures.cdt += overlap
                figures.drain_end = max(figures.drain_end, item.end)
    return figures


def _free(spans: Iterable[Span], alive: Iterable[Span], busy: Iterable[Span]) -> int:
    """Length of the parts of ``spans`` in which the agent is alive and holds no attempt."""
    return _length(_minus(_within(spans, alive), busy))


def _idle(
    outage: _Outage,
    figures: _Figures,
    owners: _Owners,
    held: dict[str, list[Span]],
    lives: dict[str, list[Span]],
    serves: dict[str, set[str]],
) -> tuple[int, int, int]:
    """(own, session, wide) idle agent-ms of one outage."""
    waits: dict[str, list[Span]] = defaultdict(list)  # session -> its blocked spans
    named: dict[str, list[Span]] = defaultdict(list)  # agent -> the blocked spans that name it
    for item, _ in figures.blocked:
        spans = _clip([(item.start, item.end)], outage.spans[item.goal])
        waits[item.goal] += spans
        if item.kind in ("dispatch", "result") and item.agent is not None:
            named[item.agent] += spans
    blocked = _merge(span for spans in waits.values() for span in spans)
    own = session = wide = 0
    for agent, alive in lives.items():
        busy = held.get(agent, ())
        own += _free(named.get(agent, ()), alive, busy)
        sessions = sorted(serves.get(agent, ()))
        session += _free((span for goal in sessions for span in waits.get(goal, ())), alive, busy)
        if owners.of_agent(agent, outage.onset_seq) == outage.coordinator:
            wide += _free(blocked, alive, busy)
    return own, session, wide


# -- calls -----------------------------------------------------------------------------------


@dataclass
class _Fate:
    kind: str  # consumed | duplicated | unconsumed | failed
    cause: str | None = None


def _fates(log: _Log) -> dict[str, _Fate]:
    fates: dict[str, _Fate] = {}
    attempt_of: dict[str, tuple[str, str, int]] = {}
    for (goal, cid), sent in log.dispatches.items():
        for dispatch in sent:
            attempt_of.setdefault(
                dispatch.payload["idem_key"], (goal, cid, dispatch.payload["attempt"])
            )
    verified = {key: {v.payload["attempt"] for v in events} for key, events in log.verified.items()}
    own: dict[str, list[_Call]] = defaultdict(list)
    for call in sorted(log.calls.values(), key=lambda c: c.start_seq):
        if call.status in ("error", "refused"):
            fates[call.effect_id] = _Fate("failed")
            continue
        tag = call.tag or ""
        if tag.startswith(OWN_PREFIXES):
            own[tag].append(call)
            continue
        work = attempt_of.get(tag.partition(":")[0])
        if work is None:
            fates[call.effect_id] = _Fate("consumed" if call.status in PAID else "unconsumed")
            continue
        goal, cid, attempt = work
        won = verified.get((goal, cid), set())
        if attempt in won:
            fates[call.effect_id] = _Fate("consumed")
        elif won:
            fates[call.effect_id] = _Fate("duplicated", _attempt_cause(log, work, min(won)))
        else:
            fates[call.effect_id] = _Fate("unconsumed")
    for calls in own.values():
        _own_fates(log, calls, fates)
    _paid_twice(log, fates)
    return fates


def _attempt_cause(log: _Log, work: tuple[str, str, int], won: int) -> str:
    """Why an attempt that a later one replaced was done again."""
    goal, cid, attempt = work
    sent = next((d for d in log.dispatches[(goal, cid)] if d.payload["attempt"] == attempt), None)
    if sent is None:
        return "other"
    agent = sent.payload["assignee"]
    rejection = log.rejected.get(work, [])
    if rejection:
        last = rejection[-1]
        if last.payload["stage"] != "lost":
            return "other"
        return _stop_cause(log, agent, sent.seq, last.seq)
    if attempt > won:
        return "false_death"  # a newer attempt went out while the old one was still good
    return _stop_cause(log, agent, sent.seq, LAST)


def _stop_cause(log: _Log, actor: str, since: int, until: int) -> str:
    """Why ``actor`` was no longer working at ``until``: a false death if it had not stopped
    between ``since`` and ``until`` (sequence numbers)."""
    stop = log.stop_after(actor, since)
    if stop is None or stop.seq > until:
        return "false_death"
    reason = stop.payload["reason"]
    if reason == "crash":
        return "coordinator_crash"
    if reason == "chaos":
        return "agent_kill" if log.kind.get(actor) == "agent" else "coordinator_crash"
    return "other"


def _own_fates(log: _Log, calls: list[_Call], fates: dict[str, _Fate]) -> None:
    """Own calls (plan, judge, scan) asked more than once under one tag: the last one that
    completed is the one used."""
    used = next((c for c in reversed(calls) if c.status in PAID), None)
    for call in calls:
        if call is used:
            fates[call.effect_id] = _Fate("consumed")
        elif used is None:
            fates[call.effect_id] = _Fate("unconsumed")
        elif call.start_seq < used.start_seq:
            fates[call.effect_id] = _Fate("duplicated", _own_cause(log, call, used))
        else:
            fates[call.effect_id] = _Fate("unconsumed")


def _own_cause(log: _Log, call: _Call, again: _Call) -> str:
    if call.status == "cancelled":
        crashed = any(
            c.payload["coordinator"] == call.actor
            and c.ts_virtual == call.close
            and c.seq < (call.close_seq or 0)
            for c in log.of("baseline.crashed")
        )
        if crashed:
            return "coordinator_crash"
        return _stop_cause(log, call.actor, call.start_seq, call.close_seq or LAST)
    if again.actor == call.actor:
        return "other"
    return _stop_cause(log, call.actor, call.start_seq, again.start_seq)


def _paid_twice(log: _Log, fates: dict[str, _Fate]) -> None:
    """Completed calls with an identical request beyond the first (``verify/takeover.py``)."""
    groups: dict[str, list[_Call]] = defaultdict(list)
    for call in sorted(log.calls.values(), key=lambda c: c.start_seq):
        if call.status in PAID:
            groups[call.request].append(call)
    for group in groups.values():
        first = group[0]
        for call in group[1:]:
            fate = fates.get(call.effect_id)
            if fate is not None and fate.kind != "consumed":
                continue
            if call.actor == first.actor:
                cause = "other"
            else:
                cause = _stop_cause(log, first.actor, first.start_seq, call.start_seq)
            fates[call.effect_id] = _Fate("duplicated", cause)


def _at_risk(
    log: _Log, owners: _Owners, outage: _Outage, fates: dict[str, _Fate]
) -> tuple[int, int]:
    """(calls in flight at the onset that were the crashed coordinator's, how many were kept)."""
    mine = 0
    kept = 0
    for call in log.calls.values():
        if call.start_seq > outage.onset_seq:
            continue
        if call.close_seq is not None and call.close_seq < outage.onset_seq:
            continue
        belongs = call.actor == outage.coordinator or (
            log.kind.get(call.actor) == "agent"
            and owners.of_agent(call.actor, outage.onset_seq) == outage.coordinator
        )
        if not belongs:
            continue
        mine += 1
        fate = fates.get(call.effect_id)
        if call.status in PAID and fate is not None and fate.kind == "consumed":
            kept += 1
    return mine, kept


# -- reassignments and exposure --------------------------------------------------------------


def _reassignments(log: _Log) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for key, rejections in sorted(log.rejected.items()):
        goal, cid, attempt = key
        sent = next(
            (d for d in log.dispatches[(goal, cid)] if d.payload["attempt"] == attempt), None
        )
        for rejection in rejections:
            if rejection.payload["stage"] != "lost" or sent is None:
                continue
            counts["lost"] += 1
            consumed = any(c.seq < rejection.seq for c in log.completed.get(key, []))
            pending = not consumed and any(r.seq < rejection.seq for r in log.results.get(key, []))
            stop = log.stop_after(sent.payload["assignee"], sent.seq)
            if stop is not None and stop.seq > rejection.seq:
                stop = None  # it was still working when the contract was given up
            if pending or stop is None:
                counts["unnecessary"] += 1
            elif stop.payload["reason"] == "chaos":
                counts["agent_kill"] += 1
            elif stop.payload["reason"] == "crash":
                counts["crash_stop"] += 1
    for sent_events in log.dispatches.values():
        seen: set[int] = set()
        for dispatch in sent_events:
            attempt = dispatch.payload["attempt"]
            if attempt in seen:
                counts["unnecessary"] += 1
            seen.add(attempt)
    for remap in log.of("ownership.remapped"):
        p = remap.payload
        if p["owner"] != p["previous"] and log.alive_at(p["previous"], remap.seq):
            counts["false_death"] += 1
    return dict(counts)


def _exposure(log: _Log, owners: _Owners) -> tuple[int, int]:
    """(peak share in percent, peak count) of unfinished sessions owned by one coordinator."""
    sessions = set(log.sessions)
    if not sessions:
        return 0, 0
    owner: dict[str, str] = {}
    done: set[str] = set()
    peak = 0
    for event in log.events:
        p = event.payload
        if event.type in ("ownership.assigned", "ownership.remapped"):
            owner[p["key"]] = p["owner"]
        elif event.type == "goal.opened":
            owner[p["goal_id"]] = p["owner"]
        elif event.type == "contract.created":
            # A log with no ownership events (the process-tree supervisor's) says who owns a
            # session only by who created its contracts.
            owner.setdefault(p["contract"]["goal_id"], p.get("owner") or log.root)
        elif event.type == "goal.completed":
            done.add(p["goal_id"])
        else:
            continue
        counts = Counter(o for g, o in owner.items() if g in sessions and g not in done)
        peak = max(peak, max(counts.values(), default=0))
    return round(100 * peak / len(sessions), 6), peak


# -- entry point -----------------------------------------------------------------------------


def analyze(events: Iterable[Event], calls: "Sequence[LLMCall] | None" = None) -> RecoveryMetrics:
    """Every recovery metric of one run. ``calls`` are ``bench.scoring.llm_calls(events)``,
    which the caller may already have (cancelled calls cost their estimate)."""
    log = _Log.build(events)
    if not log.events:
        return RecoveryMetrics()
    if calls is None:
        from fractalswarm.bench.scoring import llm_calls

        calls = llm_calls(log.events)
    costs = {call.effect_id: call.cost_usd for call in calls}
    owners = _Owners(log)
    outages = _outages(log, owners)
    items = _items(log)
    by_goal: dict[str, list[_Item]] = defaultdict(list)
    for item in items:
        by_goal[item.goal].append(item)
    held, lives = _held(log), _lifetimes(log)
    fates = _fates(log)
    serves: dict[str, set[str]] = defaultdict(set)  # agent -> the sessions it was given
    crew: dict[str, set[str]] = defaultdict(set)  # session -> the agents it was given to
    assigned = [
        (goal, created.payload["contract"].get("assignee"))
        for (goal, _), created in log.created.items()
    ] + [
        (goal, dispatch.payload["assignee"])
        for (goal, _), sent in log.dispatches.items()
        for dispatch in sent
    ]
    for goal, agent in assigned:
        if agent:
            serves[agent].add(goal)
            crew[goal].add(agent)
    sessions = set(log.sessions)

    rows: list[OutageRow] = []
    numbers: Counter[str] = Counter()
    down: dict[str, list[Span]] = defaultdict(list)
    for outage in outages:
        numbers[outage.kind] += 1
        figures = _figures(outage, by_goal)
        own, session, wide = _idle(outage, figures, owners, held, lives, serves)
        blocked_sessions = {item.goal for item, _ in figures.blocked} & sessions
        alive = {agent for agent in lives if log.alive_at(agent, outage.onset_seq)}
        blocked_agents = set().union(*(crew.get(goal, set()) for goal in blocked_sessions)) & alive
        at_risk, kept = _at_risk(log, owners, outage, fates) if outage.kind == "crash" else (0, 0)
        for goal, span in outage.spans.items():
            down[goal].append(span)
        rows.append(
            OutageRow(
                number=numbers[outage.kind],
                kind=outage.kind,  # type: ignore[arg-type]
                coordinator=outage.coordinator,
                level=log.level(outage.coordinator),
                onset_s=outage.onset / SECOND,
                end_s=outage.end / SECOND,
                recovered=outage.recovered,
                goals=len(outage.spans),
                ttr_own_s=(outage.end - outage.onset) / SECOND,
                ttr_drain_s=(max(figures.drain_end, outage.end) - outage.onset) / SECOND,
                blocked_items=len(figures.blocked),
                cdt_s=figures.cdt / SECOND,
                blast_sessions=len(blocked_sessions),
                blast_sessions_pct=100 * len(blocked_sessions) / len(sessions) if sessions else 0.0,
                blast_agents=len(blocked_agents),
                blast_agents_pct=100 * len(blocked_agents) / len(alive) if alive else 0.0,
                idle_agent_own_s=own / SECOND,
                idle_agent_s=session / SECOND,
                idle_agent_wide_s=wide / SECOND,
                at_risk_calls=at_risk,
                preserved_calls=kept,
            )
        )

    merged = {goal: _merge(spans) for goal, spans in down.items()}
    cdt = sum(_overlap((i.start, i.end), merged.get(i.goal, ())) for i in items)
    blocked_total = sum(i.end - i.start for i in items)
    crashes = [row for row in rows if row.kind == "crash"]
    reassigned = _reassignments(log)
    exposure_pct, exposure_n = _exposure(log, owners)
    metrics = RecoveryMetrics(
        crashes=len(crashes),
        partitions=len(rows) - len(crashes),
        unrecovered=sum(not row.recovered for row in rows),
        cdt_s=cdt / SECOND,
        blocked_total_s=blocked_total / SECOND,
        exposure_peak_pct=exposure_pct,
        exposure_peak_sessions=exposure_n,
        idle_agent_own_s=sum(row.idle_agent_own_s for row in rows),
        idle_agent_s=sum(row.idle_agent_s for row in rows),
        idle_agent_wide_s=sum(row.idle_agent_wide_s for row in rows),
        lost_redispatches=reassigned.get("lost", 0),
        redispatch_agent_kill=reassigned.get("agent_kill", 0),
        redispatch_crash_stop=reassigned.get("crash_stop", 0),
        unnecessary_redispatches=reassigned.get("unnecessary", 0),
        false_death_remaps=reassigned.get("false_death", 0),
        unnecessary_reassignments=reassigned.get("unnecessary", 0)
        + reassigned.get("false_death", 0),
        at_risk_calls=sum(row.at_risk_calls for row in crashes),
        preserved_calls=sum(row.preserved_calls for row in crashes),
        outages=rows,
    )
    if crashes:
        for name, key in (("ttr_own", "ttr_own_s"), ("ttr_drain", "ttr_drain_s")):
            values = [getattr(row, key) for row in crashes]
            setattr(metrics, f"{name}_mean_s", sum(values) / len(values))
            setattr(metrics, f"{name}_max_s", max(values))
        for name in ("blast_sessions", "blast_agents"):
            values = [getattr(row, f"{name}_pct") for row in crashes]
            setattr(metrics, f"{name}_mean_pct", sum(values) / len(values))
            setattr(metrics, f"{name}_max_pct", max(values))
    if metrics.at_risk_calls:
        metrics.preserved_pct = 100 * metrics.preserved_calls / metrics.at_risk_calls
    _tally(log, fates, costs, metrics)
    return metrics


def _tally(
    log: _Log, fates: dict[str, _Fate], costs: dict[str, float], metrics: RecoveryMetrics
) -> None:
    for effect_id, fate in sorted(fates.items()):
        usd = costs.get(effect_id, 0.0)
        if fate.kind == "unconsumed":
            metrics.unconsumed_calls += 1
            metrics.unconsumed_usd += usd
        elif fate.kind == "duplicated":
            metrics.dup_calls += 1
            metrics.dup_usd += usd
            name = {
                "coordinator_crash": "crash",
                "agent_kill": "agent_kill",
                "false_death": "false_death",
            }.get(fate.cause or "", "other")
            setattr(metrics, f"dup_{name}_calls", getattr(metrics, f"dup_{name}_calls") + 1)
            setattr(metrics, f"dup_{name}_usd", getattr(metrics, f"dup_{name}_usd") + usd)


def table(metrics: RecoveryMetrics) -> list[dict[str, Any]]:
    """The per-outage rows as plain dicts (``fractalswarm recovery``)."""
    return [row.model_dump() for row in metrics.outages]
