"""Command-line interface: ``fractalswarm <command>``."""

from pathlib import Path
from typing import Annotated

import typer

from fractalswarm import __version__

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.callback()
def main() -> None:
    """FractalSwarm: a multi-agent LLM runtime whose orchestrators form a fractal tree."""


@app.command()
def version() -> None:
    """Print the FractalSwarm version."""
    typer.echo(__version__)


def _settings():
    from fractalswarm.config import Settings

    return Settings()


def _resolve_run_dir(run: str) -> Path:
    path = Path(run)
    if path.is_dir():
        return path
    candidate = _settings().runs_dir / run
    if candidate.is_dir():
        return candidate
    raise typer.BadParameter(f"no run directory {run!r} (looked in {candidate.parent})")


@app.command()
def toy(
    scenario: Annotated[str, typer.Option(help="toy | one-call")] = "toy",
    seed: str = "0",
    rounds: int = 2,
    clock: Annotated[str, typer.Option(help="sim | live")] = "sim",
    speed: Annotated[float, typer.Option(help="live clock speed-up")] = 1.0,
    backend: Annotated[str, typer.Option(help="fake | real")] = "fake",
    confirm_real_spend: Annotated[
        bool, typer.Option(help="required with --backend real: the call is billed")
    ] = False,
    run_id: Annotated[str | None, typer.Option(help="default: a timestamped id")] = None,
) -> None:
    """Record a toy kernel run (fake LLM by default) into runs/<run_id>."""
    import asyncio
    from datetime import datetime

    from fractalswarm.llm.fake import FakeBackend
    from fractalswarm.market.ledger import ProjectLedger
    from fractalswarm.runs import record_run

    settings = _settings()
    project_ledger = None
    if backend == "real":
        from fractalswarm.llm.client import OpenAIBackend

        if not confirm_real_spend:
            raise typer.BadParameter("a real call is billed: add --confirm-real-spend")
        if settings.model_api_key is None:
            raise typer.BadParameter("MODEL_API_KEY is not set in ~/.fractalswarm/.env")
        llm = OpenAIBackend(settings.model_api_key.get_secret_value(), settings.model_api_base_url)
        project_ledger = ProjectLedger(settings.ledger_path, settings.project_cap_usd)
    elif backend == "fake":
        llm = FakeBackend()
    else:
        raise typer.BadParameter("--backend must be fake or real")
    if clock not in ("sim", "live"):
        raise typer.BadParameter("--clock must be sim or live")

    run_id = run_id or f"{scenario}-{datetime.now():%Y%m%d-%H%M%S}"
    result = asyncio.run(
        record_run(
            scenario,
            run_id=run_id,
            run_dir=settings.runs_dir / run_id,
            backend=llm,
            seed=seed,
            params={"rounds": rounds} if scenario == "toy" else {},
            clock=clock,  # type: ignore[arg-type]
            speed=speed,
            project_ledger=project_ledger,
            secrets=settings.secret_values(),
        )
    )
    spent = result.completed.payload["spent_usd"]
    typer.echo(f"run {result.run_id}: {result.events} events, head {result.head_hash}")
    typer.echo(f"run dir {result.paths.root}  spent ${spent:.6f} ({backend} LLM)")


@app.command()
def replay(
    run: Annotated[str, typer.Argument(help="run id under runs/, or a run directory")],
    verify: Annotated[bool, typer.Option(help="re-run the actors and compare hashes")] = False,
) -> None:
    """Summarize a recorded run, or verify that it replays bit for bit."""
    import asyncio
    from collections import Counter

    from fractalswarm.runs import RunPaths, replay_run

    run_dir = _resolve_run_dir(run)
    if not verify:
        with RunPaths(run_dir).open_log() as log:
            chain = log.verify_chain()
            counts = Counter(event.type for event in log.read())
        typer.echo(f"{run_dir}: {chain.events} events, head {chain.head_hash or '-'}")
        typer.echo(f"hash chain: {'ok' if chain.ok else 'BROKEN: ' + chain.reason}")
        for event_type, count in sorted(counts.items()):
            typer.echo(f"  {event_type:<20} {count}")
        raise typer.Exit(0 if chain.ok else 1)

    report = asyncio.run(replay_run(run_dir))
    if report.ok:
        typer.echo(f"MATCH  {report.replayed_events} events, head {report.replayed_head}")
        return
    typer.echo(f"MISMATCH  hash chain {'ok' if report.chain_ok else 'BROKEN'}")
    typer.echo(f"recorded {report.recorded_events} events, head {report.recorded_head}")
    typer.echo(f"replayed {report.replayed_events} events, head {report.replayed_head}")
    typer.echo(f"first divergence at seq {report.first_divergence}:\n{report.detail}")
    raise typer.Exit(1)


