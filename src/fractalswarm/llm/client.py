"""The LLM layer: role routing, retries, rate-limit headers, cost, cassettes (spec §14).

Calls use the Responses API statelessly (``store: false``), as docs/api-notes.md recommends.
A backend performs one HTTP exchange (``Attempt``); ``LLMClient`` owns everything around it:

- role -> (model, effort, max_output_tokens) from ``config/roles.yaml``;
- retries on 429, 500, 503 and transport errors, with exponential backoff, seeded jitter and
  never less than ``Retry-After`` (the SDK's own retries are off, so every attempt is ours
  and lands in the cassette);
- usage -> cost with ``config/prices.yaml``;
- the project ledger: a real call reserves its worst case first and settles afterwards.

Modes: ``record`` writes a cassette entry per call, ``live`` writes none, ``replay`` answers
from the cassette through ``CassetteBackend``.
"""

import random
import sqlite3
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

import httpx2
from openai import APIConnectionError, APIStatusError, AsyncOpenAI
from pydantic import BaseModel, ConfigDict

from fractalswarm.kernel.effects import EffectContext, EffectFn, EffectOutcome
from fractalswarm.kernel.events import Event
from fractalswarm.llm.cassette import Attempt, Cassette, CassetteEntry, load_json
from fractalswarm.llm.roles import CONTRIBUTOR_SUFFIX, RoleSpec, RoleTable
from fractalswarm.market.ledger import ProjectLedger
from fractalswarm.market.prices import PriceTable, Usage
from fractalswarm.safety.scanners import RoutingDecision, contributor_gate

Sleep = Callable[[int], Awaitable[None]]
Mode = Literal["record", "live", "replay"]

RETRYABLE_STATUSES = (0, 429, 500, 503)
# Rejections the API does not bill: the request never ran. A request with no reply (0) or a
# 500 may have run and been billed, so re-sending it could pay twice.
UNBILLED_STATUSES = (429, 503)
RATE_LIMIT_HEADERS = {
    "limit_requests": "x-ratelimit-limit-requests",
    "remaining_requests": "x-ratelimit-remaining-requests",
    "limit_tokens": "x-ratelimit-limit-tokens",
    "remaining_tokens": "x-ratelimit-remaining-tokens",
}


class LLMRequest(BaseModel):
    """What an actor asks for. It is the ``request`` of an ``llm`` effect."""

    model_config = ConfigDict(extra="forbid")

    role: str
    level: str = "L0"
    input: str | list[dict[str, Any]]
    instructions: str | None = None
    text_format: dict[str, Any] | None = None  # Responses ``text.format``
    tools: list[dict[str, Any]] = []
    max_tool_calls: int | None = None
    prompt_cache_key: str | None = None
    contributor: bool = False  # honored only where the role allows it (spec §7.5)
    keep_reasoning: bool = False  # ask for encrypted reasoning items, for multi-turn replay
    include: list[str] = []  # more output to return, e.g. the raw results of web_search


def contributor_routing(request: LLMRequest, spec: RoleSpec) -> RoutingDecision | None:
    """The Contributor gate (spec §7.5) for a request that opted in: content the scanners
    flag stays on Standard, and so does a role the ladder keeps there."""
    if not request.contributor:
        return None
    if not spec.contributor_ok:
        reason = f"the role ladder keeps {request.role} at {request.level} on Standard"
        return RoutingDecision(contributor=False, reason=reason)
    return contributor_gate([request.instructions, request.input], opted_in=True)


class RetryPolicy(BaseModel):
    base_delay_ms: int = 500
    max_attempts: int = 5
    max_jitter_ms: int = 1000
    statuses: tuple[int, ...] = RETRYABLE_STATUSES  # the attempt statuses that are retried


class Backend(Protocol):
    async def send(self, effect_id: str, body: dict[str, Any], sleep: Sleep) -> Attempt: ...


def parse_rate_limits(headers: dict[str, str]) -> dict[str, int | None]:
    lowered = {key.lower(): value for key, value in headers.items()}
    parsed: dict[str, int | None] = {}
    for name, header in RATE_LIMIT_HEADERS.items():
        value = lowered.get(header, "")
        parsed[name] = int(value) if value.strip().isdigit() else None
    return parsed


def parse_retry_after_ms(headers: dict[str, str]) -> int | None:
    """``Retry-After`` in milliseconds. Only the seconds form is supported."""
    lowered = {key.lower(): value for key, value in headers.items()}
    try:
        seconds = float(lowered["retry-after"])
    except (KeyError, ValueError):
        return None
    return max(int(seconds * 1000), 0)


def backoff_ms(
    policy: RetryPolicy, retry: int, retry_after_ms: int | None, rng: random.Random
) -> int:
    delay = policy.base_delay_ms * 2**retry + rng.randrange(policy.max_jitter_ms + 1)
    return max(delay, retry_after_ms or 0)


