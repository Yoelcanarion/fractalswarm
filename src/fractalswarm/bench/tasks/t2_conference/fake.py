"""A scripted fake of the model for T2: it reads the request and answers what the role asks.

It plays every role of the slice from the request alone (never from the ground truth):
- it recognizes the role by the structured-output schema name (``text.format.name``);
- it reads the prompt's ``<<<DATA>>>`` and ``<<<UNTRUSTED>>>`` blocks;
- for agents, it walks the tool loop from the items the request carries (its earlier
  function calls and their outputs), like a real model replaying a stateless conversation.

It parses the messy abstracts and emails with the phrasings the generator uses, and places
talks with a small deterministic constraint solver. Swapping it for the real model changes
no code: the actors only see Responses-shaped replies.
"""

import json
import re
from collections.abc import Iterable
from typing import Any

from fractalswarm.bench.tasks.t2_conference.task import normalize_track
from fractalswarm.llm.fake import FakeReply
from fractalswarm.planning.planner import read_blocks

ATTENDANCE = re.compile(r"(?:around|roughly|about)\s+(\d+)\s+(?:attendees|people|participants)")


def t2_script(body: dict[str, Any], attempt: int) -> FakeReply | str:
    name = ((body.get("text") or {}).get("format") or {}).get("name", "")
    handler = HANDLERS.get(name)
    if handler is None:
        return f"[fake] no script for {name or 'plain text'}"
    return handler(body)


# -- request reading ----------------------------------------------------------------------


def _prompt(body: dict[str, Any]) -> str:
    content = body["input"]
    if isinstance(content, str):
        return content
    first = content[0]["content"]
    return first if isinstance(first, str) else "".join(part.get("text", "") for part in first)


def _turns(body: dict[str, Any]) -> list[list[tuple[str, dict[str, Any], Any]]]:
    """The tool turns so far: per turn, (tool name, arguments, output) for each call."""
    content = body["input"]
    if isinstance(content, str):
        return []
    calls = {item["call_id"]: item for item in content if item.get("type") == "function_call"}
    turns: list[list[tuple[str, dict[str, Any], Any]]] = []
    current: list[tuple[str, dict[str, Any], Any]] = []
    previous = None
    for item in content:
        kind = item.get("type")
        if kind == "function_call_output":
            call = calls[item["call_id"]]
            current.append((call["name"], json.loads(call["arguments"]), json.loads(item["output"])))
        elif kind == "function_call" and previous == "function_call_output" and current:
            turns.append(current)
            current = []
        previous = kind or previous
    if current:
        turns.append(current)
    return turns


def _call(name: str, **arguments: Any) -> dict[str, str]:
    return {"name": name, "arguments": json.dumps(arguments, sort_keys=True)}


def _answer(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True)


# -- reading the messy inputs (what an LLM does with the text) ----------------------------


def _minutes(clock: str) -> int:
    hours, minutes = map(int, clock.split(":"))
    return hours * 60 + minutes


def parse_email(text: str, days: list[int], slots: list[dict[str, Any]]):
    """(day -> available slot indices, preference) from an email's free text."""
    every = [slot["index"] for slot in slots]
    start = {slot["index"]: _minutes(slot["start"]) for slot in slots}
    end = {slot["index"]: _minutes(slot["end"]) for slot in slots}
    available = {day: list(every) for day in days}
    low = text.lower()
    if match := re.search(r"only (?:attend|be around) on day (\d)", low):
        only = int(match.group(1))
        available = {day: (list(every) if day == only else []) for day in days}
    elif "so afternoons only" in low or "only do afternoons" in low:
        available = {day: [s for s in every if start[s] >= _minutes("14:00")] for day in days}
    elif "so mornings only" in low or "only do mornings" in low:
        available = {day: [s for s in every if start[s] < _minutes("12:30")] for day in days}
    elif match := re.search(r"day (\d) i can't make it before (\d\d:\d\d)", low) or re.search(
        r"late on day (\d), so nothing before (\d\d:\d\d)", low
    ):
        day, limit = int(match.group(1)), _minutes(match.group(2))
        available[day] = [s for s in every if start[s] >= limit]
    elif match := re.search(r"day (\d) i have to leave by (\d\d:\d\d)", low):
        day, limit = int(match.group(1)), _minutes(match.group(2))
        available[day] = [s for s in every if end[s] <= limit]
    elif match := re.search(r"gone by (\d\d:\d\d) on day (\d)", low):
        day, limit = int(match.group(2)), _minutes(match.group(1))
        available[day] = [s for s in every if end[s] <= limit]
    preference = "none"
    if "morning slot" in low:
        preference = "morning"
    elif "afternoon slot" in low or "in the afternoon" in low:
        preference = "afternoon"
    return available, preference


