"""The job manager: the runs the API starts.

Every run is its own subprocess (``fractalswarm run`` / ``fractalswarm intake``), never inside
the API's event loop: a live-clock run is timing-sensitive, and a crash or a kill must take
only that run. A job is one or two of those processes (an arena pair is two). Jobs persist in
the private directory (``jobs/<id>/job.json``, the spec and a log per process), so a restarted
API still lists them; what it cannot do after a restart is signal a process it did not start
by handle, so it falls back on the pid the run keeps in its ``LIVE`` file.

State is derived, not stored twice: a job is ``completed`` when every run it started has ended
(``run.completed`` in its log, which a halted run also has), ``failed`` when every process is
gone and some run did not end, ``interrupted`` when it was running before a restart and its
``LIVE`` files went stale, ``cancelled`` after ``cancel``.

Limits: at most one live-clock job at a time (the timing would be wrong otherwise), a warning
when the CPU is busy, and a cap on active jobs.
"""

import asyncio
import contextlib
import copy
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fractalswarm.api.catalog import Catalog, RunEntry
from fractalswarm.config import CONFIG_DIR
from fractalswarm.intake.pseudonym import Pseudonyms
from fractalswarm.intake.store import PrivateDir, new_id, read_json, safe_id, utc_now, write_json
from fractalswarm.planning.taskspec import TaskSpec, resolve_path, run_params
from fractalswarm.runs import RunPaths

