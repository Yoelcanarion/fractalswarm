"""The Muse lens (arena spec §E, backend design §6): every LLM call of a run, read from its log.

The log already holds everything the lens shows. ``effect.started`` keeps the full prompt,
``effect.completed`` the model, usage, cost and output, and ``security.routed`` the Contributor
routing. The events whose ``causation_id`` is a completion are the decision that call led to.
The cassette adds the HTTP attempts. The lens only reads: it adds nothing to the events, so it
carries no replay risk, and it works on every run that was recorded before it existed.

Routes (``lens_routes``), all under ``/api/runs/{run_id}``:

- ``/calls``: one row per LLM effect (the Muse lens list);
- ``/calls/{effect_id}``: the row plus the prompt, the output, the decision it caused and, for an
  extraction call, each fact next to the sentence of the source it came from;
- ``/models``: the "Muse meter": dollars and tokens by model, the cache share, and the
  coordination and recovery tokens, which are computed from roles and tags, never hard-coded.

Dollars and tokens follow ``bench/scoring.py`` (``llm_calls``), so the lens totals are the bench
numbers: a call cut off by a crash is billed the same estimate, and says so (``estimated``).
"""

import json
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from fractalswarm.api.catalog import Catalog, RunEntry
from fractalswarm.bench.scoring import LLMCall, is_coordination, llm_calls
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.store import COLUMNS, _from_row
from fractalswarm.llm.client import LLMClient, LLMRequest
from fractalswarm.llm.roles import CONTRIBUTOR_SUFFIX
from fractalswarm.planning.planner import BLOCK

# What the lens indexes: LLM effects and the events that explain how one ended.
INDEX_TYPES = (
    "run.started",
    "run.completed",
    "run.halted",
    "effect.started",
    "effect.completed",
    "effect.cancelled",
    "effect.reissued",
    "security.routed",
    "budget.reserved",
    "budget.refused",
    "budget.settled",
    "actor.stopped",
    "chaos.injected",
    "baseline.crashed",
)
Cues = list[tuple[re.Pattern[str], int]]  # (pattern, weight) a sentence is scored with
USAGE_KEYS = ("input_tokens", "cached_tokens", "output_tokens", "reasoning_tokens", "searches")
MAX_CACHED_RUNS = 8
MAX_PAYLOAD_CHARS = 4096  # a decision event's payload beyond this is left to /events?from_seq=
RECOVERY_ROLE = "recovery"
RECOVERY_TAG_PREFIX = "recovery:"

# What a role's tokens buy, for the "every Muse token goes to the problem" reading. The
# benchmark's own coordination definition (scoring.COORDINATION_ROLES) is used as it is.
PURPOSES = {
    "agent": "work",
    "root_planner": "planning",
    "sub_planner": "planning",
    "judge": "verification",
    "auditor": "verification",
    "arbiter": "arbitration",
    "collision_check": "arbitration",
    "intake": "intake",
    "safety_classifier": "safety",
    "alignment_check": "safety",
    "supervisor": "coordination",
    "coordinator": "coordination",
    "router": "coordination",
    RECOVERY_ROLE: "recovery",
}
# Fields of a model's structured answer that hold its reasons in words.
RATIONALE_KEYS = frozenset(
    {"reason", "reasons", "feasibility", "limitations", "notes", "rationale", "explanation"}
)


# -- reading the log ------------------------------------------------------------------------


def _connect(entry: RunEntry) -> sqlite3.Connection:
    return sqlite3.connect(f"{entry.sqlite.resolve().as_uri()}?mode=ro", uri=True)


def read_typed(catalog: Catalog, entry: RunEntry, types: tuple[str, ...]) -> list[Event]:
    """The events of these types, oldest first. A SQLite log is asked for them; a bundle is
    filtered from the catalog's cache."""
    if entry.sqlite.exists():
        marks = ",".join("?" * len(types))
        query = f"SELECT {COLUMNS} FROM events WHERE type IN ({marks}) ORDER BY seq"
        db = _connect(entry)
        try:
            return [_from_row(row) for row in db.execute(query, types)]
        finally:
            db.close()
    wanted = set(types)
    return [Event.model_validate(e) for e in catalog.read(entry) if e["type"] in wanted]


def read_caused_by(catalog: Catalog, entry: RunEntry, seq: int) -> list[Event]:
    """The events one delivery appended: those whose ``causation_id`` is ``seq``."""
    if entry.sqlite.exists():
        query = f"SELECT {COLUMNS} FROM events WHERE causation_id = ? ORDER BY seq"
        db = _connect(entry)
        try:
            return [_from_row(row) for row in db.execute(query, (seq,))]
        finally:
            db.close()
    return [Event.model_validate(e) for e in catalog.read(entry) if e["causation_id"] == seq]


def read_cassette(path: Path) -> dict[str, dict[str, Any]]:
    """The cassette's entries by effect id, reduced to what the lens shows. A torn last line
    (a run still recording, or one that was killed) is skipped."""
    found: dict[str, dict[str, Any]] = {}
    if not path.is_file():
        return found
    with path.open(encoding="utf-8") as lines:
        for line in lines:
            try:
                data = json.loads(line)
                found[data["effect_id"]] = {
                    "refusal": data.get("refusal"),
                    "attempts": [_attempt(item) for item in data.get("attempts") or []],
                }
            except (ValueError, KeyError, TypeError):
                continue
    return found


