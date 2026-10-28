"""The swarm scenario: the blackboard plus the fractal tree of orchestrators and agents.

``params`` (recorded in ``run.started``, so replay needs no fixture files):
``{"spec": TaskSpec as a dict, "corpus": ..., "truth": ...}``, and optionally:
- ``"chaos"``: a chaos plan, or ``{"profile": "C2", "seed": "1"}`` (spec §15.4). It spawns
  the chaos network and the monkey, and turns membership on;
- ``"membership"``: failure detection and takeover (default: on with chaos);
- ``"channel_breakers"``: the bus's channel and topic-storm breakers on every orchestrator's
  endpoint (``comms/channel_breakers.py``): ``True``, or a dict of ``GuardPolicy`` overrides
  (default: the spec's ``channel_breakers``, off). Nothing is recorded for a run without it.

``central`` is the central baseline (spec §15.1) on the same task, the same LLM calls and the
same chaos: one orchestrator plans every level and leads every squad, under the best-case
supervisor. The monkey crashes it by signal (``chaos.crash``) instead of stopping it.
``single`` and ``pipeline`` are the same process with one worker (``actors/orchestrator.py``).
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.actors import events as _events  # noqa: F401  (registers the event types)
from fractalswarm.actors.agent import agent_handle, agent_init
from fractalswarm.actors.board import BOARD, board_handle, board_init
from fractalswarm.actors.orchestrator import (
    CENTRAL_MODES,
    orchestrator_handle,
    orchestrator_init,
)
from fractalswarm.comms.chaos import (
    CHAOS,
    CHAOS_MONKEY,
    NET,
    NET_KIND,
    ActorsView,
    ProgressSpec,
    ProgressView,
    plan_from,
)
from fractalswarm.coord.membership import MembersView
from fractalswarm.coord.tree import ROLE, TreeView
from fractalswarm.kernel.scheduler import ActorKind, Command, Spawn
from fractalswarm.planning.scope import ScopeView

ROOT = "o0"
CONTRACTS_PER_SESSION = 3  # extract, place, blurb
# A T2 contract's run-wide key is ``work`` (gid/cid); its owner is the session's owner.
T2_PROGRESS = ProgressSpec(
    created=frozenset({"contract.created"}),
    dispatched=frozenset({"contract.dispatched"}),
    finished=frozenset({"contract.verified", "contract.failed"}),
    owners=frozenset({"ownership.remapped"}),
    key_field="work",
    keys_field="works",
)


def expected_contracts(corpus: dict[str, Any]) -> int:
    """T2 has one session per (track, day) and three contracts per session."""
    return len(corpus["tracks"]) * len(corpus["days"]) * CONTRACTS_PER_SESSION


@dataclass(frozen=True)
class SwarmScenario:
    mode: str = "swarm"  # swarm | central | single | pipeline
    kinds = {
        "board": ActorKind(board_init, board_handle),
        "orchestrator": ActorKind(orchestrator_init, orchestrator_handle),
        "agent": ActorKind(agent_init, agent_handle),
        NET: NET_KIND,
        CHAOS: CHAOS_MONKEY.kind(),
    }

    def reducers(self) -> list[Any]:
        return [MembersView(), ProgressView(T2_PROGRESS), ActorsView(), TreeView(), ScopeView()]

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
        chaos = params.get("chaos")
        membership = self.mode == "swarm" and bool(params.get("membership", chaos is not None))
        args = {
            "level": 0,
            "fanout": scaling["fanout"],
            "agents_per_leaf": scaling["agents_per_leaf"],
            "task": spec["task"],
            "max_attempts": spec["max_attempts"],
            "max_steps": spec["max_steps"],
            "root_goal": root_goal,
            "mode": self.mode,
            "membership": membership,
            "relay": NET if membership and chaos is not None else None,
            "contributor": bool(params.get("contributor", spec.get("contributor_opt_in"))),
        }
        breakers = params.get("channel_breakers", spec.get("channel_breakers"))
        if breakers:  # only when on: a run that never asked for them records nothing new
            args["channel_breakers"] = breakers
        commands: list[Command] = [Spawn(actor_id=BOARD, kind="board", args={})]
        if args["relay"] is not None:
            commands.append(Spawn(actor_id=NET, kind=NET, args={}))
        commands.append(Spawn(actor_id=ROOT, kind="orchestrator", args=args))
        if chaos is not None:
            monkey = {
                "plan": plan_from(params).model_dump(mode="json"),
                "coordinator_role": ROLE,
                "agent_kinds": ["agent"],
                "crash_mode": "signal" if self.mode in CENTRAL_MODES else "stop",
                "expected_work": expected_contracts(params["corpus"]),
            }
            commands.append(Spawn(actor_id=CHAOS, kind=CHAOS, args=monkey))
        return commands


SWARM = SwarmScenario()
CENTRAL = SwarmScenario(mode="central")
SINGLE = SwarmScenario(mode="single")
PIPELINE = SwarmScenario(mode="pipeline")
