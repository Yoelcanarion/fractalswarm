"""Day 2 API spike: check the spec §24 assumptions against the Meta Model API.

    uv run python scripts/spike_api.py --mock        # $0 run against a local fake API
    uv run python scripts/spike_api.py               # real calls; asks before spending
    uv run python scripts/spike_api.py --probe-429   # also bursts the contributor model to a 429

Real calls are charged to the account. Run them only after confirming that the hackathon
credits show on dev.meta.ai under Billing -> Free credits. Before each call the script
reserves the call's worst-case cost, and it refuses any call that would take the total past
--max-usd (default $0.50). Rejected requests (4xx) are not billed, so the error probes are free.

Evidence goes to runs/spike/ (gitignored): every probe's request, status, latency, headers
and response as JSON, plus a Markdown summary to copy into docs/api-notes.md. The API key is
never printed or written. A --mock run checks the script, not the API: its output is not
evidence.
"""

import argparse
import json
import sys
import threading
import time
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Self

import httpx
import yaml
from openai import OpenAI

from fractalswarm.config import Settings

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "runs" / "spike"

SPARK = "muse-spark-1.3"
WONDER = "muse-wonder-1.0"
CONTRIBUTOR = "muse-spark-1.3-contributor"
EFFORTS = ("minimal", "low", "medium", "high", "xhigh", "max")
INVALID_KEY = "LLM_0_invalid"
MOCK_KEY = "LLM_0_mock"
# Search results land in the input, so a search call reserves a large input.
SEARCH_INPUT_TOKENS = 30_000

