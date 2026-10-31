"""Workflows and tasks the bench harness can run, looked up by name.

A **workflow** (swarm, central, single, pipeline, langgraph, or the ``toy`` stand-in) records
one run of one task into a run directory and lists the worst-case LLM requests of a run, for
the cost pre-flight. A workflow that can vary its total number of agents (the matrix's
``agents`` axis, ``bench/scaling.py``) sets ``scalable = True``. A **task** (t1_extraction,
t2_conference, ...) supplies the checker that turns a run's log into completion and
validity. Runners and tasks built later register themselves here with ``register_workflow``
and ``register_task``.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from fractalswarm.bench.profiles import ChaosProfile
from fractalswarm.bench.scoring import Checker, default_checker
from fractalswarm.llm.client import Backend
from fractalswarm.market.ledger import ProjectLedger

# The sweep knobs a matrix can set per cell (``Matrix.knobs``). The first four become run
# params that only the scenarios read (``actors/swarm.py``: ``sweep_knobs`` and
# ``any_survivor``, on at 1); the agents' latency scale changes the fake LLM
# (``llm/calibrate.py``) and the crash jitter moves the crashes of the chaos plan
# (``bench/profiles.py``: ``jittered_plan``), so neither reaches a run's params as itself.
PARAM_KNOBS = ("recovery_ms", "rival_recovery_ms", "rival_restart_ms", "any_survivor")
BACKEND_KNOBS = ("agent_latency_scale",)
CHAOS_KNOBS = ("crash_jitter_pct",)
KNOBS = (*PARAM_KNOBS, *BACKEND_KNOBS, *CHAOS_KNOBS)

Knobs = tuple[tuple[str, int | float], ...]  # sorted by name; empty: the defaults


def _number(value: float) -> str:
    return str(value) if isinstance(value, int) else f"{value:g}"


def knob_label(name: str, value: float) -> str:
    return f"{name}-{_number(value)}"


def knobs_text(knobs: Knobs) -> str | None:
    """``recovery_ms=500;agent_latency_scale=0.5``: a row's knobs column; None without knobs."""
    if not knobs:
        return None
    return ";".join(f"{name}={_number(value)}" for name, value in knobs)


@dataclass(frozen=True)
class Cell:
    workflow: str
    task: str
    profile: ChaosProfile
    seed: str
    agents: int | None = None  # total agents of a scaling-sweep cell; None: the workflow's own
    knobs: Knobs = ()  # sweep settings; empty: every assumption at its default

    @property
    def id(self) -> str:
        base = f"{self.workflow}__{self.task}__{self.profile.name}__s{self.seed}"
        for name, value in self.knobs:
            base += f"__{knob_label(name, value)}"
        return base if self.agents is None else f"{base}__n{self.agents}"

    def knob(self, name: str) -> int | float | None:
        return dict(self.knobs).get(name)


@dataclass(frozen=True)
class CellContext:
    """Everything a workflow needs to record one cell's run."""

    cell: Cell
    run_dir: Path
    backend: Backend
    clock: str  # sim (fake LLM) | live (real API)
    contributor: bool  # the matrix opted in to Contributor routing (spec §7.5)
    contributor_wonder: str = "standard"  # standard | spark (Wonder has no Contributor)
    project_ledger: ProjectLedger | None = None
    secrets: list[str] = field(default_factory=list)
    run_cap_usd: float | None = None


class Workflow(Protocol):
    name: str
    # Task names this workflow can run; None means any.
    tasks: frozenset[str] | None

    async def run(self, ctx: CellContext) -> None:
        """Record the cell's run into ``ctx.run_dir`` (events.jsonl at least)."""
        ...

    def preflight(self, cell: Cell, contributor: bool) -> list[dict[str, Any]]:
        """Worst-case LLM requests (``LLMRequest`` dicts) of one run, chaos rework included."""
        ...


@dataclass(frozen=True)
class TaskDef:
    name: str
    checker: Checker = default_checker
    description: str = ""
    # Most agent contracts the task can have in flight at once, when it bounds that (the
    # scaling chart marks it: agents beyond it have nothing to do).
    parallelism: int | None = None


WORKFLOWS: dict[str, Workflow] = {}
TASKS: dict[str, TaskDef] = {}


def register_workflow(workflow: Workflow) -> None:
    WORKFLOWS[workflow.name] = workflow


def register_task(task: TaskDef) -> None:
    TASKS[task.name] = task


def get_workflow(name: str) -> Workflow | None:
    _load_builtins()
    return WORKFLOWS.get(name)


def get_task(name: str) -> TaskDef | None:
    _load_builtins()
    return TASKS.get(name)


def scales_with_agents(workflow: Workflow) -> bool:
    """Whether the workflow honors ``Cell.agents`` (a ``scalable = True`` class attribute)."""
    return bool(getattr(workflow, "scalable", False))


# Modules that register workflows and tasks when imported. Later days add theirs here.
BUILTIN_MODULES: list[str] = ["fractalswarm.bench.toy_workflow", "fractalswarm.bench.workflows"]
_loaded: set[str] = set()


def _load_builtins() -> None:
    import importlib

    for module in BUILTIN_MODULES:
        if module not in _loaded:
            _loaded.add(module)
            try:
                importlib.import_module(module)
            except ModuleNotFoundError as exc:
                if exc.name != module:
                    raise
