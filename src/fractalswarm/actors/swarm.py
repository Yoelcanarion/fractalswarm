"""The swarm scenario: the blackboard plus the fractal tree of orchestrators and agents.

``params`` (recorded in ``run.started``, so replay needs no fixture files):
``{"spec": TaskSpec as a dict, "corpus": ..., "truth": ...}``, and optionally:
- ``"chaos"``: a chaos plan, or ``{"profile": "C2", "seed": "1"}`` (spec §15.4). It spawns
  the chaos network and the monkey, and turns membership on;
- ``"membership"``: failure detection and takeover (default: on with chaos);
- ``"channel_breakers"``: the bus's channel and topic-storm breakers on every orchestrator's
  endpoint (``comms/channel_breakers.py``): ``True``, or a dict of ``GuardPolicy`` overrides
  (default: the spec's ``channel_breakers``, off). Nothing is recorded for a run without it;
- ``"market"``: the economy's settings (``planning/taskspec.py: market_params``). Present
  only when the epoch auction or autoscale is on; a log without it replays as off;
- ``"arbitration"``: Wonder rules a semantic dispute between two contracts' facts at the lowest
  common ancestor (``actors/arbitration.py``). Passed to the board and the root only when on,
  so a run that never asked for it logs the spawn args it always did.

``central`` is the central baseline (spec §15.1) on the same task, the same LLM calls and the
same chaos: one orchestrator plans every level and leads every squad, under the best-case
supervisor. The monkey crashes it by signal (``chaos.crash``) instead of stopping it.
``single`` and ``pipeline`` are the same process with one worker (``actors/orchestrator.py``).
``durable-max`` and ``durable`` are the arena's rivals (``baselines/durable.py``): the same
process, but a crash stops no worker; what they and the board send meanwhile is adopted from
the log at the restart. Under ``durable`` the coordinator's own calls in flight are lost, under
``durable-max`` they are not.

Sweeps set three more ``params`` (bench/matrix-*.yaml), all absent from a default run:
``recovery_ms`` (a member is declared dead, and a supervisor is back, this long after the
crash), ``rival_recovery_ms`` (the same for the supervisors only) and ``rival_restart_ms``
(more time to come back, on top of the detection, for the supervisors only).
"""

from dataclasses import dataclass
from typing import Any

from fractalswarm.actors import events as _events  # noqa: F401  (registers the event types)
from fractalswarm.actors.agent import agent_handle, agent_init
from fractalswarm.actors.arbitration import TASK_HOOKS, DisputesView
from fractalswarm.actors.board import BOARD, board_handle, board_init
from fractalswarm.actors.orchestrator import (
    CENTRAL_MODES,
    TASKS,
    heartbeat_interval_ms,
    orchestrator_handle,
    orchestrator_init,
)
from fractalswarm.baselines.durable import DURABLE_MODES, OwnEffectsView
from fractalswarm.bench.profiles import RESTART_DELAY_MS
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
from fractalswarm.market.view import MarketView
from fractalswarm.memory.sources import SourcesView
from fractalswarm.planning.feasibility import RunConfigView
from fractalswarm.planning.risk import RoleHistoryView
from fractalswarm.planning.scope import ScopeView
from fractalswarm.planning.taskspec import AUTOSCALE_KEYS
from fractalswarm.verify.cross_audit import CrossAuditView

ROOT = "o0"
CONTRACTS_PER_SESSION = 3  # T2: extract, place, blurb. T1: extract, resolve, report
# A T2 contract's run-wide key is ``work`` (gid/cid); its owner is the session's owner.
T2_PROGRESS = ProgressSpec(
    created=frozenset({"contract.created"}),
    dispatched=frozenset({"contract.dispatched"}),
    finished=frozenset({"contract.verified", "contract.failed"}),
    owners=frozenset({"ownership.remapped"}),
    key_field="work",
    keys_field="works",
)


def expected_contracts(task: str, corpus: dict[str, Any]) -> int:
    """Each task has one session per leaf goal and three contracts per session; T3 states its
    own count."""
    if "expected_work" in corpus:
        return int(corpus["expected_work"])
    return TASKS[task].sessions(corpus) * CONTRACTS_PER_SESSION