def _attempt(item: dict[str, Any]) -> dict[str, Any]:
    headers = {key.lower(): value for key, value in (item.get("headers") or {}).items()}
    retry_after = headers.get("retry-after")
    try:
        retry_after_ms = None if retry_after is None else int(float(retry_after) * 1000)
    except ValueError:
        retry_after_ms = None
    return {
        "status": item.get("status"),
        "latency_ms": item.get("latency_ms", 0),
        "error": item.get("error"),
        "retry_after_ms": retry_after_ms,
    }


# -- small readers --------------------------------------------------------------------------


def badge(model: str | None) -> str:
    """The model badge of the lens: wonder, spark, contributor or other."""
    if not model:
        return "other"
    if model.endswith(CONTRIBUTOR_SUFFIX):
        return "contributor"
    if "wonder" in model:
        return "wonder"
    if "spark" in model:
        return "spark"
    return "other"


def purpose_of(role: str, tag: str | None) -> str:
    if (tag or "").startswith(RECOVERY_TAG_PREFIX):
        return "recovery"
    if (tag or "").startswith("coord:"):
        return "coordination"
    return PURPOSES.get(role, "other")


def is_recovery(call: LLMCall) -> bool:
    return call.role == RECOVERY_ROLE or (call.tag or "").startswith(RECOVERY_TAG_PREFIX)


CONTRACT_HEAD = re.compile(r"^CONTRACT (\S+) \(attempt (\d+)\)\nKind: (\w+)", re.MULTILINE)
AGENT_TAG = re.compile(r"^(c-[0-9a-f]+):(\d+)$")


def call_ref(tag: str | None, prompt_text: str) -> dict[str, Any]:
    """What a call is for, read from its tag and, for an agent turn, its prompt's first line."""
    parts = (tag or "").split("|")
    kind = parts[0]
    if kind == "plan" and len(parts) >= 3:
        return {"kind": "plan", "goal_id": parts[1], "attempt": _int(parts[2])}
    if kind == "judge" and len(parts) >= 4:
        return {
            "kind": "judge",
            "goal_id": parts[1],
            "contract_id": parts[2],
            "attempt": _int(parts[3]),
        }
    agent = AGENT_TAG.match(tag or "")
    head = CONTRACT_HEAD.search(prompt_text[:600])
    if agent and head:
        goal_id, _, contract_id = head.group(1).rpartition("/")
        return {
            "kind": "agent",
            "goal_id": goal_id,
            "contract_id": contract_id,
            "contract_kind": head.group(3),
            "attempt": int(head.group(2)),
            "step": int(agent.group(2)),
        }
    return {"kind": kind or None}


def _int(text: str) -> int | None:
    try:
        return int(text)
    except ValueError:
        return None


def prompt_text(request: dict[str, Any]) -> str:
    """The first user message of a request: the whole input when it is a string."""
    content = request.get("input")
    if isinstance(content, str):
        return content
    if isinstance(content, list) and content:
        first = content[0]
        text = first.get("content") if isinstance(first, dict) else first
        if isinstance(text, str):
            return text
        if isinstance(text, list):
            return "".join(part.get("text", "") for part in text if isinstance(part, dict))
    return ""


def split_prompt(text: str) -> dict[str, Any]:
    """A prompt split into its free text and its DATA and UNTRUSTED blocks (planning/planner.py).
    A block that is not valid JSON is kept as its text."""
    data: dict[str, Any] = {}
    untrusted: dict[str, Any] = {}
    for kind, name, body in BLOCK.findall(text):
        try:
            value = json.loads(body)
        except ValueError:
            value = body
        (data if kind == "DATA" else untrusted)[name] = value
    free = re.sub(r"\n{3,}", "\n\n", BLOCK.sub("", text)).strip()
    return {"text": free, "data": data, "untrusted": untrusted}


def clean_item(item: dict[str, Any]) -> dict[str, Any]:
    """A Responses item without its encrypted reasoning, which only the provider can read."""
    kind = item.get("type") or ("message" if "role" in item else None)
    if kind == "reasoning":
        blob = item.get("encrypted_content")
        summary = [part.get("text", "") for part in item.get("summary") or [] if part]
        return {
            "type": "reasoning",
            "encrypted": blob is not None,
            "chars": len(blob or ""),
            "summary": summary,
        }
    if kind == "function_call":
        return {
            "type": "function_call",
            "name": item.get("name"),
            "call_id": item.get("call_id"),
            "arguments": _loads(item.get("arguments")),
        }
    if kind == "function_call_output":
        return {
            "type": "function_call_output",
            "call_id": item.get("call_id"),
            "output": _loads(item.get("output")),
        }
    if kind == "message":
        return {"type": "message", "role": item.get("role"), "text": _message_text(item)}
    return {"type": kind, **{k: v for k, v in item.items() if k != "encrypted_content"}}


def _message_text(item: dict[str, Any]) -> str:
    content = item.get("content")
    if isinstance(content, str):
        return content
    return "".join(part.get("text", "") for part in content or [] if isinstance(part, dict))


def _loads(text: Any) -> Any:
    if not isinstance(text, str):
        return text
    try:
        return json.loads(text)
    except ValueError:
        return text


def describe(event: Event) -> str:
    """One sentence for an event: what the lens shows next to the call that caused it. An event
    whose payload does not fit (a newer shape than this reader knows) is named by its type."""
    try:
        return _describe(event)
    except (KeyError, TypeError, AttributeError, IndexError):
        return event.type


