"""A scripted fake of the model for T3: it reads the request and answers what the role asks.

Like T2's fake it plays every role from the request alone: it recognizes the role by the
structured-output schema name, reads the prompt's ``<<<DATA>>>`` and ``<<<UNTRUSTED>>>``
blocks, and walks the agents' tool loop from the items the request carries. The hosted search
tool is played over a ``CannedWeb``: its hits come back as ``web_search_call`` items and
``url_citation`` annotations, as the real API returns them.

The research agent reads the hits and the pages from the spotlighted tool results, cites the
first sentence of each page that answers the criterion, and skips quarantined pages.
"""

import re
from typing import Any

from fractalswarm.bench.tasks.t2_conference.fake import _answer, _call, _prompt, _turns
from fractalswarm.bench.tasks.t3_report.canned import CannedWeb
from fractalswarm.kernel.ids import digest
from fractalswarm.llm.fake import FakeReply, Script
from fractalswarm.planning.planner import read_blocks

# What a sentence that answers each criterion mentions; any other criterion is matched by name.
KEYWORDS = {"license": r"licen[sc]e|public domain", "deployment": r"embedded|in-process|server"}
SPOTLIGHTED = re.compile(r"<<untrusted[^>]*>>\n(.*?)\n<</untrusted[^>]*>>", re.DOTALL)
SENTENCE = re.compile(r"(?<=[.!?])\s+|\n")
MAX_FETCHES = 3
MAX_FINDINGS = 2


def make_t3_script(web: CannedWeb) -> Script:
    """The fake model of a T3 run over a canned web."""

    def script(body: dict[str, Any], attempt: int) -> FakeReply | str:
        if any(tool.get("type") == "web_search" for tool in body.get("tools") or []):
            return search(web, body)
        name = ((body.get("text") or {}).get("format") or {}).get("name", "")
        handler = HANDLERS.get(name)
        if handler is None:
            return f"[fake] no script for {name or 'plain text'}"
        return handler(body)

    return script


def search(web: CannedWeb, body: dict[str, Any]) -> FakeReply:
    query = body["input"]
    hits = web.search(query)
    results = [
        {"type": "text_result", "title": hit.title, "url": hit.url, "snippet": hit.snippet}
        for hit in hits
    ]
    item = {"type": "web_search_call", "id": f"ws_fake_{digest(query)[:8]}", "status": "completed"}
    item |= {"action": {"type": "search", "query": query}, "results": results}
    text = f"Sources found for {query!r}: " + "; ".join(hit.title for hit in hits) + "."
    notes = [{"type": "url_citation", "url": hit.url, "title": hit.title} for hit in hits]
    return FakeReply(
        text=text if hits else "No sources found.", output_items=[item], annotations=notes
    )


# -- planning roles -----------------------------------------------------------------------


def root_plan(body: dict[str, Any]) -> str:
    report = read_blocks(_prompt(body))["report"]
    subjects = [
        {
            "subject": subject,
            "priority": 1,
            "risk": 0.3,
            "acceptance": "every criterion answered with verified citations",
        }
        for subject in report["subjects"]
    ]
    feasibility = f"{len(subjects)} subjects on {len(report['criteria'])} criteria."
    limits = ["web results vary between runs"]
    return _answer({"subjects": subjects, "feasibility": feasibility, "limitations": limits})


def subject_plan(body: dict[str, Any]) -> str:
    blocks = read_blocks(_prompt(body))
    subject = blocks["subject"]
    criteria = [
        {"criterion": criterion, "queries": [f"{subject} {criterion}"], "notes": question}
        for criterion, question in sorted(blocks["criteria"].items())
    ]
    return _answer({"criteria": criteria})


def leaf_plan(body: dict[str, Any]) -> str:
    leaf = read_blocks(_prompt(body))["leaf"]
    contracts = [
        {
            "id": "research",
            "kind": "research",
            "objective": f"Find pages that answer: {leaf['question']} ({leaf['subject']}).",
            "depends_on": [],
            "priority": 2,
            "risk": 0.5,
        },
        {
            "id": "write",
            "kind": "write",
            "objective": f"Write the answer for {leaf['subject']} from the findings.",
            "depends_on": ["research"],
            "priority": 1,
            "risk": 0.2,
        },
    ]
    return _answer({"contracts": contracts})


def judge(body: dict[str, Any]) -> str:
    output = read_blocks(_prompt(body))["agent_output"]
    if not output.get("summary", "").strip():
        return _answer({"verdict": "fail", "score": 0.1, "reasons": ["the answer is empty"]})
    return _answer({"verdict": "pass", "score": 0.9, "reasons": []})


# -- agent roles --------------------------------------------------------------------------


def hit_urls(output: dict[str, Any]) -> list[str]:
    """The URLs on a line of their own in a search result's spotlighted hits."""
    return re.findall(r"^(https?://\S+)$", output.get("hits", ""), re.MULTILINE)


def page_text(output: dict[str, Any]) -> str | None:
    """The page text inside the spotlight markers, or None for a stub or an error."""
    found = SPOTLIGHTED.search(output.get("text", ""))
    return found.group(1) if found else None


def answering_sentence(subject: str, criterion: str, text: str) -> str | None:
    """The first real sentence about the criterion, from a page whose title names the subject."""
    if subject.lower() not in text.splitlines()[0].lower():
        return None
    pattern = re.compile(KEYWORDS.get(criterion, re.escape(criterion)), re.IGNORECASE)
    sentences = (s for s in SENTENCE.split(text) if len(s) >= 30 and s.endswith((".", "!", "?")))
    return next((s for s in sentences if pattern.search(s)), None)


def research(body: dict[str, Any]) -> FakeReply | str:
    blocks = read_blocks(_prompt(body))
    task = blocks["task"]
    turns = _turns(body)
    if not turns:
        return FakeReply(tool_calls=[_call("web_search", query=task["queries"][0])])
    if len(turns) == 1:
        urls = [url for _, _, output in turns[0] for url in hit_urls(output)][:MAX_FETCHES]
        if urls:
            return FakeReply(tool_calls=[_call("fetch", url=url) for url in urls])
    findings = []
    for name, _, output in turns[1] if len(turns) > 1 else []:
        text = page_text(output) if name == "fetch" else None
        sentence = answering_sentence(task["subject"], task["criterion"], text) if text else None
        if sentence:
            findings.append({"claim": sentence, "url": output["url"], "quote": sentence})
    notes = "" if findings else "no page answered the question"
    return _answer({"findings": findings[:MAX_FINDINGS], "notes": notes})


def write(body: dict[str, Any]) -> str:
    blocks = read_blocks(_prompt(body))
    task, findings = blocks["task"], blocks["findings"]
    if not findings:
        return _answer({"summary": "No supported answer was found."})
    answer = " ".join(finding["claim"] for finding in findings)
    return _answer({"summary": f"{task['subject']} ({task['criterion']}): {answer}"})


HANDLERS = {
    "t3_root_plan": root_plan,
    "t3_subject_plan": subject_plan,
    "t3_leaf_plan": leaf_plan,
    "t3_research": research,
    "t3_write": write,
    "judge_verdict": judge,
}
