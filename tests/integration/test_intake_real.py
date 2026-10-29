"""The reading of pasted text with the real model, against a stand-in for the Meta API.

``fractalswarm intake --backend real`` is what the API starts for a billed reading
(api/spend.py). Nothing here calls the API: ``OpenAIBackend`` is replaced by a stub that answers
like the fake reader and notes what the project ledger held when each request arrived. The
ledger, the private directory and the key are the test's own (the key is not a key).
"""

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from fractalswarm.bench.tasks.t2_conference.generator import live_sample
from fractalswarm.cli import INTAKE_RUN_CAP_USD, app
from fractalswarm.intake import service
from fractalswarm.intake.fake import intake_backend
from fractalswarm.intake.store import PrivateDir
from fractalswarm.llm import client as llm_client
from fractalswarm.llm.cassette import Attempt
from fractalswarm.market.ledger import ProjectLedger

KEY = "not-a-real-key"
PROJECT_CAP_USD = 150.0
INTAKE_ID = "intake-real"
BILLED = [
    "intake",
    INTAKE_ID,
    "--backend",
    "real",
    "--confirm-real-spend",
    "--no-paid-retries",
    "--firewall",
    "heuristic",
]
SAMPLE = live_sample(1)


class Box:
    """A private directory with one intake waiting to be read, an empty ledger, and a stub for
    the API that fails the requests it is told to."""

    def __init__(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.ledger_path = tmp_path / "ledger.sqlite"
        self.private = PrivateDir(tmp_path / "private")
        self.keys: list[str] = []
        self.sent: Counter[str] = Counter()  # requests received, by effect
        self.seen: list[tuple[float, float]] = []  # (reserved, spent) when a request arrived
        self.fail_first_with: int | None = None
        monkeypatch.setenv("FRACTALSWARM_PRIVATE_DIR", str(self.private.root))
        monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(self.ledger_path))
        monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path / "runs"))
        monkeypatch.setenv("FRACTALSWARM_PROJECT_CAP_USD", str(PROJECT_CAP_USD))
        monkeypatch.setenv("MODEL_API_KEY", KEY)
        box = self

        class StubApi:
            def __init__(self, api_key: str, base_url: str = "", **_: Any) -> None:
                box.keys.append(api_key)
                self.inner = intake_backend()

            async def send(self, effect_id: str, body: dict[str, Any], sleep: Any) -> Attempt:
                box.sent[effect_id] += 1
                summary = ProjectLedger(box.ledger_path, PROJECT_CAP_USD).summary()
                box.seen.append((summary.reserved_usd, summary.spent_usd))
                if box.fail_first_with and sum(box.sent.values()) == 1:
                    return Attempt(status=box.fail_first_with, body={"error": {"message": "x"}})
                return await self.inner.send(effect_id, body, sleep)

        monkeypatch.setattr(llm_client, "OpenAIBackend", StubApi)
        body = {key: SAMPLE[key] for key in ("conference", "talks", "notes", "rooms")}
        service.create_input(self.private, INTAKE_ID, body)

    def read(self, args: list[str] | None = None) -> Any:
        return CliRunner().invoke(app, args or BILLED)

    def events(self) -> list[dict[str, Any]]:
        path = self.private.intake_dir(INTAKE_ID) / "events.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


@pytest.fixture
def box(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Box:
    return Box(tmp_path, monkeypatch)


def test_a_real_reading_reserves_its_budget_before_the_request_and_settles_after(box: Box) -> None:
    result = box.read()
    assert result.exit_code == 0, result.output
    assert box.keys == [KEY]  # the key came from the environment of the test, no other
    assert len(box.sent) == 1 and set(box.sent.values()) == {1}
    [(reserved, spent)] = box.seen
    assert 0 < reserved <= INTAKE_RUN_CAP_USD  # the worst case was held before the request left
    assert spent == 0
    summary = ProjectLedger(box.ledger_path, PROJECT_CAP_USD).summary()
    assert summary.reserved_usd == 0 and 0 < summary.spent_usd <= reserved
    assert "intake.proposed" in {event["type"] for event in box.events()}


def test_a_real_reading_runs_under_the_intake_cap(box: Box) -> None:
    assert box.read().exit_code == 0
    started = box.events()[0]
    assert started["type"] == "run.started"
    assert started["payload"]["run_cap_usd"] == INTAKE_RUN_CAP_USD


def test_a_request_that_may_have_been_billed_is_not_sent_again(box: Box) -> None:
    box.fail_first_with = 500  # the API may have run it and billed it
    result = box.read()
    assert result.exit_code == 0, result.output
    # The transport sent the failed request once. The actor reads again with the errors as
    # feedback: a new request, which is what the preflight priced (the reading and its retry).
    assert len(box.sent) == 2 and set(box.sent.values()) == {1}
    assert "intake.proposed" in {event["type"] for event in box.events()}


def test_without_the_flag_the_same_failure_is_sent_again(box: Box) -> None:
    box.fail_first_with = 500
    unflagged = [arg for arg in BILLED if arg != "--no-paid-retries"]
    assert box.read(unflagged).exit_code == 0
    assert max(box.sent.values()) == 2  # the retry the API's flag forbids


def test_a_request_the_api_did_not_bill_may_be_sent_again(box: Box) -> None:
    box.fail_first_with = 429  # rate limited: not billed, so it is safe to resend
    assert box.read().exit_code == 0
    assert len(box.sent) == 1 and max(box.sent.values()) == 2


def test_the_real_reading_is_refused_without_the_spend_flag(box: Box) -> None:
    unconfirmed = [arg for arg in BILLED if arg != "--confirm-real-spend"]
    result = box.read(unconfirmed)
    assert result.exit_code == 2
    assert box.keys == [] and not box.sent and not box.ledger_path.exists()


def test_the_real_reading_is_refused_without_a_key(
    box: Box, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("fractalswarm.cli._settings", lambda: _without_key())
    result = box.read()
    assert result.exit_code == 2
    assert box.keys == [] and not box.sent


def _without_key() -> Any:
    from fractalswarm.config import Settings

    return Settings(model_api_key=None)
