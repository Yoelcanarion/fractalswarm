"""The ``langgraph`` baseline (spec §15.1-§15.2): hierarchical teams on LangGraph, pointed at Muse.

The graph is the one LangGraph's hierarchical-teams pattern gives:

- the **top supervisor** plans the conference (the root planner, Wonder) and hands each track
  to a team;
- a **team supervisor** per track splits it into one session per day and hands each session to
  a session team;
- a **session team** is a supervisor and its workers: the supervisor writes the contracts,
  then routes the next contract to a worker through the LLM (the pattern's routing call, tagged
  ``coord:route``, so its tokens count as coordination tokens); a worker is a ReAct loop (an
  agent node and a tools node) on the same blackboard tools as the other workflows; the
  supervisor verifies each answer (checks, the judge, the CAS booking) and retries or reassigns.

It does the same work as ``central`` on the same task instance: the same planning, contract,
judge and tool calls (``bench/tasks/t2_conference/task.py``), the same role ladder. Every model
call is ``ChatOpenAI`` over a transport that hands the request to the LLM layer
(``langgraph_bridge.py``), so budgets, the shared fault backend (same seeds) and the cassette
apply. State is a LangGraph checkpoint (``InMemorySaver``, saved after every superstep).

**Failure semantics** (§15.2). The chaos plan is the swarm's: the same crash points, the same
share of agents killed, taken as the same progress of contracts dispatched, polled every 250 ms
of virtual time like the monkey. A coordinator crash is a process-tree crash: every in-flight
call of the run, the workers' included, is cancelled (``effect.cancelled``; the bench bills
what the provider has billed), the graph run dies, and 5 s later the best-case supervisor
restarts it with ``ainvoke(None)``: LangGraph resumes from its checkpoints, so only the
supersteps that were in flight run again (a worker loses at most its current model call). An
agent kill cancels that worker's call, and the supervisor reassigns the contract. Network
faults and partitions need a bus, which this workflow does not have, so they do not apply.

Not in this baseline: the firewall scan of the attachments and the scope check, which cost
no tokens and matter only for the poisoned input, which benchmark runs do not use.
"""

import asyncio
import math
import operator
import random
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Annotated, Any, TypedDict

from pydantic import BaseModel, ConfigDict, ValidationError

from fractalswarm.actors.agent import contract_prompt, llm_request
from fractalswarm.actors.board import TOOL_ARGS, _book, _tool
from fractalswarm.actors.integrator import finish_goal, leaf_outcome, merge_children
from fractalswarm.actors.swarm import T2_PROGRESS, expected_contracts
from fractalswarm.baselines.framework_runtime import (
    EffectKilled,
    FrameworkRuntime,
    replay_framework,
)
from fractalswarm.baselines.langgraph_bridge import call_options, chat_model
from fractalswarm.baselines.supervisor import RESTART_TAG
from fractalswarm.bench.profiles import RESTART_DELAY_MS
from fractalswarm.bench.tasks.t2_conference.task import T2
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan, ProgressView, plan_from
from fractalswarm.coord.hrw import rank
from fractalswarm.kernel.clock import LiveClock, ManualClock
from fractalswarm.kernel.effects import EffectContext, EffectOutcome, EffectRunner
from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.replay import ReplayReport
from fractalswarm.kernel.scheduler import Emit
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.cassette import Cassette, CassetteBackend
from fractalswarm.llm.client import Backend, LLMClient
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.ledger import ProjectLedger
from fractalswarm.market.prices import PriceTable
from fractalswarm.planning import scope as scoping
from fractalswarm.planning.contracts import Contract
from fractalswarm.planning.dag import Dag
from fractalswarm.planning.planner import plan_request
from fractalswarm.runs import LiveMarker, RunPaths, RunResult, default_run_cap_usd
from fractalswarm.verify.checks import run_checks
from fractalswarm.verify.judge import judge_request, read_verdict

SCENARIO = "langgraph"
COORD = "o0"  # the one coordinator process: the top of the graph and everything under it
POLL_MS = 250  # the monkey's poll period
MAX_PLAN_ATTEMPTS = 3
MAX_FEEDBACK_LINES = 20
RECURSION_LIMIT = 100_000  # a session team loops many times; LangGraph's default is 25

ROUTE_INSTRUCTIONS = """You are the supervisor of a team in FractalSwarm, built as a LangGraph
supervisor. Your workers execute contracts. Read the team's state and pick the contract to run
next from the ready ones, or FINISH when no work is left. Reply with JSON matching the schema."""


@register("supervisor.routed")
class SupervisorRouted(Payload):
    """A team supervisor's routing decision (the LLM's choice, or the default if invalid)."""

    goal_id: str
    ready: list[str]
    choice: str
    valid: bool


class RouteDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    next: str
    reason: str


