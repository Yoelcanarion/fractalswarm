"""The epoch auction on T2 (spec §7.2): the market clears epochs on the live tree, survives
kills, never changes the work, and replays bit for bit. Fake LLM only, $0.

``market.mode: auction`` is opt-in: the default run has no epochs, and its log carries no
``market`` param, so it replays as off.
"""

import asyncio
from collections import Counter, defaultdict
from pathlib import Path

import pytest

from fractalswarm.bench.scoring import RunMetrics, load_events, score_run
from fractalswarm.bench.workflows import CALIBRATION, bench_script, fake_backend, t2_checker
from fractalswarm.comms.chaos import ChaosAction, ChaosPlan
from fractalswarm.kernel.events import Event
from fractalswarm.llm.calibrate import Calibration
from fractalswarm.planning.taskspec import Market, TaskSpec, run_params
from fractalswarm.runs import RunPaths, record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
TASKSPEC = REPO / "tasks" / "examples" / "t2-conference.yaml"
# The root first; then a session owner, a track lead, a session owner and a track lead.
KILLS = [(0.20, "o0"), (0.35, "o2.1"), (0.50, "o1"), (0.65, "o3.2"), (0.80, "o2")]


async def record(
    run_dir: Path,
    *,
    mode: str = "auction",
    chaos: dict | None = None,
    budget: float | None = None,
    backend=None,
    **market,
) -> Path:
    spec = TaskSpec.load(TASKSPEC)
    spec.market = Market(mode=mode, **market)
    if budget is not None:
        spec.budget_usd = budget
    params = run_params(spec)
    if chaos is not None:
        params |= {"chaos": chaos, "membership": True}
    await record_run(
        "swarm",
        run_id=run_dir.name,
        run_dir=run_dir,
        backend=backend or fake_backend(),
        seed=spec.seed,
        params=params,
        run_cap_usd=spec.budget_usd,
    )
    return run_dir


def shock_after(run_dir: Path, calls: int, usd: float):
    """A fake LLM that drops a budget shock into the run's control inbox on its n-th call, as
    ``fractalswarm budget`` does from another shell."""
    seen: list[int] = []

    def script(body, attempt):
        seen.append(1)
        if len(seen) == calls:
            request = {"op": "budget", "level": "run", "key": None, "usd": usd, "reason": "test"}
            RunPaths(run_dir).request_control(request)
        return bench_script(body, attempt)

    return Calibration.load(CALIBRATION).backend(script=script)


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("auction")
    c3 = {"profile": "C3", "seed": "1"}
    kill = ChaosPlan(
        profile="kill-half",
        seed="1",
        actions=tuple(ChaosAction(at=at, kind="kill_coordinator", target=t) for at, t in KILLS),
    ).model_dump(mode="json")
    shocked = root / "shock"

    async def everything() -> dict[str, Path]:
        return {
            "default": await record(root / "default", mode="proportional"),
            "default-c3": await record(root / "default-c3", mode="proportional", chaos=c3),
            "c0": await record(root / "c0"),
            "c3": await record(root / "c3", chaos=c3),
            "kill": await record(root / "kill", chaos=kill),
            "few": await record(root / "few", epoch_max_completions=3),
            "tight": await record(root / "tight", budget=0.50),
            "scarce": await record(root / "scarce", budget=0.40),
            "shock": await record(shocked, backend=shock_after(shocked, 25, 0.60)),
        }

    return asyncio.run(everything())


def events(run: Path) -> list[Event]:
    return load_events(run)


def score(run: Path) -> RunMetrics:
    return score_run(run, t2_checker)  # type: ignore[return-value]


def of_type(log: list[Event], prefix: str) -> list[Event]:
    return [event for event in log if event.type.startswith(prefix)]


def result(log: list[Event]) -> dict:
    return next(e.payload for e in log if e.type == "task.result")


# -- opt-in: the default run is untouched --------------------------------------------------------


def test_the_default_run_has_no_market(runs) -> None:
    for name in ("default", "default-c3"):
        log = events(runs[name])
        assert not of_type(log, "market.") and not of_type(log, "scaling.")
        assert "market" not in log[0].payload["params"]
        assert "market" not in log[0].payload["params"]["spec"]


def test_the_market_params_are_recorded_so_replay_needs_no_config_file(runs) -> None:
    params = events(runs["c0"])[0].payload["params"]
    assert params["market"]["mode"] == "auction"
    assert params["market"]["epoch_interval_ms"] == 15_000
    assert params["market"]["epoch_max_completions"] == 10
    assert "muse-spark-1.3" in params["market"]["limits"]


# -- C0: the auction runs and changes no work -----------------------------------------------------


def test_the_auction_finishes_the_program_and_changes_none_of_the_work(runs) -> None:
    c0, default = score(runs["c0"]), score(runs["default"])
    assert result(events(runs["c0"]))["report"]["hard_violations"] == 0
    assert c0.completed and c0.valid
    assert c0.llm_calls == default.llm_calls
    assert c0.cost_usd == pytest.approx(default.cost_usd)
    assert c0.coordination_tokens == 0  # the market never calls the LLM


