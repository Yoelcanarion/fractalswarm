"""T1 scorer: field-level precision, recall and F1 against the ground truth (spec §15.3).

A prediction is a ``company -> field -> value`` mapping. Each (company, field) the truth
defines is one slot. A predicted slot with the right value is a true positive; with a wrong
value it is both a false positive and a false negative; a missing slot is a false negative;
a slot the truth does not define (unknown company or field) is a false positive. Values are
compared after normalization: case, surrounding space, thousands separators, a leading ``$``
and a trailing "million" do not matter, and numbers compare as numbers.
"""

import re
from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")


class T1Score(BaseModel):
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    f1: float
    missing: int = 0  # slots with no value at all (a subset of fn; the rest are wrong values)


def normalize(value: Any) -> str:
    text = str(value).strip().casefold()
    text = re.sub(r"\s+", " ", text)
    text = text.removeprefix("$").removesuffix(" million").strip()
    compact = text.replace(",", "")
    if _NUMBER.match(compact):
        number = float(compact)
        return str(int(number)) if number.is_integer() else str(number)
    return text


def score(
    predictions: Mapping[str, Mapping[str, Any]], truth: Mapping[str, Mapping[str, Any]]
) -> T1Score:
    tp = fp = fn = missing = 0
    true_slots = {
        (company.casefold(), field): normalize(value)
        for company, fields in truth.items()
        for field, value in fields.items()
    }
    predicted: dict[tuple[str, str], str] = {}
    for company, fields in predictions.items():
        for field, value in (fields or {}).items():
            if value is None or str(value).strip() == "":
                continue
            predicted[(company.strip().casefold(), field)] = normalize(value)
    for slot, value in true_slots.items():
        guess = predicted.get(slot)
        if guess is None:
            fn += 1
            missing += 1
        elif guess == value:
            tp += 1
        else:
            fp += 1
            fn += 1
    fp += sum(1 for slot in predicted if slot not in true_slots)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return T1Score(tp=tp, fp=fp, fn=fn, precision=precision, recall=recall, f1=f1, missing=missing)
