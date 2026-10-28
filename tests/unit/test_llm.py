"""The LLM layer: role routing, cost, retries, cassettes and redaction. No network at all:
the real backend runs against an in-process httpx2 MockTransport."""

import json
from pathlib import Path

import httpx2
import pytest

from fractalswarm.llm.cassette import (
    REDACTED,
    Cassette,
    CassetteBackend,
    CassetteMismatch,
    redact,
)
from fractalswarm.llm.client import (
    LLMClient,
    LLMRequest,
    OpenAIBackend,
    parse_rate_limits,
    parse_retry_after_ms,
)
from fractalswarm.llm.fake import FakeBackend, FakeReply
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.ledger import ProjectLedger
from fractalswarm.market.prices import PriceTable, Usage

FAKE_KEY = "LLM_1234567890_abcdefSECRETxyz"
ROLES = RoleTable.load()
PRICES = PriceTable.load()


class Sleeps:
    def __init__(self) -> None:
        self.calls: list[int] = []

    async def __call__(self, virtual_ms: int) -> None:
        self.calls.append(virtual_ms)


def client(backend, tmp_path: Path, **kwargs) -> LLMClient:
    cassette = Cassette(tmp_path / "cassette.jsonl", secrets=[FAKE_KEY])
    return LLMClient(backend, roles=ROLES, prices=PRICES, cassette=cassette, **kwargs)


def test_cost_follows_the_billing_rules() -> None:
    usage = Usage(input_tokens=1_000_000, cached_tokens=400_000, output_tokens=1_000_000)
    expected = 0.6 * 1.25 + 0.4 * 0.15 + 4.25
    assert PRICES.cost("muse-spark-1.3", usage) == pytest.approx(expected)
    assert PRICES.cost("muse-spark-1.3", Usage(searches=1000)) == pytest.approx(2.5)
    with pytest.raises(ValueError):
        PRICES.cost("gpt-unknown", usage)


def test_build_routes_roles_and_honors_contributor_only_where_allowed(tmp_path: Path) -> None:
    llm = client(FakeBackend(), tmp_path)
    model, body, max_output = llm.build(LLMRequest(role="root_planner", input="plan"))
    assert model == "muse-wonder-1.0"
    assert body["reasoning"] == {"effort": "high"}
    assert body["store"] is False
    assert body["max_output_tokens"] == max_output == 16384
    model, _, _ = llm.build(LLMRequest(role="agent", level="L1", input="x", contributor=True))
    assert model == "muse-spark-1.3-contributor"
    model, _, _ = llm.build(LLMRequest(role="agent", level="L0", input="x", contributor=True))
    assert model == "muse-spark-1.3"
    with pytest.raises(ValueError):
        llm.build(LLMRequest(role="nobody", input="x"))


def test_header_parsing() -> None:
    headers = {"X-RateLimit-Remaining-Requests": "12", "x-ratelimit-limit-tokens": "4000000"}
    assert parse_rate_limits(headers) == {
        "limit_requests": None,
        "remaining_requests": 12,
        "limit_tokens": 4000000,
        "remaining_tokens": None,
    }
    assert parse_retry_after_ms({"Retry-After": "2"}) == 2000
    assert parse_retry_after_ms({"retry-after": "0.5"}) == 500
    assert parse_retry_after_ms({"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"}) is None
    assert parse_retry_after_ms({}) is None


async def test_call_reports_usage_cost_and_stays_under_the_estimate(tmp_path: Path) -> None:
    llm = client(FakeBackend(script=lambda body, attempt: "hello"), tmp_path)
    request = {"role": "agent", "input": "say hello"}
    outcome = await llm.call("eff-1", request, run_id="r", sleep=Sleeps())
    assert outcome.status == "ok"
    assert outcome.result["output_text"] == "hello"
    assert outcome.result["rate_limits"]["remaining_requests"] == 2999
    usage = Usage(**outcome.result["usage"])
    assert outcome.result["cost_usd"] == pytest.approx(PRICES.cost("muse-spark-1.3", usage))
    assert 0 < outcome.result["cost_usd"] < llm.estimate(request)


