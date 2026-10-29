"""The arena: a swarm and a rival on one input, under one failure plan, started together.

``POST /api/arena`` starts two subprocesses (``fractalswarm run``), one per system, with the
same TaskSpec, the same seed, the same approved input and the same ChaosPlan file, so their
``run.started`` events are identical except for the scenario. On the live clock they park at a
start barrier until both have loaded what they need, so the two clocks start together. The pair
is written to ``<private>/pairs/<pair_id>.json`` for the UI to list (``GET /api/pairs``); its
runs are ordinary runs, listed and streamed like any other.
"""

import threading
import time
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fractalswarm.api.jobs import (
    ACTIVE,
    JobError,
    JobManager,
    available_scenarios,
    check_inputs,
    check_spec,
    run_args,
)
from fractalswarm.bench.profiles import half_the_brains_plan
from fractalswarm.comms.chaos import ChaosPlan, build_plan
from fractalswarm.intake.store import new_id, read_json, safe_id, utc_now, write_json
from fractalswarm.runs import BARRIER_GO

RIVALS = ("durable-max", "durable", "central", "single", "pipeline")
DEFAULT_RIVAL = "durable-max"
BARRIER_WAIT_S = 120.0  # how long the launcher waits for both processes to get ready
PLAN_KINDS = ("kill_coordinator", "kill_agents", "partition")  # what the chaos engine runs


def parse_plan(raw: Any) -> ChaosPlan:
    """A ChaosPlan from JSON data, or ``ValueError`` saying which field is wrong. An action
    kind the chaos engine does not know would otherwise end the run when it is reached."""
    try:
        plan = ChaosPlan.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise ValueError(f"{where}: {first['msg']}" if where else first["msg"]) from None
    for index, action in enumerate(plan.actions):
        if action.kind not in PLAN_KINDS:
            raise ValueError(f"actions.{index}.kind: must be one of {', '.join(PLAN_KINDS)}")
    return plan


def half_the_brains(seed: str) -> ChaosPlan:
    """The arena's default plan, built by ``bench/profiles.half_the_brains_plan``: five coordinator
    crashes at the shared progress points. The first hits the root, ``o0``, in every system; the
    others are chosen by the targeting rule (the coordinator with the most remaining work), so
    each system loses what it would miss most. No agent kills and no API faults: the pair
    isolates coordinator recovery."""
    return parse_plan(half_the_brains_plan(seed))


class ArenaRequest(BaseModel):
    """``POST /api/arena``."""

    model_config = ConfigDict(extra="forbid")

    spec: dict[str, Any]
    rival: str | None = None
    chaos: Literal["half-the-brains", "C0", "C1", "C2", "C3"] = "half-the-brains"
    chaos_plan: dict[str, Any] | None = None  # a full ChaosPlan; wins over ``chaos``
    clock: Literal["sim", "live"] = "sim"
    speed: float = Field(default=1.0, gt=0, le=1000)
    backend: Literal["fake", "real"] = "fake"
    pair_id: str | None = None
    budget_usd: float | None = Field(default=None, gt=0)


def rivals_available() -> list[str]:
    scenarios = available_scenarios()
    return [name for name in RIVALS if name in scenarios]


def pick_rival(requested: str | None) -> str:
    available = rivals_available()
    rival = DEFAULT_RIVAL if requested is None else requested
    if rival not in available:
        raise JobError(422, f"rival must be one of {', '.join(available)}")
    return rival


def pick_plan(request: ArenaRequest, seed: str) -> ChaosPlan:
    if request.chaos_plan is not None:
        try:
            return parse_plan(request.chaos_plan)
        except ValueError as exc:
            raise JobError(422, f"chaos_plan: {exc}") from None
    if request.chaos == "half-the-brains":
        return half_the_brains(seed)
    return build_plan(request.chaos, seed)


