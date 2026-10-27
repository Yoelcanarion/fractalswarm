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


audit_app = typer.Typer(no_args_is_help=True, help="Check the audit trail of a run.")
app.add_typer(audit_app, name="audit")


@audit_app.command("verify")
def audit_verify(
    run: Annotated[str, typer.Argument(help="run id under runs/, or a run directory")],
    replay: Annotated[bool, typer.Option(help="also replay the run and compare hashes")] = False,
) -> None:
    """Check the hash chain, the security decisions and the kill switch of a run."""
    import asyncio

    from fractalswarm.verify.audit import audit_run

    run_dir = _resolve_run_dir(run)
    report = asyncio.run(audit_run(run_dir, with_replay=replay))
    chain = report.chain
    typer.echo(f"{run_dir}: {chain.events} events, head {chain.head_hash or '-'}")
    typer.echo(f"hash chain: {'ok' if chain.ok else 'BROKEN'}")
    if report.head_file_ok is not None:
        typer.echo(f"HEAD file: {'match' if report.head_file_ok else 'MISMATCH'}")
    if report.replay_ok is not None:
        typer.echo(f"replay: {'MATCH' if report.replay_ok else 'MISMATCH'}")
    for entry in report.entries:
        typer.echo(f"  seq {entry.seq:>5}  {entry.type:<22} {entry.summary}")
    for problem in report.problems:
        typer.echo(f"PROBLEM {problem}")
    typer.echo("AUDIT OK" if report.ok else "AUDIT FAILED")
    raise typer.Exit(0 if report.ok else 1)


def _control(run: str, request: dict) -> None:
    from fractalswarm.runs import RunPaths

    run_dir = _resolve_run_dir(run)
    paths = RunPaths(run_dir)
    if paths.events_jsonl.exists():
        typer.echo(f"run {run_dir.name} has already finished; nothing to do")
        raise typer.Exit(1)
    path = paths.request_control(request)
    typer.echo(f"requested {request['op']} for {run_dir.name} ({path.name})")


@app.command()
def halt(
    run: Annotated[str, typer.Argument(help="run id under runs/, or a run directory")],
    reason: Annotated[str, typer.Option(help="recorded in the run.halted event")] = "kill switch",
) -> None:
    """Kill switch: ask a running run to halt. It records run.halted and stops everything."""
    _control(run, {"op": "halt", "reason": reason, "by": "human"})


@app.command()
def budget(
    run: Annotated[str, typer.Argument(help="run id under runs/, or a run directory")],
    usd: Annotated[float, typer.Option(help="the new cap in USD")],
    level: Annotated[str, typer.Option(help="contract | squad | run | project")] = "run",
    key: Annotated[str | None, typer.Option(help="scope key; default: the run id")] = None,
    reason: str = "budget shock",
) -> None:
    """Budget shock: change a cap of a running run (records budget.shock)."""
    if usd < 0:
        raise typer.BadParameter("--usd must be >= 0")
    if level not in ("contract", "squad", "run", "project"):
        raise typer.BadParameter("--level must be contract, squad, run or project")
    _control(run, {"op": "budget", "level": level, "key": key, "usd": usd, "reason": reason})
