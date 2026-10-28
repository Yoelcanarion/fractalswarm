"""The ``fetch`` policy (spec §13): provenance, SSRF guards, robots.txt, size and time.

- **Provenance**: a URL may be fetched only if it appeared in the task or in ``web_search``
  results of this run. Redirect hops must pass every other check.
- **Scheme and port**: http/https on 80/443 only; no credentials in the URL.
- **SSRF**: the host is resolved, and every address must be public (no loopback, private,
  link-local, multicast, reserved, unspecified, CGNAT, or IPv4 hidden in IPv6). It is resolved
  again right before the request; a changed answer (DNS rebinding) is refused.
- **robots.txt** is respected for our user agent; an unreadable robots.txt (401/403/5xx or a
  network error) means "disallow", a missing one (404) means "allow".
- **Limits**: GET only, 2 MB, 10 s, text/html or text/plain. The extracted text an agent gets
  is cut at ``max_text_chars``.
"""

import asyncio
import contextlib
import ipaddress
import socket
from collections.abc import Awaitable, Callable, Iterable
from urllib.parse import SplitResult, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

from pydantic import BaseModel, ConfigDict

USER_AGENT = "FractalSwarmBot/0.1 (+https://github.com/Yoelcanarion)"
DEFAULT_PORTS = {"http": 80, "https": 443}

Resolver = Callable[[str, int], Awaitable[list[str]]]


class FetchLimits(BaseModel):
    model_config = ConfigDict(frozen=True)

    max_bytes: int = 2 * 1024 * 1024
    max_text_chars: int = 8_000  # of the extracted text: an agent's context budget
    timeout_s: float = 10.0
    content_types: frozenset[str] = frozenset({"text/html", "text/plain"})
    schemes: frozenset[str] = frozenset({"http", "https"})
    ports: frozenset[int] = frozenset({80, 443})
    max_redirects: int = 3
    user_agent: str = USER_AGENT
    respect_robots: bool = True


class FetchBlocked(Exception):
    """The policy refused a fetch. ``code`` is stable, for audit events and tests."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


def normalize_url(url: str) -> str:
    """Lowercase scheme and host, drop the fragment and a default port."""
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if ":" in host:
        host = f"[{host}]"
    port = parts.port if parts.port is not None else None
    netloc = host if port is None or DEFAULT_PORTS.get(scheme) == port else f"{host}:{port}"
    return urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))


class Provenance:
    """The URLs this run may fetch, with where each came from."""

    def __init__(self, urls: Iterable[str] = (), source: str = "task") -> None:
        self.sources: dict[str, str] = {}
        self.add_all(urls, source)

    def add(self, url: str, source: str) -> None:
        with contextlib.suppress(ValueError):  # an unparsable URL can never be fetched
            self.sources.setdefault(normalize_url(url), source)

    def add_all(self, urls: Iterable[str], source: str) -> None:
        for url in urls:
            self.add(url, source)

    def source_of(self, url: str) -> str | None:
        try:
            return self.sources.get(normalize_url(url))
        except ValueError:
            return None


def check_url(url: str, limits: FetchLimits, provenance: Provenance | None) -> SplitResult:
    """Static checks; ``provenance=None`` skips the provenance rule (for redirect hops)."""
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError as exc:
        raise FetchBlocked("bad_url", str(exc)) from None
    scheme = parts.scheme.lower()
    if scheme not in limits.schemes:
        raise FetchBlocked("scheme", f"scheme {scheme!r} is not allowed")
    if not parts.hostname:
        raise FetchBlocked("bad_url", "no host")
    if parts.username or parts.password:
        raise FetchBlocked("credentials", "URLs with credentials are not allowed")
    effective = port if port is not None else DEFAULT_PORTS[scheme]
    if effective not in limits.ports:
        raise FetchBlocked("port", f"port {effective} is not allowed")
    if provenance is not None and provenance.source_of(url) is None:
        raise FetchBlocked("provenance", "the URL did not appear in the task or search results")
    return parts


def blocked_ip_reason(address: str) -> str | None:
    """Why an address must not be contacted, or None if it is a public unicast address."""
    try:
        ip = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return f"{address!r} is not an IP address"
    if isinstance(ip, ipaddress.IPv6Address):
        embedded = ip.ipv4_mapped or ip.sixtofour
        if embedded is None and ip.teredo is not None:
            embedded = ip.teredo[1]
        if embedded is not None:
            inner = blocked_ip_reason(str(embedded))
            return f"IPv4 embedded in IPv6: {inner}" if inner else None
    checks = (
        ("loopback", ip.is_loopback),
        ("private", ip.is_private),
        ("link-local", ip.is_link_local),
        ("multicast", ip.is_multicast),
        ("reserved", ip.is_reserved),
        ("unspecified", ip.is_unspecified),
        ("shared (CGNAT)", ip in ipaddress.ip_network("100.64.0.0/10")),
        ("not global", not ip.is_global),
    )
    for name, hit in checks:
        if hit:
            return f"{ip} is {name}"
    return None


async def system_resolver(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP
    )
    return sorted({info[4][0] for info in infos})


async def resolve_public(host: str, port: int, resolver: Resolver) -> list[str]:
    """Every address of ``host``; raises unless all of them are public."""
    try:
        ipaddress.ip_address(host.strip("[]"))
        addresses = [host.strip("[]")]
    except ValueError:
        try:
            addresses = sorted(set(await resolver(host, port)))
        except OSError as exc:
            raise FetchBlocked("dns", f"cannot resolve {host}: {exc}") from None
    if not addresses:
        raise FetchBlocked("dns", f"{host} has no addresses")
    for address in addresses:
        reason = blocked_ip_reason(address)
        if reason is not None:
            raise FetchBlocked("ssrf", f"{host} resolves to a blocked address: {reason}")
    return addresses


def robots_allows(robots_txt: str, url: str, user_agent: str = USER_AGENT) -> bool:
    parser = RobotFileParser()
    parser.parse(robots_txt.splitlines())
    return parser.can_fetch(user_agent, url)


def robots_url(parts: SplitResult) -> str:
    return urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))


def content_type_ok(header: str | None, limits: FetchLimits) -> bool:
    media = (header or "").split(";")[0].strip().lower()
    return media in limits.content_types
