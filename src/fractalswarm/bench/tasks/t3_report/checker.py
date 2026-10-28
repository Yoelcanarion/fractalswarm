"""T3's deterministic check: citation provenance (spec §11).

A finding cites a page with a quote. It passes only if the run itself fetched that page (so
the URL had provenance and the text passed the firewall) and the quote is in the text the agent
was shown. The evidence is the log's own record of the pages (``memory/sources.py``), which an
agent cannot write, so a made-up URL or a made-up quote is caught whatever the model says.

It checks that a citation is real, not that it supports the claim: that is the judge's job.
"""

import unicodedata
from typing import Any, Protocol

MIN_QUOTE_CHARS = 20
MAX_QUOTE_CHARS = 400
PLAIN = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


class Sources(Protocol):
    def page(self, url: str) -> str | None: ...


def normalize(text: str) -> str:
    """Casefolded, whitespace-collapsed, with typographic quotes and dashes made plain."""
    return " ".join(unicodedata.normalize("NFKC", text).translate(PLAIN).split()).casefold()


def check_findings(findings: list[dict[str, Any]], sources: Sources | None) -> list[str]:
    """Why each citation fails, in plain English (they go back to the agent as feedback)."""
    if sources is None:
        return ["no record of the pages this run fetched, so no citation can be verified"]
    failures = []
    for number, finding in enumerate(findings, start=1):
        url, quote = finding["url"], normalize(finding["quote"])
        label = f"finding {number} ({url})"
        page = sources.page(url)
        if page is None:
            failures.append(
                f"{label}: this run never fetched that page; cite only pages you fetched"
            )
        elif len(quote) < MIN_QUOTE_CHARS:
            failures.append(f"{label}: the quote is shorter than {MIN_QUOTE_CHARS} characters")
        elif len(quote) > MAX_QUOTE_CHARS:
            failures.append(f"{label}: the quote is longer than {MAX_QUOTE_CHARS} characters")
        elif quote not in normalize(page):
            failures.append(f"{label}: the quote is not in the text of the page you fetched")
    return failures
