"""The feasibility report at plan approval (spec §12): what the approved plan is expected to
cost and take, where it will be slow, what it may not do, and what the estimate leaves out.

The report is a pure function of the plan, the task's structure and the run's own tables
(``RunConfigView`` reads the role and price tables and the budget from ``run.started``), so it
is the same on replay. It is an event, ``plan.feasibility``, written between ``plan.proposed``
and ``plan.approved`` when the TaskSpec asks for it (``feasibility_report: true``).

The cost model is deliberately plain. Every LLM call the run is expected to make is priced
from its prompt (4 characters a token), the role's model and effort, and a P50 and a P90 for
the answer: the reasoning tokens by effort (``REASONING_TOKENS``) plus a visible answer. An
agent loop is one call per tool turn plus the answer, each resending the conversation, and a
contract is expected to take more than one attempt. Below the root plan the calls come from the
task's deterministic fallback decomposition, since the real planners' output exists only after
approval. The total P90 adds the items' upsides as independent (root-sum-square), not as a
sum of P90s. Every constant below is a first guess, fitted to one real run (the swarm at C0:
80 calls, $0.45, 117 s) and to ``config/fake_calibration.json``; the report says so.
"""

import math
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict

from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.ids import canonical_json
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.prices import PriceTable, Usage
from fractalswarm.planning.contracts import Contract
from fractalswarm.planning.dag import Dag
from fractalswarm.planning.risk import contract_risk
from fractalswarm.safety.capabilities import KNOWN_TOOLS
from fractalswarm.safety.scope_check import ApprovedPlan, is_sensitive
from fractalswarm.verify.cross_audit import audit_rate, audit_request
from fractalswarm.verify.judge import judge_request

CHARS_PER_TOKEN = 4  # real text; market/prices.py bounds a reservation with 2

# (P50, P90) reasoning tokens by effort: exp(mu) and exp(mu + 1.28 sigma) of the log-normal
# fits in config/fake_calibration.json, ordered by effort where the few samples were not.
REASONING_TOKENS: dict[str, tuple[int, int]] = {
    "minimal": (40, 120),
    "low": (200, 500),
    "medium": (250, 1200),
    "high": (320, 1600),
    "xhigh": (500, 2000),
    "max": (700, 2500),
}
PLAN_TOKENS = (900, 2200)  # the visible answer of a planner
ANSWER_TOKENS = (450, 1100)  # the visible answer of an agent, judge or auditor
TOOL_TURN_TOKENS = (320, 640)  # a tool turn: extract publishes a fact per speaker and talk
STEP_GROWTH_TOKENS = 600  # what one tool turn adds to the next call's input
OUTPUT_UNDER_REVIEW_TOKENS = 300  # the agent output a judge or an auditor reads

# Latency of a call: a fixed part plus the output rate. The spike's short calls gave 0.7 s and
# 5.4 ms a token (config/fake_calibration.json); the plan's calls are longer, and these two
# reproduce the real C0 run's 117 s makespan.
LATENCY_BASE_S = 1.8
LATENCY_PER_TOKEN_S = 0.0075

# Attempts per contract (P50, P90): a failed check, a judge or a booking conflict repeats the
# loop. The real C0 run made 1.46 times the calls of a first-attempt-only run.
ATTEMPTS = (1.45, 2.0)

MAX_NOTES = 8
MAX_NOTE_CHARS = 300


@dataclass(frozen=True)
class Band:
    p50: float
    p90: float

    def __add__(self, other: "Band") -> "Band":
        return Band(self.p50 + other.p50, self.p90 + other.p90)

    def times(self, p50: float, p90: float) -> "Band":
        return Band(self.p50 * p50, self.p90 * p90)


@dataclass(frozen=True)
class Costs:
    usd: Band
    seconds: Band
    calls: Band

    def __add__(self, other: "Costs") -> "Costs":
        return Costs(self.usd + other.usd, self.seconds + other.seconds, self.calls + other.calls)

    def times(self, p50: float, p90: float) -> "Costs":
        return Costs(
            self.usd.times(p50, p90), self.seconds.times(p50, p90), self.calls.times(p50, p90)
        )


NOTHING = Costs(Band(0.0, 0.0), Band(0.0, 0.0), Band(0.0, 0.0))


