"""Real spend from the UI: the preflight, its token, and the gate a billed launch passes.

Everything that can start a billed run from the API is in this file. A launch with
``backend: real`` goes through only if every one of these holds, and a refusal says which
one failed:

1. the request carries the token of a preflight made for this very request (same spec, same
   input, same plan and settings), so the worst case the preflight priced is the one about to
   be reserved. A token is used once and expires;
2. the server was started with ``FRACTALSWARM_ALLOW_UI_REAL`` and has a model key;
3. the caller typed the word ``SPEND``;
4. the run cap is at most $0.75 (a reading of pasted text, $0.25);
5. the worst case still fits under the project cap and under the phase cap, counting what the
   ledger holds now (settled spend plus open reservations), not what it held at the preflight;
6. no other billed job is running (``JobManager.check_launch``).

The processes then run with ``--confirm-real-spend --no-paid-retries`` (a request that may
have been billed is never sent twice) and the run cap, on the shared ledger. Nothing here
calls the model or reserves anything: the preflight prices requests with the price table and
only reads the ledger (it does not even open one that does not exist yet).

Three things can be billed: a task (``POST /api/tasks``), a pair (``POST /api/arena``) and the
reading of pasted text (``POST /api/intake``). The text is private: a preflight reads it to price
it and keeps only a fingerprint of it, in memory, with the token.
"""

import hashlib
import json
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fractalswarm.api.arena import parse_arena
from fractalswarm.api.jobs import Approval, JobError, JobManager, check_inputs, parse_request
from fractalswarm.bench.profiles import CRASH_POINTS
from fractalswarm.comms.chaos import ChaosPlan, build_plan
from fractalswarm.config import Settings
from fractalswarm.llm.client import LLMClient
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.ledger import EPSILON, ProjectLedger
from fractalswarm.market.prices import PriceTable
from fractalswarm.planning.taskspec import TaskSpec

RUN_CAP_USD = 0.75  # every billed run started from the UI is capped here
INTAKE_CAP_USD = 0.25  # one reading of pasted text: ``cli.INTAKE_RUN_CAP_USD`` (a test ties them)
CONFIRM_WORD = "SPEND"
TOKEN_TTL_S = 600.0
# The phase cap counts from what was settled when the phase began (Oct 28), and the
# coordinator's hard stop sits just under it.
PHASE_START_USD = 11.82
PHASE_CAP_USD = 50.0
HARD_STOP_USD = 61.8
LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
NOT_IN_DIGEST = ("backend", "run_id", "pair_id", "preflight_token", "confirm")
PREFLIGHT = {
    "task": "/api/tasks/preflight",
    "arena": "/api/arena/preflight",
    "intake": "/api/intake/preflight",
}
PREFLIGHT_ATTEMPTS = 2  # every call twice, as the bench pre-flight prices it
PREFLIGHT_STEP_CHARS = 2_000  # what one tool turn adds to an agent's input
PREFLIGHT_FEEDBACK_CHARS = 600  # the parse errors a second reading of pasted text is sent


