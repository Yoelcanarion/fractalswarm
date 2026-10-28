"""The ``t2_conference`` bench task and its workflows (spec §15.1): ``swarm`` and the
in-house baselines ``central``, ``single`` and ``pipeline``.

Every workflow runs the scenario code of ``actors/swarm.py`` on the same T2 instance, so at
C0 they make the same LLM calls. Under chaos they get the same plan (``build_plan`` with the
cell's profile and seed: the same crash points, agent kills and network faults) and API
faults from the same seed. The swarm runs with membership on at every profile, C0 included,
so its C0 twin is the same system. The baselines are crashed by signal and restart 5 s
later with their completed work kept (``actors/orchestrator.py``).

A cell's seed picks the T2 instance (``tasks/fixtures/t2/seed-<n>``, generated when missing),
the run's seed and the chaos seed.
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
from fractalswarm.bench.tasks.t2_conference.fake import t2_script
from fractalswarm.bench.tasks.t2_conference.task import T2
from fractalswarm.comms.chaos import plan_from
from fractalswarm.kernel.events import Event
from fractalswarm.llm.fake import FakeBackend, FakeReply, default_script
from fractalswarm.llm.roles import RoleTable
from fractalswarm.planning.taskspec import REPO_ROOT, TaskSpec, run_params
from fractalswarm.runs import record_run

T2_TASKSPEC = REPO_ROOT / "tasks" / "examples" / "t2-conference.yaml"
T2_FIXTURES = REPO_ROOT / "tasks" / "fixtures" / "t2"
CALIBRATION = REPO_ROOT / "config" / "fake_calibration.json"
# Pre-flight: attempts per contract and per plan, and how much in-flight work a crash redoes.
PREFLIGHT_ATTEMPTS = 2
PREFLIGHT_STEP_CHARS = 2_000  # what one tool turn adds to an agent's input


def bench_script(body: dict[str, Any], attempt: int) -> FakeReply | str:
    """The fake LLM of the bench: T2's scripted answers, the default reply for the rest."""
    reply = t2_script(body, attempt)
    if isinstance(reply, str) and reply.startswith("[fake] no script"):
        return default_script(body, attempt)
    return reply


def fake_backend() -> FakeBackend:
    """The fake LLM with latencies and reasoning tokens fitted to real calls, when a fit
    exists (the $0 gate runs on calibrated latencies, spec §15.6)."""
    if CALIBRATION.exists():
        from fractalswarm.llm.calibrate import Calibration

        return Calibration.load(CALIBRATION).backend(script=bench_script)
    return FakeBackend(script=bench_script)


def t2_spec(seed: str) -> TaskSpec:
    spec = TaskSpec.load(T2_TASKSPEC)
    if seed.isdigit():
        spec.inputs.fixture = str(T2_FIXTURES / f"seed-{int(seed)}")
        spec.inputs.generate_seed = int(seed)
    spec.seed = seed
    return spec


def t2_params(cell: Cell, contributor: bool) -> dict[str, Any]:
    params = run_params(t2_spec(cell.seed))
    params["chaos"] = {"profile": cell.profile.name, "seed": cell.seed}
    params["contributor"] = contributor
    return params


class T2Workflow:
    tasks = frozenset({"t2_conference"})

    def __init__(self, name: str) -> None:
        self.name = name  # also the scenario: swarm | central | single | pipeline

    async def run(self, ctx: CellContext) -> None:
        from fractalswarm.llm.transport import ApiFaults, FaultyBackend

        params = t2_params(ctx.cell, ctx.contributor)
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
        """Every planning call twice, every contract's agent loop at ``max_steps`` twice, every
        judge call twice, and each coordinator crash redoing one contract per session."""
        from fractalswarm.actors.agent import contract_prompt, llm_request
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
                    prompt = contract_prompt(contract)
                    for step in range(spec.max_steps):
                        text = prompt + "x" * (PREFLIGHT_STEP_CHARS * step)
                        agent_calls.append(
                            llm_request(contract, [{"role": "user", "content": text}])
                        )
                    if T2.needs_judge(contract):
                        requests.append(
                            judge_request(contract, {}, contract.inputs.get("data", {}))
                        )
        requests = [*requests, *agent_calls] * PREFLIGHT_ATTEMPTS
        sessions = len(params["corpus"]["tracks"]) * len(params["corpus"]["days"])
        rework = agent_calls[: sessions * spec.max_steps] * cell.profile.coordinator_crashes
        requests += rework
        if contributor:
            requests = [request | {"contributor": True} for request in requests]
        return requests


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


register_workflow(T2Workflow("swarm"))
register_workflow(T2Workflow("central"))
register_workflow(T2Workflow("single"))
register_workflow(T2Workflow("pipeline"))
register_task(
    TaskDef(name="t2_conference", checker=t2_checker, description="T2 conference program")
)