# -- the event ----------------------------------------------------------------------------


class Line(BaseModel):
    """One stage of the expected cost."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: str
    calls: float
    p50_usd: float
    p90_usd: float
    share: float  # of the P50 total


@register("plan.feasibility")
class FeasibilityReport(Payload):
    goal_id: str
    budget_usd: float | None
    cost_p50_usd: float
    cost_p90_usd: float
    p50_share: float | None  # of the budget
    p90_share: float | None
    verdict: str  # fits (P90 within the budget) | tight (only the P50) | over | unbudgeted
    breakdown: list[Line]
    calls_p50: float
    duration_p50_s: float
    duration_p90_s: float
    critical_path: list[str]
    bottlenecks: list[str]
    tools_requested: dict[str, list[str]]
    tools_denied: list[str]
    policy_flags: list[str]
    planner_notes: list[str]
    limitations: list[str]
    fence: dict[str, Any] | None = None  # the owner's fencing token (spec §5.2)


# -- the run's tables, from the log -------------------------------------------------------


class RunConfigView:
    """The run's role table, price table and budget, from ``run.started``: a pure handler
    cannot read ``config/``, and replay rebuilds the same view from the same event."""

    name = "run_config"

    def __init__(self) -> None:
        self.roles: RoleTable | None = None
        self.prices: PriceTable | None = None
        self.budget_usd: float | None = None

    def admit(self, actor: str, event_type: str, payload: dict[str, Any]) -> None:
        return None

    def apply(self, event: Event) -> None:
        if event.type != "run.started":
            return
        llm = (event.payload.get("config") or {}).get("llm")
        if llm:
            self.roles = RoleTable.model_validate(llm["roles"])
            self.prices = PriceTable.model_validate(llm["prices"])
        self.budget_usd = event.payload.get("run_cap_usd")


# -- pricing one call, one loop -----------------------------------------------------------


def prompt_tokens(request: dict[str, Any]) -> int:
    body = [request.get(k) for k in ("instructions", "input", "tools", "text_format")]
    return len(canonical_json(body)) // CHARS_PER_TOKEN + 1


def _call(
    roles: RoleTable,
    prices: PriceTable,
    request: dict[str, Any],
    visible: tuple[int, int] = ANSWER_TOKENS,
    extra_input: int = 0,
) -> Costs:
    """One LLM call at L0 (``ValueError`` if the tables lack its role or model)."""
    spec = roles.resolve(request["role"])
    reasoning = REASONING_TOKENS.get(spec.effort, REASONING_TOKENS["medium"])
    tokens = prompt_tokens(request) + extra_input
    out = [min(spec.max_output_tokens, reasoning[i] + visible[i]) for i in (0, 1)]
    usd = [prices.cost(spec.model, Usage(input_tokens=tokens, output_tokens=n)) for n in out]
    seconds = [LATENCY_BASE_S + LATENCY_PER_TOKEN_S * n for n in out]
    return Costs(Band(*usd), Band(*seconds), Band(1.0, 1.0))


def _loop(
    roles: RoleTable, prices: PriceTable, request: dict[str, Any], tools: int, max_steps: int
) -> Costs:
    """An agent loop: a call per tool turn and the answer, each with a longer input. The P90
    loop has one turn more and the P90 tokens per call."""
    cap = max(max_steps, 1)
    p50_steps = min(tools + 1, cap)
    p90_steps = min(p50_steps + 1, cap)

    def side(steps: int, index: int) -> tuple[float, float]:
        usd = seconds = 0.0
        for step in range(steps):
            visible = ANSWER_TOKENS if step == steps - 1 else TOOL_TURN_TOKENS
            one = _call(roles, prices, request, visible, step * STEP_GROWTH_TOKENS)
            usd += (one.usd.p50, one.usd.p90)[index]
            seconds += (one.seconds.p50, one.seconds.p90)[index]
        return usd, seconds

    (usd50, sec50), (usd90, sec90) = side(p50_steps, 0), side(p90_steps, 1)
    return Costs(Band(usd50, usd90), Band(sec50, sec90), Band(float(p50_steps), float(p90_steps)))


def _agent_request(contract: Contract) -> dict[str, Any]:
    from fractalswarm.actors.agent import contract_prompt, llm_request

    return llm_request(contract, [{"role": "user", "content": contract_prompt(contract)}])


# -- the expected shape of the run, from the plan -----------------------------------------


@dataclass
class Session:
    leaf: dict[str, Any]
    contracts: list[Contract]


@dataclass
class Track:
    goal: dict[str, Any]
    split: bool  # a track plan call splits it into sessions (depth 2)
    sessions: list[Session]


def _tracks(
    task: Any, goal: dict[str, Any], plan: dict[str, Any], fanout: list[int], max_steps: int
) -> list[Track]:
    tracks = []
    for child in task.root_children(goal, plan):
        if len(fanout) == 1:
            leaves, split = [child], False
        else:
            leaves, split = task.split_children(child, task.split_fallback(child)), True
        sessions = []
        for leaf in leaves:
            made = task.contracts(leaf, task.contracts_fallback(leaf), "o", "scope")
            contracts = []
            for contract in made:
                inputs = task.contract_inputs(leaf, contract, {})
                budget = contract.budget.model_copy(update={"max_steps": max_steps})
                contracts.append(contract.model_copy(update={"inputs": inputs, "budget": budget}))
            sessions.append(Session(leaf, contracts))
        tracks.append(Track(child, split, sessions))
    return tracks


@dataclass
class Priced:
    """The expected cost by stage, and the critical path with each step's seconds."""

    stages: dict[str, Costs] = field(default_factory=dict)
    path: list[tuple[str, Band]] = field(default_factory=list)


