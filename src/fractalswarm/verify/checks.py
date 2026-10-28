"""Deterministic checks compiled from a contract's acceptance criteria (spec §11 step 1).

A check name is ``<check>`` or ``<check>:<argument>``. Each check returns a list of
failures in plain English; they go back to the agent as feedback on a retry. Tasks add their
own checks here (T2: the hard-constraint checker, which sees the ground truth).
"""

from collections.abc import Callable
from typing import Any

from pydantic import ValidationError

from fractalswarm.planning.schemas import OUTPUT_MODELS

Check = Callable[[dict[str, Any], str, dict[str, Any]], list[str]]
CHECKS: dict[str, Check] = {}


def register_check(name: str):
    def decorator(fn: Check) -> Check:
        CHECKS[name] = fn
        return fn

    return decorator


def run_checks(names: list[str], output: dict[str, Any], context: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    for spec in names:
        name, _, argument = spec.partition(":")
        check = CHECKS.get(name)
        if check is None:
            failures.append(f"unknown check {spec!r}")
            continue
        failures += check(output, argument, context)
        if failures and name == "schema":
            break  # later checks assume the schema holds
    return failures


@register_check("schema")
def schema_check(output: dict[str, Any], schema: str, context: dict[str, Any]) -> list[str]:
    model = OUTPUT_MODELS.get(schema)
    if model is None:
        return [f"unknown output schema {schema!r}"]
    try:
        model.model_validate(output)
    except ValidationError as exc:
        return [
            f"schema {schema}: {'.'.join(map(str, e['loc'])) or '<root>'}: {e['msg']}"
            for e in exc.errors()[:8]
        ]
    return []


@register_check("nonempty")
def nonempty_check(output: dict[str, Any], field: str, context: dict[str, Any]) -> list[str]:
    value = output.get(field)
    if value is None or (isinstance(value, str | list | dict) and not value):
        return [f"{field} is empty"]
    return []


@register_check("t2.extract_coverage")
def t2_extract_coverage(output: dict[str, Any], _: str, context: dict[str, Any]) -> list[str]:
    failures = []
    speakers = {item["speaker_id"] for item in output["speakers"]}
    talks = {item["talk_id"] for item in output["talks"]}
    missing_speakers = sorted(set(context["speaker_ids"]) - speakers)
    missing_talks = sorted(set(context["talk_ids"]) - talks)
    if missing_speakers:
        failures.append(f"no constraints for speakers {missing_speakers}")
    if missing_talks:
        failures.append(f"no expected attendance for talks {missing_talks}")
    slots = {slot["index"] for slot in context["corpus"]["slots"]}
    days = set(context["corpus"]["days"])
    for item in output["speakers"]:
        for day in item["available"]:
            if day["day"] not in days or not set(day["slots"]) <= slots:
                failures.append(f"{item['speaker_id']}: unknown day or slot in {day}")
    return failures


@register_check("t2.session_hard")
def t2_session_hard(output: dict[str, Any], _: str, context: dict[str, Any]) -> list[str]:
    from fractalswarm.bench.tasks.t2_conference.checker import check

    report = check(
        output["placements"],
        context["corpus"],
        context["truth"],
        talk_ids=context["talk_ids"],
        day=context["day"],
    )
    return [f"{v.kind}: {v.detail} ({', '.join(v.talks)})" for v in report.hard_violations]
