"""The HTTP API and the prebuilt UI (spec §16, §17).

REST under ``/api``; the event stream is a WebSocket (``api/ws.py``); everything else serves
the web app from ``api/static/``. The UI is a pure projection of the event stream, so it
needs only the read endpoints to show a live run or a replay. The kill switch (``halt``) and the
budget shock (``budget``) drop a request into the live run's control inbox, the same file
``fractalswarm halt`` and ``budget`` write. So do a person's controls (``api/controls.py``): a
kill at a progress point (``/chaos``), a plan approved or sent back (``/approve``) and the answer
to an escalation (``/escalations/{eid}``); each also has a pair-level form
(``/api/pairs/{id}/chaos``, ``/approve``) that gives both runs the same control. They need a run
launched by the API (``live_control``): any other run answers 409.

Launching: ``POST /api/tasks`` starts a run as a job (``api/jobs.py``: one subprocess per run),
``GET /api/jobs`` lists them and ``POST /api/jobs/{id}/cancel`` stops one. The live input flow is
``POST /api/intake`` (Muse reads pasted text), ``GET /api/intake/{id}``, then
``POST /api/intake/{id}/approve``; a task then runs on ``inputs.intake``. These need a private
directory (``FRACTALSWARM_PRIVATE_DIR``), where what a person typed lives; without one they
answer 503. ``POST /api/arena`` starts a pair of runs on one input under one chaos plan.
A billed run (``backend: real``), pair or reading of pasted text is refused unless it carries the
token of a preflight (``POST /api/tasks/preflight``, ``/api/arena/preflight``,
``/api/intake/preflight``) and the word SPEND, and the server was started with
``FRACTALSWARM_ALLOW_UI_REAL`` (``api/spend.py``). ``GET /api/capabilities`` says which
controls are real.
A finished run also has ``/metrics`` (the official numbers, ``recovery`` among them), ``/takeover``
(what its log proves about the coordinator kills) and ``/recovery`` (what each coordinator outage
cost, and what a supervisor's restarts found and did).

Every request, the WebSocket included, passes ``api/guard.py`` first: a ``Host`` that is not
loopback or the address ``serve`` was given gets 400, a POST that is not ``application/json``
gets 415, and a WebSocket from another origin is refused.
"""

import asyncio
import json
import math
import shutil
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import anyio
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from fractalswarm.api import arena, jobs
from fractalswarm.api.catalog import Catalog, RunEntry
from fractalswarm.api.controls import (
    TOKEN,
    ControlError,
    answer_control,
    approve_control,
    chaos_controls,
    inbox_request,
)
from fractalswarm.api.guard import ApiGuard
from fractalswarm.api.jobs import JobError, JobManager
from fractalswarm.api.lens import lens_routes
from fractalswarm.api.spend import (
    Spend,
    intake_request_of,
    preflight_arena,
    preflight_intake,
    preflight_task,
)
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
# The recorded results as committed, one hero chart per matrix (bench/results/<set>/). Every one
# that exists is offered as a set, so the Charts page can show the 2-seed rivals matrix, the 3-seed
# headline and the $0 gate (fake LLM) apart. Which of them is real is for the page to say.
HERO_SETS = {
    "v1": "v1/hero-t2_conference.json",
    "headline": "headline/hero-t2_conference.json",
    "rivals-gate": "rivals-gate/hero-t2_conference.json",
}
BUDGET_LEVELS = ("contract", "squad", "run", "project")
MAX_PAGE = 5000


