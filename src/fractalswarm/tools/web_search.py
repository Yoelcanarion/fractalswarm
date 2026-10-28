"""The ``web_search`` tool: the Responses API's hosted search (docs/api-notes.md item 2).

A search is an ``llm`` effect whose request enables ``{"type": "web_search"}``, so it is
reserved ($2.50 per 1k queries on top of tokens), recorded in the cassette and replayed like
any call. ``parse_hits`` reads the URLs from ``web_search_call`` results (when present) and
from ``url_citation`` annotations; ``register_hits`` adds them to the run's provenance, the
only way a URL becomes fetchable besides the task itself.

Hits are untrusted: scan them with the firewall (surface ``external``) and ``spotlight`` them.
"""

from typing import Any

from pydantic import BaseModel

from fractalswarm.safety.capabilities import Capabilities
from fractalswarm.safety.fetch_policy import Provenance
from fractalswarm.safety.firewall import SPOTLIGHT_RULE, spotlight

TOOL = "web_search"


class SearchHit(BaseModel):
    url: str
    title: str = ""
    snippet: str = ""


def search_request(
    query: str,
    capabilities: Capabilities,
    *,
    role: str = "agent",
    level: str = "L0",
    max_searches: int = 1,
) -> dict[str, Any]:
    """The ``llm`` effect request for one search. Raises ``ToolDeniedError`` if not granted."""
    capabilities.require(TOOL)
    return {
        "role": role,
        "level": level,
        "instructions": (
            "Search the web for the query and list the most relevant sources with one-line "
            "summaries. " + SPOTLIGHT_RULE
        ),
        "input": query,
        "tools": [{"type": "web_search"}],
        "max_tool_calls": max_searches,
    }


def parse_hits(result: dict[str, Any]) -> list[SearchHit]:
    """Hits from an ``llm`` completion result, deduplicated by URL in first-seen order."""
    hits: dict[str, SearchHit] = {}
    for item in result.get("output") or []:
        if item.get("type") == "web_search_call":
            for raw in item.get("results") or (item.get("action") or {}).get("sources") or []:
                url = raw.get("url")
                if url:
                    hits.setdefault(
                        url,
                        SearchHit(
                            url=url, title=raw.get("title") or "", snippet=raw.get("snippet") or ""
                        ),
                    )
        if item.get("type") == "message":
            for part in item.get("content") or []:
                for note in part.get("annotations") or []:
                    if note.get("type") == "url_citation" and note.get("url"):
                        hits.setdefault(
                            note["url"], SearchHit(url=note["url"], title=note.get("title") or "")
                        )
    return list(hits.values())


def register_hits(provenance: Provenance, hits: list[SearchHit], effect_id: str) -> None:
    provenance.add_all((hit.url for hit in hits), f"web_search:{effect_id}")


def spotlight_hits(hits: list[SearchHit]) -> str:
    return "\n".join(
        spotlight(f"{hit.title}\n{hit.url}\n{hit.snippet}".strip(), f"web_search:{hit.url}")
        for hit in hits
    )
