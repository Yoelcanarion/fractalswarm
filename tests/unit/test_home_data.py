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


def page_state(status: str) -> str:
    """How the page (web/src/home/story.ts, claimState) reads a status cell."""
    plain = re.sub(r"[*_`]", "", status).strip().lower()
    if plain.startswith("not claimed"):
        return "not-claimed"
    if "pending" in plain:
        return "pending"
    return "allowed" if plain.startswith("allowed") else "pending"


def test_claims_are_copied_by_row_id_in_the_rows_wording(committed: dict):
    text = (REPO / "docs" / "claims.md").read_text(encoding="utf-8")
    for claim_id, claim in committed["claims"].items():
        row = re.search(rf"^\| {claim_id} \|(.*)$", text, re.MULTILINE)
        assert row, claim_id
        assert claim["text"].replace("**", "") in row.group(1).replace("**", ""), claim_id
        assert claim["state"] in {"allowed", "pending", "not-claimed"}
        assert claim["state"] == page_state(claim["status"]), (
            f"{claim_id}: the page reads the status cell as {page_state(claim['status'])}"
        )
    assert committed["claims"]["R1"]["state"] == "not-claimed"
    assert {"R5", "R6"} <= set(committed["claims"])
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
    kills = committed["tree"]["kills"]
    assert takeover["ok"] and takeover["violations"] == 0 and takeover["falseVerdicts"] == 0
    assert takeover["killed"] == len(kills) == committed["finish"]["killed"]
    assert [k["atMs"] for k in kills] == sorted(k["atMs"] for k in kills)
    assert all(k["eventsAfterStop"] == 0 for k in kills)
    assert takeover["rootChain"] == takeover["chains"]["root"]
    assert 5 <= takeover["deathVerdictS"] < 5.5, "five missed heartbeats after the last one sent"
    for kill in kills:
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
    killed_root_holders = [k["target"] for k in kills if k["heldRoot"]]
    assert chain[:-1] == killed_root_holders, (
        "every holder of the root goal but the last was killed"
    )


def test_the_traffic_is_the_bundles(committed: dict):
    from fractalswarm.coord.membership import Detector

    detector = Detector(member="")
    traffic = committed["tree"]
    beat = traffic["heartbeat"]
    assert (beat["intervalMs"], beat["suspectAfter"], beat["deadAfter"]) == (
        detector.interval_ms,
        detector.suspect_after,
        detector.dead_after,
    )
    nodes = {n["id"] for n in committed["tree"]["nodes"]}
    brains = {n["id"] for n in committed["tree"]["nodes"] if n["kind"] == "brain"}
    assert set(beat["senders"]) == brains
    killed = {k["target"]: k for k in committed["tree"]["kills"]}
    for sender, ticks in beat["senders"].items():
        if sender in killed:
            assert ticks["lastMs"] <= killed[sender]["atMs"], "a killed brain sends nothing after"
        else:
            assert ticks["lastMs"] > committed["tree"]["durationMs"] - 2000
    messages = traffic["messages"]
    assert messages == sorted(messages, key=lambda m: (m[0], m[1], m[2], m[3]))
    assert all(m[1] in nodes and m[2] in nodes and m[1] != m[2] for m in messages)
    assert all(0 <= m[3] < len(traffic["messageKinds"]) for m in messages)
    assert all(m[0] <= committed["tree"]["durationMs"] for m in messages)


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


def test_the_tree_slice_holds_everything_the_tree_draws(committed: dict):
    tree = committed["tree"]
    for key in ("nodes", "goals", "root", "counts", "kills", "adoptions", "rounds", "heartbeat"):
        assert key in tree, key
    assert tree["rounds"] == committed["hrw"]["rounds"]
    assert tree["durationMs"] == committed["takeover"]["durationMs"]
    swarm = committed["lanes"]["swarm"]
    busy = {swarm["lanes"][lane]["id"]: [] for lane, *_ in swarm["bars"]}
    for lane, start, end, *_ in swarm["bars"]:
        busy[swarm["lanes"][lane]["id"]].append([start, end])
    assert tree["busy"] == {actor: busy[actor] for actor in tree["busy"]} and len(busy) == len(
        tree["busy"]
    )
    assert tree["talks"] == {
        "placed": committed["finish"]["talksPlaced"],
        "expected": committed["finish"]["talksTotal"],
    }