REPO_ROOT = CONFIG_DIR.parent
LAUNCH = [sys.executable, "-c", "from fractalswarm.cli import app; app()"]
MAX_ACTIVE = 8
CANCEL_GRACE_S = 10.0  # how long a halt request gets before the process tree is killed
HIGH_CPU_PERCENT = 80.0
LOG_TAIL_BYTES = 4000
ACTIVE = ("starting", "running")
# A job outlives the server and its Ctrl+C: it ends by cancel, halt or its own end.
DETACHED: dict[str, Any] = (
    {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    if os.name == "nt"
    else {"start_new_session": True}
)


class JobError(Exception):
    """A request the manager refuses: the HTTP status and why."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# -- the machine ---------------------------------------------------------------------------


def cpu_percent(window_s: float = 0.25) -> float | None:
    """How busy the machine is, sampled over ``window_s`` (``None`` when it cannot be told)."""
    try:
        if os.name == "nt":
            return _cpu_windows(window_s)
        return min(100.0, os.getloadavg()[0] / (os.cpu_count() or 1) * 100)
    except (OSError, AttributeError):
        return None


def _cpu_windows(window_s: float) -> float | None:
    import ctypes

    class FileTime(ctypes.Structure):
        _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]

    def sample() -> tuple[int, int]:
        idle, kernel, user = FileTime(), FileTime(), FileTime()
        ok = ctypes.windll.kernel32.GetSystemTimes(  # type: ignore[attr-defined]
            ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
        )
        if not ok:
            raise OSError("GetSystemTimes failed")
        value = lambda t: (t.high << 32) | t.low  # noqa: E731
        return value(idle), value(kernel) + value(user)  # kernel time includes idle time

    idle_before, total_before = sample()
    time.sleep(window_s)
    idle_after, total_after = sample()
    total = total_after - total_before
    return None if total <= 0 else 100.0 * (1 - (idle_after - idle_before) / total)


def kill_tree(pid: int) -> None:
    """Kill a process and its children. On Windows the venv's ``python.exe`` is a launcher that
    starts the real interpreter as a child, so the Popen pid alone is not the run."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
        return
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(os.getpgid(pid), signal.SIGKILL)


# -- the manager ---------------------------------------------------------------------------


class JobManager:
    def __init__(self, private: PrivateDir, runs_dir: Path, catalog: Catalog) -> None:
        self.private = private
        self.runs_dir = runs_dir
        self.catalog = catalog
        self.procs: dict[tuple[str, str], subprocess.Popen] = {}
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()  # a launch checks the limits and starts the process as one
        self._load()

    # -- persistence ------------------------------------------------------------------------

    def _load(self) -> None:
        for record in sorted(self.private.jobs.glob("*/job.json")):
            job = read_json(record)
            if isinstance(job, dict) and "id" in job:
                self.jobs[job["id"]] = job

    def _save(self, job: dict[str, Any]) -> None:
        write_json(self.private.jobs / job["id"] / "job.json", job)

    def job_dir(self, job_id: str) -> Path:
        return self.private.jobs / safe_id(job_id, "job id")

    # -- queries ----------------------------------------------------------------------------

    def get(self, job_id: str) -> dict[str, Any]:
        try:
            job = self.jobs[safe_id(job_id, "job id")]
        except (KeyError, ValueError):
            raise JobError(404, f"no job {job_id!r}") from None
        return self.view(job)

    def listing(self) -> list[dict[str, Any]]:
        newest_first = sorted(self.jobs.values(), key=lambda j: j["created_at"], reverse=True)
        return [self.view(job, tail=False) for job in newest_first]

    def active(self) -> list[dict[str, Any]]:
        return [job for job in map(self.view_state, self.jobs.values()) if job["state"] in ACTIVE]

    def view(self, job: dict[str, Any], tail: bool = True) -> dict[str, Any]:
        """The job as the API shows it: its record, its state, and each run's status."""
        found = self.view_state(job)
        runs = []
        for run in found["runs"]:
            shown = run | {"status": self.run_status(run)}
            if tail:
                shown["log_tail"] = self._tail(self.job_dir(job["id"]) / run["log"])
            runs.append(shown)
        return found | {"runs": runs}

    def view_state(self, job: dict[str, Any]) -> dict[str, Any]:
        """The record with ``state`` and each run's ``exit_code`` brought up to date."""
        changed = False
        for run in job["runs"]:
            proc = self.procs.get((job["id"], run["run_id"]))
            if proc is not None and run.get("exit_code") is None:
                run["exit_code"] = proc.poll()
                changed = changed or run["exit_code"] is not None
        state = self._state(job)
        if state != job["state"]:
            job["state"] = state
            if state not in ACTIVE:
                job["finished_at"] = utc_now()
            changed = True
        if changed:
            self._save(job)
        return job

    def run_status(self, run: dict[str, Any]) -> str:
        """The run's catalog status, read from the directory the job started it in."""
        path = Path(run["dir"])
        if not (path / "events.sqlite").exists() and not (path / "events.jsonl").exists():
            return "empty"
        entry = RunEntry(run["run_id"], "runs", path)
        return self.catalog.status(entry, self.catalog.last(entry))

    def _state(self, job: dict[str, Any]) -> str:
        if job["state"] in ("cancelled", "completed", "failed", "interrupted"):
            return job["state"]
        statuses = [self.run_status(run) for run in job["runs"]]
        if all(status in ("completed", "halted") for status in statuses):
            return "completed"
        started = {run["run_id"] for run in job["runs"] if (job["id"], run["run_id"]) in self.procs}
        if started and all(run.get("exit_code") is not None for run in job["runs"]):
            return "failed"  # every process is gone and some run never ended
        if not started:  # a job from before a restart: only the LIVE files say if it goes on
            return "interrupted" if "interrupted" in statuses or "empty" in statuses else "running"
        return "starting" if all(status == "empty" for status in statuses) else "running"

    @staticmethod
    def _tail(path: Path) -> str:
        try:
            with path.open("rb") as handle:
                handle.seek(0, os.SEEK_END)
                handle.seek(max(0, handle.tell() - LOG_TAIL_BYTES))
                return handle.read().decode("utf-8", errors="replace")
        except OSError:
            return ""

    # -- launching --------------------------------------------------------------------------

    def check_launch(self, clock: str, real: bool = False) -> list[str]:
        """Refuse what the machine should not take on; return the warnings for what it can."""
        active = self.active()
        if len(active) >= MAX_ACTIVE:
            raise JobError(429, f"{len(active)} jobs are running: wait for one to end")
        warnings: list[str] = []
        if clock == "live":
            live = [job["id"] for job in active if job["clock"] == "live"]
            if live:
                raise JobError(409, f"job {live[0]} runs on the live clock: only one at a time")
            load = cpu_percent()
            if load is not None and load >= HIGH_CPU_PERCENT:
                warnings.append(
                    f"the CPU is at {load:.0f}%: a live-clock run may miss heartbeats and look "
                    "like it lost members; close other work or use the sim clock"
                )
        if real:
            real_jobs = [job["id"] for job in active if job["real"]]
            if real_jobs:
                raise JobError(409, f"job {real_jobs[0]} is spending real money: one at a time")
        return warnings

    def new_job(self, kind: str, label: str, clock: str, real: bool, private: bool) -> dict:
        job_id = new_id("job")
        job = {
            "id": job_id,
            "kind": kind,
            "label": label,
            "created_at": utc_now(),
            "finished_at": None,
            "state": "starting",
            "clock": clock,
            "real": real,
            "private": private,
            "runs": [],
            "warnings": [],
            "pair_id": None,
        }
        self.job_dir(job_id).mkdir(parents=True, exist_ok=False)
        self.jobs[job_id] = job
        return job

    def run_dir(self, run_id: str, private: bool) -> Path:
        return (self.private.runs if private else self.runs_dir) / run_id

    def check_run_id(self, run_id: str) -> None:
        try:
            safe_id(run_id, "run id")
        except ValueError as exc:
            raise JobError(422, str(exc)) from None
        taken = (self.runs_dir / run_id, self.private.runs / run_id, self.private.intake / run_id)
        if any(path.exists() for path in taken) or any(
            run["run_id"] == run_id for job in self.jobs.values() for run in job["runs"]
        ):
            raise JobError(409, f"run id {run_id!r} is already used")

    def spawn(
        self,
        job: dict[str, Any],
        *,
        run_id: str,
        role: str,
        scenario: str,
        args: list[str],
        private: bool,
        runs_dir: Path | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Start one process of the job: ``fractalswarm <args>``. Its run lands in the private
        runs directory (or the API's), through ``FRACTALSWARM_RUNS_DIR``."""
        target = runs_dir or (self.private.runs if private else self.runs_dir)
        target.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["FRACTALSWARM_RUNS_DIR"] = str(target)
        env["FRACTALSWARM_PRIVATE_DIR"] = str(self.private.root)
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env |= extra_env or {}
        log_name = f"{role}-{run_id}.log"
        with (self.job_dir(job["id"]) / log_name).open("ab") as log:
            proc = subprocess.Popen(
                [*LAUNCH, *args],
                cwd=REPO_ROOT,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                **DETACHED,
            )
        run = {
            "run_id": run_id,
            "role": role,
            "scenario": scenario,
            "dir": str(target / run_id),
            "pid": proc.pid,
            "log": log_name,
            "exit_code": None,
        }
        self.procs[(job["id"], run_id)] = proc
        job["runs"].append(run)
        return run

    def finish_launch(self, job: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
        job["warnings"] = warnings
        self._save(job)
        return self.view(job)

    # -- cancelling -------------------------------------------------------------------------

    async def cancel(self, job_id: str) -> dict[str, Any]:
        """Ask the job's runs to halt (the kill switch: a complete log ending in
        ``run.halted``), then kill whatever is still there after a grace period."""
        job = self.jobs.get(job_id)
        if job is None:
            raise JobError(404, f"no job {job_id!r}")
        if self.view_state(job)["state"] not in ACTIVE:
            raise JobError(409, f"job {job_id} is {job['state']}: nothing to cancel")
        halting = [run for run in job["runs"] if self.run_status(run) == "running"]
        for run in halting:
            RunPaths(Path(run["dir"])).request_control(
                {"op": "halt", "reason": "cancelled from the API", "by": "human"}
            )
        for run in job["runs"]:
            if run not in halting and self._alive_run(job, run):  # no log yet: nothing to halt
                self._kill(job, run)
        deadline = time.monotonic() + CANCEL_GRACE_S
        while time.monotonic() < deadline and any(self._alive_run(job, run) for run in halting):
            await asyncio.sleep(0.2)
        for run in halting:
            if self._alive_run(job, run):
                self._kill(job, run)
        await asyncio.sleep(0.1)
        job["state"] = "cancelled"
        job["finished_at"] = utc_now()
        self.view_state(job)
        self._save(job)
        return self.view(job)

    def _kill(self, job: dict[str, Any], run: dict[str, Any]) -> None:
        """Kill a run's process tree, and clear its ``LIVE`` marker so the run reads as
        interrupted now instead of running for another few seconds."""
        kill_tree(self._pid_of(job, run))
        (Path(run["dir"]) / "LIVE").unlink(missing_ok=True)

    def _alive_run(self, job: dict[str, Any], run: dict[str, Any]) -> bool:
        proc = self.procs.get((job["id"], run["run_id"]))
        if proc is not None:
            return proc.poll() is None
        return self.run_status(run) == "running"  # not ours: its LIVE file decides

    def _pid_of(self, job: dict[str, Any], run: dict[str, Any]) -> int:
        """The pid to kill: the Popen's, or what the run's own LIVE file says."""
        proc = self.procs.get((job["id"], run["run_id"]))
        if proc is not None:
            return proc.pid
        try:
            return int((Path(run["dir"]) / "LIVE").read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            return run["pid"]


# -- the launch API ------------------------------------------------------------------------


class TaskRequest(BaseModel):
    """``POST /api/tasks``: a TaskSpec and how to run it."""

    model_config = ConfigDict(extra="forbid")

    spec: dict[str, Any]
    scenario: Literal["swarm", "central", "single", "pipeline"] = "swarm"
    chaos: Literal["C0", "C1", "C2", "C3", "kill-half"] = "C0"
    clock: Literal["sim", "live"] = "sim"
    speed: float = Field(default=1.0, gt=0, le=1000)
    backend: Literal["fake", "real"] = "fake"
    run_id: str | None = None
    budget_usd: float | None = Field(default=None, gt=0)
    cross_audit: bool = False
    feasibility_report: bool = False


def parse_request(body: dict[str, Any]) -> tuple[TaskRequest, TaskSpec]:
    """The request and its TaskSpec, or ``JobError(422)`` saying what is wrong."""
    try:
        request = TaskRequest.model_validate(body)
        spec = TaskSpec.model_validate(request.spec)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise JobError(422, f"{where}: {first['msg']}") from None
    inputs = spec.inputs
    if inputs.fixture is not None:
        found = resolve_path(inputs.fixture, REPO_ROOT).resolve()
        if not found.is_relative_to(REPO_ROOT):
            raise JobError(422, "inputs.fixture must be a directory inside the repository")
    given = [inputs.fixture, inputs.inline, inputs.intake]
    if spec.task in ("t1_extraction", "t2_conference") and all(g is None for g in given):
        raise JobError(422, "give the input: inputs.fixture, inputs.inline or inputs.intake")
    return request, spec


def check_inputs(manager: JobManager, spec: TaskSpec) -> None:
    """Build the run's params once here, so a bad input is refused with its reason instead of
    ending a process that has already started."""
    try:
        run_params(spec, manager.private.root)
    except FileNotFoundError as exc:
        raise JobError(409 if spec.inputs.intake else 422, str(exc)) from None
    except ValueError as exc:
        raise JobError(422, str(exc)) from None


def launch_run(manager: JobManager, body: dict[str, Any]) -> dict[str, Any]:
    """Start a run on the fake backend as a job: ``fractalswarm run`` in its own process."""
    request, spec = parse_request(body)
    if request.backend != "fake":
        raise JobError(403, "real runs need the preflight flow (POST /api/tasks/preflight)")
    private = spec.inputs.intake is not None or spec.inputs.inline is not None
    check_inputs(manager, spec)
    run_id = request.run_id or new_id("ui")
    with manager.lock:
        manager.check_run_id(run_id)
        warnings = manager.check_launch(request.clock)
        label = f"{request.scenario} {request.chaos} seed {spec.seed}"
        job = manager.new_job("run", label, request.clock, False, private)
        spec_path = write_spec(manager, job, request)
        args = run_args(request, spec_path, run_id)
        manager.spawn(
            job,
            run_id=run_id,
            role="run",
            scenario=request.scenario,
            args=args,
            private=private,
        )
        return manager.finish_launch(job, warnings)


def write_spec(manager: JobManager, job: dict[str, Any], request: TaskRequest) -> Path:
    """The TaskSpec as the CLI reads it. Email addresses in an inline corpus are replaced
    first (the mapping stays next to it), so no file of the job holds one."""
    data = copy.deepcopy(request.spec)
    inline = (data.get("inputs") or {}).get("inline")
    directory = manager.job_dir(job["id"])
    if isinstance(inline, dict) and "corpus" in inline:
        pseudonyms = Pseudonyms()
        inline["corpus"] = pseudonyms.mask_value(inline["corpus"])
        write_json(directory / "pseudonyms.json", pseudonyms.mapping())
    write_json(directory / "spec.json", data)
    return directory / "spec.json"


def run_args(request: TaskRequest, spec_path: Path, run_id: str) -> list[str]:
    args = ["run", str(spec_path), "--run-id", run_id, "--scenario", request.scenario]
    args += ["--chaos", request.chaos, "--clock", request.clock, "--speed", str(request.speed)]
    args += ["--backend", request.backend]
    if request.budget_usd is not None:
        args += ["--budget-usd", str(request.budget_usd)]
    if request.cross_audit:
        args.append("--cross-audit")
    if request.feasibility_report:
        args.append("--feasibility-report")
    return args


def launch_intake(manager: JobManager, intake_id: str, backend: str = "fake") -> dict[str, Any]:
    """Start the ``intake`` scenario on an intake whose ``input.json`` is written."""
    with manager.lock:
        warnings = manager.check_launch("sim", real=backend == "real")
        job = manager.new_job("intake", f"intake {intake_id}", "sim", backend == "real", True)
        manager.spawn(
            job,
            run_id=intake_id,
            role="intake",
            scenario="intake",
            args=["intake", intake_id, "--backend", backend],
            private=True,
            runs_dir=manager.private.intake,
        )
        return manager.finish_launch(job, warnings)