OK_PROMPT = "Reply with the single word OK."
EFFORT_PROMPT = "How many prime numbers are there below 50? Answer with the number only."
SEARCH_PROMPT = (
    "Search the web for the latest stable Python release and its release date. "
    "Answer in one sentence and cite the source."
)
TALK_NOTE = (
    'Extract the talk from this note: "Ana Ruiz will present Fractal Swarms in room B on day 2."'
)
TALK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "speaker": {"type": "string"},
        "title": {"type": "string"},
        "room": {"type": "string", "enum": ["A", "B", "C", "D"]},
        "day": {"type": "integer"},
    },
    "required": ["speaker", "title", "room", "day"],
    "additionalProperties": False,
}
TOOLS_PROMPT = (
    "I need two facts: the capacity of room B and the availability of speaker Ana Ruiz. "
    "Call both tools now, then answer in one sentence."
)
FUNCTIONS: list[dict[str, Any]] = [
    {
        "name": "get_room_capacity",
        "description": "Return the number of seats in a conference room.",
        "parameters": {
            "type": "object",
            "properties": {"room": {"type": "string", "enum": ["A", "B", "C", "D"]}},
            "required": ["room"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_speaker_availability",
        "description": "Return the days and slots when a speaker can present.",
        "parameters": {
            "type": "object",
            "properties": {"speaker": {"type": "string"}},
            "required": ["speaker"],
            "additionalProperties": False,
        },
    },
]
CHAT_TOOLS = [{"type": "function", "function": function} for function in FUNCTIONS]
RESPONSES_TOOLS = [{"type": "function", **function} for function in FUNCTIONS]
TOOL_RESULTS = {
    "get_room_capacity": {"room": "B", "seats": 120},
    "get_speaker_availability": {"speaker": "Ana Ruiz", "available": ["day 2 morning"]},
}

MISSING_KEY = """MODEL_API_KEY is not set, so the spike cannot call the API.
1. Create a key on dev.meta.ai (API keys) and put it in ~/.fractalswarm/.env (see .env.example).
2. Confirm that the hackathon credits show on dev.meta.ai under Billing -> Free credits.
3. Rerun this script. Meanwhile, --mock exercises the script at $0."""


class BudgetExceeded(Exception):
    pass


def clip(value: Any, limit: int) -> Any:
    """Shorten long strings, such as encrypted reasoning, inside a JSON-like value."""
    if isinstance(value, str) and len(value) > limit:
        return f"{value[:limit]}... [{len(value)} chars]"
    if isinstance(value, list):
        return [clip(item, limit) for item in value]
    if isinstance(value, dict):
        return {key: clip(item, limit) for key, item in value.items()}
    return value


def short(facts: dict[str, Any]) -> str:
    text = json.dumps(clip(facts, 60), ensure_ascii=False)
    return text if len(text) <= 160 else f"{text[:157]}..."


def flatten(value: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, item in value.items():
        if isinstance(item, dict):
            flat |= flatten(item, f"{prefix}{key}.")
        else:
            flat[f"{prefix}{key}"] = item
    return flat


def output_items(payload: Any, kind: str) -> list[dict[str, Any]]:
    output = payload.get("output") if isinstance(payload, dict) else None
    return [item for item in output or [] if item.get("type") == kind]


def output_text(payload: Any) -> str:
    return "".join(
        part.get("text", "")
        for item in output_items(payload, "message")
        for part in item.get("content") or []
        if part.get("type") == "output_text"
    )


def describe(payload: Any) -> dict[str, Any]:
    """The facts worth reading at a glance; the full payload stays in the evidence."""
    if not isinstance(payload, dict):
        return {"body": clip(payload, 300)}
    if "error" in payload:
        return {"error": payload["error"]}
    if payload.get("object") == "chat.completion":
        choice = payload["choices"][0]
        message = choice["message"]
        return {
            "model": payload.get("model"),
            "finish_reason": choice.get("finish_reason"),
            "content": clip(message.get("content"), 300),
            "tool_calls": len(message.get("tool_calls") or []),
            "message_keys": sorted(message),
            "usage": flatten(payload.get("usage") or {}),
        }
    if payload.get("object") == "response":
        return {
            "model": payload.get("model"),
            "status": payload.get("status"),
            "incomplete_details": payload.get("incomplete_details"),
            "output_types": [item.get("type") for item in payload.get("output") or []],
            "output_text": clip(output_text(payload), 300),
            "usage": flatten(payload.get("usage") or {}),
        }
    return {"body": clip(payload, 300)}


def parse_talk(text: str | None) -> dict[str, Any]:
    try:
        talk = json.loads(text or "")
    except json.JSONDecodeError as exc:
        return {"parsed": None, "parse_error": str(exc)}
    valid = (
        isinstance(talk, dict)
        and set(talk) == set(TALK_SCHEMA["required"])
        and talk["room"] in TALK_SCHEMA["properties"]["room"]["enum"]
        and isinstance(talk["day"], int)
    )
    return {"parsed": talk, "matches_schema": valid}


def chat_body(
    model: str,
    messages: str | list[dict[str, Any]],
    *,
    effort: str | None = None,
    max_tokens: int = 512,
    **extra: Any,
) -> dict[str, Any]:
    if isinstance(messages, str):
        messages = [{"role": "user", "content": messages}]
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_completion_tokens": max_tokens,
    }
    if effort:
        body["reasoning_effort"] = effort
    return body | extra


def responses_body(
    model: str,
    input_: str | list[dict[str, Any]],
    *,
    effort: str | None = None,
    max_tokens: int = 512,
    **extra: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "input": input_,
        "max_output_tokens": max_tokens,
        "store": False,
    }
    if effort:
        body["reasoning"] = {"effort": effort}
    return body | extra


@dataclass
class Prices:
    per_token: dict[str, dict[str, float]]
    search_usd: float

    @classmethod
    def load(cls) -> Self:
        data = yaml.safe_load((ROOT / "config" / "prices.yaml").read_text(encoding="utf-8"))
        unit = data["unit_tokens"]
        per_token = {
            model: {kind: usd / unit for kind, usd in price.items()}
            for model, price in data["models"].items()
        }
        return cls(per_token, data["tools"]["web_search"]["usd_per_1k_queries"] / 1000)

    def worst_case(self, model: str, body: Any, max_output: int, searches: int = 0) -> float:
        price = self.per_token[model]
        input_tokens = len(json.dumps(body)) // 2 + searches * SEARCH_INPUT_TOKENS
        return (
            input_tokens * price["input"]
            + max_output * price["output"]
            + searches * self.search_usd
        )

    def actual(self, model: str, payload: Any) -> float | None:
        usage = payload.get("usage") if isinstance(payload, dict) else None
        if not usage:
            return None
        if "prompt_tokens" in usage:  # Chat Completions
            total_input, output = usage["prompt_tokens"], usage["completion_tokens"]
            cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
        else:  # Responses
            total_input, output = usage["input_tokens"], usage["output_tokens"]
            cached = (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0
        price = self.per_token[model]
        searches = len(output_items(payload, "web_search_call"))
        return (
            (total_input - cached) * price["input"]
            + cached * price["cached_input"]
            + output * price["output"]
            + searches * self.search_usd
        )


@dataclass
class Probe:
    name: str
    request: dict[str, Any]
    status: int | None = None
    latency_s: float | None = None
    headers: dict[str, str] = field(default_factory=dict)
    response: Any = None
    cost_usd: float = 0.0
    facts: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status is not None and 200 <= self.status < 300


class Spike:
    def __init__(self, client: httpx.Client, sdk: OpenAI, prices: Prices, max_usd: float) -> None:
        self.client = client
        self.sdk = sdk
        self.prices = prices
        self.max_usd = max_usd
        self.spent = 0.0
        self.probes: list[Probe] = []
        self.failures: list[str] = []

    def reserve(self, name: str, worst: float) -> None:
        if self.spent + worst > self.max_usd:
            raise BudgetExceeded(
                f"{name}: a worst case of ${worst:.4f} on top of ${self.spent:.4f} "
                f"would pass the ${self.max_usd:.2f} cap"
            )

    def call(
        self,
        name: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        method: str = "POST",
        model: str | None = None,
        max_output: int = 0,
        searches: int = 0,
        api_key: str | None = None,
        send: Callable[[], Any] | None = None,
    ) -> Probe:
        """Make one probe call. `model` turns on cost accounting; `send` replaces raw HTTP."""
        worst = self.prices.worst_case(model, body, max_output, searches) if model else 0.0
        self.reserve(name, worst)
        probe = Probe(name, {"method": method, "path": path, "body": body})
        started = time.perf_counter()
        try:
            response = send() if send else self.http(method, path, body, api_key)
        except Exception as exc:
            probe.error = f"{type(exc).__name__}: {exc}"
            probe.cost_usd = worst  # the outcome is unknown, so assume the call was billed
            self.spent += worst
            self.record(probe)
            return probe
        probe.latency_s = round(time.perf_counter() - started, 3)
        probe.status = response.status_code
        probe.headers = {k: v for k, v in response.headers.items() if k.lower() != "set-cookie"}
        try:
            probe.response = response.json()
        except ValueError:
            probe.response = response.text
        if probe.ok and model:
            cost = self.prices.actual(model, probe.response)
            probe.cost_usd = worst if cost is None else cost
            self.spent += probe.cost_usd
        try:
            probe.facts = describe(probe.response)
        except (KeyError, IndexError, TypeError) as exc:
            probe.facts = {"describe_error": repr(exc)}
        self.record(probe)
        return probe

    def http(
        self, method: str, path: str, body: dict[str, Any] | None, api_key: str | None
    ) -> httpx.Response:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
        return self.client.request(method, path, json=body, headers=headers)

    def record(self, probe: Probe) -> None:
        self.probes.append(probe)
        status = probe.status if probe.status is not None else "ERR"
        print(
            f"{probe.name:36} {status!s:>4} {probe.latency_s or 0:6.2f} s "
            f"${probe.cost_usd:.5f}  {probe.error or short(probe.facts)}"
        )


def probe_models_and_errors(spike: Spike) -> None:
    models = spike.call("models.list", "/models", method="GET")
    if models.ok:
        models.facts = {"models": sorted(item["id"] for item in models.response.get("data", []))}
    spike.call("error.invalid_key", "/models", method="GET", api_key=INVALID_KEY)
    spike.call("error.unknown_model", "/chat/completions", chat_body("muse-unknown-0.0", OK_PROMPT))
    spike.call("error.unknown_path", "/does-not-exist", method="GET")


def probe_basic(spike: Spike) -> None:
    terse = "You are a terse assistant."
    messages = [{"role": "developer", "content": terse}, {"role": "user", "content": OK_PROMPT}]
    spike.call(
        "basic.chat",
        "/chat/completions",
        chat_body(SPARK, messages, effort="minimal"),
        model=SPARK,
        max_output=512,
    )
    spike.call(
        "basic.responses",
        "/responses",
        responses_body(SPARK, OK_PROMPT, effort="minimal", instructions=terse),
        model=SPARK,
        max_output=512,
    )
    spike.call(
        "basic.responses.default_effort",
        "/responses",
        responses_body(SPARK, OK_PROMPT),
        model=SPARK,
        max_output=512,
    )


def probe_reasoning(spike: Spike) -> None:
    for name, path, body in (
        ("effort.chat.invalid", "/chat/completions", chat_body(SPARK, OK_PROMPT, effort="bogus")),
        ("effort.chat.none", "/chat/completions", chat_body(SPARK, OK_PROMPT, effort="none")),
        (
            "effort.responses.invalid",
            "/responses",
            responses_body(SPARK, OK_PROMPT, effort="bogus"),
        ),
    ):
        spike.call(name, path, body | max_tokens_of(body, 16), model=SPARK, max_output=16)
    spike.call(
        "effort.contributor.max",
        "/responses",
        responses_body(CONTRIBUTOR, OK_PROMPT, effort="max", max_tokens=16),
        model=CONTRIBUTOR,
        max_output=16,
    )
    for effort in EFFORTS:
        spike.call(
            f"effort.responses.{effort}",
            "/responses",
            responses_body(SPARK, EFFORT_PROMPT, effort=effort, max_tokens=2048),
            model=SPARK,
            max_output=2048,
        )
    spike.call(
        "effort.chat.low",
        "/chat/completions",
        chat_body(SPARK, EFFORT_PROMPT, effort="low", max_tokens=2048),
        model=SPARK,
        max_output=2048,
    )
    summary = spike.call(
        "effort.responses.summary",
        "/responses",
        responses_body(
            SPARK, EFFORT_PROMPT, max_tokens=2048, reasoning={"effort": "low", "summary": "auto"}
        ),
        model=SPARK,
        max_output=2048,
    )
    if summary.ok:
        reasoning = output_items(summary.response, "reasoning")
        summary.facts["reasoning_summaries"] = [item.get("summary") for item in reasoning]


def max_tokens_of(body: dict[str, Any], tokens: int) -> dict[str, Any]:
    key = "max_completion_tokens" if "messages" in body else "max_output_tokens"
    return {key: tokens}


def probe_structured_output(spike: Spike) -> None:
    json_schema = {"name": "talk", "schema": TALK_SCHEMA, "strict": True}
    chat = spike.call(
        "structured.chat",
        "/chat/completions",
        chat_body(
            SPARK,
            TALK_NOTE,
            effort="low",
            max_tokens=1024,
            response_format={"type": "json_schema", "json_schema": json_schema},
        ),
        model=SPARK,
        max_output=1024,
    )
    if chat.ok:
        chat.facts |= parse_talk(chat.response["choices"][0]["message"].get("content"))
    responses = spike.call(
        "structured.responses",
        "/responses",
        responses_body(
            SPARK,
            TALK_NOTE,
            effort="low",
            max_tokens=1024,
            text={"format": {"type": "json_schema", **json_schema}},
        ),
        model=SPARK,
        max_output=1024,
    )
    if responses.ok:
        responses.facts |= parse_talk(output_text(responses.response))
    json_object = spike.call(
        "structured.chat.json_object",
        "/chat/completions",
        chat_body(
            SPARK,
            f"{TALK_NOTE} Reply with a JSON object with keys speaker, title, room and day.",
            effort="low",
            max_tokens=1024,
            response_format={"type": "json_object"},
        ),
        model=SPARK,
        max_output=1024,
    )
    if json_object.ok:
        json_object.facts |= parse_talk(
            json_object.response["choices"][0]["message"].get("content")
        )
    loose = {key: value for key, value in TALK_SCHEMA.items() if key != "additionalProperties"}
    spike.call(
        "structured.chat.strict_violation",
        "/chat/completions",
        chat_body(
            SPARK,
            TALK_NOTE,
            effort="low",
            max_tokens=1024,
            response_format={"type": "json_schema", "json_schema": json_schema | {"schema": loose}},
        ),
        model=SPARK,
        max_output=1024,
    )


def probe_tools(spike: Spike) -> None:
    spike.call(
        "tools.chat.tool_choice_required",
        "/chat/completions",
        chat_body(
            SPARK,
            TOOLS_PROMPT,
            effort="low",
            max_tokens=1024,
            tools=CHAT_TOOLS,
            tool_choice="required",
        ),
        model=SPARK,
        max_output=1024,
    )

    messages: list[dict[str, Any]] = [{"role": "user", "content": TOOLS_PROMPT}]
    body = chat_body(
        SPARK, messages, effort="low", max_tokens=1024, tools=CHAT_TOOLS, parallel_tool_calls=True
    )
    first = spike.call("tools.chat.calls", "/chat/completions", body, model=SPARK, max_output=1024)
    calls = (first.response["choices"][0]["message"].get("tool_calls") or []) if first.ok else []
    if calls:
        first.facts["calls"] = [call["function"] for call in calls]
        assistant = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": call["id"],
                    "type": "function",
                    "function": {
                        "name": call["function"]["name"],
                        "arguments": call["function"]["arguments"],
                    },
                }
                for call in calls
            ],
        }
        results = [
            {
                "role": "tool",
                "tool_call_id": call["id"],
                "content": json.dumps(TOOL_RESULTS.get(call["function"]["name"], {})),
            }
            for call in calls
        ]
        spike.call(
            "tools.chat.results",
            "/chat/completions",
            body | {"messages": [*messages, assistant, *results]},
            model=SPARK,
            max_output=1024,
        )

    # Stateless loop (store=false): replay the output items, encrypted reasoning included.
    body = responses_body(
        SPARK,
        [{"role": "user", "content": TOOLS_PROMPT}],
        effort="low",
        max_tokens=1024,
        tools=RESPONSES_TOOLS,
        parallel_tool_calls=True,
        include=["reasoning.encrypted_content"],
    )
    first = spike.call("tools.responses.calls", "/responses", body, model=SPARK, max_output=1024)
    calls = output_items(first.response, "function_call") if first.ok else []
    if calls:
        first.facts["calls"] = [
            {key: call.get(key) for key in ("name", "arguments", "call_id")} for call in calls
        ]
        first.facts["reasoning_items"] = [
            {
                "encrypted_content": bool(item.get("encrypted_content")),
                "summary": item.get("summary"),
            }
            for item in output_items(first.response, "reasoning")
        ]
        results = [
            {
                "type": "function_call_output",
                "call_id": call["call_id"],
                "output": json.dumps(TOOL_RESULTS.get(call["name"], {})),
            }
            for call in calls
        ]
        spike.call(
            "tools.responses.results",
            "/responses",
            body | {"input": [*body["input"], *first.response["output"], *results]},
            model=SPARK,
            max_output=1024,
        )