def test_the_page_finds_what_it_reads(committed: dict):
    """The fields web/src/home/storyTypes.ts reads, with the types it reads them as."""
    assert committed["facts"] == {
        "talks": 48,
        "tracks": 3,
        "days": 2,
        "sessions": 6,
        "orchestrators": 10,
        "agents": 12,
    }
    hero = committed["hero"]
    assert hero["task"] == "t2_conference" and "real" in hero["title"]
    for workflow, series in hero["series"].items():
        assert workflow in hero["order"]
        for point in series["points"]:
            assert {"profile", "x", "stall_s", "extra_cost_pct", "seeds"} <= set(point)
    swarm, central = (hero["series"][w]["points"][-1] for w in ("swarm", "central"))
    assert (swarm["profile"], swarm["x"], central["x"]) == ("C3", 5, 5)
    assert committed["headline"]["real"] is True and committed["headline"]["seedCount"] == 3
    finish = committed["finish"]
    assert finish["talksPlaced"] == finish["talksTotal"] == 48
    assert (finish["task"], finish["real"], finish["seeds"]) == ("t2_conference", True, 1)
    assert (
        committed["lanes"]["central"]["stallS"]
        == committed["lanes"]["central"]["metrics"]["stallS"]
    )
    frames = committed["lanes"]["central"]["keyframes"]
    order = ("filled", "crash", "restart", "redone", "end")
    assert set(frames) == set(order)
    assert [frames[k] for k in order] == sorted(frames.values()), "the beats come in this order"
    assert frames["end"] == 1.0
    failures = committed["failures"]
    assert [round(f["value"], 1) for f in failures["fastRestart"]] == [13.2, 5.7]
    assert [f["value"] for f in failures["falseDeaths"][:2]] == [1.25, 2.25]
    assert round(failures["perProcess"]["value"], 2) == 0.9
    assert all(f["label"] for f in failures["fastRestart"] + failures["falseDeaths"])
    for row in committed["assumptions"]:
        assert {"id", "label", "value"} <= set(row) and row["label"] and row["value"]
    assert committed["tokens"] == {"coordination": 0, "recovery": 0}
    proof = committed["proof"]
    assert proof["lines"] == [
        f"MATCH  final: {committed['hashes']['count']} events, head {committed['hashes']['head']}"
    ]
    assert proof["takeover"]["line"] == committed["takeover"]["okLine"]


def test_validity_is_counted_from_the_rows_and_never_assumed(
    generator: ModuleType, committed: dict
):
    rows = [{"cell": "a__C0__s1", "valid": True}, {"cell": "a__C0__s10", "valid": False}]
    assert generator.validity(rows) == {"runs": 2, "valid": 1, "invalid": ["a__C0__s10"]}
    for name, directory in (("v1", generator.V1), ("headline", generator.HEADLINE)):
        on_disk = json.loads((REPO / directory / "results.json").read_text(encoding="utf-8"))
        assert committed["numbers"]["validity"][name] == generator.validity(on_disk)
    assert (committed["numbers"]["validity"]["headline10"] is not None) is (
        REPO / generator.HEADLINE_10 / "results.json"
    ).exists()


def test_no_key_of_the_data_says_that_every_run_was_valid(committed: dict):
    keys: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                keys.add(key)
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(committed)
    assert not [k for k in keys if re.search(r"(all|every).*valid|valid.*(all|every)", k, re.I)]


def test_the_lanes_name_their_setting(committed: dict):
    central = committed["lanes"]["central"]
    setting = central["setting"]
    assert (setting["task"], setting["profile"], setting["seed"]) == ("t2_conference", "C3", "1")
    assert setting["crashes"] == sum(1 for m in central["marks"] if m["kind"] == "crash") == 5
    assert setting["real"] is True and setting["label"] == "In-process supervisor"


def test_the_hero_names_its_set_and_the_ten_seed_reading_takes_over_only_when_it_exists(
    generator: ModuleType, committed: dict
):
    assert committed["hero"]["set"] == "v1"
    assert committed["hero"]["source"].startswith("bench/results/v1/")
    assert committed["sources"]["hero"]["path"] == committed["hero"]["source"]
    ten = REPO / generator.HEADLINE_10 / "hero-t2_conference.json"
    if not ten.exists():
        with pytest.raises(SystemExit, match="cannot be the hero yet"):
            generator.build(generator.DEFAULT_BUNDLE, None, committed, "headline-10")


def test_the_verdicts_name_their_setting(committed: dict):
    verdicts = committed["verdicts"]
    headline = committed["headline"]
    assert (verdicts["task"], verdicts["model"], verdicts["real"]) == (
        "t2_conference",
        "real",
        True,
    )
    assert verdicts["source"] == headline["source"]
    # the comparisons are the headline's: the rows they were computed from are the cells
    assert {c["profile"] for c in verdicts["comparisons"]} <= {
        c["profile"] for c in headline["cells"]
    }
    seeds = {s for c in verdicts["comparisons"] for s in c["seeds"]}
    assert seeds <= set(headline["seeds"])


