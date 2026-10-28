"""Seeded API faults (spec §8): the httpx2 transport for real backends and the fake wrapper.

No network: the real backend talks to an in-process ``httpx2.MockTransport``.
"""

from collections import Counter
from pathlib import Path

import httpx2
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from fractalswarm.llm.cassette import Cassette
from fractalswarm.llm.client import LLMClient, OpenAIBackend
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.roles import RoleTable
from fractalswarm.llm.transport import ApiFaults, FaultInjectingTransport, FaultyBackend, decide
from fractalswarm.market.prices import PriceTable

KEY = "LLM_1234567890_abcdefSECRETxyz"


async def no_sleep(virtual_ms: int) -> None:
    return None


def llm(backend, tmp_path: Path) -> LLMClient:
    cassette = Cassette(tmp_path / "cassette.jsonl", secrets=[KEY])
    return LLMClient(backend, roles=RoleTable.load(), prices=PriceTable.load(), cassette=cassette)


@settings(max_examples=30, deadline=None)
@given(rate=st.floats(0.05, 0.9), seed=st.text(max_size=6))
def test_decisions_are_seeded_and_match_the_rate(rate: float, seed: str) -> None:
    faults = ApiFaults(seed=seed, rate=rate)
    decisions = [decide(faults, f"eff-{n}:0") for n in range(1500)]
    assert decisions == [decide(faults, f"eff-{n}:0") for n in range(1500)]
    share = sum(d is not None for d in decisions) / len(decisions)
    assert abs(share - rate) < 0.06


def test_every_fault_kind_shows_up_with_its_shape() -> None:
    faults = ApiFaults(seed="kinds", rate=1.0)
    found = {}
    for n in range(400):
        fault = decide(faults, f"k{n}")
        assert fault is not None
        found.setdefault(fault.kind, fault)
    assert set(found) == {"429", "503", "timeout", "slow"}
    assert 1.0 <= found["429"].retry_after_s <= 4.0
    assert found["timeout"].delay_ms == faults.timeout_ms
    assert faults.slow_ms[0] <= found["slow"].delay_ms <= faults.slow_ms[1]
    assert decide(ApiFaults(rate=0.0), "k") is None


async def test_the_fake_sees_the_same_faults_in_every_run(tmp_path: Path) -> None:
    faults = ApiFaults(seed="run", rate=0.5)

    async def run(sub: str) -> tuple[list, list]:
        backend = FaultyBackend(FakeBackend(), faults)
        client = llm(backend, tmp_path / sub)
        outcomes = [
            await client.call(
                f"eff-{n}", {"role": "agent", "input": f"x{n}"}, run_id="r", sleep=no_sleep
            )
            for n in range(20)
        ]
        return backend.injected, [(o.status, o.result.get("attempts")) for o in outcomes]

    first, again = await run("a"), await run("b")
    assert first == again
    injected, outcomes = first
    assert {kind for _, kind in injected} >= {"429", "503"}
    assert any(attempts > 1 for _, attempts in outcomes)  # the client retried


async def test_a_429_carries_retry_after_and_the_client_waits_at_least_that(tmp_path: Path) -> None:
    faults = ApiFaults(seed="s", rate=1.0, mix={"429": 1.0}, retry_after_s=(3.0, 3.0))
    sleeps: list[int] = []

    async def sleep(virtual_ms: int) -> None:
        sleeps.append(virtual_ms)

    client = llm(FaultyBackend(FakeBackend(), faults), tmp_path)
    outcome = await client.call("eff-1", {"role": "agent", "input": "x"}, run_id="r", sleep=sleep)
    assert outcome.status == "error"
    assert outcome.result["http_status"] == 429 and outcome.result["retry_after_ms"] == 3000
    backoffs = [ms for ms in sleeps if ms != faults.fast_fail_ms]
    assert len(backoffs) == client.retry.max_attempts - 1 and min(backoffs) >= 3000


async def test_the_transport_injects_faults_in_front_of_a_real_backend(tmp_path: Path) -> None:
    served = Counter()
    body = {
        "id": "resp_1",
        "object": "response",
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}],
        "usage": {"input_tokens": 5, "output_tokens": 1},
    }

    def handle(request: httpx2.Request) -> httpx2.Response:
        served[request.url.path] += 1
        return httpx2.Response(200, json=body)

    waits: list[float] = []

    async def wall_sleep(seconds: float) -> None:
        waits.append(seconds)

    faults = ApiFaults(seed="t", rate=0.6)
    transport = FaultInjectingTransport(httpx2.MockTransport(handle), faults, wall_sleep=wall_sleep)
    backend = OpenAIBackend(KEY, "https://api.example.invalid/v1", transport=transport)
    client = llm(backend, tmp_path)
    outcomes = [
        await client.call(
            f"eff-{n}", {"role": "agent", "input": f"q{n}"}, run_id="r", sleep=no_sleep
        )
        for n in range(12)
    ]
    kinds = Counter(kind for _, kind in transport.injected)
    assert kinds and served["/v1/responses"] >= sum(o.status == "ok" for o in outcomes)
    statuses = {o.result["http_status"] for o in outcomes}
    assert 200 in statuses
    if kinds["timeout"] or kinds["slow"]:
        assert waits  # injected latency went through the (stubbed) wall clock
    text = (tmp_path / "cassette.jsonl").read_text(encoding="utf-8")
    assert KEY not in text
    if kinds["429"] or kinds["503"]:
        assert "(injected)" in text  # the faulty attempts land in the cassette


async def test_the_transport_raises_a_read_timeout() -> None:
    faults = ApiFaults(seed="t", rate=1.0, mix={"timeout": 1.0})

    async def wall_sleep(seconds: float) -> None:
        return None

    transport = FaultInjectingTransport(
        httpx2.MockTransport(lambda r: httpx2.Response(200)), faults, wall_sleep=wall_sleep
    )
    async with httpx2.AsyncClient(transport=transport) as http:
        with pytest.raises(httpx2.ReadTimeout):
            await http.post("https://api.example.invalid/v1/responses", json={"a": 1})
    assert transport.injected[0][1] == "timeout"
