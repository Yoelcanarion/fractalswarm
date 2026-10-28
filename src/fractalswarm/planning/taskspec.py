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


def _defaults() -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / "defaults.yaml").read_text(encoding="utf-8"))


class Scaling(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["exact", "autoscale"] = "exact"
    fanout: list[int] = Field(default_factory=lambda: [3, 2])
    agents_per_leaf: int = Field(default=2, ge=1)

    @field_validator("fanout")
    @classmethod
    def _positive(cls, value: list[int]) -> list[int]:
        if not value or any(n < 1 for n in value):
            raise ValueError("fanout needs at least one level, each >= 1")
        return value


class TaskInputs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fixture: str | None = None  # a directory with corpus.json and truth.json
    generate_seed: int | None = None  # generate the fixture if the directory is missing


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: str = Field(min_length=1)
    task: str = "t2_conference"
    inputs: TaskInputs = Field(default_factory=TaskInputs)
    seed: str = "1"
    budget_usd: float | None = Field(default=None, gt=0)
    scaling: Scaling = Field(default_factory=Scaling)
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
        fixture = write_fixture(fixture.parent, spec.inputs.generate_seed)
    corpus, truth = load_fixture(fixture)
    recorded = spec.model_dump(mode="json")
    if fixture.resolve().is_relative_to(REPO_ROOT):  # no machine-specific paths in the log
        recorded["inputs"]["fixture"] = fixture.resolve().relative_to(REPO_ROOT).as_posix()
    return {"spec": recorded, "corpus": corpus, "truth": truth}
