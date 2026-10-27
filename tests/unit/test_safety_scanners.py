"""PII and secret scanners, the Contributor gate, and cassette redaction reusing them."""

import re

import pytest
from hypothesis import given
from hypothesis import strategies as st

from fractalswarm.llm import cassette
from fractalswarm.llm.client import LLMClient, LLMRequest
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.llm.roles import RoleTable
from fractalswarm.market.prices import PriceTable
from fractalswarm.safety.scanners import (
    SECRET_PATTERNS,
    contributor_gate,
    dni_nie_ok,
    iban_ok,
    luhn_ok,
    redact_findings,
    scan_text,
)


def kinds(text: str) -> list[str]:
    return scan_text(text).kinds


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("write to ana.lopez@example.org today", ["email"]),
        ("call me at +34 612 345 678 tomorrow", ["phone"]),
        ("my number is (555) 123-4567", ["phone"]),
        ("card 4111 1111 1111 1111 exp 12/29", ["card"]),
        ("IBAN ES91 2100 0418 4502 0005 1332", ["iban"]),
        ("DNI 12345678Z", ["dni_nie"]),
        ("NIE X1234567L", ["dni_nie"]),
        ("key LLM_123456_abcdefGHIJ", ["meta_api_key"]),
        ("Authorization: Bearer abc.def", ["bearer_token"]),
        ("token hf_abcdefghijklmnopqrstuvwxyz", ["hf_token"]),
        ("aws AKIAABCDEFGHIJKLMNOP", ["aws_access_key"]),
        ("-----BEGIN RSA PRIVATE KEY-----", ["private_key"]),
    ],
)
def test_scanners_find_each_kind(text: str, expected: list[str]) -> None:
    assert kinds(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "I can present on day 2 in the morning; about 80 seats, room B.",
        "The conference runs 2026-11-04 to 2026-11-06.",
        "card 4111 1111 1111 1112",  # fails Luhn
        "IBAN ES00 2100 0418 4502 0005 1332",  # fails mod 97
        "DNI 12345678A",  # wrong control letter
        "version 1.2.3, port 8080",
    ],
)
def test_clean_or_invalid_text_is_not_flagged(text: str) -> None:
    assert kinds(text) == []


def test_checksums() -> None:
    assert luhn_ok("4111111111111111") and not luhn_ok("4111111111111112")
    assert iban_ok("GB82 WEST 1234 5698 7654 32") and not iban_ok("GB82 WEST 1234 5698 7654 33")
    assert dni_nie_ok("12345678Z") and dni_nie_ok("Y1234567X") and not dni_nie_ok("12345678Y")


def test_redact_findings_hides_every_match() -> None:
    text = "Ana: ana@example.org, +34 612 345 678, key LLM_1_secretvalue"
    clean = redact_findings(text)
    assert "ana@example.org" not in clean and "612 345 678" not in clean
    assert "LLM_1_secretvalue" not in clean
    assert "[REDACTED:email]" in clean and "[REDACTED:phone]" in clean


@given(st.text(alphabet=st.characters(categories=("L", "Zs", "P")), max_size=200))
def test_letters_and_punctuation_alone_are_never_cards_or_phones(text: str) -> None:
    assert not {"card", "phone", "iban"} & set(kinds(text))


def test_cassette_redaction_reuses_the_scanner_patterns() -> None:
    assert cassette.SECRET_PATTERNS is SECRET_PATTERNS
    assert [p.pattern for p in SECRET_PATTERNS] == [
        r"(?i)(bearer\s+)[^\s\"']+",
        r"LLM_\d+_[A-Za-z0-9_\-]+",
        r"hf_[A-Za-z0-9]{20,}",
        r"sk-[A-Za-z0-9_\-]{20,}",
    ]
    value = {
        "headers": {"Authorization": "Bearer LLM_1_x", "x": "Bearer abc"},
        "text": "use LLM_42_s3cr3t-value and sk-" + "a" * 24 + " and mysecret",
    }
    out = cassette.redact(value, ["mysecret"])
    assert out["headers"]["Authorization"] == "[REDACTED]"
    assert out["headers"]["x"] == "Bearer [REDACTED]"
    assert out["text"] == "use [REDACTED] and [REDACTED] and [REDACTED]"
    # PII is not part of cassette redaction: its behavior is unchanged.
    assert cassette.redact("ana@example.org") == "ana@example.org"
    assert all(isinstance(p, re.Pattern) for p in SECRET_PATTERNS)


def test_contributor_gate() -> None:
    assert not contributor_gate("hello", opted_in=False).contributor
    assert not contributor_gate("hello", opted_in=True, sensitive=True).contributor
    flagged = contributor_gate(["Call +34 612 345 678"], opted_in=True)
    assert not flagged.contributor and flagged.findings == ["phone"]
    assert contributor_gate({"text": "Summarize the talk abstracts."}, opted_in=True).contributor


def client() -> LLMClient:
    return LLMClient(FakeBackend(), roles=RoleTable.load(), prices=PriceTable.load(), mode="live")


def test_client_keeps_flagged_content_off_contributor_models() -> None:
    clean = LLMRequest(role="agent", level="L1", input="Summarize.", contributor=True)
    model, _, _ = client().build(clean)
    assert model == "muse-spark-1.3-contributor"
    flagged = clean.model_copy(update={"input": "Email ana@example.org the schedule."})
    model, _, _ = client().build(flagged)
    assert model == "muse-spark-1.3"
