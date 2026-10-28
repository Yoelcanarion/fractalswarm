"""The bench tasks ``t2_conference`` and ``t1_extraction`` and their workflows (spec §15.1):
``swarm`` and the in-house baselines ``central``, ``single`` and ``pipeline``.

Every workflow runs the scenario code of ``actors/swarm.py`` on the same task instance, so at
C0 they make the same LLM calls. Under chaos they get the same plan (``build_plan`` with the
cell's profile and seed: the same crash points, agent kills and network faults) and API
faults from the same seed. The swarm runs with membership on at every profile, C0 included,
so its C0 twin is the same system. The baselines are crashed by signal and restart 5 s
later with their completed work kept (``actors/orchestrator.py``).

A cell's seed picks the task instance (``tasks/fixtures/<t2|t1>/seed-<n>``, generated when
missing), the run's seed and the chaos seed.
"""

from collections.abc import Sequence
from pathlib import Path
from typing import Any

from fractalswarm.bench.registry import (
    Cell,
    CellContext,
    TaskDef,
    register_task,
    register_workflow,
)
from fractalswarm.bench.scoring import Outcome
from fractalswarm.bench.tasks.t1_extraction import make_checker
from fractalswarm.bench.tasks.t1_extraction.fake import t1_script
from fractalswarm.bench.tasks.t1_extraction.task import T1, company_of
from fractalswarm.bench.tasks.t2_conference.fake import t2_script
from fractalswarm.bench.tasks.t2_conference.task import T2
from fractalswarm.comms.chaos import plan_from
from fractalswarm.kernel.events import Event
from fractalswarm.llm.fake import FakeBackend, FakeReply, Script, default_script
from fractalswarm.llm.roles import RoleTable
from fractalswarm.planning.contracts import Contract
from fractalswarm.planning.taskspec import REPO_ROOT, TaskSpec, run_params
from fractalswarm.runs import record_run

T2_TASKSPEC = REPO_ROOT / "tasks" / "examples" / "t2-conference.yaml"
T2_FIXTURES = REPO_ROOT / "tasks" / "fixtures" / "t2"
T1_TASKSPEC = REPO_ROOT / "tasks" / "examples" / "t1-extraction.yaml"
T1_FIXTURES = REPO_ROOT / "tasks" / "fixtures" / "t1"
CALIBRATION = REPO_ROOT / "config" / "fake_calibration.json"
# Pre-flight: attempts per contract and per plan, and how much in-flight work a crash redoes.
PREFLIGHT_ATTEMPTS = 2
PREFLIGHT_STEP_CHARS = 2_000  # what one tool turn adds to an agent's input
PREFLIGHT_VALUE_CHARS = 20  # a worst-case extracted value (names and numbers are shorter)


def bench_script(body: dict[str, Any], attempt: int) -> FakeReply | str:
    """The fake LLM of the bench: T1's and T2's scripted answers, the default reply for the
    rest. A script that has none for a request says so, and the next one is asked."""
    for script in (t1_script, t2_script):
        reply = script(body, attempt)
        if not (isinstance(reply, str) and reply.startswith("[fake] no script")):
            return reply
    return default_script(body, attempt)


def fake_backend(script: Script = bench_script) -> FakeBackend:
    """The fake LLM with latencies and reasoning tokens fitted to real calls, when a fit
    exists (the $0 gate runs on calibrated latencies, spec §15.6). ``script`` is the model's
    answers: the bench's T2 script unless a task brings its own (T3)."""
    if CALIBRATION.exists():
        from fractalswarm.llm.calibrate import Calibration

        return Calibration.load(CALIBRATION).backend(script=script)
    return FakeBackend(script=script)


def _spec(path: Path, fixtures: Path, seed: str) -> TaskSpec:
    spec = TaskSpec.load(path)
    if seed.isdigit():
        spec.inputs.fixture = str(fixtures / f"seed-{int(seed)}")
        spec.inputs.generate_seed = int(seed)
    spec.seed = seed
    return spec


def t2_spec(seed: str) -> TaskSpec:
    return _spec(T2_TASKSPEC, T2_FIXTURES, seed)


def t1_spec(seed: str) -> TaskSpec:
    return _spec(T1_TASKSPEC, T1_FIXTURES, seed)


