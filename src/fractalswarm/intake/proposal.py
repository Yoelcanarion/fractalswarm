"""The proposal as a validated document: what ``POST /api/intake/{id}/approve`` accepts back.

A person edits the proposal row by row in the review table, so the API takes the whole edited
document and checks its types here before ``shape.normalize`` fits it to the program. Unknown
fields are an error, so a typo in a client is loud.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Row(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RoomRow(Row):
    id: str = ""
    name: str
    capacity: int


class TrackRow(Row):
    id: str
    name: str
    description: str = ""


class SlotRow(Row):
    index: int
    start: str
    end: str


class SpeakerRow(Row):
    id: str
    name: str
    email: str = ""
    note: str = ""
    available: list[tuple[int, int]] | None = None  # [day, slot] cells; None: not stated
    availability_source: str = ""
    preference: Literal["morning", "afternoon"] | None = None
    preference_source: str = ""


class TalkRow(Row):
    id: str
    title: str
    speaker_id: str
    track_id: str
    track_label: str = ""
    abstract: str = ""
    track_source: str = ""
    attendance: int | None = Field(default=None, ge=0)  # None: not stated
    attendance_source: str = ""


class Proposal(Row):
    conference: str = ""
    days: list[int] = Field(default_factory=list)
    slots: list[SlotRow] = Field(default_factory=list)
    rooms: list[RoomRow] = Field(default_factory=list)
    tracks: list[TrackRow]
    speakers: list[SpeakerRow]
    talks: list[TalkRow]
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


def parse(data: dict[str, Any]) -> dict[str, Any]:
    """The proposal as a plain dict, or ``ValidationError`` for a malformed one."""
    return Proposal.model_validate(data).model_dump(mode="json")
