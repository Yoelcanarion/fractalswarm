"""Seeded API faults: 429 with Retry-After, 503, timeouts and slow responses (spec §8, §14).

One decision function, two places to apply it:

- ``FaultInjectingTransport`` wraps an ``httpx2`` transport, for the real backend
  (``OpenAIBackend(transport=...)``) and for every baseline that talks HTTP;
- ``FaultyBackend`` wraps any ``Backend``, for the fake LLM, so that $0 runs see the same
  faults.

A decision depends only on the seed and on what is being sent (the request, and how many
times it was sent before), never on timing or arrival order. Concurrent calls therefore get
the same faults in every run. The faulty attempts land in the cassette like any other
attempt, so replay needs no fault injection.
"""

import asyncio
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx2
from pydantic import BaseModel, ConfigDict, Field

from fractalswarm.kernel.ids import blake2b_hex
from fractalswarm.llm.cassette import Attempt
from fractalswarm.llm.client import Backend

Sleep = Callable[[int], Awaitable[None]]
FaultKind = Literal["429", "503", "timeout", "slow"]


class ApiFaults(BaseModel):
    """``rate`` of the attempts fail; ``mix`` weighs the kinds of failure."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    seed: str = "0"
    rate: float = Field(0.0, ge=0, le=1)
    mix: dict[str, float] = {"429": 0.4, "503": 0.3, "timeout": 0.15, "slow": 0.15}
    retry_after_s: tuple[float, float] = (1.0, 4.0)  # 429
    overload_retry_after_s: float = 60.0  # share of 503s that are an overload (60 s)
    overload_share: float = 0.25
    timeout_ms: int = 30_000  # how long a timed-out attempt waited
    slow_ms: tuple[int, int] = (3_000, 15_000)  # extra latency of a slow response
    fast_fail_ms: int = 150  # latency of a 429 or 503


@dataclass(frozen=True)
class Fault:
    kind: FaultKind
    retry_after_s: float | None = None
    delay_ms: int = 0


def decide(faults: ApiFaults, key: str) -> Fault | None:
    """The fault (if any) for one attempt, identified by ``key``."""
    if faults.rate <= 0:
        return None
    rng = random.Random(f"api-fault:{faults.seed}:{key}")
    if rng.random() >= faults.rate:
        return None
    kinds = sorted(faults.mix)
    pick = rng.random() * sum(faults.mix[kind] for kind in kinds)
    kind: str = kinds[-1]
    for name in kinds:
        pick -= faults.mix[name]
        if pick < 0:
            kind = name
            break
    if kind == "429":
        low, high = faults.retry_after_s
        return Fault("429", retry_after_s=round(low + rng.random() * (high - low), 1))
    if kind == "503":
        overload = rng.random() < faults.overload_share
        return Fault("503", retry_after_s=faults.overload_retry_after_s if overload else 2.0)
    if kind == "timeout":
        return Fault("timeout", delay_ms=faults.timeout_ms)
    low, high = faults.slow_ms
    return Fault("slow", delay_ms=low + int(rng.random() * (high - low)))


def error_body(fault: Fault) -> dict[str, Any]:
    if fault.kind == "429":
        error = {"message": "Rate limit exceeded (injected)", "type": "rate_limit_error"}
        error["code"] = "rate_limit_exceeded"
    else:
        error = {"message": "Service overloaded (injected)", "type": "api_error"}
        error["code"] = "service_overloaded"
    return {"error": error | {"param": None}}


def retry_after_header(fault: Fault) -> dict[str, str]:
    return {} if fault.retry_after_s is None else {"retry-after": f"{fault.retry_after_s:g}"}


@dataclass
class FaultyBackend:
    """Any backend (the fake LLM above all) behind seeded API faults.

    The attempt key is ``effect_id:n``: effect ids are deterministic, so the same run gets
    the same faults.
    """

    inner: Backend
    faults: ApiFaults
    attempts: dict[str, int] = field(default_factory=dict)
    injected: list[tuple[str, str]] = field(default_factory=list)  # (attempt key, kind)

    async def send(self, effect_id: str, body: dict[str, Any], sleep: Sleep) -> Attempt:
        number = self.attempts.get(effect_id, 0)
        self.attempts[effect_id] = number + 1
        key = f"{effect_id}:{number}"
        fault = decide(self.faults, key)
        if fault is None:
            return await self.inner.send(effect_id, body, sleep)
        self.injected.append((key, fault.kind))
        if fault.kind in ("429", "503"):
            await sleep(self.faults.fast_fail_ms)
            status = int(fault.kind)
            return Attempt(
                status=status,
                headers=retry_after_header(fault),
                body=error_body(fault),
                latency_ms=self.faults.fast_fail_ms,
            )
        await sleep(fault.delay_ms)
        if fault.kind == "timeout":
            return Attempt(
                status=0, latency_ms=fault.delay_ms, error="ReadTimeout: injected timeout"
            )
        attempt = await self.inner.send(effect_id, body, sleep)
        return attempt.model_copy(update={"latency_ms": attempt.latency_ms + fault.delay_ms})


class FaultInjectingTransport(httpx2.AsyncBaseTransport):
    """An ``httpx2`` transport that injects seeded faults in front of a real one.

    The attempt key is the request (method, URL, body) plus how many times that exact
    request was sent before, so a retry of a failed request gets a fresh decision.
    ``wall_sleep`` lets tests skip real waiting; ``wall_scale`` shrinks injected waits.
    """

    def __init__(
        self,
        inner: httpx2.AsyncBaseTransport,
        faults: ApiFaults,
        *,
        wall_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        wall_scale: float = 1.0,
    ) -> None:
        self.inner = inner
        self.faults = faults
        self.wall_sleep = wall_sleep
        self.wall_scale = wall_scale
        self.sent: dict[str, int] = {}
        self.injected: list[tuple[str, str]] = []

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        content = await request.aread()
        identity = blake2b_hex(request.method.encode() + str(request.url).encode() + content)
        number = self.sent.get(identity, 0)
        self.sent[identity] = number + 1
        key = f"{identity}:{number}"
        fault = decide(self.faults, key)
        if fault is None:
            return await self.inner.handle_async_request(request)
        self.injected.append((key, fault.kind))
        if fault.kind in ("429", "503"):
            return httpx2.Response(
                int(fault.kind),
                headers=retry_after_header(fault),
                json=error_body(fault),
                request=request,
            )
        await self.wall_sleep(fault.delay_ms / 1000 * self.wall_scale)
        if fault.kind == "timeout":
            raise httpx2.ReadTimeout("injected timeout", request=request)
        return await self.inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self.inner.aclose()
