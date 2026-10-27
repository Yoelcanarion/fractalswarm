"""A scripted, deterministic fake of the Responses API, for tests and $0 runs.

Replies, token counts and latencies depend only on the request body and the attempt number,
never on time or process. A script can return text or a ``FakeReply`` (including errors with
``Retry-After``, to exercise retries). The latency model and the reasoning-token model are
hooks: ``llm/calibrate.py`` fits both from real cassettes (spec §14). Without a reasoning
model, reasoning tokens come from the fixed ``REASONING_TOKENS`` table.
"""

import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from pydantic import BaseModel

from fractalswarm.kernel.ids import canonical_json, digest
from fractalswarm.llm.cassette import Attempt

Sleep = Callable[[int], Awaitable[None]]

REASONING_TOKENS = {"minimal": 0, "low": 32, "medium": 128, "high": 512, "xhigh": 1024, "max": 2048}
RATE_LIMIT_HEADERS = {
    "x-ratelimit-limit-requests": "3000",
    "x-ratelimit-remaining-requests": "2999",
    "x-ratelimit-limit-tokens": "4000000",
    "x-ratelimit-remaining-tokens": "3990000",
}


class FakeReply(BaseModel):
    text: str = ""
    status: int = 200
    error_type: str = "api_error"
    retry_after_s: float | None = None
    output_tokens: int | None = None


Script = Callable[[dict[str, Any], int], "FakeReply | str"]


class LatencyModel(Protocol):
    def __call__(
        self, model: str, input_tokens: int, output_tokens: int, rng: random.Random
    ) -> int: ...


@dataclass(frozen=True)
class LinearLatency:
    """Placeholder until Day 5: base + per-token cost + uniform jitter, in milliseconds."""

    base_ms: int = 400
    per_input_token_ms: float = 0.02
    per_output_token_ms: float = 8.0
    jitter_ms: int = 200

    def __call__(
        self, model: str, input_tokens: int, output_tokens: int, rng: random.Random
    ) -> int:
        cost = input_tokens * self.per_input_token_ms + output_tokens * self.per_output_token_ms
        return self.base_ms + int(cost) + rng.randrange(self.jitter_ms + 1)


class ReasoningModel(Protocol):
    def __call__(self, model: str, effort: str, rng: random.Random) -> int: ...


def default_script(body: dict[str, Any], attempt: int) -> str:
    return f"[fake {body['model']}] {digest(body['input'])[:12]}"


def count_tokens(value: Any) -> int:
    return len(canonical_json(value)) // 4 + 1


@dataclass
class FakeBackend:
    script: Script = default_script
    latency: LatencyModel = field(default_factory=LinearLatency)
    reasoning: ReasoningModel | None = None
    calls: int = 0
    attempts: dict[str, int] = field(default_factory=dict)

    async def send(self, effect_id: str, body: dict[str, Any], sleep: Sleep) -> Attempt:
        attempt = self.attempts.get(effect_id, 0)
        self.attempts[effect_id] = attempt + 1
        self.calls += 1
        reply = self.script(body, attempt)
        if isinstance(reply, str):
            reply = FakeReply(text=reply)

        key = digest([body, attempt])
        rng = random.Random(f"fake-latency:{key}")
        input_tokens = count_tokens([body.get("instructions"), body["input"]])
        output_tokens = reply.output_tokens or count_tokens(reply.text)
        effort = (body.get("reasoning") or {}).get("effort", "low")
        if self.reasoning is None:
            reasoning = REASONING_TOKENS.get(effort, 0)
            latency = self.latency(body["model"], input_tokens, output_tokens, rng)
        else:
            reasoning = self.reasoning(body["model"], effort, random.Random(f"fake-tokens:{key}"))
            latency = self.latency(body["model"], input_tokens, output_tokens + reasoning, rng)
        await sleep(latency)

        if reply.status != 200:
            headers = {}
            if reply.retry_after_s is not None:
                headers["retry-after"] = f"{reply.retry_after_s:g}"
            error = {"message": reply.text or "fake error", "type": reply.error_type}
            error |= {"param": None, "code": None}
            return Attempt(
                status=reply.status, headers=headers, body={"error": error}, latency_ms=latency
            )

        limit = body.get("max_output_tokens") or 1 << 30
        total_output = reasoning + output_tokens
        incomplete = total_output > limit
        text = reply.text if not incomplete else ""
        message = {
            "type": "message",
            "id": f"msg_fake_{key[:12]}",
            "role": "assistant",
            "status": "incomplete" if incomplete else "completed",
            "content": [{"type": "output_text", "text": text, "annotations": []}],
        }
        output_billed = min(total_output, limit)
        response = {
            "id": f"resp_fake_{key[:16]}",
            "object": "response",
            "model": body["model"],
            "status": "incomplete" if incomplete else "completed",
            "incomplete_details": {"reason": "max_output_tokens"} if incomplete else None,
            "output": [message],
            "usage": {
                "input_tokens": input_tokens,
                "input_tokens_details": {"cached_tokens": 0},
                "output_tokens": output_billed,
                "output_tokens_details": {"reasoning_tokens": min(reasoning, output_billed)},
                "total_tokens": input_tokens + output_billed,
            },
        }
        return Attempt(
            status=200, headers=dict(RATE_LIMIT_HEADERS), body=response, latency_ms=latency
        )
