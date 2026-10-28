"""Agents: execute one contract at a time through a tool-calling loop (spec §10).

Each step is one ``llm`` effect on the Responses API, stateless: the next step's input is
the previous input, plus the model's output items (function calls and encrypted reasoning),
plus one ``function_call_output`` per call. Tools run on the blackboard actor, so every
call and result is in the log. ``tool_choice`` can only be ``auto`` on this API, so a plain
text answer is accepted at any step: it is the final answer and must match the contract's
``produces`` schema (structured output).

Tools are deny-by-default: only the ones the contract lists are offered or executed.
"""

import json
from typing import Any

from pydantic import ValidationError

from fractalswarm.actors.board import BOARD, TOOL_ARGS, TOOL_DESCRIPTIONS
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Send, StartEffect, Stop, View
from fractalswarm.planning.contracts import Contract, ContractResult
from fractalswarm.planning.planner import UNTRUSTED_NOTE, compose
from fractalswarm.planning.schemas import OUTPUT_MODELS, function_tool, text_format

AGENT_INSTRUCTIONS = """You are an agent of FractalSwarm. You execute one contract: reach its
objective within its constraints, using only the tools offered. Call tools when you need
shared memory or the workspace; several calls in one turn are fine. When you are done,
answer with one JSON object that matches the required schema, and nothing else."""


def tool_defs(names: list[str]) -> list[dict[str, Any]]:
    return [
        function_tool(name, TOOL_DESCRIPTIONS[name], TOOL_ARGS[name])
        for name in names
        if name in TOOL_ARGS
    ]


def contract_prompt(contract: Contract) -> str:
    header = "\n".join(
        [
            f"CONTRACT {contract.goal_id}/{contract.id} (attempt {contract.attempt})",
            f"Kind: {contract.kind}",
            f"Objective: {contract.objective}",
            "Constraints:",
            *(f"- {line}" for line in contract.constraints),
            f"Tools: {', '.join(contract.tools) or 'none'}",
            f"Scope token: {contract.scope_token}",
        ]
    )
    data = dict(contract.inputs.get("data", {}))
    if contract.feedback:
        data["feedback_from_previous_attempt"] = contract.feedback
    return compose(header, data, contract.inputs.get("untrusted"))


def llm_request(contract: Contract, items: list[dict[str, Any]]) -> dict[str, Any]:
    schema = contract.produces[0].schema_name
    return {
        "role": contract.model_role,
        "instructions": f"{AGENT_INSTRUCTIONS}\n\n{UNTRUSTED_NOTE}",
        "input": items,
        "text_format": text_format(schema, OUTPUT_MODELS[schema]),
        "tools": tool_defs(contract.tools),
        "prompt_cache_key": f"agent:{schema}",
        "keep_reasoning": True,
    }


def agent_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": actor_id,
        "owner": args["owner"],
        "squad": args["squad"],
        "max_steps": int(args.get("max_steps", 8)),
        "contributor": bool(args.get("contributor")),
        "queue": [],
        "cur": None,
        "done": 0,
    }


def agent_handle(state: dict[str, Any], event: Event, view: View):
    if event.type == "msg.sent":
        topic, body = event.payload["topic"], event.payload["body"]
        if topic == "contract":
            level = body.get("level", "L0")  # the model ladder's level (spec §7.4)
            state = {**state, "queue": [*state["queue"], body["contract"]], "level": level}
            return _next(state)
        if topic == "tool.result":
            return _tool_result(state, body)
        if topic == "shutdown":
            return state, [Stop(reason="shutdown")]
        return state, []
    if event.type == "effect.completed":
        return _llm_done(state, event)
    return state, []


def _next(state: dict[str, Any]) -> tuple[dict[str, Any], list[Command]]:
    if state["cur"] is not None or not state["queue"]:
        return state, []
    contract = Contract.model_validate(state["queue"][0])
    items = [{"role": "user", "content": contract_prompt(contract)}]
    cur = {"contract": state["queue"][0], "step": 1, "items": items, "calls": [], "outputs": {}}
    cur["published"] = []
    state = {**state, "queue": state["queue"][1:], "cur": cur}
    return state, [_call(state, contract, cur)]


