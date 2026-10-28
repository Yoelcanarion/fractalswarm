"""Web tools on the blackboard: ``web_search`` and ``fetch`` for agents (spec §10, §13).

Both tools are effects, so one call takes several deliveries; ``state["web"]["calls"]`` keeps
the calls in flight by number. The chain of each call:

- ``web_search``: an ``llm`` effect (the hosted search tool, ``tools/web_search.py``), then a
  ``firewall`` scan of everything that came back. If it is allowed, its URLs become fetchable
  (``web.hits``) and the agent gets the hits spotlighted;
- ``fetch``: a provenance check against the log (``memory/sources.py``), a ``fetch`` effect
  (``tools/fetch.py``: SSRF, robots.txt, size and time limits), then a ``firewall`` scan. If it
  is allowed, the page is recorded (``web.page``) and the agent gets its text spotlighted.

External text is untrusted. It reaches an agent only as a tool result, inside spotlight
delimiters, and never in instructions. What the firewall quarantines is replaced by a stub, and
its URLs never become fetchable. The agent is told why a fetch failed by a policy code only,
because the detail of an error can carry text of a hostile redirect.
"""

from typing import Any

from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Command, Emit, Send, StartEffect, View
from fractalswarm.safety.capabilities import Capabilities
from fractalswarm.safety.firewall import Verdict, quarantine_stub, scan_request, spotlight
from fractalswarm.tools.web_search import SearchHit, parse_hits, search_request, spotlight_hits

WEB_TOOLS = ("web_search", "fetch")
TAG = "web"  # tags are web.<call number>.<search | fetch | scan>
MAX_HITS = 10
MAX_SUMMARY_CHARS = 3_000


def _tag(number: str, stage: str) -> str:
    return f"{TAG}.{number}.{stage}"


def _reply(call: dict[str, Any], output: dict[str, Any]) -> Send:
    body = {"call_id": call["call_id"], "contract": call["contract"], "output": output}
    return Send(to=call["sender"], topic="tool.result", body=body)


def _finish(state: dict[str, Any], number: str, call: dict[str, Any], output: dict[str, Any]):
    web = state["web"]
    calls = {key: value for key, value in web["calls"].items() if key != number}
    return {**state, "web": {**web, "calls": calls}}, _reply(call, output)


def _step(state: dict[str, Any], number: str, call: dict[str, Any]) -> dict[str, Any]:
    web = state["web"]
    return {**state, "web": {**web, "calls": {**web["calls"], number: call}}}


def start(state: dict[str, Any], body: dict[str, Any], sender: str, view: View):
    """An agent's ``tool`` message for a web tool: deny it, or start its first effect."""
    web = state.get("web") or {"next": 0, "calls": {}}
    number = str(web["next"])
    name, args = body["name"], body["args"]
    caps = Capabilities(granted=frozenset(body.get("tools", [])), contract=body["contract"])
    call = {"sender": sender, "call_id": body["call_id"], "contract": body["contract"]}
    call |= {"name": name, "squad": body["squad"]}
    target = args.get("url") or args.get("query")
    if not caps.allows(name):
        denied = Emit(type="tool.denied", payload=caps.denial_payload(name, target))
        return state, [denied, _reply(call, {"error": f"tool {name!r} is not granted"})]

    if name == "fetch":
        sources = view.views.get("sources")
        source = sources.source_of(args["url"]) if sources is not None else None
        if source is None:
            reason = "provenance: the URL did not appear in the task or in search results"
            denied = Emit(
                type="tool.denied", payload=caps.denial_payload(name, target) | {"reason": reason}
            )
            output = {"error": "blocked (provenance): fetch only task or search-result URLs"}
            return state, [denied, _reply(call, output)]
        call |= {"url": args["url"], "provenance": source}
        request = {"url": args["url"], "tools": sorted(caps.granted), "source": source}
        effect = StartEffect(kind="fetch", request=request, tag=_tag(number, "fetch"))
    else:
        call |= {"query": args["query"]}
        effect = StartEffect(
            kind="llm",
            request=search_request(args["query"], caps),
            tag=_tag(number, "search"),
            scopes={"contract": body["contract"], "squad": body["squad"]},
        )
    web = {"next": web["next"] + 1, "calls": {**web["calls"], number: call}}
    return {**state, "web": web}, [effect]