def probe_token_count(spike: Spike) -> None:
    body = {"model": SPARK, "input": "What is the capital of France?"}
    spike.call("token_count.plain", "/responses/input_tokens", body)
    spike.call(
        "token_count.with_tools", "/responses/input_tokens", body | {"tools": RESPONSES_TOOLS}
    )
    spike.call(
        "token_count.with_web_search",
        "/responses/input_tokens",
        body | {"tools": [{"type": "web_search"}]},
    )


def cache_prefix() -> str:
    talks = [
        f"Talk {i:03d}: 'Scaling idea {i:03d}' by speaker {i % 37:02d}, track T{i % 3 + 1}, "
        f"needs {40 + i % 5 * 20} seats, prefers day {i % 2 + 1} "
        f"{'morning' if i % 4 < 2 else 'afternoon'}."
        for i in range(120)
    ]
    return "Conference handbook. Answer questions about these talks.\n" + "\n".join(talks)


def probe_caching(spike: Spike) -> None:
    prefix = {"role": "developer", "content": cache_prefix()}
    questions = (
        "How many talks need 120 seats? Answer with a number.",
        "Which track is talk 007 in? Answer briefly.",
        "Who presents talk 042? Answer briefly.",
    )
    spike.call(
        "caching.count",
        "/responses/input_tokens",
        {"model": SPARK, "input": [prefix, {"role": "user", "content": questions[0]}]},
    )
    for number, question in enumerate(questions, 1):
        body = responses_body(
            SPARK,
            [prefix, {"role": "user", "content": question}],
            effort="minimal",
            max_tokens=256,
            prompt_cache_key="fractalswarm-spike",
        )
        spike.call(f"caching.call_{number}", "/responses", body, model=SPARK, max_output=256)


