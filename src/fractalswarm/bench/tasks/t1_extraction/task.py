"""T1 for the engine: what each level of the tree asks the LLM and how its output is used.

- Root (Wonder): one subgoal per group of companies, with the companies it holds.
- Group orchestrator (Spark): one session subgoal per batch of its companies.
- Session orchestrator (Spark): contracts ``extract`` -> ``resolve`` -> ``report``.
- Agents: ``extract`` reads the session's documents and lists what each one states about its
  company; ``resolve`` settles the contradictions between documents (the newer one wins) and
  publishes one value per company and field; ``report`` writes the audit note to the workspace.

All the documents of a company go to one session, so its contradictions are settled inside
one squad. Deterministic checks on each contract are the field formats (spec §11) and
coverage; the final report scores the table with the field-level F1 against the ground
truth, which prompts never see.

Safety (spec §13): the documents are attachments, scanned at the root before any prompt
carries them. The approved envelope is one node per group, one for sessions and one per
contract kind.
"""

from collections import defaultdict
from itertools import chain
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from fractalswarm.bench.tasks.t1_extraction import check_formats, score
from fractalswarm.planning.contracts import Acceptance, Contract, ContractBudget, Produce
from fractalswarm.planning.planner import parse_json, plan_request
from fractalswarm.planning.schemas import register_output
from fractalswarm.safety.scope_check import ApprovedNode
from fractalswarm.verify.checks import register_check

NAME = "t1_extraction"
MAX_VALUE_CHARS = 80  # a value is a name or a number, never a paragraph


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


FieldName = Literal[
    "ceo",
    "headquarters",
    "founded_year",
    "employees",
    "revenue_musd",
    "ticker",
    "industry",
    "product",
]


# -- planning outputs --------------------------------------------------------------------


class GroupSubgoal(Strict):
    group_id: str
    companies: list[str]
    priority: int
    risk: float
    acceptance: str


class RootPlan(Strict):
    groups: list[GroupSubgoal]
    feasibility: str
    limitations: list[str]


class BatchSubgoal(Strict):
    batch: int
    companies: list[str]
    notes: str


class GroupPlan(Strict):
    batches: list[BatchSubgoal]


class PlannedContract(Strict):
    id: str
    kind: Literal["extract", "resolve", "report"]
    objective: str
    depends_on: list[str]
    priority: int
    risk: float


class SessionPlan(Strict):
    contracts: list[PlannedContract]


# -- agent outputs -----------------------------------------------------------------------


class Mention(Strict):
    doc_id: str
    company: str
    field: FieldName
    value: str


class ExtractResult(Strict):
    mentions: list[Mention]


class Resolved(Strict):
    company: str
    field: FieldName
    value: str
    doc_id: str


class ResolveResult(Strict):
    records: list[Resolved]


class ReportResult(Strict):
    note: str = Field(description="at most six lines for the audit trail")
    path: str


register_output("t1_extract", ExtractResult)
register_output("t1_resolve", ResolveResult)
register_output("t1_report", ReportResult)


# -- instructions (static, first in every prompt for cache hits) -------------------------

ROOT_INSTRUCTIONS = """You are the root planner of FractalSwarm, a tree of orchestrators.
Decompose the extraction goal into one subgoal per group of companies. Name the groups g1, g2,
and so on, as many as asked. Give every company to exactly one group and keep the groups
balanced (the same number of companies, give or take one); every group needs at least as many
companies as there are batches, because its own orchestrator will split it into that many
batches. Write a short feasibility note and the main limitations. Reply with JSON matching the
schema."""

GROUP_INSTRUCTIONS = """You are a group orchestrator in FractalSwarm. Split your group's
companies into exactly the number of batches asked, numbered from 1. Every company goes to
exactly one batch, no batch is empty, and the batches stay balanced. Reply with JSON matching
the schema."""

SESSION_INSTRUCTIONS = """You are a session orchestrator in FractalSwarm. You lead a squad of
agents. Write the contracts for your batch of companies, as a small DAG:
1. kind "extract": read the documents of the batch and list what each one states about its
   company;
2. kind "resolve": depends on extract; settle the contradictions between documents (the newer
   document wins) and publish one value per company and field;
3. kind "report": depends on resolve; write the audit note of the batch.
Use short ids (extract, resolve, report). Keep each objective to one sentence and do not copy
field values into it. Reply with JSON matching the schema."""