def _describe(event: Event) -> str:
    p = event.payload
    match event.type:
        case "plan.proposed":
            tracks = len((p.get("plan") or {}).get("tracks") or [])
            how = "a fallback plan" if p.get("fallback") else "a plan"
            return f"{event.actor} proposed {how} for {p['goal_id']} with {tracks} subgoals"
        case "plan.approved":
            return f"the plan for {p['goal_id']} was approved by {p['by']}"
        case "plan.refined":
            return f"{p['owner']} split {p['goal_id']} into {len(p['children'])} parts"
        case "plan.rejected":
            first = (p.get("errors") or ["no reason"])[0]
            return f"the plan for {p['goal_id']} was rejected (attempt {p['attempt']}): {first}"
        case "ownership.assigned":
            return f"{p['owner']} now owns {p['key']} (group {p['group']})"
        case "contract.created":
            contract = p.get("contract") or {}
            return f"contract {contract.get('id')} ({contract.get('kind')}) was created"
        case "contract.dispatched":
            return f"{p['contract_id']} was dispatched to {p['assignee']} (attempt {p['attempt']})"
        case "contract.completed":
            return f"{p['agent']} finished {p['contract_id']}: {p['status']}"
        case "contract.verified":
            return f"{p['contract_id']} was verified (attempt {p['attempt']})"
        case "contract.rejected":
            why = "; ".join(p.get("reasons") or [])
            return f"{p['contract_id']} was rejected at {p['stage']}: {why}"
        case "contract.failed":
            return f"{p['contract_id']} failed: {'; '.join(p.get('reasons') or [])}"
        case "verify.judged":
            first = (p.get("reasons") or [""])[0]
            return (
                f"the judge said {p['verdict']} to {p['contract_id']} (score {p['score']}): {first}"
            )
        case "fact.published":
            return f"fact {p['key']} was published as {p['status']}"
        case "collision.detected":
            return f"a {p['kind']} collision was detected for {p['goal_id']} ({p['holder']})"
        case "collision.resolved":
            return f"the {p['kind']} collision for {p['goal_id']} was resolved: {p['resolution']}"
        case "goal.completed":
            return f"{p['goal_id']} completed: {p['status']}"
        case "budget.settled":
            return f"settled ${p['actual_usd']:.4f} of ${p['reserved_usd']:.4f} reserved"
        case "msg.sent":
            return _describe_message(event)
    return event.type


def _describe_message(event: Event) -> str:
    to, topic, body = event.payload["to"], event.payload["topic"], event.payload["body"]
    if topic == "tool":
        return f"{event.actor} called {body.get('name')} on {to}"
    if topic == "contract":
        return f"{event.actor} sent a contract to {to}"
    if topic == "contract.result":
        return f"{event.actor} reported {body.get('status')} for {body.get('contract_id')} to {to}"
    if topic == "book":
        return f"{event.actor} asked {to} to book {len(body.get('writes') or [])} cells"
    if topic == "assign":
        return f"{event.actor} assigned a goal to {to}"
    return f"{event.actor} sent {topic} to {to}"


def rationale(value: Any, path: str = "", depth: int = 0) -> list[dict[str, str]]:
    """The model's own reasons in a structured answer: the strings under reason-like fields."""
    found: list[dict[str, str]] = []
    if depth > 4:
        return found
    if isinstance(value, dict):
        for key in sorted(value):
            where = f"{path}.{key}" if path else key
            item = value[key]
            if key in RATIONALE_KEYS:
                if isinstance(item, str) and item.strip():
                    found.append({"field": where, "text": item})
                elif isinstance(item, list):
                    found += [
                        {"field": f"{where}[{index}]", "text": text}
                        for index, text in enumerate(item)
                        if isinstance(text, str) and text.strip()
                    ]
            elif isinstance(item, dict | list):
                found += rationale(item, where, depth + 1)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found += rationale(item, f"{path}[{index}]", depth + 1)
    return found


# -- source sentences of the extracted facts ------------------------------------------------

SENTENCE = re.compile(r"[^\n]+?(?:[.!?]+(?=\s|$)|$)", re.MULTILINE)
ANY_TIME = re.compile(
    r"\b(any (?:slot|time|day)|either day|both days|fully open|completely open|flexible|"
    r"no (?:constraints?|restrictions?)|whenever|all day)\b"
)
LIMITS = (
    re.compile(r"\bonly\b"),
    re.compile(r"\b(?:can'?t|cannot|can not|unable|unavailable|not available|not able)\b"),
    re.compile(r"\b(?:nothing before|not before|no earlier|before \d|after \d|by \d|until)\b"),
    re.compile(r"\b(?:leave|leaving|gone|depart\w*|late|early|arriv\w*|flight|train)\b"),
    re.compile(r"\b(?:mornings?|afternoons?)\b"),
    re.compile(r"\d{1,2}:\d\d"),
)
PREFERENCE_CUES = {
    "morning": (re.compile(r"\bmornings?\b"),),
    "afternoon": (re.compile(r"\bafternoons?\b"),),
    "none": (
        re.compile(r"\bno (?:particular |strong )?preference\b"),
        re.compile(r"\b(?:don'?t mind|doesn'?t matter|any time|flexible|otherwise)\b"),
    ),
}
ATTENDANCE_CUES = re.compile(
    r"\b(?:people|attendees|participants|audience|attend\w*|crowd|drew|draw|expect\w*)\b"
)


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """The (start, end) offsets of the sentences of a text; a line break ends a sentence too."""
    spans = []
    for match in SENTENCE.finditer(text):
        raw = match.group()
        stripped = raw.strip()
        if stripped:
            start = match.start() + len(raw) - len(raw.lstrip())
            spans.append((start, start + len(stripped)))
    return spans


