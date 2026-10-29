"""The HTTP API and the prebuilt UI (spec §16, §17).

REST under ``/api``; the event stream is a WebSocket (``api/ws.py``); everything else serves
the web app from ``api/static/``. The UI is a pure projection of the event stream, so it
needs only the read endpoints to show a live run or a replay. The kill switch (``halt``) and the
budget shock (``budget``) drop a request into the live run's control inbox, the same file
``fractalswarm halt`` and ``budget`` write.

Launching: ``POST /api/tasks`` starts a run as a job (``api/jobs.py``: one subprocess per run),
``GET /api/jobs`` lists them and ``POST /api/jobs/{id}/cancel`` stops one. The live input flow is
``POST /api/intake`` (Muse reads pasted text), ``GET /api/intake/{id}``, then
``POST /api/intake/{id}/approve``; a task then runs on ``inputs.intake``. These need a private
directory (``FRACTALSWARM_PRIVATE_DIR``), where what a person typed lives; without one they
answer 503. ``POST /api/arena`` starts a pair of runs on one input under one chaos plan.
A billed run (``backend: real``) is refused unless it carries the token of a preflight
(``POST /api/tasks/preflight``, ``/api/arena/preflight``) and the word SPEND, and the server was
started with ``FRACTALSWARM_ALLOW_UI_REAL`` (``api/spend.py``). The remaining control endpoints
(plan approval, chaos, escalations) answer 501 until the runtime behind them lands;
``GET /api/capabilities`` says which controls are real.
A finished run also has ``/metrics`` (the official numbers) and ``/takeover`` (what its log
proves about the coordinator kills).
"""

import asyncio
import json
import math
import shutil
from pathlib import Path
from typing import Any

import anyio
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from fractalswarm.api import arena, jobs
from fractalswarm.api.catalog import Catalog, RunEntry
from fractalswarm.api.jobs import JobError, JobManager
from fractalswarm.api.lens import lens_routes
from fractalswarm.api.spend import Spend, preflight_arena, preflight_task
from fractalswarm.api.ws import stream_events
from fractalswarm.config import CONFIG_DIR
from fractalswarm.intake import service
from fractalswarm.intake.store import PrivateDir, new_id, safe_id

REPO_ROOT = CONFIG_DIR.parent
DEMO_DIR = REPO_ROOT / "demo"
BENCH_RESULTS_DIR = REPO_ROOT / "bench" / "results"
STATIC_DIR = Path(__file__).resolve().parent / "static"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
# The first file found wins; bench/charts.py writes one of these.
HERO_FILES = ("hero_chart.json", "hero.json", "charts.json")
CHAOS_KINDS = ("kill_half", "kill_coordinator", "kill_agent", "api_storm", "net_fault")
BUDGET_LEVELS = ("contract", "squad", "run", "project")
MAX_PAGE = 5000