def route_request(goal: dict[str, Any], state: dict[str, Any], ready: list[str]) -> dict[str, Any]:
    """The supervisor's routing call: the team's contracts, their status, and what is ready."""
    contracts = [
        {
            "id": cid,
            "kind": state["contracts"][cid]["kind"],
            "depends_on": state["contracts"][cid]["depends_on"],
            "status": state["status"][cid],
        }
        for cid in state["contracts"]
    ]
    return plan_request(
        role="supervisor",
        schema_name="lg_route",
        model=RouteDecision,
        instructions=ROUTE_INSTRUCTIONS,
        header=f"TEAM {goal['id']}: next worker",
        data={"contracts": contracts, "ready": ready},
    )


# -- the workers -------------------------------------------------------------------------


@dataclass
class Agents:
    """The workers of the run, as the central baseline has them: ``agents_per_leaf`` per
    session team, all spawned up front, the dead replaced only when a team has none left."""

    size: int
    total: int
    alive: set[str] = field(default_factory=set)
    seen: int = 0
    killed: int = 0
    pools: dict[str, list[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.seen = self.total
        self.alive = {f"{COORD}.a{i}" for i in range(1, self.total + 1)}

    def pool(self, team: str) -> list[str]:
        if team not in self.pools:
            first = len(self.pools) * self.size
            self.pools[team] = [f"{COORD}.a{i}" for i in range(first + 1, first + self.size + 1)]
        return self.pools[team]

    def live(self, team: str) -> list[str]:
        return [agent for agent in self.pool(team) if agent in self.alive]

    def replacement(self, team: str) -> str:
        self.seen += 1
        agent = f"{COORD}.a{self.seen}"
        self.alive.add(agent)
        self.pools[team].append(agent)
        return agent


# -- state of each graph level ---------------------------------------------------------------


class TopState(TypedDict, total=False):
    goal: dict[str, Any]
    scope: str
    children_bodies: Annotated[list[dict[str, Any]], operator.add]


class TeamState(TypedDict, total=False):
    goal: dict[str, Any]
    scope: str
    parent: str
    children_bodies: Annotated[list[dict[str, Any]], operator.add]
    bodies: Annotated[list[dict[str, Any]], operator.add]


class SessionState(TypedDict, total=False):
    goal: dict[str, Any]
    scope: str
    parent: str
    contracts: dict[str, Any]
    status: dict[str, str]
    outputs: dict[str, Any]
    losses: dict[str, int]
    collisions: dict[str, int]
    cur: str | None  # the contract a worker is on
    agent: str | None
    step: int
    messages: list[dict[str, Any]]  # the worker's conversation, as message dicts
    result: dict[str, Any]  # the worker's final answer
    published: list[str]
    routes: int
    route: str
    bodies: Annotated[list[dict[str, Any]], operator.add]


@dataclass
class Reply:
    status: str  # ok | error | incomplete | refused
    text: str = ""
    message: Any = None  # the AIMessage
    error: str = ""
    killed: bool = False


def _killed(exc: BaseException | None) -> bool:
    while exc is not None:
        if isinstance(exc, EffectKilled):
            return True
        exc = exc.__cause__ or exc.__context__
    return False


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    return "".join(
        block.get("text", "")
        for block in content or []
        if block.get("type") in ("text", "output_text")
    )


# -- the process: what every node shares -----------------------------------------------------


class Teams:
    """One run's process: the model client, the blackboard, the workers and the graph."""

    def __init__(self, rt: FrameworkRuntime, params: dict[str, Any]) -> None:
        from fractalswarm.memory.blackboard import Blackboard

        self.rt = rt
        spec = params["spec"]
        scaling = spec["scaling"]
        leaves = scaling["fanout"][0] * scaling["fanout"][1]
        self.args = {
            "max_attempts": spec["max_attempts"],
            "max_steps": spec["max_steps"],
            "contributor": bool(params.get("contributor", spec.get("contributor_opt_in"))),
        }
        self.root = {
            "id": "root",
            "goal": spec["goal"],
            "corpus": params["corpus"],
            "truth": params["truth"],
        }
        self.agents = Agents(scaling["agents_per_leaf"], scaling["agents_per_leaf"] * leaves)
        self.board = Blackboard()
        self.chat = chat_model(rt)
        self.depth = len(scaling["fanout"])
        self.graph: Any = None

    # -- model calls -------------------------------------------------------------------------

    async def ask(
        self,
        request: dict[str, Any],
        *,
        actor: str,
        tag: str,
        scopes: dict[str, str],
        agent: str | None = None,
        history: list[Any] | None = None,
    ) -> Reply:
        """One model call, as ``ChatOpenAI``: the request's instructions and input as messages
        (a worker passes its whole conversation), its tools bound, its format and its call
        options (role, tag, budget scopes) riding along to the LLM layer."""
        from langchain_core.messages import HumanMessage, SystemMessage

        if self.args["contributor"]:
            request = request | {"contributor": True}
        messages: list[Any] = []
        if request.get("instructions"):
            messages.append(SystemMessage(content=request["instructions"]))
        messages += history if history is not None else [HumanMessage(content=request["input"])]
        model = self.chat.bind_tools(request["tools"]) if request.get("tools") else self.chat
        options = call_options(
            request, actor=actor, tag=tag, scopes=scopes, agent=agent, as_text=history is None
        )
        try:
            message = await model.bind(**options).ainvoke(messages)
        except Exception as exc:  # an API error (after the LLM layer's retries) or a kill
            return Reply("error", error=f"{type(exc).__name__}: {exc}"[:300], killed=_killed(exc))
        status = message.response_metadata.get("status") or "completed"
        text = _text(message.content)
        if status == "incomplete":
            return Reply("incomplete", text, message, "incomplete: max_output_tokens")
        return Reply("ok", text, message)

    async def plan(
        self, goal: dict[str, Any], level: str, actor: str, scopes: dict[str, str]
    ) -> tuple[dict[str, Any], bool]:
        """A planning call with the replanning ladder's first steps: retry with the parser's
        feedback up to ``MAX_PLAN_ATTEMPTS``, then the task's deterministic fallback."""
        make, parse, fallback = {
            "root": (T2.root_request, T2.root_parse, T2.root_fallback),
            "split": (T2.split_request, T2.split_parse, T2.split_fallback),
            "contracts": (T2.contracts_request, T2.contracts_parse, T2.contracts_fallback),
        }[level]
        feedback: list[str] = []
        for attempt in range(MAX_PLAN_ATTEMPTS):
            reply = await self.ask(
                make(goal, feedback),
                actor=actor,
                tag=f"plan|{goal['id']}|{attempt}",
                scopes=scopes,
            )
            if reply.status == "ok":
                plan, errors = parse(goal, reply.text)
            else:
                plan, errors = None, [f"planning call {reply.status}: {reply.error}".strip()]
            if plan is not None:
                return plan, False
            rejected = {"goal_id": goal["id"], "attempt": attempt, "errors": errors}
            self.rt.emit("plan.rejected", rejected, actor)
            feedback = errors
        return fallback(goal), True

    def emit(self, command: Any, actor: str) -> None:
        """Log what a shared helper (the board, the integrator) returned as ``Emit``."""
        if isinstance(command, Emit):
            self.rt.emit(command.type, command.payload, actor, idem_key=command.idem_key)


# -- the graphs ------------------------------------------------------------------------------


def build_graph(proc: Teams, saver: Any):
    """The top graph; track teams and session teams are the graphs it invokes beneath it."""
    from langchain_core.messages import (
        HumanMessage,
        ToolMessage,
        message_to_dict,
        messages_from_dict,
    )
    from langchain_core.runnables import RunnableConfig
    from langgraph.graph import END, START, StateGraph
    from langgraph.types import Send

    rt = proc.rt

    # -- session team: supervisor and workers --------------------------------------------

    def dispatchable(state: SessionState) -> tuple[Dag, list[str]]:
        dag = Dag({cid: c["depends_on"] for cid, c in state["contracts"].items()})
        status = state["status"]
        done = [cid for cid, s in status.items() if s == "verified"]
        busy = [cid for cid, s in status.items() if s != "pending"]
        return dag, dag.ready(done, busy)

    async def session_plan(state: SessionState) -> dict[str, Any]:
        goal, scope = state["goal"], state["scope"]
        proc.agents.pool(goal["id"])
        plan, fallback = await proc.plan(goal, "contracts", COORD, {"squad": COORD})
        contracts = T2.contracts(goal, plan, COORD, scope)
        contracts = [
            c.model_copy(
                update={"budget": c.budget.model_copy(update={"max_steps": proc.args["max_steps"]})}
            )
            for c in contracts
        ]
        refined = {"goal_id": goal["id"], "owner": COORD, "children": [c.id for c in contracts]}
        rt.emit("plan.refined", refined | {"plan": plan, "fallback": fallback}, COORD)
        stored = {}
        for contract in contracts:
            stored[contract.id] = contract.model_dump()
            created = {"contract": stored[contract.id], "work": f"{goal['id']}/{contract.id}"}
            rt.emit("contract.created", created | {"owner": COORD}, COORD)
        return {
            "contracts": stored,
            "status": dict.fromkeys(stored, "pending"),
            "outputs": {},
            "losses": dict.fromkeys(stored, 0),
            "collisions": dict.fromkeys(stored, 0),
            "cur": None,
            "routes": 0,
            "route": "supervise",
        }

    async def supervise(state: SessionState) -> dict[str, Any]:
        """The team supervisor: ask the LLM which ready contract goes next, hand it to a worker."""
        goal = state["goal"]
        dag, ready = dispatchable(state)
        if not ready:
            return {"route": "finish"}
        routes = state["routes"] + 1
        reply = await proc.ask(
            route_request(goal, state, ready),
            actor=COORD,
            tag=f"coord:route|{goal['id']}|{routes}",
            scopes={"squad": COORD},
        )
        choice, valid = ready[0], False  # an unusable answer: the default, the first ready
        if reply.status == "ok":
            try:
                decision = RouteDecision.model_validate_json(reply.text)
            except ValidationError:
                decision = None
            if decision is not None and decision.next in ready:
                choice, valid = decision.next, True
        routed = {"goal_id": goal["id"], "ready": ready, "choice": choice, "valid": valid}
        rt.emit("supervisor.routed", routed, COORD)

        cid = choice
        pool = proc.agents
        agents = pool.live(goal["id"]) or [pool.replacement(goal["id"])]
        contract = Contract.model_validate(state["contracts"][cid])
        deps = {dep: state["outputs"][dep] for dep in contract.depends_on}
        update: dict[str, Any] = {"inputs": T2.contract_inputs(goal, contract, deps)}
        update["owner"] = COORD
        if contract.assignee not in agents:
            update["assignee"] = rank(f"{goal['id']}/{cid}:{contract.attempt}", agents)[0]
        contract = contract.model_copy(update=update)
        dispatched = {
            "goal_id": goal["id"],
            "contract_id": cid,
            "attempt": contract.attempt,
            "assignee": contract.assignee,
            "idem_key": contract.idem_key,
            "work": f"{goal['id']}/{cid}",
        }
        rt.emit("contract.dispatched", dispatched, COORD)
        return {
            "contracts": {**state["contracts"], cid: contract.model_dump()},
            "status": {**state["status"], cid: "running"},
            "cur": cid,
            "agent": contract.assignee,
            "step": 1,
            "messages": [message_to_dict(HumanMessage(content=contract_prompt(contract)))],
            "published": [],
            "routes": routes,
            "route": "agent",
        }

    async def worker_agent(state: SessionState) -> dict[str, Any]:
        """The worker's model step: tool calls go to the tools node, a final answer to the
        supervisor's verification."""
        cid, agent = state["cur"], state["agent"]
        assert cid is not None and agent is not None
        contract = Contract.model_validate(state["contracts"][cid])
        history = messages_from_dict(state["messages"])
        reply = await proc.ask(
            llm_request(contract, []),
            actor=agent,
            tag=f"{contract.idem_key}:{state['step']}",
            scopes={"contract": contract.idem_key, "squad": COORD},
            agent=agent,
            history=history,
        )
        if reply.killed:
            return {"route": "lost"}
        if reply.status != "ok":
            return finished(state, contract, "error", {}, f"LLM call {reply.status}: {reply.error}")
        message = reply.message
        calls = list(message.tool_calls) + list(message.invalid_tool_calls)
        if not calls:
            import json

            try:
                answer = json.loads(reply.text)
            except ValueError:
                error = f"final answer is not JSON: {reply.text[:200]}"
                return finished(state, contract, "error", {}, error)
            if not isinstance(answer, dict):
                return finished(state, contract, "error", {}, "final answer is not a JSON object")
            return finished(state, contract, "ok", answer, "")
        if state["step"] >= proc.args["max_steps"]:
            error = f"no answer after {state['step']} steps"
            return finished(state, contract, "error", {}, error)
        return {"messages": [*state["messages"], message_to_dict(message)], "route": "tools"}

    def finished(
        state: SessionState, contract: Contract, status: str, output: dict, error: str
    ) -> dict[str, Any]:
        goal = state["goal"]
        result = {
            "status": status,
            "output": output,
            "error": error,
            "steps": state["step"],
            "agent": state["agent"],
        }
        completed = {"goal_id": goal["id"], "contract_id": contract.id, "attempt": contract.attempt}
        completed |= {"agent": state["agent"], "status": status, "steps": state["step"]}
        rt.emit("contract.completed", completed, state["agent"] or COORD)
        return {"result": result, "route": "verify"}

    async def worker_tools(state: SessionState) -> dict[str, Any]:
        """Run the model's tool calls on the blackboard, tools deny-by-default."""
        import json

        cid, agent = state["cur"], state["agent"]
        assert cid is not None and agent is not None
        contract = Contract.model_validate(state["contracts"][cid])
        messages = list(state["messages"])
        message = messages_from_dict(messages[-1:])[0]
        published = list(state["published"])
        replies = []
        for call in message.tool_calls:
            name = call["name"]
            if name not in contract.tools:
                output: dict[str, Any] = {
                    "error": f"tool {name!r} is not allowed for this contract"
                }
            else:
                try:
                    args = TOOL_ARGS[name].model_validate(call["args"]).model_dump()
                except (ValueError, ValidationError) as exc:
                    output = {"error": f"bad arguments for {name}: {exc}"[:500]}
                else:
                    body = {"call_id": call["id"], "name": name, "args": args, "squad": COORD}
                    body |= {"agent": agent, "contract": contract.idem_key}
                    view = SimpleNamespace(lamport=rt.lamport)
                    output, commands = _tool(proc.board, body, view)  # type: ignore[arg-type]
                    for command in commands:
                        proc.emit(command, COORD)
                    if output.get("ok") and "key" in output and "version" in output:
                        published = sorted({*published, output["key"]})
            replies.append((call["id"], output))
        for call in message.invalid_tool_calls:
            output = {"error": f"bad arguments for {call['name']}: {call.get('error')}"[:500]}
            replies.append((call["id"], output))
        for call_id, output in replies:
            content = json.dumps(output, sort_keys=True, ensure_ascii=False)
            messages.append(message_to_dict(ToolMessage(content=content, tool_call_id=call_id)))
        return {
            "messages": messages,
            "published": published,
            "step": state["step"] + 1,
            "route": "agent",
        }

    def retry(
        state: SessionState, contract: Contract, stage: str, reasons: list[str]
    ) -> dict[str, Any]:
        """The ladder's steps 1-2: retry with feedback, then reassign; a contract lost with
        its worker (a kill) goes again without counting as a failed attempt."""
        goal, cid = state["goal"], contract.id
        reasons = [reason[:400] for reason in reasons[:MAX_FEEDBACK_LINES]]
        rejected = {"goal_id": goal["id"], "contract_id": cid, "attempt": contract.attempt}
        rt.emit("contract.rejected", rejected | {"stage": stage, "reasons": reasons}, COORD)
        losses = dict(state["losses"])
        if stage == "lost":
            losses[cid] += 1
        attempt = contract.attempt + 1
        update: dict[str, Any] = {"losses": losses, "route": "supervise", "cur": None}
        if attempt - losses[cid] >= proc.args["max_attempts"]:
            failed = rejected | {"reasons": reasons, "work": f"{goal['id']}/{cid}"}
            rt.emit("contract.failed", failed, COORD)
            return update | {"status": {**state["status"], cid: "failed"}}
        assignee = contract.assignee
        if stage == "lost":
            assignee = None
        elif stage != "booking" and attempt >= 2:
            ranked = rank(f"{goal['id']}/{cid}", proc.agents.pool(goal["id"]))
            assignee = ([agent for agent in ranked if agent != contract.assignee] or ranked)[0]
        feedback = contract.feedback if stage == "lost" else reasons
        contract = contract.model_copy(
            update={"attempt": attempt, "feedback": feedback, "assignee": assignee}
        )
        return update | {
            "contracts": {**state["contracts"], cid: contract.model_dump()},
            "status": {**state["status"], cid: "pending"},
        }

    async def lost(state: SessionState) -> dict[str, Any]:
        cid = state["cur"]
        assert cid is not None
        contract = Contract.model_validate(state["contracts"][cid])
        return retry(state, contract, "lost", [f"agent {state['agent']} was lost"])

    async def verify(state: SessionState) -> dict[str, Any]:
        """The supervisor's verification of a worker's answer: checks, judge, booking."""
        goal, cid = state["goal"], state["cur"]
        assert cid is not None
        contract = Contract.model_validate(state["contracts"][cid])
        result, output = state["result"], state["result"]["output"]
        if result["status"] != "ok":
            return retry(state, contract, "agent", [result["error"]])
        failures = run_checks(contract.acceptance.checks, output, T2.check_context(goal))
        if failures:
            return retry(state, contract, "checks", failures)
        if T2.needs_judge(contract):
            reply = await proc.ask(
                judge_request(contract, output, contract.inputs.get("data", {})),
                actor=COORD,
                tag=f"judge|{goal['id']}|{cid}|{contract.attempt}",
                scopes={"contract": contract.idem_key, "squad": COORD},
            )
            verdict = read_verdict(reply.status, reply.text)
            judged = {"goal_id": goal["id"], "contract_id": cid, "attempt": contract.attempt}
            rt.emit("verify.judged", judged | verdict.model_dump(), COORD)
            if verdict.verdict == "fail":
                return retry(state, contract, "judge", verdict.reasons or ["the judge failed it"])
        writes = T2.bookings(goal, contract, output)
        collisions = dict(state["collisions"])
        if writes:
            body = {"goal_id": goal["id"], "contract_id": cid, "attempt": contract.attempt}
            body |= {"token": {"member": COORD, "incarnation": 0, "epoch": 0}, "writes": writes}
            view = SimpleNamespace(now=rt.vtime, lamport=rt.lamport)
            conflicts: list[dict[str, Any]] = []
            for command in _book(proc.board, body, COORD, view):  # type: ignore[arg-type]
                proc.emit(command, COORD)
                if not isinstance(command, Emit):
                    conflicts = command.body["conflicts"]
            if conflicts:
                collisions[cid] += 1
                state = {**state, "collisions": collisions}
                return retry(state, contract, "booking", T2.conflict_feedback(conflicts))
        verified = {"goal_id": goal["id"], "contract_id": cid, "attempt": contract.attempt}
        rt.emit("contract.verified", verified | {"work": f"{goal['id']}/{cid}"}, COORD)
        for key in sorted(state["published"]):
            if proc.board.promote(key) is not None:
                rt.emit("fact.promoted", {"key": key, "by": COORD}, COORD)
        if collisions[cid]:
            resolution = f"re-placed after {collisions[cid]} booking conflict(s)"
            resolved = {"kind": "temporal", "goal_id": goal["id"], "resolution": resolution}
            rt.emit("collision.resolved", resolved, COORD)
        return {
            "outputs": {**state["outputs"], cid: output},
            "status": {**state["status"], cid: "verified"},
            "collisions": collisions,
            "cur": None,
            "route": "supervise",
        }

    async def session_finish(state: SessionState) -> dict[str, Any]:
        goal = state["goal"]
        dag = Dag({cid: c["depends_on"] for cid, c in state["contracts"].items()})
        entry = {"goal": goal, "status": state["status"], "outputs": state["outputs"]}
        output, gaps = leaf_outcome(T2, entry, dag)
        commands, body = finish_goal(
            T2, COORD, {"goal": goal, "from": state["parent"]}, output, gaps
        )
        for command in commands:
            proc.emit(command, COORD)
        return {"bodies": [body]}

    async def pick(state: SessionState) -> str:
        return state["route"]

    session = StateGraph(SessionState)
    session.add_node("plan", session_plan)
    session.add_node("supervise", supervise)
    session.add_node("agent", worker_agent)
    session.add_node("tools", worker_tools)
    session.add_node("lost", lost)
    session.add_node("verify", verify)
    session.add_node("finish", session_finish)
    session.add_edge(START, "plan")
    session.add_edge("plan", "supervise")
    session.add_conditional_edges("supervise", pick, {"agent": "agent", "finish": "finish"})
    session.add_conditional_edges(
        "agent", pick, {"tools": "tools", "verify": "verify", "lost": "lost"}
    )
    session.add_edge("tools", "agent")
    session.add_edge("lost", "supervise")
    session.add_edge("verify", "supervise")
    session.add_edge("finish", END)
    session_graph = session.compile()

    # -- track team: its supervisor splits the track into sessions --------------------------

    async def track_plan(state: TeamState) -> dict[str, Any]:
        goal = state["goal"]
        plan, fallback = await proc.plan(goal, "split", COORD, {"squad": COORD})
        children = T2.split_children(goal, plan)
        refined = {"goal_id": goal["id"], "owner": COORD, "children": [c["id"] for c in children]}
        rt.emit("plan.refined", refined | {"plan": plan, "fallback": fallback}, COORD)
        return {"goal": goal | {"children": children}}

    async def track_fan(state: TeamState):
        return [
            Send(
                "session_team",
                {"goal": child, "scope": state["scope"], "parent": state["goal"]["id"]},
            )
            for child in sorted(state["goal"]["children"], key=lambda c: c["id"])
        ]

    async def session_team(payload: SessionState, config: RunnableConfig) -> dict[str, Any]:
        out = await session_graph.ainvoke(payload, config)
        return {"children_bodies": out["bodies"]}

    async def track_finish(state: TeamState) -> dict[str, Any]:
        goal = state["goal"]
        children = {body["goal_id"]: {"result": body} for body in state["children_bodies"]}
        output, gaps = merge_children(T2, goal, children)
        entry = {"goal": goal, "from": state["parent"]}
        commands, body = finish_goal(T2, COORD, entry, output, gaps)
        for command in commands:
            proc.emit(command, COORD)
        return {"bodies": [body]}

    track = StateGraph(TeamState)
    track.add_node("plan", track_plan)
    track.add_node("session_team", session_team)
    track.add_node("finish", track_finish)
    track.add_edge(START, "plan")
    track.add_conditional_edges("plan", track_fan, ["session_team"])
    track.add_edge("session_team", "finish")
    track.add_edge("finish", END)
    track_graph = track.compile()

    # -- top: the root supervisor plans, the tracks are the teams --------------------------

    async def root_plan(state: TopState) -> dict[str, Any]:
        goal = state["goal"]
        plan, fallback = await proc.plan(goal, "root", COORD, {"squad": COORD})
        envelope = scoping.approve(goal["goal"], T2.envelope(goal, plan))
        token = envelope.scope_token
        proposed = {"goal_id": goal["id"], "plan": plan, "plan_hash": token, "fallback": fallback}
        rt.emit("plan.proposed", proposed, COORD)
        approved = {"goal_id": goal["id"], "scope_token": token, "by": "auto"}
        rt.emit("plan.approved", approved | {"envelope": envelope.model_dump(mode="json")}, COORD)
        return {"goal": goal | {"children": T2.root_children(goal, plan)}, "scope": token}

    async def root_fan(state: TopState):
        return [
            Send("track_team", {"goal": child, "scope": state["scope"], "parent": "root"})
            for child in sorted(state["goal"]["children"], key=lambda c: c["id"])
        ]

    async def track_team(payload: TeamState, config: RunnableConfig) -> dict[str, Any]:
        out = await track_graph.ainvoke(payload, config)
        return {"children_bodies": out["bodies"]}

    async def root_finish(state: TopState) -> dict[str, Any]:
        goal = state["goal"]
        children = {body["goal_id"]: {"result": body} for body in state["children_bodies"]}
        output, gaps = merge_children(T2, goal, children)
        commands, _ = finish_goal(T2, COORD, {"goal": goal, "from": None}, output, gaps)
        for command in commands:
            proc.emit(command, COORD)
        return {}

    top = StateGraph(TopState)
    top.add_node("plan", root_plan)
    top.add_node("track_team", track_team)
    top.add_node("finish", root_finish)
    top.add_edge(START, "plan")
    top.add_conditional_edges("plan", root_fan, ["track_team"])
    top.add_edge("track_team", "finish")
    top.add_edge("finish", END)
    return top.compile(checkpointer=saver)


# -- chaos: the monkey's plan, and the best-case supervisor ----------------------------------


@dataclass
class Chaos:
    plan: ChaosPlan
    seed: str
    expected: int
    next_action: int = 0
    agents_killed: int = 0

    @property
    def actions(self) -> tuple[ChaosAction, ...]:
        return self.plan.actions

    def more(self) -> bool:
        return self.next_action < len(self.actions)


async def program(rt: FrameworkRuntime) -> None:
    """The run's program. LangSmith tracing is off whatever the environment says: it would
    send every prompt, Contributor-mode ones included, to a third party."""
    from langsmith import tracing_context

    with tracing_context(enabled=False):
        await coordinate(rt)


async def coordinate(rt: FrameworkRuntime) -> None:
    """The coordinator process under its best-case supervisor, then the chaos monkey that
    crashes it: runs the graph; at each crash point cancels everything in flight, waits the
    restart delay and resumes the graph from its checkpoints."""
    from langgraph.checkpoint.memory import InMemorySaver

    params = rt.params
    proc = Teams(rt, params)
    progress = next(r for r in rt.reducers if isinstance(r, ProgressView))
    chaos = Chaos(plan_from(params), rt.seed, expected_contracts(T2.name, params["corpus"]))
    graph = proc.graph = build_graph(proc, InMemorySaver())
    config = {"configurable": {"thread_id": rt.run_id}, "recursion_limit": RECURSION_LIMIT}
    start = {"goal": proc.root}

    def launch(first: bool) -> asyncio.Future[Any]:
        return asyncio.ensure_future(
            graph.ainvoke(start if first else None, config, durability="sync")
        )

    async def crash(run: asyncio.Future[Any], fraction: float, number: int) -> asyncio.Future[Any]:
        remaining = progress.remaining_by_owner().get(COORD, 0)
        injected = {"fault": "kill_coordinator", "target": COORD, "progress": round(fraction, 4)}
        rt.emit("chaos.injected", injected | {"detail": {"remaining_work": remaining}}, "chaos")
        # Process-tree semantics: the run's in-flight calls, the workers' included, die with it.
        lost = [
            w.event.payload["tag"] for w in rt.cancel(lambda w: w.event.payload["kind"] != "timer")
        ]
        dispatched = sum(1 for item in progress.items.values() if item.dispatches)
        crashed = {"coordinator": COORD, "crash": number, "dispatched": dispatched, "lost": lost}
        rt.emit("baseline.crashed", crashed | {"restart_in_ms": RESTART_DELAY_MS}, COORD)
        run.cancel()
        await asyncio.wait({run})
        await rt.timer(RESTART_DELAY_MS, RESTART_TAG, COORD)
        rt.emit("baseline.restarted", {"coordinator": COORD, "crash": number, "redo": lost}, COORD)
        return launch(first=False)

    def kill_agents(action: ChaosAction, fraction: float) -> None:
        agents = proc.agents
        alive = sorted(agents.alive)
        quota = math.floor(action.agent_share * agents.seen + 1e-9)
        count = min(max(quota - chaos.agents_killed, 0), len(alive))
        victims = sorted(
            random.Random(f"{rt.seed}:chaos:kill_agents:{chaos.next_action}").sample(alive, count)
        )
        chaos.agents_killed += count
        for victim in victims:
            injected = {"fault": "kill_agent", "target": victim, "progress": round(fraction, 4)}
            rt.emit("chaos.injected", injected, "chaos")
            agents.alive.discard(victim)
            rt.cancel(lambda w, victim=victim: w.agent == victim, EffectKilled(victim))

    run = launch(first=True)
    poll = asyncio.ensure_future(rt.timer(POLL_MS, "chaos.poll", "chaos")) if chaos.more() else None
    crashes = 0
    while True:
        await asyncio.wait({run, *([poll] if poll else [])}, return_when=asyncio.FIRST_COMPLETED)
        if run.done():
            break
        assert poll is not None
        fraction = progress.fraction(chaos.expected)
        while chaos.more() and chaos.actions[chaos.next_action].at <= fraction:
            action = chaos.actions[chaos.next_action]
            chaos.next_action += 1
            if action.kind == "kill_coordinator":
                crashes += 1
                run = await crash(run, fraction, crashes)
            elif action.kind == "kill_agents":
                kill_agents(action, fraction)
            else:  # a partition needs a bus; this workflow has none
                skipped = {"fault": action.kind, "progress": round(fraction, 4)}
                rt.emit("chaos.injected", skipped | {"detail": {"skipped": True}}, "chaos")
        poll = (
            asyncio.ensure_future(rt.timer(POLL_MS, "chaos.poll", "chaos"))
            if chaos.more()
            else None
        )
    if poll is not None:
        rt.cancel(lambda w: w.event.payload["tag"] == "chaos.poll")
    run.result()


# -- recording and replaying a run -------------------------------------------------------------


async def record_langgraph(
    *,
    run_id: str,
    run_dir: Path,
    backend: Backend,
    seed: str,
    params: dict[str, Any],
    clock: str = "sim",
    speed: float = 1.0,
    run_cap_usd: float | None = None,
    project_ledger: ProjectLedger | None = None,
    secrets: list[str] | None = None,
    roles: RoleTable | None = None,
    prices: PriceTable | None = None,
) -> RunResult:
    """Record the baseline's run into ``run_dir``, like ``runs.record_run`` does for the others."""
    paths = RunPaths(run_dir)
    if paths.events.exists() or paths.cassette.exists():
        raise FileExistsError(f"{run_dir} already holds a run")
    cassette = Cassette(paths.cassette, secrets or [])
    client = LLMClient(
        backend,
        roles=roles or RoleTable.load(),
        prices=prices or PriceTable.load(),
        mode="record",
        cassette=cassette,
        project_ledger=project_ledger,
    )
    run_clock = ManualClock("sim") if clock == "sim" else LiveClock(speed)
    with EventStore(paths.events) as store:
        runtime = FrameworkRuntime(
            store,
            run_id=run_id,
            seed=seed,
            scenario=SCENARIO,
            params=params,
            mode="sim" if clock == "sim" else "live",
            clock=run_clock,
            clock_mode=clock,
            config={"llm": client.config_snapshot()},
            run_cap_usd=default_run_cap_usd() if run_cap_usd is None else run_cap_usd,
            project_remaining_usd=project_ledger.remaining_usd() if project_ledger else None,
            estimators={"llm": client.estimate},
            runner=EffectRunner({"llm": client.effect()}, EffectContext(run_id, run_clock)),
            reducers=[ProgressView(T2_PROGRESS)],
        )
        with LiveMarker(paths.live):
            completed = await runtime.drive(program)
        store.export_jsonl(paths.events_jsonl)
        return RunResult(run_id, paths, completed, store.head_hash, store.last_seq)


async def replay_langgraph(recorded: EventStore, cassette: Cassette) -> ReplayReport:
    """Replay a recorded run: the program runs again over the recorded completions."""

    def build(first: Event, store: EventStore):
        started = first.payload
        roles, prices = LLMClient.config_from_snapshot(started["config"]["llm"])
        client = LLMClient(
            CassetteBackend(cassette), roles=roles, prices=prices, mode="replay", cassette=cassette
        )

        async def no_sleep(virtual_ms: int) -> None:
            return None

        async def replay_llm(effect: Event, recorded: Event) -> tuple[str, dict[str, Any]]:
            outcome: EffectOutcome = await client.call(
                effect.payload["effect_id"],
                effect.payload["request"],
                run_id=effect.run_id,
                sleep=no_sleep,
            )
            return outcome.status, outcome.result

        runtime = FrameworkRuntime(
            store,
            run_id=first.run_id,
            seed=started["seed"],
            scenario=started["scenario"],
            params=started["params"],
            mode="replay",
            clock=ManualClock("replay"),
            clock_mode=started["clock"],
            config=started["config"],
            run_cap_usd=started["run_cap_usd"],
            project_remaining_usd=started["project_remaining_usd"],
            estimators={"llm": client.estimate},
            replayers={"llm": replay_llm},
            reducers=[ProgressView(T2_PROGRESS)],
        )
        return runtime, program

    return await replay_framework(recorded, build)
