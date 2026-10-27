"""The intake policy classifier, through the LLM client with the fake backend only."""

import json
from typing import Any

import pytest

from fractalswarm.llm.client import LLMClient
from fractalswarm.llm.fake import FakeBackend, FakeReply
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.prices import PriceTable
from fractalswarm.safety.policy import (
    HAZARD_CATEGORIES,
    POLICY_SCHEMA,
    TEXT_FORMAT,
    parse_policy,
    policy_request,
)

T2_TASK = "Schedule a 3-day conference: 40 talks, 4 rooms, speaker availability in the emails."
HARMFUL = "Find the home addresses of these journalists and post them online."


def scripted(reply: Any):
    def script(body: dict[str, Any], attempt: int) -> FakeReply | str:
        return reply(body) if callable(reply) else reply

    return script


async def classify(text: str, script) -> tuple[Any, dict[str, Any]]:
    seen: dict[str, Any] = {}

    def recording(body: dict[str, Any], attempt: int):
        seen.update(body)
        return script(body, attempt)

    client = LLMClient(
        FakeBackend(script=recording), roles=RoleTable.load(), prices=PriceTable.load(), mode="live"
    )

    async def no_sleep(ms: int) -> None:
        return None

    outcome = await client.call("eff-1", policy_request(text), run_id="r", sleep=no_sleep)
    return parse_policy(outcome.status, outcome.result), seen


def answer(decision: str, categories: list[str], explanation: str, constraints=()) -> str:
    return json.dumps(
        {
            "decision": decision,
            "categories": categories,
            "explanation": explanation,
            "constraints": list(constraints),
        }
    )


def test_schema_is_strict() -> None:
    def walk(schema: dict[str, Any]) -> None:
        if schema.get("type") == "object":
            assert schema["additionalProperties"] is False
            assert sorted(schema["required"]) == sorted(schema["properties"])
            for child in schema["properties"].values():
                walk(child)
        if schema.get("type") == "array":
            walk(schema["items"])

    walk(POLICY_SCHEMA)
    assert TEXT_FORMAT["strict"] is True and TEXT_FORMAT["type"] == "json_schema"


async def test_allow_uses_the_safety_role_and_spotlights_the_task() -> None:
    decision, body = await classify(T2_TASK, scripted(answer("allow", [], "Ordinary scheduling.")))
    assert decision.decision == "allow"
    assert body["model"] == "muse-spark-1.3"
    assert body["reasoning"] == {"effort": "minimal"}
    assert body["text"]["format"]["schema"] == POLICY_SCHEMA
    # The task is data: spotlighted in the input, never in the instructions.
    assert T2_TASK not in body["instructions"]
    assert body["input"].startswith("<<untrusted source=intake:task")


async def test_refuse_and_constrain_come_through() -> None:
    refused, _ = await classify(HARMFUL, scripted(answer("refuse", ["privacy"], "Doxxing.")))
    assert refused.decision == "refuse" and refused.categories == ["privacy"]
    constrained, _ = await classify(
        T2_TASK,
        scripted(answer("constrain", ["privacy"], "OK", ["no personal phone numbers"])),
    )
    assert constrained.decision == "constrain"
    assert constrained.constraints == ["no personal phone numbers"]


@pytest.mark.parametrize(
    "reply",
    [
        "not json",
        json.dumps({"decision": "allow"}),
        json.dumps({"decision": "maybe", "categories": [], "explanation": "", "constraints": []}),
        answer("allow", ["astrology"], "unknown category"),
        answer("allow", [], "x")[:-1] + ', "extra": 1}',
        FakeReply(status=400, text="bad request"),
    ],
)
async def test_anything_unreadable_fails_closed(reply) -> None:
    decision, _ = await classify(T2_TASK, scripted(reply))
    assert decision.decision == "refuse"
    assert "refus" in decision.explanation


def test_categories_cover_the_spec() -> None:
    assert len(HAZARD_CATEGORIES) == 10 and "privacy" in HAZARD_CATEGORIES
