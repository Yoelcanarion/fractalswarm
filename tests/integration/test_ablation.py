"""The ablation: the same notes through the regex parser and through Muse (arena spec §E.3).

Nothing here calls a model. The hand-written approved sample has notes the parser's patterns
do not cover and a Muse that is scripted per note, so the numbers are exact; the generator's
notes run on the fake backend, whose Muse is the parser itself.
"""

import asyncio
import json
import threading
import time
from pathlib import Path

import pytest
from starlette.exceptions import HTTPException
from starlette.testclient import TestClient

from fractalswarm.api.app import create_app
from fractalswarm.api.lens import ABLATION_TYPES, AblationJobs, ablation_view
from fractalswarm.bench.scoring import load_events, score_run
from fractalswarm.bench.tasks.t2_conference.ablation import (
    MAX_NOTE_CHARS,
    SCENARIO,
    Case,
    cases_from_corpus,
    cases_of,
    normalize,
    parse_note,
    score,
    source_of,
    summarize,
)
from fractalswarm.bench.tasks.t2_conference.generator import generate
from fractalswarm.bench.workflows import fake_backend
from fractalswarm.llm.fake import FakeBackend
from fractalswarm.planning.planner import read_blocks
from fractalswarm.planning.taskspec import TaskSpec, run_params
from fractalswarm.runs import record_run, replay_run

REPO = Path(__file__).resolve().parents[2]
DEMO = REPO / "demo"
SLOTS = [
    {"index": i, "start": start, "end": end}
    for i, (start, end) in enumerate(
        [
            ("09:00", "09:45"),
            ("09:45", "10:30"),
            ("10:30", "11:15"),
            ("11:15", "12:00"),
            ("12:00", "12:45"),
            ("14:00", "14:45"),
            ("14:45", "15:30"),
            ("15:30", "16:15"),
            ("16:15", "17:00"),
        ]
    )
]
FRAME = {"days": [1, 2], "slots": SLOTS}
EVERY = list(range(9))
MORNING = list(range(5))
AFTERNOON = [5, 6, 7, 8]


def email(note_id: str, subject: str, text: str, available: list, preference: str) -> dict:
    reference = {"available": available, "preference": preference}
    return {
        "id": note_id,
        "kind": "email",
        "subject": subject,
        "text": text,
        "reference": reference,
    }


def abstract(note_id: str, text: str, attendance: int) -> dict:
    reference = {"expected_attendance": attendance}
    return {
        "id": note_id,
        "kind": "abstract",
        "subject": note_id,
        "text": text,
        "reference": reference,
    }


# Written the way people write: the parser's patterns cover E91, T90 and (within 10 %) T92 only.
SAMPLE = [
    email(
        "E90",
        "S90",
        "Hi! I'm flying in on the red-eye, so on day 1 nothing before 2pm please. "
        "Day 2 is completely open. I'd rather speak late in the day.",
        [{"day": 1, "slots": AFTERNOON}, {"day": 2, "slots": EVERY}],
        "afternoon",
    ),
    email(
        "E91",
        "S91",
        "I can only attend on day 2. If you can, put me in the afternoon.",
        [{"day": 2, "slots": EVERY}],
        "afternoon",
    ),
    email(
        "E92",
        "S92",
        "Mornings only for me, please, on both days: the school run eats my afternoons!",
        [{"day": 1, "slots": MORNING}, {"day": 2, "slots": MORNING}],
        "none",
    ),
    abstract("T90", "A full room is expected: organizers say about 80 attendees.", 80),
    abstract("T91", "Last year this drew roughly a hundred and twenty people.", 120),
    abstract("T92", "We are planning for about 95 people.", 100),
]
# What the scripted Muse answers: right on all but E92's preference.
MUSE = {
    "E90": {
        "available": [{"day": 1, "slots": AFTERNOON}, {"day": 2, "slots": EVERY}],
        "preference": "afternoon",
    },
    "E91": {"available": [{"day": 2, "slots": EVERY}], "preference": "afternoon"},
    "E92": {
        "available": [{"day": 1, "slots": MORNING}, {"day": 2, "slots": MORNING}],
        "preference": "morning",
    },
    "T90": {"expected_attendance": 80},
    "T91": {"expected_attendance": 120},
    "T92": {"expected_attendance": 100},
}


