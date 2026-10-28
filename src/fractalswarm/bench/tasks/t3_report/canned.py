"""A canned web for the $0 run of T3: pages, a search over them, and a network for ``fetch``.

The fetch tool runs unchanged, with its provenance, SSRF, robots.txt, content-type and size
policy and its text extraction. Only the network is replaced: an ``httpx.MockTransport`` serves
the pages, and every host resolves to one public address. The search ranks pages by how many
words of the query they contain, so it is deterministic.

``tasks/fixtures/t3/<name>/web.json`` maps a URL to ``{"title", "body": [paragraphs]}``, or to
``{"title", "html"}`` for a page that needs its own markup.
"""

import json
from html import escape
from pathlib import Path
from typing import Any

import httpx

from fractalswarm.safety.fetch_policy import normalize_url
from fractalswarm.tools.fetch import html_to_text
from fractalswarm.tools.web_search import SearchHit

PUBLIC_ADDRESS = "93.184.215.14"  # what every canned host resolves to; any public address will do
SNIPPET_CHARS = 160


def words(text: str) -> set[str]:
    return {word for word in "".join(c if c.isalnum() else " " for c in text.lower()).split()}


def page_html(title: str, paragraphs: list[str]) -> str:
    body = "".join(f"<p>{escape(paragraph)}</p>" for paragraph in paragraphs)
    head = f"<title>{escape(title)}</title>"
    return f"<html><head>{head}</head><body><h1>{escape(title)}</h1>{body}</body></html>"


class CannedWeb:
    def __init__(self, pages: dict[str, dict[str, Any]]) -> None:
        self.pages: dict[str, dict[str, str]] = {}
        for url, page in pages.items():
            html = page.get("html") or page_html(page["title"], page["body"])
            self.pages[normalize_url(url)] = {
                "url": url,
                "title": page["title"],
                "html": html,
                "text": html_to_text(html),
            }

    @classmethod
    def load(cls, path: Path) -> "CannedWeb":
        file = path / "web.json" if path.is_dir() else path
        return cls(json.loads(file.read_text(encoding="utf-8"))["pages"])

    def with_page(self, url: str, title: str, body: list[str]) -> "CannedWeb":
        """A copy with one page added or replaced (tests plant a hostile page this way)."""
        pages = {
            page["url"]: {"title": page["title"], "html": page["html"]}
            for page in self.pages.values()
        }
        pages[url] = {"title": title, "body": body}
        return CannedWeb(pages)

    def search(self, query: str, limit: int = 3) -> list[SearchHit]:
        """The pages that share the most words with the query, best first, ties by URL."""
        wanted = words(query)
        scored = []
        for key, page in self.pages.items():
            score = len(wanted & words(f"{page['title']} {page['text']}"))
            if score:
                scored.append((-score, key, page))
        return [
            SearchHit(url=page["url"], title=page["title"], snippet=page["text"][:SNIPPET_CHARS])
            for _, _, page in sorted(scored, key=lambda item: item[:2])[:limit]
        ]

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/robots.txt":
                return httpx.Response(
                    200, headers={"content-type": "text/plain"}, text="User-agent: *\nAllow: /\n"
                )
            page = self.pages.get(normalize_url(str(request.url)))
            if page is None:
                return httpx.Response(404)
            headers = {"content-type": "text/html; charset=utf-8"}
            return httpx.Response(200, headers=headers, text=page["html"])

        return httpx.MockTransport(handler)

    async def resolve(self, host: str, port: int) -> list[str]:
        return [PUBLIC_ADDRESS]
