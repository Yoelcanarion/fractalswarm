"""The bench harness (spec §15.6-§15.7): matrix -> runs -> metrics -> CSV/JSON -> charts.

A matrix is workflows × tasks × chaos profiles × seeds, and optionally × total agents (the
scaling sweep, ``bench/scaling.py``). Each cell records one run into ``<out>/runs/<cell>/``
and writes its metrics to ``<out>/cells/<cell>.json`` once the run is scored; a cell with a
result file is skipped next time, so an interrupted matrix resumes where it stopped. A run
directory without a result file is a run that died half-way: it is wiped and recorded again.

After the cells, the harness pairs every row with the C0 row of the same workflow, task, seed
and agents (extra cost and time lost vs C0) and writes ``results.csv``, ``results.json`` and
the hero chart, or the scaling chart when the matrix has an ``agents`` axis.
"""

import csv
import json
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from itertools import product
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from fractalswarm.bench.profiles import profile
from fractalswarm.bench.registry import (
    Cell,
    CellContext,
    get_task,
    get_workflow,
    scales_with_agents,
)
from fractalswarm.bench.scoring import RunMetrics, extra_cost_pct, score_run, time_lost_s
from fractalswarm.llm.client import Backend, LLMClient
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.ledger import ProjectLedger
from fractalswarm.market.prices import PriceTable

RESULT_COLUMNS = (
    "cell",
    "workflow",
    "task",
    "profile",
    "coordinators_killed",
    "seed",
    "completed",
    "valid",
    "score",
    "stall_s",
    "makespan_s",
    "cost_usd",
    "extra_cost_pct",
    "time_lost_s",
    "coordination_tokens",
    "total_tokens",
    "llm_calls",
    "cancelled_llm_calls",
    "llm_errors",
    "messages",
    "breaker_trips",
    "chaos_events",
    "run_dir",
)


class MatrixBudget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_cap_usd: float | None = Field(default=None, gt=0)
    matrix_cap_usd: float | None = Field(default=None, gt=0)