def scripted_muse(answers: dict[str, dict]) -> FakeBackend:
    def script(body: dict, attempt: int) -> str:
        note = read_blocks(body["input"])["note"]
        return json.dumps(answers[note["id"]], sort_keys=True)

    return FakeBackend(script=script)


def record(run_dir: Path, backend: FakeBackend, options: dict | None = None, **kwargs) -> None:
    ablation = {"cases": SAMPLE, "frame": FRAME, "source": "inline"} | (options or {})
    asyncio.run(
        record_run(
            SCENARIO,
            run_id=run_dir.name,
            run_dir=run_dir,
            backend=backend,
            params={"ablation": ablation},
            **kwargs,
        )
    )


@pytest.fixture(scope="module")
def sample_run(tmp_path_factory: pytest.TempPathFactory) -> Path:
    run_dir = tmp_path_factory.mktemp("runs") / "ablation-sample"
    record(run_dir, scripted_muse(MUSE))
    return run_dir


def done_of(run_dir: Path) -> dict:
    return next(e.payload for e in load_events(run_dir) if e.type == "ablation.done")


def notes_of(run_dir: Path) -> dict[str, dict]:
    return {
        e.payload["note_id"]: e.payload for e in load_events(run_dir) if e.type == "ablation.note"
    }


# -- the score -------------------------------------------------------------------------------


def test_an_email_is_understood_when_its_cells_and_preference_match() -> None:
    reference = {
        "available": [{"day": 1, "slots": [0, 1]}, {"day": 2, "slots": [3]}],
        "preference": "none",
    }
    assert score("email", reference, reference) == {
        "understood": True,
        "cells_exact": True,
        "jaccard": 1.0,
        "preference": True,
    }
    wrong_pref = reference | {"preference": "morning"}
    assert score("email", reference, wrong_pref) == {
        "understood": False,
        "cells_exact": True,
        "jaccard": 1.0,
        "preference": False,
    }


def test_partial_cells_get_a_jaccard_and_no_reading_scores_zero() -> None:
    reference = {"available": [{"day": 1, "slots": [0, 1, 2, 3]}], "preference": "none"}
    reading = {"available": [{"day": 1, "slots": [2, 3, 4, 5]}], "preference": "none"}
    result = score("email", reference, reading)
    assert result["jaccard"] == pytest.approx(2 / 6) and not result["cells_exact"]
    assert result["preference"] and not result["understood"]
    assert score("email", reference, None) == {
        "understood": False,
        "cells_exact": False,
        "jaccard": 0.0,
        "preference": False,
    }
    nothing = {"available": [], "preference": "none"}
    assert score("email", nothing, nothing)["jaccard"] == 1.0


@pytest.mark.parametrize(
    ("reference", "reading", "within"),
    [
        (146, 132, True),  # 14 off of 14.6
        (146, 160, True),
        (146, 131, False),
        (146, 161, False),
        (100, 110, True),  # exactly 10 % counts
        (100, 90, True),
        (100, 111, False),
        (150, 135, True),
        (0, 0, True),
        (0, 1, False),
    ],
)
def test_attendance_counts_within_ten_percent_of_the_reference(reference, reading, within) -> None:
    result = score("abstract", {"expected_attendance": reference}, {"expected_attendance": reading})
    assert result["understood"] is within and result["within"] is within
    assert result["error"] == reading - reference
    assert result["error_pct"] == (
        None if reference == 0 else abs(reading - reference) / reference * 100
    )


def test_a_reading_is_normalized_before_it_is_compared() -> None:
    loose = {
        "available": [
            {"day": 2, "slots": [3, 1, 1]},
            {"day": 1, "slots": []},
            {"day": 2, "slots": [0]},
        ],
        "preference": "none",
    }
    assert normalize(loose) == {"available": [{"day": 2, "slots": [0, 1, 3]}], "preference": "none"}
    assert normalize({"expected_attendance": 7}) == {"expected_attendance": 7}