def parse_usage(body: dict[str, Any]) -> Usage:
    usage = body.get("usage") or {}
    output = body.get("output") or []
    return Usage(
        input_tokens=usage.get("input_tokens") or 0,
        cached_tokens=(usage.get("input_tokens_details") or {}).get("cached_tokens") or 0,
        output_tokens=usage.get("output_tokens") or 0,
        reasoning_tokens=(usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0,
        # Until a live run shows a usage field for it, one query per web_search_call item.
        searches=sum(1 for item in output if item.get("type") == "web_search_call"),
    )


def output_text(body: dict[str, Any]) -> str:
    return "".join(
        part.get("text", "")
        for item in body.get("output") or []
        if item.get("type") == "message"
        for part in item.get("content") or []
        if part.get("type") == "output_text"
    )


def error_message(body: Any) -> str:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        return str(body["error"].get("message") or body["error"])
    return str(body)[:500]


class LLMClient:
    def __init__(
        self,
        backend: Backend,
        *,
        roles: RoleTable,
        prices: PriceTable,
        mode: Mode = "record",
        cassette: Cassette | None = None,
        project_ledger: ProjectLedger | None = None,
        retry: RetryPolicy | None = None,
    ) -> None:
        if mode != "live" and cassette is None:
            raise ValueError(f"mode {mode!r} needs a cassette")
        self.backend = backend
        self.roles = roles
        self.prices = prices
        self.mode = mode
        self.cassette = cassette
        self.project_ledger = project_ledger if mode != "replay" else None
        self.retry = retry or RetryPolicy()
        # run/effect -> the project reservation id actually used (see _reserve_project)
        self._reservations: dict[str, str] = {}

    def config_snapshot(self) -> dict[str, Any]:
        """What replay needs to rebuild the same requests and estimates."""
        return {
            "roles": self.roles.model_dump(mode="json"),
            "prices": self.prices.model_dump(mode="json"),
        }

    @classmethod
    def config_from_snapshot(cls, snapshot: dict[str, Any]) -> tuple[RoleTable, PriceTable]:
        return (
            RoleTable.model_validate(snapshot["roles"]),
            PriceTable.model_validate(snapshot["prices"]),
        )

    # -- pure parts (also used by the kernel for reservations) ----------------------------

    def build(self, request: LLMRequest) -> tuple[str, dict[str, Any], int]:
        """(model, Responses body, max_output_tokens) for a request."""
        spec = self.roles.resolve(request.role, request.level)
        model = spec.model
        routing = contributor_routing(request, spec)
        if routing is not None and routing.contributor:
            model += CONTRIBUTOR_SUFFIX
        body: dict[str, Any] = {
            "model": model,
            "input": request.input,
            "reasoning": {"effort": spec.effort},
            "max_output_tokens": spec.max_output_tokens,
            "store": False,
        }
        if request.instructions is not None:
            body["instructions"] = request.instructions
        if request.text_format is not None:
            body["text"] = {"format": request.text_format}
        if request.tools:
            body["tools"] = request.tools
        if request.max_tool_calls is not None:
            body["max_tool_calls"] = request.max_tool_calls
        if request.prompt_cache_key is not None:
            body["prompt_cache_key"] = request.prompt_cache_key
        include = list(request.include)
        if request.keep_reasoning:
            include.append("reasoning.encrypted_content")
        if include:
            body["include"] = include
        return model, body, spec.max_output_tokens

    def route(self, request: dict[str, Any]) -> dict[str, Any] | None:
        """The ``security.routed`` payload of a request that opted in to Contributor: the
        decision ``build`` applies, which the kernel logs before the call starts."""
        parsed = LLMRequest.model_validate(request)
        routing = contributor_routing(parsed, self.roles.resolve(parsed.role, parsed.level))
        return None if routing is None else routing.model_dump(mode="json")

    def estimate(self, request: dict[str, Any]) -> float:
        """The worst-case cost of a request, for the two-phase reservation."""
        parsed = LLMRequest.model_validate(request)
        model, body, max_output = self.build(parsed)
        searches = 0
        if any(tool.get("type") == "web_search" for tool in parsed.tools):
            searches = parsed.max_tool_calls or 1
        return self.prices.worst_case(model, body, max_output, searches)

    # -- the call -------------------------------------------------------------------------

    async def call(
        self, effect_id: str, request: dict[str, Any], *, run_id: str, sleep: Sleep
    ) -> EffectOutcome:
        model, body, _ = self.build(LLMRequest.model_validate(request))
        entry = CassetteEntry(effect_id=effect_id, run_id=run_id, model=model, request=body)

        refusal = self._reserve_project(effect_id, run_id, model, request)
        if refusal is not None:
            entry.refusal = refusal
            self._record(entry)
            result = {"model": model, "reason": refusal, "cost_usd": 0.0}
            return EffectOutcome(status="refused", result=result)

        # If the call raises or is cancelled from here on, the project reservation stays open
        # on purpose: the request may have been billed, so its worst case stays committed.
        rng = random.Random(f"backoff:{effect_id}")
        latency = 0
        attempt = Attempt(status=0)
        for number in range(self.retry.max_attempts):
            attempt = await self.backend.send(effect_id, body, sleep)
            entry.attempts.append(attempt)
            latency += attempt.latency_ms
            if attempt.status not in self.retry.statuses or number + 1 == self.retry.max_attempts:
                break
            delay = backoff_ms(self.retry, number, parse_retry_after_ms(attempt.headers), rng)
            await sleep(delay)
            latency += delay

        entry.latency_ms = latency
        outcome = self._outcome(model, attempt, latency, len(entry.attempts))
        entry.cost_usd = outcome.result["cost_usd"]
        entry.usage = outcome.result.get("usage")
        self._settle_project(effect_id, run_id, entry.cost_usd)
        recorded = self._record(entry)
        if recorded is not None:  # the log holds the redacted reply, the one replay reads
            outcome = self._outcome(model, recorded.attempts[-1], latency, len(recorded.attempts))
        return outcome

    def _outcome(self, model: str, attempt: Attempt, latency: int, attempts: int) -> EffectOutcome:
        common = {
            "model": model,
            "latency_ms": latency,
            "attempts": attempts,
            "http_status": attempt.status,
            "rate_limits": parse_rate_limits(attempt.headers),
        }
        if attempt.status != 200 or not isinstance(attempt.body, dict):
            error = attempt.error or error_message(attempt.body)
            retry_after = parse_retry_after_ms(attempt.headers)
            if retry_after is not None:  # for the model breaker (comms/breakers.py)
                common["retry_after_ms"] = retry_after
            return EffectOutcome(
                status="error",
                result=common | {"error": error, "cost_usd": 0.0},
                latency_ms=latency,
            )
        body = attempt.body
        usage = parse_usage(body)
        incomplete = body.get("status") == "incomplete"
        result = common | {
            "response_id": body.get("id"),
            "response_status": body.get("status"),
            "incomplete_reason": (body.get("incomplete_details") or {}).get("reason"),
            "output_text": output_text(body),
            "output": body.get("output") or [],
            "usage": usage.model_dump(),
            "cost_usd": self.prices.cost(model, usage),
        }
        status = "incomplete" if incomplete else "ok"
        return EffectOutcome(status=status, result=result, latency_ms=latency)

    def _reserve_project(
        self, effect_id: str, run_id: str, model: str, request: dict[str, Any]
    ) -> str | None:
        if self.mode == "replay":
            return self.cassette.get(effect_id).refusal  # type: ignore[union-attr]
        if self.project_ledger is None:
            return None
        key = reservation_id = f"{run_id}/{effect_id}"
        attempt = 1
        while True:
            try:
                refusal = self.project_ledger.reserve(
                    reservation_id, run_id, model, self.estimate(request), at=_utc_now()
                )
                break
            except sqlite3.IntegrityError as error:
                # An earlier recording under the same run id (an interrupted run, re-run) holds
                # this id. This call is a new request, so it gets a reservation of its own.
                if "reservation_id" not in str(error):
                    raise
                attempt += 1
                reservation_id = f"{key}#{attempt}"
        if refusal is None:
            self._reservations[key] = reservation_id
            return None
        return (
            f"project cap: ${refusal.committed_usd:.4f} committed of ${refusal.cap_usd:.2f}, "
            f"call needs up to ${refusal.requested_usd:.4f}"
        )

    def _settle_project(self, effect_id: str, run_id: str, cost_usd: float) -> None:
        if self.project_ledger is not None:
            key = f"{run_id}/{effect_id}"
            self.project_ledger.settle(self._reservations.pop(key, key), cost_usd, at=_utc_now())

    def _record(self, entry: CassetteEntry) -> CassetteEntry | None:
        if self.mode == "record":
            return self.cassette.record(entry)  # type: ignore[union-attr]
        return None

    def effect(self) -> EffectFn:
        async def run(started: Event, ctx: EffectContext) -> EffectOutcome:
            return await self.call(
                started.payload["effect_id"],
                started.payload["request"],
                run_id=ctx.run_id,
                sleep=ctx.sleep,
            )

        return run


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class OpenAIBackend:
    """The real Meta Model API through the openai SDK (``httpx2`` underneath)."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.meta.ai/v1",
        *,
        timeout_s: float = 600.0,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        http_client = httpx2.AsyncClient(transport=transport) if transport else None
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            max_retries=0,
            timeout=timeout_s,
            http_client=http_client,
        )

    async def send(self, effect_id: str, body: dict[str, Any], sleep: Sleep) -> Attempt:
        started = time.perf_counter()
        try:
            raw = await self.client.responses.with_raw_response.create(**body)
            response = raw.http_response
        except APIStatusError as exc:
            response = exc.response
        except APIConnectionError as exc:
            elapsed = int((time.perf_counter() - started) * 1000)
            return Attempt(status=0, latency_ms=elapsed, error=f"{type(exc).__name__}: {exc}")
        elapsed = int((time.perf_counter() - started) * 1000)
        return Attempt(
            status=response.status_code,
            headers=dict(response.headers),
            body=load_json(response.text),
            latency_ms=elapsed,
        )