def parse_attendance(abstract: str) -> int:
    match = ATTENDANCE.search(abstract)
    return int(match.group(1)) if match else 50


# -- planning roles -----------------------------------------------------------------------


def root_plan(body: dict[str, Any]) -> str:
    blocks = read_blocks(_prompt(body))
    conference, submissions = blocks["conference"], blocks["submissions"]
    tracks = conference["tracks"]
    by_track: dict[str, list[str]] = {track["id"]: [] for track in tracks}
    for talk in submissions:
        track = normalize_track(talk["track_label"], tracks) or tracks[0]["id"]
        by_track[track].append(talk["id"])
    rooms = sorted(conference["rooms"], key=lambda room: (-room["capacity"], room["id"]))
    homes = rooms[1:] or rooms
    plan = {
        "tracks": [
            {
                "track_id": track["id"],
                "talk_ids": sorted(by_track[track["id"]]),
                "home_room": homes[i % len(homes)]["id"],
                "priority": 1,
                "risk": 0.3,
                "acceptance": "every talk placed once with 0 hard-constraint violations",
            }
            for i, track in enumerate(tracks)
        ],
        "feasibility": f"{len(submissions)} talks over {len(conference['days'])} days and "
        f"{len(rooms)} rooms; {rooms[0]['id']} stays shared for big talks.",
        "limitations": ["availability comes from free-text emails and may be misread"],
    }
    return _answer(plan)


def _speaker_days(blocks: dict[str, Any]) -> dict[str, dict[int, list[int]]]:
    days, slots = blocks["days"], blocks["slots"]
    return {
        email["speaker_id"]: parse_email(email["body"], days, slots)[0]
        for email in blocks["emails"]
    }


def _matching(talks: list[str], options: dict[str, list[int]]) -> bool:
    """Whether every talk can get a distinct slot among its options (Kuhn's algorithm)."""
    owner: dict[int, str] = {}

    def augment(talk: str, seen: set[int]) -> bool:
        for slot in options[talk]:
            if slot in seen:
                continue
            seen.add(slot)
            if slot not in owner or augment(owner[slot], seen):
                owner[slot] = talk
                return True
        return False

    return all(augment(talk, set()) for talk in sorted(talks))


