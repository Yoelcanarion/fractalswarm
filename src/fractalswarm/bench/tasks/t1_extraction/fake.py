"""A scripted fake of the model for T1: it reads the request and answers what the role asks.

Like T2's, it plays every role of the task from the request alone (never from the ground
truth): it recognizes the role by the structured-output schema name, reads the prompt's
``<<<DATA>>>`` and ``<<<UNTRUSTED>>>`` blocks, and walks the tool loop from the items the
request carries. It reads the documents with the sentence templates the generator uses: a
sentence about the company of the title is a fact, a sentence about a rival is not.
"""

import json
import re
from typing import Any

from fractalswarm.bench.tasks.t2_conference.fake import _answer, _call, _prompt, _turns
from fractalswarm.llm.fake import FakeReply
from fractalswarm.planning.planner import read_blocks

NO_SCRIPT = "[fake] no script for"
SENTENCES = re.compile(r"(?<=\.)\s+")


def t1_script(body: dict[str, Any], attempt: int) -> FakeReply | str:
    name = ((body.get("text") or {}).get("format") or {}).get("name", "")
    if name == "judge_verdict":
        blocks = read_blocks(_prompt(body))
        if "mentions" in blocks.get("contract_data", {}):  # T1's resolve contract
            return judge(blocks)
        return f"{NO_SCRIPT} {name}"
    handler = HANDLERS.get(name)
    if handler is None:
        return f"{NO_SCRIPT} {name or 'plain text'}"
    return handler(body)


# -- reading the documents (what an LLM does with the text) -------------------------------


def _own_sentences(company: str) -> dict[str, list[str]]:
    """Per field, the patterns of a sentence that states it about ``company`` (the ones with
    no name say 'its' and mean the company of the title)."""
    n = re.escape(company)
    return {
        "ceo": [
            rf"{n} is led by chief executive (?P<v>.+)",
            rf"CEO (?P<v>.+) said {n} expects a busy year",
        ],
        "headquarters": [
            rf"{n} is headquartered in (?P<v>.+)",
            rf"From its head office in (?P<v>.+), {n} serves customers in many countries",
        ],
        "founded_year": [
            rf"{n} was founded in (?P<v>\d{{4}})",
            rf"Since its founding in (?P<v>\d{{4}}), {n} has grown",
        ],
        "employees": [
            rf"{n} now employs (?P<v>[\d,]+) people",
            r"The company's headcount stands at (?P<v>[\d,]+) employees",
        ],
        "revenue_musd": [
            r"Annual revenue reached \$(?P<v>\d+) million",
            rf"{n} reported revenue of \$(?P<v>\d+) million for the year",
        ],
        "ticker": [
            rf"{n} trades under the ticker (?P<v>[A-Z]+)",
            rf"Shares of {n} \((?P<v>[A-Z]+)\) rose this week",
        ],
        "industry": [rf"{n} works in (?P<v>.+)", rf"{n} is a (?P<v>.+) company"],
        "product": [
            r"Its flagship product is (?P<v>.+)",
            rf"{n} sells (?P<v>.+), its best-known product",
        ],
    }


def mentions_in(doc: dict[str, Any]) -> list[dict[str, str]]:
    """What a document states about the company its title names."""
    company = doc["title"].split(":", 1)[0].strip()
    patterns = _own_sentences(company)
    found = []
    for sentence in SENTENCES.split(doc["text"]):
        sentence = sentence.strip().removesuffix(".")
        for field, options in patterns.items():
            for option in options:
                if match := re.fullmatch(option, sentence):
                    value = match.group("v")
                    if field == "employees":
                        value = value.replace(",", "")  # the guide asks for plain digits
                    found.append(
                        {"doc_id": doc["id"], "company": company, "field": field, "value": value}
                    )
    return found


def newest(mentions: list[dict[str, str]], dates: dict[str, str]) -> list[dict[str, str]]:
    """One record per company and field: the mention of the newest document wins."""
    picked: dict[tuple[str, str], dict[str, str]] = {}
    for mention in sorted(mentions, key=lambda m: (dates[m["doc_id"]], m["doc_id"])):
        picked[(mention["company"], mention["field"])] = mention  # a later one replaces
    return [picked[slot] for slot in sorted(picked)]


# -- planning roles -----------------------------------------------------------------------


def _deal(items: list[str], count: int) -> list[list[str]]:
    return [items[i::count] for i in range(count)]


