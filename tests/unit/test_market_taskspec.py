"""The economy's switches in the TaskSpec (spec §7.2, §7.3): opt-in, resolved into the run's
params, and absent from a default run's log, so every existing recording replays as off."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from fractalswarm.planning.taskspec import (
    AUTOSCALE_KEYS,
    Market,
    Scaling,
    TaskSpec,
    market_params,
    run_params,
)

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"


def spec(**changes) -> TaskSpec:
    base = TaskSpec.load(TASKSPEC)
    for key, value in changes.items():
        setattr(base, key, value)
    return base


def test_the_defaults_are_proportional_and_exact() -> None:
    loaded = TaskSpec.load(TASKSPEC)
    assert loaded.market == Market() and loaded.market.mode == "proportional"
    assert loaded.scaling.mode == "exact"
    assert (loaded.market.epoch_interval_s, loaded.market.epoch_max_completions) == (15, 10)


def test_a_default_run_records_nothing_of_the_economy() -> None:
    params = run_params(spec())
    assert sorted(params) == ["corpus", "spec", "truth"]
    recorded = params["spec"]
    assert "market" not in recorded and not set(AUTOSCALE_KEYS) & set(recorded["scaling"])
    assert sorted(recorded["scaling"]) == ["agents_per_leaf", "fanout", "mode"]
    assert market_params(spec()) is None


def test_the_auction_resolves_every_number_into_the_params() -> None:
    chosen = spec(market=Market(mode="auction", epoch_interval_s=5, floor_usd=0.2))
    params = run_params(chosen)
    assert params["spec"]["market"]["mode"] == "auction"
    economy = params["market"]
    assert economy["mode"] == "auction" and economy["epoch_interval_ms"] == 5_000
    assert economy["epoch_max_completions"] == 10 and economy["floor_usd"] == 0.2
    assert economy["leaf_level"] == 2 and economy["fanout"] == [3, 2]
    assert economy["ladder"] == {"L1": 0.8, "L2": 0.9, "stop": 0.95}
    assert economy["limits"]["muse-spark-1.3"] == {"limit_rpm": 3000, "limit_tpm": 4_000_000}
    assert economy["limits"]["muse-spark-1.3-contributor"]["limit_rpm"] == 150
    for key in ("plan_usd", "contract_usd", "contracts_per_leaf", "rpm_per_agent", "tpm_per_agent"):
        assert economy[key] > 0  # nothing is read from a config file at replay


def test_autoscale_needs_the_epochs_and_records_its_caps() -> None:
    scaling = Scaling(mode="autoscale", max_orchestrators_per_group=4)
    params = run_params(spec(scaling=scaling))
    assert params["market"]["mode"] == "proportional"  # the fallback allocator, but running
    assert params["market"]["leaf_level"] == scaling.max_depth == 2
    recorded = params["spec"]["scaling"]
    assert recorded["mode"] == "autoscale" and recorded["max_orchestrators_per_group"] == 4
    assert {key: recorded[key] for key in AUTOSCALE_KEYS} == {
        "max_orchestrators_per_group": 4,
        "max_agents_per_orchestrator": 4,
        "max_depth": 2,
        "complexity_threshold": 1,
    }


def test_the_autoscale_caps_default_to_the_spec() -> None:
    caps = Scaling()
    assert (caps.max_orchestrators_per_group, caps.max_agents_per_orchestrator) == (6, 4)
    assert caps.max_depth == 2


@pytest.mark.parametrize(
    "bad",
    [
        {"mode": "bidding"},
        {"epoch_interval_s": 0},
        {"epoch_max_completions": 0},
        {"floor_usd": -1},
        {"unknown": 1},
    ],
)
def test_a_bad_market_is_refused(bad: dict) -> None:
    with pytest.raises(ValidationError):
        Market(**bad)
    with pytest.raises(ValidationError):
        Scaling(max_agents_per_orchestrator=0)