@dataclass(frozen=True)
class SwarmScenario:
    mode: str = "swarm"  # swarm | central | single | pipeline | durable-max | durable
    kinds = {
        "board": ActorKind(board_init, board_handle),
        "orchestrator": ActorKind(orchestrator_init, orchestrator_handle),
        "agent": ActorKind(agent_init, agent_handle),
        NET: NET_KIND,
        CHAOS: CHAOS_MONKEY.kind(),
    }

    def reducers(self) -> list[Any]:
        views = [
            MembersView(),
            ProgressView(T2_PROGRESS),
            ActorsView(),
            TreeView(),
            ScopeView(),
            SourcesView(),
            RoleHistoryView(),
            CrossAuditView(),
            RunConfigView(),
            MarketView(),
            DisputesView(),
        ]
        if self.mode in DURABLE_MODES:  # the rivals read their own calls back from the log
            views.append(OwnEffectsView())
        return views

    def boot(self, params: dict[str, Any]) -> list[Command]:
        spec = params["spec"]
        scaling = spec["scaling"]
        autoscale = None
        if scaling["mode"] == "autoscale":
            if self.mode != "swarm" or params.get("market") is None:
                raise ValueError("autoscale runs on the swarm, with the economy's params")
            autoscale = {key: scaling[key] for key in AUTOSCALE_KEYS}
            width = [autoscale["max_orchestrators_per_group"]] * autoscale["max_depth"]
            scaling = scaling | {"fanout": width}
        elif len(scaling["fanout"]) != 2:
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
        # Off unless asked, and left out of the args when off, so a log that lacks the
        # params (or runs without them) is the same log as before. The baselines have no
        # sibling squad to audit them.
        if self.mode == "swarm" and bool(params.get("cross_audit", spec.get("cross_audit"))):
            args["audit"] = True
        if bool(params.get("feasibility_report", spec.get("feasibility_report"))):
            args["feasibility"] = True
        arbitration = bool(params.get("arbitration", spec.get("arbitration")))
        if arbitration:
            if spec["task"] not in TASK_HOOKS:
                raise ValueError(f"arbitration needs a task with evidence: {sorted(TASK_HOOKS)}")
            args["arbitration"] = True
        market = params.get("market") if self.mode == "swarm" else None
        if market is not None:
            args["market"] = market
        if autoscale is not None:
            args["autoscale"] = autoscale
        args |= self.sweep_knobs(params)
        board_args = {"arbitration": True} if arbitration else {}
        commands: list[Command] = [Spawn(actor_id=BOARD, kind="board", args=board_args)]
        if args["relay"] is not None:
            commands.append(Spawn(actor_id=NET, kind=NET, args={}))
        commands.append(Spawn(actor_id=ROOT, kind="orchestrator", args=args))
        if chaos is not None:
            monkey = {
                "plan": plan_from(params).model_dump(mode="json"),
                "coordinator_role": ROLE,
                "agent_kinds": ["agent"],
                "crash_mode": "signal" if self.mode in CENTRAL_MODES else "stop",
                "expected_work": expected_contracts(spec["task"], params["corpus"]),
            }
            commands.append(Spawn(actor_id=CHAOS, kind=CHAOS, args=monkey))
        return commands

    def sweep_knobs(self, params: dict[str, Any]) -> dict[str, Any]:
        """The root's args for a sweep's times (see the module docstring); none when unset, so
        a default run records the args it always did. The swarm's detection scales the
        heartbeat interval; a supervisor's restart is its detection plus its restart time."""
        recovery = params.get("recovery_ms")
        if self.mode not in CENTRAL_MODES:
            if recovery is None:
                return {}
            heartbeat_interval_ms(int(recovery))  # refused at the start, not mid-run
            return {"detect_ms": int(recovery)}
        detection = params.get("rival_recovery_ms", recovery)
        restart = params.get("rival_restart_ms")
        if detection is None and restart is None:
            return {}
        delay = RESTART_DELAY_MS if detection is None else int(detection)
        if delay < 0 or int(restart or 0) < 0:
            raise ValueError(f"a restart time cannot be negative: {delay} + {restart or 0} ms")
        return {"restart_ms": delay + int(restart or 0)}


SWARM = SwarmScenario()
CENTRAL = SwarmScenario(mode="central")
SINGLE = SwarmScenario(mode="single")
PIPELINE = SwarmScenario(mode="pipeline")
DURABLE_MAX = SwarmScenario(mode="durable-max")
DURABLE = SwarmScenario(mode="durable")
