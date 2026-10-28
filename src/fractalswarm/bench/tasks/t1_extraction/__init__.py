"""T1, multi-doc extraction: seeded generator, F1 scorer and the bench checker factory."""

import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from fractalswarm.bench.scoring import Checker, Outcome
from fractalswarm.bench.tasks.t1_extraction.generator import (
    FIELDS,
    Document,
    T1Instance,
    generate,
    load_fixture,
    write_fixture,
    write_instance,
)
from fractalswarm.bench.tasks.t1_extraction.scorer import T1Score, normalize, score
from fractalswarm.kernel.events import Event

__all__ = [
    "FIELDS",
    "MIN_F1",
    "Document",
    "T1Instance",
    "T1Score",
    "check_formats",
    "load_fixture",
    "make_checker",
    "generate",
    "normalize",
    "score",
    "write_fixture",
    "write_instance",
]

# A run is valid at F1 >= 0.9: up to 8 of the 80 slots may be wrong (a few misread
# distractors), but not the rule itself (taking the oldest document scores 0.65-0.83) nor
# two lost companies (0.889). A single lost company still scores 0.947, so validity also
# asks that every slot has a value.
MIN_F1 = 0.9

_FORMATS = {
    "founded_year": re.compile(r"^(19|20)\d\d$"),
    "employees": re.compile(r"^\d+$"),
    "revenue_musd": re.compile(r"^\d+(\.\d+)?$"),
    "ticker": re.compile(r"^[a-z]{2,5}$"),  # normalized (casefolded)
}


def check_formats(predictions: Mapping[str, Mapping[str, Any]]) -> list[str]:
    """Deterministic field-format check (spec §11): the slots whose value is malformed."""
    bad = []
    for company, fields in sorted(predictions.items()):
        for field, value in sorted((fields or {}).items()):
            pattern = _FORMATS.get(field)
            if pattern is not None and not pattern.match(normalize(value)):
                bad.append(f"{company}.{field}")
    return bad


def make_checker(
    truth: Mapping[str, Mapping[str, Any]],
    extract: Callable[[Sequence[Event]], Mapping[str, Mapping[str, Any]] | None],
    min_f1: float = MIN_F1,
) -> Checker:
    """A bench checker: ``extract`` finds the run's final predictions in its log (None if
    the run produced none). Completed = predictions exist; valid = every value well-formed,
    every slot filled and F1 >= ``min_f1``; score = field-level F1."""

    def check(events: Sequence[Event]) -> Outcome:
        predictions = extract(events)
        if predictions is None:
            return Outcome(completed=False, valid=False, score=0.0, detail="no predictions")
        result = score(predictions, truth)
        bad = check_formats(predictions)
        detail = f"F1 {result.f1:.3f} (tp {result.tp}, fp {result.fp}, fn {result.fn})"
        if result.missing:
            detail += f"; {result.missing} slots empty"
        if bad:
            detail += f"; malformed: {', '.join(bad[:5])}"
        valid = not bad and not result.missing and round(result.f1, 6) >= min_f1
        return Outcome(completed=True, valid=valid, score=result.f1, detail=detail)

    return check
