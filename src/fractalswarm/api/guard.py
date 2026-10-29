"""Who may talk to the API: a page this server served, reached by a name it answers to.

The server listens on loopback, but the person's own browser is a way in for any page they open.
Three paths, each closed here for every route, present and future:

* DNS rebinding. A page on a name that re-resolves to 127.0.0.1 is same-origin with the API, so it
  could read every run (private ones too) and call every control. The ``Host`` header says what
  the browser thought it was talking to: one that is not ours is refused (400).
* A simple cross-site POST. A form or ``text/plain`` reaches the server with no CORS preflight.
  Every POST must say ``Content-Type: application/json`` (415): a cross-site page cannot send that
  without a preflight, and this server never answers one with permission.
* A cross-site WebSocket. Browsers apply no CORS to those. A handshake whose ``Origin`` is not this
  server's own is refused; one with no ``Origin`` at all (a CLI client) is allowed.
"""

import re
from collections.abc import Iterable
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.websockets import WebSocket

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
POLICY_VIOLATION = 1008  # the WebSocket close code browsers show for a refused handshake
# name or [ipv6], then an optional port: what a browser sends, and nothing that merely contains it
HOST_HEADER = re.compile(r"(?:\[(?P<v6>[0-9a-f:.]+)\]|(?P<name>[a-z0-9._-]+))(?::[0-9]{1,5})?")


def host_name(header: str) -> str | None:
    """The name or address in a ``Host`` header, lower-cased and without port or brackets, or
    ``None`` if the header is not the usual shape (``host``, ``host:port``, ``[::1]:port``)."""
    found = HOST_HEADER.fullmatch(header.strip().lower())
    return None if found is None else found["v6"] or found["name"]


def is_json(content_type: str) -> bool:
    return content_type.split(";", 1)[0].strip().lower() == "application/json"


def same_origin(origin: str, host: str) -> bool:
    """Is ``origin`` the page this server would have served at ``host`` (the Host it was reached
    by)? ``Origin: null`` (a sandboxed frame, a local file) is not."""
    parts = urlsplit(origin)
    return parts.scheme in ("http", "https") and parts.netloc.lower() == host.strip().lower()


class ApiGuard:
    """ASGI middleware. It is pure ASGI, not ``BaseHTTPMiddleware``, so it also sees WebSocket
    handshakes. ``hosts`` are the names that may reach the server beyond loopback (the address
    ``serve`` was given)."""

    def __init__(self, app: ASGIApp, hosts: Iterable[str] = ()) -> None:
        self.app = app
        extra = (name.strip().lower().strip("[]") for name in hosts)
        self.hosts = frozenset((*LOOPBACK_HOSTS, *extra))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            refusal = self.refusal(scope)
            if refusal is not None:
                status, message = refusal
                if scope["type"] == "websocket":
                    await WebSocket(scope, receive, send).close(POLICY_VIOLATION)
                else:
                    await JSONResponse({"error": message}, status_code=status)(scope, receive, send)
                return
        await self.app(scope, receive, send)

    def refusal(self, scope: Scope) -> tuple[int, str] | None:
        headers = Headers(scope=scope)
        host = headers.get("host", "")
        if host_name(host) not in self.hosts:
            return 400, "invalid host header"
        if scope["type"] == "websocket":
            origin = headers.get("origin")
            if origin is not None and not same_origin(origin, host):
                return 403, "this origin may not open a connection"
        elif scope["method"] == "POST" and not is_json(headers.get("content-type", "")):
            return 415, "a POST must have the content type application/json"
        return None
