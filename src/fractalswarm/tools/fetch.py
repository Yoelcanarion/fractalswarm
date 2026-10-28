"""The ``fetch`` tool: GET a page under the policy of ``safety/fetch_policy.py``.

Every hop (the first URL and each redirect) is checked for scheme, port and public
addresses; only the first needs provenance. The body is streamed and cut off past the size
limit, and the whole fetch, robots.txt included, runs under one deadline.

Known limitation: httpx resolves the host once more when it connects. The double resolution
here catches a rebinding answer between our two lookups, not one served to httpx itself.

The fetched text is untrusted: callers scan it with the firewall (surface ``external``) and
``spotlight`` it before it reaches a prompt.
"""

import asyncio
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urldefrag, urljoin

import httpx
from pydantic import BaseModel

from fractalswarm.kernel.effects import EffectContext, EffectFn, EffectOutcome
from fractalswarm.kernel.events import Event
from fractalswarm.safety.capabilities import Capabilities, ToolDeniedError
from fractalswarm.safety.fetch_policy import (
    FetchBlocked,
    FetchLimits,
    Provenance,
    Resolver,
    check_url,
    content_type_ok,
    resolve_public,
    robots_allows,
    robots_url,
    system_resolver,
)

TOOL = "fetch"
REDIRECTS = {301, 302, 303, 307, 308}


class FetchResult(BaseModel):
    url: str
    final_url: str
    status: int
    content_type: str
    bytes: int
    text: (
        str  # at most FetchLimits.max_text_chars: what an agent is shown and a quote is checked in
    )
    provenance: str
    truncated: bool = False


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skipping = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in self.SKIP:
            self.skipping += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self.skipping:
            self.skipping -= 1

    def handle_data(self, data: str) -> None:
        if not self.skipping and data.strip():
            self.parts.append(data.strip())


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return "\n".join(parser.parts)


class Fetcher:
    def __init__(
        self,
        client: httpx.AsyncClient,
        provenance: Provenance,
        *,
        limits: FetchLimits | None = None,
        resolver: Resolver = system_resolver,
    ) -> None:
        self.client = client
        self.provenance = provenance
        self.limits = limits or FetchLimits()
        self.resolver = resolver
        self.robots: dict[str, str | None] = {}  # origin -> robots.txt (None: disallow all)
        self.pinned: dict[str, list[str]] = {}  # host:port -> addresses at the first check

    async def fetch(self, url: str, capabilities: Capabilities) -> FetchResult:
        capabilities.require(TOOL)
        source = self.provenance.source_of(url)
        check_url(url, self.limits, self.provenance)
        try:
            async with asyncio.timeout(self.limits.timeout_s):
                return await self._fetch(url, source or "")
        except TimeoutError:
            raise FetchBlocked("timeout", f"over {self.limits.timeout_s:g} s") from None

    async def _fetch(self, url: str, source: str) -> FetchResult:
        current = urldefrag(url).url
        for _ in range(self.limits.max_redirects + 1):
            parts = check_url(current, self.limits, None)
            await self._guard_host(parts.hostname or "", parts.port, parts.scheme)
            if self.limits.respect_robots and not await self._robots_ok(current, parts):
                raise FetchBlocked("robots", f"robots.txt disallows {current}")
            await self._guard_host(parts.hostname or "", parts.port, parts.scheme, recheck=True)
            request = self.client.build_request(
                "GET", current, headers={"User-Agent": self.limits.user_agent}
            )
            response = await self.client.send(request, stream=True, follow_redirects=False)
            try:
                if response.status_code in REDIRECTS and "location" in response.headers:
                    current = urldefrag(urljoin(current, response.headers["location"])).url
                    continue
                return await self._read(url, current, source, response)
            finally:
                await response.aclose()
        raise FetchBlocked("redirects", f"more than {self.limits.max_redirects} redirects")

    async def _guard_host(
        self, host: str, port: int | None, scheme: str, recheck: bool = False
    ) -> None:
        port = port or (443 if scheme == "https" else 80)
        addresses = await resolve_public(host, port, self.resolver)
        key = f"{host}:{port}"
        if not recheck:
            self.pinned[key] = addresses
        elif self.pinned.get(key) != addresses:
            raise FetchBlocked(
                "dns_rebinding", f"{host} resolved differently between checks: {addresses}"
            )

    async def _robots_ok(self, url: str, parts) -> bool:
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self.robots:
            self.robots[origin] = await self._load_robots(robots_url(parts))
        robots = self.robots[origin]
        return robots is not None and robots_allows(robots, url, self.limits.user_agent)

    async def _load_robots(self, url: str) -> str | None:
        try:
            response = await self.client.get(
                url, headers={"User-Agent": self.limits.user_agent}, follow_redirects=False
            )
        except httpx.HTTPError:
            return None
        if response.status_code == 404 or response.status_code == 410:
            return ""  # no robots.txt: everything is allowed
        if response.status_code != 200:
            return None
        return response.text[: self.limits.max_bytes]

    async def _read(self, url: str, final_url: str, source: str, response) -> FetchResult:
        content_type = response.headers.get("content-type", "")
        if response.status_code != 200:
            raise FetchBlocked("status", f"HTTP {response.status_code}")
        if not content_type_ok(content_type, self.limits):
            raise FetchBlocked("content_type", f"{content_type or 'none'} is not text/html|plain")
        declared = response.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > self.limits.max_bytes:
            raise FetchBlocked("too_large", f"Content-Length {declared} > {self.limits.max_bytes}")
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > self.limits.max_bytes:
                raise FetchBlocked("too_large", f"body over {self.limits.max_bytes} bytes")
            chunks.append(chunk)
        raw = b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")
        is_html = content_type.split(";")[0].strip().lower() == "text/html"
        text = html_to_text(raw) if is_html else raw
        return FetchResult(
            url=url,
            final_url=final_url,
            status=response.status_code,
            content_type=content_type,
            bytes=size,
            text=text[: self.limits.max_text_chars],
            provenance=source,
            truncated=len(text) > self.limits.max_text_chars,
        )

    def effect(self) -> EffectFn:
        """The ``fetch`` effect. Request: ``{url, tools: [granted tools of the contract]}``, and
        ``source``: the provenance the requesting actor found for the URL in the log (the
        actor checks it first, so the effect's own provenance agrees with the log's).

        A refusal is an ``error`` completion with ``blocked`` set to the policy code.
        """

        async def run(started: Event, ctx: EffectContext) -> EffectOutcome:
            request = started.payload["request"]
            grants = Capabilities(granted=frozenset(request.get("tools", [])))
            if request.get("source"):
                self.provenance.add(request["url"], request["source"])
            try:
                result = await self.fetch(request["url"], grants)
            except FetchBlocked as exc:
                return EffectOutcome(
                    status="error", result={"blocked": exc.code, "error": exc.detail}
                )
            except ToolDeniedError as exc:
                return EffectOutcome(
                    status="error", result={"blocked": "denied", "error": exc.reason}
                )
            except httpx.HTTPError as exc:
                return EffectOutcome(
                    status="error", result={"error": f"{type(exc).__name__}: {exc}"}
                )
            return EffectOutcome(status="ok", result=result.model_dump(mode="json"))

        return run
