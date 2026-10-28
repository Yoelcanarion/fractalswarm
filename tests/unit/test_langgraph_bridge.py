"""ChatOpenAI behind the LLM layer (baselines/langgraph_bridge.py)."""

import json

from fractalswarm.baselines.framework_runtime import FrameworkRuntime
from fractalswarm.baselines.langgraph_bridge import (
    CALL_HEADER,
    call_options,
    chat_model,
    response_body,
    to_llm_request,
)
from fractalswarm.kernel.clock import ManualClock
from fractalswarm.kernel.effects import EffectContext, EffectRunner
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.cassette import Cassette
from fractalswarm.llm.client import LLMClient
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.prices import PriceTable

META = {"role": "agent", "actor": "o0.a1", "tag": "t", "scopes": {}, "as_text": False}
FORMAT = {"type": "json_schema", "name": "x", "schema": {"type": "object"}, "strict": True}


def body(items: list[dict], **extra) -> dict:
    return {"model": "ignored", "input": items, "store": False, "stream": False} | extra


def test_the_system_message_becomes_the_instructions_and_a_lone_prompt_goes_as_text() -> None:
    items = [
        {"role": "system", "type": "message", "content": "be brief"},
        {"role": "user", "type": "message", "content": "plan this"},
    ]
    request = to_llm_request(body(items), META | {"as_text": True})
    assert request == {"role": "agent", "instructions": "be brief", "input": "plan this"}


def test_a_tool_loop_keeps_its_items_and_the_options_of_the_call() -> None:
    calls = [
        {"type": "reasoning", "id": "rs_1", "encrypted_content": "blob", "summary": []},
        {"type": "function_call", "call_id": "c1", "name": "memory.search", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "c1", "output": "{}"},
    ]
    items = [{"role": "user", "type": "message", "content": [{"type": "input_text", "text": "go"}]}]
    asked = body(
        items + calls,
        text={"format": FORMAT},
        tools=[{"type": "function", "name": "memory.search"}],
        include=["reasoning.encrypted_content"],
    )
    meta = META | {"contributor": True, "prompt_cache_key": "agent:x"}
    request = to_llm_request(asked, meta)
    assert request["input"] == [{"role": "user", "content": "go"}, *calls]
    assert request["text_format"] == FORMAT and request["tools"][0]["name"] == "memory.search"
    assert request["keep_reasoning"] and request["contributor"]
    assert request["prompt_cache_key"] == "agent:x"
    assert "instructions" not in request


def test_call_options_carry_the_role_the_tag_and_the_scopes_in_one_header() -> None:
    request = {"role": "judge", "text_format": FORMAT, "keep_reasoning": True}
    options = call_options(request, actor="o0", tag="judge|g|c|0", scopes={"squad": "o0"})
    meta = json.loads(options["extra_headers"][CALL_HEADER])
    assert meta["role"] == "judge" and meta["tag"] == "judge|g|c|0"
    assert meta["scopes"] == {"squad": "o0"} and meta["as_text"] is False
    assert options["text"] == {"format": FORMAT} and options["store"] is False
    assert options["include"] == ["reasoning.encrypted_content"]


def test_the_response_body_is_the_one_the_api_would_have_sent() -> None:
    from fractalswarm.kernel.effects import EffectOutcome

    usage = {"input_tokens": 10, "cached_tokens": 4, "output_tokens": 7, "reasoning_tokens": 3}
    result = {"model": "m", "response_id": "resp_1", "response_status": "completed", "usage": usage}
    result["output"] = [{"type": "message", "content": []}]
    rebuilt = response_body(EffectOutcome(status="ok", result=result))
    assert rebuilt["usage"] == {
        "input_tokens": 10,
        "input_tokens_details": {"cached_tokens": 4},
        "output_tokens": 7,
        "output_tokens_details": {"reasoning_tokens": 3},
        "total_tokens": 17,
    }
    assert rebuilt["id"] == "resp_1" and rebuilt["incomplete_details"] is None


async def test_a_chat_model_call_goes_through_the_llm_layer_and_lands_in_the_cassette(
    tmp_path,
) -> None:
    from langchain_core.messages import HumanMessage, SystemMessage

    clock = ManualClock("sim")
    cassette = Cassette(tmp_path / "cassette.jsonl")
    client = LLMClient(
        FakeBackend(),
        roles=RoleTable.load(),
        prices=PriceTable.load(),
        mode="record",
        cassette=cassette,
    )
    rt = FrameworkRuntime(
        EventStore(),
        run_id="r",
        seed="0",
        scenario="test",
        params={},
        mode="sim",
        clock=clock,
        run_cap_usd=1.0,
        estimators={"llm": client.estimate},
        runner=EffectRunner({"llm": client.effect()}, EffectContext("r", clock)),
    )
    replies: list[str] = []

    async def program(rt: FrameworkRuntime) -> None:
        request = {"role": "judge", "prompt_cache_key": "judge:x"}
        options = call_options(request, actor="o0", tag="t1", scopes={"squad": "o0"}, as_text=True)
        model = chat_model(rt).bind(**options)
        reply = await model.ainvoke([SystemMessage(content="rules"), HumanMessage(content="hi")])
        replies.append(str(reply.content))

    await rt.drive(program)
    started = next(e for e in rt.store.read() if e.type == "effect.started")
    assert started.payload["request"]["role"] == "judge"
    assert started.payload["request"]["instructions"] == "rules"
    assert started.payload["request"]["input"] == "hi"
    assert started.payload["tag"] == "t1"
    # the role table, not the ChatOpenAI default, chose the model; the reservation settled
    (entry,) = cassette.entries.values()
    assert entry.model == "muse-spark-1.3" and entry.request["reasoning"] == {"effort": "low"}
    assert any(e.type == "budget.settled" for e in rt.store.read())
    assert replies
