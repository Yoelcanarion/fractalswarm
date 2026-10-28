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
    write_instance,
)
from fractalswarm.bench.tasks.t1_extraction.scorer import T1Score, normalize, score
from fractalswarm.kernel.events import Event

__all__ = [
    "FIELDS",
    "Document",
    "T1Instance",
    "T1Score",
    "check_formats",
    "make_checker",
    "generate",
    "normalize",
    "score",
    "write_instance",
]

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
) -> Checker:
    """A bench checker: ``extract`` finds the run's final predictions in its log (None if
    the run produced none). Completed = predictions exist; valid = every value well-formed;
    score = field-level F1."""

    def check(events: Sequence[Event]) -> Outcome:
        predictions = extract(events)
        if predictions is None:
            return Outcome(completed=False, valid=False, score=0.0, detail="no predictions")
        result = score(predictions, truth)
        bad = check_formats(predictions)
        detail = f"F1 {result.f1:.3f} (tp {result.tp}, fp {result.fp}, fn {result.fn})"
        if bad:
            detail += f"; malformed: {', '.join(bad[:5])}"
        return Outcome(completed=True, valid=not bad, score=result.f1, detail=detail)

    return check
