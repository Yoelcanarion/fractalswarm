"""T1, multi-doc extraction (spec §15.3): a seeded generator of synthetic company documents.

An instance has 10 fictional companies and 40 dated documents (4 per company). Each
document states about 5 of the 8 fields of its company in free text, plus distractors: the
same fields of a rival company, and numbers that are not fields at all. Some fields change
over time, so an older document can contradict a newer one; the rule is **newer doc wins**.
The ground truth is, per company and field, the value from the newest document that states
it. Every field of every company is stated at least once.

Everything comes from ``random.Random(f"t1:{seed}")``: the same seed always gives the same
bytes.
"""

import json
import random
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel

FIELDS = (
    "ceo",
    "headquarters",
    "founded_year",
    "employees",
    "revenue_musd",
    "ticker",
    "industry",
    "product",
)
# Fields that may change between documents (the source of cross-doc contradictions).
MUTABLE_FIELDS = ("ceo", "headquarters", "employees", "revenue_musd", "product")

N_COMPANIES = 10
DOCS_PER_COMPANY = 4
FIELDS_PER_DOC = 5

_PREFIXES = (
    "Arbor", "Brightline", "Cobalt", "Driftwood", "Ember", "Fjord", "Granite", "Halcyon",
    "Iris", "Juniper", "Kestrel", "Lumen", "Meridian", "Nimbus", "Orchard", "Pinnacle",
)  # fmt: skip
_SUFFIXES = ("Labs", "Systems", "Works", "Dynamics", "Analytics", "Robotics", "Foods", "Energy")
_FIRST = (
    "Ada", "Bruno", "Chiara", "Dmitri", "Elena", "Farid", "Greta", "Hugo", "Ines", "Jonas",
    "Keiko", "Luis", "Marta", "Nadia", "Omar", "Priya", "Quentin", "Rosa", "Sven", "Tomas",
)  # fmt: skip
_LAST = (
    "Alvarez", "Brandt", "Costa", "Dubois", "Eriksen", "Ferreira", "Goldberg", "Haddad",
    "Ivanova", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Petrov",
)  # fmt: skip
_CITIES = (
    "Lisbon", "Oslo", "Austin", "Lyon", "Osaka", "Toronto", "Valencia", "Leipzig", "Denver",
    "Porto", "Tallinn", "Cork", "Seville", "Utrecht", "Nantes", "Turin",
)  # fmt: skip
_INDUSTRIES = (
    "logistics software", "industrial robotics", "plant-based foods", "battery storage",
    "medical imaging", "precision agriculture", "payments", "satellite data",
)  # fmt: skip
_PRODUCTS = (
    "Atlas", "Beacon", "Cascade", "Delta", "Echo", "Flux", "Glide", "Harbor", "Ion", "Jade",
    "Keystone", "Lattice", "Mosaic", "Nova", "Orbit", "Prism", "Quill", "Relay",
)  # fmt: skip

_TEMPLATES = {
    "ceo": ("{name} is led by chief executive {v}.", "CEO {v} said {name} expects a busy year."),
    "headquarters": (
        "{name} is headquartered in {v}.",
        "From its head office in {v}, {name} serves customers in many countries.",
    ),
    "founded_year": ("{name} was founded in {v}.", "Since its founding in {v}, {name} has grown."),
    "employees": (
        "{name} now employs {v:,} people.",
        "The company's headcount stands at {v:,} employees.",
    ),
    "revenue_musd": (
        "Annual revenue reached ${v} million.",
        "{name} reported revenue of ${v} million for the year.",
    ),
    "ticker": ("{name} trades under the ticker {v}.", "Shares of {name} ({v}) rose this week."),
    "industry": ("{name} works in {v}.", "{name} is a {v} company."),
    "product": ("Its flagship product is {v}.", "{name} sells {v}, its best-known product."),
}
_RIVAL = {
    "ceo": "Its rival {rival}, by contrast, is run by {v}.",
    "headquarters": "Competitor {rival} is based in {v}.",
    "employees": "Rival {rival} has {v:,} staff.",
    "revenue_musd": "{rival} posted ${v} million in revenue.",
    "product": "{rival} competes with its own product, {v}.",
}
_NOISE = (
    "Analysts expect the market to grow by {n}% next year.",
    "The company opened {n} new offices in the region.",
    "About {n} customers attended the annual conference.",
    "The report covers the last {n} months of activity.",
)


class Document(BaseModel):
    id: str
    date: str  # ISO date; a newer document wins over an older one
    title: str
    text: str


class T1Instance(BaseModel):
    seed: str
    fields: list[str]
    companies: list[str]
    docs: list[Document]
    truth: dict[str, dict[str, str]]  # company -> field -> value (the newest doc's)
    # Scorer-side only: doc id -> (company, field -> value the doc states).
    doc_facts: dict[str, tuple[str, dict[str, str]]]


def _value(field: str, rng: random.Random, name: str) -> str | int:
    match field:
        case "ceo":
            return f"{rng.choice(_FIRST)} {rng.choice(_LAST)}"
        case "headquarters":
            return rng.choice(_CITIES)
        case "founded_year":
            return rng.randrange(1975, 2021)
        case "employees":
            return rng.randrange(40, 25_000)
        case "revenue_musd":
            return rng.randrange(3, 4_000)
        case "ticker":
            return (name[:3] + rng.choice("XYZQ")).upper()
        case "industry":
            return rng.choice(_INDUSTRIES)
        case "product":
            return f"{rng.choice(_PRODUCTS)} {rng.randrange(2, 9)}"
    raise ValueError(field)


