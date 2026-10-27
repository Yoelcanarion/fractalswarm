"""The fetch policy and tool: provenance, SSRF, rebinding, robots.txt, limits. No network:
every request goes to an ``httpx.MockTransport`` and every lookup to a fake resolver."""

import asyncio

import httpx
import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.safety.capabilities import Capabilities, ToolDeniedError
from fractalswarm.safety.fetch_policy import (
    FetchBlocked,
    FetchLimits,
    Provenance,
    blocked_ip_reason,
    check_url,
    normalize_url,
    robots_allows,
)
from fractalswarm.tools.fetch import Fetcher, html_to_text

GRANTED = Capabilities(granted=frozenset({"fetch"}))
PUBLIC = {"example.org": ["93.184.215.14"], "cdn.example.net": ["151.101.1.1"]}
PAGE = "<html><head><style>x{}</style><script>evil()</script></head><body><p>Hello</p></body>"


def resolver(table: dict[str, list[str]] | None = None):
    table = PUBLIC if table is None else table

    async def resolve(host: str, port: int) -> list[str]:
        if host not in table:
            raise OSError("NXDOMAIN")
        return table[host]

    return resolve


def site(routes: dict[str, httpx.Response | Exception], seen: list[str] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(f"{request.method} {request.url}")
        response = routes.get(str(request.url))
        if response is None:
            return httpx.Response(404)
        if isinstance(response, Exception):
            raise response
        return response

    return httpx.MockTransport(handler)


def html(body: str = PAGE, **headers) -> httpx.Response:
    return httpx.Response(
        200, headers={"content-type": "text/html; charset=utf-8", **headers}, text=body
    )


def fetcher(routes, urls=("https://example.org/talks",), table=None, limits=None, seen=None):
    client = httpx.AsyncClient(transport=site(routes, seen))
    return Fetcher(client, Provenance(urls, "task"), limits=limits, resolver=resolver(table))


async def test_fetch_happy_path_strips_markup() -> None:
    seen: list[str] = []
    tool = fetcher(
        {
            "https://example.org/robots.txt": httpx.Response(200, text="User-agent: *\nAllow: /"),
            "https://example.org/talks": html(),
        },
        seen=seen,
    )
    result = await tool.fetch("https://example.org/talks#x", GRANTED)
    assert result.text == "Hello" and result.provenance == "task"
    assert seen == ["GET https://example.org/robots.txt", "GET https://example.org/talks"]


async def test_deny_by_default() -> None:
    tool = fetcher({"https://example.org/talks": html()})
    with pytest.raises(ToolDeniedError):
        await tool.fetch("https://example.org/talks", Capabilities())
    with pytest.raises(ToolDeniedError, match="unknown tool"):
        GRANTED.require("shell")


async def test_url_without_provenance_is_refused_before_any_request() -> None:
    seen: list[str] = []
    tool = fetcher({}, seen=seen)
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch("https://example.org/other", GRANTED)
    assert exc.value.code == "provenance" and seen == []


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("ftp://example.org/x", "scheme"),
        ("file:///etc/passwd", "scheme"),
        ("https://example.org:8443/x", "port"),
        ("https://user:pw@example.org/x", "credentials"),
        ("https:///nohost", "bad_url"),
    ],
)
def test_static_url_checks(url: str, code: str) -> None:
    with pytest.raises(FetchBlocked) as exc:
        check_url(url, FetchLimits(), None)
    assert exc.value.code == code


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "0.0.0.0",
        "100.64.0.1",
        "224.0.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "2002:7f00:0001::1",
    ],
)
def test_blocked_addresses(address: str) -> None:
    assert blocked_ip_reason(address) is not None


@pytest.mark.parametrize("address", ["93.184.215.14", "8.8.8.8", "2606:4700:4700::1111"])
def test_public_addresses(address: str) -> None:
    assert blocked_ip_reason(address) is None


@pytest.mark.parametrize(
    ("url", "table"),
    [
        ("https://internal.example.org/", {"internal.example.org": ["10.0.0.5"]}),
        ("https://mixed.example.org/", {"mixed.example.org": ["93.184.215.14", "127.0.0.1"]}),
        ("http://169.254.169.254/latest/meta-data/", {}),
        ("http://[::1]/", {}),
    ],
)
async def test_ssrf_is_blocked_after_resolution(url: str, table) -> None:
    seen: list[str] = []
    tool = fetcher({url: html()}, urls=[url], table=table, seen=seen)
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch(url, GRANTED)
    assert exc.value.code == "ssrf" and seen == []


async def test_dns_rebinding_between_checks_is_refused() -> None:
    answers = iter([["93.184.215.14"], ["93.184.215.15"]])

    async def flapping(host: str, port: int) -> list[str]:
        return next(answers)

    client = httpx.AsyncClient(transport=site({}))
    limits = FetchLimits(respect_robots=False)
    tool = Fetcher(client, Provenance(["https://example.org/a"]), limits=limits, resolver=flapping)
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch("https://example.org/a", GRANTED)
    assert exc.value.code == "dns_rebinding"