def utf16_offset(text: str, index: int) -> int:
    """A code-point offset as UTF-16 units, which is what a browser's ``slice`` counts: the UI
    highlights ``text.slice(start, end)``, and an emoji before the sentence would shift it."""
    return len(text[:index].encode("utf-16-le", "surrogatepass")) // 2


def best_sentence(text: str, cues: Cues) -> tuple[int, int, int] | None:
    """The sentence the cues fit best as (start, end, score); the first one wins a tie."""
    best: tuple[int, int, int] | None = None
    for start, end in sentence_spans(text):
        low = text[start:end].lower()
        score = sum(weight for pattern, weight in cues if pattern.search(low))
        if score > 0 and (best is None or score > best[2]):
            best = (start, end, score)
    return best


def _restricted_days(value: dict[str, Any], days: list[Any], slot_count: int) -> list[int]:
    """The days on which a speaker is not free all day, from an availability value. A day
    with no entry is not free; with the slot count unknown, any slot on a day counts as free."""
    free = {
        entry.get("day"): len(entry.get("slots") or [])
        for entry in value.get("available") or []
        if isinstance(entry, dict)
    }
    return [
        day
        for day in days
        if isinstance(day, int) and (free.get(day, 0) == 0 or free[day] < slot_count)
    ]


def availability_reading(value: dict[str, Any], slots: list[Any], days: list[Any]) -> str:
    """An availability value in words: each day's clock times, and the time preference."""
    by_index = {
        slot.get("index"): slot for slot in slots if isinstance(slot, dict) and "index" in slot
    }
    free = {
        entry.get("day"): sorted(entry.get("slots") or [])
        for entry in value.get("available") or []
        if isinstance(entry, dict)
    }
    parts = []
    for day in sorted(d for d in {*days, *free} if isinstance(d, int)):
        indices = free.get(day, [])
        if not indices:
            when = "not free"
        elif by_index and len(indices) == len(by_index):
            when = "all day"
        else:
            when = ", ".join(_ranges(indices, by_index))
        parts.append(f"day {day}: {when}")
    preference = value.get("preference")
    parts.append("no time preference" if preference in (None, "none") else f"prefers {preference}")
    return "; ".join(parts)


def _ranges(indices: list[int], by_index: dict[int, dict[str, Any]]) -> list[str]:
    runs: list[list[int]] = []
    for index in indices:
        if runs and index == runs[-1][-1] + 1:
            runs[-1].append(index)
        else:
            runs.append([index])
    if not by_index:
        return [f"slots {run[0]}-{run[-1]}" if len(run) > 1 else f"slot {run[0]}" for run in runs]
    return [
        f"{by_index.get(run[0], {}).get('start', run[0])}-"
        f"{by_index.get(run[-1], {}).get('end', run[-1])}"
        for run in runs
    ]


