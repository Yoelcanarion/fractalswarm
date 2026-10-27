"""Crown jewel: recorded runs replay bit for bit (spec §19, test_replay_verify).

The golden bundle in tests/golden/toy was recorded with scripts/record_golden.py (fake LLM,
sim clock). Replay re-runs the actors, answers every LLM call from the cassette, and must
rebuild the exact log. Any edit to the log is caught, and so is any cassette edit that
changes what an actor sees or pays (fields nothing reads, like the response's echoed
``model``, cannot change the run and are not compared).
"""

import json
import shutil
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fractalswarm.cli import app
from fractalswarm.kernel.events import EventDraft
from fractalswarm.kernel.store import EventStore
from fractalswarm.llm.client import LLMClient
from fractalswarm.llm.fake import FakeBackend, FakeReply
from fractalswarm.runs import record_run, replay_run

GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "toy"
GOLDEN_HEAD = (GOLDEN / "HEAD").read_text(encoding="utf-8").strip()


def golden_copy(tmp_path: Path) -> Path:
    run_dir = tmp_path / "golden-toy"
    shutil.copytree(GOLDEN, run_dir)
    return run_dir


async def test_golden_toy_replays_to_its_recorded_hash(tmp_path: Path) -> None:
    report = await replay_run(golden_copy(tmp_path))
    assert report.ok, report.detail
    assert report.replayed_head == report.recorded_head == GOLDEN_HEAD


async def test_real_spark_call_replays_to_its_recorded_hash(tmp_path: Path) -> None:
    # Recorded once against the real Meta Model API (one tiny Spark call, $0.0005).
    run_dir = tmp_path / "one-call"
    shutil.copytree(GOLDEN.parent / "one-call", run_dir)
    report = await replay_run(run_dir)
    assert report.ok, report.detail
    assert report.replayed_head == (run_dir / "HEAD").read_text(encoding="utf-8").strip()
    assert "LLM_" not in (run_dir / "cassette.jsonl").read_text(encoding="utf-8")


async def test_a_fresh_toy_run_reproduces_the_golden_hash(tmp_path: Path) -> None:
    # Same run id, seed and (recorded) role and price tables: a new process, same bytes.
    with EventStore.import_jsonl(GOLDEN / "events.jsonl") as golden:
        started = golden.get(1)
    assert started is not None
    roles, prices = LLMClient.config_from_snapshot(started.payload["config"]["llm"])
    result = await record_run(
        "toy",
        run_id=started.run_id,
        run_dir=tmp_path / "again",
        backend=FakeBackend(),
        seed=started.payload["seed"],
        params=started.payload["params"],
        run_cap_usd=started.payload["run_cap_usd"],
        roles=roles,
        prices=prices,
    )
    assert result.head_hash == GOLDEN_HEAD


async def test_live_clock_run_with_racing_completions_replays(tmp_path: Path) -> None:
    result = await record_run(
        "toy",
        run_id="live",
        run_dir=tmp_path / "live",
        backend=FakeBackend(),
        seed="3",
        params={"rounds": 3},
        clock="live",
        speed=50,
    )
    assert result.completed.payload["alive"] == []
    report = await replay_run(result.paths.root)
    assert report.ok, report.detail


async def test_retries_and_errors_replay_too(tmp_path: Path) -> None:
    def flaky(body, attempt):
        if "item 2" in str(body["input"]) and attempt == 0:
            return FakeReply(status=503, text="overloaded", retry_after_s=1)
        if "worker-b" in str(body["input"]):
            return FakeReply(status=400, text="rejected")
        return "fine"

    result = await record_run(
        "toy", run_id="flaky", run_dir=tmp_path / "flaky", backend=FakeBackend(script=flaky)
    )
    report = await replay_run(result.paths.root)
    assert report.ok, report.detail


async def test_tampered_log_is_reported_at_the_edited_event(tmp_path: Path) -> None:
    run_dir = golden_copy(tmp_path)
    lines = (run_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
    index = next(i for i, line in enumerate(lines) if '"type":"toy.done"' in line)
    event = json.loads(lines[index])
    event["payload"]["summary"] = "forged"
    lines[index] = json.dumps(event)
    (run_dir / "events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    report = await replay_run(run_dir)
    assert not report.ok and not report.chain_ok
    assert report.first_divergence == event["seq"]


async def test_resealed_forgery_is_caught_by_replay(tmp_path: Path) -> None:
    """Rewrite a completion and re-hash the whole chain: the chain is valid, the run is not."""
    run_dir = golden_copy(tmp_path)
    with EventStore.import_jsonl(run_dir / "events.jsonl") as original:
        events = list(original.read())
    forged = EventStore(run_dir / "events.sqlite")
    target = None
    for event in events:
        payload = event.payload
        if target is None and event.type == "effect.completed" and payload["kind"] == "llm":
            result = payload["result"] | {"output_text": "forged answer"}
            payload = payload | {"result": result}
            target = event.seq
        draft = event.model_dump(exclude={"seq", "prev_hash", "hash"}) | {"payload": payload}
        forged.append(EventDraft(**draft))
    forged.close()
    assert target is not None

    report = await replay_run(run_dir)
    assert report.chain_ok
    assert not report.ok
    assert report.first_divergence == target


async def test_tampered_cassette_is_caught(tmp_path: Path) -> None:
    run_dir = golden_copy(tmp_path)
    cassette = run_dir / "cassette.jsonl"
    text = cassette.read_text(encoding="utf-8")
    cassette.write_text(text.replace("[fake muse-spark-1.3]", "[edited]", 1), encoding="utf-8")
    report = await replay_run(run_dir)
    assert not report.ok
    assert report.first_divergence is not None


@pytest.mark.parametrize(("edit", "exit_code"), [(False, 0), (True, 1)])
def test_cli_replay_verify(tmp_path: Path, edit: bool, exit_code: int) -> None:
    run_dir = golden_copy(tmp_path)
    if edit:
        cassette = run_dir / "cassette.jsonl"
        text = cassette.read_text(encoding="utf-8")
        edited = text.replace('"output_tokens":42', '"output_tokens":41', 1)
        assert edited != text
        cassette.write_text(edited, encoding="utf-8")
    result = CliRunner().invoke(app, ["replay", str(run_dir), "--verify"])
    assert result.exit_code == exit_code, result.output
    assert ("MATCH" if exit_code == 0 else "MISMATCH") in result.output
