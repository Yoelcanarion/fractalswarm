"""Fake-LLM calibration (spec §14): fit latency and reasoning tokens to real calls, re-runnably."""

import json
import random
from pathlib import Path

import pytest

from fractalswarm.llm.calibrate import (
    Calibration,
    Sample,
    calibrate,
    calibrate_paths,
    fit_latency,
    read_samples,
)
from fractalswarm.llm.fake import FakeBackend

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "calibration"
ONE_CALL = ROOT / "tests" / "golden" / "one-call" / "cassette.jsonl"
COMMITTED = ROOT / "config" / "fake_calibration.json"


async def no_sleep(virtual_ms: int) -> None:
    return None


def test_the_committed_fit_is_reproduced_from_the_committed_evidence() -> None:
    fit = calibrate_paths([FIXTURE, ONE_CALL])
    committed = Calibration.load(COMMITTED)
    assert fit.samples == committed.samples
    assert fit.model_dump(exclude={"sources"}) == committed.model_dump(exclude={"sources"})


def test_a_cassette_entry_counts_once_and_fake_responses_never_count(tmp_path: Path) -> None:
    real = json.loads(ONE_CALL.read_text(encoding="utf-8").splitlines()[0])
    fake = json.loads(json.dumps(real))
    fake["attempts"][-1]["body"]["id"] = "resp_fake_0123"
    path = tmp_path / "mixed.jsonl"
    path.write_text(json.dumps(real) + "\n" + json.dumps(fake) + "\n", encoding="utf-8")
    assert len(read_samples([path])) == 1


def test_the_latency_fit_recovers_a_known_line() -> None:
    rng = random.Random(7)
    samples = []
    for _ in range(200):
        out = rng.randrange(10, 2000)
        latency = int((600 + 4.0 * out) * rng.lognormvariate(0, 0.1))
        samples.append(Sample(model="m", input_tokens=20, output_tokens=out, latency_ms=latency))
    fit = fit_latency(samples)
    assert fit.base_ms == pytest.approx(600, rel=0.15)
    assert fit.per_output_token_ms == pytest.approx(4.0, rel=0.1)
    assert fit.per_input_token_ms >= 0 and fit.log_sigma == pytest.approx(0.1, abs=0.05)


def test_too_little_evidence_is_refused() -> None:
    with pytest.raises(ValueError):
        calibrate([Sample(model="m", input_tokens=1, output_tokens=1, latency_ms=100)])


async def test_a_calibrated_fake_is_deterministic_and_inside_the_observed_range() -> None:
    fit = Calibration.load(COMMITTED)
    body = {"model": "muse-spark-1.3", "input": "hello", "reasoning": {"effort": "low"}}
    first = await fit.backend().send("eff-1", body, no_sleep)
    again = await fit.backend().send("eff-1", body, no_sleep)
    assert first == again
    pooled = fit.latency_fit("muse-spark-1.3")
    assert pooled.min_ms <= first.latency_ms <= 2 * pooled.max_ms
    assert first.body["usage"]["output_tokens_details"]["reasoning_tokens"] >= 0


async def test_calibration_is_opt_in_so_the_default_fake_is_unchanged() -> None:
    body = {"model": "muse-spark-1.3", "input": "hello", "reasoning": {"effort": "low"}}
    attempt = await FakeBackend().send("eff-1", body, no_sleep)
    assert attempt.body["usage"]["output_tokens_details"]["reasoning_tokens"] == 32