def _session(
    task: Any,
    roles: RoleTable,
    prices: PriceTable,
    session: Session,
    max_steps: int,
    audit: bool,
) -> tuple[Costs, dict[str, Costs], dict[str, Band]]:
    """(the session's planning call, the cost by stage of its contracts, each contract's
    seconds including its judge and audit)."""
    plan_call = _call(roles, prices, task.contracts_request(session.leaf, []), PLAN_TOKENS)
    stages: dict[str, Costs] = {}
    seconds: dict[str, Band] = {}

    def add(stage: str, costs: Costs) -> None:
        stages[stage] = stages.get(stage, NOTHING) + costs

    for contract in session.contracts:
        data = contract.inputs.get("data", {})
        loop = _loop(roles, prices, _agent_request(contract), len(contract.tools), max_steps)
        loop = loop.times(*ATTEMPTS)
        add(f"agents: {contract.kind}", loop)
        took = loop.seconds
        if task.needs_judge(contract):
            request = judge_request(contract, {}, data)
            review = _call(roles, prices, request, ANSWER_TOKENS, OUTPUT_UNDER_REVIEW_TOKENS)
            review = review.times(*ATTEMPTS)
            add("judge", review)
            took = took + review.seconds
        if audit:
            rate, _ = audit_rate(contract_risk(contract).r, contract.critical_path)
            request = audit_request(contract, {}, data)
            once = _call(roles, prices, request, ANSWER_TOKENS, OUTPUT_UNDER_REVIEW_TOKENS)
            expected = once.times(rate, rate)
            add("cross-squad audit", expected)
            took = took + expected.seconds
        seconds[contract.id] = took
    return plan_call, stages, seconds


def _price(
    task: Any,
    goal: dict[str, Any],
    tracks: list[Track],
    roles: RoleTable,
    prices: PriceTable,
    fanout: list[int],
    audit: bool,
    max_steps: int,
) -> Priced:
    root = _call(roles, prices, task.root_request(goal, []), PLAN_TOKENS)
    stages: dict[str, Costs] = {"root plan": root}
    track_plans = session_plans = NOTHING
    longest = -1.0
    path: list[tuple[str, Band]] = []
    members = max(fanout[-1], 1)
    for track in tracks:
        split = NOTHING
        if track.split:
            split = _call(roles, prices, task.split_request(track.goal, []), PLAN_TOKENS)
            track_plans = track_plans + split
        waves = math.ceil(len(track.sessions) / members) if track.split else 1
        for session in track.sessions:
            plan_call, by_stage, seconds = _session(task, roles, prices, session, max_steps, audit)
            session_plans = session_plans + plan_call
            for stage, costs in by_stage.items():
                stages[stage] = stages.get(stage, NOTHING) + costs
            dag = Dag(
                {c.id: c.depends_on for c in session.contracts},
                {cid: band.p50 for cid, band in seconds.items()},
            )
            steps = [(f"session plan {session.leaf['id']}", plan_call.seconds)]
            steps += [
                (f"{cid} of {session.leaf['id']}", seconds[cid]) for cid in dag.critical_path()
            ]
            total = sum(band.p50 for _, band in steps) * waves
            if total > longest:  # the first of equals, in plan order
                longest = total
                head = [("root plan", root.seconds)]
                if track.split:
                    head.append((f"track plan {track.goal['id']}", split.seconds))
                again = f" (x{waves}, one wave after another)" if waves > 1 else ""
                path = head + [(name + again, band) for name, band in steps]
    if track_plans.calls.p50:
        stages["track plans"] = track_plans
    stages["session plans"] = session_plans
    order = ["root plan", "track plans", "session plans"]
    names = [name for name in order if name in stages]
    names += sorted(name for name in stages if name not in order)
    return Priced({name: stages[name] for name in names}, path)


