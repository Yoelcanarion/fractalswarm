"""Event types of the intake scenario. Importing this module registers them."""

from typing import Any

from fractalswarm.kernel.events import Payload, register


@register("intake.proposed")
class IntakeProposed(Payload):
    """The pasted text, read and shaped into a program input for a person to review."""

    proposal: dict[str, Any]
    input_sha256: str  # of the pasted segments: the proposal belongs to this text


@register("intake.refused")
class IntakeRefused(Payload):
    """The firewall blocked a pasted segment, so no model read it."""

    segments: list[str]
    reason: str


@register("intake.failed")
class IntakeFailed(Payload):
    """The model's answer could not be used (no reply, or not the schema)."""

    errors: list[str]
