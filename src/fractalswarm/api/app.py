"""The HTTP API and the prebuilt UI (spec §16, §17).

REST under ``/api``; the event stream is a WebSocket (``api/ws.py``); everything else serves
the web app from ``api/static/``. The UI is a pure projection of the event stream, so it
needs only the read endpoints to show a live run or a replay. The kill switch (``halt``) and the
budget shock (``budget``) drop a request into the live run's control inbox, the same file
``fractalswarm halt`` and ``budget`` write; the other control endpoints (tasks, approval, chaos,
escalations) answer 501 until the runtime behind them lands.
"""

import asyncio
import json
import math
from pathlib import Path
from typing import Any

import anyio
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from fractalswarm.api.catalog import Catalog, RunEntry
from fractalswarm.api.ws import stream_events
from fractalswarm.config import CONFIG_DIR

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
) -> Starlette:
    catalog = Catalog(runs_dir, demo_dir)
    verified: dict[tuple[str, str], dict[str, Any]] = {}

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
        exported) and a bundled recording are history: there is nothing left to control."""
        from fractalswarm.runs import RunPaths

        run = entry(request)
        last = catalog.last(run)
        if run.jsonl.exists() or (last is not None and last["type"] == "run.completed"):
            raise HTTPException(409, f"run {run.id!r} is a recording, not a live run")
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
        Route("/api/bench/results", bench_results),
        Route("/api/tasks", not_wired("tasks", "the Day 4 T2 slice"), methods=["POST"]),
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