# -- the notes of the generator ---------------------------------------------------------------


def test_the_generators_truth_becomes_the_reference() -> None:
    corpus, truth = generate(1)
    found = cases_from_corpus(corpus, truth)
    assert [c.kind for c in found].count("email") == 32 and [c.kind for c in found].count(
        "abstract"
    ) == 48
    first = found[0]
    assert (first.id, first.kind, first.subject) == (
        "E01",
        "email",
        corpus["emails"][0]["speaker_id"],
    )
    cells = {(d, s) for d, s in truth["availability"][first.subject]}
    assert {(e["day"], s) for e in first.reference["available"] for s in e["slots"]} == cells
    assert first.reference["preference"] == (truth["preferences"][first.subject] or "none")
    talk = next(c for c in found if c.kind == "abstract")
    assert talk.reference == {"expected_attendance": truth["attendance"][talk.id]}
    few = cases_from_corpus(corpus, truth, emails=3, abstracts=2)
    assert [c.id for c in few] == ["E01", "E02", "E03", "T01", "T02"]
    assert cases_from_corpus(corpus, truth, emails=0, abstracts=1)[0].kind == "abstract"


def test_the_parser_reads_the_generators_phrasings() -> None:
    corpus, truth = generate(1)
    for case in cases_from_corpus(corpus, truth):  # the regex wins here by construction
        reading = parse_note(case.model_dump(), {"days": corpus["days"], "slots": corpus["slots"]})
        assert score(case.kind, normalize(case.reference), reading)["understood"], case.id


def test_cases_must_be_unique_and_not_empty() -> None:
    with pytest.raises(ValueError, match="unique"):
        cases_of({"ablation": {"cases": [SAMPLE[0], SAMPLE[0]], "frame": FRAME}})
    with pytest.raises(ValueError, match="no notes"):
        cases_of({"corpus": {"emails": [], "talks": []}, "truth": {}})
    with pytest.raises(ValueError):
        Case.model_validate(SAMPLE[0] | {"reference": {"expected_attendance": 3}})


# -- the hand-written approved sample, with a scripted Muse -----------------------------------


def test_the_headline_counts_the_notes_each_reader_understood(sample_run: Path) -> None:
    done = done_of(sample_run)
    assert done["headline"] == "the parser understood 3 of 6 notes, Muse 5 of 6"
    assert done["complete"] and done["notes"] == 6
    assert (done["source"], done["backend"]) == ("inline", "fake")
    assert done["parser"]["emails"] == {
        "of": 3,
        "understood": 1,
        "cells_exact": 1,
        "preference": 2,
        "mean_jaccard": pytest.approx((13 / 18 + 1 + 10 / 18) / 3),
    }
    assert done["parser"]["abstracts"]["understood"] == 2
    assert done["muse"]["emails"]["understood"] == 2 and done["muse"]["emails"]["cells_exact"] == 3
    assert (
        done["muse"]["emails"]["preference"] == 2 and done["muse"]["emails"]["mean_jaccard"] == 1.0
    )
    assert done["muse"]["abstracts"] == {"of": 3, "understood": 3, "mean_error_pct": 0.0}
    assert done["agreement"] == {"both": 3, "only_muse": 2, "only_parser": 0, "neither": 1}
    assert done["differences"] == ["E90", "E92", "T91", "T92"]