def build(
    task: Any,
    goal: dict[str, Any],
    plan: dict[str, Any],
    envelope: ApprovedPlan,
    *,
    fanout: list[int],
    max_steps: int,
    max_attempts: int,
    contributor: bool,
    audit: bool,
    config: RunConfigView | None,
    scans: dict[str, dict[str, Any]],
) -> FeasibilityReport | None:
    """The report, or ``None`` when the run has no role and price tables to price with."""
    if config is None or config.roles is None or config.prices is None:
        return None
    tracks = _tracks(task, goal, plan, fanout, max_steps)
    try:
        priced = _price(task, goal, tracks, config.roles, config.prices, fanout, audit, max_steps)
    except ValueError:  # a role or a model the tables do not have
        return None

    costs = list(priced.stages.values())
    p50 = sum(c.usd.p50 for c in costs)
    p90 = p50 + math.sqrt(sum((c.usd.p90 - c.usd.p50) ** 2 for c in costs))
    budget = config.budget_usd
    if budget is None:
        verdict = "unbudgeted"
    else:
        verdict = "over" if p50 > budget else "fits" if p90 <= budget else "tight"
    breakdown = [
        Line(
            stage=stage,
            calls=round(c.calls.p50, 1),
            p50_usd=round(c.usd.p50, 6),
            p90_usd=round(c.usd.p90, 6),
            share=round(c.usd.p50 / p50, 4) if p50 else 0.0,
        )
        for stage, c in priced.stages.items()
    ]
    duration50 = sum(band.p50 for _, band in priced.path)
    duration90 = duration50 + math.sqrt(sum((b.p90 - b.p50) ** 2 for _, b in priced.path))
    requested, denied = _tools(tracks, envelope)
    return FeasibilityReport(
        goal_id=goal["id"],
        budget_usd=budget,
        cost_p50_usd=round(p50, 6),
        cost_p90_usd=round(p90, 6),
        p50_share=round(p50 / budget, 4) if budget else None,
        p90_share=round(p90 / budget, 4) if budget else None,
        verdict=verdict,
        breakdown=breakdown,
        calls_p50=round(sum(c.calls.p50 for c in costs), 1),
        duration_p50_s=round(duration50, 1),
        duration_p90_s=round(duration90, 1),
        critical_path=[f"{name}: {band.p50:.1f} s" for name, band in priced.path],
        bottlenecks=_bottlenecks(tracks, breakdown, priced.path, members=max(fanout[-1], 1)),
        tools_requested=requested,
        tools_denied=denied,
        policy_flags=_flags(envelope, scans, budget, verdict, contributor, audit, p50, p90),
        planner_notes=_notes(plan),
        limitations=_limitations(max_attempts),
    )


def _tools(tracks: list[Track], envelope: ApprovedPlan) -> tuple[dict[str, list[str]], list[str]]:
    """The tools each kind of contract asks for, and those the approved plan does not allow
    (deny by default: a tool must be a known one and be listed on the kind's approved node)."""
    requested: dict[str, set[str]] = {}
    for track in tracks:
        for session in track.sessions:
            for contract in session.contracts:
                requested.setdefault(contract.kind, set()).update(contract.tools)
    denied = []
    for kind in sorted(requested):
        node = envelope.node(f"contract:{kind}")
        granted = set(node.tools) & KNOWN_TOOLS if node is not None else set()
        denied += [f"{kind}: {tool}" for tool in sorted(requested[kind] - granted)]
    return {kind: sorted(tools) for kind, tools in sorted(requested.items())}, denied