async def test_redirect_to_a_private_address_is_blocked() -> None:
    table = PUBLIC | {"metadata.internal": ["169.254.169.254"]}
    tool = fetcher(
        {
            "https://example.org/talks": httpx.Response(
                302, headers={"location": "http://metadata.internal/latest"}
            ),
        },
        table=table,
        limits=FetchLimits(respect_robots=False),
    )
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch("https://example.org/talks", GRANTED)
    assert exc.value.code == "ssrf"


async def test_public_redirect_is_followed_without_provenance() -> None:
    tool = fetcher(
        {
            "https://example.org/talks": httpx.Response(
                301, headers={"location": "https://cdn.example.net/talks"}
            ),
            "https://cdn.example.net/talks": html(),
        },
        limits=FetchLimits(respect_robots=False),
    )
    result = await tool.fetch("https://example.org/talks", GRANTED)
    assert result.final_url == "https://cdn.example.net/talks"


async def test_redirect_loop_is_cut() -> None:
    loop = httpx.Response(302, headers={"location": "https://example.org/talks"})
    tool = fetcher({"https://example.org/talks": loop}, limits=FetchLimits(respect_robots=False))
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch("https://example.org/talks", GRANTED)
    assert exc.value.code == "redirects"


@pytest.mark.parametrize(
    ("robots", "allowed"),
    [
        (httpx.Response(200, text="User-agent: *\nDisallow: /talks"), False),
        (httpx.Response(200, text="User-agent: FractalSwarmBot\nDisallow: /"), False),
        (httpx.Response(200, text="User-agent: OtherBot\nDisallow: /"), True),
        (httpx.Response(404), True),
        (httpx.Response(403), False),
        (httpx.Response(503), False),
        (httpx.ConnectError("down"), False),
    ],
)
async def test_robots_txt(robots, allowed: bool) -> None:
    tool = fetcher({"https://example.org/robots.txt": robots, "https://example.org/talks": html()})
    if allowed:
        assert (await tool.fetch("https://example.org/talks", GRANTED)).text == "Hello"
    else:
        with pytest.raises(FetchBlocked) as exc:
            await tool.fetch("https://example.org/talks", GRANTED)
        assert exc.value.code == "robots"


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (
            httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF"),
            "content_type",
        ),
        (
            httpx.Response(200, headers={"content-type": "text/plain"}, content=b"x" * 2001),
            "too_large",
        ),
        (httpx.Response(500, headers={"content-type": "text/html"}), "status"),
    ],
)
async def test_type_size_and_status_limits(response, code: str) -> None:
    limits = FetchLimits(max_bytes=2000, respect_robots=False)
    tool = fetcher({"https://example.org/talks": response}, limits=limits)
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch("https://example.org/talks", GRANTED)
    assert exc.value.code == code


async def test_streamed_body_over_the_limit_without_content_length() -> None:
    async def stream():
        for _ in range(10):
            yield b"y" * 500

    response = httpx.Response(200, headers={"content-type": "text/plain"}, content=stream())
    limits = FetchLimits(max_bytes=2000, respect_robots=False)
    tool = fetcher({"https://example.org/talks": response}, limits=limits)
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch("https://example.org/talks", GRANTED)
    assert exc.value.code == "too_large"


async def test_time_limit() -> None:
    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return html()

    client = httpx.AsyncClient(transport=httpx.MockTransport(slow))
    limits = FetchLimits(timeout_s=0.05, respect_robots=False)
    tool = Fetcher(
        client, Provenance(["https://example.org/talks"]), limits=limits, resolver=resolver()
    )
    with pytest.raises(FetchBlocked) as exc:
        await tool.fetch("https://example.org/talks", GRANTED)
    assert exc.value.code == "timeout"


def test_robots_parser_and_html_text() -> None:
    assert not robots_allows("User-agent: *\nDisallow: /private", "https://a.org/private/x")
    assert robots_allows("User-agent: *\nDisallow: /private", "https://a.org/public")
    assert html_to_text("<p>a</p><script>b</script><p>c &amp; d</p>") == "a\nc & d"


@given(
    st.sampled_from(["http", "https", "HTTPS"]),
    st.sampled_from(["Example.org", "example.org"]),
    st.sampled_from(["", ":443", ":80"]),
    st.sampled_from(["/a", "/a?b=1", ""]),
)
def test_normalized_urls_are_stable(scheme, host, port, path) -> None:
    url = f"{scheme}://{host}{port}{path}#frag"
    once = normalize_url(url)
    assert normalize_url(once) == once
    assert "#" not in once and once.startswith(scheme.lower() + "://example.org")
