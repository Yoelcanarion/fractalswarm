"""PII and secret scanners, and the Contributor gate (spec §7.5, §13).

The scanners are deterministic regexes with checksum validation where one exists (Luhn for
cards, mod-97 for IBAN, the control letter for DNI/NIE), so a match is a decision that
replays. ``SECRET_PATTERNS`` is also what ``llm/cassette.py`` redacts with.

The Contributor gate decides whether a call may go to ``muse-spark-1.3-contributor``, whose
prompts may be used to train Meta models: only when the task opted in, nothing is marked
sensitive, and no scanner flags the content.
"""

import re
from collections.abc import Iterable
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from fractalswarm.kernel.ids import canonical_json

REDACTED = "[REDACTED]"

# Secret-shaped strings. Order matters for redaction: a pattern with a group keeps group 1
# (the "Bearer " prefix) and replaces the rest. Cassette redaction uses exactly this tuple.
SECRET_RULES: dict[str, re.Pattern[str]] = {
    "bearer_token": re.compile(r"(?i)(bearer\s+)[^\s\"']+"),
    "meta_api_key": re.compile(r"LLM_\d+_[A-Za-z0-9_\-]+"),
    "hf_token": re.compile(r"hf_[A-Za-z0-9]{20,}"),
    "openai_style_key": re.compile(r"sk-[A-Za-z0-9_\-]{20,}"),
}
SECRET_PATTERNS: tuple[re.Pattern[str], ...] = tuple(SECRET_RULES.values())

# Extra secret detectors that only flag (they are not part of cassette redaction).
EXTRA_SECRET_RULES: dict[str, re.Pattern[str]] = {
    "aws_access_key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github_token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    "private_key": re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----"),
    "password_assignment": re.compile(r"(?i)\b(?:password|passwd|pwd)\s*[:=]\s*\S{6,}"),
}

PII_RULES: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
    # International or national numbers with at least 9 digits, optional separators.
    "phone": re.compile(r"(?<![\w+])(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?){2,4}\d{2,4}\b"),
    "iban": re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b"),
    "card": re.compile(r"\b(?:\d[ \-]?){12,18}\d\b"),
    "dni_nie": re.compile(r"\b[XYZ]?\d{7,8}[\s\-]?[A-Z]\b"),
}

DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"

Category = Literal["pii", "secret"]


class Finding(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: str
    category: Category
    start: int
    end: int


class ScanReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    findings: tuple[Finding, ...] = ()

    @property
    def flagged(self) -> bool:
        return bool(self.findings)

    @property
    def kinds(self) -> list[str]:
        return sorted({finding.kind for finding in self.findings})

    @property
    def has_secret(self) -> bool:
        return any(finding.category == "secret" for finding in self.findings)

    @property
    def has_pii(self) -> bool:
        return any(finding.category == "pii" for finding in self.findings)


def luhn_ok(digits: str) -> bool:
    numbers = [int(ch) for ch in digits if ch.isdigit()]
    if not 13 <= len(numbers) <= 19:
        return False
    total = 0
    for index, number in enumerate(reversed(numbers)):
        if index % 2 == 1:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def iban_ok(candidate: str) -> bool:
    compact = candidate.replace(" ", "").upper()
    if not 15 <= len(compact) <= 34:
        return False
    rearranged = compact[4:] + compact[:4]
    numeric = "".join(str(int(ch, 36)) for ch in rearranged)
    return int(numeric) % 97 == 1


def dni_nie_ok(candidate: str) -> bool:
    compact = re.sub(r"[\s\-]", "", candidate.upper())
    body, letter = compact[:-1], compact[-1]
    if body and body[0] in "XYZ":
        body = str("XYZ".index(body[0])) + body[1:]
    if not body.isdigit() or len(body) > 9:
        return False
    return DNI_LETTERS[int(body) % 23] == letter


def _phone_ok(candidate: str) -> bool:
    digits = sum(ch.isdigit() for ch in candidate)
    return 9 <= digits <= 15


VALIDATORS = {"card": luhn_ok, "iban": iban_ok, "dni_nie": dni_nie_ok, "phone": _phone_ok}


def scan_text(text: str) -> ScanReport:
    """Every PII and secret match in ``text``, in order of position."""
    findings: list[Finding] = []
    secret_rules = {**SECRET_RULES, **EXTRA_SECRET_RULES}
    for kind, pattern in secret_rules.items():
        for match in pattern.finditer(text):
            findings.append(
                Finding(kind=kind, category="secret", start=match.start(), end=match.end())
            )
    taken = [(f.start, f.end) for f in findings]
    # Cards and IBANs before phones, so a card number is not also reported as a phone.
    for kind in ("card", "iban", "dni_nie", "email", "phone"):
        for match in PII_RULES[kind].finditer(text):
            start, end = match.start(), match.end()
            if any(start < b and a < end for a, b in taken):
                continue
            validator = VALIDATORS.get(kind)
            if validator is not None and not validator(match.group(0)):
                continue
            findings.append(Finding(kind=kind, category="pii", start=start, end=end))
            taken.append((start, end))
    findings.sort(key=lambda f: (f.start, f.end, f.kind))
    return ScanReport(findings=tuple(findings))


def scan_value(value: Any) -> ScanReport:
    """Scan any JSON-compatible value (an LLM request input, a fact, a message body)."""
    return scan_text(value if isinstance(value, str) else canonical_json(value))


def redact_secrets(text: str, secrets: Iterable[str] = ()) -> str:
    """Replace known secret values, then every ``SECRET_PATTERNS`` match, with ``[REDACTED]``.

    ``secrets`` must already be sorted longest first (``llm/cassette.redact`` does that).
    """
    for secret in secrets:
        text = text.replace(secret, REDACTED)
    for pattern in SECRET_PATTERNS:
        text = pattern.sub(lambda m: (m.group(1) if m.groups() else "") + REDACTED, text)
    return text


def redact_findings(text: str, report: ScanReport | None = None) -> str:
    """Replace every finding with ``[REDACTED:<kind>]``, for logs and the UI."""
    report = report or scan_text(text)
    out, cursor = [], 0
    for finding in report.findings:
        if finding.start < cursor:
            continue
        out.append(text[cursor : finding.start])
        out.append(f"[REDACTED:{finding.kind}]")
        cursor = finding.end
    out.append(text[cursor:])
    return "".join(out)


class RoutingDecision(BaseModel):
    """The payload of a ``security.routed`` audit event."""

    model_config = ConfigDict(frozen=True)

    contributor: bool
    reason: str
    findings: list[str] = []


def contributor_gate(content: Any, *, opted_in: bool, sensitive: bool = False) -> RoutingDecision:
    """May this content go to a Contributor model? Fails closed on any flag."""
    if not opted_in:
        return RoutingDecision(contributor=False, reason="task did not opt in to Contributor")
    if sensitive:
        return RoutingDecision(contributor=False, reason="content is marked sensitive")
    report = scan_value(content)
    if report.flagged:
        return RoutingDecision(
            contributor=False,
            reason="scanners flagged PII or secrets; kept on the Standard model",
            findings=report.kinds,
        )
    return RoutingDecision(contributor=True, reason="opted in and content is clean")
