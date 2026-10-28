"""Fit the fake LLM's latency and reasoning-token distributions to real calls (spec §14).

Stall time and extra cost only mean something in $0 runs if the fake behaves like the real
API. This module reads real calls, fits two models and saves them as JSON:

- **Latency** per model: ``base + a · output_tokens + b · input_tokens`` (least squares,
  coefficients kept non-negative), times a lognormal factor fitted to the residuals. Output
  tokens include the reasoning tokens, which bill and take time like visible output.
- **Reasoning tokens** per ``(model, effort)``: lognormal. Thin groups borrow from the
  effort pooled over models, then from everything.

Inputs, one JSON object per line, in any mix:
- cassette entries (``cassette.jsonl`` of a recorded run); fake responses are skipped;
- samples ``{model, effort, input_tokens, output_tokens, reasoning_tokens, latency_ms}``
  (``tests/fixtures/calibration/`` holds the Day 3 live spike in this form).

Re-run it whenever new real cassettes arrive: ``fractalswarm calibrate PATH... --out FILE``.
"""

import json
import math
import random
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from fractalswarm.llm.fake import FakeBackend

POOLED = "*"
CONTRIBUTOR_SUFFIX = "-contributor"
MIN_LATENCY_SAMPLES = 5
MIN_SIGMA_SAMPLES = 3


class Sample(BaseModel):
    model: str
    effort: str | None = None
    input_tokens: int
    output_tokens: int  # reasoning included
    reasoning_tokens: int = 0
    latency_ms: int


class LatencyFit(BaseModel):
    base_ms: float
    per_output_token_ms: float
    per_input_token_ms: float
    log_mu: float  # of actual / predicted
    log_sigma: float
    min_ms: int
    max_ms: int
    samples: int

    def predict(self, input_tokens: int, output_tokens: int) -> float:
        return (
            self.base_ms
            + self.per_output_token_ms * output_tokens
            + self.per_input_token_ms * input_tokens
        )


class TokenFit(BaseModel):
    log_mu: float  # of reasoning_tokens + 1
    log_sigma: float
    samples: int


class Calibration(BaseModel):
    sources: list[str] = []
    samples: int = 0
    latency: dict[str, LatencyFit]
    reasoning: dict[str, TokenFit]  # "model|effort", "*|effort", "*|*"

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.model_dump_json(indent=2) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "Calibration":
        return cls.model_validate_json(path.read_text(encoding="utf-8"))

    def latency_fit(self, model: str) -> LatencyFit:
        for name in (model, model.removesuffix(CONTRIBUTOR_SUFFIX), POOLED):
            if name in self.latency:
                return self.latency[name]
        raise KeyError("the calibration has no pooled latency fit")

    def token_fit(self, model: str, effort: str) -> TokenFit:
        base = model.removesuffix(CONTRIBUTOR_SUFFIX)
        for key in (f"{model}|{effort}", f"{base}|{effort}", f"{POOLED}|{effort}"):
            if key in self.reasoning:
                return self.reasoning[key]
        return self.reasoning[f"{POOLED}|{POOLED}"]

    def latency_model(self) -> "CalibratedLatency":
        return CalibratedLatency(self)

    def reasoning_model(self) -> "CalibratedReasoning":
        return CalibratedReasoning(self)

    def backend(self, **kwargs: Any) -> FakeBackend:
        """A fake LLM that follows this calibration."""
        return FakeBackend(latency=self.latency_model(), reasoning=self.reasoning_model(), **kwargs)


class CalibratedLatency:
    """A ``LatencyModel`` for ``FakeBackend``."""

    def __init__(self, calibration: Calibration) -> None:
        self.calibration = calibration

    def __call__(
        self, model: str, input_tokens: int, output_tokens: int, rng: random.Random
    ) -> int:
        fit = self.calibration.latency_fit(model)
        factor = math.exp(rng.gauss(fit.log_mu, fit.log_sigma))
        latency = fit.predict(input_tokens, output_tokens) * factor
        # Never faster than anything seen; allow some headroom above the slowest call.
        return int(min(max(latency, fit.min_ms), fit.max_ms * 2))


class CalibratedReasoning:
    """A ``ReasoningModel`` for ``FakeBackend``."""

    def __init__(self, calibration: Calibration) -> None:
        self.calibration = calibration

    def __call__(self, model: str, effort: str, rng: random.Random) -> int:
        fit = self.calibration.token_fit(model, effort)
        return max(int(math.exp(rng.gauss(fit.log_mu, fit.log_sigma))) - 1, 0)


# -- reading ----------------------------------------------------------------------------


def samples_from_line(record: dict[str, Any]) -> list[Sample]:
    if "attempts" not in record:
        return [Sample.model_validate(record)]
    effort = (record.get("request", {}).get("reasoning") or {}).get("effort")
    samples = []
    for attempt in record["attempts"]:
        body = attempt.get("body")
        if attempt.get("status") != 200 or not isinstance(body, dict):
            continue
        if str(body.get("id", "")).startswith("resp_fake_"):
            continue  # the fake must not calibrate itself
        usage = body.get("usage") or {}
        details = usage.get("output_tokens_details") or {}
        samples.append(
            Sample(
                model=record.get("model") or body.get("model", ""),
                effort=effort,
                input_tokens=usage.get("input_tokens") or 0,
                output_tokens=usage.get("output_tokens") or 0,
                reasoning_tokens=details.get("reasoning_tokens") or 0,
                latency_ms=attempt.get("latency_ms") or 0,
            )
        )
    return samples