def track_plan(body: dict[str, Any]) -> str:
    blocks = read_blocks(_prompt(body))
    days = blocks["days"]
    available = _speaker_days(blocks)
    talks = sorted(blocks["talks"], key=lambda t: t["id"])
    options = {
        talk["id"]: {day: available[talk["speaker_id"]][day] for day in days} for talk in talks
    }
    target = -(-len(talks) // len(days))
    order = sorted(talks, key=lambda t: (sum(bool(v) for v in options[t["id"]].values()), t["id"]))
    split: dict[int, list[str]] = {day: [] for day in days}

    def feasible(day: int) -> bool:
        return _matching(split[day], {t: options[t][day] for t in split[day]})

    def place(index: int) -> bool:
        if index == len(order):
            return True
        talk = order[index]["id"]
        for day in sorted(days, key=lambda d: (len(split[d]), d)):
            if not options[talk][day] or len(split[day]) >= target:
                continue
            split[day].append(talk)
            if feasible(day) and place(index + 1):
                return True
            split[day].pop()
        return False

    if not place(0):  # give up on balance, keep availability
        split = {day: [] for day in days}
        for talk in order:
            day = next((d for d in days if options[talk["id"]][d]), days[0])
            split[day].append(talk["id"])
    sessions = [
        {"day": day, "talk_ids": sorted(split[day]), "notes": f"{len(split[day])} talks"}
        for day in days
    ]
    return _answer({"sessions": sessions})


def session_plan(body: dict[str, Any]) -> str:
    session = read_blocks(_prompt(body))["session"]
    name = f"{session['track']['name']} day {session['day']}"
    contracts = [
        {
            "id": "extract",
            "kind": "extract",
            "objective": f"Extract the speaker and audience constraints of {name}.",
            "depends_on": [],
            "priority": 2,
            "risk": 0.4,
        },
        {
            "id": "place",
            "kind": "place",
            "objective": f"Place the {len(session['talk_ids'])} talks of {name} on the grid.",
            "depends_on": ["extract"],
            "priority": 3,
            "risk": 0.6,
        },
        {
            "id": "blurb",
            "kind": "blurb",
            "objective": f"Write the program blurb of {name}.",
            "depends_on": ["place"],
            "priority": 1,
            "risk": 0.1,
        },
    ]
    return _answer({"contracts": contracts})


def judge(body: dict[str, Any]) -> str:
    blocks = read_blocks(_prompt(body))
    data = blocks["contract_data"]
    output = blocks["agent_output"]
    wanted = sorted(data.get("session", {}).get("talk_ids", []))
    placed = sorted(p["talk_id"] for p in output.get("placements", []))
    if wanted and placed != wanted:
        reasons = [f"placed {placed} but the session has {wanted}"]
        return _answer({"verdict": "fail", "score": 0.2, "reasons": reasons})
    return _answer({"verdict": "pass", "score": 0.9, "reasons": []})


# -- agent roles --------------------------------------------------------------------------


def extract(body: dict[str, Any]) -> FakeReply | str:
    blocks = read_blocks(_prompt(body))
    turns = _turns(body)
    speakers = blocks["speaker_ids"]
    if not turns:
        query = " OR ".join(speakers)
        return FakeReply(tool_calls=[_call("memory.search", query=query, k=50, scope="squad")])

    found: dict[str, Any] = {}
    for name, _, output in turns[0]:
        if name == "memory.search":
            for fact in output.get("results", []):
                if fact["status"] == "verified":
                    found[fact["key"]] = fact["value"]
    days, slots = blocks["days"], blocks["slots"]
    emails = {email["speaker_id"]: email for email in blocks["emails"]}
    speaker_rows, talk_rows, publish, reused = [], [], [], []
    for speaker in speakers:
        key = f"speaker:{speaker}:availability"
        if key in found:
            value = found[key]
            reused.append(key)
        else:
            available, preference = parse_email(emails[speaker]["body"], days, slots)
            value = {
                "available": [{"day": d, "slots": available[d]} for d in days if available[d]],
                "preference": preference,
            }
            publish.append((key, speaker, value, [emails[speaker]["id"]]))
        speaker_rows.append({"speaker_id": speaker} | value)
    for talk in blocks["abstracts"]:
        key = f"talk:{talk['id']}:attendance"
        if key in found:
            value = found[key]
            reused.append(key)
        else:
            value = {"expected_attendance": parse_attendance(talk["abstract"])}
            publish.append((key, talk["id"], value, [talk["id"]]))
        talk_rows.append({"talk_id": talk["id"]} | value)

    if len(turns) == 1 and publish:
        calls = [
            _call(
                "memory.publish_fact",
                key=key,
                subject=subject,
                value_json=json.dumps(value, sort_keys=True),
                sources=sources,
            )
            for key, subject, value, sources in publish
        ]
        return FakeReply(tool_calls=calls)
    answer = {"speakers": speaker_rows, "talks": talk_rows, "reused_fact_keys": sorted(reused)}
    return _answer(answer)


def _feedback_limits(lines: Iterable[str]):
    """Constraints a repair pass learns from the checker's and the board's feedback."""
    cells, busy, unavailable, min_capacity = set(), set(), set(), {}
    for line in lines:
        if m := re.search(r"room (\S+) at d(\d+) s(\d+) is already booked", line):
            cells.add((int(m.group(3)), m.group(1)))
        if m := re.search(r"speaker (\S+) is already booked at d(\d+) s(\d+)", line):
            busy.add((m.group(1), int(m.group(3))))
        if m := re.search(r"(S\d+) is not available on day (\d+) slot (\d+)", line):
            unavailable.add((m.group(1), int(m.group(3))))
        if m := re.search(r"(\d+) expected in \S+ \(capacity \d+\) \((T\d+)\)", line):
            min_capacity[m.group(2)] = int(m.group(1))
    return cells, busy, unavailable, min_capacity


def place(body: dict[str, Any]) -> FakeReply | str:
    blocks = read_blocks(_prompt(body))
    session = blocks["session"]
    day = session["day"]
    turns = _turns(body)
    if not turns:
        search = _call("memory.search", query=f"booking d{day}", k=50, scope="global")
        return FakeReply(tool_calls=[search])

    taken: set[tuple[int, str]] = set()
    busy: set[tuple[str, int]] = set()
    for name, _, output in turns[-1]:
        if name != "memory.search":
            continue
        for fact in output.get("results", []):
            value = fact["value"]
            if fact["key"].startswith("booking:") and value.get("day") == day:
                taken.add((value["slot"], value["room"]))
                busy.add((value["speaker_id"], value["slot"]))
    cells, busy_more, unavailable, min_capacity = _feedback_limits(
        blocks.get("feedback_from_previous_attempt", [])
    )
    taken |= cells
    busy |= busy_more

    constraints = blocks["constraints"]
    need = {t["talk_id"]: t["expected_attendance"] for t in constraints["talks"]}
    need |= {talk: max(need.get(talk, 0), n) for talk, n in min_capacity.items()}
    avail: dict[str, set[int]] = {}
    prefer: dict[str, str] = {}
    for row in constraints["speakers"]:
        slots = next((d["slots"] for d in row["available"] if d["day"] == day), [])
        avail[row["speaker_id"]] = set(slots)
        prefer[row["speaker_id"]] = row["preference"]
    morning = {s["index"] for s in blocks["slots"] if _minutes(s["start"]) < _minutes("12:30")}
    rooms = sorted(blocks["rooms"], key=lambda room: (room["capacity"], room["id"]))
    largest = rooms[-1]["id"]
    home = session["home_room"]

    talks = blocks["talks"]

    def options(talk: dict[str, str]) -> list[tuple[int, str]]:
        speaker = talk["speaker_id"]
        people = need.get(talk["talk_id"], 0)
        found = []
        for slot in sorted(avail.get(speaker, set())):
            if (speaker, slot) in busy or (speaker, slot) in unavailable:
                continue
            for rank, room in enumerate(rooms):
                if room["capacity"] < people or (slot, room["id"]) in taken:
                    continue
                order = 0 if room["id"] == home else (9 if room["id"] == largest else 1 + rank)
                wanted = prefer.get(speaker, "none")
                honored = wanted == "none" or (slot in morning) == (wanted == "morning")
                found.append(((0 if honored else 1, order, slot), (slot, room["id"])))
        return [option for _, option in sorted(found)]

    menu = {talk["talk_id"]: options(talk) for talk in talks}
    order = sorted(talks, key=lambda t: (len(menu[t["talk_id"]]), t["talk_id"]))
    chosen: dict[str, tuple[int, str]] = {}
    budget = [20_000]

    def solve(index: int, used: set[int], speakers: set[tuple[str, int]]) -> bool:
        if index == len(order):
            return True
        budget[0] -= 1
        if budget[0] < 0:
            return False
        talk = order[index]
        for slot, room in menu[talk["talk_id"]]:
            if slot in used or (talk["speaker_id"], slot) in speakers:
                continue
            chosen[talk["talk_id"]] = (slot, room)
            if solve(index + 1, used | {slot}, speakers | {(talk["speaker_id"], slot)}):
                return True
            del chosen[talk["talk_id"]]
        return False

    notes = "all constraints satisfied"
    if not solve(0, set(), set()):
        notes = "no conflict-free placement found; best effort"
        used = {slot for slot, _ in chosen.values()}
        for talk in order:
            if talk["talk_id"] in chosen:
                continue
            free = [opt for opt in menu[talk["talk_id"]] if opt[0] not in used]
            chosen[talk["talk_id"]] = (free or menu[talk["talk_id"]] or [(0, home)])[0]
            used.add(chosen[talk["talk_id"]][0])
    placements = [
        {"talk_id": talk, "day": day, "slot": slot, "room": room}
        for talk, (slot, room) in sorted(chosen.items())
    ]
    return _answer({"placements": placements, "notes": notes})


def blurb(body: dict[str, Any]) -> FakeReply | str:
    blocks = read_blocks(_prompt(body))
    session = blocks["session"]
    titles = {talk["id"]: talk["title"] for talk in blocks["talks"]}
    starts = {slot["index"]: slot["start"] for slot in blocks["slots"]}
    ordered = sorted(blocks["placements"], key=lambda p: p["slot"])
    first = ordered[0] if ordered else None
    text = (
        f"{session['track']} on day {session['day']} brings {len(ordered)} talks"
        + (f", opening at {starts[first['slot']]} with \"{titles[first['talk_id']]}\"" if first else "")
        + ". Expect practical lessons, real numbers and time for questions."
    )
    if not _turns(body):
        return FakeReply(tool_calls=[_call("workspace.write", path=blocks["path"], content=text)])
    return _answer({"blurb": text, "path": blocks["path"]})


HANDLERS = {
    "t2_root_plan": root_plan,
    "t2_track_plan": track_plan,
    "t2_session_plan": session_plan,
    "t2_extract": extract,
    "t2_place": place,
    "t2_blurb": blurb,
    "judge_verdict": judge,
}
