"""Toy scenarios for the kernel: messages, LLM calls, timers and budget scopes.

``TOY``: a hub and two workers. Each round the hub sends a task to every worker; a worker
asks the LLM, sets a timer with a seeded random delay, and reports its result and a progress
ping. After the last round the hub asks the judge role to merge the results, emits
``toy.done`` and stops everyone. A deadline timer ends the run if anything hangs.

``ONE_CALL``: one actor, one tiny LLM call (the real-call golden fixture, spec Day 3 item 13).
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.kernel.events import Event, Payload, register
from fractalswarm.kernel.scheduler import (
    ActorKind,
    Cancel,
    Command,
    Emit,
    Send,
    SetCap,
    SetTimer,
    Spawn,
    StartEffect,
    Stop,
    View,
)

SQUAD = "toy"


@register("toy.progress")
class ToyProgress(Payload):
    worker: str
    round: int


@register("toy.done")
class ToyDone(Payload):
    rounds: int
    summary: str
    results: dict[str, str]


@register("toy.timeout")
class ToyTimeout(Payload):
    round: int


def hub_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "workers": list(args["workers"]),
        "rounds": int(args["rounds"]),
        "deadline_ms": int(args["deadline_ms"]),
        "round": 0,
        "results": {},
        "done": False,
    }


def hub_handle(state: dict[str, Any], event: Event, view: View):
    commands: list[Command] = []
    if event.type == "actor.spawned":
        commands += [Spawn(actor_id=worker, kind="worker") for worker in state["workers"]]
        commands.append(SetTimer(delay_ms=state["deadline_ms"], tag="deadline"))
        state, more = _next_round(state)
        return state, commands + more

    if event.type == "msg.sent" and event.payload["topic"] == "progress":
        body = event.payload["body"]
        return state, [Emit(type="toy.progress", payload=body)]

    if event.type == "msg.sent" and event.payload["topic"] == "result":
        body = event.payload["body"]
        if body["round"] != state["round"]:
            return state, []
        key = f"r{body['round']}:{body['worker']}"
        results = {**state["results"], key: body["text"]}
        state = {**state, "results": results}
        if len(results) < len(state["workers"]) * state["round"]:
            return state, []
        if state["round"] < state["rounds"]:
            return _next_round(state)
        merged = "\n".join(f"{key}: {results[key]}" for key in sorted(results))
        request = {"role": "judge", "input": f"Merge these results:\n{merged}"}
        return state, [StartEffect(kind="llm", request=request, tag="merge")]

    if event.type == "effect.completed" and event.payload["tag"] == "merge":
        summary = event.payload["result"].get("output_text", "")
        done = {"rounds": state["rounds"], "summary": summary, "results": state["results"]}
        stops = [Stop(actor_id=worker, reason="done") for worker in state["workers"]]
        commands = [Emit(type="toy.done", payload=done), Cancel(tag="deadline"), *stops, Stop()]
        return {**state, "done": True}, commands

    if event.type == "effect.completed" and event.payload["tag"] == "deadline":
        stops = [Stop(actor_id=worker, reason="timeout") for worker in state["workers"]]
        return state, [Emit(type="toy.timeout", payload={"round": state["round"]}), *stops, Stop()]

    return state, []


def _next_round(state: dict[str, Any]) -> tuple[dict[str, Any], list[Command]]:
    number = state["round"] + 1
    commands: list[Command] = [
        Send(
            to=worker,
            topic="task",
            body={"round": number, "text": f"Summarize item {number} for {worker}."},
        )
        for worker in state["workers"]
    ]
    return {**state, "round": number}, commands


def worker_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    return {"id": actor_id, "round": 0}


def worker_handle(state: dict[str, Any], event: Event, view: View):
    if event.type == "msg.sent" and event.payload["topic"] == "task":
        number = event.payload["body"]["round"]
        request = {"role": "agent", "input": event.payload["body"]["text"]}
        delay = view.rng(f"tick:{number}").randrange(100, 900)
        scopes = {"contract": f"{state['id']}-r{number}", "squad": SQUAD}
        return {**state, "round": number}, [
            StartEffect(kind="llm", request=request, tag=f"task:{number}", scopes=scopes),
            SetTimer(delay_ms=delay, tag=f"tick:{number}"),
        ]
    if event.type == "effect.completed":
        tag = event.payload["tag"] or ""
        number = int(tag.split(":")[1])
        if tag.startswith("tick:"):
            body = {"worker": state["id"], "round": number}
            return state, [Send(to="hub", topic="progress", body=body)]
        result = event.payload["result"]
        text = result.get("output_text") or f"<{event.payload['status']}>"
        body = {"worker": state["id"], "round": number, "text": text}
        return state, [Send(to="hub", topic="result", body=body)]
    return state, []


@dataclass(frozen=True)
class ToyScenario:
    kinds = {
        "hub": ActorKind(hub_init, hub_handle),
        "worker": ActorKind(worker_init, worker_handle),
    }

    def boot(self, params: dict[str, Any]) -> list[Command]:
        args = {
            "workers": params.get("workers", ["worker-a", "worker-b"]),
            "rounds": params.get("rounds", 2),
            "deadline_ms": params.get("deadline_ms", 60_000),
        }
        return [
            SetCap(level="squad", key=SQUAD, usd=params.get("squad_cap_usd", 0.25)),
            Spawn(actor_id="hub", kind="hub", args=args),
        ]


def caller_handle(state: dict[str, Any], event: Event, view: View):
    if event.type == "actor.spawned":
        request = {"role": state["role"], "input": state["prompt"]}
        return state, [StartEffect(kind="llm", request=request, tag="call")]
    if event.type == "effect.completed":
        result = event.payload["result"]
        done = {"rounds": 1, "summary": result.get("output_text", ""), "results": {}}
        return state, [Emit(type="toy.done", payload=done), Stop()]
    return state, []


@dataclass(frozen=True)
class OneCallScenario:
    kinds = {"caller": ActorKind(lambda actor_id, args: dict(args), caller_handle)}

    def boot(self, params: dict[str, Any]) -> list[Command]:
        args = {
            "role": params.get("role", "judge"),
            "prompt": params.get("prompt", "Reply with the single word: ok"),
        }
        return [Spawn(actor_id="caller", kind="caller", args=args)]


TOY = ToyScenario()
ONE_CALL = OneCallScenario()