def create_app(
    runs_dir: Path,
    demo_dir: Path | None = DEMO_DIR,
    bench_dir: Path = BENCH_RESULTS_DIR,
    static_dir: Path = STATIC_DIR,
    private_dir: Path | None = None,
    spend: Spend | None = None,
) -> Starlette:
    catalog = Catalog(runs_dir, demo_dir, private_dir)
    private = PrivateDir(private_dir) if private_dir is not None else None
    manager = JobManager(private, runs_dir, catalog) if private is not None else None
    verified: dict[tuple[str, str], dict[str, Any]] = {}
    # Without a gate no billed run can start and no ledger is read.
    spending = spend or (Spend.locked(private_dir) if private_dir is not None else None)
    takeovers: dict[tuple[str, str], dict[str, Any]] = {}

    def need_private() -> tuple[PrivateDir, JobManager]:
        if private is None or manager is None:
            raise HTTPException(503, "the API was started without a private directory")
        return private, manager

    def need_spend() -> Spend:
        need_private()
        assert spending is not None
        return spending

    def entry(request: Request) -> RunEntry:
        try:
            return catalog.get(request.path_params["run_id"])
        except KeyError:
            raise HTTPException(404, f"no run {request.path_params['run_id']!r}") from None

    async def list_runs(request: Request) -> JSONResponse:
        return JSONResponse([catalog.listing(run) for run in catalog.entries()])

    async def get_run(request: Request) -> JSONResponse:
        return JSONResponse(catalog.summary(entry(request)))

    async def events_page(request: Request) -> JSONResponse:
        run = entry(request)
        from_seq = _int_param(request, "from_seq", 1, minimum=1)
        limit = _int_param(request, "limit", 1000, minimum=1, maximum=MAX_PAGE)
        events = catalog.read(run, from_seq, limit)
        last = catalog.last(run)
        next_seq = events[-1]["seq"] + 1 if events else from_seq
        return JSONResponse(
            {
                "events": events,
                "next_seq": next_seq,
                "last_seq": last["seq"] if last else 0,
                "done": next_seq > (last["seq"] if last else 0),
            }
        )

    async def verify_run(request: Request) -> JSONResponse:
        """Replay the run from its log and cassette, and compare hashes (``replay --verify``)."""
        from fractalswarm.runs import replay_run

        run = entry(request)
        last = catalog.last(run)
        if last is None or last["type"] != "run.completed":
            raise HTTPException(409, "the run has not completed yet; verify it when it ends")
        key = (str(run.path), last["hash"])
        if key not in verified:
            report = await anyio.to_thread.run_sync(lambda: asyncio.run(replay_run(run.path)))
            bundle_head = run.recorded_head
            verified[key] = report.model_dump() | {
                "bundle_head": bundle_head,
                "bundle_head_ok": bundle_head is None or bundle_head == report.replayed_head,
            }
        return JSONResponse(verified[key])

    async def takeover(request: Request) -> JSONResponse:
        """What the log proves about the run's coordinator kills (``verify/takeover.py``): ``ok``,
        the ``violations`` that made it false, and the kills, successions, adoptions, duplicate
        calls and costs behind them. Recomputed from the finished log, never from what an actor
        said about itself."""
        from fractalswarm.verify.takeover import check_run

        run = entry(request)
        last = catalog.last(run)
        if last is None or last["type"] != "run.completed":
            raise HTTPException(409, "the run has not completed yet; check it when it ends")
        key = (str(run.path), last["hash"])
        if key not in takeovers:
            report = await anyio.to_thread.run_sync(check_run, run.path)
            takeovers[key] = report.model_dump(mode="json")
        return JSONResponse(takeovers[key])

    async def capabilities(request: Request) -> JSONResponse:
        """Which controls this server really does. A control that is ``false`` answers 501
        (``not_wired``), or 503 without a private directory."""
        return JSONResponse(
            {
                "tasks": private is not None,  # POST /api/tasks, /api/intake and /api/arena
                "chaos": False,
                "approve": False,
                "budget": True,
                "halt": True,
            }
        )

    async def feasibility(request: Request) -> JSONResponse:
        """The feasibility report written at plan approval, which is early in the log."""
        for event in catalog.read(entry(request), 1, 500):
            if event["type"] == "plan.feasibility":
                return JSONResponse(event["payload"])
        raise HTTPException(404, "this run has no feasibility report (feasibility_report: true)")

    async def bench_results(request: Request) -> JSONResponse:
        for name in HERO_FILES:
            path = bench_dir / name
            if path.is_file():
                data = json.loads(path.read_text(encoding="utf-8"))
                return JSONResponse({"source": str(path), "fixture": False, "data": data})
        fixture = FIXTURES_DIR / "hero_chart.json"
        data = json.loads(fixture.read_text(encoding="utf-8"))
        return JSONResponse({"source": "fixture", "fixture": True, "data": data})

    def not_wired(what: str, lands: str):
        async def endpoint(request: Request) -> JSONResponse:
            body = await _json_body(request)
            if what == "chaos":
                kind = body.get("kind")
                if kind not in CHAOS_KINDS:
                    raise HTTPException(422, f"chaos kind must be one of {', '.join(CHAOS_KINDS)}")
            if "run_id" in request.path_params:
                entry(request)
            return JSONResponse(
                {
                    "error": "not_implemented",
                    "endpoint": what,
                    "detail": f"{what} is not wired yet: it lands with {lands}.",
                    "request": body,
                },
                status_code=501,
            )

        return endpoint

    def control_inbox(request: Request) -> Any:
        """The control inbox of a run that is still recording. A finished run (its log is
        exported) and a bundled recording are history: there is nothing left to control. Nor is
        there for an interrupted run, whose process died: nobody would read the request."""
        from fractalswarm.runs import RunPaths

        run = entry(request)
        status = catalog.status(run, catalog.last(run))
        if run.jsonl.exists() or status in ("completed", "halted"):
            raise HTTPException(409, f"run {run.id!r} is a recording, not a live run")
        if status != "running":
            raise HTTPException(409, f"run {run.id!r} is {status}: no process is recording it")
        return RunPaths(run.path)

    async def halt_run(request: Request) -> JSONResponse:
        """The kill switch: the run records ``run.halted`` and stops everything."""
        body = await _json_body(request)
        inbox = control_inbox(request)
        reason = str(body.get("reason") or "kill switch")
        inbox.request_control({"op": "halt", "reason": reason, "by": "human"})
        detail = "halt requested: the run stops at its next poll"
        return JSONResponse({"ok": True, "detail": detail})

    async def shock_budget(request: Request) -> JSONResponse:
        """A budget shock: a new cap, recorded as ``budget.shock`` (default: the run's own cap)."""
        body = await _json_body(request)
        usd, level, key = body.get("usd"), body.get("level", "run"), body.get("key")
        is_number = isinstance(usd, int | float) and not isinstance(usd, bool)
        if not is_number or not math.isfinite(usd) or usd < 0:
            raise HTTPException(422, "usd must be a number >= 0")
        if level not in BUDGET_LEVELS:
            raise HTTPException(422, f"level must be one of {', '.join(BUDGET_LEVELS)}")
        if key is not None and not isinstance(key, str):
            raise HTTPException(422, "key must be a string")
        inbox = control_inbox(request)
        reason = str(body.get("reason") or "budget shock")
        request_ = {"op": "budget", "level": level, "key": key or None, "usd": float(usd)}
        inbox.request_control(request_ | {"reason": reason})
        return JSONResponse({"ok": True, "detail": f"cap requested: {level} ${usd:g}"})

    # -- launching runs and reading live input ------------------------------------------------

    def job_error(exc: JobError) -> HTTPException:
        return HTTPException(exc.status, exc.message)

    def launched(job: dict[str, Any]) -> dict[str, Any]:
        runs = [run["run_id"] for run in job["runs"]]
        return {
            "job_id": job["id"],
            "run_id": runs[0],
            "run_ids": runs,
            "state": job["state"],
            "private": job["private"],
            "warnings": job["warnings"],
            "job": job,
        }

    async def launch_task(request: Request) -> JSONResponse:
        _, jobs_ = need_private()
        body = await _json_body(request)
        try:
            job = await anyio.to_thread.run_sync(jobs.launch_run, jobs_, body, need_spend().approve)
        except JobError as exc:
            raise job_error(exc) from None
        return JSONResponse(launched(job), status_code=202)

    async def preflight_task_route(request: Request) -> JSONResponse:
        _, jobs_ = need_private()
        body = await _json_body(request)
        try:
            answer = await anyio.to_thread.run_sync(preflight_task, need_spend(), jobs_, body)
        except JobError as exc:
            raise job_error(exc) from None
        return JSONResponse(answer)

    async def preflight_arena_route(request: Request) -> JSONResponse:
        _, jobs_ = need_private()
        body = await _json_body(request)
        try:
            answer = await anyio.to_thread.run_sync(preflight_arena, need_spend(), jobs_, body)
        except JobError as exc:
            raise job_error(exc) from None
        return JSONResponse(answer)

    async def launch_pair(request: Request) -> JSONResponse:
        _, jobs_ = need_private()
        body = await _json_body(request)
        try:
            started = await anyio.to_thread.run_sync(
                arena.launch_arena, jobs_, body, need_spend().approve
            )
        except JobError as exc:
            raise job_error(exc) from None
        return JSONResponse(started, status_code=202)

    async def list_pairs(request: Request) -> JSONResponse:
        return JSONResponse(arena.list_pairs(need_private()[1]))

    async def get_pair(request: Request) -> JSONResponse:
        try:
            return JSONResponse(arena.get_pair(need_private()[1], request.path_params["pair_id"]))
        except JobError as exc:
            raise job_error(exc) from None

    async def list_jobs(request: Request) -> JSONResponse:
        return JSONResponse(need_private()[1].listing())

    async def get_job(request: Request) -> JSONResponse:
        try:
            return JSONResponse(need_private()[1].get(request.path_params["job_id"]))
        except JobError as exc:
            raise job_error(exc) from None

    async def cancel_job(request: Request) -> JSONResponse:
        try:
            return JSONResponse(await need_private()[1].cancel(request.path_params["job_id"]))
        except JobError as exc:
            raise job_error(exc) from None

    def intake_entry(intake_id: str) -> RunEntry:
        private_, _ = need_private()
        try:
            path = private_.intake_dir(safe_id(intake_id, "intake id"))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        if not private_.input_file(intake_id).exists():
            raise HTTPException(404, f"no intake {intake_id!r}")
        return RunEntry(intake_id, "private", path)

    def intake_state(intake_id: str) -> dict[str, Any]:
        private_, jobs_ = need_private()
        run = intake_entry(intake_id)
        mine = [
            job
            for job in jobs_.jobs.values()
            if job["kind"] == "intake" and job["runs"] and job["runs"][0]["run_id"] == intake_id
        ]
        job = jobs_.view_state(max(mine, key=lambda j: j["created_at"])) if mine else None
        return service.state_of(catalog, run, private_, job)

    async def create_intake(request: Request) -> JSONResponse:
        private_, jobs_ = need_private()
        body = await _json_body(request)
        backend = body.get("backend", "fake")
        if backend != "fake":
            raise HTTPException(403, "reading with the real model needs the preflight flow")
        intake_id = new_id("intake")
        try:
            service.create_input(private_, intake_id, body)
            job = await anyio.to_thread.run_sync(jobs.launch_intake, jobs_, intake_id, backend)
        except service.IntakeError as exc:
            raise HTTPException(422, str(exc)) from None
        except JobError as exc:  # nothing started: do not leave the pasted text behind
            shutil.rmtree(private_.intake_dir(intake_id), ignore_errors=True)
            raise job_error(exc) from None
        answer = {"intake_id": intake_id, "job_id": job["id"], "state": "reading", "private": True}
        return JSONResponse(answer | {"warnings": job["warnings"]}, status_code=202)

    async def get_intake(request: Request) -> JSONResponse:
        found = await anyio.to_thread.run_sync(intake_state, request.path_params["intake_id"])
        return JSONResponse(found)

    async def approve_intake(request: Request) -> JSONResponse:
        private_, _ = need_private()
        body = await _json_body(request)
        edited = body.get("proposal")
        if edited is not None and not isinstance(edited, dict):
            raise HTTPException(422, "proposal must be the edited proposal object")
        state = await anyio.to_thread.run_sync(intake_state, request.path_params["intake_id"])
        try:
            approved = service.approve(private_, state, edited)
        except service.IntakeError as exc:
            status = 409 if "already approved" in str(exc) else 422
            raise HTTPException(status, str(exc)) from None
        return JSONResponse(
            {
                "intake_id": state["intake_id"],
                "sha256": approved["sha256"],
                "edits": approved["edits"],
                "warnings": approved["proposal"]["warnings"],
                "task_inputs": {"intake": state["intake_id"]},
            }
        )

    async def intake_sample(request: Request) -> JSONResponse:
        """Synthetic text in the generator's wording, to try the intake with at $0."""
        from fractalswarm.bench.tasks.t2_conference.generator import live_sample

        seed = _int_param(request, "seed", 1, minimum=0, maximum=10_000)
        sample = live_sample(seed)
        return JSONResponse({key: sample[key] for key in ("conference", "talks", "notes", "rooms")})

    async def run_metrics(request: Request) -> JSONResponse:
        """The official numbers of a run (``bench/scoring.score_run``): stall, makespan, cost,
        tokens, messages, chaos events, and the task's validity. ``recovery`` is reserved for
        the recovery metrics of the durable-supervisor comparison."""
        from fractalswarm.bench.scoring import default_checker, score_run
        from fractalswarm.bench.workflows import t1_checker, t2_checker
        from fractalswarm.kernel.events import Event
        from fractalswarm.runs import SCENARIOS

        run = entry(request)
        events = [Event.model_validate(event) for event in catalog.read(run)]
        started = events[0].payload if events and events[0].type == "run.started" else {}
        task = ((started.get("params") or {}).get("spec") or {}).get("task")
        names = {path: name for name, path in SCENARIOS.items()}
        checker = {"t2_conference": t2_checker, "t1_extraction": t1_checker}.get(task)
        metrics = await anyio.to_thread.run_sync(
            lambda: score_run(events, checker or default_checker)
        )
        return JSONResponse(
            {
                "run_id": run.id,
                "status": catalog.status(run, catalog.last(run)),
                "scenario": names.get(started.get("scenario"), started.get("scenario")),
                "task": task,
                "input": (started.get("params") or {}).get("input"),
                "metrics": metrics.model_dump(),
                "recovery": None,
            }
        )

    async def ui(request: Request) -> HTMLResponse:
        return HTMLResponse(
            "<h1>FractalSwarm</h1><p>The web UI is not built. Run "
            "<code>npm --prefix web run build</code>; the API is under <code>/api</code>.</p>"
        )

    async def http_error(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, HTTPException)
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    async def websocket(ws) -> None:
        await stream_events(ws, catalog)

    routes = [
        Route("/api/runs", list_runs),
        Route("/api/runs/{run_id}", get_run),
        Route("/api/runs/{run_id}/events", events_page),
        WebSocketRoute("/api/runs/{run_id}/events", websocket),
        Route("/api/runs/{run_id}/verify", verify_run, methods=["POST"]),
        Route("/api/runs/{run_id}/feasibility", feasibility),
        Route("/api/runs/{run_id}/takeover", takeover),
        Route("/api/capabilities", capabilities),
        *lens_routes(catalog),
        Route("/api/bench/results", bench_results),
        Route("/api/runs/{run_id}/metrics", run_metrics),
        Route("/api/tasks", launch_task, methods=["POST"]),
        Route("/api/tasks/preflight", preflight_task_route, methods=["POST"]),
        Route("/api/arena/preflight", preflight_arena_route, methods=["POST"]),
        Route("/api/arena", launch_pair, methods=["POST"]),
        Route("/api/pairs", list_pairs),
        Route("/api/pairs/{pair_id}", get_pair),
        Route("/api/jobs", list_jobs),
        Route("/api/jobs/{job_id}", get_job),
        Route("/api/jobs/{job_id}/cancel", cancel_job, methods=["POST"]),
        Route("/api/intake", create_intake, methods=["POST"]),
        Route("/api/intake/sample", intake_sample),
        Route("/api/intake/{intake_id}", get_intake),
        Route("/api/intake/{intake_id}/approve", approve_intake, methods=["POST"]),
        Route(
            "/api/runs/{run_id}/approve",
            not_wired("approve", "the Day 4 T2 slice (plan approval)"),
            methods=["POST"],
        ),
        Route(
            "/api/runs/{run_id}/chaos",
            not_wired("chaos", "the Day 5 chaos injector and takeover"),
            methods=["POST"],
        ),
        Route("/api/runs/{run_id}/budget", shock_budget, methods=["POST"]),
        Route("/api/runs/{run_id}/halt", halt_run, methods=["POST"]),
        Route(
            "/api/runs/{run_id}/escalations/{eid}",
            not_wired("escalations", "the replanning ladder (step 5, human)"),
            methods=["POST"],
        ),
    ]
    if (static_dir / "index.html").is_file():
        routes.append(Mount("/", StaticFiles(directory=static_dir, html=True)))
    else:
        routes.append(Route("/", ui))
    return Starlette(routes=routes, exception_handlers={HTTPException: http_error})


def _int_param(
    request: Request, name: str, default: int, *, minimum: int, maximum: int | None = None
) -> int:
    raw = request.query_params.get(name)
    try:
        value = default if raw is None else int(raw)
    except ValueError:
        raise HTTPException(422, f"{name} must be an integer") from None
    if value < minimum or (maximum is not None and value > maximum):
        raise HTTPException(422, f"{name} must be in [{minimum}, {maximum or '∞'}]")
    return value


async def _json_body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(422, "the body must be JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(422, "the body must be a JSON object")
    return body
