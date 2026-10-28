"""``ChatOpenAI`` behind the project's LLM layer (spec §14, §15.1).

LangGraph's model nodes talk to Muse through ``langchain-openai``. Here that client gets an
``httpx2`` transport that never opens a socket: it turns the Responses request the client
built into an ``llm`` effect of the run (``FrameworkRuntime.effect``), so every call goes
through ``LLMClient``: the role table picks model and effort, the budget reserves and settles,
the shared fault backend injects its seeded API faults, and the cassette records the call. The
reply goes back to ``langchain-openai`` as the Responses body it would have got from the API.

Which role, effect tag and budget scopes a call carries rides in one request header
(``x-fs-call``), set per call by ``call_options``; the transport removes nothing from the body
except what the LLM layer owns (instructions, model, effort and output cap are rebuilt from
the role table, exactly as for the other workflows).
"""

import json
from typing import Any

import httpx2

from fractalswarm.baselines.framework_runtime import FrameworkRuntime
from fractalswarm.kernel.effects import EffectOutcome

CALL_HEADER = "x-fs-call"
BASE_URL = "http://llm-layer.invalid/v1"


def call_options(
    request: dict[str, Any],
    *,
    actor: str,
    tag: str,
    scopes: dict[str, str],
    agent: str | None = None,
    as_text: bool = False,
) -> dict[str, Any]:
    """The per-call bindings for ``chat.bind(**...)``: the call header, and the request's
    structured-output format, tools and reasoning replay as ``langchain-openai`` takes them."""
    meta = {
        "role": request["role"],
        "actor": actor,
        "tag": tag,
        "scopes": scopes,
        "agent": agent,
        "as_text": as_text,
        "contributor": bool(request.get("contributor")),
        "prompt_cache_key": request.get("prompt_cache_key"),
    }
    options: dict[str, Any] = {"extra_headers": {CALL_HEADER: json.dumps(meta, sort_keys=True)}}
    options["store"] = False
    if request.get("text_format"):
        options["text"] = {"format": request["text_format"]}
    if request.get("keep_reasoning"):
        options["include"] = ["reasoning.encrypted_content"]
    return options


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    return "".join(part.get("text", "") for part in content or [] if isinstance(part, dict))


def _plain(item: dict[str, Any]) -> dict[str, Any]:
    """A message item as the other workflows send it: role and content, no item type."""
    if item.get("type", "message") != "message":
        return item
    return {"role": item["role"], "content": _text(item["content"])}


def to_llm_request(body: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """The ``LLMRequest`` of a Responses body that ``langchain-openai`` built. The system
    message is hoisted to ``instructions``, a lone user message of a planning-style call goes
    as plain text, and the rest of the input (function calls, outputs, reasoning) is kept."""
    items = list(body["input"])
    request: dict[str, Any] = {"role": meta["role"]}
    if items and items[0].get("role") in ("system", "developer"):
        request["instructions"] = _text(items.pop(0)["content"])
    rest = [_plain(item) for item in items]
    plain = len(rest) == 1 and rest[0].get("role") == "user"
    request["input"] = rest[0]["content"] if meta["as_text"] and plain else rest
    format_ = (body.get("text") or {}).get("format")
    if format_:
        request["text_format"] = format_
    if body.get("tools"):
        request["tools"] = body["tools"]
    if meta.get("prompt_cache_key"):
        request["prompt_cache_key"] = meta["prompt_cache_key"]
    if "reasoning.encrypted_content" in (body.get("include") or []):
        request["keep_reasoning"] = True
    if meta.get("contributor"):
        request["contributor"] = True
    return request


def response_body(outcome: EffectOutcome) -> dict[str, Any]:
    """The Responses API body of a completed call, rebuilt from the LLM layer's result."""
    result = outcome.result
    usage = result.get("usage") or {}
    input_tokens, output_tokens = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    incomplete = result.get("incomplete_reason")
    return {
        "id": result.get("response_id") or "resp_unknown",
        "object": "response",
        "model": result.get("model", ""),
        "status": result.get("response_status") or "completed",
        "incomplete_details": {"reason": incomplete} if incomplete else None,
        "output": result.get("output") or [],
        "usage": {
            "input_tokens": input_tokens,
            "input_tokens_details": {"cached_tokens": usage.get("cached_tokens", 0)},
            "output_tokens": output_tokens,
            "output_tokens_details": {"reasoning_tokens": usage.get("reasoning_tokens", 0)},
            "total_tokens": input_tokens + output_tokens,
        },
    }


class BridgeTransport(httpx2.AsyncBaseTransport):
    """Answers every request through ``runtime.effect``; it never touches the network."""

    def __init__(self, runtime: FrameworkRuntime) -> None:
        self.runtime = runtime

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        meta = json.loads(request.headers[CALL_HEADER])
        body = json.loads(await request.aread())
        outcome = await self.runtime.effect(
            "llm",
            to_llm_request(body, meta),
            actor=meta["actor"],
            tag=meta["tag"],
            scopes=meta["scopes"],
            agent=meta["agent"],
        )
        if outcome.status in ("ok", "incomplete"):
            return httpx2.Response(200, json=response_body(outcome), request=request)
        reason = outcome.result.get("error") or outcome.result.get("reason") or outcome.status
        status = int(outcome.result.get("http_status") or 0)
        error = {"error": {"message": str(reason), "type": "api_error", "code": outcome.status}}
        return httpx2.Response(status if status >= 400 else 502, json=error, request=request)

    async def aclose(self) -> None:
        return None


def chat_model(runtime: FrameworkRuntime):
    """The ``ChatOpenAI`` every model node of the graph uses: the Responses API, stateless,
    with the reasoning items kept as content blocks so a tool loop can replay them."""
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model="muse-spark-1.3",  # the role table decides the model of each call
        api_key="not-used",  # the LLM layer holds the real key; this client never sends one
        base_url=BASE_URL,
        use_responses_api=True,
        output_version="responses/v1",
        http_async_client=httpx2.AsyncClient(transport=BridgeTransport(runtime)),
        max_retries=0,  # every attempt is the LLM layer's, so every attempt is in the cassette
        timeout=None,
    )
