"""Bottom-up integration (spec §4 step 8): sessions -> track -> root.

Integration is a duty of whoever owns the subgoal, so it is a set of pure functions the
owning orchestrator calls, not a separate actor: on Day 5 a successor that adopts a
subgoal inherits the duty with the subgoal. A partial result lists its gaps explicitly.
"""

from typing import Any

from fractalswarm.kernel.scheduler import Command, Emit, Send
from fractalswarm.planning.dag import Dag


def leaf_outcome(task: Any, entry: dict[str, Any], dag: Dag) -> tuple[dict[str, Any], list[str]]:
    """A leaf goal's output from its verified contracts, and the contracts it lacks."""
    goal_id = entry["goal"]["id"]
    gaps = [
        f"{goal_id}/{cid}: {entry['status'][cid]}"
        for cid in dag.order
        if entry["status"][cid] != "verified"
    ]
    return task.integrate_leaf(entry["goal"], entry["outputs"]), gaps


def merge_children(
    task: Any, goal: dict[str, Any], children: dict[str, dict[str, Any]]
) -> tuple[dict[str, Any], list[str]]:
    results = {cid: child["result"] for cid, child in children.items()}
    gaps: list[str] = []
    for cid in sorted(results):
        gaps += results[cid].get("gaps", [])
        if results[cid]["status"] == "failed":
            gaps.append(f"{cid}: failed")
    return task.integrate(goal, results), gaps


def finish_goal(
    task: Any, owner: str, entry: dict[str, Any], output: dict[str, Any], gaps: list[str]
) -> list[Command]:
    goal = entry["goal"]
    status = "ok" if not gaps else "partial"
    payload = {"goal_id": goal["id"], "owner": owner, "status": status, "gaps": gaps}
    commands: list[Command] = [Emit(type="goal.completed", payload=payload)]
    if entry["from"] is None:
        report = task.final_report(goal, output) | {"gaps": gaps}
        if report["hard_violations"]:
            status = "partial"
        commands.append(
            Emit(type="task.result", payload={"task": task.name, "status": status, "report": report})
        )
        return commands
    body = {"goal_id": goal["id"], "status": status, "output": output, "gaps": gaps}
    commands.append(Send(to=entry["from"], topic="result", body=body))
    return commands
