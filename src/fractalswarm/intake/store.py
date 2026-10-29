"""The private directory (``FRACTALSWARM_PRIVATE_DIR``): what a person typed, and what came of it.

::

    <private>/intake/<id>/   the intake run (events.sqlite, cassette.jsonl, ...) and, next to it,
                             input.json (the pasted segments, emails already pseudonymized),
                             pseudonyms.json (pseudonym -> real), approved.json, approved.sha256
    <private>/runs/<id>/     runs on live input
    <private>/jobs/<id>/     the job manager's records and logs (api/jobs.py)
    <private>/pairs/<id>.json  arena pair manifests

It lives outside the repo like the secrets, so nothing in it is ever committed or bundled.
"""

import json
import os
import re
import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


def safe_id(value: str, what: str = "id") -> str:
    """``value`` if it is a plain file name (no separators, no dots at the start), else
    ``ValueError``: ids come from URLs and request bodies and become directory names."""
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value) or ".." in value:
        raise ValueError(f"{what} must be 1-80 letters, digits, dots, dashes or underscores")
    return value


def new_id(prefix: str) -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return f"{prefix}-{stamp}-{secrets.token_hex(2)}"


def write_json(path: Path, data: Any) -> None:
    """Write a JSON file atomically (a reader never sees half of it)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", "utf-8", newline="\n")
    os.replace(tmp, path)


def read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


class PrivateDir:
    def __init__(self, root: Path) -> None:
        self.root = root

    @property
    def intake(self) -> Path:
        return self.root / "intake"

    @property
    def runs(self) -> Path:
        return self.root / "runs"

    @property
    def jobs(self) -> Path:
        return self.root / "jobs"

    @property
    def pairs(self) -> Path:
        return self.root / "pairs"

    def intake_dir(self, intake_id: str) -> Path:
        return self.intake / safe_id(intake_id, "intake id")

    def input_file(self, intake_id: str) -> Path:
        return self.intake_dir(intake_id) / "input.json"

    def approved_file(self, intake_id: str) -> Path:
        return self.intake_dir(intake_id) / "approved.json"

    def approved(self, intake_id: str) -> dict[str, Any] | None:
        """The approved input of an intake, or ``None`` before it is approved."""
        return read_json(self.approved_file(intake_id))

    def write_approved(self, intake_id: str, approved: dict[str, Any]) -> None:
        directory = self.intake_dir(intake_id)
        write_json(directory / "approved.json", approved)
        (directory / "approved.sha256").write_text(approved["sha256"] + "\n", "utf-8", newline="\n")


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
