"""T2's side of arbitration (``actors/arbitration.py``): what a dispute is about, what decides it,
and what the work does with the ruling.

A speaker's availability is read from the speaker's email, and a speaker with talks in two
sessions is read by both. When the two readings differ, the facts the sessions' contracts
publish, ``speaker:<id>:availability``, are in dispute, and the email decides.

- ``fact_keys`` names the facts a contract reads: the speakers' availability for a ``place``.
- ``evidence`` gathers what the arbiter may weigh: the speaker's email, from the LCA goal's own
  data (the track's emails, or the whole corpus at the root).
- ``overlay`` lays the ruled values over the extraction a ``place`` contract was given.
- ``arbiter`` and ``with_dispute`` are the fake LLM's part: the arbiter re-reads the email the
  way the fake extractor does, and a script variant makes one session misread a speaker, so a
  $0 run has a dispute to settle. Neither ever reads the ground truth.
"""

import json
from collections.abc import Callable
from typing import Any

from fractalswarm.bench.tasks.t2_conference import fake, task
from fractalswarm.kernel.ids import canonical_json
from fractalswarm.llm.fake import FakeReply
from fractalswarm.planning.planner import read_blocks

NAME = task.NAME
SCHEMA = "arbitration_ruling"  # the structured output name of actors.arbitration.SCHEMA
PUBLISH = "memory.publish_fact"

NOTE = """The fact is a speaker's availability, as the speaker wrote it in an email. "available"
lists, per conference day, the slot numbers (the "index" of the slots in the context) at which
the speaker can present, and "preference" is morning, afternoon or none. Morning means a slot
that starts before 12:30, afternoon one that starts at 14:00 or later, and "any time" every slot
of every day. Read the email, then choose the candidate that matches what it says. The evidence
ids are the ids of the emails you relied on."""


def availability_key(speaker: str) -> str:
    return f"speaker:{speaker}:availability"


def fact_keys(kind: str, inputs: dict[str, Any]) -> list[str]:
    """The facts a contract's input is made of: a ``place`` reads each speaker's availability
    from the extraction it depends on."""
    if kind != "place":
        return []
    constraints = (inputs.get("data") or {}).get("constraints") or {}
    return [availability_key(row["speaker_id"]) for row in constraints.get("speakers", [])]


def overlay(inputs: dict[str, Any], ruled: dict[str, Any]) -> dict[str, Any]:
    """The inputs of a ``place`` with the ruled values in place of the extraction's own."""
    data = inputs["data"]
    constraints = data["constraints"]
    speakers = [
        {"speaker_id": row["speaker_id"]} | ruled[availability_key(row["speaker_id"])]
        if availability_key(row["speaker_id"]) in ruled
        else row
        for row in constraints["speakers"]
    ]
    return inputs | {"data": data | {"constraints": constraints | {"speakers": speakers}}}


def evidence(
    goal: dict[str, Any], dispute: Any
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """(context, untrusted evidence, evidence ids) for a dispute, from the LCA goal's data: the
    emails of the disputed speaker, and any email the candidates cite as their source."""
    corpus = goal.get("corpus") or goal.get("data") or {}
    cited = {
        source
        for candidate in dispute.candidates
        for supporter in candidate["by"]
        for source in supporter["sources"]
    }
    emails = [
        email
        for email in corpus.get("emails", [])
        if email["speaker_id"] == dispute.subject or email["id"] in cited
    ]
    context = {"days": corpus.get("days", []), "slots": corpus.get("slots", [])}
    return context, {"emails": emails}, [email["id"] for email in emails]


# -- the fake LLM -------------------------------------------------------------------------


def arbiter(body: dict[str, Any]) -> str:
    """The fake arbiter: it reads the speaker's email the way the fake extractor does and picks
    the candidate that says the same, confidently; with none, the first, doubtfully."""
    blocks = read_blocks(fake._prompt(body))
    context, dispute = blocks["context"], blocks["dispute"]
    candidates: dict[str, Any] = blocks["candidates"]
    email = next(
        (e for e in blocks.get("emails", []) if e["speaker_id"] == dispute["subject"]), None
    )
    if email is not None:
        days, slots = context["days"], context["slots"]
        available, preference = fake.parse_email(email["body"], days, slots)
        reading = {
            "available": [{"day": d, "slots": available[d]} for d in days if available[d]],
            "preference": preference,
        }
        for label in sorted(candidates):
            if canonical_json(candidates[label]) == canonical_json(reading):
                reason = f"the email {email['id']} gives exactly this availability and preference"
                return fake._answer(
                    {
                        "winner": label,
                        "reason": reason,
                        "confidence": 0.92,
                        "evidence": [email["id"]],
                    }
                )
    reason = "no candidate matches what the email says"
    found = [] if email is None else [email["id"]]
    first = sorted(candidates)[0]
    return fake._answer({"winner": first, "reason": reason, "confidence": 0.4, "evidence": found})


def misread(value: dict[str, Any], slots: list[dict[str, Any]]) -> dict[str, Any]:
    """A plausible wrong reading of an availability: a slot the speaker did not offer on their
    first day (or, with every slot offered, one fewer)."""
    days = [dict(day, slots=list(day["slots"])) for day in value["available"]]
    if days:
        offered = {slot["index"] for slot in slots}
        missing = sorted(offered - set(days[0]["slots"]))
        if missing:
            days[0]["slots"] = sorted([*days[0]["slots"], missing[0]])
        else:
            days[0]["slots"] = days[0]["slots"][:-1]
    return value | {"available": days}


def with_dispute(script: Callable[..., Any], speaker: str, session: str) -> Callable[..., Any]:
    """The fake LLM, except that ``session``'s extraction misreads ``speaker``'s email, in the
    fact it publishes and in the answer it gives. Any other session reads it right."""

    def forced(body: dict[str, Any], attempt: int):
        reply = script(body, attempt)
        name = ((body.get("text") or {}).get("format") or {}).get("name", "")
        if name != "t2_extract":
            return reply
        blocks = read_blocks(fake._prompt(body))
        if blocks["session"]["id"] != session or speaker not in blocks["speaker_ids"]:
            return reply
        slots = blocks["slots"]
        if isinstance(reply, FakeReply):
            calls = [_misread_call(call, speaker, slots) for call in reply.tool_calls]
            return reply.model_copy(update={"tool_calls": calls})
        answer = json.loads(reply)
        if "speakers" not in answer:
            return reply
        answer["speakers"] = [
            {"speaker_id": speaker} | misread(row, slots) if row["speaker_id"] == speaker else row
            for row in answer["speakers"]
        ]
        return fake._answer(answer)

    return forced


def _misread_call(call: dict[str, str], speaker: str, slots: list[dict[str, Any]]):
    arguments = json.loads(call["arguments"])
    if call["name"] != PUBLISH or arguments["key"] != availability_key(speaker):
        return call
    value = misread(json.loads(arguments["value_json"]), slots)
    return call | {"arguments": json.dumps(arguments | {"value_json": canonical_json(value)})}


# The fake T2 model answers by structured-output name; this registers the arbiter's.
fake.HANDLERS[SCHEMA] = arbiter