@dataclass(frozen=True)
class SpendGate:
    """What the server lets a billed launch spend, and the ledger it is counted in."""

    ledger_path: Path
    project_cap_usd: float
    allow_real: bool = False
    has_key: bool = True
    phase_start_usd: float = PHASE_START_USD
    phase_cap_usd: float = PHASE_CAP_USD
    hard_stop_usd: float = HARD_STOP_USD

    @classmethod
    def from_settings(cls, settings: Settings) -> "SpendGate":
        return cls(
            ledger_path=settings.ledger_path,
            project_cap_usd=settings.project_cap_usd,
            allow_real=settings.allow_ui_real,
            has_key=settings.model_api_key is not None,
        )

    @classmethod
    def locked(cls, ledger_path: Path) -> "SpendGate":
        """No billed launch at all: what an app gets when it is not given a gate."""
        return cls(ledger_path=ledger_path, project_cap_usd=0.0, allow_real=False, has_key=False)

    def refuse_exposed(self, host: str) -> None:
        """Raise ``ValueError`` if this gate would spend for whoever can reach ``host``. The
        token and the word are for a person's slip, not for a stranger: the API hands out both."""
        if self.allow_real and host not in LOOPBACK_HOSTS:
            raise ValueError(
                f"FRACTALSWARM_ALLOW_UI_REAL is on, so the server must listen on a loopback "
                f"address (not {host}): anyone who can reach it could start a billed run"
            )

    def standing(self) -> dict[str, float]:
        """Settled and reserved spend in the ledger now. A ledger that does not exist yet holds
        nothing, and this never creates it."""
        settled = reserved = 0.0
        if self.ledger_path.exists():
            summary = ProjectLedger(self.ledger_path, self.project_cap_usd).summary()
            settled, reserved = summary.spent_usd, summary.reserved_usd
        committed = settled + reserved
        phase_left = min(self.phase_start_usd + self.phase_cap_usd, self.hard_stop_usd)
        return {
            "settled_usd": settled,
            "reserved_usd": reserved,
            "committed_usd": committed,
            "project_cap_usd": self.project_cap_usd,
            "project_remaining_usd": self.project_cap_usd - committed,
            "phase_start_usd": self.phase_start_usd,
            "phase_cap_usd": self.phase_cap_usd,
            "phase_spent_usd": committed - self.phase_start_usd,
            "phase_remaining_usd": phase_left - committed,
        }

    def server_refusals(self) -> list[str]:
        reasons = []
        if not self.allow_real:
            reasons.append(
                "real runs from the UI are off: start the server with FRACTALSWARM_ALLOW_UI_REAL=1"
            )
        if not self.has_key:
            reasons.append("MODEL_API_KEY is not set in ~/.fractalswarm/.env")
        return reasons

    def cap_refusals(self, worst_case_usd: float, standing: dict[str, float]) -> list[str]:
        reasons = []
        for name, room in (
            ("project", standing["project_remaining_usd"]),
            ("phase", standing["phase_remaining_usd"]),
        ):
            if worst_case_usd > room + EPSILON:
                reasons.append(
                    f"the worst case ${worst_case_usd:.2f} does not fit under the {name} cap: "
                    f"${max(room, 0.0):.2f} left"
                )
        return reasons


@dataclass
class Issued:
    digest: str
    worst_case_usd: float
    expires_at: float