def probe_web_search(spike: Spike) -> None:
    search_tool = {"type": "web_search", "search_context_size": "low"}
    for name, extra in (
        ("web_search.chat.tool", {"tools": [{"type": "web_search"}]}),
        ("web_search.chat.options", {"web_search_options": {}}),
    ):
        spike.call(
            name,
            "/chat/completions",
            chat_body(SPARK, SEARCH_PROMPT, effort="low", max_tokens=1024, **extra),
            model=SPARK,
            max_output=1024,
            searches=1,
        )
    search = spike.call(
        "web_search.responses",
        "/responses",
        responses_body(
            SPARK,
            SEARCH_PROMPT,
            effort="low",
            max_tokens=1024,
            tools=[search_tool],
            include=["web_search_call.results"],
            max_tool_calls=1,
        ),
        model=SPARK,
        max_output=1024,
        searches=1,
    )
    if search.ok:
        calls = output_items(search.response, "web_search_call")
        search.facts["web_search_calls"] = [
            clip({key: value for key, value in call.items() if key != "results"}, 200)
            | {"results": len(call.get("results") or [])}
            for call in calls
        ]
        results = [result for call in calls for result in call.get("results") or []]
        search.facts["first_result"] = clip(results[0], 200) if results else None
        search.facts["annotations"] = [
            annotation
            for message in output_items(search.response, "message")
            for part in message.get("content") or []
            for annotation in part.get("annotations") or []
        ][:3]