EXTRACT_GUIDE = [
    "Every document is about the company named in its title. List each fact a document states "
    "about that company, once per document and field: doc_id, company, field, value.",
    "A sentence about a rival or a competitor is not a fact of this company, nor is a number "
    "that is not one of the fields (market growth, offices, customers, months): leave it out.",
    "Write values as the document does, except numbers: plain digits with no thousands "
    "separator, currency or unit (revenue_musd is the number of millions), and a ticker in "
    f"capitals. A value is at most {MAX_VALUE_CHARS} characters.",
    "Do not settle contradictions between documents here: report what each one says.",
]

RESOLVE_GUIDE = [
    "For every company of the session and every field, choose the value of the newest document "
    "that states it: a newer document wins over an older one. doc_dates gives each date.",
    "Give exactly one record per company and field, with the id of the document the value "
    "comes from. Every field of every company must be there.",
    "Publish each record with memory.publish_fact (key company:<company>:<field>, subject the "
    "company, value_json the value as a JSON string, sources [the doc id]), then answer.",
]

REPORT_GUIDE = [
    "Write a short note for the audit trail, at most six lines: per company, the documents "
    "its values come from and their dates.",
    "Save the note with workspace.write to the path given in the data, then answer.",
]


# -- slicing the corpus (each level passes its child only what the child needs) ----------


def company_of(doc: dict[str, Any]) -> str:
    """A document is about the company its title names (``<company>: update of <date>``)."""
    return doc["title"].split(":", 1)[0].strip()


def _data_slice(corpus: dict[str, Any], companies: list[str]) -> dict[str, Any]:
    wanted = set(companies)
    docs = sorted((d for d in corpus["docs"] if company_of(d) in wanted), key=lambda d: d["id"])
    return {"fields": corpus["fields"], "docs": docs}


def _company_lines(corpus: dict[str, Any]) -> list[dict[str, Any]]:
    counts: dict[str, int] = defaultdict(int)
    for doc in corpus["docs"]:
        counts[company_of(doc)] += 1
    return [{"name": name, "documents": counts[name]} for name in corpus["companies"]]