def test_every_parent_makes_the_market_of_its_children(runs) -> None:
    closed = of_type(events(runs["c0"]), "market.epoch_closed")
    goals = {e.payload["goal_id"] for e in closed}
    assert goals == {"root", "track-ai", "track-data", "track-hci"}
    owners = {e.payload["goal_id"]: e.payload["owner"] for e in closed}
    assert owners["root"] == "o0" and owners["track-ai"] == "o2"
    # An epoch closes 15 s of virtual time after the last one.
    root = [e for e in closed if e.payload["goal_id"] == "root"]
    assert [e.payload["reason"] for e in root][:3] == ["start", "timer", "timer"]
    gaps = [
        b.payload["at_ms"] - a.payload["at_ms"] for a, b in zip(root[1:], root[2:], strict=False)
    ]
    assert gaps and all(gap == 15_000 for gap in gaps)


def test_epochs_are_numbered_without_gaps_or_repeats(runs) -> None:
    for name in ("c0", "c3", "kill"):
        numbers = defaultdict(list)
        for e in of_type(events(runs[name]), "market.epoch_closed"):
            numbers[e.payload["goal_id"]].append(e.payload["epoch"])
        for goal, found in numbers.items():
            assert found == list(range(len(found))), (name, goal, found)


def test_every_clearing_conserves_the_envelope(runs) -> None:
    for name in ("c0", "c3", "kill", "scarce", "shock"):
        cleared = of_type(events(runs[name]), "market.cleared")
        assert cleared, name
        for event in cleared:
            for resource, found in event.payload["resources"].items():
                total = sum(found["grants"].values()) + found["pool"] + found["reserve"]
                assert total == found["envelope"], (name, event.payload["goal_id"], resource)
                assert found["pool"] >= 0 and all(g >= 0 for g in found["grants"].values())


def test_the_reserve_is_15_percent_at_the_root_and_10_below_and_gives_way_to_the_floors(
    runs,
) -> None:
    log = events(runs["c0"])
    bids = {
        (e.payload["goal_id"], e.payload["epoch"]): e.payload for e in of_type(log, "market.bids")
    }
    shrunk = 0
    for event in of_type(log, "market.cleared"):
        usd = event.payload["resources"]["usd"]
        share = 0.15 if event.payload["goal_id"] == "root" else 0.10
        expected = usd["envelope"] * round(share * 10_000) // 10_000
        asked = bids[(event.payload["goal_id"], event.payload["epoch"])]["bids"]
        floors = sum(b["resources"]["usd"]["floor"] for b in asked)
        if usd["envelope"] - expected >= floors:
            assert usd["reserve"] == expected
        else:  # the floors keep every squad able to make a call: the reserve shrinks to fit them
            shrunk += 1
            assert usd["reserve"] < expected and usd["reserve"] <= max(usd["envelope"] - floors, 0)
    assert shrunk >= 1  # a track's last epochs, with little envelope left, show it


def test_the_grants_are_bounded_by_the_bids_and_the_floors_come_first(runs) -> None:
    log = events(runs["c0"])
    bids = {
        (e.payload["goal_id"], e.payload["epoch"]): e.payload for e in of_type(log, "market.bids")
    }
    for event in of_type(log, "market.cleared"):
        asked = {
            b["child"]: b["resources"]["usd"]
            for b in bids[(event.payload["goal_id"], event.payload["epoch"])]["bids"]
        }
        usd = event.payload["resources"]["usd"]
        available = usd["envelope"] - usd["reserve"]
        floors_fit = sum(a["floor"] for a in asked.values()) <= available
        for child, grant in usd["grants"].items():
            assert grant <= asked[child]["q"]
            if floors_fit:
                assert grant >= asked[child]["floor"]


def test_leaf_grants_become_squad_caps_and_nobody_hits_one(runs) -> None:
    log = events(runs["c0"])
    caps = [e.payload for e in of_type(log, "budget.cap_set") if e.payload["level"] == "squad"]
    assert {c["key"] for c in caps} == {f"o{t}.{s}" for t in (1, 2, 3) for s in (1, 2)}
    assert not of_type(log, "budget.refused")  # a $2 run is nowhere near its caps


def test_the_rate_limit_quota_follows_aimd(runs) -> None:
    quotas = [e.payload for e in of_type(events(runs["c0"]), "market.quota")]
    by_model = defaultdict(list)
    for quota in quotas:
        by_model[quota["model"]].append(quota)
    assert "muse-wonder-1.0" in by_model
    for found in by_model.values():
        assert found[0]["change"] == "init"
        fractions = [q["fraction"] for q in found]
        assert fractions == sorted(fractions) and max(fractions) <= 0.8  # clean epochs only grow
        assert all(q["rpm"] == int(q["limit_rpm"] * q["fraction"]) for q in found)