def completed(state: dict[str, Any], event: Event, view: View):
    """An ``effect.completed`` event addressed to the board: the next step of a web call."""
    parts = (event.payload["tag"] or "").split(".")
    if len(parts) != 3 or parts[0] != TAG:
        return state, []
    number, stage = parts[1], parts[2]
    call = (state.get("web") or {"calls": {}})["calls"].get(number)
    if call is None:
        return state, []
    if stage == "search":
        return _searched(state, number, call, event)
    if stage == "fetch":
        return _fetched(state, number, call, event)
    return _scanned(state, number, call, event)


def _searched(state: dict[str, Any], number: str, call: dict[str, Any], event: Event):
    status, result = event.payload["status"], event.payload["result"]
    if status != "ok":
        state, reply = _finish(state, number, call, {"error": f"web_search failed ({status})"})
        return state, [reply]
    hits = parse_hits(result)[:MAX_HITS]
    summary = (result.get("output_text") or "")[:MAX_SUMMARY_CHARS]
    source = f"web_search:{event.payload['effect_id']}"
    text = "\n".join([*(f"{hit.title}\n{hit.url}\n{hit.snippet}" for hit in hits), summary])
    call = {**call, "hits": [hit.model_dump() for hit in hits], "summary": summary}
    call |= {"source": source, "scan_id": source}
    return _step(state, number, call), [_scan(number, text, source)]


def _fetched(state: dict[str, Any], number: str, call: dict[str, Any], event: Event):
    status, result = event.payload["status"], event.payload["result"]
    if status != "ok":
        reason = result.get("blocked") or "request failed"
        state, reply = _finish(
            state, number, call, {"url": call["url"], "error": f"fetch failed: {reason}"}
        )
        return state, [reply]
    scan_id = f"fetch:{call['url']}"
    call = {**call, "page": result, "scan_id": scan_id}
    return _step(state, number, call), [_scan(number, result["text"], scan_id)]


def _scan(number: str, text: str, source_id: str) -> StartEffect:
    return StartEffect(
        kind="firewall", request=scan_request(text, "external", source_id), tag=_tag(number, "scan")
    )


def _scanned(state: dict[str, Any], number: str, call: dict[str, Any], event: Event):
    if event.payload["status"] == "ok":
        verdict = Verdict.model_validate(event.payload["result"])
    else:  # fail closed: external text nobody could scan is not read
        error = event.payload["result"].get("error") or event.payload["status"]
        verdict = Verdict(
            surface="external",
            source_id=call["scan_id"],
            decision="quarantine",
            score=1.0,
            backend="none",
            reasons=[f"the scan failed: {error}"],
        )
    commands: list[Command] = [
        Emit(type="security.scanned", payload=verdict.model_dump(mode="json"))
    ]
    if not verdict.allowed:
        stub = quarantine_stub(verdict)
        quarantined = {"source_id": verdict.source_id, "surface": verdict.surface}
        quarantined |= {"score": verdict.score, "reason": "; ".join(verdict.reasons), "stub": stub}
        commands.append(Emit(type="security.quarantined", payload=quarantined))
        output: dict[str, Any] = {"quarantined": stub}
        if call["name"] == "fetch":
            output["url"] = call["url"]
    elif call["name"] == "web_search":
        hits = [SearchHit.model_validate(hit) for hit in call["hits"]]
        hit_event = {
            "source": call["source"],
            "query": call["query"],
            "urls": [h.url for h in hits],
        }
        commands.append(Emit(type="web.hits", payload=hit_event))
        output = {
            "hits": spotlight_hits(hits),
            "summary": spotlight(call["summary"], call["source"]),
        }
    else:
        page = call["page"]
        recorded = {
            "url": call["url"],
            "final_url": page["final_url"],
            "source": call["provenance"],
        }
        recorded |= {
            "chars": len(page["text"]),
            "truncated": page["truncated"],
            "text": page["text"],
        }
        commands.append(Emit(type="web.page", payload=recorded))
        output = {
            "url": call["url"],
            "text": spotlight(page["text"], call["scan_id"]),
            "truncated": page["truncated"],
        }
    state, reply = _finish(state, number, call, output)
    return state, [*commands, reply]