def table_of(records: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """The ``company -> field -> value`` table of resolved records (the first one wins)."""
    table: dict[str, dict[str, str]] = {}
    for record in sorted(records, key=lambda r: (r["company"], r["field"], r["doc_id"])):
        table.setdefault(record["company"], {}).setdefault(record["field"], record["value"])
    return table


def _spread(items: list[str], count: int) -> list[list[str]]:
    """``count`` lists that deal ``items`` out in turn."""
    return [items[i::count] for i in range(count)]


class T1Task:
    name = NAME

    def sessions(self, corpus: dict[str, Any]) -> int:
        """Leaf goals of the tree: one session per batch of each group."""
        return corpus["groups"] * corpus["batches"]

    # -- level 0: root plan -------------------------------------------------------------

    def root_request(self, goal: dict[str, Any], feedback: list[str]) -> dict[str, Any]:
        corpus = goal["corpus"]
        return plan_request(
            role="root_planner",
            schema_name="t1_root_plan",
            model=RootPlan,
            instructions=ROOT_INSTRUCTIONS,
            header=f"GOAL\n{goal['goal']}",
            data={
                "extraction": {
                    "companies": _company_lines(corpus),
                    "fields": corpus["fields"],
                    "groups": corpus["groups"],
                    "batches": corpus["batches"],
                }
            },
            feedback=feedback,
        )

    def root_parse(self, goal: dict[str, Any], text: str):
        plan, errors = parse_json(RootPlan, text)
        if plan is None:
            return None, errors
        corpus = goal["corpus"]
        wanted = [f"g{i}" for i in range(1, corpus["groups"] + 1)]
        if sorted(sub.group_id for sub in plan.groups) != wanted:
            errors.append(f"give exactly one subgoal per group, with the ids {wanted}")
        known = set(corpus["companies"])
        seen: dict[str, int] = defaultdict(int)
        for sub in plan.groups:
            if len(sub.companies) < corpus["batches"]:
                errors.append(f"{sub.group_id} needs at least {corpus['batches']} companies")
            for company in sub.companies:
                seen[company] += 1
        missing = [company for company in corpus["companies"] if seen[company] == 0]
        extra = sorted(company for company, n in seen.items() if n > 1 or company not in known)
        if missing:
            errors.append(f"companies in no group: {missing}")
        if extra:
            errors.append(f"companies unknown or in several groups: {extra}")
        if errors:
            return None, errors
        return plan.model_dump(), []

    def root_fallback(self, goal: dict[str, Any]) -> dict[str, Any]:
        corpus = goal["corpus"]
        groups = _spread(sorted(corpus["companies"]), corpus["groups"])
        return RootPlan(
            groups=[
                GroupSubgoal(
                    group_id=f"g{i}",
                    companies=companies,
                    priority=1,
                    risk=0.3,
                    acceptance="every field of every company extracted, the newest value kept",
                )
                for i, companies in enumerate(groups, start=1)
            ],
            feasibility="deterministic fallback plan",
            limitations=[],
        ).model_dump()

    def root_children(self, goal: dict[str, Any], plan: dict[str, Any]) -> list[dict[str, Any]]:
        corpus = goal["corpus"]
        children = []
        for sub in sorted(plan["groups"], key=lambda g: g["group_id"]):
            companies = sorted(sub["companies"])
            children.append(
                {
                    "id": sub["group_id"],
                    "priority": sub["priority"],
                    "batches": corpus["batches"],
                    "companies": companies,
                    "data": _data_slice(corpus, companies),
                }
            )
        return children

    # -- intermediate levels: group -> batches --------------------------------------------

    def split_request(self, goal: dict[str, Any], feedback: list[str]) -> dict[str, Any]:
        counts: dict[str, int] = defaultdict(int)
        for doc in goal["data"]["docs"]:
            counts[company_of(doc)] += 1
        return plan_request(
            role="sub_planner",
            schema_name="t1_group_plan",
            model=GroupPlan,
            instructions=GROUP_INSTRUCTIONS,
            header=f"GROUP {goal['id']}",
            data={
                "group": goal["id"],
                "batches": goal["batches"],
                "companies": [{"name": c, "documents": counts[c]} for c in goal["companies"]],
            },
            feedback=feedback,
        )

    def split_parse(self, goal: dict[str, Any], text: str):
        plan, errors = parse_json(GroupPlan, text)
        if plan is None:
            return None, errors
        if sorted(batch.batch for batch in plan.batches) != list(range(1, goal["batches"] + 1)):
            errors.append(f"give exactly one entry per batch, numbered 1 to {goal['batches']}")
        placed = sorted(chain.from_iterable(batch.companies for batch in plan.batches))
        if placed != sorted(goal["companies"]):
            errors.append(f"the batches must partition the group's companies {goal['companies']}")
        errors += [f"batch {b.batch} is empty" for b in plan.batches if not b.companies]
        if errors:
            return None, errors
        return plan.model_dump(), []

    def split_fallback(self, goal: dict[str, Any]) -> dict[str, Any]:
        batches = _spread(sorted(goal["companies"]), goal["batches"])
        return GroupPlan(
            batches=[
                BatchSubgoal(batch=i, companies=companies, notes="fallback")
                for i, companies in enumerate(batches, start=1)
            ]
        ).model_dump()

    def split_children(self, goal: dict[str, Any], plan: dict[str, Any]) -> list[dict[str, Any]]:
        children = []
        for batch in sorted(plan["batches"], key=lambda b: b["batch"]):
            companies = sorted(batch["companies"])
            children.append(
                {
                    "id": f"{goal['id']}/b{batch['batch']}",
                    "priority": 1,
                    "group": goal["id"],
                    "batch": batch["batch"],
                    "companies": companies,
                    "data": _data_slice(goal["data"], companies),
                }
            )
        return children

    # -- leaf level: contracts ------------------------------------------------------------

    def contracts_request(self, goal: dict[str, Any], feedback: list[str]) -> dict[str, Any]:
        return plan_request(
            role="sub_planner",
            schema_name="t1_session_plan",
            model=SessionPlan,
            instructions=SESSION_INSTRUCTIONS,
            header=f"SESSION {goal['id']}: group {goal['group']}, batch {goal['batch']}",
            data={
                "session": {
                    "id": goal["id"],
                    "companies": goal["companies"],
                    "documents": len(goal["data"]["docs"]),
                    "fields": goal["data"]["fields"],
                }
            },
            feedback=feedback,
        )

    def contracts_parse(self, goal: dict[str, Any], text: str):
        plan, errors = parse_json(SessionPlan, text)
        if plan is None:
            return None, errors
        kinds = sorted(contract.kind for contract in plan.contracts)
        if kinds != ["extract", "report", "resolve"]:
            errors.append("write exactly three contracts: extract, resolve and report")
        ids = {contract.id for contract in plan.contracts}
        if len(ids) != len(plan.contracts):
            errors.append("contract ids must be unique")
        by_kind = {contract.kind: contract for contract in plan.contracts}
        needs = {"resolve": "extract", "report": "resolve"}
        for kind, dep in needs.items():
            if (
                kind in by_kind
                and dep in by_kind
                and by_kind[dep].id not in by_kind[kind].depends_on
            ):
                errors.append(f"{kind} must depend on {dep}")
        for contract in plan.contracts:
            unknown = [d for d in contract.depends_on if d not in ids or d == contract.id]
            if unknown:
                errors.append(f"{contract.id} depends on unknown contracts {unknown}")
        if errors:
            return None, errors
        return plan.model_dump(), []

    def contracts_fallback(self, goal: dict[str, Any]) -> dict[str, Any]:
        contracts = [
            PlannedContract(
                id=kind,
                kind=kind,
                objective=f"{kind} for session {goal['id']}",
                depends_on=deps,
                priority=1,
                risk=0.3,
            )
            for kind, deps in (("extract", []), ("resolve", ["extract"]), ("report", ["resolve"]))
        ]
        return SessionPlan(contracts=contracts).model_dump()

    def contracts(
        self, goal: dict[str, Any], plan: dict[str, Any], owner: str, scope: str
    ) -> list[Contract]:
        made = []
        for planned in plan["contracts"]:
            kind = planned["kind"]
            spec = CONTRACT_KINDS[kind]
            made.append(
                Contract(
                    id=planned["id"],
                    goal_id=goal["id"],
                    kind=kind,
                    owner=owner,
                    objective=planned["objective"],
                    depends_on=sorted(planned["depends_on"]),
                    reads=spec["reads"],
                    writes=spec["writes"](goal),
                    produces=[Produce(key=f"{goal['id']}/{kind}", schema_name=spec["schema"])],
                    constraints=spec["guide"],
                    acceptance=Acceptance(checks=spec["checks"], rubric=spec["rubric"]),
                    tools=spec["tools"],
                    budget=ContractBudget(usd=0.10),
                    priority=planned["priority"],
                    risk=min(max(planned["risk"], 0.0), 1.0),
                    critical_path=kind == "resolve",
                    scope_token=scope,
                )
            )
        return made

    def contract_inputs(
        self, goal: dict[str, Any], contract: Contract, deps: dict[str, dict[str, Any]]
    ) -> dict[str, Any]:
        """The data a contract's prompt carries: trusted ``data``, spotlighted ``untrusted``."""
        data = goal["data"]
        session = {"id": goal["id"], "companies": goal["companies"]}
        dates = {doc["id"]: doc["date"] for doc in data["docs"]}
        if contract.kind == "extract":
            return {
                "data": {"session": session, "fields": data["fields"]},
                "untrusted": {"documents": data["docs"]},
            }
        if contract.kind == "resolve":
            extracted = next((out for out in deps.values() if "mentions" in out), {})
            return {
                "data": {
                    "session": session,
                    "fields": data["fields"],
                    "doc_dates": dates,
                    "mentions": extracted.get("mentions", []),
                }
            }
        resolved = next((out for out in deps.values() if "records" in out), {})
        return {
            "data": {
                "session": session,
                "path": f"sessions/{goal['id']}/audit.md",
                "doc_dates": dates,
                "records": resolved.get("records", []),
            }
        }

    def check_context(self, goal: dict[str, Any]) -> dict[str, Any]:
        data = goal["data"]
        return {
            "companies": goal["companies"],
            "fields": data["fields"],
            "docs": {doc["id"]: company_of(doc) for doc in data["docs"]},
        }

    def needs_judge(self, contract: Contract) -> bool:
        return contract.kind == "resolve"

    def bookings(self, goal: dict[str, Any], contract: Contract, output: dict[str, Any]):
        """T1 has no shared grid: two sessions never write the same slot."""
        return []

    def conflict_feedback(self, conflicts: list[dict[str, Any]]) -> list[str]:
        return []

    # -- safety: attachments and scope (spec §13) -----------------------------------------

    def attachments(self, goal: dict[str, Any]) -> list[tuple[str, str]]:
        """The root goal's untrusted attachments, scanned before any prompt carries them:
        each document, title and text."""
        return [(doc["id"], f"{doc['title']}\n\n{doc['text']}") for doc in goal["corpus"]["docs"]]

    def quarantine(self, goal: dict[str, Any], stubs: dict[str, str]) -> dict[str, Any]:
        """The goal with each quarantined document's text replaced by its stub. The verdict
        covered the title too, so only the company it names is kept (that routes the document)."""
        if not stubs:
            return goal
        known = set(goal["corpus"]["companies"])
        docs = []
        for doc in goal["corpus"]["docs"]:
            if doc["id"] not in stubs:
                docs.append(doc)
                continue
            company = company_of(doc)
            title = f"{company}: [quarantined]" if company in known else "[quarantined]"
            docs.append(doc | {"title": title, "text": stubs[doc["id"]]})
        return goal | {"corpus": goal["corpus"] | {"docs": docs}}

    def envelope(self, goal: dict[str, Any], plan: dict[str, Any]) -> list[ApprovedNode]:
        """The approved plan's nodes: each group, then the kinds of work below the groups."""
        batches = goal["corpus"]["batches"]
        facts = ["company.facts"]
        nodes = [
            ApprovedNode(
                node_id=f"group:{sub['group_id']}",
                objective=f"Extract the facts of the companies {sorted(sub['companies'])}",
                data_categories=facts,
            )
            for sub in plan["groups"]
        ]
        nodes.append(
            ApprovedNode(
                node_id="session",
                objective="Extract and settle the facts of one batch of a group's companies",
                data_categories=facts,
            )
        )
        sessions = [
            {"id": f"{sub['group_id']}/b{batch}"}
            for sub in plan["groups"]
            for batch in range(1, batches + 1)
        ]
        for kind, spec in CONTRACT_KINDS.items():
            writes = sorted({write for session in sessions for write in spec["writes"](session)})
            nodes.append(
                ApprovedNode(
                    node_id=f"contract:{kind}",
                    objective=f"The {kind} contract of a session",
                    writes=writes,
                    tools=spec["tools"],
                    data_categories=facts,
                )
            )
        return nodes

    def proposals(
        self, goal: dict[str, Any], plan: dict[str, Any], leaf: bool
    ) -> list[dict[str, Any]]:
        """What a plan below the root proposes, as subgoals for the scope check."""
        if leaf:
            return [
                {
                    "subgoal_id": f"{goal['id']}/{planned['id']}",
                    "objective": planned["objective"],
                    "node_id": f"contract:{planned['kind']}",
                    "writes": CONTRACT_KINDS[planned["kind"]]["writes"](goal),
                    "tools": CONTRACT_KINDS[planned["kind"]]["tools"],
                }
                for planned in plan["contracts"]
            ]
        return [
            {
                "subgoal_id": f"{goal['id']}/b{batch['batch']}",
                "objective": f"Extract the facts of batch {batch['batch']} of group {goal['id']}",
                "node_id": "session",
            }
            for batch in plan["batches"]
        ]

    # -- integration ----------------------------------------------------------------------

    def integrate_leaf(self, goal: dict[str, Any], outputs: dict[str, dict[str, Any]]):
        records = next((o["records"] for o in outputs.values() if "records" in o), [])
        note = next((o["note"] for o in outputs.values() if "note" in o), "")
        return {
            "session": goal["id"],
            "records": sorted(records, key=lambda r: (r["company"], r["field"])),
            "note": note,
        }

    def integrate(self, goal: dict[str, Any], results: dict[str, dict[str, Any]]):
        """Bottom-up: sessions -> group, groups -> root. Records are concatenated."""
        records, parts = [], {}
        for child_id in sorted(results):
            output = results[child_id].get("output") or {}
            records += output.get("records", [])
            parts[child_id] = {k: v for k, v in output.items() if k != "records"}
        return {
            "goal": goal["id"],
            "records": sorted(records, key=lambda r: (r["company"], r["field"])),
            "parts": parts,
        }

    def final_report(self, goal: dict[str, Any], output: dict[str, Any]) -> dict[str, Any]:
        table = table_of(output["records"])
        result = score(table, goal["truth"])
        bad = check_formats(table)
        expected = result.tp + result.fn
        return {
            "hard_violations": len(bad),
            "violation_counts": {"format": len(bad)},
            "violations": [{"kind": "format", "detail": slot} for slot in bad[:50]],
            "soft_score": round(result.f1, 4),
            "placed": expected - result.missing,
            "expected": expected,
            "f1": round(result.f1, 4),
            "precision": round(result.precision, 4),
            "recall": round(result.recall, 4),
            "tp": result.tp,
            "fp": result.fp,
            "fn": result.fn,
            "table": table,
        }


# -- deterministic checks (spec §11) ------------------------------------------------------


def _format_failures(items: list[dict[str, Any]]) -> list[str]:
    failures = []
    for item in items:
        company, field, value = item["company"], item["field"], item["value"]
        if len(value) > MAX_VALUE_CHARS:
            failures.append(f"{company}.{field}: the value is over {MAX_VALUE_CHARS} characters")
        for slot in check_formats({company: {field: value}}):
            failures.append(f"{slot}: {value!r} is not a well-formed {field}")
    return failures


def _uncovered(found: set[tuple[str, str]], context: dict[str, Any]) -> list[str]:
    return [
        f"{company}.{field}"
        for company in context["companies"]
        for field in context["fields"]
        if (company, field) not in found
    ]


def _listed(slots: list[str]) -> str:
    return ", ".join(slots[:8]) + (" ..." if len(slots) > 8 else "")


@register_check("t1.mentions")
def t1_mentions(output: dict[str, Any], _: str, context: dict[str, Any]) -> list[str]:
    """Every mention names a document of the session and that document's own company
    (a sentence about a rival is not a fact), and every field of every company is covered:
    the corpus states each one at least once."""
    failures = []
    found: set[tuple[str, str]] = set()
    for item in output["mentions"]:
        owner = context["docs"].get(item["doc_id"])
        if owner is None:
            failures.append(f"{item['doc_id']} is not a document of this session")
        elif owner != item["company"]:
            failures.append(
                f"{item['doc_id']} is about {owner}, not {item['company']}: "
                f"a sentence about another company is not a fact of {owner}"
            )
        else:
            found.add((item["company"], item["field"]))
    missing = _uncovered(found, context)
    if missing:
        failures.append(f"no document mentions {_listed(missing)}")
    return failures + _format_failures(output["mentions"])


@register_check("t1.records")
def t1_records(output: dict[str, Any], _: str, context: dict[str, Any]) -> list[str]:
    """One record per company and field of the session, each from a document of its company."""
    failures = []
    found: dict[tuple[str, str], int] = defaultdict(int)
    for item in output["records"]:
        slot = (item["company"], item["field"])
        found[slot] += 1
        owner = context["docs"].get(item["doc_id"])
        if owner != item["company"]:
            failures.append(
                f"{slot[0]}.{slot[1]} cites {item['doc_id']}, not a document of {slot[0]}"
            )
    missing = _uncovered(set(found), context)
    if missing:
        failures.append(f"no record for {_listed(missing)}")
    extra = sorted(f"{c}.{f}" for (c, f), n in found.items() if n > 1)
    if extra:
        failures.append(f"more than one record for {_listed(extra)}")
    known = {(c, f) for c in context["companies"] for f in context["fields"]}
    unknown = sorted(f"{c}.{f}" for c, f in found if (c, f) not in known)
    if unknown:
        failures.append(f"records for companies outside the session: {_listed(unknown)}")
    return failures + _format_failures(output["records"])


# -- contract kinds -----------------------------------------------------------------------

CONTRACT_KINDS: dict[str, dict[str, Any]] = {
    "extract": {
        "schema": "t1_extract",
        "tools": [],
        "reads": [],
        "writes": lambda goal: [],
        "checks": ["schema:t1_extract", "t1.mentions"],
        "rubric": [],
        "guide": EXTRACT_GUIDE,
    },
    "resolve": {
        "schema": "t1_resolve",
        "tools": ["memory.publish_fact"],
        "reads": [],
        "writes": lambda goal: ["company:*"],
        "checks": ["schema:t1_resolve", "t1.records"],
        "rubric": [
            "every company of the session has a record for every field",
            "each value comes from the newest document that states that field, according to "
            "the mentions and doc_dates",
            "no value was taken from a sentence about another company",
        ],
        "guide": RESOLVE_GUIDE,
    },
    "report": {
        "schema": "t1_report",
        "tools": ["workspace.write"],
        "reads": [],
        "writes": lambda goal: [f"sessions/{goal['id']}/audit.md"],
        "checks": ["schema:t1_report", "nonempty:note"],
        "rubric": [],
        "guide": REPORT_GUIDE,
    },
}

T1 = T1Task()