def test_the_auction_replays_to_its_recorded_head(runs) -> None:
    for name in ("c0", "c3", "kill", "few", "tight", "scarce", "shock"):
        report = asyncio.run(replay_run(runs[name]))
        assert report.ok, (name, report.detail)


# -- the epoch triggers -------------------------------------------------------------------------


def test_ten_contract_completions_close_an_epoch_early(runs) -> None:
    reasons = Counter(
        e.payload["reason"] for e in of_type(events(runs["few"]), "market.epoch_closed")
    )
    assert reasons["completions"] >= 1  # three completions per epoch is easily reached
    assert not any(
        e.payload["reason"] == "completions"
        for e in of_type(events(runs["c0"]), "market.epoch_closed")
    )  # ten are not, in a 70 s run


def test_a_budget_shock_forces_an_epoch_that_lowers_the_envelope(runs) -> None:
    log = events(runs["shock"])
    shock = next(i for i, e in enumerate(log) if e.type == "budget.shock")
    after = [e for e in log[shock:] if e.type == "market.epoch_closed"]
    assert after and after[0].payload["reason"] == "shock"
    assert {e.payload["goal_id"] for e in after if e.payload["reason"] == "shock"} >= {"root"}
    cleared = [
        e for e in log[shock:] if e.type == "market.cleared" and e.payload["goal_id"] == "root"
    ]
    assert cleared[0].payload["resources"]["usd"]["envelope"] <= 600_000  # the new cap
    # $0.60 leaves the squads' floors short, so the densest tracks are funded first: the run
    # degrades, ends with a result (the talks placed, a blurb short) and keeps under the cap.
    assert result(log)["status"] in {"ok", "partial"}
    assert result(log)["report"]["hard_violations"] == 0
    assert score(runs["shock"]).cost_usd <= 0.60


# -- chaos: the market survives kills --------------------------------------------------------------


def test_c3_with_the_auction_completes_valid_and_pays_nothing_more(runs) -> None:
    c3, default = score(runs["c3"]), score(runs["default-c3"])
    assert c3.completed and c3.valid
    assert c3.llm_calls == default.llm_calls and c3.cost_usd == pytest.approx(default.cost_usd)
    assert c3.coordination_tokens == 0
    reasons = {e.payload["reason"] for e in of_type(events(runs["c3"]), "market.epoch_closed")}
    assert {"membership", "ownership"} <= reasons  # deaths and takeovers force epochs
    assert not of_type(events(runs["c3"]), "budget.refused")


def test_when_the_root_dies_its_heir_continues_the_same_market(runs) -> None:
    log = events(runs["kill"])
    assert score(runs["kill"]).valid and result(log)["report"]["hard_violations"] == 0
    closed = [
        e.payload for e in of_type(log, "market.epoch_closed") if e.payload["goal_id"] == "root"
    ]
    owners = [c["owner"] for c in closed]
    assert owners[0] == "o0" and set(owners) - {"o0"} <= {"o1", "o2", "o3"}
    assert set(owners) - {"o0"}, "the root's heir never made its market"
    assert [c["epoch"] for c in closed] == list(range(len(closed)))  # the heir resumes the count
    heir = next(c for c in closed if c["owner"] != "o0")
    assert heir["epoch"] >= 1 and heir["reason"] in {"timer", "membership", "ownership"}


# -- scarcity: graceful, capped, top-ups from the reserve ----------------------------------------


def test_a_budget_under_twice_the_programs_cost_still_places_every_talk(runs) -> None:
    """$0.50 against a program that costs $0.29. The floors keep every squad able to make a call,
    the reserve gives way to them, and the envelopes count money spent, not worst-case holds:
    nobody is starved and no call is refused."""
    log = events(runs["tight"])
    assert not of_type(log, "budget.refused")
    assert result(log)["status"] == "ok" and result(log)["report"]["placed"] == 48
    assert score(runs["tight"]).valid and score(runs["tight"]).cost_usd <= 0.50


def test_a_scarce_budget_degrades_without_exceeding_the_cap(runs) -> None:
    log = events(runs["scarce"])
    metrics = score(runs["scarce"])
    assert metrics.cost_usd <= 0.40
    assert of_type(log, "budget.refused")  # the caps bind
    assert of_type(log, "task.result")  # and the run still ends with a (partial) result


def test_topups_come_from_the_reserve_and_never_overdraw_it(runs) -> None:
    log = events(runs["scarce"])
    topups = [e.payload for e in of_type(log, "market.topup")]
    assert topups
    cleared = {}
    for event in log:
        if event.type == "market.cleared":
            cleared[event.payload["goal_id"]] = event.payload["resources"]["usd"]["reserve"]
        elif event.type == "market.topup":
            payload = event.payload
            assert 0 <= payload["granted_micros"] <= payload["requested_micros"]
            assert payload["reserve_left_micros"] >= 0
            assert payload["granted_micros"] <= cleared[payload["goal_id"]]
