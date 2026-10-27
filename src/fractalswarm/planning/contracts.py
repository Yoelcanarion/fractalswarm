"""Contracts: units of work with acceptance criteria (spec §10)."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from fractalswarm.kernel.ids import stable_id


class Produce(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    schema_name: str  # the structured-output schema the final answer must match


class Acceptance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checks: list[str] = []  # deterministic checks (verify/checks.py)
    rubric: list[str] = []  # for the judge


class ContractBudget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    usd: float = 0.25
    max_steps: int = 8
    max_output_tokens: int | None = None


class Deadline(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vticks: int = 600_000  # virtual ms
    wall_s: float = 600.0


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    goal_id: str
    kind: str  # what the task does with it (t2: extract | place | blurb)
    owner: str
    assignee: str | None = None
    attempt: int = 0
    role: str = "agent"
    objective: str
    inputs: dict[str, Any] = {}  # resolved inputs: data, dependency outputs, feedback
    depends_on: list[str] = []
    reads: list[str] = []
    writes: list[str] = []
    produces: list[Produce] = []
    constraints: list[str] = []
    acceptance: Acceptance = Field(default_factory=Acceptance)
    tools: list[str] = []
    budget: ContractBudget = Field(default_factory=ContractBudget)
    model_role: str = "agent"
    priority: int = 0
    risk: float = Field(default=0.3, ge=0, le=1)
    critical_path: bool = False
    deadline: Deadline = Field(default_factory=Deadline)
    scope_token: str = ""
    feedback: list[str] = []

    @property
    def idem_key(self) -> str:
        """Same contract and attempt -> same key, whoever runs it (orphans publish under it)."""
        return stable_id("c", self.goal_id, self.id, self.attempt)


class ContractResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_id: str
    goal_id: str
    attempt: int
    agent: str
    status: Literal["ok", "error"]
    output: dict[str, Any] = {}
    error: str = ""
    published: list[str] = []  # fact keys
    steps: int = 0
    idem_key: str = ""
