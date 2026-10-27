"""The orchestrator judge (spec §11 step 2): Spark at effort low scores an output against the
contract's rubric and returns pass or fail with reasons.

The deterministic checks have already passed when the judge runs, so an unusable verdict
(an API error or malformed JSON) does not block the contract: it passes with a note.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from fractalswarm.planning.contracts import Contract
from fractalswarm.planning.planner import parse_json, plan_request

JUDGE_INSTRUCTIONS = """You are the judge of a FractalSwarm orchestrator. Score the agent's
output against the rubric, using the contract and its data. Fail it only for a concrete
problem that you can name; list the problems as short, actionable reasons. Reply with JSON
matching the schema."""


class Verdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: Literal["pass", "fail"]
    score: float
    reasons: list[str]


def judge_request(
    contract: Contract, output: dict[str, Any], data: dict[str, Any]
) -> dict[str, Any]:
    return plan_request(
        role="judge",
        schema_name="judge_verdict",
        model=Verdict,
        instructions=JUDGE_INSTRUCTIONS,
        header=f"CONTRACT {contract.goal_id}/{contract.id} ({contract.kind})\n"
        f"Objective: {contract.objective}",
        data={"rubric": contract.acceptance.rubric, "contract_data": data},
        untrusted={"agent_output": output},
    )


def read_verdict(status: str, text: str) -> Verdict:
    if status != "ok":
        return Verdict(verdict="pass", score=0.0, reasons=[f"judge unavailable ({status})"])
    verdict, errors = parse_json(Verdict, text)
    if verdict is None:
        return Verdict(verdict="pass", score=0.0, reasons=[f"judge answer unusable: {errors}"])
    return verdict
