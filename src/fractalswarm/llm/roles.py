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

    def contributor_mode(self, wonder_to_spark: bool = False) -> "RoleTable":
        """The bench's Contributor mode (spec §7.5, §15.6): every Spark call may go to the
        Contributor variant (the scanners still gate each call). Wonder has no Contributor
        variant on pay-as-you-go, so its roles stay on Standard Wonder unless
        ``wonder_to_spark`` moves them to Spark at the same effort."""
        roles: dict[str, dict[str, RoleSpec]] = {}
        for role, levels in self.roles.items():
            roles[role] = {}
            for level, spec in levels.items():
                if wonder_to_spark and spec.model.startswith("muse-wonder"):
                    spec = spec.model_copy(update={"model": "muse-spark-1.3"})
                if spec.model.startswith("muse-spark"):
                    spec = spec.model_copy(update={"contributor_ok": True})
                roles[role][level] = spec
        return RoleTable(roles=roles)

    def resolve(self, role: str, level: str = "L0") -> RoleSpec:
        try:
            return self.roles[role][level]
        except KeyError:
            raise ValueError(f"no role {role!r} at level {level!r}") from None