@app.command()
def spend() -> None:
    """Show the project ledger: real spend against the project cap."""
    from rich.console import Console
    from rich.table import Table

    from fractalswarm.market.ledger import ProjectLedger

    settings = _settings()
    summary = ProjectLedger(settings.ledger_path, settings.project_cap_usd).summary()
    console = Console()
    console.print(f"ledger {settings.ledger_path}")
    console.print(
        f"spent ${summary.spent_usd:.4f}, reserved ${summary.reserved_usd:.4f}, "
        f"remaining ${summary.remaining_usd:.4f} of ${summary.cap_usd:.2f}"
    )
    for title, rows in (("by run", summary.by_run), ("by model", summary.by_model)):
        if not rows:
            continue
        table = Table(title=title)
        for column in ("key", "calls", "spent $", "reserved $"):
            table.add_column(column)
        for row in rows:
            table.add_row(
                row.key, str(row.calls), f"{row.actual_usd:.4f}", f"{row.reserved_usd:.4f}"
            )
        console.print(table)


@app.command()
def bench(
    matrix: Annotated[Path, typer.Argument(help="matrix YAML, e.g. bench/matrix.yaml")],
    dry_run: Annotated[
        bool, typer.Option(help="only print the cells and the worst-case cost pre-flight")
    ] = False,
    fake: Annotated[bool, typer.Option(help="fake LLM, sim clock, $0")] = False,
    out: Annotated[Path | None, typer.Option(help="results dir (default: the matrix's)")] = None,
    confirm_real_spend: Annotated[
        bool, typer.Option(help="required without --fake: every call is billed")
    ] = False,
) -> None:
    """Run a benchmark matrix (resumable) and write results.csv/json and the hero chart."""
    import asyncio

    from fractalswarm.bench.harness import HarnessOptions, Matrix, preflight, resolve_out_dir

    spec = Matrix.load(matrix)
    out_dir = resolve_out_dir(spec, matrix, out)
    plan = preflight(spec, out_dir)
    todo = [cell for cell in plan.cells if not cell.done]
    typer.echo(
        f"matrix {spec.name}: {len(plan.cells)} cells, {len(plan.cells) - len(todo)} done, "
        f"{len(todo)} to run; contributor {'ON (opted in)' if spec.contributor else 'off'}"
    )
    typer.echo(f"results dir {out_dir}")
    for cell in plan.cells:
        cost = "?" if cell.worst_case_usd is None else f"${cell.worst_case_usd:.4f}"
        state = "done" if cell.done else ("ready" if cell.registered else "NOT REGISTERED")
        typer.echo(f"  {cell.cell:<48} {state:<15} {cell.calls:>4} calls  <= {cost}  {cell.reason}")
    cap = "none" if plan.matrix_cap_usd is None else f"${plan.matrix_cap_usd:.2f}"
    typer.echo(f"worst case for the cells to run: ${plan.worst_case_usd:.4f} (matrix cap {cap})")
    if plan.unregistered:
        typer.echo(f"not registered yet: {', '.join(plan.unregistered)}")
    if dry_run:
        return
    if plan.unregistered:
        raise typer.BadParameter("the matrix names workflows or tasks that are not registered")

    settings = _settings()
    project_ledger = None
    if fake:
        from fractalswarm.llm.fake import FakeBackend

        backend_factory, clock = FakeBackend, "sim"
    else:
        from fractalswarm.llm.client import OpenAIBackend
        from fractalswarm.market.ledger import ProjectLedger

        if not confirm_real_spend:
            raise typer.BadParameter("real runs are billed: add --confirm-real-spend (or --fake)")
        if not plan.within_cap:
            raise typer.BadParameter("the pre-flight worst case exceeds the matrix cap")
        if settings.model_api_key is None:
            raise typer.BadParameter("MODEL_API_KEY is not set in ~/.fractalswarm/.env")
        project_ledger = ProjectLedger(settings.ledger_path, settings.project_cap_usd)
        if plan.worst_case_usd > project_ledger.remaining_usd():
            raise typer.BadParameter("the pre-flight worst case exceeds the project remainder")
        key, base_url = settings.model_api_key.get_secret_value(), settings.model_api_base_url

        def backend_factory():
            return OpenAIBackend(key, base_url)

        clock = "live"

    from fractalswarm.bench.harness import run_matrix

    options = HarnessOptions(
        backend_factory=backend_factory,
        clock=clock,
        project_ledger=project_ledger,
        secrets=settings.secret_values(),
        log=typer.echo,
    )
    report = asyncio.run(run_matrix(spec, out_dir, options))
    typer.echo(
        f"ran {len(report.ran)}, skipped {len(report.skipped)} (already done), "
        f"failed {len(report.failed)}"
    )
    for path in (report.csv_path, report.json_path, *report.chart_paths):
        typer.echo(f"  {path}")
    if report.failed:
        raise typer.Exit(1)
