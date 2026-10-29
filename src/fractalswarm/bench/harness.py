"""The bench harness (spec §15.6-§15.7): matrix -> runs -> metrics -> CSV/JSON -> charts.

A matrix is workflows × tasks × chaos profiles × seeds, and optionally × total agents (the
scaling sweep, ``bench/scaling.py``) and × sweep settings (``knobs``: the recovery and restart
times of the arena's sensitivity sweeps, the agents' latency scale). Each cell records one run
into ``<out>/runs/<cell>/`` and writes its metrics to ``<out>/cells/<cell>.json`` once the run
is scored; a cell with a result file is skipped next time, so an interrupted matrix resumes
where it stopped. A run directory without a result file is a run that died half-way: it is
wiped and recorded again.

After the cells, the harness pairs every row with the C0 row of the same workflow, task, seed,
agents and knobs (extra cost and time lost vs C0) and writes ``results.csv``, ``results.json``
and the hero chart, or the scaling chart when the matrix has an ``agents`` axis, plus the
recovery chart when any run logged a crash. ``rescore`` recomputes the metrics of the cells
already on disk from their logs, at $0.
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
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, field_validator

from fractalswarm.bench.profiles import profile
from fractalswarm.bench.registry import (
    BACKEND_KNOBS,
    KNOBS,
    Cell,
    CellContext,
    Knobs,
    get_task,
    get_workflow,
    knobs_text,
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
    "knobs",
    # The recovery metrics (``bench/recovery.py``): the means are over the run's crashes, and a
    # blank is a run that had none (or a result scored before the arena, until it is rescored).
    "crashes",
    "ttr_own_mean_s",
    "ttr_drain_mean_s",
    "cdt_s",
    "blocked_total_s",
    "blast_sessions_mean_pct",
    "blast_agents_mean_pct",
    "exposure_peak_pct",
    "idle_agent_s",
    "idle_agent_own_s",
    "idle_agent_wide_s",
    "false_death_remaps",
    "unnecessary_reassignments",
    "dup_calls",
    "dup_usd",
    "dup_crash_usd",
    "dup_agent_kill_usd",
    "dup_false_death_usd",
    "preserved_pct",
    "run_dir",
)
RECOVERY_COLUMNS = RESULT_COLUMNS[RESULT_COLUMNS.index("crashes") : RESULT_COLUMNS.index("run_dir")]


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
    # Sweep settings, one dict per point (``registry.KNOBS``); each point is crossed with the
    # rest of the matrix. Omitted: every assumption at its default.
    knobs: list[dict[str, StrictInt | StrictFloat]] | None = None
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

    @field_validator("knobs")
    @classmethod
    def _knob_points(cls, value: list[dict[str, StrictInt | StrictFloat]] | None):
        if value is None:
            return None
        points = [tuple(sorted(point.items())) for point in value]
        if not points or len(set(points)) != len(points):
            raise ValueError("knobs needs distinct points")
        for point in value:
            for name, setting in point.items():
                if name not in KNOBS:
                    raise ValueError(f"unknown knob {name!r} (known: {', '.join(KNOBS)})")
                if setting < 0:
                    raise ValueError(f"knob {name} needs a number >= 0, got {setting!r}")
                if name in BACKEND_KNOBS and setting <= 0:
                    raise ValueError(f"knob {name} needs a number > 0, got {setting!r}")
                if name not in BACKEND_KNOBS and int(setting) != setting:
                    raise ValueError(f"knob {name} is in whole milliseconds, got {setting!r}")
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
        points: list[Knobs] = [tuple(sorted(point.items())) for point in self.knobs or [{}]]
        return [
            Cell(workflow, task, profile(name), seed, agents, knobs)
            for workflow, task, name, agents, knobs, seed in product(
                self.workflows, self.tasks, self.profiles, self.agents or [None], points, self.seeds
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
    knobs: dict[str, int | float] = {}  # absent in results written before the knobs axis

    @property
    def knob_items(self) -> Knobs:
        return tuple(sorted(self.knobs.items()))


@dataclass
class HarnessOptions:
    backend_factory: Callable[[], Backend]
    clock: str = "sim"
    project_ledger: ProjectLedger | None = None
    secrets: list[str] | None = None
    log: Callable[[str], None] = lambda message: None
    # The backend of one cell, for the knobs that change it (``registry.BACKEND_KNOBS``); the
    # zero-argument ``backend_factory`` serves every other cell.
    cell_backend: Callable[[Cell], Backend] | None = None


def _ignoring_cell(factory: Callable[[], Backend]) -> Callable[[Cell], Backend]:
    return lambda cell: factory()


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
    if options.cell_backend is None and any(
        name in BACKEND_KNOBS for point in matrix.knobs or [] for name in point
    ):
        raise ValueError("the matrix sweeps a backend knob: HarnessOptions needs a cell_backend")
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
            backend=(options.cell_backend or _ignoring_cell(options.backend_factory))(cell),
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
            knobs=dict(cell.knobs),
        )
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        ran.append(cell.id)

    rows = aggregate(load_results(out_dir, matrix))
    csv_path, json_path = write_results(rows, out_dir)
    chart_paths = draw_charts(matrix, rows, out_dir) if charts and rows else []
    return MatrixReport(
        ran=ran,
        skipped=skipped,
        failed=failed,
        rows=rows,
        csv_path=str(csv_path),
        json_path=str(json_path),
        chart_paths=chart_paths,
    )


def draw_charts(matrix: Matrix, rows: list[dict[str, Any]], out_dir: Path) -> list[str]:
    """The hero chart (the scaling chart for an agents axis; neither for a knobs axis, which the
    hero chart would average over), and the recovery chart when any run logged a crash: against
    the coordinators killed, or against each sweep axis at the matrix's most chaotic profile."""
    from fractalswarm.bench.charts import CHAOS_AXIS, hero_chart, recovery_chart, scaling_chart

    task = matrix.chart_task or matrix.tasks[0]
    knobs = sorted({name for point in matrix.knobs or [] for name in point})
    drawn: list[Path] = []
    if matrix.agents:
        task_def = get_task(task)
        limit = task_def.parallelism if task_def else None
        drawn += scaling_chart(
            rows, out_dir / f"scaling-{task}", task=task, title=matrix.name, limit=limit
        )
    elif not knobs:
        drawn += hero_chart(rows, out_dir / f"hero-{task}", task=task, title=matrix.name)
    if any(row.get("crashes") for row in rows):
        top = max((cell.profile for cell in matrix.cells()), key=lambda p: p.coordinator_crashes)
        for axis in knobs or ["agents" if matrix.agents else CHAOS_AXIS]:
            suffix = "" if axis == CHAOS_AXIS else f"-{axis}"
            drawn += recovery_chart(
                rows,
                out_dir / f"recovery-{task}{suffix}",
                task=task,
                title=matrix.name,
                axis=axis,
                profile=top.name,
            )
    return [str(path) for path in drawn]


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
    workflow, task, seed, agents and knobs). Rows of the agents axis carry an ``agents`` column."""
    c0 = {
        (r.workflow, r.task, r.seed, r.agents, r.knob_items): r.metrics
        for r in results
        if r.profile == "C0"
    }
    rows = []
    ordered = sorted(
        results,
        key=lambda r: (
            r.workflow,
            r.task,
            r.profile,
            r.agents or 0,
            knobs_text(r.knob_items) or "",
            r.seed,
        ),
    )
    for r in ordered:
        m, ref = r.metrics, c0.get((r.workflow, r.task, r.seed, r.agents, r.knob_items))
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
            "knobs": knobs_text(r.knob_items),
            **{
                column: getattr(m.recovery, column) if m.recovery else None
                for column in RECOVERY_COLUMNS
            },
            "run_dir": r.run_dir,
        }
        if r.agents is not None:
            row["agents"] = r.agents
        rows.append(row)
    return rows


class RescoreReport(BaseModel):
    rescored: list[str]
    missing: list[str]  # no log to score: the cell's run directory is gone
    failed: dict[str, str]
    changed: dict[str, list[str]]  # cells whose pre-arena numbers moved, with the metrics
    csv_path: str
    json_path: str


# The numbers every earlier result carries: a rescore that moves one is worth reporting.
RESCORE_WATCH = ("stall_s", "makespan_s", "cost_usd", "coordination_tokens", "llm_calls")


def rescore(out_dir: Path, log: Callable[[str], None] = lambda message: None) -> RescoreReport:
    """Recompute the metrics of the cells on disk from their recorded logs, at $0: nothing is
    run. It rewrites the cell results, ``results.csv`` and ``results.json``. A cell whose run
    directory is gone keeps its old metrics (and, if it has none, blank recovery columns)."""
    rescored: list[str] = []
    missing: list[str] = []
    failed: dict[str, str] = {}
    changed: dict[str, list[str]] = {}
    for path in sorted((out_dir / "cells").glob("*.json")):
        result = CellResult.model_validate_json(path.read_text(encoding="utf-8"))
        run_dir = out_dir / result.run_dir
        if not (run_dir / "events.jsonl").exists() and not (run_dir / "events.sqlite").exists():
            missing.append(result.cell)
            continue
        task = get_task(result.task)
        if task is None:
            failed[result.cell] = f"task {result.task} is not registered"
            continue
        log(f"rescore {result.cell}")
        try:
            metrics = score_run(run_dir, task.checker)
        except Exception as exc:  # one broken cell must not sink the rest
            failed[result.cell] = f"{type(exc).__name__}: {exc}"
            continue
        moved = [
            name
            for name in RESCORE_WATCH
            if abs(getattr(metrics, name) - getattr(result.metrics, name)) > 1e-6
        ]
        if moved:
            changed[result.cell] = moved
        result = result.model_copy(update={"metrics": metrics})
        path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        rescored.append(result.cell)
    csv_path, json_path = write_results(aggregate(load_results(out_dir)), out_dir)
    return RescoreReport(
        rescored=rescored,
        missing=missing,
        failed=failed,
        changed=changed,
        csv_path=str(csv_path),
        json_path=str(json_path),
    )


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


_RECOVERY_INTS = {"crashes", "false_death_remaps", "unnecessary_reassignments", "dup_calls"}
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
    *_RECOVERY_INTS,
}
_FLOATS = {
    "score",
    "stall_s",
    "makespan_s",
    "cost_usd",
    "extra_cost_pct",
    "time_lost_s",
    *(column for column in RECOVERY_COLUMNS if column not in _RECOVERY_INTS),
}
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
