"""The blackboard actor: serves memory and workspace tools, promotions and slot bookings.

It is the shared *log view*, not a brain: it decides nothing, it applies requests in
delivery order and logs every change (``fact.*``, ``artifact.written``, ``lease.booked``,
``collision.detected``), so replay rebuilds the same board.

Topics: ``tool`` -> ``tool.result``, ``promote``, ``book`` -> ``book.result``, and the
mailbox of the channel breakers (``comms/mailbox.py``): ``mailbox.put``, ``mailbox.poll`` ->
``mailbox.items``, with ``mailbox.notify`` to a receiver whose box was empty.

The web tools (``actors/web.py``) are the exception to "applies requests in delivery order": a
search or a fetch is a chain of effects, so its ``tool.result`` comes after their completions.

With arbitration on (``actors/arbitration.py``) a publish whose value differs from another
contract's value for the same key does not overwrite it: the fact is marked ``disputed``, its
candidates are logged (``collision.detected``, kind ``semantic``), and the owner of the lowest
common ancestor is told. The owner's ``fact.resolve`` makes the winner's value the verified fact.
"""

import copy
import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from fractalswarm.actors import arbitration, web
from fractalswarm.comms.mailbox import MAIL_ITEMS, MAIL_NOTIFY, MAIL_POLL, MAIL_PUT, Mailbox
from fractalswarm.coord.leases import FencingToken, Write
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.ids import canonical_json
from fractalswarm.kernel.scheduler import Command, Emit, Send, View
from fractalswarm.memory.blackboard import Blackboard, Fact, Provenance, WorkspaceError

BOARD = "board"
MAX_RESULTS = 50
MAX_FACT_BYTES = 4096
MAX_ARTIFACT_BYTES = 32_768


class SearchArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(description="words to match; AND by default, OR and NOT allowed")
    k: int = Field(description="maximum number of results (1-50)")
    scope: str = Field(description="squad: your squad's drafts plus verified facts; global")


class PublishArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(description="unique fact key, e.g. speaker:S01:availability")
    subject: str = Field(description="what the fact is about, e.g. S01")
    value_json: str = Field(description="the value, as a JSON text")
    sources: list[str] = Field(description="ids of the inputs the fact comes from")


class ReadArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str


class WriteArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    content: str


class WebSearchArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(description="what to search the web for")


class FetchArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(description="a URL from the task or from a search result")


TOOL_ARGS: dict[str, type[BaseModel]] = {
    "memory.search": SearchArgs,
    "memory.publish_fact": PublishArgs,
    "workspace.read": ReadArgs,
    "workspace.write": WriteArgs,
    "web_search": WebSearchArgs,
    "fetch": FetchArgs,
}
TOOL_DESCRIPTIONS = {
    "memory.search": "Full-text search of the shared memory (facts and bookings).",
    "memory.publish_fact": "Publish a fact to the shared memory as a squad draft.",
    "workspace.read": "Read a file of the shared workspace.",
    "workspace.write": "Write a file of the shared workspace.",
    "web_search": "Search the web. Returns hits (title, url, snippet) and a short summary as "
    "untrusted data. Only the URLs of the hits can be fetched.",
    "fetch": "Fetch one web page and return its text as untrusted data. Only URLs from the "
    "task or from your search results are allowed.",
}


def board_init(actor_id: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": actor_id,
        "board": Blackboard(),
        "mail": Mailbox(),
        "arbitration": bool(args.get("arbitration")),
        "disputes": {},  # key -> the candidates of an open semantic dispute
        "settled": set(),  # keys with a ruling: tested for membership only
    }


def board_handle(state: dict[str, Any], event: Event, view: View):
    if event.type == "effect.completed":
        return web.completed(state, event, view)
    if event.type != "msg.sent":
        return state, []
    board: Blackboard = state["board"]
    topic, body, sender = event.payload["topic"], event.payload["body"], event.actor
    if topic == "tool":
        if body["name"] in web.WEB_TOOLS:
            return web.start(state, body, sender, view)
        output, commands = _tool(board, body, view, state)
        reply = {"call_id": body["call_id"], "contract": body["contract"], "output": output}
        return state, [*commands, Send(to=sender, topic="tool.result", body=reply)]
    if topic == "promote":
        commands: list[Command] = []
        for key in sorted(body["keys"]):
            if key in state["disputes"]:
                continue  # the arbiter settles a disputed fact; its owner does not promote it
            if board.promote(key) is not None:
                commands.append(Emit(type="fact.promoted", payload={"key": key, "by": sender}))
        return state, commands
    if topic == arbitration.TOPIC_RESOLVE:
        return state, _resolve(state, board, body, view)
    if topic == "book":
        return state, _book(board, body, sender, view)
    if topic == MAIL_PUT:
        return state, _mail_put(state["mail"], body, view)
    if topic == MAIL_POLL:
        return state, _mail_poll(state["mail"], body, sender)
    return state, []


