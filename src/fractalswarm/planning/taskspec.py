"""TaskSpec: the user's input as YAML (spec §2, §4). Only ``goal`` is required.

Missing fields take defaults from ``config/defaults.yaml``. Relative fixture paths resolve
against the YAML file's directory first, then the repo root.
"""

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from fractalswarm.config import CONFIG_DIR
from fractalswarm.market.spend_breaker import SpendBreakerConfig

REPO_ROOT = CONFIG_DIR.parent
AUTOSCALE_KEYS = (
    "max_orchestrators_per_group",
    "max_agents_per_orchestrator",
    "max_depth",
    "complexity_threshold",
)


def _defaults() -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / "defaults.yaml").read_text(encoding="utf-8"))


class Scaling(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["exact", "autoscale"] = "exact"
    fanout: list[int] = Field(default_factory=lambda: [3, 2])
    agents_per_leaf: int = Field(default=2, ge=1)
    # Autoscale only (spec §7.3); left out of an exact run's recorded spec.
    max_orchestrators_per_group: int = Field(default=6, ge=1)
    max_agents_per_orchestrator: int = Field(default=4, ge=1)
    max_depth: int = Field(default=2, ge=1)
    complexity_threshold: int = Field(default=1, ge=0)

    @field_validator("fanout")
    @classmethod
    def _positive(cls, value: list[int]) -> list[int]:
        if not value or any(n < 1 for n in value):
            raise ValueError("fanout needs at least one level, each >= 1")
        return value


class Market(BaseModel):
    """How a parent splits its budget among its children (spec §7.2). ``proportional`` is the
    default: no epochs run and money flows as before. ``auction`` runs the epoch auction."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["proportional", "auction"] = "proportional"
    epoch_interval_s: float = Field(default=15.0, gt=0)
    epoch_max_completions: int = Field(default=10, ge=1)
    floor_usd: float = Field(default=0.05, gt=0)  # what a squad may always commit
    # The global spend breaker (spec §8): burn above 20% of the remaining budget per minute
    # pauses new contracts for 30 s. It needs the economy's view, so it turns the epochs on.
    breaker: bool = False


class TaskInputs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fixture: str | None = None  # a directory with corpus.json and truth.json
    generate_seed: int | None = None  # generate the fixture if the directory is missing
    poison: int = Field(default=0, ge=0)  # poisoned speaker emails (spec §13 attack demo)
    poison_wording: str = "polite"  # a generator POISON_WORDINGS key, or several with commas
    # T3 (web report). The run records them in its corpus, not in the spec, so the recorded
    # params of a T2 run stay as they were. ``fixture`` is then the canned web of a $0 run.
    subjects: list[str] = Field(default_factory=list, exclude=True)  # what the report compares
    criteria: dict[str, str] = Field(default_factory=dict, exclude=True)  # id -> question
    sources: list[str] = Field(default_factory=list, exclude=True)  # URLs the task provides


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: str = Field(min_length=1)
    task: str = "t2_conference"
    inputs: TaskInputs = Field(default_factory=TaskInputs)
    seed: str = "1"
    budget_usd: float | None = Field(default=None, gt=0)
    scaling: Scaling = Field(default_factory=Scaling)
    market: Market = Field(default_factory=Market)
    max_steps: int = Field(default=8, ge=1)
    max_attempts: int = Field(default=6, ge=1)
    contributor_opt_in: bool = False
    auto_approve: bool = True  # bench mode; the plan-approval UI comes later
    channel_breakers: bool = False  # per-pair and per-topic bus breakers (spec §8); opt-in
    cross_audit: bool = False  # a sibling audits sampled contracts (spec §11.3)
    feasibility_report: bool = False  # emit the feasibility report at plan approval (§12)
    # Wonder rules a semantic dispute between two contracts' facts at the lowest common ancestor
    # (actors/arbitration.py). Left out of the recorded spec, which a default run keeps as it was;
    # a run that asks for it records ``params["arbitration"]`` instead (run_params).
    arbitration: bool = Field(default=False, exclude=True)

    @classmethod
    def load(cls, path: Path) -> "TaskSpec":
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        spec = cls.model_validate(data)
        defaults = _defaults()
        if "max_steps" not in data:
            spec.max_steps = int(defaults["contracts"]["max_steps"])
        if "scaling" not in data:
            exact = defaults["scaling"]["exact"]
            spec.scaling = Scaling(
                mode=defaults["scaling"]["mode"],
                fanout=list(exact["fanout"]),
                agents_per_leaf=int(exact["agents_per_leaf"]),
                **defaults["scaling"]["autoscale"],
            )
        if "market" not in data:
            spec.market = Market(
                **{
                    key: value
                    for key, value in defaults["market"].items()
                    if key in Market.model_fields
                }
            )
        if spec.budget_usd is None:
            spec.budget_usd = float(defaults["budget"]["run_cap_usd"])
        if spec.inputs.fixture is not None:
            spec.inputs.fixture = str(resolve_path(spec.inputs.fixture, path.parent))
        return spec


def resolve_path(value: str, base: Path) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    for root in (base, REPO_ROOT, Path.cwd()):
        if (root / path).exists():
            return (root / path).resolve()
    return (REPO_ROOT / path).resolve()


def run_params(spec: TaskSpec) -> dict[str, Any]:
    """The swarm scenario's params: the spec plus the task's corpus and ground truth.

    They are recorded in ``run.started``, so a run replays without the fixture files.
    """
    if spec.task == "t3_report":
        from fractalswarm.bench.tasks.t3_report.web import corpus

        recorded = spec.model_dump(mode="json")
        if spec.inputs.fixture and Path(spec.inputs.fixture).resolve().is_relative_to(REPO_ROOT):
            fixture = Path(spec.inputs.fixture).resolve().relative_to(REPO_ROOT)
            recorded["inputs"]["fixture"] = fixture.as_posix()  # no machine-specific paths
        return _with_economy(spec, {"spec": recorded, "corpus": corpus(spec), "truth": {}})
    if spec.task not in ("t2_conference", "t1_extraction"):
        raise ValueError(
            f"task {spec.task!r} is not implemented yet (t2_conference, t1_extraction, t3_report)"
        )
    if spec.inputs.fixture is None:
        raise ValueError("the TaskSpec needs inputs.fixture (a fixture directory)")
    fixture = Path(spec.inputs.fixture)
    if spec.task == "t1_extraction":
        corpus, truth, fixture = _t1_fixture(spec, fixture)
    else:
        from fractalswarm.bench.tasks.t2_conference.generator import load_fixture, write_fixture

        if not (fixture / "corpus.json").exists():
            if spec.inputs.generate_seed is None:
                raise FileNotFoundError(f"no T2 fixture in {fixture}")
            inputs = spec.inputs
            fixture = write_fixture(
                fixture.parent, spec.inputs.generate_seed, inputs.poison, inputs.poison_wording
            )
        corpus, truth = load_fixture(fixture)
    recorded = spec.model_dump(mode="json")
    if fixture.resolve().is_relative_to(REPO_ROOT):  # no machine-specific paths in the log
        recorded["inputs"]["fixture"] = fixture.resolve().relative_to(REPO_ROOT).as_posix()
    return _with_economy(spec, {"spec": recorded, "corpus": corpus, "truth": truth})


def _with_economy(spec: TaskSpec, params: dict[str, Any]) -> dict[str, Any]:
    """Leave the economy's defaults out of the recorded spec, so a default run's log stays as
    it was, and add the economy's resolved numbers (and the arbitration flag) when they are on."""
    recorded = params["spec"]
    if spec.market == Market():  # opt-in settings stay out of a default run's log
        del recorded["market"]
    if spec.scaling.mode == "exact":
        for key in AUTOSCALE_KEYS:
            del recorded["scaling"][key]
    economy = market_params(spec)
    if economy is not None:
        params["market"] = economy
    if spec.arbitration:  # opt-in: a run that never asked for it records nothing new
        params["arbitration"] = True
    return params


def _t1_fixture(spec: TaskSpec, fixture: Path) -> tuple[dict[str, Any], dict[str, Any], Path]:
    """T1's corpus and truth. The tree's shape (groups x batches) is the TaskSpec's fanout."""
    from fractalswarm.bench.tasks.t1_extraction.generator import load_fixture, write_fixture

    if len(spec.scaling.fanout) != 2:
        raise ValueError("T1 runs at depth 2: fanout [groups, batches]")
    if not (fixture / "docs.json").exists():
        if spec.inputs.generate_seed is None:
            raise FileNotFoundError(f"no T1 fixture in {fixture}")
        fixture = write_fixture(fixture.parent, spec.inputs.generate_seed)
    corpus, truth = load_fixture(fixture)
    groups, batches = spec.scaling.fanout
    return corpus | {"groups": groups, "batches": batches}, truth, fixture


def market_params(spec: TaskSpec) -> dict[str, Any] | None:
    """The economy's settings with every number resolved, or ``None`` when it is off.

    The epoch machinery runs for ``market.mode: auction``, for autoscale (which needs the $ and
    rate-limit allocations) and for the global spend breaker (which needs the view). The
    numbers are recorded in the run's params, so replay never reads a config file.
    """
    if (
        spec.market.mode != "auction"
        and spec.scaling.mode != "autoscale"
        and not spec.market.breaker
    ):
        return None
    economy = _defaults()["market"]
    limits = yaml.safe_load((CONFIG_DIR / "prices.yaml").read_text(encoding="utf-8"))["rate_limits"]
    return {
        "mode": spec.market.mode,
        "epoch_interval_ms": round(spec.market.epoch_interval_s * 1000),
        "epoch_max_completions": spec.market.epoch_max_completions,
        "floor_usd": spec.market.floor_usd,
        "plan_usd": economy["plan_usd"],
        "contract_usd": economy["contract_usd"],
        "contracts_per_leaf": economy["contracts_per_leaf"],
        "rpm_per_agent": economy["rpm_per_agent"],
        "tpm_per_agent": economy["tpm_per_agent"],
        "fanout": list(spec.scaling.fanout),
        "leaf_level": spec.scaling.max_depth
        if spec.scaling.mode == "autoscale"
        else len(spec.scaling.fanout),
        "ladder": _defaults()["budget"]["ladder"],
        "breaker": SpendBreakerConfig.load().model_dump() if spec.market.breaker else None,
        "limits": {
            model: {"limit_rpm": found["rpm"], "limit_tpm": found["tpm"]}
            for model, found in sorted(limits.items())
        },
    }