class Facts:
    """The facts of one extraction call, each next to the sentences of its source."""

    def __init__(self, prompt: dict[str, Any], output: dict[str, Any]) -> None:
        untrusted, data = prompt["untrusted"], prompt["data"]
        self.days = data.get("days") if isinstance(data.get("days"), list) else []
        self.slots = data.get("slots") if isinstance(data.get("slots"), list) else []
        self.emails = {
            item["id"]: item
            for item in untrusted.get("emails") or []
            if isinstance(item, dict) and "id" in item
        }
        self.abstracts = {
            item["id"]: item
            for item in untrusted.get("abstracts") or []
            if isinstance(item, dict) and "id" in item
        }
        self.output = output
        self.sources: dict[str, dict[str, Any]] = {}

    def build(self) -> list[dict[str, Any]]:
        facts = [self._fact(*published) for published in self._published()]
        return facts or [self._fact(*row) for row in self._answered()]

    def _published(self) -> list[tuple[str, str, Any, list[str], str, bool]]:
        rows = []
        for call in self.output.get("tool_calls") or []:
            args = call.get("arguments")
            if call.get("name") != "memory.publish_fact" or not isinstance(args, dict):
                continue
            value = _loads(args.get("value_json"))
            sources = [s for s in args.get("sources") or [] if isinstance(s, str)]
            rows.append(
                (args.get("key", ""), args.get("subject", ""), value, sources, "publish", False)
            )
        return rows

    def _answered(self) -> list[tuple[str, str, Any, list[str], str, bool]]:
        answer = self.output.get("parsed")
        if not isinstance(answer, dict):
            return []
        reused = set(answer.get("reused_fact_keys") or [])
        rows = []
        for item in answer.get("speakers") or []:
            if isinstance(item, dict) and "speaker_id" in item:
                key = f"speaker:{item['speaker_id']}:availability"
                value = {k: v for k, v in item.items() if k != "speaker_id"}
                rows.append((key, item["speaker_id"], value, [], "answer", key in reused))
        for item in answer.get("talks") or []:
            if isinstance(item, dict) and "talk_id" in item:
                key = f"talk:{item['talk_id']}:attendance"
                value = {k: v for k, v in item.items() if k != "talk_id"}
                rows.append((key, item["talk_id"], value, [], "answer", key in reused))
        return rows

    def _fact(
        self, key: str, subject: str, value: Any, sources: list[str], via: str, reused: bool
    ) -> dict[str, Any]:
        _, _, tail = key.rpartition(":")
        kind = tail if tail in ("availability", "attendance") else "other"
        source = self._source(key, subject, sources)
        evidence: list[dict[str, Any]] = []
        missing: list[str] = []
        # A reused fact was read from the board, not from this call's sources.
        if source is not None and isinstance(value, dict) and not reused:
            fields = {"availability": self._availability_cues, "attendance": self._attendance_cues}
            for name, cues in (fields[kind](value) if kind in fields else {}).items():
                found = best_sentence(source["text"], cues)
                if found is None:
                    missing.append(name)
                    continue
                text = source["text"]
                start, end, score = found
                evidence.append(
                    {
                        "field": name,
                        "source_id": source["id"],
                        "start": utf16_offset(text, start),
                        "end": utf16_offset(text, end),
                        "text": text[start:end],
                        "score": score,
                    }
                )
        return {
            "key": key,
            "kind": kind,
            "subject": subject,
            "value": value,
            "reading": self._reading(kind, value),
            "via": via,
            "reused": reused,
            "sources": [source["id"]] if source else sources,
            "evidence": evidence,
            "unmatched": missing,
        }

    def _reading(self, kind: str, value: Any) -> str | None:
        if not isinstance(value, dict):
            return None
        if kind == "availability":
            return availability_reading(value, self.slots, self.days)
        if kind == "attendance" and "expected_attendance" in value:
            return f"about {value['expected_attendance']} attendees"
        return None

    def _source(self, key: str, subject: str, sources: list[str]) -> dict[str, Any] | None:
        """The email or abstract a fact came from: the ids it names, else its own subject's."""
        candidates = [*sources, subject, key.split(":")[1] if ":" in key else ""]
        for candidate in candidates:
            if candidate in self.emails:
                email = self.emails[candidate]
                return self._keep(candidate, "email", email.get("body", ""), email)
            if candidate in self.abstracts:
                talk = self.abstracts[candidate]
                return self._keep(candidate, "abstract", talk.get("abstract", ""), talk)
        for email in self.emails.values():
            if email.get("speaker_id") == subject:
                return self._keep(email["id"], "email", email.get("body", ""), email)
        return None

    def _keep(self, source_id: str, kind: str, text: str, item: dict[str, Any]) -> dict[str, Any]:
        info = {"id": source_id, "kind": kind, "text": text}
        for name in ("speaker_id", "from", "subject", "title"):
            if name in item:
                info[name] = item[name]
        self.sources[source_id] = info
        return info

    def _availability_cues(self, value: dict[str, Any]) -> dict[str, Cues]:
        restricted = _restricted_days(value, self.days, len(self.slots))
        cues: Cues = []
        if self.days and not restricted:
            cues.append((ANY_TIME, 2))
        else:
            cues += [(re.compile(rf"\bday {day}\b"), 3) for day in restricted]
            cues += [(pattern, 1) for pattern in LIMITS]
        fields: dict[str, Cues] = {"available": cues}
        preference = value.get("preference")
        if preference in PREFERENCE_CUES:
            fields["preference"] = [(pattern, 3) for pattern in PREFERENCE_CUES[preference]]
        return fields

    @staticmethod
    def _attendance_cues(value: dict[str, Any]) -> dict[str, Cues]:
        number = value.get("expected_attendance")
        cues: Cues = [(ATTENDANCE_CUES, 1)]
        if isinstance(number, int) and not isinstance(number, bool):
            cues.append((re.compile(rf"(?<![\d.,]){number}(?![\d]|[.,]\d)"), 4))
        return {"expected_attendance": cues}


# -- one run, indexed -----------------------------------------------------------------------