def _call(state: dict[str, Any], contract: Contract, cur: dict[str, Any]) -> StartEffect:
    request = llm_request(contract, cur["items"])
    if state.get("level", "L0") != "L0":
        request = request | {"level": state["level"]}
    return StartEffect(
        kind="llm",
        request=request | {"contributor": True} if state.get("contributor") else request,
        tag=f"{contract.idem_key}:{cur['step']}",
        scopes={"contract": contract.idem_key, "squad": contract.owner},
    )


def _llm_done(state: dict[str, Any], event: Event):
    cur = state["cur"]
    if cur is None:
        return state, []
    contract = Contract.model_validate(cur["contract"])
    if event.payload["tag"] != f"{contract.idem_key}:{cur['step']}":
        return state, []
    status, result = event.payload["status"], event.payload["result"]
    if status != "ok":
        reason = result.get("error") or result.get("reason") or result.get("incomplete_reason")
        return _finish(state, contract, "error", {}, f"LLM call {status}: {reason}")

    output = result.get("output") or []
    calls = [item for item in output if item.get("type") == "function_call"]
    if not calls:
        text = result.get("output_text") or ""
        try:
            answer = json.loads(text)
        except ValueError:
            return _finish(state, contract, "error", {}, f"final answer is not JSON: {text[:200]}")
        if not isinstance(answer, dict):
            return _finish(state, contract, "error", {}, "final answer is not a JSON object")
        return _finish(state, contract, "ok", answer, "")

    if cur["step"] >= state["max_steps"]:
        return _finish(state, contract, "error", {}, f"no answer after {cur['step']} steps")
    commands: list[Command] = []
    outputs: dict[str, Any] = {}
    for call in calls:
        call_id, name = call.get("call_id", ""), call.get("name", "")
        if name not in contract.tools:
            outputs[call_id] = {"error": f"tool {name!r} is not allowed for this contract"}
            continue
        try:
            args = json.loads(call.get("arguments") or "{}")
            args = TOOL_ARGS[name].model_validate(args).model_dump()
        except (ValueError, ValidationError) as exc:
            outputs[call_id] = {"error": f"bad arguments for {name}: {exc}"[:500]}
            continue
        body = {
            "call_id": call_id,
            "name": name,
            "args": args,
            "squad": contract.owner,
            "agent": state["id"],
            "contract": contract.idem_key,
        }
        commands.append(Send(to=BOARD, topic="tool", body=body))
    cur = {
        **cur,
        "items": [*cur["items"], *output],
        "calls": [call.get("call_id", "") for call in calls],
        "outputs": outputs,
    }
    state = {**state, "cur": cur}
    if not commands:
        return _continue(state)
    return state, commands


def _tool_result(state: dict[str, Any], body: dict[str, Any]):
    cur = state["cur"]
    if cur is None:
        return state, []
    contract = Contract.model_validate(cur["contract"])
    if body["contract"] != contract.idem_key or body["call_id"] not in cur["calls"]:
        return state, []
    output = body["output"]
    published = cur["published"]
    if output.get("ok") and "key" in output and "version" in output:
        published = sorted({*published, output["key"]})
    cur = {**cur, "outputs": {**cur["outputs"], body["call_id"]: output}, "published": published}
    state = {**state, "cur": cur}
    if len(cur["outputs"]) < len(cur["calls"]):
        return state, []
    return _continue(state)


def _continue(state: dict[str, Any]):
    cur = state["cur"]
    contract = Contract.model_validate(cur["contract"])
    results = [
        {
            "type": "function_call_output",
            "call_id": call_id,
            "output": json.dumps(cur["outputs"][call_id], sort_keys=True, ensure_ascii=False),
        }
        for call_id in cur["calls"]
    ]
    cur = {**cur, "items": [*cur["items"], *results], "step": cur["step"] + 1}
    cur |= {"calls": [], "outputs": {}}
    state = {**state, "cur": cur}
    return state, [_call(state, contract, cur)]


def _finish(state: dict[str, Any], contract: Contract, status: str, output: dict, error: str):
    cur = state["cur"]
    result = ContractResult(
        contract_id=contract.id,
        goal_id=contract.goal_id,
        attempt=contract.attempt,
        agent=state["id"],
        status=status,  # type: ignore[arg-type]
        output=output,
        error=error,
        published=cur["published"],
        steps=cur["step"],
        idem_key=contract.idem_key,
    )
    state = {**state, "cur": None, "done": state["done"] + 1}
    send = Send(to=contract.owner, topic="contract.result", body=result.model_dump())
    state, more = _next(state)
    return state, [send, *more]