def _bottlenecks(
    tracks: list[Track], breakdown: list[Line], path: list[tuple[str, Band]], members: int
) -> list[str]:
    found = []
    if path:
        total = sum(band.p50 for _, band in path)
        name, band = path[0]
        found.append(
            f"The {name} is one call that every other step waits for: {band.p50:.1f} s of "
            f"the {total:.1f} s critical path."
        )
    if breakdown:
        top = max(breakdown, key=lambda line: (line.p50_usd, line.stage))
        found.append(f"{top.stage} is {top.share:.0%} of the expected cost.")
    talks = {track.goal["id"]: len(track.goal.get("talk_ids", [])) for track in tracks}
    if len(talks) > 1 and max(talks.values()) > min(talks.values()):
        big = max(sorted(talks), key=lambda track: talks[track])
        small = min(sorted(talks), key=lambda track: talks[track])
        found.append(
            f"Track {big} has {talks[big]} talks against {talks[small]} in track {small}: it "
            "finishes last."
        )
    queued = sorted(
        track.goal["id"] for track in tracks if track.split and len(track.sessions) > members
    )
    if queued:
        found.append(
            f"Tracks {', '.join(queued)} have more sessions than session owners: some sessions "
            "run one after another."
        )
    return found


def _flags(
    envelope: ApprovedPlan,
    scans: dict[str, dict[str, Any]],
    budget: float | None,
    verdict: str,
    contributor: bool,
    audit: bool,
    p50: float,
    p90: float,
) -> list[str]:
    flags = []
    if verdict == "over":
        flags.append(f"The expected cost (${p50:.2f}) is over the budget (${budget:.2f}).")
    elif verdict == "tight":
        flags.append(
            f"The budget (${budget:.2f}) covers the expected cost (${p50:.2f}) but not the P90 "
            f"(${p90:.2f}): the model ladder may degrade the run."
        )
    elif verdict == "unbudgeted":
        flags.append("No run budget is set: only the project cap limits the spend.")
    if contributor:
        flags.append(
            "Contributor routing is on: prompts the scanners find clean may be used to train "
            "Meta models (spec §7.5)."
        )
    if audit:
        flags.append("The cross-squad audit is on: sampled contracts cost one more call.")
    held = sorted(source for source, scan in scans.items() if scan["decision"] != "allow")
    if held:
        flags.append(
            f"{len(held)} attachment(s) were quarantined by the firewall before planning: "
            f"{', '.join(held[:MAX_NOTES])}."
        )
    for node in sorted(envelope.nodes, key=lambda n: n.node_id):
        for category in sorted(node.data_categories):
            if is_sensitive(category):
                flags.append(f"{node.node_id} touches {category}: it needs a human approval.")
    return flags


def _notes(plan: dict[str, Any]) -> list[str]:
    """What the root planner wrote about feasibility and limitations: model text, clipped."""
    notes = []
    if isinstance(plan.get("feasibility"), str) and plan["feasibility"]:
        notes.append(plan["feasibility"])
    limits = plan.get("limitations")
    notes += [text for text in limits if isinstance(text, str)] if isinstance(limits, list) else []
    return [note[:MAX_NOTE_CHARS] for note in notes[:MAX_NOTES]]


def _limitations(max_attempts: int) -> list[str]:
    return [
        "Costs and durations are estimates from the price table, the planned prompts and a "
        "latency model fitted to few real calls; P50 and P90 are first guesses.",
        "Everything below the root plan is estimated from the task's fallback decomposition: "
        "the real planners may split the work differently.",
        f"Each contract is expected to take {ATTEMPTS[0]} attempts (P50) to {ATTEMPTS[1]} (P90) "
        f"of at most {max_attempts}; booking collisions and rate limits add time that the "
        "model does not see.",
        "Durations assume no rate-limit queueing and no failure of an orchestrator.",
        "Prices are Standard; the Contributor routing gate is decided per call.",
    ]
