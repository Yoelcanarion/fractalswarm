"""Smoke tests: the package imports, the CLI runs and the config files are consistent."""

import importlib
import pkgutil
from pathlib import Path

import yaml
from typer.testing import CliRunner

import fractalswarm
from fractalswarm.cli import app

CONFIG = Path(__file__).resolve().parents[2] / "config"
LEVELS = {"L0", "L1", "L2"}
EFFORTS = {"minimal", "low", "medium", "high", "xhigh", "max"}

runner = CliRunner()


def load_config(name: str) -> dict:
    return yaml.safe_load((CONFIG / name).read_text(encoding="utf-8"))


def test_every_subpackage_imports() -> None:
    names = [m.name for m in pkgutil.walk_packages(fractalswarm.__path__, "fractalswarm.")]
    for package in ("kernel", "coord", "market", "llm", "safety", "bench.tasks.t2_conference"):
        assert f"fractalswarm.{package}" in names
    for name in names:
        importlib.import_module(name)


def test_cli_help_lists_version() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "version" in result.output


def test_cli_version_prints_package_version() -> None:
    result = runner.invoke(app, ["version"])
    assert result.exit_code == 0
    assert result.output.strip() == fractalswarm.__version__


def test_prices_cover_every_model_with_a_rate_limit() -> None:
    prices = load_config("prices.yaml")
    models = prices["models"]
    assert {"muse-wonder-1.0", "muse-spark-1.3", "muse-spark-1.3-contributor"} <= set(models)
    for model, price in models.items():
        assert price["cached_input"] < price["input"] < price["output"], model
        assert model in prices["rate_limits"], model


def test_every_role_has_a_priced_model_at_every_level() -> None:
    models = load_config("prices.yaml")["models"]
    roles = load_config("roles.yaml")["roles"]
    for role, ladder in roles.items():
        assert set(ladder) == LEVELS, role
        for level, spec in ladder.items():
            assert spec["model"] in models, (role, level)
            assert spec["effort"] in EFFORTS, (role, level)
            assert spec["max_output_tokens"] >= 16, (role, level)


def test_defaults_match_the_failure_detection_spec() -> None:
    defaults = load_config("defaults.yaml")
    membership = defaults["membership"]
    assert membership["heartbeat_interval_s"] == 1
    assert membership["dead_after_missed"] == 5
    ladder = defaults["budget"]["ladder"]
    assert ladder["L1"] < ladder["L2"] < ladder["stop"] < 1
