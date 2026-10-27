"""The intake policy classifier (spec §13): allow, constrain or refuse a task.

It is one LLM call with role ``safety_classifier`` (Spark, effort minimal, never degraded:
``config/roles.yaml``) and a strict JSON schema, so the answer is machine-checked. The task
text is untrusted: it goes in the input, spotlighted, never in the instructions. Anything
that does not parse as a valid decision fails closed (refuse).

Use ``policy_request`` as the request of an ``llm`` effect (so the call is reserved, recorded
in the cassette and replayed) and ``parse_policy`` on its completion result.
"""

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from fractalswarm.safety.firewall import SPOTLIGHT_RULE, spotlight

ROLE = "safety_classifier"

HAZARD_CATEGORIES = (
    "violence_weapons",
    "cbrn",
    "cyber_offense",
    "csam",
    "self_harm",
    "hate",
    "privacy",
    "fraud",
    "election_misinformation",
    "ip",
)
PolicyOutcome = Literal["allow", "constrain", "refuse"]

POLICY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "decision": {"type": "string", "enum": ["allow", "constrain", "refuse"]},
        "categories": {
            "type": "array",
            "items": {"type": "string", "enum": list(HAZARD_CATEGORIES)},
        },
        "explanation": {"type": "string"},
        "constraints": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["decision", "categories", "explanation", "constraints"],
    "additionalProperties": False,
}
TEXT_FORMAT: dict[str, Any] = {
    "type": "json_schema",
    "name": "intake_policy",
    "schema": POLICY_SCHEMA,
    "strict": True,
}

INSTRUCTIONS = (
    "You are the intake policy classifier of a multi-agent runtime. Decide whether the task "
    "may run. Hazard categories: " + ", ".join(HAZARD_CATEGORIES) + ". "
    "Answer 'allow' for ordinary work; 'constrain' when the task is fine but some part needs "
    "a limit (list each limit in 'constraints', e.g. 'do not collect personal phone "
    "numbers'); 'refuse' when the task's purpose is harmful. List every category that "
    "applies, and explain the decision in one or two sentences. " + SPOTLIGHT_RULE
)


class PolicyDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    decision: PolicyOutcome
    categories: list[str]
    explanation: str
    constraints: list[str]


def policy_request(task_text: str, task_id: str = "task") -> dict[str, Any]:
    """The ``llm`` effect request that classifies ``task_text``."""
    return {
        "role": ROLE,
        "instructions": INSTRUCTIONS,
        "input": spotlight(task_text, f"intake:{task_id}"),
        "text_format": TEXT_FORMAT,
    }


def refuse(reason: str) -> PolicyDecision:
    return PolicyDecision(decision="refuse", categories=[], explanation=reason, constraints=[])


def parse_policy(status: str, result: dict[str, Any]) -> PolicyDecision:
    """The decision from an ``llm`` effect completion; fails closed."""
    if status != "ok":
        reason = result.get("error") or result.get("reason") or status
        return refuse(f"policy classifier unavailable ({reason}); refusing by default")
    try:
        data = json.loads(result.get("output_text") or "")
        decision = PolicyDecision.model_validate(data)
    except (ValueError, ValidationError):
        return refuse("policy classifier answer did not match the schema; refusing by default")
    unknown = sorted(set(decision.categories) - set(HAZARD_CATEGORIES))
    if unknown:
        return refuse(f"policy classifier named unknown categories {unknown}; refusing")
    return decision