def recorded_reading(generator: ModuleType, speaker: str) -> dict:
    """What the bundle's own events say about one speaker's email and availability fact, read
    straight from events.jsonl, apart from the generator's code."""
    emails: dict[str, dict] = {}
    readings = []
    with (REPO / generator.DEFAULT_BUNDLE / "events.jsonl").open(encoding="utf-8") as fh:
        for line in fh:
            event = json.loads(line)
            payload = event["payload"]
            if event["type"] == "effect.started" and payload.get("kind") == "llm":
                messages = payload["request"].get("input")
                first = messages[0].get("content") if isinstance(messages, list) else None
                block = re.search(
                    r"<<<UNTRUSTED emails\n(.*?)\nEND UNTRUSTED emails>>>", first or "", re.S
                )
                for item in json.loads(block.group(1)) if block else []:
                    emails.setdefault(item["speaker_id"], item)
            if event["type"] == "effect.completed" and payload.get("kind") == "llm":
                for item in payload["result"].get("output") or []:
                    if item.get("name") != "memory.publish_fact":
                        continue
                    args = json.loads(item["arguments"])
                    if args["key"] == f"speaker:{speaker}:availability":
                        readings.append(
                            (event["seq"], payload["effect_id"], payload["result"]["model"], args)
                        )
    return {"email": emails[speaker], "readings": readings}


def test_the_extraction_is_the_email_as_a_recorded_call_read_it(
    generator: ModuleType, committed: dict
):
    example = committed["extraction"]
    recorded = recorded_reading(generator, "S12")
    assert example["email"] == recorded["email"]["body"]
    first_seq, first_effect, model, args = recorded["readings"][0]
    assert committed["sources"]["extraction"] == {
        "path": "demo/final/events.jsonl",
        "runId": committed["sources"]["bundle"]["runId"],
        "head": committed["hashes"]["head"],
        "effect": first_effect,
        "seq": first_seq,
        "speaker": "S12",
        "email": recorded["email"]["id"],
        "readings": len(recorded["readings"]),
        "agreeing": len(recorded["readings"]),
    }
    assert model in example["model"] and "not a real person" in example["model"]
    # what the model published is what the constraints say, slot index for slot index
    value = json.loads(args["value_json"])
    assert value == {
        "available": [
            {"day": 1, "slots": list(range(9))},
            {"day": 2, "slots": list(range(2, 9))},
        ],
        "preference": "none",
    }
    assert [c["text"] for c in example["constraints"]] == [
        "Day 2: from 10:30",
        "Day 1: any time",
        "No time preference",
    ]


def test_each_constraint_points_at_the_words_it_is_read_from(committed: dict):
    example = committed["extraction"]
    email = example["email"]
    spans = [tuple(c["source"]) for c in example["constraints"]]
    assert spans == sorted(spans), "in the order of the email"
    for (_, end), (start, _) in zip(spans, spans[1:], strict=False):
        assert end <= start, "no two overlap"
    assert email.isascii(), "offsets count the same in Python and in the page"
    for constraint in example["constraints"]:
        start, end = constraint["source"]
        assert 0 <= start < end <= len(email)
    said = {c["text"]: email[c["source"][0] : c["source"][1]] for c in example["constraints"]}
    assert "10:30" in said["Day 2: from 10:30"] and "day 2" in said["Day 2: from 10:30"]
    assert "other day" in said["Day 1: any time"]
    assert said["No time preference"].startswith("No preference")


def test_slots_are_put_in_the_words_of_the_clock(generator: ModuleType):
    every = [
        {"index": 0, "start": "09:00", "end": "09:45"},
        {"index": 1, "start": "09:45", "end": "10:30"},
        {"index": 2, "start": "10:30", "end": "11:15"},
        {"index": 3, "start": "14:00", "end": "14:45"},
    ]
    words = generator.slot_words
    assert words(1, [0, 1, 2, 3], every) == "Day 1: any time"
    assert words(2, [2, 3], every) == "Day 2: from 10:30"
    assert words(2, [0, 1], every) == "Day 2: until 10:30"
    assert words(1, [1, 2], every) == "Day 1: 09:45 to 11:15"
    assert words(2, [], every) == "Day 2: not available"
    with pytest.raises(AssertionError, match="not one stretch"):
        words(1, [0, 2], every)