async def test_retries_honor_retry_after_and_record_every_attempt(tmp_path: Path) -> None:
    def script(body, attempt):
        if attempt == 0:
            return FakeReply(status=429, error_type="rate_limit_error", retry_after_s=7)
        if attempt == 1:
            return FakeReply(status=503, text="overloaded")
        return "finally"

    sleeps = Sleeps()
    llm = client(FakeBackend(script=script), tmp_path)
    outcome = await llm.call("eff-1", {"role": "judge", "input": "x"}, run_id="r", sleep=sleeps)
    assert outcome.status == "ok"
    assert outcome.result["attempts"] == 3
    backoffs = sleeps.calls[1::2]  # the fake sleeps its latency before each reply
    assert backoffs[0] >= 7000
    assert 1000 <= backoffs[1] <= 2000 + 1000
    assert len(llm.cassette.get("eff-1").attempts) == 3


async def test_client_errors_are_not_retried(tmp_path: Path) -> None:
    reply = FakeReply(status=400, text="bad effort")
    llm = client(FakeBackend(script=lambda b, a: reply), tmp_path)
    outcome = await llm.call("eff-1", {"role": "judge", "input": "x"}, run_id="r", sleep=Sleeps())
    assert outcome.status == "error"
    assert outcome.result["error"] == "bad effort"
    assert outcome.result["attempts"] == 1
    assert outcome.result["cost_usd"] == 0


async def test_truncation_is_reported_as_incomplete(tmp_path: Path) -> None:
    reply = FakeReply(text="long", output_tokens=5000)
    llm = client(FakeBackend(script=lambda b, a: reply), tmp_path)
    outcome = await llm.call("eff-1", {"role": "judge", "input": "x"}, run_id="r", sleep=Sleeps())
    assert outcome.status == "incomplete"
    assert outcome.result["incomplete_reason"] == "max_output_tokens"


def test_redaction() -> None:
    value = {
        "headers": {"Authorization": f"Bearer {FAKE_KEY}", "x-request-id": "abc"},
        "note": f"key {FAKE_KEY} and hf_abcdefghijklmnopqrstuvwxyz and Bearer tok123",
        "items": ["my-own-secret here"],
    }
    clean = redact(value, secrets=["my-own-secret"])
    text = json.dumps(clean)
    assert FAKE_KEY not in text and "hf_abc" not in text and "tok123" not in text
    assert "my-own-secret" not in text
    assert clean["headers"]["Authorization"] == REDACTED
    assert clean["headers"]["x-request-id"] == "abc"


def test_redaction_leaves_opaque_blobs_intact_but_known_secrets() -> None:
    # A real reasoning blob held "hf_" + 50 letters; redacting it broke the run's replay.
    blob = "Q4Fx76bFNP56RS_hf_MCZTSVlXwuGj8KtMa4HVAC6G5n4cXx0RhxMXsCq8SVw4YT-JY5nk9"
    value = {
        "output": [
            {"type": "reasoning", "encrypted_content": blob},
            {"type": "reasoning", "encrypted_content": f"x{FAKE_KEY}x"},
            {"type": "message", "text": blob},
        ]
    }
    clean = redact(value, secrets=[FAKE_KEY])
    assert clean["output"][0]["encrypted_content"] == blob
    assert clean["output"][1]["encrypted_content"] == f"x{REDACTED}x"
    assert REDACTED in clean["output"][2]["text"]  # readable text keeps the patterns


