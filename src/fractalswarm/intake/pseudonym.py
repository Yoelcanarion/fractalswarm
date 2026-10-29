"""Pseudonyms for the people in a live input.

A run's log can be shown, replayed on another machine and filmed, so an email address a person
typed must not reach it: every address is replaced by ``person-NN@example.invalid`` before the
text is logged or sent to a model. Names are optional (``mask_names``): they are free text, and
replacing them is best effort. The mapping back (``pseudonym -> real``) stays in the private
directory, next to the input it belongs to, and is never part of a run.

Numbering follows the order of first appearance, so the same text always gets the same
pseudonyms. Masking is idempotent: a pseudonym is left as it is.
"""

import re
from typing import Any

from fractalswarm.safety.scanners import PII_RULES

DOMAIN = "example.invalid"
EMAIL = PII_RULES["email"]


class Pseudonyms:
    def __init__(self, emails: dict[str, str] | None = None) -> None:
        self.emails: dict[str, str] = dict(emails or {})  # real address (lowercase) -> pseudonym
        self.names: dict[str, str] = {}  # real name -> pseudonym

    def email(self, address: str) -> str:
        key = address.lower()
        if key.endswith("@" + DOMAIN):
            return address
        if key not in self.emails:
            self.emails[key] = f"person-{len(self.emails) + 1:02d}@{DOMAIN}"
        return self.emails[key]

    def mask(self, text: str) -> str:
        """``text`` with every email address replaced."""
        return EMAIL.sub(lambda found: self.email(found.group(0)), text)

    def mask_value(self, value: Any) -> Any:
        """Every string inside a JSON-like value, masked."""
        if isinstance(value, str):
            return self.mask(value)
        if isinstance(value, list):
            return [self.mask_value(item) for item in value]
        if isinstance(value, dict):
            return {key: self.mask_value(item) for key, item in value.items()}
        return value

    def mask_names(self, value: Any, names: list[str]) -> Any:
        """``value`` with each of ``names`` replaced by ``Speaker NN`` (longest names first, so
        "Ana Ruiz" goes before "Ana"). Whole words only, any case."""
        for name in sorted({n for n in names if n.strip()}, key=lambda n: (-len(n), n)):
            self.names.setdefault(name, f"Speaker {len(self.names) + 1:02d}")
        ordered = sorted(self.names, key=lambda n: (-len(n), n))
        if not ordered:
            return value
        pattern = re.compile(
            r"(?<!\w)(" + "|".join(re.escape(name) for name in ordered) + r")(?!\w)", re.IGNORECASE
        )
        lowered = {name.casefold(): alias for name, alias in self.names.items()}

        def walk(item: Any) -> Any:
            if isinstance(item, str):
                return pattern.sub(lambda found: lowered[found.group(0).casefold()], item)
            if isinstance(item, list):
                return [walk(entry) for entry in item]
            if isinstance(item, dict):
                return {key: walk(entry) for key, entry in item.items()}
            return item

        return walk(value)

    def mapping(self) -> dict[str, dict[str, str]]:
        """pseudonym -> real, for the private file."""
        return {
            "emails": {alias: real for real, alias in sorted(self.emails.items())},
            "names": {alias: real for real, alias in sorted(self.names.items())},
        }