def probe_wonder_and_contributor(spike: Spike) -> None:
    for name, model in (("wonder.basic", WONDER), ("contributor.basic", CONTRIBUTOR)):
        spike.call(
            name,
            "/responses",
            responses_body(model, OK_PROMPT, effort="low"),
            model=model,
            max_output=512,
        )


def probe_sdk(spike: Spike) -> None:
    """The runtime will use the openai SDK (spec §14): check it parses Meta's responses."""
    parsed: dict[str, Any] = {}
    responses_kwargs = responses_body(SPARK, OK_PROMPT, effort="minimal")
    chat_kwargs = chat_body(SPARK, OK_PROMPT, effort="minimal")

    def send_responses() -> Any:
        raw = spike.sdk.responses.with_raw_response.create(**responses_kwargs)
        parsed["output_text"] = raw.parse().output_text
        return raw.http_response

    def send_chat() -> Any:
        raw = spike.sdk.chat.completions.with_raw_response.create(**chat_kwargs)
        parsed["content"] = raw.parse().choices[0].message.content
        return raw.http_response

    for name, path, body, send in (
        ("sdk.responses", "/responses", responses_kwargs, send_responses),
        ("sdk.chat", "/chat/completions", chat_kwargs, send_chat),
    ):
        probe = spike.call(name, path, body, model=SPARK, max_output=512, send=send)
        probe.facts["sdk_parsed"] = parsed.copy()


