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
    scenario: Annotated[str, typer.Option(help="toy | one-call | chaos-toy")] = "toy",
    seed: str = "0",
    rounds: int = 2,
    chaos: Annotated[str, typer.Option(help="chaos-toy: profile C0-C3")] = "C2",
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

    params: dict = {"rounds": rounds} if scenario == "toy" else {}
    if scenario == "chaos-toy":
        from fractalswarm.actors.chaos_toy import plan_from
        from fractalswarm.llm.transport import ApiFaults, FaultyBackend

        params = {"chaos": {"profile": chaos, "seed": seed}}
        llm = FaultyBackend(llm, ApiFaults(seed=seed, rate=plan_from(params).api_fault_rate))

    run_id = run_id or f"{scenario}-{datetime.now():%Y%m%d-%H%M%S}"
    result = asyncio.run(
        record_run(
            scenario,
            run_id=run_id,
            run_dir=settings.runs_dir / run_id,
            backend=llm,
            seed=seed,
            params=params,
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
def run(
    taskspec: Annotated[Path, typer.Argument(help="a TaskSpec YAML, e.g. tasks/examples/...")],
    clock: Annotated[str, typer.Option(help="sim | live")] = "sim",
    speed: Annotated[float, typer.Option(help="live clock speed-up")] = 1.0,
    backend: Annotated[str, typer.Option(help="fake | real")] = "fake",
    confirm_real_spend: Annotated[
        bool, typer.Option(help="required with --backend real: the calls are billed")
    ] = False,
    run_id: Annotated[str | None, typer.Option(help="default: a timestamped id")] = None,
    scenario: Annotated[
        str,
        typer.Option(
            help="swarm | central | single | pipeline | durable-max | durable "
            "(all but the swarm: baselines) | ablation (a T2 TaskSpec's notes through the "
            "regex parser and through Muse; no orchestrators)"
        ),
    ] = "swarm",
    chaos: Annotated[
        str, typer.Option(help="C0-C3, or kill-half: the root, two track leads, two sessions")
    ] = "C0",
    firewall: Annotated[
        str | None,
        typer.Option(
            help="auto (PromptGuard 2 when installed) | heuristic; default: auto with the "
            "real backend, heuristic with the fake one"
        ),
    ] = None,
    budget_usd: Annotated[
        float | None, typer.Option(help="the run cap in USD; default: the TaskSpec's budget_usd")
    ] = None,
    no_paid_retries: Annotated[
        bool,
        typer.Option(
            help="retry only the rejections the API does not bill (429, 503), never a request "
            "that may have run (no reply, 500)"
        ),
    ] = False,
    cross_audit: Annotated[
        bool, typer.Option(help="a sibling audits sampled contracts (spec §11.3); swarm only")
    ] = False,
    feasibility_report: Annotated[
        bool, typer.Option(help="record the feasibility report at plan approval (spec §12)")
    ] = False,
) -> None:
    """Run a task (fake LLM by default) into runs/<run_id>."""
    import asyncio
    from datetime import datetime

    from fractalswarm.comms.chaos import plan_from
    from fractalswarm.llm.client import UNBILLED_STATUSES, RetryPolicy
    from fractalswarm.llm.transport import ApiFaults, FaultyBackend
    from fractalswarm.market.ledger import ProjectLedger
    from fractalswarm.planning.taskspec import TaskSpec, run_params
    from fractalswarm.runs import record_run
    from fractalswarm.safety.firewall import Firewall, HeuristicBackend, default_backend

    if scenario not in (
        "swarm",
        "central",
        "single",
        "pipeline",
        "durable-max",
        "durable",
        "ablation",
    ):
        raise typer.BadParameter(
            "--scenario must be swarm, central, single, pipeline, durable-max, durable or ablation"
        )
    firewall = firewall or ("auto" if backend == "real" else "heuristic")
    if firewall not in ("auto", "heuristic"):
        raise typer.BadParameter("--firewall must be auto or heuristic")
    if budget_usd is not None and budget_usd <= 0:
        raise typer.BadParameter("--budget-usd must be above 0")
    settings = _settings()
    spec = TaskSpec.load(taskspec)
    if scenario == "ablation" and spec.task != "t2_conference":
        raise typer.BadParameter("--scenario ablation reads the emails and abstracts of a T2 task")
    if scenario == "ablation" and chaos == "kill-half":
        raise typer.BadParameter("--chaos kill-half has nothing to kill in an ablation")
    if budget_usd is not None:
        spec = spec.model_copy(update={"budget_usd": budget_usd})
    params = run_params(spec)
    retry = None
    if no_paid_retries:
        retry = RetryPolicy(statuses=UNBILLED_STATUSES)
        params |= {"retry": retry.model_dump(mode="json")}
    if cross_audit:
        params["cross_audit"] = True
    if feasibility_report:
        params["feasibility_report"] = True
    if chaos == "kill-half":
        params |= {"chaos": kill_half_plan(spec.seed), "membership": True}
    elif chaos in ("C0", "C1", "C2", "C3"):
        params |= {"chaos": {"profile": chaos, "seed": spec.seed}}
    else:
        raise typer.BadParameter("--chaos must be C0-C3 or kill-half")
    project_ledger = None
    if backend == "real":
        from fractalswarm.llm.client import OpenAIBackend

        if not confirm_real_spend:
            raise typer.BadParameter("real calls are billed: add --confirm-real-spend")
        if settings.model_api_key is None:
            raise typer.BadParameter("MODEL_API_KEY is not set in ~/.fractalswarm/.env")
        llm = OpenAIBackend(settings.model_api_key.get_secret_value(), settings.model_api_base_url)
        project_ledger = ProjectLedger(settings.ledger_path, settings.project_cap_usd)
    elif backend == "fake":
        from fractalswarm.bench.workflows import fake_backend

        llm = fake_backend()
    else:
        raise typer.BadParameter("--backend must be fake or real")
    if clock not in ("sim", "live"):
        raise typer.BadParameter("--clock must be sim or live")
    extra_effects = None
    if spec.task == "t3_report":  # the web task brings its fetch tool; $0 runs get a canned web
        from fractalswarm.bench.tasks.t3_report.web import web_run

        llm, extra_effects = web_run(spec, llm, fake=backend == "fake")
    rate = plan_from(params).api_fault_rate
    if rate:
        llm = FaultyBackend(llm, ApiFaults(seed=spec.seed, rate=rate))
    hf_token = settings.hf_token.get_secret_value() if settings.hf_token else None
    scanner = Firewall(default_backend(hf_token) if firewall == "auto" else HeuristicBackend())
    scanner.warm()  # before the clock starts

    run_id = run_id or f"{taskspec.stem}-{datetime.now():%Y%m%d-%H%M%S}"
    scenario_ref = scenario  # a name in runs.SCENARIOS, or the path of a scenario object
    if scenario == "ablation":
        from fractalswarm.bench.tasks.t2_conference.ablation import SCENARIO

        scenario_ref = SCENARIO
    result = asyncio.run(
        record_run(
            scenario_ref,
            run_id=run_id,
            run_dir=settings.runs_dir / run_id,
            backend=llm,
            seed=spec.seed,
            params=params,
            firewall=scanner,
            clock=clock,  # type: ignore[arg-type]
            speed=speed,
            run_cap_usd=spec.budget_usd,
            project_ledger=project_ledger,
            secrets=settings.secret_values(),
            retry=retry,
            extra_effects=extra_effects,
        )
    )
    spent = result.completed.payload["spent_usd"]
    typer.echo(f"run {result.run_id}: {result.events} events, head {result.head_hash}")
    typer.echo(f"run dir {result.paths.root}  spent ${spent:.6f} ({backend} LLM)")
    if scenario == "ablation":
        from fractalswarm.bench.tasks.t2_conference.ablation import summary_lines

        done = ablation_outcome(result.paths)
        if done is None:
            typer.echo("no ablation.done: the run ended without a result")
            raise typer.Exit(1)
        for line in summary_lines(done):
            typer.echo(line)
        if not done["complete"]:
            raise typer.Exit(1)
        return
    outcome = task_outcome(result.paths)
    if outcome is None:
        typer.echo("no task.result: the run ended without a result")
        raise typer.Exit(1)
    report = outcome["report"]
    typer.echo(
        f"result {outcome['status']}: placed {report['placed']}/{report['expected']}, "
        f"hard violations {report['hard_violations']}, soft score {report['soft_score']}"
    )
    for violation in report["violations"]:
        typer.echo(f"  {violation['kind']}: {violation['detail']}")
    for gap in report["gaps"]:
        typer.echo(f"  gap: {gap}")
    if report["hard_violations"]:
        raise typer.Exit(1)


def kill_half_plan(seed: str) -> dict:
    """Kill 5 of T2's 10 orchestrators at the crash points: the root first, then a session
    owner, a track lead, a session owner and another track lead (tests/integration)."""
    from fractalswarm.bench.profiles import CRASH_POINTS
    from fractalswarm.comms.chaos import ChaosAction, ChaosPlan

    targets = ["o0", "o2.1", "o1", "o3.2", "o2"]
    actions = tuple(
        ChaosAction(at=at, kind="kill_coordinator", target=target)
        for at, target in zip(CRASH_POINTS, targets, strict=True)
    )
    return ChaosPlan(profile="kill-half", seed=seed, actions=actions).model_dump(mode="json")


def task_outcome(paths) -> dict | None:
    """The payload of the run's ``task.result`` event, if any."""
    with paths.open_log() as log:
        results = [event.payload for event in log.read() if event.type == "task.result"]
    return results[-1] if results else None


def ablation_outcome(paths) -> dict | None:
    """The payload of the run's ``ablation.done`` event, if any."""
    with paths.open_log() as log:
        results = [event.payload for event in log.read() if event.type == "ablation.done"]
    return results[-1] if results else None


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
def feasibility(
    run: Annotated[str, typer.Argument(help="run id under runs/, or a run directory")],
) -> None:
    """Show the feasibility report a run recorded at plan approval (feasibility_report: true)."""
    from fractalswarm.planning.feasibility import render
    from fractalswarm.runs import RunPaths

    with RunPaths(_resolve_run_dir(run)).open_log() as log:
        found = next((e.payload for e in log.read() if e.type == "plan.feasibility"), None)
    if found is None:
        typer.echo(
            "this run has no feasibility report: set feasibility_report: true in the TaskSpec"
        )
        raise typer.Exit(1)
    typer.echo(render(found))


@app.command()
def resume(
    run: Annotated[str, typer.Argument(help="run id under runs/, or a run directory")],
    speed: Annotated[float, typer.Option(help="live clock speed-up")] = 1.0,
    backend: Annotated[str, typer.Option(help="fake | real")] = "fake",
    confirm_real_spend: Annotated[
        bool, typer.Option(help="required with --backend real: calls sent again are billed")
    ] = False,
    firewall: Annotated[
        str | None,
        typer.Option(
            help="auto (PromptGuard 2 when installed) | heuristic; default: auto with the "
            "real backend, heuristic with the fake one"
        ),
    ] = None,
) -> None:
    """Continue a run whose process died, from its log and cassette (docs/resume.md)."""
    import asyncio

    from fractalswarm.kernel.events import RunResumed
    from fractalswarm.market.ledger import ProjectLedger
    from fractalswarm.resume import AlreadyCompleted, ResumeRefused, resume_run
    from fractalswarm.safety.firewall import Firewall, HeuristicBackend, default_backend

    firewall = firewall or ("auto" if backend == "real" else "heuristic")
    if firewall not in ("auto", "heuristic"):
        raise typer.BadParameter("--firewall must be auto or heuristic")
    settings = _settings()
    project_ledger = None
    if backend == "real":
        from fractalswarm.llm.client import OpenAIBackend

        if not confirm_real_spend:
            raise typer.BadParameter("calls sent again are billed: add --confirm-real-spend")
        if settings.model_api_key is None:
            raise typer.BadParameter("MODEL_API_KEY is not set in ~/.fractalswarm/.env")
        llm = OpenAIBackend(settings.model_api_key.get_secret_value(), settings.model_api_base_url)
        project_ledger = ProjectLedger(settings.ledger_path, settings.project_cap_usd)
    elif backend == "fake":
        from fractalswarm.bench.workflows import fake_backend

        llm = fake_backend()
    else:
        raise typer.BadParameter("--backend must be fake or real")
    hf_token = settings.hf_token.get_secret_value() if settings.hf_token else None
    scanner = Firewall(default_backend(hf_token) if firewall == "auto" else HeuristicBackend())
    scanner.warm()  # before the clock starts

    def announce(plan: RunResumed) -> None:
        extra = f" (+{plan.completed_tail} to finish the reaction the kill cut)"
        typer.echo(
            f"resuming: {plan.log_events} events in the log{extra if plan.completed_tail else ''}"
        )
        local = ", ".join(f"{count} {kind}" for kind, count in plan.rerun.items()) or "none"
        typer.echo(
            f"  open effects: {len(plan.from_cassette)} answered from the cassette, "
            f"{len(plan.ambiguous)} sent again, local: {local}"
        )
        if plan.ambiguous:
            typer.echo(
                f"  ambiguous, may be billed twice (up to ${plan.possible_extra_usd:.4f}): "
                + ", ".join(plan.ambiguous)
            )
        if plan.cassette_dropped_bytes:
            typer.echo(f"  cut {plan.cassette_dropped_bytes} bytes of a torn cassette line")

    run_dir = _resolve_run_dir(run)
    try:
        result = asyncio.run(
            resume_run(
                run_dir,
                backend=llm,
                speed=speed,
                project_ledger=project_ledger,
                secrets=settings.secret_values(),
                firewall=scanner,
                announce=announce,
            )
        )
    except AlreadyCompleted as exc:
        typer.echo(f"{exc}; nothing to resume")
        raise typer.Exit(0) from exc
    except ResumeRefused as exc:
        typer.echo(f"cannot resume {run_dir.name}: {exc}")
        raise typer.Exit(2) from exc
    done = result.run
    spent = done.completed.payload["spent_usd"]
    typer.echo(f"run {done.run_id}: {done.events} events, head {done.head_hash}")
    typer.echo(f"run dir {done.paths.root}  spent ${spent:.6f} ({backend} LLM)")
    outcome = task_outcome(done.paths)
    if outcome is None:
        with done.paths.open_log() as log:
            started = log.get(1)
        if started is not None and "spec" in started.payload["params"]:
            typer.echo("no task.result: the run ended without a result")
            raise typer.Exit(1)
        return
    report = outcome["report"]
    typer.echo(
        f"result {outcome['status']}: placed {report['placed']}/{report['expected']}, "
        f"hard violations {report['hard_violations']}, soft score {report['soft_score']}"
    )
    for gap in report["gaps"]:
        typer.echo(f"  gap: {gap}")
    if report["hard_violations"]:
        raise typer.Exit(1)


@app.command()
def calibrate(
    sources: Annotated[
        list[Path], typer.Argument(help="cassette or sample .jsonl files, or directories of them")
    ],
    out: Annotated[Path, typer.Option(help="where to write the fit")] = Path(
        "config/fake_calibration.json"
    ),
) -> None:
    """Fit the fake LLM's latency and reasoning tokens to real calls (no API calls)."""
    from fractalswarm.llm.calibrate import calibrate_paths

    fit = calibrate_paths(sources)
    fit.save(out)
    pooled = fit.latency["*"]
    typer.echo(f"{fit.samples} real calls -> {out}")
    typer.echo(
        f"latency ~ {pooled.base_ms:.0f} ms + {pooled.per_output_token_ms:.2f} ms/output token"
        f" (x lognormal sigma {pooled.log_sigma:.2f}); models: {', '.join(sorted(fit.latency))}"
    )


@app.command()
def spend() -> None:
    """Show the project ledger: real spend against the project cap."""
    from datetime import UTC, datetime, timedelta

    from rich.console import Console
    from rich.table import Table

    from fractalswarm.market.ledger import ProjectLedger, stale_reservations

    settings = _settings()
    ledger = ProjectLedger(settings.ledger_path, settings.project_cap_usd)
    summary = ledger.summary()
    console = Console()
    console.print(f"ledger {settings.ledger_path}")
    console.print(
        f"spent ${summary.spent_usd:.4f}, reserved ${summary.reserved_usd:.4f}, "
        f"remaining ${summary.remaining_usd:.4f} of ${summary.cap_usd:.2f}"
    )
    stale = stale_reservations(ledger.open_reservations(), datetime.now(UTC), timedelta(hours=1))
    if stale:
        stale_usd = sum(row.reserved_usd for row in stale)
        by_run: dict[str, list[float]] = {}
        for row in stale:
            by_run.setdefault(row.run_id, []).append(row.reserved_usd)
        console.print(
            f"stale: {len(stale)} reservations (${stale_usd:.4f}) in {len(by_run)} runs have "
            "been open for over an hour: calls cancelled in flight, or cut off by a stopped "
            "process. They stay open on purpose, because such a request may still have been "
            f"billed. If none was, ${summary.remaining_usd + stale_usd:.4f} remains."
        )
        table = Table(title="stale reservations by run")
        for column in ("run", "reservations", "reserved $"):
            table.add_column(column)
        for run_id, amounts in by_run.items():
            table.add_row(run_id, str(len(amounts)), f"{sum(amounts):.4f}")
        console.print(table)
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


@app.command()
def takeover(
    run: Annotated[str, typer.Argument(help="run id under runs/, or a run directory")],
    json_path: Annotated[
        Path | None, typer.Option("--json", help="write the full report here as JSON")
    ] = None,
    md_path: Annotated[
        Path | None, typer.Option("--md", help="write the report here as Markdown")
    ] = None,
    replay: Annotated[bool, typer.Option(help="also replay the run and compare hashes")] = False,
) -> None:
    """Prove from the log alone what a run's kills did (read-only; exit 1 on a violation)."""
    import asyncio

    from fractalswarm.runs import replay_run
    from fractalswarm.verify.takeover import check_run
    from fractalswarm.verify.takeover_render import render_markdown, render_text

    run_dir = _resolve_run_dir(run)
    replayed = asyncio.run(replay_run(run_dir)) if replay else None
    report = check_run(run_dir, replay=replayed)
    typer.echo(render_text(report))
    if json_path is not None:
        json_path.write_text(report.model_dump_json(indent=2) + "\n", encoding="utf-8")
    if md_path is not None:
        command = f"fractalswarm takeover {run}" + (" --replay" if replay else "")
        md_path.write_text(render_markdown(report, command) + "\n", encoding="utf-8")
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
        from fractalswarm.bench.workflows import fake_backend

        backend_factory, clock = fake_backend, "sim"
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