def read_samples(paths: list[Path]) -> list[Sample]:
    samples: list[Sample] = []
    for path in paths:
        files = sorted(path.rglob("*.jsonl")) if path.is_dir() else [path]
        for file in files:
            for line in file.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    samples += samples_from_line(json.loads(line))
    return samples


# -- fitting ----------------------------------------------------------------------------


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float] | None:
    """Gaussian elimination with partial pivoting; ``None`` if singular."""
    n = len(vector)
    rows = [row[:] + [vector[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(rows[r][col]))
        if abs(rows[pivot][col]) < 1e-9:
            return None
        rows[col], rows[pivot] = rows[pivot], rows[col]
        for r in range(n):
            if r != col:
                ratio = rows[r][col] / rows[col][col]
                rows[r] = [a - ratio * b for a, b in zip(rows[r], rows[col], strict=True)]
    return [rows[i][n] / rows[i][i] for i in range(n)]


def _least_squares(xs: list[list[float]], ys: list[float]) -> list[float] | None:
    width = len(xs[0])
    normal = [[sum(x[i] * x[j] for x in xs) for j in range(width)] for i in range(width)]
    target = [sum(x[i] * y for x, y in zip(xs, ys, strict=True)) for i in range(width)]
    return _solve(normal, target)


def _mean_std(values: list[float]) -> tuple[float, float]:
    mean = sum(values) / len(values)
    if len(values) < 2:
        return mean, 0.0
    variance = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return mean, math.sqrt(variance)


def fit_latency(samples: list[Sample]) -> LatencyFit:
    """Non-negative least squares by dropping the terms that come out negative."""
    ys = [float(s.latency_ms) for s in samples]
    terms = ["output", "input"]
    coefficients: dict[str, float] = {}
    base = sum(ys) / len(ys)
    while True:
        xs = [[1.0] + [_feature(s, t) for t in terms] for s in samples]
        solution = _least_squares(xs, ys) if len(samples) > len(terms) else None
        if solution is None:
            if not terms:
                break
            terms.pop()  # too few or degenerate samples: fewer terms
            continue
        negative = [t for t, c in zip(terms, solution[1:], strict=True) if c < 0]
        if not negative:
            base = solution[0]
            coefficients = dict(zip(terms, solution[1:], strict=True))
            break
        terms.remove(negative[-1])
    fit = LatencyFit(
        base_ms=max(base, 0.0),
        per_output_token_ms=coefficients.get("output", 0.0),
        per_input_token_ms=coefficients.get("input", 0.0),
        log_mu=0.0,
        log_sigma=0.0,
        min_ms=int(min(ys)),
        max_ms=int(max(ys)),
        samples=len(samples),
    )
    ratios = [
        math.log(s.latency_ms / max(fit.predict(s.input_tokens, s.output_tokens), 1.0))
        for s in samples
        if s.latency_ms > 0
    ]
    mu, sigma = _mean_std(ratios) if ratios else (0.0, 0.0)
    return fit.model_copy(update={"log_mu": mu, "log_sigma": sigma})


def _feature(sample: Sample, term: str) -> float:
    return float(sample.output_tokens if term == "output" else sample.input_tokens)


def fit_tokens(groups: dict[str, list[int]], every: list[int]) -> dict[str, TokenFit]:
    pooled_mu, pooled_sigma = _mean_std([math.log(v + 1) for v in every])
    fits = {}
    for key in sorted(groups):
        logs = [math.log(v + 1) for v in groups[key]]
        mu, sigma = _mean_std(logs)
        if len(logs) < MIN_SIGMA_SAMPLES:
            sigma = pooled_sigma
        fits[key] = TokenFit(log_mu=mu, log_sigma=sigma, samples=len(logs))
    fits[f"{POOLED}|{POOLED}"] = TokenFit(
        log_mu=pooled_mu, log_sigma=pooled_sigma, samples=len(every)
    )
    return fits


def calibrate(samples: list[Sample], sources: list[str] | None = None) -> Calibration:
    usable = [s for s in samples if s.latency_ms > 0]
    if len(usable) < 2:
        raise ValueError("calibration needs at least two real calls with a latency")
    by_model: dict[str, list[Sample]] = {}
    for sample in usable:
        by_model.setdefault(sample.model, []).append(sample)
    latency = {POOLED: fit_latency(usable)}
    for model in sorted(by_model):
        if len(by_model[model]) >= MIN_LATENCY_SAMPLES:
            latency[model] = fit_latency(by_model[model])

    groups: dict[str, list[int]] = {}
    labelled = [sample for sample in usable if sample.effort is not None]
    for sample in labelled:
        for key in (f"{sample.model}|{sample.effort}", f"{POOLED}|{sample.effort}"):
            groups.setdefault(key, []).append(sample.reasoning_tokens)
    every = [sample.reasoning_tokens for sample in labelled or usable]
    return Calibration(
        sources=sources or [],
        samples=len(usable),
        latency=latency,
        reasoning=fit_tokens(groups, every),
    )


def calibrate_paths(paths: list[Path]) -> Calibration:
    return calibrate(read_samples(paths), [path.as_posix() for path in paths])