def launch_arena(manager: JobManager, body: dict[str, Any]) -> dict[str, Any]:
    """Start both runs of a pair as one job. Returns the pair and its job."""
    try:
        request = ArenaRequest.model_validate(body)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise JobError(422, f"{where}: {first['msg']}") from None
    spec = check_spec(request.spec)
    if request.backend != "fake":
        raise JobError(403, "real pairs need the preflight flow (POST /api/tasks/preflight)")
    rival = pick_rival(request.rival)
    plan = pick_plan(request, spec.seed)
    params = check_inputs(manager, spec)
    private = spec.inputs.intake is not None or spec.inputs.inline is not None
    pair_id = request.pair_id or new_id("pair")
    sides = (("left", "swarm", f"{pair_id}-swarm"), ("right", rival, f"{pair_id}-{rival}"))
    try:
        for _, _, run_id in sides:  # a run id is the pair id plus the system's name
            safe_id(run_id, "pair id")
    except ValueError as exc:
        raise JobError(422, str(exc)) from None
    manifest_path = manager.private.pairs / f"{pair_id}.json"

    with manager.lock:
        if manifest_path.exists():
            raise JobError(409, f"pair id {pair_id!r} is already used")
        for _, _, run_id in sides:
            manager.check_run_id(run_id)
        warnings = manager.check_launch(request.clock)
        label = f"swarm vs {rival}, {plan.profile}, seed {spec.seed}"
        job = manager.new_job("arena", label, request.clock, False, private)
        job["pair_id"] = pair_id
        try:
            directory = manager.job_dir(job["id"])
            spec_path = manager.write_spec(job, request.spec)
            plan_path = directory / "chaos-plan.json"
            write_json(plan_path, plan.model_dump(mode="json"))
            barrier = directory / "barrier" if request.clock == "live" else None
            runs = {}
            for side, scenario, run_id in sides:
                args = run_args(
                    spec_path,
                    run_id,
                    scenario=scenario,
                    clock=request.clock,
                    speed=request.speed,
                    budget_usd=request.budget_usd,
                    plan=plan_path,
                    barrier=barrier,
                )
                runs[side] = manager.spawn(
                    job, run_id=run_id, role=side, scenario=scenario, args=args, private=private
                )
        except BaseException:
            manager.abort_launch(job)
            raise
        shown = manager.finish_launch(job, warnings)
        manifest = {
            "pair_id": pair_id,
            "created_at": utc_now(),
            "job_id": job["id"],
            "label": label,
            "seed": spec.seed,
            "clock": request.clock,
            "speed": request.speed,
            "private": private,
            "rival": rival,
            "chaos": {"name": plan.profile, "actions": len(plan.actions)},
            "input": params.get("input"),
            **{
                side: {
                    "run_id": run["run_id"],
                    "scenario": run["scenario"],
                    "dir": run["dir"],
                    "private": private,
                }
                for side, run in runs.items()
            },
        }
        write_json(manifest_path, manifest)

    if barrier is not None:
        threading.Thread(
            target=release_when_ready,
            args=(manager, job["id"], barrier, [run_id for _, _, run_id in sides]),
            name=f"barrier-{pair_id}",
            daemon=True,
        ).start()
    return {
        "pair_id": pair_id,
        "job_id": job["id"],
        "left": manifest["left"]["run_id"],
        "right": manifest["right"]["run_id"],
        "state": shown["state"],
        "private": private,
        "warnings": warnings,
        "pair": pair_view(manager, manifest),
        "job": shown,
    }


def release_when_ready(
    manager: JobManager,
    job_id: str,
    barrier: Path,
    run_ids: list[str],
    timeout_s: float | None = None,
) -> None:
    """Say ``go`` once every process of the pair has written its ``.ready`` file. If one dies
    first, or they take too long, stop the pair instead of leaving the other parked."""
    deadline = time.monotonic() + (BARRIER_WAIT_S if timeout_s is None else timeout_s)
    ready = [barrier / f"{run_id}.ready" for run_id in run_ids]
    while time.monotonic() < deadline:
        job = manager.jobs.get(job_id)
        if job is None or job["state"] == "cancelled":
            return  # there is nobody to release
        if all(path.exists() for path in ready):
            if manager.view_state(job)["state"] in ACTIVE:
                (barrier / BARRIER_GO).write_text("go", encoding="utf-8")
            return
        gone = [run["run_id"] for run in job["runs"] if not manager.alive(job, run)]
        if gone:
            manager.fail(job, f"{gone[0]} ended before the start barrier: see its log")
            return
        time.sleep(0.1)
    job = manager.jobs.get(job_id)
    if job is not None and job["state"] != "cancelled":
        manager.fail(job, "the pair did not get ready for the start barrier in time")


# -- reading pairs -------------------------------------------------------------------------


def pair_view(manager: JobManager, manifest: dict[str, Any]) -> dict[str, Any]:
    """The manifest with each side's run status and the job's state, as of now."""
    job = manager.jobs.get(manifest["job_id"])
    sides = {
        side: manifest[side] | {"status": manager.run_status(manifest[side])}
        for side in ("left", "right")
    }
    state = manager.view_state(job)["state"] if job is not None else "unknown"
    return manifest | sides | {"state": state, "warnings": job["warnings"] if job else []}


def list_pairs(manager: JobManager) -> list[dict[str, Any]]:
    found = []
    for path in manager.private.pairs.glob("*.json"):
        manifest = read_json(path)
        if isinstance(manifest, dict) and "pair_id" in manifest:
            found.append(manifest)
    found.sort(key=lambda m: (m["created_at"], m["pair_id"]), reverse=True)
    return [pair_view(manager, manifest) for manifest in found]


def get_pair(manager: JobManager, pair_id: str) -> dict[str, Any]:
    try:
        manifest = read_json(manager.private.pairs / f"{safe_id(pair_id, 'pair id')}.json")
    except ValueError:
        manifest = None
    if not isinstance(manifest, dict):
        raise JobError(404, f"no pair {pair_id!r}")
    return pair_view(manager, manifest)