@dataclass
class RunLens:
    catalog: Catalog
    entry: RunEntry
    events: list[Event]
    calls: list[LLMCall]
    client: LLMClient | None
    started: dict[str, Event] = field(default_factory=dict)
    completed: dict[str, Event] = field(default_factory=dict)
    cancelled: dict[str, Event] = field(default_factory=dict)
    reissued: dict[str, Event] = field(default_factory=dict)
    routed: dict[str, Event] = field(default_factory=dict)
    refused: list[Event] = field(default_factory=list)
    reactions: dict[tuple[int | None, str], list[Event]] = field(default_factory=dict)
    halted: Event | None = None
    _rows: list[dict[str, Any]] | None = None
    _cassette: dict[str, dict[str, Any]] | None = None

    @classmethod
    def build(cls, catalog: Catalog, entry: RunEntry) -> "RunLens":
        events = read_typed(catalog, entry, INDEX_TYPES)
        first = next((e for e in events if e.type == "run.started"), None)
        snapshot = ((first.payload.get("config") or {}) if first else {}).get("llm")
        client = None
        if snapshot:
            roles, prices = LLMClient.config_from_snapshot(snapshot)
            client = LLMClient(None, roles=roles, prices=prices, mode="live")  # type: ignore[arg-type]
        lens = cls(catalog, entry, events, llm_calls(events), client)
        reactions: dict[tuple[int | None, str], list[Event]] = defaultdict(list)
        for event in events:
            llm = event.payload.get("kind") == "llm"
            if event.type == "effect.started" and llm:
                lens.started[event.payload["effect_id"]] = event
            elif event.type == "effect.completed" and llm:
                lens.completed[event.payload["effect_id"]] = event
            elif event.type == "effect.cancelled" and llm:
                lens.cancelled[event.payload["effect_id"]] = event
            elif event.type == "effect.reissued" and llm:
                lens.reissued[event.payload["effect_id"]] = event
            elif event.type == "security.routed":
                lens.routed[event.payload["request_id"]] = event
            elif event.type == "budget.refused":
                lens.refused.append(event)
            elif event.type == "run.halted":
                lens.halted = event
            reactions[(event.causation_id, event.actor)].append(event)
        lens.reactions = dict(reactions)
        return lens

    # -- rows ---------------------------------------------------------------------------

    @property
    def rows(self) -> list[dict[str, Any]]:
        if self._rows is None:
            self._rows = [self._row(call) for call in self.calls]
        return self._rows

    def _resolve(self, request: dict[str, Any]) -> tuple[str | None, str | None, int | None]:
        """(model, effort, max output tokens) as ``LLMClient.build`` makes them from the
        role table in the ``run.started`` snapshot, as the bench scoring does."""
        if self.client is not None:
            try:
                model, body, max_output = self.client.build(LLMRequest.model_validate(request))
                return model, body["reasoning"]["effort"], max_output
            except (ValueError, KeyError):  # a log whose role table or request no longer fits
                pass
        return None, None, None

    def _row(self, call: LLMCall) -> dict[str, Any]:
        started = self.started[call.effect_id]
        request = started.payload["request"]
        completion = self.completed.get(call.effect_id)
        result = completion.payload["result"] if completion else {}
        model, effort, max_output = self._resolve(request)
        model = model or result.get("model")
        reported = {} if call.estimated else result.get("usage") or {}
        usage = {name: int(reported.get(name) or 0) for name in USAGE_KEYS}
        if call.estimated:  # cut off before it completed: the bench's estimate of what was billed
            usage |= {"input_tokens": call.input_tokens, "output_tokens": call.output_tokens}
        routed = self.routed.get(call.effect_id)
        ended = None if call.status == "inflight" else call.end
        return {
            "effect_id": call.effect_id,
            "seq": started.seq,
            "actor": call.actor,
            "tag": call.tag,
            "ref": call_ref(call.tag, prompt_text(request)),
            "role": call.role,
            "purpose": purpose_of(call.role, call.tag),
            "level": request.get("level", "L0"),
            "model": model,
            "badge": badge(model),
            "effort": effort,
            "max_output_tokens": max_output,
            "routing": None
            if routed is None
            else {k: v for k, v in routed.payload.items() if k != "request_id"},
            "status": call.status,
            "usage": usage,
            "cost_usd": call.cost_usd,
            "estimated": call.estimated,
            "latency_ms": result.get("latency_ms"),
            "attempts": result.get("attempts"),
            "http_status": result.get("http_status"),
            "started_ts": started.ts_virtual,
            "ended_ts": ended,
            "elapsed_ms": None if ended is None else ended - started.ts_virtual,
            "error": (result.get("error") or result.get("reason")) if call.status != "ok" else None,
            "incomplete_reason": result.get("incomplete_reason"),
            "reissued": self._reissued(call.effect_id),
            "cancel": self._cancel(call),
        }

    def _reissued(self, effect_id: str) -> dict[str, Any] | None:
        event = self.reissued.get(effect_id)
        if event is None:
            return None
        return {"ambiguous": event.payload["ambiguous"], "reason": event.payload.get("reason", "")}

    def _cancel(self, call: LLMCall) -> dict[str, Any] | None:
        """Why a call never completed: the kill switch, a stopped actor or a crashed coordinator,
        read from the events its cancellation shares a reaction with."""
        event = self.cancelled.get(call.effect_id)
        if event is None:
            return None
        owner = call.actor
        base = {"seq": event.seq, "ts_virtual": event.ts_virtual, "by": event.actor}
        if self.halted is not None and event.causation_id == self.halted.seq:
            reason = self.halted.payload.get("reason", "")
            return base | {
                "kind": "halted",
                "reason": reason,
                "detail": f"the run was halted: {reason}",
            }
        siblings = self.reactions.get((event.causation_id, event.actor), [])
        stop = next(
            (
                e
                for e in siblings
                if e.type == "actor.stopped"
                and e.payload["actor_id"] == owner
                and e.seq > event.seq
            ),
            None,
        )
        fault = next(
            (
                e
                for e in siblings
                if e.type == "chaos.injected" and e.payload.get("target") == owner
            ),
            None,
        )
        crash = next(
            (
                e
                for e in siblings
                if e.type == "baseline.crashed" and e.payload.get("coordinator") == owner
            ),
            None,
        )
        if stop is not None:
            reason = stop.payload.get("reason", "")
            if fault is not None:
                detail = f"{owner} was killed by chaos ({fault.payload.get('fault')})"
            elif reason == "crash":
                detail = f"{owner} was stopped when its coordinator crashed"
            else:
                detail = f"{owner} was stopped ({reason})"
            return base | {
                "kind": "actor_stopped",
                "reason": reason,
                "fault": fault.payload.get("fault") if fault else None,
                "detail": detail,
            }
        if crash is not None:
            return base | {
                "kind": "coordinator_crash",
                "reason": "crash",
                "detail": f"{owner} crashed and lost this call in flight",
            }
        return base | {"kind": "cancelled", "reason": "", "detail": f"cancelled by {event.actor}"}

    def refused_calls(self) -> list[dict[str, Any]]:
        """Calls the budget refused before they started: they have no prompt in the log."""
        refused = []
        for event in self.refused:
            effect_id = event.payload["effect_id"]
            done = self.completed.get(effect_id)
            refused.append(
                {
                    "effect_id": effect_id,
                    "actor": event.actor,
                    "tag": done.payload.get("tag") if done else None,
                    "level": event.payload["level"],
                    "key": event.payload["key"],
                    "worst_case_usd": event.payload["usd"],
                    "ts_virtual": event.ts_virtual,
                }
            )
        return refused

    # -- the models meter -----------------------------------------------------------------

    def models(self) -> dict[str, Any]:
        rows = self.rows
        done = [row for row in rows if row["status"] in ("ok", "incomplete")]
        totals = _sum_usage(rows)
        settled = _sum_usage(done)
        coordination = sum(
            c.input_tokens + c.output_tokens for c in self.calls if is_coordination(c)
        )
        recovery = sum(c.input_tokens + c.output_tokens for c in self.calls if is_recovery(c))
        saved = 0.0
        if self.client is not None:
            for row in done:
                try:
                    price = self.client.prices.price(row["model"])
                except ValueError:
                    continue
                gain = price.input - price.cached_input
                saved += row["usage"]["cached_tokens"] * gain / self.client.prices.unit_tokens
        cancelled = [r for r in rows if r["status"] in ("cancelled", "inflight")]
        return {
            "run_id": self.entry.id,
            "totals": {
                "calls": len(rows),
                "completed": len(done),
                "cancelled": sum(1 for r in rows if r["status"] == "cancelled"),
                "errors": sum(1 for r in rows if r["status"] == "error"),
                "cost_usd": totals["cost_usd"],
                "settled_cost_usd": settled["cost_usd"],
                "estimated_cost_usd": sum(r["cost_usd"] for r in rows if r["estimated"]),
                "input_tokens": totals["input_tokens"],
                "cached_tokens": settled["cached_tokens"],
                "output_tokens": totals["output_tokens"],
                "reasoning_tokens": settled["reasoning_tokens"],
                "cache_hit_share": _share(settled["cached_tokens"], settled["input_tokens"]),
                "cache_saved_usd": saved,
                "coordination_tokens": coordination,
                "recovery_tokens": recovery,
                "lost_to_cancellation": {
                    "calls": len(cancelled),
                    "cost_usd": sum(r["cost_usd"] for r in cancelled),
                    "tokens": sum(
                        r["usage"]["input_tokens"] + r["usage"]["output_tokens"] for r in cancelled
                    ),
                },
            },
            "models": _grouped(rows, "model"),
            "by_role": _grouped(rows, "role"),
            "definitions": {
                "coordination_tokens": "input and output tokens of calls whose role is "
                "coordinator, supervisor, router or recovery, or whose tag starts with coord:",
                "recovery_tokens": "input and output tokens of calls whose role is recovery or "
                "whose tag starts with recovery:",
                "cache_hit_share": "cached input tokens over input tokens, of completed calls",
                "estimated": "a call cut off before it completed is billed the bench estimate",
            },
        }

    # -- one call -------------------------------------------------------------------------

    def cassette(self) -> dict[str, dict[str, Any]]:
        if self._cassette is None:
            self._cassette = read_cassette(self.entry.path / "cassette.jsonl")
        return self._cassette

    def detail(self, effect_id: str) -> dict[str, Any] | None:
        call = next((c for c in self.calls if c.effect_id == effect_id), None)
        if call is None:
            return None
        row = next(r for r in self.rows if r["effect_id"] == effect_id)
        started = self.started[effect_id]
        completion = self.completed.get(effect_id)
        request = started.payload["request"]
        result = completion.payload["result"] if completion else {}
        prompt = self._prompt(request)
        output = self._output(result)
        cassette = self.cassette().get(effect_id)
        detail = row | {
            "request_extras": {
                key: request[key]
                for key in ("contributor", "keep_reasoning", "prompt_cache_key", "max_tool_calls")
                if key in request
            },
            "reported_model": result.get("model"),
            "response_id": result.get("response_id"),
            "rate_limits": result.get("rate_limits"),
            "cost_breakdown": self._cost_breakdown(row),
            "attempt_log": None if cassette is None else cassette["attempts"],
            "refusal": None if cassette is None else cassette["refusal"],
            "prompt": prompt,
            "output": output,
            "decision": self._decision(completion, output),
            "facts": None,
            "sources": None,
        }
        if row["ref"].get("contract_kind") == "extract" and (
            prompt["untrusted"].get("emails") or prompt["untrusted"].get("abstracts")
        ):
            facts = Facts(prompt, output)
            detail["facts"] = facts.build()
            detail["sources"] = facts.sources
        return detail

    @staticmethod
    def _prompt(request: dict[str, Any]) -> dict[str, Any]:
        content = request.get("input")
        split = split_prompt(prompt_text(request))
        turns = []
        if isinstance(content, list):
            turns = [clean_item(item) for item in content[1:] if isinstance(item, dict)]
        return {
            "instructions": request.get("instructions"),
            **split,
            "turns": turns,
            "chars": len(json.dumps(content, ensure_ascii=False)) if content is not None else 0,
            "tools": [tool.get("name") for tool in request.get("tools") or []],
            "schema": ((request.get("text_format") or {}).get("name")),
        }

    @staticmethod
    def _output(result: dict[str, Any]) -> dict[str, Any]:
        items = [clean_item(item) for item in result.get("output") or []]
        text = result.get("output_text") or ""
        parsed = None
        if text.strip().startswith(("{", "[")):
            parsed = _loads(text)
            parsed = None if isinstance(parsed, str) else parsed
        return {
            "text": text,
            "parsed": parsed,
            "tool_calls": [item for item in items if item["type"] == "function_call"],
            "items": items,
        }

    def _cost_breakdown(self, row: dict[str, Any]) -> dict[str, float] | None:
        if self.client is None or row["estimated"] or row["status"] not in ("ok", "incomplete"):
            return None
        try:
            price = self.client.prices.price(row["model"])
        except ValueError:
            return None
        unit = self.client.prices.unit_tokens
        usage = row["usage"]
        uncached = max(usage["input_tokens"] - usage["cached_tokens"], 0)
        return {
            "input_usd": uncached * price.input / unit,
            "cached_input_usd": usage["cached_tokens"] * price.cached_input / unit,
            "output_usd": usage["output_tokens"] * price.output / unit,
            "reasoning_usd": usage["reasoning_tokens"] * price.output / unit,
            "search_usd": usage["searches"] * self.client.prices.web_search_usd_per_1k / 1000,
        }

    def _decision(self, completion: Event | None, output: dict[str, Any]) -> dict[str, Any]:
        """What the call caused: the events appended in the reaction to its completion, and the
        model's own reasons in words."""
        if completion is None:
            return {"events": [], "sentences": []}
        events = []
        for event in read_caused_by(self.catalog, self.entry, completion.seq):
            payload = event.payload
            small = len(json.dumps(payload, ensure_ascii=False)) <= MAX_PAYLOAD_CHARS
            events.append(
                {
                    "seq": event.seq,
                    "type": event.type,
                    "actor": event.actor,
                    "ts_virtual": event.ts_virtual,
                    "summary": describe(event),
                    "bookkeeping": event.type == "budget.settled",
                    "payload": payload if small else None,
                    "payload_truncated": not small,
                }
            )
        sentences = rationale(output["parsed"])
        if output["tool_calls"]:
            sentences += [
                {"field": "message", "text": item["text"]}
                for item in output["items"]
                if item["type"] == "message" and item.get("text")
            ]
        return {"events": events, "sentences": sentences}