def test_each_note_has_both_readings_and_their_scores(sample_run: Path) -> None:
    notes = notes_of(sample_run)
    e90 = notes["E90"]
    assert e90["reference"] == {
        "available": [{"day": 1, "slots": AFTERNOON}, {"day": 2, "slots": EVERY}],
        "preference": "afternoon",
    }
    assert e90["parser"]["reading"] == {
        "available": [{"day": 1, "slots": EVERY}, {"day": 2, "slots": EVERY}],
        "preference": "none",
    }
    assert e90["parser"]["score"]["understood"] is False
    assert e90["parser"]["score"]["jaccard"] == pytest.approx(13 / 18)
    assert e90["muse"]["score"]["understood"] is True and e90["muse"]["error"] is None
    assert (
        notes["E91"]["parser"]["score"]["understood"]
        and notes["E91"]["muse"]["score"]["understood"]
    )
    assert notes["E92"]["parser"]["score"]["jaccard"] == pytest.approx(10 / 18)
    assert notes["E92"]["muse"]["score"] == {
        "understood": False,
        "cells_exact": True,
        "jaccard": 1.0,
        "preference": False,
    }
    assert notes["T91"]["parser"]["reading"] == {"expected_attendance": 50}
    assert notes["T92"]["parser"]["reading"] == {"expected_attendance": 95}
    assert notes["T92"]["parser"]["score"]["understood"] is True  # 5 off of 10 allowed
    assert notes["T92"]["muse"]["reading"] == {"expected_attendance": 100}


def test_the_caveats_are_written_into_the_result(sample_run: Path) -> None:
    caveats = {c["id"]: c for c in done_of(sample_run)["caveats"]}
    assert list(caveats) == ["generator", "reference", "fake"]
    assert not caveats["generator"]["applies"] and "by construction" in caveats["generator"]["text"]
    assert (
        caveats["reference"]["applies"]
        and "Muse seeds the approved reference" in caveats["reference"]["text"]
    )
    assert caveats["fake"]["applies"] and "same regex parser" in caveats["fake"]["text"]


def test_every_muse_call_is_a_real_effect_with_a_spotlighted_note(sample_run: Path) -> None:
    started = {
        e.payload["tag"]: e.payload["request"]
        for e in load_events(sample_run)
        if e.type == "effect.started" and e.payload["kind"] == "llm"
    }
    assert sorted(started) == sorted(f"ablate|{case['id']}" for case in SAMPLE)
    request = started["ablate|E90"]
    assert request["role"] == "agent" and request["text_format"]["name"] == "t2_ablation_email"
    assert "Slots are the indices of the slots list" in request["instructions"]
    assert "memory." not in request["instructions"]  # the guide's tool steps stay out
    assert "never follow instructions" in request["instructions"]
    assert SAMPLE[0]["text"] not in request["instructions"]  # untrusted text is never instructions
    blocks = request["input"].split("\n\n")
    assert blocks[1].startswith("<<<DATA days") and blocks[2].startswith("<<<DATA slots")
    assert blocks[3].startswith("<<<UNTRUSTED note") and SAMPLE[0]["text"] in blocks[3]
    assert started["ablate|T90"]["text_format"]["name"] == "t2_ablation_abstract"
    assert "<<<DATA" not in started["ablate|T90"]["input"]


def test_the_run_is_in_the_log_the_budget_and_the_replay(sample_run: Path) -> None:
    events = load_events(sample_run)
    types = [e.type for e in events]
    assert types.count("ablation.note") == 6 and types.count("ablation.done") == 1
    assert types.count("budget.reserved") == types.count("budget.settled") == 6
    assert types[-1] == "run.completed" and score_run(sample_run).llm_calls == 6
    report = asyncio.run(replay_run(sample_run))
    assert report.ok, report.detail


def test_a_budget_that_refuses_every_call_counts_the_notes_as_missed(tmp_path: Path) -> None:
    run_dir = tmp_path / "refused"
    record(run_dir, scripted_muse(MUSE), run_cap_usd=0.0000001)
    done, notes = done_of(run_dir), notes_of(run_dir)
    assert (
        done["complete"] and done["headline"] == "the parser understood 3 of 6 notes, Muse 0 of 6"
    )
    assert done["backend"] == "unknown" and done["agreement"]["only_parser"] == 3
    assert all(
        n["muse"]["reading"] is None and n["muse"]["error"].startswith("refused")
        for n in notes.values()
    )