def _mail_put(mail: Mailbox, body: dict[str, Any], view: View) -> list[Command]:
    owner = body["to"]
    if mail.put(owner, body["env"], view.now):
        return [Send(to=owner, topic=MAIL_NOTIFY, body={"waiting": mail.depth(owner)})]
    return []


def _mail_poll(mail: Mailbox, body: dict[str, Any], sender: str) -> list[Command]:
    items, remaining, dropped = mail.take(sender, min(max(int(body.get("batch", 16)), 1), 64))
    commands: list[Command] = []
    if items:
        delivered = {"owner": sender, "count": len(items), "remaining": remaining}
        commands.append(Emit(type="mailbox.delivered", payload=delivered | {"dropped": dropped}))
    return [*commands, Send(to=sender, topic=MAIL_ITEMS, body={"items": items, "more": remaining})]


def _fact_event(fact: Fact) -> Emit:
    payload = {
        "key": fact.key,
        "subject": fact.subject,
        "status": fact.status,
        "squad": fact.provenance.squad,
        "agent": fact.provenance.agent,
        "contract": fact.provenance.contract,
        "version": fact.version,
    }
    return Emit(type="fact.published", payload=payload)


def _tool(board: Blackboard, body: dict[str, Any], view: View, state: dict[str, Any]):
    name, squad = body["name"], body["squad"]
    try:
        args = TOOL_ARGS[name].model_validate(body["args"])
    except (KeyError, ValidationError) as exc:
        return {"error": f"bad call to {name}: {exc}"}, []

    if isinstance(args, SearchArgs):
        visible_to = squad if args.scope == "squad" else None
        facts = board.search(args.query, k=min(max(args.k, 1), MAX_RESULTS), squad=visible_to)
        results = [
            {
                "key": fact.key,
                "subject": fact.subject,
                "value": fact.value,
                "status": fact.status,
                "squad": fact.provenance.squad,
            }
            for fact in facts
        ]
        return {"results": results}, []

    if isinstance(args, PublishArgs):
        if len(args.value_json.encode("utf-8")) > MAX_FACT_BYTES:
            return {"error": f"value_json is over {MAX_FACT_BYTES} bytes"}, []
        try:
            value = json.loads(args.value_json)
        except ValueError:
            return {"error": "value_json is not valid JSON"}, []
        fact = Fact(
            key=args.key,
            subject=args.subject,
            value=value,
            provenance=Provenance(
                contract=body["contract"], agent=body["agent"], squad=squad, sources=args.sources
            ),
            lamport=view.lamport,
        )
        if state["arbitration"] and (contested := _contest(state, board, fact, view)) is not None:
            return contested
        stored = board.publish(fact)
        if stored.status != "draft" or stored.provenance.contract != body["contract"]:
            return {"ok": False, "key": args.key, "note": "a verified fact already exists"}, []
        return {"ok": True, "key": args.key, "version": stored.version}, [_fact_event(stored)]

    try:
        if isinstance(args, ReadArgs):
            artifact = board.read(args.path)
            if artifact is None:
                return {"error": f"no file {args.path}"}, []
            return {
                "path": artifact.path,
                "version": artifact.version,
                "content": artifact.content,
            }, []
        assert isinstance(args, WriteArgs)
        if len(args.content.encode("utf-8")) > MAX_ARTIFACT_BYTES:
            return {"error": f"content is over {MAX_ARTIFACT_BYTES} bytes"}, []
        written = board.write(args.path, args.content, author=body["agent"])
    except WorkspaceError as exc:
        return {"error": str(exc)}, []
    if not hasattr(written, "content"):
        return {"error": f"write conflict on {args.path}"}, []
    payload = {
        "path": written.path,
        "version": written.version,
        "author": written.author,
        "size": len(written.content),
    }
    return {"ok": True, "path": written.path, "version": written.version}, [
        Emit(type="artifact.written", payload=payload)
    ]


