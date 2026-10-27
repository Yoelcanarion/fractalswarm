"""Deny-by-default tool capabilities (spec §10, §13).

A contract lists the tools it may use. Anything not granted is denied, and the denial is an
audit event (``tool.denied``). Tools call ``require`` before they do anything.
"""

from pydantic import BaseModel, ConfigDict

KNOWN_TOOLS = frozenset(
    {
        "memory.search",
        "memory.publish_fact",
        "workspace.read",
        "workspace.write",
        "web_search",
        "fetch",
    }
)


class ToolDeniedError(PermissionError):
    def __init__(self, tool: str, reason: str) -> None:
        super().__init__(f"tool {tool!r} denied: {reason}")
        self.tool = tool
        self.reason = reason


class Capabilities(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    granted: frozenset[str] = frozenset()
    contract: str | None = None

    @classmethod
    def none(cls) -> "Capabilities":
        return cls()

    def allows(self, tool: str) -> bool:
        return tool in self.granted

    def require(self, tool: str) -> None:
        if tool not in KNOWN_TOOLS:
            raise ToolDeniedError(tool, "unknown tool")
        if tool not in self.granted:
            raise ToolDeniedError(tool, "not granted to this contract (deny by default)")

    def denial_payload(self, tool: str, target: str | None = None) -> dict:
        """The payload of a ``tool.denied`` event."""
        reason = "unknown tool" if tool not in KNOWN_TOOLS else "not granted (deny by default)"
        return {"tool": tool, "reason": reason, "contract": self.contract, "target": target}
