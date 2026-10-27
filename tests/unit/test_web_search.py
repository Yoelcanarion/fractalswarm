"""web_search: capability check, request shape, hit parsing, provenance for fetch."""

import pytest

from fractalswarm.llm.client import LLMClient
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.prices import PriceTable
from fractalswarm.safety.capabilities import Capabilities, ToolDeniedError
from fractalswarm.safety.fetch_policy import Provenance
from fractalswarm.tools.web_search import (
    parse_hits,
    register_hits,
    search_request,
    spotlight_hits,
)

GRANTED = Capabilities(granted=frozenset({"web_search"}))
RESULT = {
    "output": [
        {
            "type": "web_search_call",
            "id": "ws_1",
            "status": "completed",
            "results": [
                {
                    "type": "text_result",
                    "title": "Talks",
                    "url": "https://example.org/talks",
                    "snippet": "Program",
                },
            ],
        },
        {
            "type": "message",
            "content": [
                {
                    "type": "output_text",
                    "text": "See the program.",
                    "annotations": [
                        {
                            "type": "url_citation",
                            "url": "https://example.org/talks",
                            "title": "Talks",
                        },
                        {
                            "type": "url_citation",
                            "url": "https://news.example.net/a",
                            "title": "News",
                        },
                    ],
                }
            ],
        },
    ]
}


def test_search_is_denied_by_default() -> None:
    with pytest.raises(ToolDeniedError):
        search_request("conference", Capabilities())


def test_search_request_enables_the_hosted_tool_and_is_estimated_with_the_query_price() -> None:
    request = search_request("speakers", GRANTED, max_searches=2)
    assert request["tools"] == [{"type": "web_search"}] and request["max_tool_calls"] == 2
    client = LLMClient(FakeBackend(), roles=RoleTable.load(), prices=PriceTable.load(), mode="live")
    with_search = client.estimate(request)
    without = client.estimate({**request, "tools": [], "max_tool_calls": None})
    assert with_search - without == pytest.approx(
        2 * 2.50 / 1000, rel=0.05
    )  # plus the tool JSON tokens


def test_hits_feed_provenance() -> None:
    hits = parse_hits(RESULT)
    assert [hit.url for hit in hits] == ["https://example.org/talks", "https://news.example.net/a"]
    assert hits[0].snippet == "Program"
    provenance = Provenance()
    register_hits(provenance, hits, "eff-7.0")
    assert provenance.source_of("https://EXAMPLE.org/talks#top") == "web_search:eff-7.0"
    assert provenance.source_of("https://example.org/other") is None
    wrapped = spotlight_hits(hits)
    assert wrapped.count("<<untrusted source=web_search:") == 2
