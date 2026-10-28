"""The global spend breaker on T2 (spec §8): burn above 20% of the remaining budget per minute
pauses new contracts for 30 s of virtual time, then it closes on its own. Opt-in
(``market: {breaker: true}``); the run finishes the same program at the same cost, later.
Fake LLM only, $0."""

import asyncio
from pathlib import Path

import pytest

from fractalswarm.actors import market_maker
from fractalswarm.bench.scoring import RunMetrics, load_events, score_run
from fractalswarm.bench.workflows import fake_backend, t2_checker
from fractalswarm.kernel.events import Event
from fractalswarm.kernel.scheduler import Runtime
from fractalswarm.planning.taskspec import Market, TaskSpec, market_params, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
PAUSE_MS = 30_000


async def record(
    run_dir: Path, *, breaker: bool = True, budget: float = 2.0, chaos: dict | None = None
) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    spec.market = Market(breaker=breaker)
    spec.budget_usd = budget
    params = run_params(spec)
    if chaos is not None:
        params |= {"chaos": chaos, "membership": True}
    await record_run(
        "swarm",
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=fake_backend(),
        seed=spec.seed,
        params=params,
        run_cap_usd=spec.budget_usd,
    )
    return run_dir


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("breaker")
    c3 = {"profile": "C3", "seed": "1"}

    async def everything() -> dict[str, Path]:
        return {
            "default": await record(root / "default", breaker=False, budget=1.0),
            "calm": await record(root / "calm", budget=2.0),
            "tripped": await record(root / "tripped", budget=1.0),
            "scarce": await record(root / "scarce", budget=0.6),
            "c3": await record(root / "c3", budget=1.0, chaos=c3),
        }

    return asyncio.run(everything())


def events(run: Path) -> list[Event]:
    return load_events(run)


def score(run: Path) -> RunMetrics:
    return score_run(run, t2_checker)  # type: ignore[return-value]


def breaker_events(run: Path, kind: str) -> list[Event]:
    return [e for e in events(run) if e.type == kind and e.payload["breaker"] == "global_spend"]


# -- opt-in -----------------------------------------------------------------------------------


def test_the_breaker_is_off_by_default_and_a_default_run_records_nothing_of_it(runs) -> None:
    log = events(runs["default"])
    assert not [e for e in log if e.type.startswith(("breaker.", "market."))]
    assert "market" not in log[0].payload["params"]
    assert Market().breaker is False
    spec = TaskSpec.load(TASKSPEC)
    assert market_params(spec) is None
    spec.market = Market(breaker=True)
    assert market_params(spec)["breaker"] == {"max_burn_share_per_min": 0.2, "pause_ms": 30_000}  # type: ignore[index]
    assert run_params(spec)["spec"]["market"]["breaker"] is True


# -- a run that burns too fast -----------------------------------------------------


def test_a_run_inside_its_budget_never_trips_the_breaker(runs) -> None:
    assert not breaker_events(runs["calm"], "breaker.opened")
    assert score(runs["calm"]).valid


def test_a_fast_burn_opens_the_breaker_for_30_seconds_and_it_closes_on_its_own(runs) -> None:
    opened = breaker_events(runs["tripped"], "breaker.opened")
    closed = breaker_events(runs["tripped"], "breaker.closed")
    assert len(opened) >= 1 and len(closed) >= 1
    for found in opened:
        assert (
            found.payload["until_ms"] - found.ts_virtual <= PAUSE_MS
        )  # reported at or after the trip
        assert "20%" in found.payload["reason"] and found.payload["trips"] >= 1
    assert [e.payload["trips"] for e in opened] == list(range(1, len(opened) + 1))
    for found in closed:  # automatic recovery: it closes when the pause is over, not before
        assert any(found.ts_virtual >= o.payload["until_ms"] for o in opened)


def test_no_new_contract_starts_while_the_breaker_is_open(runs) -> None:
    for name in ("tripped", "scarce", "c3"):
        log = events(runs[name])
        opened = breaker_events(runs[name], "breaker.opened")
        assert opened, name
        starts = [e.ts_virtual for e in log if e.type == "contract.dispatched"]
        for found in opened:
            until = found.payload["until_ms"]
            inside = [at for at in starts if until - PAUSE_MS < at < until]
            assert not inside, (name, until, inside)


def test_the_pause_delays_the_run_but_changes_neither_its_work_nor_its_cost(runs) -> None:
    tripped, default = score(runs["tripped"]), score(runs["default"])
    assert tripped.completed and tripped.valid
    assert tripped.llm_calls == default.llm_calls
    # The pause moves which squad wins a booking race, so some conflict prompts differ by a
    # few tokens: the cost is the same to within a fraction of a percent, never a call more.
    assert tripped.cost_usd == pytest.approx(default.cost_usd, rel=0.02)
    assert tripped.makespan_s > default.makespan_s + 20  # at least one 30 s pause
    assert tripped.coordination_tokens == 0


def test_a_scarcer_budget_pauses_more_and_still_finishes(runs) -> None:
    assert len(breaker_events(runs["scarce"], "breaker.opened")) > len(
        breaker_events(runs["tripped"], "breaker.opened")
    )
    assert score(runs["scarce"]).valid


def test_the_breaker_holds_under_kills_too(runs) -> None:
    metrics = score(runs["c3"])
    assert metrics.completed and metrics.valid and metrics.coordination_tokens == 0
    assert breaker_events(runs["c3"], "breaker.opened")


def test_every_breaker_run_replays_to_its_recorded_head(runs) -> None:
    for name in ("calm", "tripped", "scarce", "c3"):
        report = asyncio.run(replay_run(runs[name]))
        assert report.ok, (name, report.detail)


# -- a wedged run ends instead of spinning -----------------------------------------------------


def test_a_wedged_market_run_ends_instead_of_spinning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The epoch timer is always in flight, so without a guard a run that wedges would spin
    for ever. Here the breaker's wake-up never fires: a held leaf waits for ever. A market
    whose run reserved no call for IDLE_MS stops re-arming, and the run ends without a result."""
    monkeypatch.setattr(market_maker, "wake", lambda state, gid, until, view: (state, []))
    steps = []
    real_step = Runtime.step

    def counted(self: Runtime) -> bool:
        steps.append(1)
        if len(steps) > 20_000:  # a wedged run takes about 500
            raise RuntimeError("the run is spinning")
        return real_step(self)

    monkeypatch.setattr(Runtime, "step", counted)
    log = events(asyncio.run(record(tmp_path / "wedged", budget=1.0)))
    assert log[-1].type == "run.completed"
    assert not [e for e in log if e.type == "task.result"]  # wedged: it never finished
    last_call = max(e.ts_virtual for e in log if e.type == "budget.reserved")
    assert log[-1].ts_virtual <= last_call + market_maker.IDLE_MS + 30_000