def probe_rate_limit(spike: Spike, requests: int = 200, concurrency: int = 40) -> None:
    """Burst tiny contributor calls (150 RPM per team) and stop at the first 429."""
    body = chat_body(CONTRIBUTOR, OK_PROMPT, effort="minimal", max_tokens=16)
    worst_each = spike.prices.worst_case(CONTRIBUTOR, body, 16)
    spike.reserve("rate_limit.burst", worst_each * requests)
    stop = threading.Event()

    def send(index: int) -> tuple[int, httpx.Response] | None:
        if stop.is_set():
            return None
        response = spike.client.post("/chat/completions", json=body)
        if response.status_code == 429:
            stop.set()
        return index, response

    with ThreadPoolExecutor(concurrency) as pool:
        results = [result for result in pool.map(send, range(requests)) if result]
    successes = [response for _, response in results if response.is_success]
    cost = sum(spike.prices.actual(CONTRIBUTOR, r.json()) or worst_each for r in successes)
    spike.spent += cost
    limited = [(index, response) for index, response in results if response.status_code == 429]
    remaining = [
        int(r.headers["x-ratelimit-remaining-requests"])
        for r in successes
        if r.headers.get("x-ratelimit-remaining-requests", "").isdigit()
    ]
    probe = Probe(
        "rate_limit.burst_contributor",
        {"method": "POST", "path": "/chat/completions", "body": body, "concurrency": concurrency},
        cost_usd=cost,
        facts={
            "sent": len(results),
            "statuses": dict(Counter(response.status_code for _, response in results)),
            "min_remaining_requests_seen": min(remaining, default=None),
        },
    )
    if limited:
        index, response = limited[0]
        probe.status, probe.headers = 429, dict(response.headers)
        probe.response = response.json() if response.content else None
        probe.facts |= {
            "first_429_at_request": index,
            "retry_after": response.headers.get("retry-after"),
        }
    else:
        probe.status = 200
    spike.record(probe)


STEPS: tuple[Callable[[Spike], None], ...] = (
    probe_models_and_errors,
    probe_basic,
    probe_sdk,
    probe_reasoning,
    probe_structured_output,
    probe_tools,
    probe_token_count,
    probe_caching,
    probe_web_search,
    probe_wonder_and_contributor,
)

SECTIONS = (
    ("Models and Contributor mode", ("models.", "wonder.", "contributor.")),
    ("Responses API vs Chat Completions", ("basic.", "sdk.")),
    ("Reasoning effort", ("effort.",)),
    ("Structured output", ("structured.",)),
    ("Tool calling", ("tools.",)),
    ("web_search", ("web_search.",)),
    ("Token counting", ("token_count.", "caching.count")),
    ("Prompt caching", ("caching.call_",)),
    ("Errors", ("error.",)),
    ("429 behaviour", ("rate_limit.",)),
)


def summarize(spike: Spike, mode: str, stamp: str) -> str:
    lines = [f"# API spike {stamp} ({mode})", ""]
    if mode == "mock":
        lines += [
            "MOCK RUN: it checks the script against a local fake. Nothing here is an API fact.",
            "",
        ]
    lines += [
        f"Spent ${spike.spent:.4f} of the ${spike.max_usd:.2f} cap on {len(spike.probes)} probes.",
        "",
    ]
    for title, prefixes in SECTIONS:
        lines += [f"## {title}", ""]
        probes = [probe for probe in spike.probes if probe.name.startswith(prefixes)]
        for probe in probes:
            facts = json.dumps(clip(probe.facts, 200), ensure_ascii=False)
            lines.append(
                f"- `{probe.name}`: {probe.status or probe.error}, {probe.latency_s} s, "
                f"${probe.cost_usd:.5f}. {facts}"
            )
        lines += ([] if probes else ["- not run"]) + [""]
    usage_keys: dict[str, set[str]] = {}
    for probe in spike.probes:
        if probe.ok and isinstance(probe.response, dict) and probe.response.get("usage"):
            kind = str(probe.response.get("object"))
            usage_keys.setdefault(kind, set()).update(flatten(probe.response["usage"]))
    lines += ["## Usage fields seen", ""]
    lines += [f"- {kind}: {', '.join(sorted(keys))}" for kind, keys in sorted(usage_keys.items())]
    rate_headers = {
        name.lower(): value
        for probe in spike.probes
        for name, value in probe.headers.items()
        if name.lower().startswith("x-ratelimit") or name.lower() == "retry-after"
    }
    names = sorted({name.lower() for probe in spike.probes for name in probe.headers})
    lines += [
        "",
        "## Response headers seen",
        "",
        f"- rate limits (last value seen): {json.dumps(rate_headers)}",
        f"- all names: {', '.join(names)}",
        "",
    ]
    if spike.failures:
        lines += ["## Failed steps", "", *(f"- {failure}" for failure in spike.failures), ""]
    return "\n".join(lines)


def write_evidence(spike: Spike, mode: str, base_url: str) -> tuple[Path, Path]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    stem = OUT_DIR / f"spike-{stamp}-{mode}"
    evidence = {
        "mode": mode,
        "base_url": base_url,
        "finished_at": stamp,
        "spent_usd": round(spike.spent, 6),
        "max_usd": spike.max_usd,
        "failures": spike.failures,
        "probes": [clip(asdict(probe), 2000) for probe in spike.probes],
    }
    json_path, md_path = stem.with_suffix(".json"), stem.with_suffix(".md")
    json_path.write_text(json.dumps(evidence, indent=2, ensure_ascii=False), encoding="utf-8")
    md_path.write_text(summarize(spike, mode, stamp), encoding="utf-8")
    return json_path, md_path