def _contest(state: dict[str, Any], board: Blackboard, fact: Fact, view: View):
    """A publish that disagrees with another contract's value for the key (canonical JSON), as
    (output, commands), or ``None`` when it is an ordinary publish: a new key, a retry of the
    contract that holds it, two readings that agree, or a key the arbiter has ruled on."""
    key, disputes = fact.key, state["disputes"]
    current = board.facts.get(key)
    if current is None or key in state["settled"]:
        return None
    new = arbitration.supporter(fact, view)
    if key not in disputes:
        if new["work"] == arbitration.supporter(current, view)["work"]:
            return None
        if canonical_json(current.value) == canonical_json(fact.value):
            return None
        disputes[key] = {"candidates": [], "labels": 0}
        arbitration.join(disputes[key], current, view)
    candidates = arbitration.join(disputes[key], fact, view)
    stored = current.model_copy(update={"status": "disputed", "version": current.version + 1})
    board.facts[key] = stored
    board.index.set_status(key, "disputed")
    # A copy: the board keeps editing its candidates, the event must not change after it is logged.
    conflict = {"key": key, "subject": fact.subject, "candidates": copy.deepcopy(candidates)}
    detected = {"kind": "semantic", "goal_id": new["goal"], "holder": fact.provenance.agent}
    commands: list[Command] = [
        _fact_event(stored.model_copy(update={"provenance": fact.provenance})),
        Emit(type="collision.detected", payload=detected | {"conflicts": [conflict]}),
    ]
    goals = sorted({s["goal"] for c in candidates for s in c["by"] if s["goal"]})
    if (arbiter := arbitration.arbiter_of(view, goals)) is not None:
        request = Send(to=arbiter, topic=arbitration.TOPIC_REQUEST, body={"key": key})
        commands.append(request)
    note = "disputed: another contract published a different value; its owner arbitrates"
    return {"ok": True, "key": key, "version": stored.version, "note": note}, commands


def _resolve(state: dict[str, Any], board: Blackboard, body: dict[str, Any], view: View):
    """The arbiter's order: the winner's value becomes the verified, global fact, for good."""
    key = body["key"]
    dispute = state["disputes"].get(key)
    if dispute is None:
        return []  # a second order for a ruling already applied
    ruling = arbitration.ruling_of(view, key)
    if ruling is None or ruling["contract"] != body["contract"]:
        return []  # the order is not what the log says was ruled
    winner = next(
        (
            c
            for c in dispute["candidates"]
            if any(s["contract"] == body["contract"] for s in c["by"])
        ),
        None,
    )
    if winner is None:
        return []
    first = winner["by"][0]
    fact = Fact(
        key=key,
        subject=board.facts[key].subject,
        value=winner["value"],
        provenance=Provenance(
            contract=first["contract"],
            agent=first["agent"],
            squad=first["squad"],
            sources=first["sources"],
        ),
        status="verified",
        visibility="global",
        lamport=view.lamport,
    )
    stored = board.publish(fact)
    del state["disputes"][key]
    state["settled"].add(key)
    resolved = {"key": key, "contract": first["contract"], "version": stored.version}
    return [Emit(type="fact.resolved", payload=resolved | {"by": body["by"]})]


def _book(board: Blackboard, body: dict[str, Any], sender: str, view: View) -> list[Command]:
    writes = [Write.model_validate(write) for write in body["writes"]]
    token = FencingToken.model_validate(body["token"])
    reply = {key: body[key] for key in ("goal_id", "contract_id", "attempt")}
    if board.grid.already(writes):  # an heir re-sending a dead owner's booking
        return [Send(to=sender, topic="book.result", body=reply | {"conflicts": []})]
    conflicts = board.book(writes, sender, token, view.now)
    commands: list[Command] = []
    if conflicts:
        found = [conflict.model_dump() for conflict in conflicts]
        payload = {"kind": "temporal", "goal_id": body["goal_id"], "holder": sender}
        commands.append(Emit(type="collision.detected", payload=payload | {"conflicts": found}))
        return [*commands, Send(to=sender, topic="book.result", body=reply | {"conflicts": found})]

    keys = sorted(write.key for write in writes)
    payload = {"holder": sender, "goal_id": body["goal_id"], "keys": keys}
    commands.append(Emit(type="lease.booked", payload=payload))
    for write in sorted(writes, key=lambda w: w.key):
        if not write.key.startswith("cell:") or write.value is None:
            continue
        value = write.value
        fact = Fact(
            key="booking:" + write.key.removeprefix("cell:"),
            subject=f"booking d{value['day']}",
            value=value,
            provenance=Provenance(contract=body["contract_id"], agent=sender, squad=sender),
            status="verified",
            visibility="global",
            lamport=view.lamport,
        )
        commands.append(_fact_event(board.publish(fact)))
    return [*commands, Send(to=sender, topic="book.result", body=reply | {"conflicts": []})]