def _sum_usage(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = {"cost_usd": 0.0, "input_tokens": 0, "cached_tokens": 0}
    total |= {"output_tokens": 0, "reasoning_tokens": 0}
    for row in rows:
        total["cost_usd"] += row["cost_usd"]
        for name in ("input_tokens", "cached_tokens", "output_tokens", "reasoning_tokens"):
            total[name] += row["usage"][name]
    return total


def _share(part: int, whole: int) -> float | None:
    return part / whole if whole > 0 else None


def _grouped(rows: list[dict[str, Any]], by: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[str(row[by])].append(row)
    grand_cost = sum(row["cost_usd"] for row in rows)
    grand_tokens = sum(r["usage"]["input_tokens"] + r["usage"]["output_tokens"] for r in rows)
    out = []
    for name in sorted(groups):
        members = groups[name]
        done = [r for r in members if r["status"] in ("ok", "incomplete")]
        total, settled = _sum_usage(members), _sum_usage(done)
        tokens = total["input_tokens"] + total["output_tokens"]
        item = {
            by: name,
            "calls": len(members),
            "completed": len(done),
            "cost_usd": total["cost_usd"],
            "input_tokens": total["input_tokens"],
            "cached_tokens": settled["cached_tokens"],
            "output_tokens": total["output_tokens"],
            "reasoning_tokens": settled["reasoning_tokens"],
            "cache_hit_share": _share(settled["cached_tokens"], settled["input_tokens"]),
            "share_of_cost": _share(total["cost_usd"], grand_cost) if grand_cost > 0 else None,
            "share_of_tokens": _share(tokens, grand_tokens),
            "efforts": _count(members, "effort"),
        }
        if by == "model":
            item["badge"] = badge(name)
            item["roles"] = _count(members, "role")
        else:
            item["purpose"] = members[0]["purpose"]
            item["models"] = _count(members, "model")
        out.append(item)
    out.sort(key=lambda item: (-item["cost_usd"], item[by]))
    return out


def _count(rows: list[dict[str, Any]], name: str) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[str(row[name])] += 1
    return dict(sorted(counts.items()))


# -- the routes -----------------------------------------------------------------------------


def lens_routes(catalog: Catalog) -> list[Route]:
    """The lens routes, for ``api/app.py`` to include. Each run's index is cached until its log
    grows (a run that is still recording is read again)."""
    cache: dict[str, tuple[tuple[int, str], RunLens]] = {}

    async def lens_of(request: Request) -> RunLens:
        run_id = request.path_params["run_id"]
        try:
            entry = catalog.get(run_id)
        except KeyError:
            raise HTTPException(404, f"no run {run_id!r}") from None
        last = catalog.last(entry)
        key = (last["seq"], last["hash"]) if last else (0, "")
        cached = cache.get(entry.id)
        if cached is not None and cached[0] == key:
            return cached[1]
        lens = await anyio.to_thread.run_sync(RunLens.build, catalog, entry)
        cache[entry.id] = (key, lens)
        while len(cache) > MAX_CACHED_RUNS:
            cache.pop(next(iter(cache)))
        return lens

    async def calls(request: Request) -> JSONResponse:
        lens = await lens_of(request)
        wanted = {
            name: request.query_params[name]
            for name in ("role", "status", "actor", "model", "purpose")
            if name in request.query_params
        }
        rows = [row for row in lens.rows if all(row[k] == v for k, v in wanted.items())]
        return JSONResponse(
            {
                "run_id": lens.entry.id,
                "count": len(rows),
                "calls": rows,
                "refused": lens.refused_calls(),
            }
        )

    async def call(request: Request) -> JSONResponse:
        lens = await lens_of(request)
        effect_id = request.path_params["effect_id"]
        detail = await anyio.to_thread.run_sync(lens.detail, effect_id)
        if detail is None:
            raise HTTPException(404, f"no LLM call {effect_id!r} in run {lens.entry.id!r}")
        return JSONResponse(detail)

    async def models(request: Request) -> JSONResponse:
        return JSONResponse((await lens_of(request)).models())

    return [
        Route("/api/runs/{run_id}/calls", calls),
        Route("/api/runs/{run_id}/calls/{effect_id}", call),
        Route("/api/runs/{run_id}/models", models),
    ]
