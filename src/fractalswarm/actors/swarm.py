"""The swarm scenario: the blackboard plus the fractal tree of orchestrators and agents.

``params`` (recorded in ``run.started``, so replay needs no fixture files):
``{"spec": TaskSpec as a dict, "corpus": ..., "truth": ...}``.
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.actors import events as _events  # noqa: F401  (registers the event types)
from fractalswarm.actors.agent import agent_handle, agent_init
from fractalswarm.actors.board import BOARD, board_handle, board_init
from fractalswarm.actors.orchestrator import orchestrator_handle, orchestrator_init
from fractalswarm.kernel.scheduler import ActorKind, Command, Spawn

ROOT = "o0"


@dataclass(frozen=True)
class SwarmScenario:
    kinds = {
        "board": ActorKind(board_init, board_handle),
        "orchestrator": ActorKind(orchestrator_init, orchestrator_handle),
        "agent": ActorKind(agent_init, agent_handle),
    }

    def boot(self, params: dict[str, Any]) -> list[Command]:
        spec = params["spec"]
        scaling = spec["scaling"]
        if scaling["mode"] != "exact":
            raise ValueError("only exact scaling is implemented (autoscale is a fallback item)")
        if len(scaling["fanout"]) != 2:
            raise ValueError("the T2 slice runs at depth 2: fanout [tracks, sessions-owners]")
        root_goal = {
            "id": "root",
            "goal": spec["goal"],
            "corpus": params["corpus"],
            "truth": params["truth"],
        }
        args = {
            "level": 0,
            "fanout": scaling["fanout"],
            "agents_per_leaf": scaling["agents_per_leaf"],
            "task": spec["task"],
            "max_attempts": spec["max_attempts"],
            "max_steps": spec["max_steps"],
            "root_goal": root_goal,
        }
        return [
            Spawn(actor_id=BOARD, kind="board", args={}),
            Spawn(actor_id=ROOT, kind="orchestrator", args=args),
        ]


SWARM = SwarmScenario()