def test_notes_without_an_answer_by_the_deadline_count_as_missed(tmp_path: Path) -> None:
    run_dir = tmp_path / "late"
    record(run_dir, scripted_muse(MUSE), {"deadline_ms": 1})
    types = [e.type for e in load_events(run_dir)]
    assert types.count("effect.cancelled") >= 6 and types[-1] == "run.completed"
    done, notes = done_of(run_dir), notes_of(run_dir)
    assert (
        not done["complete"]
        and done["headline"] == "the parser understood 3 of 6 notes, Muse 0 of 6"
    )
    assert {n["muse"]["error"] for n in notes.values()} == {"no answer before the deadline"}
    assert asyncio.run(replay_run(run_dir)).ok


def test_a_window_of_one_runs_the_notes_one_after_the_other(tmp_path: Path) -> None:
    run_dir = tmp_path / "serial"
    record(run_dir, scripted_muse(MUSE), {"concurrency": 1})
    events = load_events(run_dir)
    order = [
        e.payload["tag"]
        for e in events
        if e.type == "effect.started" and e.payload["kind"] == "llm"
    ]
    assert order == [f"ablate|{case['id']}" for case in SAMPLE]
    open_calls = 0
    for event in events:
        if event.type == "effect.started" and event.payload["kind"] == "llm":
            open_calls += 1
        elif event.type == "effect.completed" and (event.payload["tag"] or "").startswith(
            "ablate|"
        ):
            open_calls -= 1
        assert open_calls <= 1
    assert done_of(run_dir)["headline"] == "the parser understood 3 of 6 notes, Muse 5 of 6"


def test_the_summary_of_nothing_understood_has_no_means() -> None:
    note = {
        "note_id": "E1",
        "kind": "email",
        "parser": {
            "reading": None,
            "score": score("email", normalize(SAMPLE[1]["reference"]), None),
        },
        "muse": {"reading": None, "score": score("email", normalize(SAMPLE[1]["reference"]), None)},
    }
    summary = summarize([note], source="approved", backend="real", complete=True)
    assert summary["headline"] == "the parser understood 0 of 1 notes, Muse 0 of 1"
    assert summary["parser"]["abstracts"] == {"of": 0, "understood": 0, "mean_error_pct": None}
    assert summary["differences"] == [] and summary["agreement"]["neither"] == 1
    applies = {c["id"]: c["applies"] for c in summary["caveats"]}
    assert applies == {"generator": False, "reference": True, "fake": False}


# -- the routes ---------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def runs_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("api-runs")


@pytest.fixture(scope="module")
def client(runs_dir: Path) -> TestClient:
    return TestClient(create_app(runs_dir, DEMO, runs_dir / "bench", Path("none")))


def wait_for(client: TestClient, run_id: str, status: str = "completed") -> dict:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        body = client.get(f"/api/ablation/{run_id}").json()
        if body["status"] == status:
            return body
        assert body["status"] in ("running", status), body
        time.sleep(0.1)
    raise AssertionError(f"ablation {run_id} did not reach {status}: {body}")


def test_the_generators_notes_run_on_the_fake_backend_from_the_api(client: TestClient) -> None:
    started = client.post("/api/ablation", json={})
    assert started.status_code == 202, started.text
    run_id = started.json()["run_id"]
    assert started.json() == {
        "run_id": run_id,
        "notes": 16,
        "url": f"/api/ablation/{run_id}",
        "started": True,
    }
    body = wait_for(client, run_id)
    assert body["progress"] == {"done": 16, "of": 16} and body["error"] is None
    result = body["result"]
    assert result["headline"] == "the parser understood 16 of 16 notes, Muse 16 of 16"
    assert (result["source"], result["backend"], result["complete"]) == ("generator", "fake", True)
    assert [c["id"] for c in result["caveats"] if c["applies"]] == ["generator", "fake"]
    assert [n["note_id"] for n in body["notes"]] == [f"E0{i}" for i in range(1, 9)] + [
        f"T0{i}" for i in range(1, 9)
    ]
    first = body["notes"][0]
    assert first["text"].startswith(("Hi", "Hello", "Dear"))
    assert first["reference_text"] == first["parser"]["text"] == first["muse"]["text"]
    assert "day 1:" in first["reference_text"] and first["muse"]["score"]["understood"]
    assert body["notes"][8]["reference_text"].startswith("about ")
    again = client.post("/api/ablation", json={})
    assert again.status_code == 200 and again.json()["started"] is False
    assert again.json()["run_id"] == run_id
    # the run is an ordinary run: it is listed, and the lens shows every Muse call of it
    assert run_id in [run["id"] for run in client.get("/api/runs").json()]
    rows = client.get(f"/api/runs/{run_id}/calls").json()["calls"]
    assert len(rows) == 16 and {row["purpose"] for row in rows} == {"ablation"}
    assert {row["ref"]["kind"] for row in rows} == {"ablate"} and rows[0]["ref"]["note_id"] == "E01"
    assert {row["badge"] for row in rows} == {"spark"} and {row["role"] for row in rows} == {
        "agent"
    }
    totals = client.get(f"/api/runs/{run_id}/models").json()["totals"]
    assert totals["calls"] == 16 and totals["coordination_tokens"] == 0


