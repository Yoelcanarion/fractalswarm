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


@dataclass(frozen=True)
class Cell:
    workflow: str
    task: str
    profile: ChaosProfile
    seed: str
    agents: int | None = None  # total agents of a scaling-sweep cell; None: the workflow's own

    @property
    def id(self) -> str:
        base = f"{self.workflow}__{self.task}__{self.profile.name}__s{self.seed}"
        return base if self.agents is None else f"{base}__n{self.agents}"


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