def _params(spec: TaskSpec, cell: Cell, contributor: bool) -> dict[str, Any]:
    params = run_params(spec)
    params["chaos"] = {"profile": cell.profile.name, "seed": cell.seed}
    params["contributor"] = contributor
    return params


def t2_params(cell: Cell, contributor: bool) -> dict[str, Any]:
    return _params(t2_spec(cell.seed), cell, contributor)


def t1_params(cell: Cell, contributor: bool) -> dict[str, Any]:
    return _params(t1_spec(cell.seed), cell, contributor)


class BenchWorkflow:
    tasks = frozenset({"t2_conference", "t1_extraction"})

    def __init__(self, name: str) -> None:
        self.name = name  # also the scenario: swarm | central | single | pipeline

    async def run(self, ctx: CellContext) -> None:
        from fractalswarm.llm.transport import ApiFaults, FaultyBackend

        params = TASK_PARAMS[ctx.cell.task](ctx.cell, ctx.contributor)
        rate = plan_from(params).api_fault_rate
        backend = FaultyBackend(ctx.backend, ApiFaults(seed=ctx.cell.seed, rate=rate))
        roles = RoleTable.load()
        if ctx.contributor:
            roles = roles.contributor_mode(ctx.contributor_wonder == "spark")
        await record_run(
            self.name,
            run_id=ctx.cell.id,
            run_dir=ctx.run_dir,
            backend=backend,
            seed=ctx.cell.seed,
            params=params,
            clock="sim" if ctx.clock == "sim" else "live",
            run_cap_usd=ctx.run_cap_usd,
            project_ledger=ctx.project_ledger,
            secrets=ctx.secrets,
            roles=roles,
        )

    def preflight(self, cell: Cell, contributor: bool) -> list[dict[str, Any]]:
        return TASK_PREFLIGHTS[cell.task](cell, contributor)


def _agent_steps(contract: Contract, max_steps: int) -> list[dict[str, Any]]:
    """The requests of an agent loop that runs to ``max_steps``, its input growing each turn."""
    from fractalswarm.actors.agent import contract_prompt, llm_request

    prompt = contract_prompt(contract)
    return [
        llm_request(
            contract,
            [{"role": "user", "content": prompt + "x" * (PREFLIGHT_STEP_CHARS * step)}],
        )
        for step in range(max_steps)
    ]


def _worst_case(
    requests: list[dict[str, Any]],
    agent_calls: list[dict[str, Any]],
    sessions: int,
    max_steps: int,
    cell: Cell,
    contributor: bool,
) -> list[dict[str, Any]]:
    """Every planning, agent and judge request twice, and each coordinator crash redoing one
    contract's loop per session."""
    requests = [*requests, *agent_calls] * PREFLIGHT_ATTEMPTS
    requests += agent_calls[: sessions * max_steps] * cell.profile.coordinator_crashes
    if contributor:
        requests = [request | {"contributor": True} for request in requests]
    return requests


def t2_preflight(cell: Cell, contributor: bool) -> list[dict[str, Any]]:
    """Every planning call twice, every contract's agent loop at ``max_steps`` twice, every
    judge call twice, and each coordinator crash redoing one contract per session."""
    from fractalswarm.verify.judge import judge_request

    spec = t2_spec(cell.seed)
    if not Path(spec.inputs.fixture or "").joinpath("corpus.json").exists():
        spec.inputs.fixture = str(T2_FIXTURES / "seed-1")  # same size; never writes here
    params = run_params(spec)
    root = {"id": "root", "goal": spec.goal, "corpus": params["corpus"]}
    root["truth"] = params["truth"]
    requests: list[dict[str, Any]] = [T2.root_request(root, [])]
    plan = T2.root_fallback(root)
    agent_calls: list[dict[str, Any]] = []
    for track in T2.root_children(root, plan):
        requests.append(T2.split_request(track, []))
        for session in T2.split_children(track, T2.split_fallback(track)):
            requests.append(T2.contracts_request(session, []))
            contracts = T2.contracts(session, T2.contracts_fallback(session), "o", "scope")
            for contract in contracts:
                agent_calls += _agent_steps(contract, spec.max_steps)
                if T2.needs_judge(contract):
                    requests.append(judge_request(contract, {}, contract.inputs.get("data", {})))
    sessions = T2.sessions(params["corpus"])
    return _worst_case(requests, agent_calls, sessions, spec.max_steps, cell, contributor)