async def test_cassette_replays_the_same_outcome_and_rejects_other_requests(
    tmp_path: Path,
) -> None:
    llm = client(FakeBackend(), tmp_path)
    request = {"role": "agent", "input": "one"}
    recorded = await llm.call("eff-1", request, run_id="r", sleep=Sleeps())

    cassette = Cassette(tmp_path / "cassette.jsonl")
    replayer = LLMClient(
        CassetteBackend(cassette), roles=ROLES, prices=PRICES, mode="replay", cassette=cassette
    )
    replayed = await replayer.call("eff-1", request, run_id="r", sleep=Sleeps())
    assert replayed == recorded
    other = {"role": "agent", "input": "two"}
    with pytest.raises(CassetteMismatch, match="differs"):
        await replayer.call("eff-1", other, run_id="r", sleep=Sleeps())
    with pytest.raises(CassetteMismatch, match="no cassette entry"):
        await replayer.call("eff-9", request, run_id="r", sleep=Sleeps())


async def test_the_log_holds_the_redacted_reply_that_replay_reads(tmp_path: Path) -> None:
    # Readable text can look like a secret ("bearer of", the "sk-" in "risk-"): the cassette
    # redacts it, so the outcome the run logs must be the redacted one or the run diverges.
    text = "the bearer of the keynote; slug risk-assessment-for-distributed-systems"
    llm = client(FakeBackend(script=lambda body, attempt: text), tmp_path)
    request = {"role": "agent", "input": "x"}
    recorded = await llm.call("eff-1", request, run_id="r", sleep=Sleeps())
    assert recorded.result["output_text"] == f"the bearer {REDACTED} the keynote; slug ri{REDACTED}"

    cassette = Cassette(tmp_path / "cassette.jsonl")
    replayer = LLMClient(
        CassetteBackend(cassette), roles=ROLES, prices=PRICES, mode="replay", cassette=cassette
    )
    assert await replayer.call("eff-1", request, run_id="r", sleep=Sleeps()) == recorded


async def test_project_ledger_reserves_and_settles_real_spend(tmp_path: Path) -> None:
    ledger = ProjectLedger(tmp_path / "ledger.sqlite", cap_usd=1.0)
    llm = client(FakeBackend(), tmp_path, project_ledger=ledger)
    outcome = await llm.call("eff-1", {"role": "agent", "input": "x"}, run_id="r", sleep=Sleeps())
    summary = ledger.summary()
    assert summary.spent_usd == pytest.approx(outcome.result["cost_usd"])
    assert summary.reserved_usd == 0

    tiny = ProjectLedger(tmp_path / "tiny.sqlite", cap_usd=0.0001)
    backend = FakeBackend()
    llm = client(backend, tmp_path / "tiny", project_ledger=tiny)
    outcome = await llm.call("eff-2", {"role": "agent", "input": "x"}, run_id="r", sleep=Sleeps())
    assert outcome.status == "refused"
    assert backend.calls == 0
    assert llm.cassette.get("eff-2").refusal


async def test_openai_backend_records_without_the_key(tmp_path: Path) -> None:
    seen: list[httpx2.Request] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        if len(seen) == 1:
            error = {"message": "slow down", "type": "rate_limit_error", "code": None}
            return httpx2.Response(429, json={"error": error}, headers={"retry-after": "1"})
        body = {
            "id": "resp_1",
            "status": "completed",
            "model": "muse-spark-1.3",
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": "ok"}]},
            ],
            "usage": {"input_tokens": 12, "output_tokens": 30},
        }
        headers = {"x-ratelimit-remaining-requests": "2998", "set-cookie": "session=abc"}
        return httpx2.Response(200, json=body, headers=headers)

    backend = OpenAIBackend(
        FAKE_KEY, "https://api.example.invalid/v1", transport=httpx2.MockTransport(handle)
    )
    llm = client(backend, tmp_path)
    outcome = await llm.call("eff-1", {"role": "judge", "input": "hi"}, run_id="r", sleep=Sleeps())

    assert outcome.status == "ok" and outcome.result["output_text"] == "ok"
    assert outcome.result["attempts"] == 2
    assert seen[0].headers["authorization"] == f"Bearer {FAKE_KEY}"
    sent = json.loads(seen[0].content)
    assert sent["store"] is False and sent["model"] == "muse-spark-1.3"
    text = (tmp_path / "cassette.jsonl").read_text(encoding="utf-8")
    assert FAKE_KEY not in text and "session=abc" not in text