def create_app(
    runs_dir: Path,
    demo_dir: Path | None = DEMO_DIR,
    bench_dir: Path = BENCH_RESULTS_DIR,
    static_dir: Path = STATIC_DIR,
    private_dir: Path | None = None,
    spend: Spend | None = None,
    allowed_hosts: Iterable[str] = (),
) -> Starlette:
    """``allowed_hosts`` are the names a request may use besides loopback: ``serve`` passes the
    address it listens on."""
    catalog = Catalog(runs_dir, demo_dir, private_dir)
    private = PrivateDir(private_dir) if private_dir is not None else None
    manager = JobManager(private, runs_dir, catalog) if private is not None else None
    verified: dict[tuple[str, str], dict[str, Any]] = {}
    # Without a gate no billed run can start and no ledger is read.
    spending = spend or (Spend.locked(private_dir) if private_dir is not None else None)
    takeovers: dict[tuple[str, str], dict[str, Any]] = {}
    recoveries: dict[tuple[str, str], dict[str, Any]] = {}

    def need_private() -> tuple[PrivateDir, JobManager]:
        if private is None or manager is None:
            raise HTTPException(503, "the API was started without a private directory")
        return private, manager

    def need_spend() -> Spend:
        need_private()
        assert spending is not None
        return spending

    def entry_of(run_id: str) -> RunEntry:
        try:
            return catalog.get(run_id)
        except KeyError:
            raise HTTPException(404, f"no run {run_id!r}") from None

    def entry(request: Request) -> RunEntry:
        return entry_of(request.path_params["run_id"])

    async def list_runs(request: Request) -> JSONResponse:
        return JSONResponse([catalog.listing(run) for run in catalog.entries()])

    async def get_run(request: Request) -> JSONResponse:
        return JSONResponse(catalog.summary(entry(request)))

    async def events_page(request: Request) -> JSONResponse:
        run = entry(request)
        from_seq = _int_param(request, "from_seq", 1, minimum=1)
        limit = _int_param(request, "limit", 1000, minimum=1, maximum=MAX_PAGE)
        events, last_seq = catalog.page(run, from_seq, limit)
        next_seq = events[-1]["seq"] + 1 if events else from_seq
        done = next_seq > last_seq  # the page reached the end of the log as it saw it
        return JSONResponse(
            {"events": events, "next_seq": next_seq, "last_seq": last_seq, "done": done}
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

    async def recovery(request: Request) -> JSONResponse:
        """What the log shows each coordinator outage cost (``verify/recovery.py``): the recovery
        ``metrics`` with one row per crash or partition, what each supervisor restart found and
        did, and ``ok`` over the rules a supervisor that keeps its workers must hold to. Recomputed
        from the finished log, like ``/takeover``, which checks the swarm's kills."""
        from fractalswarm.verify.recovery import check_run

        run = entry(request)
        last = catalog.last(run)
        if last is None or last["type"] != "run.completed":
            raise HTTPException(409, "the run has not completed yet; check it when it ends")
        key = (str(run.path), last["hash"])
        if key not in recoveries:
            report = await anyio.to_thread.run_sync(check_run, run.path)
            recoveries[key] = report.model_dump(mode="json")
        return JSONResponse(recoveries[key])

    async def capabilities(request: Request) -> JSONResponse:
        """Which controls this server really does. ``chaos`` and ``approve`` act on a live run
        that was launched by the API; any other run answers 409. ``tasks`` needs a private
        directory (503 without one). ``real`` says a billed launch can pass the gate (the server
        flag is on and there is a key): without it a preflight comes back with no token."""
        gate = spending.gate if spending is not None else None
        return JSONResponse(
            {
                "tasks": private is not None,  # POST /api/tasks, /api/intake and /api/arena
                "chaos": True,  # a kill at a progress point, on a run the API launched
                "approve": True,  # a plan held for a person (auto_approve: false)
                "budget": True,
                "halt": True,
                "real": gate is not None and gate.allow_real and gate.has_key,
            }
        )

    async def feasibility(request: Request) -> JSONResponse:
        """The feasibility report written at plan approval, which is early in the log."""
        for event in catalog.read(entry(request), 1, 500):
            if event["type"] == "plan.feasibility":
                return JSONResponse(event["payload"])
        raise HTTPException(404, "this run has no feasibility report (feasibility_report: true)")

    async def bench_results(request: Request) -> JSONResponse:
        """The hero chart data. ``sets`` are the recorded matrices that exist (``HERO_SETS``);
        ``data`` is the first of ``HERO_FILES`` or else the first set. With neither, ``fixture`` is
        true and ``data`` is the UI-development placeholder, which a page must not draw as if it
        were measured."""
        sets = [
            {
                "name": name,
                "source": f"bench/results/{relative}",
                "data": json.loads((bench_dir / relative).read_text(encoding="utf-8")),
            }
            for name, relative in HERO_SETS.items()
            if (bench_dir / relative).is_file()
        ]
        for name in HERO_FILES:
            path = bench_dir / name
            if path.is_file():
                data = json.loads(path.read_text(encoding="utf-8"))
                return JSONResponse(
                    {"source": str(path), "fixture": False, "data": data, "sets": sets}
                )
        if sets:
            first = sets[0]
            return JSONResponse(
                {"source": first["source"], "fixture": False, "data": first["data"], "sets": sets}
            )
        fixture = FIXTURES_DIR / "hero_chart.json"
        data = json.loads(fixture.read_text(encoding="utf-8"))
        return JSONResponse({"source": "fixture", "fixture": True, "data": data, "sets": []})

    async def bench_honesty(request: Request) -> JSONResponse:
        """``honesty.json`` as committed (``bench verdicts --prereg``): the swarm's wins, ties and
        losses against each rival, the regime map and the derived outcome. 404 until it exists."""
        path = bench_dir / "honesty.json"
        if not path.is_file():
            raise HTTPException(404, "no honesty.json yet; bench verdicts --prereg writes it")
        return JSONResponse(json.loads(path.read_text(encoding="utf-8")))

    def inbox_of(run_id: str) -> Any:
        """The control inbox of a run that is still recording. A finished run (its log is
        exported) and a bundled recording are history: there is nothing left to control. Nor is
        there for an interrupted run, whose process died: nobody would read the request."""
        from fractalswarm.runs import RunPaths

        run = entry_of(run_id)
        status = catalog.status(run, catalog.last(run))
        if run.jsonl.exists() or status in ("completed", "halted"):
            raise HTTPException(409, f"run {run.id!r} is a recording, not a live run")
        if status != "running":
            raise HTTPException(409, f"run {run.id!r} is {status}: no process is recording it")
        return RunPaths(run.path)

    def control_inbox(request: Request) -> Any:
        return inbox_of(request.path_params["run_id"])

    def live_inbox(run_id: str) -> tuple[Any, dict[str, Any]]:
        """The inbox of a live run launched to take a person's controls (``live_control``, which
        the API sets and a CLI run lacks), with the params it started with."""
        inbox = inbox_of(run_id)
        first = catalog.read(entry_of(run_id), 1, 1)
        started = first[0]["payload"] if first and first[0]["type"] == "run.started" else {}
        params = started.get("params") or {}
        if not params.get("live_control"):
            raise HTTPException(
                409, f"run {run_id!r} was not launched to take controls: start it from the API"
            )
        return inbox, params

    def send(inbox: Any, controls: list[dict[str, Any]]) -> None:
        for found in controls:
            inbox.request_control(inbox_request(found))

    def valid(make: Any, *args: Any) -> Any:
        try:
            return make(*args)
        except ControlError as exc:
            raise HTTPException(exc.status, str(exc)) from None

    def waits_for_approval(run_id: str, params: dict[str, Any]) -> None:
        if (params.get("spec") or {}).get("auto_approve", True) is not False:
            raise HTTPException(409, f"run {run_id!r} does not wait for approval (auto_approve)")

    def pair_runs(pair_id: str) -> list[str]:
        try:
            pair = arena.get_pair(need_private()[1], pair_id)
        except JobError as exc:
            raise job_error(exc) from None
        return [pair["left"]["run_id"], pair["right"]["run_id"]]

    def to_pair(pair_id: str, controls: list[dict[str, Any]], needs: Any = None) -> JSONResponse:
        """The same controls to both runs of a pair: each one's own monkey or owner acts. A run
        that cannot take them (finished, or not live) is skipped and named; none that can: 409."""
        answered: dict[str, str] = {}
        for run_id in pair_runs(pair_id):
            try:
                inbox, params = live_inbox(run_id)
                if needs is not None:
                    needs(run_id, params)
            except HTTPException as exc:
                answered[run_id] = f"skipped: {exc.detail}"
                continue
            send(inbox, controls)
            answered[run_id] = "requested"
        if "requested" not in answered.values():
            raise HTTPException(409, "; ".join(f"{run}: {why}" for run, why in answered.items()))
        return JSONResponse({"ok": True, "detail": "controls requested", "runs": answered})

    async def chaos_run(request: Request) -> JSONResponse:
        """A kill at a progress point (``api/controls.py``): ``{"kind", "at"?, "target"?}``."""
        controls = valid(chaos_controls, await _json_body(request))
        inbox, _ = live_inbox(request.path_params["run_id"])
        send(inbox, controls)
        return JSONResponse({"ok": True, "detail": f"{len(controls)} chaos action(s) requested"})

    async def chaos_pair(request: Request) -> JSONResponse:
        controls = valid(chaos_controls, await _json_body(request))
        return to_pair(request.path_params["pair_id"], controls)

    async def approve_run(request: Request) -> JSONResponse:
        """The answer to a plan the run holds for a person: ``{"goal_id"?, "approve", "reason"?}``;
        ``approve: false`` sends the plan back to its planner with ``reason`` as feedback."""
        found = valid(approve_control, await _json_body(request))
        run_id = request.path_params["run_id"]
        inbox, params = live_inbox(run_id)
        waits_for_approval(run_id, params)
        send(inbox, [found])
        return JSONResponse({"ok": True, "detail": f"{found['op']} requested for {found['to']}"})

    async def approve_pair(request: Request) -> JSONResponse:
        found = valid(approve_control, await _json_body(request))
        return to_pair(request.path_params["pair_id"], [found], waits_for_approval)

    def escalation_goal(run: RunEntry, eid: str) -> str | None:
        """The goal an escalation was opened for, from the log: the ``escalation.*`` event that
        carries ``eid`` (as ``eid``, ``escalation_id`` or ``id``) names it in ``goal_id``."""
        seq = 1
        while True:
            page, last_seq = catalog.page(run, seq, MAX_PAGE)
            for event in page:
                payload = event["payload"]
                named = (payload.get("eid"), payload.get("escalation_id"), payload.get("id"))
                if event["type"].startswith("escalation.") and eid in named:
                    goal = payload.get("goal_id") or payload.get("goal")
                    if isinstance(goal, str):
                        return goal
            if not page or page[-1]["seq"] >= last_seq:
                return None
            seq = page[-1]["seq"] + 1

    async def answer_escalation(request: Request) -> JSONResponse:
        """What a person decided for an escalation that waits for one: ``{"choice"}``. The goal
        is the escalation's own, read from the log (``goal_id`` in the body says it if the log
        does not)."""
        body = await _json_body(request)
        run_id, eid = request.path_params["run_id"], request.path_params["eid"]
        if not TOKEN.fullmatch(eid):
            raise HTTPException(422, "the escalation id is not valid")
        inbox, _ = live_inbox(run_id)
        goal = body.get("goal_id") or escalation_goal(entry_of(run_id), eid)
        if not isinstance(goal, str):
            raise HTTPException(404, f"no escalation {eid!r} in run {run_id!r}")
        found = valid(answer_control, eid, goal, body)
        send(inbox, [found])
        return JSONResponse({"ok": True, "detail": f"answer to {eid} requested for {found['to']}"})

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

    def start_intake(body: dict[str, Any], backend: str) -> tuple[str, dict[str, Any]]:
        """Write the pasted text and start its reading. A billed reading (``backend: real``) is
        cleared by the spend gate first; if nothing starts, its token is given back and the text
        is not left behind."""
        private_, jobs_ = need_private()
        approval = None
        if backend == "real":
            approval = need_spend().approve("intake", intake_request_of(body), 1)
        intake_id = new_id("intake")
        try:
            service.create_input(private_, intake_id, body)
            job = jobs.launch_intake(jobs_, intake_id, backend, approval)
        except BaseException:
            if approval is not None:
                approval.undo()
            shutil.rmtree(private_.intake_dir(intake_id), ignore_errors=True)
            raise
        return intake_id, job

    async def preflight_intake_route(request: Request) -> JSONResponse:
        """Price the reading of pasted text with the real model, at its worst case, and hand out
        the token a billed ``POST /api/intake`` needs. Writes nothing."""
        body = await _json_body(request)
        try:
            answer = await anyio.to_thread.run_sync(preflight_intake, need_spend(), body)
        except JobError as exc:
            raise job_error(exc) from None
        return JSONResponse(answer)

    async def create_intake(request: Request) -> JSONResponse:
        need_private()
        body = await _json_body(request)
        backend = body.get("backend", "fake")
        if backend not in ("fake", "real"):
            raise HTTPException(422, "backend must be fake or real")
        try:
            intake_id, job = await anyio.to_thread.run_sync(start_intake, body, backend)
        except service.IntakeError as exc:
            raise HTTPException(422, str(exc)) from None
        except JobError as exc:
            raise job_error(exc) from None
        answer = {"intake_id": intake_id, "job_id": job["id"], "state": "reading", "private": True}
        answer |= {"billed": job["real"], "warnings": job["warnings"]}
        return JSONResponse(answer, status_code=202)

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
        tokens, messages, chaos events, and the task's validity. ``recovery`` is the same
        ``metrics.recovery`` (``bench/recovery.py``): what the coordinators' outages cost, in
        total and one row per outage. A mean over no crashes is null."""
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
        scored = metrics.model_dump()
        return JSONResponse(
            {
                "run_id": run.id,
                "status": catalog.status(run, catalog.last(run)),
                "scenario": names.get(started.get("scenario"), started.get("scenario")),
                "task": task,
                "input": (started.get("params") or {}).get("input"),
                "metrics": scored,
                "recovery": scored["recovery"],
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
        Route("/api/runs/{run_id}/recovery", recovery),
        Route("/api/capabilities", capabilities),
        *lens_routes(catalog),
        Route("/api/bench/results", bench_results),
        Route("/api/bench/honesty", bench_honesty),
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
        Route("/api/intake/preflight", preflight_intake_route, methods=["POST"]),
        Route("/api/intake/sample", intake_sample),
        Route("/api/intake/{intake_id}", get_intake),
        Route("/api/intake/{intake_id}/approve", approve_intake, methods=["POST"]),
        Route("/api/runs/{run_id}/approve", approve_run, methods=["POST"]),
        Route("/api/runs/{run_id}/chaos", chaos_run, methods=["POST"]),
        Route("/api/pairs/{pair_id}/approve", approve_pair, methods=["POST"]),
        Route("/api/pairs/{pair_id}/chaos", chaos_pair, methods=["POST"]),
        Route("/api/runs/{run_id}/budget", shock_budget, methods=["POST"]),
        Route("/api/runs/{run_id}/halt", halt_run, methods=["POST"]),
        Route("/api/runs/{run_id}/escalations/{eid}", answer_escalation, methods=["POST"]),
    ]
    if (static_dir / "index.html").is_file():
        routes.append(Mount("/", StaticFiles(directory=static_dir, html=True)))
    else:
        routes.append(Route("/", ui))
    return Starlette(
        routes=routes,
        exception_handlers={HTTPException: http_error},
        middleware=[Middleware(ApiGuard, hosts=tuple(allowed_hosts))],
    )


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