def root_plan(body: dict[str, Any]) -> str:
    extraction = read_blocks(_prompt(body))["extraction"]
    names = sorted(company["name"] for company in extraction["companies"])
    groups = [
        {
            "group_id": f"g{i}",
            "companies": companies,
            "priority": 1,
            "risk": 0.3,
            "acceptance": "every field of every company extracted, the newest value kept",
        }
        for i, companies in enumerate(_deal(names, extraction["groups"]), start=1)
    ]
    plan = {
        "groups": groups,
        "feasibility": f"{len(names)} companies in {extraction['groups']} groups of "
        f"{extraction['batches']} batches.",
        "limitations": ["documents may contradict each other: the newest one is trusted"],
    }
    return _answer(plan)


def group_plan(body: dict[str, Any]) -> str:
    blocks = read_blocks(_prompt(body))
    names = sorted(company["name"] for company in blocks["companies"])
    batches = [
        {"batch": i, "companies": companies, "notes": f"{len(companies)} companies"}
        for i, companies in enumerate(_deal(names, blocks["batches"]), start=1)
    ]
    return _answer({"batches": batches})


def session_plan(body: dict[str, Any]) -> str:
    session = read_blocks(_prompt(body))["session"]
    count = session["documents"]
    contracts = [
        {
            "id": "extract",
            "kind": "extract",
            "objective": f"Extract what each of the {count} documents of the batch states.",
            "depends_on": [],
            "priority": 2,
            "risk": 0.4,
        },
        {
            "id": "resolve",
            "kind": "resolve",
            "objective": "Settle the contradictions between documents: the newest one wins.",
            "depends_on": ["extract"],
            "priority": 3,
            "risk": 0.6,
        },
        {
            "id": "report",
            "kind": "report",
            "objective": "Write the audit note of the batch.",
            "depends_on": ["resolve"],
            "priority": 1,
            "risk": 0.1,
        },
    ]
    return _answer({"contracts": contracts})


def judge(blocks: dict[str, Any]) -> str:
    """Whether every value is the newest document's (what the rubric asks of ``resolve``)."""
    data, output = blocks["contract_data"], blocks["agent_output"]
    wanted = {
        (r["company"], r["field"]): r["value"] for r in newest(data["mentions"], data["doc_dates"])
    }
    given = {(r["company"], r["field"]): r["value"] for r in output.get("records", [])}
    reasons = [
        f"{c}.{f} is {given[(c, f)]!r} but the newest document says {v!r}"
        for (c, f), v in sorted(wanted.items())
        if (c, f) in given and given[(c, f)] != v
    ]
    absent = [f"{c}.{f}" for c, f in sorted(wanted) if (c, f) not in given]
    if absent:
        reasons.append(f"no record for {', '.join(absent)}")
    if reasons:
        return _answer({"verdict": "fail", "score": 0.2, "reasons": reasons})
    return _answer({"verdict": "pass", "score": 0.9, "reasons": []})


# -- agent roles --------------------------------------------------------------------------


def extract(body: dict[str, Any]) -> FakeReply | str:
    documents = read_blocks(_prompt(body))["documents"]
    mentions = [mention for doc in documents for mention in mentions_in(doc)]
    return _answer({"mentions": mentions})


def resolve(body: dict[str, Any]) -> FakeReply | str:
    blocks = read_blocks(_prompt(body))
    records = newest(blocks["mentions"], blocks["doc_dates"])
    if not _turns(body):
        calls = []
        for company in sorted({r["company"] for r in records}):
            mine = [r for r in records if r["company"] == company]
            calls.append(
                _call(
                    "memory.publish_fact",
                    key=f"company:{company}",
                    subject=company,
                    value_json=json.dumps({r["field"]: r["value"] for r in mine}, sort_keys=True),
                    sources=sorted({r["doc_id"] for r in mine}),
                )
            )
        return FakeReply(tool_calls=calls)
    return _answer({"records": records})


def report(body: dict[str, Any]) -> FakeReply | str:
    blocks = read_blocks(_prompt(body))
    dates = blocks["doc_dates"]
    used: dict[str, set[str]] = {}
    for record in blocks["records"]:
        used.setdefault(record["company"], set()).add(record["doc_id"])
    lines = [
        f"{company}: " + ", ".join(f"{doc} on {dates[doc]}" for doc in sorted(used[company]))
        for company in sorted(used)
    ]
    note = "\n".join(lines[:6]) or "no records"
    if not _turns(body):
        return FakeReply(tool_calls=[_call("workspace.write", path=blocks["path"], content=note)])
    return _answer({"note": note, "path": blocks["path"]})


HANDLERS = {
    "t1_root_plan": root_plan,
    "t1_group_plan": group_plan,
    "t1_session_plan": session_plan,
    "t1_extract": extract,
    "t1_resolve": resolve,
    "t1_report": report,
}
