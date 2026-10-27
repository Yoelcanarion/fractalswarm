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


def _serve(runs_dir: Path, host: str, port: int, open_run: str | None, browser: bool) -> None:
    import threading
    import webbrowser

    import uvicorn

    from fractalswarm.api.app import create_app

    url = f"http://{host}:{port}/" + (f"#/run/{open_run}" if open_run else "")
    typer.echo(f"FractalSwarm UI on {url}  (Ctrl+C to stop)")
    if browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    uvicorn.run(create_app(runs_dir), host=host, port=port, log_level="warning")


@app.command()
def serve(
    host: str = "127.0.0.1",
    port: int = 8765,
    run: Annotated[str | None, typer.Option(help="run id to open in the UI")] = None,
    browser: Annotated[bool, typer.Option(help="open the UI in a browser")] = False,
) -> None:
    """Serve the API and the web UI (your runs under runs/, bundled runs under demo/)."""
    _serve(_settings().runs_dir, host, port, run, browser)


def _demo_bundle(bundle: str | None) -> Path:
    from fractalswarm.api.app import DEMO_DIR

    names = [bundle] if bundle else ["backup", "toy"]
    for name in names:
        path = DEMO_DIR / name
        if (path / "events.jsonl").exists() or (path / "events.sqlite").exists():
            return path
    raise typer.BadParameter(f"no demo bundle {' or '.join(names)} in {DEMO_DIR}")


@app.command()
def demo(
    verify: Annotated[bool, typer.Option(help="first replay the bundled run, check its hash")] = (
        False
    ),
    bundle: Annotated[str | None, typer.Option(help="bundle under demo/")] = None,
    serve_ui: Annotated[bool, typer.Option("--serve/--no-serve", help="serve the UI")] = True,
    host: str = "127.0.0.1",
    port: int = 8765,
    browser: Annotated[bool, typer.Option(help="open the UI in a browser")] = True,
) -> None:
    """Replay the bundled real run in the UI: no API key and no Node needed."""
    import asyncio

    from fractalswarm.api.catalog import DEMO_PREFIX
    from fractalswarm.runs import replay_run

    path = _demo_bundle(bundle)
    if verify:
        report = asyncio.run(replay_run(path))
        head_file = path / "HEAD"
        expected = head_file.read_text(encoding="utf-8").strip() if head_file.exists() else None
        if report.ok and expected in (None, report.replayed_head):
            typer.echo(
                f"MATCH  {path.name}: {report.replayed_events} events, head {report.replayed_head}"
            )
        else:
            typer.echo(f"MISMATCH  {path.name}: first divergence at seq {report.first_divergence}")
            typer.echo(report.detail)
            typer.echo(
                f"recorded head {report.recorded_head}, HEAD file {expected}, "
                f"replayed {report.replayed_head}"
            )
            raise typer.Exit(1)
    if serve_ui:
        _serve(_settings().runs_dir, host, port, DEMO_PREFIX + path.name, browser)
