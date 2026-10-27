"""T1 multi-doc extraction: seeded generator and field-level F1 scorer (spec §15.3)."""

from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.bench.tasks.t1_extraction import (
    FIELDS,
    check_formats,
    generate,
    make_checker,
    normalize,
    score,
    write_instance,
)


def newest_wins(instance, *, newest: bool = True) -> dict[str, dict[str, str]]:
    """What a perfect reader of the docs would extract, under a given conflict rule."""
    dates = {doc.id: doc.date for doc in instance.docs}
    picked: dict[str, dict[str, tuple[str, str]]] = {}
    for doc_id, (company, facts) in instance.doc_facts.items():
        for field, value in facts.items():
            old = picked.setdefault(company, {}).get(field)
            if old is None or (dates[doc_id] > old[0]) == newest:
                picked[company][field] = (dates[doc_id], value)
    return {c: {f: v for f, (_, v) in fields.items()} for c, fields in picked.items()}


def test_shape() -> None:
    instance = generate(0)
    assert len(instance.docs) == 40
    assert len(instance.companies) == 10
    assert len({doc.id for doc in instance.docs}) == 40
    assert set(instance.truth) == set(instance.companies)
    for fields in instance.truth.values():
        assert set(fields) == set(FIELDS)


def test_same_seed_same_bytes_other_seed_other_bytes() -> None:
    assert generate(7).model_dump_json() == generate(7).model_dump_json()
    assert generate(7).model_dump_json() != generate(8).model_dump_json()


@pytest.mark.parametrize("seed", range(5))
def test_truth_is_the_newest_doc_and_contradictions_exist(seed: int) -> None:
    instance = generate(seed)
    assert newest_wins(instance) == instance.truth
    oldest = newest_wins(instance, newest=False)
    assert oldest != instance.truth  # some field changed over time: the rule matters
    assert score(oldest, instance.truth).f1 < 1.0


@pytest.mark.parametrize("seed", range(3))
def test_every_stated_fact_is_in_its_document_text(seed: int) -> None:
    instance = generate(seed)
    texts = {doc.id: doc.text for doc in instance.docs}
    for doc_id, (company, facts) in instance.doc_facts.items():
        assert company in texts[doc_id]
        for field, value in facts.items():
            shown = f"{int(value):,}" if field == "employees" else value
            assert shown in texts[doc_id], (doc_id, field, value)


def test_distractors_mention_rivals() -> None:
    instance = generate(1)
    rivals = 0
    for doc in instance.docs:
        company = instance.doc_facts[doc.id][0]
        others = [c for c in instance.companies if c != company and c in doc.text]
        rivals += bool(others)
    assert rivals >= 20


def test_scores() -> None:
    instance = generate(3)
    assert score(instance.truth, instance.truth).f1 == 1.0
    empty = score({}, instance.truth)
    assert (empty.f1, empty.tp, empty.fn) == (0.0, 0, 80)
    company = instance.companies[0]
    one_wrong = {c: dict(f) for c, f in instance.truth.items()}
    one_wrong[company]["ceo"] = "Nobody Atall"
    result = score(one_wrong, instance.truth)
    assert (result.tp, result.fp, result.fn) == (79, 1, 1)
    extra = {c: dict(f) for c, f in instance.truth.items()} | {"Ghost Corp": {"ceo": "X"}}
    assert score(extra, instance.truth).fp == 1


def test_normalization() -> None:
    assert normalize("  $1,250 million ") == "1250"
    assert normalize("12,000") == normalize(12000) == "12000"
    assert normalize("Lisbon ") == normalize("lisbon")
    assert normalize("Atlas  3") == "atlas 3"
    truth = {"Acme Labs": {"employees": "12000", "revenue_musd": "80"}}
    prediction = {"acme labs": {"employees": "12,000", "revenue_musd": "$80 million"}}
    assert score(prediction, truth).f1 == 1.0


values = st.text(alphabet="abcdefgh 0123456789", min_size=1, max_size=8).filter(str.strip)
tables = st.dictionaries(
    st.sampled_from(["A", "B", "C"]),
    st.dictionaries(st.sampled_from(FIELDS), values, min_size=1),
    min_size=1,
)


@given(tables, tables)
def test_score_bounds(prediction, truth) -> None:
    result = score(prediction, truth)
    for value in (result.precision, result.recall, result.f1):
        assert 0.0 <= value <= 1.0
    assert result.tp + result.fn == sum(len(fields) for fields in truth.values())


@given(tables)
def test_perfect_prediction_scores_one(truth) -> None:
    assert score(truth, truth).f1 == 1.0


def test_checker_and_formats() -> None:
    instance = generate(2)
    checker = make_checker(instance.truth, lambda events: instance.truth)
    outcome = checker([])
    assert (outcome.completed, outcome.valid, outcome.score) == (True, True, 1.0)
    missing = make_checker(instance.truth, lambda events: None)([])
    assert (missing.completed, missing.valid) == (False, False)
    bad = {"Acme": {"founded_year": "last year", "ticker": "AC-1", "employees": "1,200"}}
    assert check_formats(bad) == ["Acme.founded_year", "Acme.ticker"]


def test_write_instance_keeps_the_truth_out_of_the_docs(tmp_path: Path) -> None:
    instance = generate(4)
    docs, truth = write_instance(instance, tmp_path)
    visible = docs.read_text(encoding="utf-8")
    assert "doc_facts" not in visible and "truth" not in visible
    assert '"doc-01"' in visible
    assert truth.exists()