MOCK_ARGUMENTS = {
    "get_room_capacity": {"room": "B"},
    "get_speaker_availability": {"speaker": "Ana Ruiz"},
}
MOCK_TALK = {"speaker": "Ana Ruiz", "title": "Fractal Swarms", "room": "B", "day": 2}


def mock_message(text: str, annotations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "type": "message",
        "id": "msg_mock",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": annotations or []}],
    }


class MockAPI:
    """A local stand-in for the API, so that --mock runs exercise every code path at $0."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.contributor_chats = 0
        self.cache_keys: set[str] = set()

    @staticmethod
    def ok(payload: dict[str, Any]) -> httpx.Response:
        headers = {
            "x-ratelimit-limit-requests": "3000",
            "x-ratelimit-remaining-requests": "2999",
            "x-ratelimit-limit-tokens": "4000000",
            "x-ratelimit-remaining-tokens": "3999000",
        }
        return httpx.Response(200, json=payload, headers=headers)

    @staticmethod
    def error(
        status: int,
        kind: str,
        message: str,
        code: str | None = None,
        param: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        error = {"message": message, "type": kind, "param": param, "code": code}
        return httpx.Response(status, json={"error": error}, headers=headers)

    def handle(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != f"Bearer {MOCK_KEY}":
            return self.error(401, "authentication_error", "Invalid API key", "invalid_api_key")
        path = request.url.path.removeprefix("/v1")
        if request.method == "GET":
            if path != "/models":
                return httpx.Response(404)
            models = [{"id": model, "object": "model"} for model in (WONDER, SPARK, CONTRIBUTOR)]
            return self.ok({"object": "list", "data": models})
        body = json.loads(request.content or b"{}")
        model = body.get("model")
        if model not in (WONDER, SPARK, CONTRIBUTOR):
            message = f"Model {model} not found"
            return self.error(404, "invalid_request_error", message, "model_not_found", "model")
        effort = body.get("reasoning_effort") or (body.get("reasoning") or {}).get("effort")
        if effort is not None and (
            effort not in EFFORTS or (effort, model) == ("max", CONTRIBUTOR)
        ):
            message = f"Unsupported reasoning effort: {effort}"
            return self.error(400, "invalid_request_error", message, param="reasoning_effort")
        tokens = len(request.content) // 4
        if path == "/responses/input_tokens":
            return self.ok({"object": "response.input_tokens", "input_tokens": tokens})
        if path == "/chat/completions":
            return self.chat(body, tokens)
        if path == "/responses":
            return self.responses(body, tokens)
        return httpx.Response(404)

    def chat(self, body: dict[str, Any], tokens: int) -> httpx.Response:
        if body["model"] == CONTRIBUTOR:
            with self.lock:
                self.contributor_chats += 1
                if self.contributor_chats > 150:
                    return self.error(
                        429,
                        "rate_limit_error",
                        "Rate limit exceeded",
                        "rate_limit_exceeded",
                        headers={"retry-after": "12"},
                    )
        tools = body.get("tools") or []
        if "web_search_options" in body or any(tool["type"] != "function" for tool in tools):
            message = "Search grounding is not available on Chat Completions"
            return self.error(400, "invalid_request_error", message, param="tools")
        if body.get("tool_choice", "auto") != "auto":
            message = "Only tool_choice auto is supported"
            return self.error(400, "invalid_request_error", message, param="tool_choice")
        response_format = body.get("response_format") or {}
        json_schema = response_format.get("json_schema") or {}
        if (
            json_schema.get("strict")
            and json_schema["schema"].get("additionalProperties") is not False
        ):
            message = "Strict schemas need additionalProperties: false"
            return self.error(400, "invalid_request_error", message, param="response_format")
        message_out: dict[str, Any] = {
            "role": "assistant",
            "content": "OK",
            "reasoning_content": "",
        }
        finish_reason = "stop"
        if tools and body["messages"][-1]["role"] != "tool":
            calls = [
                {
                    "id": f"call_{index}",
                    "type": "function",
                    "function": {
                        "name": tool["function"]["name"],
                        "arguments": json.dumps(MOCK_ARGUMENTS[tool["function"]["name"]]),
                    },
                }
                for index, tool in enumerate(tools)
            ]
            message_out = {"role": "assistant", "content": None, "tool_calls": calls}
            finish_reason = "tool_calls"
        elif response_format:
            message_out["content"] = json.dumps(MOCK_TALK)
        usage = {
            "prompt_tokens": tokens,
            "completion_tokens": 24,
            "total_tokens": tokens + 24,
            "prompt_tokens_details": {"cached_tokens": 0},
            "completion_tokens_details": {"reasoning_tokens": 16},
        }
        choice = {"index": 0, "message": message_out, "finish_reason": finish_reason}
        return self.ok(
            {
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "created": 0,
                "model": body["model"],
                "choices": [choice],
                "usage": usage,
            }
        )

    def responses(self, body: dict[str, Any], tokens: int) -> httpx.Response:
        tools = body.get("tools") or []
        items = body["input"] if isinstance(body["input"], list) else []
        include = body.get("include") or []
        reasoning: dict[str, Any] = {"type": "reasoning", "id": "rs_mock", "summary": []}
        if "reasoning.encrypted_content" in include:
            reasoning["encrypted_content"] = "gAAAAmock" * 40
        output = [reasoning]
        functions = [tool for tool in tools if tool["type"] == "function"]
        if any(tool["type"] == "web_search" for tool in tools):
            result = {
                "type": "text_result",
                "title": "Python Releases",
                "url": "https://www.python.org/downloads/",
                "snippet": "Latest Python 3 release",
            }
            call: dict[str, Any] = {
                "type": "web_search_call",
                "id": "ws_mock",
                "status": "completed",
            }
            if "web_search_call.results" in include:
                call["results"] = [result]
            citation = {"type": "url_citation", "url": result["url"], "title": result["title"]}
            output += [
                call,
                mock_message("See python.org.", [citation | {"start_index": 4, "end_index": 14}]),
            ]
        elif functions and not any(item.get("type") == "function_call_output" for item in items):
            output += [
                {
                    "type": "function_call",
                    "id": f"fc_{index}",
                    "call_id": f"call_{index}",
                    "name": tool["name"],
                    "arguments": json.dumps(MOCK_ARGUMENTS[tool["name"]]),
                    "status": "completed",
                }
                for index, tool in enumerate(functions)
            ]
        elif ((body.get("text") or {}).get("format") or {}).get("type") == "json_schema":
            output.append(mock_message(json.dumps(MOCK_TALK)))
        else:
            output.append(mock_message("OK"))
        cached = 0
        if key := body.get("prompt_cache_key"):
            with self.lock:
                cached = tokens * 9 // 10 if key in self.cache_keys else 0
                self.cache_keys.add(key)
        usage = {
            "input_tokens": tokens,
            "input_tokens_details": {"cached_tokens": cached},
            "output_tokens": 24,
            "output_tokens_details": {"reasoning_tokens": 16},
            "total_tokens": tokens + 24,
        }
        return self.ok(
            {
                "id": "resp_mock",
                "object": "response",
                "created_at": 0,
                "status": "completed",
                "model": body["model"],
                "output": output,
                "usage": usage,
            }
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check the spec §24 assumptions against the API.")
    parser.add_argument("--mock", action="store_true", help="run against a local fake API at $0")
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    parser.add_argument("--max-usd", type=float, default=0.50, help="hard cap on total spend")
    parser.add_argument(
        "--probe-429", action="store_true", help="burst the contributor model until a 429"
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    settings = Settings()
    base_url = settings.model_api_base_url
    if args.mock:
        mode, api_key = "mock", MOCK_KEY
        transport: httpx.BaseTransport | None = httpx.MockTransport(MockAPI().handle)
    else:
        if settings.model_api_key is None:
            print(MISSING_KEY, file=sys.stderr)
            return 2
        mode, api_key, transport = "live", settings.model_api_key.get_secret_value(), None
        if not args.yes:
            print(f"This spike calls {base_url} for real, with a hard cap of ${args.max_usd:.2f}.")
            print(
                "Go on only if the hackathon credits show on dev.meta.ai (Billing -> Free credits)."
            )
            if input("Run it? [y/N] ").strip().lower() != "y":
                return 1

    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(
        base_url=base_url, headers=headers, timeout=180, transport=transport
    ) as client:
        # Live runs use the SDK's own HTTP stack, as the runtime will.
        sdk = OpenAI(
            api_key=api_key,
            base_url=base_url,
            max_retries=0,
            timeout=180,
            http_client=client if args.mock else None,
        )
        spike = Spike(client, sdk, Prices.load(), args.max_usd)
        steps = [*STEPS, probe_rate_limit] if args.probe_429 else list(STEPS)
        try:
            for step in steps:
                try:
                    step(spike)
                except BudgetExceeded:
                    raise
                except Exception as exc:
                    spike.failures.append(f"{step.__name__}: {type(exc).__name__}: {exc}")
                    print(f"step failed: {spike.failures[-1]}")
        except BudgetExceeded as exc:
            spike.failures.append(f"stopped by the budget guard: {exc}")
            print(spike.failures[-1])
        finally:
            json_path, md_path = write_evidence(spike, mode, base_url)
    print(f"\nSpent ${spike.spent:.4f} (cap ${args.max_usd:.2f}).")
    print(f"Evidence: {json_path}\nSummary:  {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
