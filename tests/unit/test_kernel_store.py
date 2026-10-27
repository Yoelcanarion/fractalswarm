"""The event store: append-only, idempotent, and hash-chained so tampering is detected."""

import json
from pathlib import Path

import pytest

from fractalswarm.kernel.events import EventDraft
from fractalswarm.kernel.ids import GENESIS_HASH
from fractalswarm.kernel.store import DuplicateEvent, EventStore


def draft(n: int, **changes) -> EventDraft:
    fields = {
        "run_id": "r",
        "ts_virtual": n * 10,
        "lamport": n,
        "type": "msg.sent",
        "actor": "a",
        "idem_key": f"k{n}",
        "payload": {"to": "b", "topic": "t", "body": {"n": n}},
    }
    return EventDraft(**(fields | changes))


def filled(path: Path | str = ":memory:", count: int = 5) -> EventStore:
    store = EventStore(path)
    for n in range(1, count + 1):
        store.append(draft(n))
    return store


def test_append_assigns_seq_and_chains_hashes() -> None:
    store = filled()
    events = list(store.read())
    assert [event.seq for event in events] == [1, 2, 3, 4, 5]
    assert events[0].prev_hash == GENESIS_HASH
    for before, after in zip(events, events[1:], strict=False):
        assert after.prev_hash == before.hash
    assert store.head_hash == events[-1].hash
    assert store.verify_chain().ok


def test_payload_is_validated_and_defaults_filled() -> None:
    store = EventStore()
    event = store.append(draft(1, payload={"to": "b", "topic": "t"}))
    assert event.payload == {"to": "b", "topic": "t", "body": {}}
    with pytest.raises(ValueError, match="unknown event type"):
        store.append(draft(2, type="no.such.type"))
    with pytest.raises(ValueError):
        store.append(draft(3, payload={"to": "b"}))


def test_idem_key_is_unique() -> None:
    store = filled(count=1)
    with pytest.raises(DuplicateEvent):
        store.append(draft(2, idem_key="k1"))
    assert store.last_seq == 1
    assert store.has_idem_key("k1")


def test_reopening_continues_the_chain(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite"
    with filled(path, count=3) as store:
        head = store.head_hash
    with EventStore(path) as store:
        assert (store.last_seq, store.head_hash) == (3, head)
        store.append(draft(4))
        assert store.verify_chain().ok


@pytest.mark.parametrize(
    ("sql", "bad_seq"),
    [
        ('UPDATE events SET payload = \'{"to":"x","topic":"t","body":{}}\' WHERE seq = 3', 3),
        ("UPDATE events SET ts_virtual = 999 WHERE seq = 2", 2),
        ("DELETE FROM events WHERE seq = 4", 4),
        ("UPDATE events SET hash = 'f' || substr(hash, 2) WHERE seq = 5", 5),
    ],
)
def test_verify_chain_finds_the_first_tampered_event(sql: str, bad_seq: int) -> None:
    store = filled()
    store.db.execute(sql)
    report = store.verify_chain()
    assert not report.ok
    assert report.first_bad_seq == bad_seq


def test_jsonl_round_trip_keeps_hashes(tmp_path: Path) -> None:
    store = filled()
    store.export_jsonl(tmp_path / "events.jsonl")
    copy = EventStore.import_jsonl(tmp_path / "events.jsonl")
    assert copy.head_hash == store.head_hash
    assert copy.verify_chain().ok
    assert [e.model_dump() for e in copy.read()] == [e.model_dump() for e in store.read()]


def test_tampered_jsonl_is_detected(tmp_path: Path) -> None:
    filled().export_jsonl(tmp_path / "events.jsonl")
    lines = (tmp_path / "events.jsonl").read_text(encoding="utf-8").splitlines()
    event = json.loads(lines[1])
    event["payload"]["body"] = {"n": 99}
    lines[1] = json.dumps(event)
    (tmp_path / "events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    report = EventStore.import_jsonl(tmp_path / "events.jsonl").verify_chain()
    assert (report.ok, report.first_bad_seq) == (False, 2)
