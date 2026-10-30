"""The home page's data file (``scripts/build_home_data.py`` -> ``web/src/home/data/story.json``).

The slices whose sources are in git are regenerated and compared with the committed file. The
lanes of the recorded ``central`` run are not in git (``bench/results/v1/runs`` is ignored): where
the run is on disk it is regenerated too, and where it is not the committed slice is checked
against the committed summary cell of that run.
"""

import importlib.util
import json
import re
from pathlib import Path
from types import ModuleType

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "build_home_data.py"
STORY = REPO / "web" / "src" / "home" / "data" / "story.json"
CENTRAL_ID = "central__t2_conference__C3__s1"
CENTRAL_RUN = REPO / "bench" / "results" / "v1" / "runs" / CENTRAL_ID
CENTRAL_CELL = REPO / "bench" / "results" / "v1" / "cells" / f"{CENTRAL_ID}.json"


@pytest.fixture(scope="module")
def generator() -> ModuleType:
    spec = importlib.util.spec_from_file_location("build_home_data", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def committed() -> dict:
    return json.loads(STORY.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def committed_text() -> str:
    return STORY.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def rebuilt(generator: ModuleType, committed: dict) -> dict:
    """A fresh build; the recorded central run is used where it is on disk."""
    central = CENTRAL_RUN if CENTRAL_RUN.is_dir() else None
    return generator.build(generator.DEFAULT_BUNDLE, central, committed)


def test_regenerating_gives_the_committed_bytes(
    generator: ModuleType, rebuilt: dict, committed_text: str
):
    assert generator.dump(rebuilt) == committed_text, (
        "web/src/home/data/story.json is stale: run `uv run python scripts/build_home_data.py` "
        "(a claims.md edit or a new bench result changes it)"
    )


def test_two_builds_are_byte_identical(generator: ModuleType, rebuilt: dict, committed: dict):
    again = generator.build(
        generator.DEFAULT_BUNDLE, CENTRAL_RUN if CENTRAL_RUN.is_dir() else None, committed
    )
    assert generator.dump(again) == generator.dump(rebuilt)


def test_the_central_lanes_agree_with_the_committed_cell(committed: dict):
    lanes = committed["lanes"]["central"]
    cell = json.loads(CENTRAL_CELL.read_text(encoding="utf-8"))["metrics"]
    assert lanes["runId"] == CENTRAL_ID == cell["run_id"]
    assert lanes["events"] == cell["events"]
    assert lanes["metrics"]["stallS"] == round(cell["stall_s"], 3)
    assert lanes["metrics"]["workWindowS"] == round(cell["work_window_s"], 3)
    assert lanes["metrics"]["makespanS"] == round(cell["makespan_s"], 3)
    assert lanes["metrics"]["costUsd"] == round(cell["cost_usd"], 6)
    assert lanes["metrics"]["llmCalls"] == cell["llm_calls"] == len(lanes["bars"])
    assert lanes["metrics"]["cancelledLlmCalls"] == cell["cancelled_llm_calls"]
    assert lanes["stall"]["totalMs"] == pytest.approx(cell["stall_s"] * 1000, abs=1)
    assert lanes["durationMs"] == pytest.approx(cell["makespan_s"] * 1000, abs=1)
    cut_off = [b for b in lanes["bars"] if b[3] == lanes["kinds"]["cutOff"]]
    assert len(cut_off) == cell["cancelled_llm_calls"]


def test_the_lanes_are_internally_consistent(committed: dict):
    for name, lanes in committed["lanes"].items():
        count = len(lanes["lanes"])
        assert all(0 <= lane < count for lane, *_ in lanes["bars"]), name
        assert all(start <= end for _, start, end, *_ in lanes["bars"]), name
        assert lanes["bars"] == sorted(lanes["bars"], key=lambda b: (b[1], b[0], b[2])), name
        assert lanes["costs"]["totalMicroUsd"] == sum(b[4] for b in lanes["bars"]), name
        assert all(a < b for a, b in lanes["stall"]["spansMs"]), name
        assert sum(b - a for a, b in lanes["stall"]["spansMs"]) == lanes["stall"]["totalMs"], name


def test_the_swarm_lanes_and_hashes_come_from_the_bundle(committed: dict):
    bundle = committed["sources"]["bundle"]
    head = (REPO / bundle["path"] / "HEAD").read_text(encoding="utf-8").strip()
    assert (
        committed["lanes"]["swarm"]["head"] == committed["hashes"]["head"] == bundle["head"] == head
    )
    assert committed["hashes"]["count"] == bundle["events"] == committed["lanes"]["swarm"]["events"]
    assert committed["hashes"]["chainOk"] is True
    assert committed["hashes"]["replay"]["matches"] is True
    sample = committed["hashes"]["events"]
    for before, after in zip(sample, sample[1:], strict=False):
        if after[0] == before[0] + 1:
            assert after[5] == before[4], (
                f"event {after[0]} must carry the hash of event {before[0]}"
            )
    assert sample[-1][4] == head


def test_claims_are_copied_by_row_id_in_the_rows_wording(committed: dict):
    text = (REPO / "docs" / "claims.md").read_text(encoding="utf-8")
    for claim_id, claim in committed["claims"].items():
        row = re.search(rf"^\| {claim_id} \|(.*)$", text, re.MULTILINE)
        assert row, claim_id
        assert claim["text"].replace("**", "") in row.group(1).replace("**", ""), claim_id
        assert claim["status"] in {"allowed", "pending", "not-claimed"}
    assert committed["claims"]["R1"]["status"] == "not-claimed"
    assert committed["tagline"] == "Kill half the brains. It still finishes."
    assert {n["claim"] for n in committed["notClaimed"]} == {
        "Simpler",
        "Cheaper",
        "More reliable",
        "First",
    }


def test_the_numbers_the_claims_quote_are_the_claims_numbers(committed: dict):
    quoted = committed["claims"]["R5"]["text"]
    n = committed["numbers"]["r5"]
    for key in ("swarmStallS", "centralStallS"):
        assert (
            f"{n['t1'][key]} s" in quoted
            or f"{n['t1'][key]} " in quoted
            or f" {n['t1'][key]}" in quoted
        )
        assert f"{n['t2'][key]}" in quoted
    for key in ("swarmExtraPct", "centralExtraPct"):
        assert f"{n['t1'][key]}%" in quoted and f"{n['t2'][key]}%" in quoted
    r2 = committed["claims"]["R2"]["text"]
    assert "ideal durable supervisor" in r2
    assert committed["numbers"]["s4"] == {"coordinationTokens": 0, "runs": 114}
    assert committed["numbers"]["s7"]["allCompleted"] == committed["numbers"]["s7"]["allRuns"]
    assert committed["numbers"]["structure"] == {
        "agents": 12,
        "orchestrators": 10,
        "sessions": 6,
        "tracks": 3,
    }


def test_the_takeover_sequence_is_the_bundles(committed: dict):
    takeover = committed["takeover"]
    assert takeover["ok"] and takeover["violations"] == 0 and takeover["falseVerdicts"] == 0
    assert takeover["killCount"] == len(takeover["kills"]) == committed["finish"]["killed"]
    assert [k["atMs"] for k in takeover["kills"]] == sorted(k["atMs"] for k in takeover["kills"])
    assert all(k["eventsAfterStop"] == 0 for k in takeover["kills"])
    for kill in takeover["kills"]:
        assert 4 < kill["verdict"]["delayS"] < 6, "the verdict comes after five missed heartbeats"
    for round_ in committed["hrw"]["rounds"]:
        assert (
            round_["agree"] and round_["heir"] == round_["owner"] == round_["scores"][0]["member"]
        )
        assert [s["score"] for s in round_["scores"]] == sorted(
            (s["score"] for s in round_["scores"]), reverse=True
        )
        assert round_["heir"] in round_["survivors"]
    chain = takeover["chains"]["root"]
    assert chain[0] == committed["tree"]["root"], "the root goal starts with the first brain"
    killed_root_holders = [k["target"] for k in takeover["kills"] if k["heldRoot"]]
    assert chain[:-1] == killed_root_holders, (
        "every holder of the root goal but the last was killed"
    )


def test_the_finish_numbers_are_the_runs(committed: dict):
    finish = committed["finish"]
    assert finish["placed"] == finish["expected"] and finish["hardViolations"] == 0
    assert finish["duplicateCalls"] == 0
    assert (
        finish["contractsVerified"] == finish["contracts"] and finish["goalsOk"] == finish["goals"]
    )
    models = {m["model"]: m for m in committed["tokensByModel"]["models"]}
    assert sum(m["calls"] for m in models.values()) == finish["llmCallsPaid"]
    assert (
        committed["tokensByModel"]["coordinationTokens"]
        == 0
        == committed["tokensByModel"]["recoveryTokens"]
    )


def test_the_page_stays_offline_and_small(committed_text: str):
    assert len(committed_text.encode("utf-8")) < 150 * 1024
    assert not re.search(r"https?://", committed_text), "story.json must name no external URL"
    assert not re.search(r"#[0-9a-fA-F]{6}\b", committed_text), "colours live in tokens.css only"


def test_the_optional_ten_seed_reading_is_shown_next_to_the_three_seed_one(committed: dict):
    path = REPO / "bench" / "results" / "headline-10" / "results.json"
    assert committed["sources"]["headline10"]["present"] is path.exists()
    assert (committed["headline10"] is not None) is path.exists()
    assert committed["headline"] is not None, "the 3-seed reading is never replaced"
