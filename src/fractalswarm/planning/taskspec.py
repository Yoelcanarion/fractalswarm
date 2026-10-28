"""TaskSpec: the user's input as YAML (spec §2, §4). Only ``goal`` is required.

Missing fields take defaults from ``config/defaults.yaml``. Relative fixture paths resolve
against the YAML file's directory first, then the repo root.
"""

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from fractalswarm.config import CONFIG_DIR

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
    floor_usd: float = Field(default=0.08, gt=0)  # what a squad may always commit


class TaskInputs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fixture: str | None = None  # a directory with corpus.json and truth.json
    generate_seed: int | None = None  # generate the fixture if the directory is missing
    poison: int = Field(default=0, ge=0)  # poisoned speaker emails (spec §13 attack demo)
    poison_wording: str = "polite"  # a generator POISON_WORDINGS key, or several with commas


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
    from fractalswarm.bench.tasks.t2_conference.generator import load_fixture, write_fixture

    if spec.task != "t2_conference":
        raise ValueError(f"task {spec.task!r} is not implemented yet (only t2_conference)")
    if spec.inputs.fixture is None:
        raise ValueError("the TaskSpec needs inputs.fixture (a T2 fixture directory)")
    fixture = Path(spec.inputs.fixture)
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
    if spec.market == Market():  # opt-in settings stay out of a default run's log
        del recorded["market"]
    if spec.scaling.mode == "exact":
        for key in AUTOSCALE_KEYS:
            del recorded["scaling"][key]
    params: dict[str, Any] = {"spec": recorded, "corpus": corpus, "truth": truth}
    economy = market_params(spec)
    if economy is not None:
        params["market"] = economy
    return params


def market_params(spec: TaskSpec) -> dict[str, Any] | None:
    """The economy's settings with every number resolved, or ``None`` when it is off.

    The epoch machinery runs for ``market.mode: auction`` and for autoscale (which needs the
    $ and rate-limit allocations). The numbers are recorded in the run's params, so replay
    never reads a config file.
    """
    if spec.market.mode != "auction" and spec.scaling.mode != "autoscale":
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
        "limits": {
            model: {"limit_rpm": found["rpm"], "limit_tpm": found["tpm"]}
            for model, found in sorted(limits.items())
        },
    }