def test_posted_notes_come_back_with_their_readings_in_words(client: TestClient) -> None:
    body = {"source": "inline", "cases": SAMPLE}
    started = client.post("/api/ablation", json=body)
    assert started.status_code == 202 and started.json()["notes"] == 6
    done = wait_for(client, started.json()["run_id"])
    # the fake backend's Muse is the parser: the two agree by construction
    assert done["result"]["headline"] == "the parser understood 3 of 6 notes, Muse 3 of 6"
    assert done["result"]["agreement"] == {
        "both": 3,
        "only_muse": 0,
        "only_parser": 0,
        "neither": 3,
    }
    assert done["result"]["differences"] == []
    assert [c["id"] for c in done["result"]["caveats"] if c["applies"]] == ["reference", "fake"]
    notes = {n["note_id"]: n for n in done["notes"]}
    assert notes["E90"]["reference_text"] == "day 1: 14:00-17:00; day 2: all day; prefers afternoon"
    assert notes["E90"]["parser"]["text"] == ("day 1: all day; day 2: all day; no time preference")
    assert notes["E91"]["reference_text"] == "day 1: not free; day 2: all day; prefers afternoon"
    assert notes["T92"]["reference_text"] == "about 100 attendees"
    assert notes["T92"]["parser"]["text"] == "about 95 attendees"
    assert notes["E92"]["text"].startswith("Mornings only")


def test_a_bad_request_is_a_422_and_a_real_backend_is_not_run_here(client: TestClient) -> None:
    def post(body):
        return client.post(
            "/api/ablation", content=json.dumps(body), headers={"content-type": "application/json"}
        )

    assert post({"colour": "red"}).status_code == 422
    assert post({"source": "inline"}).status_code == 422
    assert "source inline needs cases" in post({"source": "inline"}).json()["error"]
    assert post({"cases": SAMPLE}).status_code == 422  # cases belong to source inline
    assert post({"emails": 0, "abstracts": 0}).status_code == 422
    assert post({"emails": 5000}).status_code == 422
    bad = post(
        {"source": "inline", "cases": [SAMPLE[0] | {"reference": {"expected_attendance": 1}}]}
    )
    assert bad.status_code == 422 and "cases.0" in bad.json()["error"]
    twice = post({"source": "inline", "cases": [SAMPLE[0], SAMPLE[0]]})
    assert twice.status_code == 422 and "unique" in twice.json()["error"]
    assert client.post("/api/ablation", content=b"{nope").status_code == 422
    real = post({"backend": "real"})
    assert real.status_code == 501 and "coordinator" in real.json()["error"]


def test_only_ablation_runs_have_an_ablation_status(client: TestClient) -> None:
    assert client.get("/api/ablation/nope").status_code == 404
    other = client.get("/api/ablation/demo-backup")
    assert other.status_code == 404 and "not an ablation" in other.json()["error"]


def test_a_busy_server_says_so_instead_of_queueing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("fractalswarm.api.lens.MAX_RUNNING_ABLATIONS", 0)
    busy = client.post("/api/ablation", json={"seed": 41})
    assert busy.status_code == 429 and "running" in busy.json()["error"]
    assert client.get("/api/ablation/ablation-nothing").status_code == 404  # nothing was started