def _t1_worst_case(
    session: dict[str, Any], contract: Contract
) -> tuple[dict[str, Any], dict[str, Any]]:
    """A T1 contract's inputs, and its output as the judge sees it, at their largest: every
    document states all eight fields, every value is ``PREFLIGHT_VALUE_CHARS`` long."""
    value = "x" * PREFLIGHT_VALUE_CHARS
    fields = session["data"]["fields"]
    mentions = [
        {"doc_id": doc["id"], "company": company_of(doc), "field": field, "value": value}
        for doc in session["data"]["docs"]
        for field in fields
    ]
    records = [
        {"company": company, "field": field, "value": value, "doc_id": "doc-00"}
        for company in session["companies"]
        for field in fields
    ]
    deps = {"extract": {}, "resolve": {"mentions": mentions}, "report": {"records": records}}
    return T1.contract_inputs(session, contract, {"dep": deps[contract.kind]}), {"records": records}


def t1_preflight(cell: Cell, contributor: bool) -> list[dict[str, Any]]:
    """As T2's, with each contract's real inputs: the session's documents, and the largest
    outputs of the contracts it depends on."""
    from fractalswarm.verify.judge import judge_request

    spec = t1_spec(cell.seed)
    if not Path(spec.inputs.fixture or "").joinpath("docs.json").exists():
        spec.inputs.fixture = str(T1_FIXTURES / "seed-1")  # same size; never writes here
    params = run_params(spec)
    root = {"id": "root", "goal": spec.goal, "corpus": params["corpus"]}
    root["truth"] = params["truth"]
    requests: list[dict[str, Any]] = [T1.root_request(root, [])]
    plan = T1.root_fallback(root)
    agent_calls: list[dict[str, Any]] = []
    for group in T1.root_children(root, plan):
        requests.append(T1.split_request(group, []))
        for session in T1.split_children(group, T1.split_fallback(group)):
            requests.append(T1.contracts_request(session, []))
            contracts = T1.contracts(session, T1.contracts_fallback(session), "o", "scope")
            for contract in contracts:
                inputs, output = _t1_worst_case(session, contract)
                contract = contract.model_copy(update={"inputs": inputs})
                agent_calls += _agent_steps(contract, spec.max_steps)
                if T1.needs_judge(contract):
                    requests.append(judge_request(contract, output, inputs["data"]))
    sessions = T1.sessions(params["corpus"])
    return _worst_case(requests, agent_calls, sessions, spec.max_steps, cell, contributor)


TASK_PARAMS = {"t2_conference": t2_params, "t1_extraction": t1_params}
TASK_PREFLIGHTS = {"t2_conference": t2_preflight, "t1_extraction": t1_preflight}


def t2_checker(events: Sequence[Event]) -> Outcome:
    result = next((e.payload for e in reversed(events) if e.type == "task.result"), None)
    if result is None:
        return Outcome(completed=False, valid=False, detail="no task.result")
    report = result["report"]
    valid = report["hard_violations"] == 0 and report["placed"] == report["expected"]
    detail = (
        f"placed {report['placed']}/{report['expected']}, "
        f"hard violations {report['hard_violations']}, gaps {len(report['gaps'])}"
    )
    return Outcome(completed=True, valid=valid, score=report["soft_score"], detail=detail)


def _final_table(events: Sequence[Event]) -> dict[str, dict[str, str]] | None:
    result = next((e.payload for e in reversed(events) if e.type == "task.result"), None)
    return None if result is None else result["report"]["table"]


def t1_checker(events: Sequence[Event]) -> Outcome:
    """F1 of the run's final table against the truth that ``run.started`` recorded."""
    started = next((e for e in events if e.type == "run.started"), None)
    truth = started.payload["params"]["truth"] if started is not None else {}
    return make_checker(truth, _final_table)(events)


for _name in ("swarm", "central", "single", "pipeline"):
    register_workflow(BenchWorkflow(_name))
register_task(
    TaskDef(name="t2_conference", checker=t2_checker, description="T2 conference program")
)
register_task(
    TaskDef(name="t1_extraction", checker=t1_checker, description="T1 multi-document extraction")
)