class Matrix(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    workflows: list[str]
    tasks: list[str]
    profiles: list[str] = ["C0", "C1", "C2", "C3"]
    seeds: list[str]
    # Total agents of each run (the scaling sweep); omitted: every workflow runs its own tree.
    agents: list[int] | None = None
    # Contributor routing for the matrix's calls: synthetic tasks only, explicit opt-in (§7.5).
    contributor: bool = False
    # Wonder has no Contributor variant: its roles stay on Standard Wonder, or move to Spark.
    contributor_wonder: Literal["standard", "spark"] = "standard"
    out_dir: str
    budget: MatrixBudget = MatrixBudget()
    chart_task: str | None = None  # task drawn in the hero or scaling chart (default: the first)
    notes: str = ""

    @field_validator("agents")
    @classmethod
    def _agent_totals(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and (not value or len(set(value)) != len(value) or min(value) < 1):
            raise ValueError("agents needs distinct totals, each >= 1")
        return value

    @classmethod
    def load(cls, path: Path) -> "Matrix":
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["seeds"] = [str(seed) for seed in data.get("seeds", [])]
        matrix = cls.model_validate(data)
        for name in matrix.profiles:
            profile(name)
        if "C0" not in matrix.profiles:
            raise ValueError("a matrix needs the C0 profile: extra cost is measured against it")
        return matrix

    def cells(self) -> list[Cell]:
        return [
            Cell(workflow, task, profile(name), seed, agents)
            for workflow, task, name, agents, seed in product(
                self.workflows, self.tasks, self.profiles, self.agents or [None], self.seeds
            )
        ]


def resolve_out_dir(matrix: Matrix, matrix_path: Path, override: Path | None = None) -> Path:
    if override is not None:
        return override
    out = Path(matrix.out_dir)
    return out if out.is_absolute() else (matrix_path.parent / out).resolve()


# -- pre-flight ------------------------------------------------------------------------------


class CellEstimate(BaseModel):
    cell: str
    registered: bool
    calls: int = 0
    worst_case_usd: float | None = None
    done: bool = False
    reason: str = ""


class Preflight(BaseModel):
    matrix: str
    cells: list[CellEstimate]
    contributor: bool
    worst_case_usd: float  # over the cells still to run, registered ones only
    unregistered: list[str]
    matrix_cap_usd: float | None

    @property
    def within_cap(self) -> bool:
        return self.matrix_cap_usd is None or self.worst_case_usd <= self.matrix_cap_usd


class _NoBackend:
    async def send(self, *args: Any, **kwargs: Any):  # pragma: no cover - never called
        raise RuntimeError("the pre-flight never calls the LLM")


def preflight(
    matrix: Matrix,
    out_dir: Path,
    roles: RoleTable | None = None,
    prices: PriceTable | None = None,
) -> Preflight:
    """Worst-case cost of the cells still to run, with ``market/prices.py`` estimates."""
    roles = roles or RoleTable.load()
    if matrix.contributor:
        roles = roles.contributor_mode(matrix.contributor_wonder == "spark")
    client = LLMClient(
        _NoBackend(),
        roles=roles,
        prices=prices or PriceTable.load(),
        mode="live",
    )
    estimates: list[CellEstimate] = []
    unregistered: set[str] = set()
    for cell in matrix.cells():
        done = _result_path(out_dir, cell).exists()
        workflow, task = get_workflow(cell.workflow), get_task(cell.task)
        missing = [
            f"workflow {cell.workflow}" if workflow is None else "",
            f"task {cell.task}" if task is None else "",
        ]
        missing = [item for item in missing if item]
        if workflow is not None and workflow.tasks is not None and cell.task not in workflow.tasks:
            missing.append(f"{cell.workflow} does not run {cell.task}")
        if cell.agents is not None and workflow is not None and not scales_with_agents(workflow):
            missing.append(f"{cell.workflow} does not scale with agents")
        if missing:
            unregistered.update(missing)
            estimates.append(
                CellEstimate(cell=cell.id, registered=False, done=done, reason="; ".join(missing))
            )
            continue
        assert workflow is not None
        requests = workflow.preflight(cell, matrix.contributor)
        usd = sum(client.estimate(request) for request in requests)
        if matrix.budget.run_cap_usd is not None:  # the kernel refuses the call that crosses it
            usd = min(usd, matrix.budget.run_cap_usd)
        estimates.append(
            CellEstimate(
                cell=cell.id, registered=True, calls=len(requests), worst_case_usd=usd, done=done
            )
        )
    total = sum(e.worst_case_usd or 0.0 for e in estimates if not e.done)
    return Preflight(
        matrix=matrix.name,
        cells=estimates,
        contributor=matrix.contributor,
        worst_case_usd=total,
        unregistered=sorted(unregistered),
        matrix_cap_usd=matrix.budget.matrix_cap_usd,
    )


# -- running ---------------------------------------------------------------------------------


def _result_path(out_dir: Path, cell: Cell) -> Path:
    return out_dir / "cells" / f"{cell.id}.json"


def _run_dir(out_dir: Path, cell: Cell) -> Path:
    return out_dir / "runs" / cell.id


class CellResult(BaseModel):
    cell: str
    workflow: str
    task: str
    profile: str
    coordinators_killed: int
    seed: str
    run_dir: str
    metrics: RunMetrics
    agents: int | None = None  # absent in results written before the agents axis


@dataclass
class HarnessOptions:
    backend_factory: Callable[[], Backend]
    clock: str = "sim"
    project_ledger: ProjectLedger | None = None
    secrets: list[str] | None = None
    log: Callable[[str], None] = lambda message: None


class MatrixReport(BaseModel):
    ran: list[str]
    skipped: list[str]
    failed: dict[str, str]
    rows: list[dict[str, Any]]
    csv_path: str
    json_path: str
    chart_paths: list[str] = []


async def run_matrix(
    matrix: Matrix, out_dir: Path, options: HarnessOptions, *, charts: bool = True
) -> MatrixReport:
    problems = preflight(matrix, out_dir).unregistered
    if problems:
        raise ValueError(f"cannot run the matrix: {', '.join(problems)}")
    out_dir.mkdir(parents=True, exist_ok=True)
    ran, skipped, failed = [], [], {}
    for cell in matrix.cells():
        result_path = _result_path(out_dir, cell)
        if result_path.exists():
            skipped.append(cell.id)
            continue
        run_dir = _run_dir(out_dir, cell)
        if run_dir.exists():
            shutil.rmtree(run_dir)  # a run that died before it was scored
        workflow, task = get_workflow(cell.workflow), get_task(cell.task)
        assert workflow is not None and task is not None
        options.log(f"run {cell.id}")
        ctx = CellContext(
            cell=cell,
            run_dir=run_dir,
            backend=options.backend_factory(),
            clock=options.clock,
            contributor=matrix.contributor,
            contributor_wonder=matrix.contributor_wonder,
            project_ledger=options.project_ledger,
            secrets=list(options.secrets or []),
            run_cap_usd=matrix.budget.run_cap_usd,
        )
        try:
            await workflow.run(ctx)
            metrics = score_run(run_dir, task.checker)
        except Exception as exc:  # one broken cell must not sink the matrix
            failed[cell.id] = f"{type(exc).__name__}: {exc}"
            options.log(f"FAILED {cell.id}: {failed[cell.id]}")
            continue
        result = CellResult(
            cell=cell.id,
            workflow=cell.workflow,
            task=cell.task,
            profile=cell.profile.name,
            coordinators_killed=cell.profile.coordinator_crashes,
            seed=cell.seed,
            run_dir=run_dir.relative_to(out_dir).as_posix(),
            metrics=metrics,
            agents=cell.agents,
        )
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        ran.append(cell.id)

    rows = aggregate(load_results(out_dir, matrix))
    csv_path, json_path = write_results(rows, out_dir)
    chart_paths: list[str] = []
    if charts and rows:
        from fractalswarm.bench.charts import hero_chart, scaling_chart

        task = matrix.chart_task or matrix.tasks[0]
        if matrix.agents:
            task_def = get_task(task)
            limit = task_def.parallelism if task_def else None
            base = out_dir / f"scaling-{task}"
            png, js = scaling_chart(rows, base, task=task, title=matrix.name, limit=limit)
        else:
            png, js = hero_chart(rows, out_dir / f"hero-{task}", task=task, title=matrix.name)
        chart_paths = [str(png), str(js)]
    return MatrixReport(
        ran=ran,
        skipped=skipped,
        failed=failed,
        rows=rows,
        csv_path=str(csv_path),
        json_path=str(json_path),
        chart_paths=chart_paths,
    )


def load_results(out_dir: Path, matrix: Matrix | None = None) -> list[CellResult]:
    """The cell results on disk, restricted to the matrix's cells when one is given."""
    wanted = {cell.id for cell in matrix.cells()} if matrix else None
    results = []
    for path in sorted((out_dir / "cells").glob("*.json")):
        result = CellResult.model_validate_json(path.read_text(encoding="utf-8"))
        if wanted is None or result.cell in wanted:
            results.append(result)
    return results


def aggregate(results: list[CellResult]) -> list[dict[str, Any]]:
    """One flat row per cell, with extra cost and time lost against its C0 twin (the same
    workflow, task, seed and agents). Rows of the agents axis carry an ``agents`` column."""
    c0 = {(r.workflow, r.task, r.seed, r.agents): r.metrics for r in results if r.profile == "C0"}
    rows = []
    ordered = sorted(results, key=lambda r: (r.workflow, r.task, r.profile, r.agents or 0, r.seed))
    for r in ordered:
        m, ref = r.metrics, c0.get((r.workflow, r.task, r.seed, r.agents))
        row = {
            "cell": r.cell,
            "workflow": r.workflow,
            "task": r.task,
            "profile": r.profile,
            "coordinators_killed": r.coordinators_killed,
            "seed": r.seed,
            "completed": m.completed,
            "valid": m.valid,
            "score": m.score,
            "stall_s": m.stall_s,
            "makespan_s": m.makespan_s,
            "cost_usd": m.cost_usd,
            "extra_cost_pct": extra_cost_pct(m.cost_usd, ref.cost_usd) if ref else None,
            "time_lost_s": time_lost_s(m.makespan_s, ref.makespan_s) if ref else None,
            "coordination_tokens": m.coordination_tokens,
            "total_tokens": m.total_tokens,
            "llm_calls": m.llm_calls,
            "cancelled_llm_calls": m.cancelled_llm_calls,
            "llm_errors": m.llm_errors,
            "messages": m.messages,
            "breaker_trips": m.breaker_trips,
            "chaos_events": m.chaos_events,
            "run_dir": r.run_dir,
        }
        if r.agents is not None:
            row["agents"] = r.agents
        rows.append(row)
    return rows


def result_columns(rows: list[dict[str, Any]]) -> tuple[str, ...]:
    """The CSV columns: ``RESULT_COLUMNS``, plus ``agents`` after ``seed`` for the agents axis."""
    if not any("agents" in row for row in rows):
        return RESULT_COLUMNS
    at = RESULT_COLUMNS.index("seed") + 1
    return (*RESULT_COLUMNS[:at], "agents", *RESULT_COLUMNS[at:])


def write_results(rows: list[dict[str, Any]], out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path, json_path = out_dir / "results.csv", out_dir / "results.json"
    columns = result_columns(rows)
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "" if row.get(key) is None else row[key] for key in columns})
    json_path.write_text(json.dumps(rows, indent=2, sort_keys=True), encoding="utf-8")
    return csv_path, json_path


def read_results(path: Path) -> list[dict[str, Any]]:
    """Rows from ``results.json`` or ``results.csv`` (types restored for the CSV)."""
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    with path.open(encoding="utf-8", newline="") as handle:
        return [_typed(row) for row in csv.DictReader(handle)]


_INTS = {
    "coordinators_killed",
    "agents",
    "coordination_tokens",
    "total_tokens",
    "llm_calls",
    "cancelled_llm_calls",
    "llm_errors",
    "messages",
    "breaker_trips",
    "chaos_events",
}
_FLOATS = {"score", "stall_s", "makespan_s", "cost_usd", "extra_cost_pct", "time_lost_s"}
_BOOLS = {"completed", "valid"}


def _typed(row: dict[str, str]) -> dict[str, Any]:
    typed: dict[str, Any] = {}
    for key, value in row.items():
        if value == "":
            typed[key] = None
        elif key in _INTS:
            typed[key] = int(value)
        elif key in _FLOATS:
            typed[key] = float(value)
        elif key in _BOOLS:
            typed[key] = value == "True"
        else:
            typed[key] = value
    return typed