def test_a_job_that_raises_is_reported_as_failed(
    client: TestClient, runs_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("fractalswarm.runs.record_run", boom)
    started = client.post("/api/ablation", json={"seed": 42})
    assert started.status_code == 202
    run_id = started.json()["run_id"]
    failed = wait_for(client, run_id, "failed")
    assert failed["error"] == "RuntimeError: boom" and failed["result"] is None
    assert failed["progress"] == {"done": 0, "of": 16} and failed["notes"] == []
    assert not (runs_dir / run_id).exists()  # no empty run directory is left behind


def test_two_ablations_can_be_recorded_at_once(client: TestClient, runs_dir: Path) -> None:
    ids = []
    for seed in (51, 52):
        started = client.post("/api/ablation", json={"seed": seed, "emails": 32, "abstracts": 48})
        assert started.status_code == 202, started.text
        ids.append(started.json()["run_id"])
    assert len(set(ids)) == 2
    for run_id in ids:
        body = wait_for(client, run_id)
        assert body["progress"] == {"done": 80, "of": 80} and body["result"]["complete"]
        assert asyncio.run(replay_run(runs_dir / run_id)).ok  # threads do not cross the logs


# -- the view of a log that has not ended, and the notes' bounds -------------------------------


def test_a_log_that_never_ended_is_running_failed_or_interrupted(sample_run: Path) -> None:
    events = [e for e in load_events(sample_run) if e.type in ABLATION_TYPES]
    started, notes = events[0], [e for e in events if e.type == "ablation.note"]
    kept = [started, *reversed(notes[:3])]  # answers come in any order; the view keeps the cases'
    jobs = AblationJobs()
    view = ablation_view(kept, jobs, "r")
    assert view["status"] == "interrupted" and view["error"] is None and view["result"] is None
    assert view["progress"] == {"done": 3, "of": 6}
    assert [n["note_id"] for n in view["notes"]] == sorted(n.payload["note_id"] for n in notes[:3])
    jobs.failed["r"] = "RuntimeError: boom"
    failed = ablation_view(kept, jobs, "r")
    assert failed["status"] == "failed" and failed["error"] == "RuntimeError: boom"
    release = threading.Event()
    jobs.threads["r"] = thread = threading.Thread(target=release.wait)
    thread.start()
    try:
        assert ablation_view(kept, jobs, "r")["status"] == "running"  # alive wins over failed
    finally:
        release.set()
        thread.join()
    with pytest.raises(HTTPException) as nothing:
        ablation_view([], jobs, "r")
    assert nothing.value.status_code == 404


def test_a_note_id_cannot_carry_the_tag_separator_and_a_text_is_bounded() -> None:
    for bad in ("a|b", "", "x" * 65, "has space"):
        with pytest.raises(ValueError):
            Case.model_validate(SAMPLE[0] | {"id": bad})
    with pytest.raises(ValueError):
        Case.model_validate(SAMPLE[0] | {"text": "x" * (MAX_NOTE_CHARS + 1)})
    assert Case.model_validate(SAMPLE[0] | {"id": "msg-1.2:a@b_c"}).id == "msg-1.2:a@b_c"


def test_the_params_a_cli_run_records_carry_the_notes(tmp_path: Path) -> None:
    """What `fractalswarm run <t2 taskspec>` records is enough for the ablation scenario."""
    spec = TaskSpec.load(REPO / "tasks" / "examples" / "t2-conference.yaml")
    params = run_params(spec)
    assert len(cases_of(params)) == 80 and source_of(params) == "generator"
    run_dir = tmp_path / "cli"
    asyncio.run(
        record_run(
            SCENARIO,
            run_id="cli",
            run_dir=run_dir,
            backend=fake_backend(),
            seed=spec.seed,
            params=params,
            run_cap_usd=spec.budget_usd,
        )
    )
    done = done_of(run_dir)
    assert done["notes"] == 80 and done["complete"] and done["backend"] == "fake"
    assert asyncio.run(replay_run(run_dir)).ok
