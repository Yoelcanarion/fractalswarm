"""What the model returns for the pasted text (``t2_intake``), and the request that asks.

The model reads two untrusted texts, the talks and the notes (emails from the speakers), and
reports what they say: tracks, talks, speakers, and a ``reference`` of the constraints the text
states (availability, time preferences, expected attendance), each with the sentence it came
from, copied word for word, so a person can check it. ``shape.py`` fits the answer to the
shape T2 runs on.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from fractalswarm.planning.planner import plan_request
from fractalswarm.planning.schemas import register_output

SCHEMA_NAME = "t2_intake"
ROLE = "intake"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TalkRead(Strict):
    title: str
    speaker: str = Field(description="the speaker's name as written")
    track: str = Field(description="the name of one of the tracks")
    abstract: str = Field(description="the abstract, word for word; empty when there is none")
    track_source: str = Field(
        description="the sentence that shows the track, word for word; empty when you inferred it"
    )


class SpeakerRead(Strict):
    name: str
    email: str = Field(description="the address as written; empty when there is none")
    note: str = Field(
        description="what this person wrote to the organizers, word for word; empty when nothing"
    )


class DaySlots(Strict):
    day: int
    slots: list[int] = Field(description="indices of the slots (see the grid) free on that day")


class AvailabilityRead(Strict):
    speaker: str
    available: list[DaySlots]
    source: str = Field(description="the sentence that states it, word for word")


class PreferenceRead(Strict):
    speaker: str
    preference: Literal["morning", "afternoon", "none"]
    source: str = Field(description="the sentence that states it, word for word")


class AttendanceRead(Strict):
    talk: str = Field(description="the talk's title")
    attendance: int
    source: str = Field(description="the sentence that states it, word for word")


class RoomRead(Strict):
    name: str
    capacity: int


class ReferenceRead(Strict):
    availability: list[AvailabilityRead]
    preferences: list[PreferenceRead]
    attendance: list[AttendanceRead]


class IntakeOutput(Strict):
    conference: str
    tracks: list[str]
    talks: list[TalkRead]
    speakers: list[SpeakerRead]
    rooms: list[RoomRead]
    reference: ReferenceRead
    warnings: list[str]


register_output(SCHEMA_NAME, IntakeOutput)

INTAKE_INSTRUCTIONS = """You are the intake reader of FractalSwarm. A person pasted the text of a
real conference. Turn it into a structured reading of what the text says, and nothing else.
The untrusted blocks hold their text: `talks` (the submissions), `notes` (emails or notes from
the speakers) and, when given, `conference` (its name). The data block `grid` holds the
program's fixed days and slots; slot indices are the `index` of each slot.

- tracks: the track names the text uses, as written. If it names none, group the talks by
  topic and say so in warnings.
- talks: one entry per talk, in the order of the text: the title and the speaker's name as
  written, the track's name, and the abstract word for word (empty when there is none).
  `track_source` is the sentence that shows the track; empty when you had to infer it.
- speakers: one entry per person who gives a talk: the name, the email address as written
  (empty when none) and their note word for word (empty when they wrote nothing).
- rooms: only if the text lists the rooms and their capacities; otherwise an empty list.
- reference.availability: for each speaker whose text says when they can attend, the days and
  slot indices that are free, and the sentence that says so. Leave out a speaker whose text
  says nothing: never assume. Morning means a slot starting before 12:30; afternoon means one
  starting at 14:00 or later. "Any time" is every slot of every day.
- reference.preferences: morning, afternoon or none, with the sentence. Leave out a speaker
  whose text says nothing.
- reference.attendance: the expected audience of a talk when the text states it, with the
  sentence. Leave out a talk whose text says nothing.
- Every `source` sentence and every `note` or `abstract` must be copied exactly from the text;
  never reword it. Never invent a talk, a speaker or a fact.
- warnings: anything ambiguous, missing or contradictory that a person should check.
Reply with JSON matching the schema."""


def grid(days: list[int], slots: list[dict[str, Any]]) -> dict[str, Any]:
    return {"days": days, "slots": slots}


def intake_request(
    segments: dict[str, str],
    days: list[int],
    slots: list[dict[str, Any]],
    feedback: list[str] | None = None,
):
    """The ``llm`` request: the pasted segments in untrusted blocks, never in the system prompt.
    ``feedback`` is what was wrong with the previous answer."""
    untrusted = {name: text for name, text in sorted(segments.items()) if text}
    return plan_request(
        role=ROLE,
        schema_name=SCHEMA_NAME,
        model=IntakeOutput,
        instructions=INTAKE_INSTRUCTIONS,
        header="CONFERENCE INTAKE",
        data={"grid": grid(days, slots)},
        untrusted=untrusted,
        feedback=feedback,
    )
