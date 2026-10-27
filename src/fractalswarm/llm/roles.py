"""Role -> (model, effort, max_output_tokens) at each budget level (``config/roles.yaml``)."""

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel

from fractalswarm.config import CONFIG_DIR

Effort = Literal["minimal", "low", "medium", "high", "xhigh", "max"]
CONTRIBUTOR_SUFFIX = "-contributor"


class RoleSpec(BaseModel):
    model: str
    effort: Effort
    max_output_tokens: int
    contributor_ok: bool = False


class RoleTable(BaseModel):
    roles: dict[str, dict[str, RoleSpec]]

    @classmethod
    def load(cls, path: Path = CONFIG_DIR / "roles.yaml") -> "RoleTable":
        return cls.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RoleTable":
        return cls.model_validate(data)

    def resolve(self, role: str, level: str = "L0") -> RoleSpec:
        try:
            return self.roles[role][level]
        except KeyError:
            raise ValueError(f"no role {role!r} at level {level!r}") from None