def generate(seed: int | str = 0) -> T1Instance:
    rng = random.Random(f"t1:{seed}")
    names = [f"{p} {s}" for p in _PREFIXES for s in _SUFFIXES]
    companies = sorted(rng.sample(names, N_COMPANIES))

    # Per company, a timeline of values: each mutable field may change at a later doc.
    docs: list[Document] = []
    facts: list[tuple[str, dict[str, str]]] = []
    truth: dict[str, dict[str, str]] = {}
    start = date(2023, 1, 1)
    for index, name in enumerate(companies):
        base = {field: _value(field, rng, name) for field in FIELDS}
        dates = sorted(
            start + timedelta(days=rng.randrange(0, 900)) for _ in range(DOCS_PER_COMPANY)
        )
        # Distinct dates, so "newer wins" is never a tie.
        dates = [day + timedelta(days=offset) for offset, day in enumerate(dates)]
        # Which fields each doc states: every field at least once across the company's docs.
        mentions = [set(rng.sample(FIELDS, FIELDS_PER_DOC)) for _ in range(DOCS_PER_COMPANY)]
        for field in FIELDS:
            if not any(field in m for m in mentions):
                mentions[rng.randrange(DOCS_PER_COMPANY)].add(field)
        values_at: list[dict[str, str | int]] = []
        current = dict(base)
        for doc_index in range(DOCS_PER_COMPANY):
            if doc_index > 0:
                for field in MUTABLE_FIELDS:
                    if rng.random() < 0.3:
                        current[field] = _new_value(field, current[field], rng, name)
            values_at.append(dict(current))
        latest: dict[str, str] = {}
        for doc_index in range(DOCS_PER_COMPANY):
            for field in mentions[doc_index]:
                latest[field] = str(values_at[doc_index][field])
        truth[name] = {field: latest[field] for field in FIELDS}

        rivals = [other for other in companies if other != name]
        for doc_index in range(DOCS_PER_COMPANY):
            rival = rng.choice(rivals)
            docs.append(
                _document(
                    f"{index:02d}{doc_index}",
                    name,
                    rival,
                    dates[doc_index],
                    sorted(mentions[doc_index]),
                    values_at[doc_index],
                    rng,
                )
            )
            stated = {f: str(values_at[doc_index][f]) for f in sorted(mentions[doc_index])}
            facts.append((name, stated))
    order = rng.sample(range(len(docs)), len(docs))  # shuffle so docs are not grouped
    shuffled, doc_facts = [], {}
    for number, i in enumerate(order, start=1):
        doc_id = f"doc-{number:02d}"
        shuffled.append(docs[i].model_copy(update={"id": doc_id}))
        doc_facts[doc_id] = facts[i]
    return T1Instance(
        seed=str(seed),
        fields=list(FIELDS),
        companies=companies,
        docs=shuffled,
        truth=truth,
        doc_facts=doc_facts,
    )


def _new_value(field: str, old: str | int, rng: random.Random, name: str) -> str | int:
    for _ in range(20):
        value = _value(field, rng, name)
        if value != old:
            return value
    return old


def _document(
    doc_id: str,
    name: str,
    rival: str,
    day: date,
    fields: list[str],
    values: dict[str, str | int],
    rng: random.Random,
) -> Document:
    sentences = [
        rng.choice(_TEMPLATES[field]).format(name=name, v=values[field])
        for field in rng.sample(fields, len(fields))
    ]
    # Distractor: a rival's value for a field this doc states.
    shared = [field for field in fields if field in _RIVAL]
    if shared:
        field = rng.choice(shared)
        decoy = _value(field, rng, rival)
        sentences.insert(
            rng.randrange(len(sentences) + 1), _RIVAL[field].format(rival=rival, v=decoy)
        )
    noise = rng.choice(_NOISE).format(n=rng.randrange(2, 90))
    sentences.insert(rng.randrange(len(sentences) + 1), noise)
    title = f"{name}: update of {day.isoformat()}"
    return Document(id=doc_id, date=day.isoformat(), title=title, text=" ".join(sentences))


def write_instance(instance: T1Instance, out_dir: Path) -> tuple[Path, Path]:
    """Write ``docs.json`` (what agents see) and ``truth.json`` (what only the scorer sees)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    docs_path, truth_path = out_dir / "docs.json", out_dir / "truth.json"
    visible = {
        "seed": instance.seed,
        "fields": instance.fields,
        "companies": instance.companies,
        "docs": [doc.model_dump() for doc in instance.docs],
    }
    docs_path.write_text(json.dumps(visible, indent=2) + "\n", encoding="utf-8", newline="\n")
    truth = json.dumps(instance.truth, indent=2, sort_keys=True) + "\n"
    truth_path.write_text(truth, encoding="utf-8", newline="\n")
    return docs_path, truth_path


def write_fixture(root: Path, seed: int) -> Path:
    """``<root>/seed-<n>/{docs,truth}.json``: the instance a TaskSpec points at."""
    out = root / f"seed-{seed}"
    write_instance(generate(seed), out)
    return out


def load_fixture(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """(corpus, truth): the corpus is ``docs.json``, which has no ground truth."""
    corpus = json.loads((path / "docs.json").read_text(encoding="utf-8"))
    truth = json.loads((path / "truth.json").read_text(encoding="utf-8"))
    return corpus, truth