class Preflights:
    """The tokens handed out by preflights. In memory: a restart voids them, and the answer
    is to run the preflight again."""

    def __init__(
        self, ttl_s: float = TOKEN_TTL_S, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.ttl_s = ttl_s
        self.clock = clock
        self.issued: dict[str, Issued] = {}
        self.lock = threading.Lock()

    def issue(self, digest: str, worst_case_usd: float) -> str:
        token = secrets.token_urlsafe(16)
        now = self.clock()
        with self.lock:
            self.issued = {t: i for t, i in self.issued.items() if i.expires_at > now}
            self.issued[token] = Issued(digest, worst_case_usd, now + self.ttl_s)
        return token

    def redeem(self, token: str, digest: str) -> Issued:
        """Take the token out for this request, or ``JobError(403)`` saying why not."""
        with self.lock:
            found = self.issued.get(token)
            if found is None or found.expires_at <= self.clock():
                self.issued.pop(token, None)
                raise JobError(
                    403, "the preflight token is unknown, used or expired: run the preflight again"
                )
            if found.digest != digest:
                raise JobError(
                    403,
                    "the preflight token was issued for a different request: "
                    "run the preflight again",
                )
            del self.issued[token]
        return found

    def restore(self, token: str, issued: Issued) -> None:
        """Give a token back: the launch it was redeemed for did not start anything."""
        with self.lock:
            self.issued[token] = issued


def digest_of(kind: str, request: dict[str, Any]) -> str:
    """A fingerprint of everything that decides what a launch runs and costs. The name of the
    run, the backend and the proofs themselves are not part of it."""
    fields = {key: value for key, value in request.items() if key not in NOT_IN_DIGEST}
    blob = json.dumps(
        {"kind": kind, **fields}, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.blake2b(blob.encode("utf-8"), digest_size=16).hexdigest()


# -- pricing -------------------------------------------------------------------------------


class _NoBackend:
    async def send(self, effect_id: str, body: dict[str, Any], sleep: Any) -> Any:
        raise RuntimeError("the preflight never calls the LLM")


def agent_steps(contract: Any, max_steps: int) -> list[dict[str, Any]]:
    """The requests of an agent loop that runs to ``max_steps``, its input growing each turn."""
    from fractalswarm.actors.agent import contract_prompt, llm_request

    prompt = contract_prompt(contract)
    return [
        llm_request(
            contract, [{"role": "user", "content": prompt + "x" * (PREFLIGHT_STEP_CHARS * step)}]
        )
        for step in range(max_steps)
    ]


def t2_requests(spec: TaskSpec, params: dict[str, Any], crashes: int) -> list[dict[str, Any]]:
    """The requests of one T2 run at their worst, on this corpus: every planning call twice,
    every contract's agent loop at ``max_steps`` twice, every judge call twice, and each
    coordinator crash redoing one contract per session (the bench pre-flight, on the input
    the run will read)."""
    from fractalswarm.bench.tasks.t2_conference.task import T2
    from fractalswarm.verify.judge import judge_request

    root = {"id": "root", "goal": spec.goal, "corpus": params["corpus"], "truth": params["truth"]}
    requests: list[dict[str, Any]] = [T2.root_request(root, [])]
    plan = T2.root_fallback(root)
    agent_calls: list[dict[str, Any]] = []
    for track in T2.root_children(root, plan):
        requests.append(T2.split_request(track, []))
        for session in T2.split_children(track, T2.split_fallback(track)):
            requests.append(T2.contracts_request(session, []))
            contracts = T2.contracts(session, T2.contracts_fallback(session), "o", "scope")
            for contract in contracts:
                agent_calls += agent_steps(contract, spec.max_steps)
                if T2.needs_judge(contract):
                    requests.append(judge_request(contract, {}, contract.inputs.get("data", {})))
    sessions = T2.sessions(params["corpus"])
    every = [*requests, *agent_calls] * PREFLIGHT_ATTEMPTS
    return every + agent_calls[: sessions * spec.max_steps] * crashes


def price(requests: list[dict[str, Any]]) -> float:
    client = LLMClient(
        _NoBackend(),  # type: ignore[arg-type]
        roles=RoleTable.load(),
        prices=PriceTable.load(),
        mode="live",
    )
    return sum(client.estimate(request) for request in requests)


def crashes_of(chaos: str, seed: str) -> int:
    if chaos == "kill-half":
        return len(CRASH_POINTS)
    return sum(1 for a in build_plan(chaos, seed).actions if a.kind == "kill_coordinator")


def plan_crashes(plan: ChaosPlan) -> int:
    return sum(1 for action in plan.actions if action.kind == "kill_coordinator")


# -- the gate ------------------------------------------------------------------------------


class Spend:
    """The gate and the tokens of one API."""

    def __init__(self, gate: SpendGate, preflights: Preflights | None = None) -> None:
        self.gate = gate
        self.preflights = preflights or Preflights()

    @classmethod
    def from_settings(cls, settings: Settings) -> "Spend":
        return cls(SpendGate.from_settings(settings))

    @classmethod
    def locked(cls, directory: Path) -> "Spend":
        """No billed launch at all, and no ledger to read."""
        return cls(SpendGate.locked(directory / "no-ledger.sqlite"))

    def preflight(
        self,
        kind: str,
        request: dict[str, Any],
        requests: list[dict[str, Any]],
        runs: int,
        cap: float,
    ) -> dict[str, Any]:
        """Price a launch at its worst case and say whether it may go. ``request`` is the
        parsed launch request, ``requests`` the LLM requests one run sends at their worst and
        ``cap`` the cap of each run. A token comes back only when nothing stands in the way."""
        each = price(requests)
        worst = runs * min(each, cap)
        standing = self.gate.standing()
        refusals = self.gate.server_refusals() + self.gate.cap_refusals(worst, standing)
        token = None
        if not refusals:
            token = self.preflights.issue(digest_of(kind, request), worst)
        return {
            "ok": not refusals,
            "token": token,
            "expires_in_s": self.preflights.ttl_s if token else None,
            "confirm_word": CONFIRM_WORD,
            "kind": kind,
            "runs": runs,
            "calls_per_run": len(requests),
            "estimate_usd_per_run": each,
            "run_cap_usd": cap,
            "worst_case_usd": worst,
            "standing": standing,
            "refusals": refusals,
        }

    def approve(self, kind: str, request: dict[str, Any], runs: int) -> Approval:
        """Clear a billed launch or refuse it with ``JobError``. ``request`` is the parsed
        launch request, with its ``preflight_token`` and ``confirm``. The token is redeemed
        here; the launch gives it back through ``undo`` if it starts nothing."""
        token = request.get("preflight_token")
        if not token:
            raise JobError(403, f"real runs need the preflight flow (POST {PREFLIGHT[kind]})")
        reasons = self.gate.server_refusals()
        if reasons:
            raise JobError(403, reasons[0])
        if request.get("confirm") != CONFIRM_WORD:
            raise JobError(403, f"type {CONFIRM_WORD} to confirm that this run is billed")
        cap = cap_of(kind, request)
        issued = self.preflights.redeem(token, digest_of(kind, request))

        def undo() -> None:
            self.preflights.restore(token, issued)

        try:
            reasons = self.gate.cap_refusals(issued.worst_case_usd, self.gate.standing())
        except BaseException:  # the ledger could not be read: nothing starts, the token is kept
            undo()
            raise
        if reasons:
            undo()
            raise JobError(409, reasons[0])
        env = {
            "FRACTALSWARM_LEDGER_PATH": str(self.gate.ledger_path),
            "FRACTALSWARM_PROJECT_CAP_USD": str(self.gate.project_cap_usd),
        }
        return Approval(run_cap_usd=cap, env=env, undo=undo)


def run_cap(request: dict[str, Any]) -> float:
    """The cap of each billed run: the request's own, up to $0.75."""
    cap = request.get("budget_usd") or RUN_CAP_USD
    if cap > RUN_CAP_USD:
        raise JobError(422, f"a run started from the UI is capped at ${RUN_CAP_USD:.2f}")
    return float(cap)


def cap_of(kind: str, request: dict[str, Any]) -> float:
    """The cap of each run of a launch of this kind. A reading of pasted text has no cap of its
    own to ask for: it runs with the CLI's."""
    return INTAKE_CAP_USD if kind == "intake" else run_cap(request)


def preflight_t2(
    spend: Spend,
    kind: str,
    request: dict[str, Any],
    spec: TaskSpec,
    params: dict[str, Any],
    crashes: int,
    runs: int,
) -> dict[str, Any]:
    if spec.task != "t2_conference":
        raise JobError(422, "billed runs from the UI are for the conference task (t2_conference)")
    cap = cap_of(kind, request)  # before the pricing: a cap that is too high is refused at once
    return spend.preflight(kind, request, t2_requests(spec, params, crashes), runs, cap)


def preflight_task(spend: Spend, manager: JobManager, body: dict[str, Any]) -> dict[str, Any]:
    """``POST /api/tasks/preflight``: the body of ``POST /api/tasks``."""
    request, spec = parse_request(body)
    params = check_inputs(manager, spec)
    crashes = crashes_of(request.chaos, spec.seed)
    fields = request.model_dump(mode="json")
    return preflight_t2(spend, "task", fields, spec, params, crashes, runs=1)


def preflight_arena(spend: Spend, manager: JobManager, body: dict[str, Any]) -> dict[str, Any]:
    """``POST /api/arena/preflight``: the body of ``POST /api/arena``; prices both runs."""
    pair = parse_arena(manager, body)
    crashes = plan_crashes(pair.plan)
    return preflight_t2(spend, "arena", pair.fields(), pair.spec, pair.params, crashes, runs=2)


# -- reading pasted text -------------------------------------------------------------------


def intake_fields(body: dict[str, Any]) -> dict[str, Any]:
    """What a reading of pasted text is bound to: the cleaned text, the rooms and the names
    flag, whichever way the body spelled them. Bad text is refused here, as ``POST /api/intake``
    would refuse it."""
    from fractalswarm.intake import service

    try:
        segments, rooms = service.read_body(body)
    except service.IntakeError as exc:
        raise JobError(422, str(exc)) from None
    return {"segments": segments, "rooms": rooms, "names": bool(body.get("names", False))}


def intake_request_of(body: dict[str, Any]) -> dict[str, Any]:
    """The launch request of a billed reading: its fields and the proofs the body carries."""
    token, confirm = body.get("preflight_token"), body.get("confirm")
    return intake_fields(body) | {
        "preflight_token": token if isinstance(token, str) else None,
        "confirm": confirm if isinstance(confirm, str) else None,
    }


def intake_requests(segments: dict[str, str]) -> list[dict[str, Any]]:
    """The requests of one reading at its worst: the call, and the second try the actor makes
    with the errors of the first answer (``intake/actor.py``), on the text with its addresses
    already replaced, as the model will receive it."""
    from fractalswarm.intake import service
    from fractalswarm.intake.actor import MAX_ATTEMPTS
    from fractalswarm.intake.schema import intake_request
    from fractalswarm.intake.shape import DAYS, slot_grid

    masked, _ = service.mask(segments)
    days, slots = list(DAYS), slot_grid()
    first = intake_request(masked, days, slots, [])
    retry = intake_request(masked, days, slots, ["x" * PREFLIGHT_FEEDBACK_CHARS])
    return [first, *[retry] * (MAX_ATTEMPTS - 1)]


def preflight_intake(spend: Spend, body: dict[str, Any]) -> dict[str, Any]:
    """``POST /api/intake/preflight``: the body of ``POST /api/intake``. Nothing is written:
    the text is priced and fingerprinted, and only the fingerprint is kept."""
    fields = intake_fields(body)
    requests = intake_requests(fields["segments"])
    return spend.preflight("intake", fields, requests, runs=1, cap=INTAKE_CAP_USD)
