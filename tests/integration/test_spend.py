"""Real spend from the UI: the preflight and the gate in front of every billed launch.

Nothing here spends money or opens the project's ledger. The ledger is a temp file the tests
fill themselves, and every process the API starts is a stand-in that only reports how it was
called (the fixture is autouse, so a test cannot start the real CLI by forgetting to ask).
"""

import dataclasses
import json
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from fractalswarm.api import jobs
from fractalswarm.api.app import create_app
from fractalswarm.api.spend import (
    CONFIRM_WORD,
    RUN_CAP_USD,
    Preflights,
    Spend,
    SpendGate,
    digest_of,
)
from fractalswarm.config import Settings
from fractalswarm.market.ledger import ProjectLedger

PATIENCE_S = 60.0
SPEC = {
    "goal": "Program the conference",
    "inputs": {"fixture": "tasks/fixtures/t2/seed-1", "generate_seed": 1},
    "seed": "1",
}
T1_SPEC = {
    "goal": "Extract the company facts",
    "task": "t1_extraction",
    "inputs": {"fixture": "tasks/fixtures/t1/seed-1", "generate_seed": 1},
    "seed": "1",
}


def t2_intake(intake_id: str) -> dict[str, Any]:
    return {"goal": "Program the live conference", "inputs": {"intake": intake_id}, "seed": "1"}


STAND_IN = (
    "import json, os, sys, time\n"
    "print(json.dumps({'argv': sys.argv[1:], 'ledger': os.environ.get('FRACTALSWARM_LEDGER_PATH'),"
    " 'cap': os.environ.get('FRACTALSWARM_PROJECT_CAP_USD')}), flush=True)\n"
    "time.sleep(30)\n"
)


@pytest.fixture(autouse=True)
def stand_in_processes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(jobs, "LAUNCH", [sys.executable, "-c", STAND_IN])


class Api:
    def __init__(self, tmp_path: Path, gate: SpendGate | None, preflights: Preflights | None):
        self.runs, self.private = tmp_path / "runs", tmp_path / "private"
        self.runs.mkdir()
        self.spend = Spend(gate, preflights) if gate is not None else None
        app = create_app(
            self.runs,
            None,
            tmp_path / "bench",
            tmp_path / "static",
            private_dir=self.private,
            spend=self.spend,
        )
        self.client = TestClient(app)

    def post(self, path: str, body: dict[str, Any] | None = None):
        return self.client.post(path, json=body or {})

    def get(self, path: str):
        return self.client.get(path)

    def wait(self, until: Callable[[], Any], what: str) -> Any:
        deadline = time.monotonic() + PATIENCE_S
        while time.monotonic() < deadline:
            if found := until():
                return found
            time.sleep(0.1)
        raise AssertionError(f"timed out waiting for {what}")

    def stand_in_called_with(self, job_id: str, index: int = 0) -> dict[str, Any]:
        def printed() -> dict[str, Any] | None:
            tail = self.get(f"/api/jobs/{job_id}").json()["runs"][index]["log_tail"].strip()
            return json.loads(tail.splitlines()[0]) if tail else None

        return self.wait(printed, "the stand-in process to say how it was started")


def make_api(tmp_path: Path, monkeypatch, **gate: Any) -> Api:
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "unused.sqlite"))
    ledger = tmp_path / "ledger.sqlite"
    defaults = {"project_cap_usd": 150.0, "allow_real": True, "phase_start_usd": 0.0}
    return Api(tmp_path, SpendGate(ledger, **(defaults | gate)), None)


@pytest.fixture
def api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    found = make_api(tmp_path, monkeypatch, phase_cap_usd=50.0, hard_stop_usd=1000.0)
    yield found
    for job in found.get("/api/jobs").json():
        if job["state"] in jobs.ACTIVE:
            found.post(f"/api/jobs/{job['id']}/cancel")


def fill_ledger(path: Path, settled: float = 0.0, reserved: float = 0.0, tag: str = "a") -> None:
    """Spend that earlier runs left in the (temp) ledger: settled, and still reserved."""
    ledger = ProjectLedger(path, 1000.0)
    if settled:
        assert ledger.reserve(f"{tag}-settled", "earlier-run", "muse", settled) is None
        ledger.settle(f"{tag}-settled", settled)
    if reserved:
        assert ledger.reserve(f"{tag}-open", "earlier-run", "muse", reserved) is None


def billed(token: str | None, **body: Any) -> dict[str, Any]:
    fields = {"spec": SPEC, "backend": "real", "preflight_token": token, "confirm": CONFIRM_WORD}
    return fields | body


def flag(argv: list[str], name: str) -> str:
    return argv[argv.index(name) + 1]


# -- the preflight ---------------------------------------------------------------------------


def test_the_preflight_prices_a_run_and_hands_out_a_token(api: Api) -> None:
    answer = api.post("/api/tasks/preflight", {"spec": SPEC})
    assert answer.status_code == 200, answer.text
    price = answer.json()
    assert price["ok"] is True and price["refusals"] == [] and price["kind"] == "task"
    assert price["token"] and price["confirm_word"] == "SPEND" and price["expires_in_s"] > 0
    assert price["runs"] == 1 and price["calls_per_run"] > 100
    assert price["run_cap_usd"] == RUN_CAP_USD == 0.75
    assert price["worst_case_usd"] == min(price["estimate_usd_per_run"], RUN_CAP_USD) > 0
    assert price["standing"]["committed_usd"] == 0 and price["standing"]["project_cap_usd"] == 150
    assert not api.spend.gate.ledger_path.exists()  # pricing never creates the ledger
    again = api.post("/api/tasks/preflight", {"spec": SPEC}).json()
    assert again["token"] != price["token"]


def test_the_preflight_of_a_pair_prices_both_runs(api: Api) -> None:
    one = api.post("/api/tasks/preflight", {"spec": SPEC, "chaos": "kill-half"}).json()
    pair = api.post("/api/arena/preflight", {"spec": SPEC, "rival": "central"}).json()
    assert pair["ok"] is True and pair["kind"] == "arena" and pair["runs"] == 2
    assert pair["worst_case_usd"] == 2 * min(pair["estimate_usd_per_run"], RUN_CAP_USD)
    assert pair["calls_per_run"] == one["calls_per_run"]  # half the brains: the same five crashes
    assert pair["token"] and pair["token"] != one["token"]


def test_the_preflight_prices_the_corpus_whichever_way_it_arrives(api: Api) -> None:
    from fractalswarm.bench.tasks.t2_conference.generator import load_fixture

    corpus, truth = load_fixture(Path(__file__).resolve().parents[2] / SPEC["inputs"]["fixture"])
    inline = {"goal": "Program it", "inputs": {"inline": {"corpus": corpus, "truth": truth}}}
    by_fixture = api.post("/api/tasks/preflight", {"spec": SPEC})
    by_text = api.post("/api/tasks/preflight", {"spec": inline | {"seed": "1"}})
    assert by_fixture.status_code == by_text.status_code == 200, by_text.text
    assert by_text.json()["ok"] is True
    assert by_text.json()["calls_per_run"] == by_fixture.json()["calls_per_run"] > 100


@pytest.mark.parametrize(
    ("gate", "needle"),
    [
        ({"allow_real": False}, "FRACTALSWARM_ALLOW_UI_REAL"),
        ({"has_key": False}, "MODEL_API_KEY"),
        ({"phase_cap_usd": 0.5}, "phase cap"),
        ({"project_cap_usd": 0.5}, "project cap"),
    ],
)
def test_a_preflight_that_cannot_pass_says_why_and_gives_no_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, gate: dict[str, Any], needle: str
) -> None:
    api = make_api(tmp_path, monkeypatch, **({"phase_cap_usd": 50.0} | gate))
    price = api.post("/api/tasks/preflight", {"spec": SPEC}).json()
    assert price["ok"] is False and price["token"] is None and price["expires_in_s"] is None
    assert any(needle in reason for reason in price["refusals"]), price["refusals"]


def test_the_caps_count_what_the_ledger_holds_now(api: Api) -> None:
    fill_ledger(api.spend.gate.ledger_path, settled=40.0, reserved=9.5)
    price = api.post("/api/tasks/preflight", {"spec": SPEC}).json()
    standing = price["standing"]
    assert standing["settled_usd"] == 40.0 and standing["reserved_usd"] == 9.5
    assert standing["committed_usd"] == 49.5 and standing["phase_remaining_usd"] == 0.5
    assert price["ok"] is False and "phase cap" in price["refusals"][0]
    assert "$0.50 left" in price["refusals"][0]


def test_the_default_caps_are_the_phase_cap_from_11_82_and_the_hard_stop_at_61_8(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "unused.sqlite"))
    gate = SpendGate(tmp_path / "ledger.sqlite", project_cap_usd=150.0, allow_real=True)
    api = Api(tmp_path, gate, None)
    fill_ledger(gate.ledger_path, settled=61.0)  # $0.80 under the hard stop
    assert api.post("/api/tasks/preflight", {"spec": SPEC}).json()["ok"] is True
    fill_ledger(gate.ledger_path, settled=0.1, tag="b")  # $0.70 left
    refused = api.post("/api/tasks/preflight", {"spec": SPEC}).json()
    assert refused["ok"] is False and "phase cap" in refused["refusals"][0]
    assert gate.standing()["phase_start_usd"] == 11.82 and gate.standing()["phase_cap_usd"] == 50


def test_an_app_without_a_gate_cannot_bill_anything(tmp_path: Path) -> None:
    app = create_app(tmp_path / "runs", None, tmp_path, tmp_path, private_dir=tmp_path / "private")
    client = TestClient(app)
    price = client.post("/api/tasks/preflight", json={"spec": SPEC}).json()
    assert price["ok"] is False and price["token"] is None
    assert any("FRACTALSWARM_ALLOW_UI_REAL" in reason for reason in price["refusals"])
    asked = client.post("/api/tasks", json=billed("anything"))
    assert asked.status_code == 403 and client.get("/api/jobs").json() == []


@pytest.mark.parametrize(
    ("path", "body", "status", "needle"),
    [
        ("/api/tasks/preflight", {}, 422, "spec"),
        ("/api/tasks/preflight", {"spec": SPEC, "bogus": 1}, 422, "bogus"),
        ("/api/tasks/preflight", {"spec": T1_SPEC}, 422, "conference task"),
        ("/api/tasks/preflight", {"spec": SPEC, "budget_usd": 0.9}, 422, "capped at $0.75"),
        ("/api/tasks/preflight", {"spec": t2_intake("nobody")}, 409, "no approved input"),
        ("/api/arena/preflight", {"spec": SPEC, "rival": "swarm"}, 422, "rival must be one of"),
        ("/api/arena/preflight", {"spec": SPEC, "chaos_plan": []}, 422, "chaos_plan"),
        ("/api/arena/preflight", {"spec": SPEC, "budget_usd": 2}, 422, "capped at $0.75"),
    ],
)
def test_a_preflight_for_a_bad_request_is_refused(
    api: Api, path: str, body: dict[str, Any], status: int, needle: str
) -> None:
    answer = api.post(path, body)
    assert answer.status_code == status, answer.text
    assert needle in answer.json()["error"]


def test_the_preflight_needs_the_private_directory(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, None, tmp_path, tmp_path / "s"))
    for path in ("/api/tasks/preflight", "/api/arena/preflight"):
        answer = client.post(path, json={"spec": SPEC})
        assert answer.status_code == 503 and "private directory" in answer.json()["error"]


# -- the gate ---------------------------------------------------------------------------------


def token_for(api: Api, path: str = "/api/tasks/preflight", **body: Any) -> str:
    price = api.post(path, {"spec": SPEC} | body).json()
    assert price["ok"] is True, price
    return price["token"]


def test_a_billed_run_starts_with_the_run_cap_no_paid_retries_and_the_ledger(api: Api) -> None:
    token = token_for(api)
    answer = api.post("/api/tasks", billed(token, run_id="billed-1"))
    assert answer.status_code == 202, answer.text
    launched = answer.json()
    assert launched["run_id"] == "billed-1" and launched["job"]["real"] is True
    called = api.stand_in_called_with(launched["job_id"])
    argv = called["argv"]
    assert argv[0] == "run" and flag(argv, "--backend") == "real"
    assert "--confirm-real-spend" in argv and "--no-paid-retries" in argv
    assert flag(argv, "--budget-usd") == "0.75" and flag(argv, "--scenario") == "swarm"
    assert called["ledger"] == str(api.spend.gate.ledger_path) and called["cap"] == "150.0"
    assert api.get(f"/api/jobs/{launched['job_id']}").json()["real"] is True


def test_a_billed_run_may_ask_for_a_lower_cap_but_never_a_higher_one(api: Api) -> None:
    token = token_for(api, budget_usd=0.4)
    launched = api.post("/api/tasks", billed(token, budget_usd=0.4)).json()
    assert flag(api.stand_in_called_with(launched["job_id"])["argv"], "--budget-usd") == "0.4"

    higher = api.post("/api/tasks", billed(token_for(api), budget_usd=0.9))
    assert higher.status_code == 422 and "capped at $0.75" in higher.json()["error"]


def test_a_billed_pair_starts_both_runs_with_the_gate_flags(api: Api) -> None:
    token = token_for(api, "/api/arena/preflight", rival="central")
    body = billed(token, rival="central", pair_id="billed-pair")
    answer = api.post("/api/arena", body)
    assert answer.status_code == 202, answer.text
    launched = answer.json()
    assert launched["billed"] is True and launched["job"]["real"] is True
    for index, scenario in enumerate(("swarm", "central")):
        called = api.stand_in_called_with(launched["job_id"], index)
        argv = called["argv"]
        assert flag(argv, "--scenario") == scenario and flag(argv, "--backend") == "real"
        assert "--confirm-real-spend" in argv and "--no-paid-retries" in argv
        assert flag(argv, "--budget-usd") == "0.75" and "--chaos-plan" in argv
        assert called["ledger"] == str(api.spend.gate.ledger_path)
    assert api.get("/api/pairs/billed-pair").json()["billed"] is True


def test_a_fake_launch_needs_no_token_and_ignores_one(api: Api) -> None:
    plain = api.post("/api/tasks", {"spec": SPEC, "run_id": "free-1"})
    assert plain.status_code == 202 and plain.json()["job"]["real"] is False
    argv = api.stand_in_called_with(plain.json()["job_id"])["argv"]
    assert flag(argv, "--backend") == "fake"
    assert "--confirm-real-spend" not in argv and "--no-paid-retries" not in argv
    with_token = api.post("/api/tasks", {"spec": SPEC, "run_id": "free-2", "preflight_token": "x"})
    assert with_token.status_code == 202 and with_token.json()["job"]["real"] is False


REFUSALS: list[tuple[str, Callable[[Api, str], dict[str, Any]], int, str]] = [
    ("no token", lambda api, token: billed(None), 403, "preflight flow"),
    ("empty token", lambda api, token: billed(""), 403, "preflight flow"),
    ("no word", lambda api, token: billed(token, confirm=None), 403, "type SPEND"),
    ("wrong word", lambda api, token: billed(token, confirm="spend"), 403, "type SPEND"),
    ("unknown token", lambda api, token: billed("not-a-token"), 403, "unknown, used or expired"),
    ("other seed", lambda api, token: billed(token, spec=SPEC | {"seed": "2"}), 403, "different"),
    ("other chaos", lambda api, token: billed(token, chaos="kill-half"), 403, "different"),
    ("other speed", lambda api, token: billed(token, speed=5), 403, "different"),
    ("other clock", lambda api, token: billed(token, clock="live"), 403, "different"),
    ("other cap", lambda api, token: billed(token, budget_usd=0.5), 403, "different"),
    ("other input", lambda api, token: billed(token, spec=SPEC | {"goal": "x"}), 403, "different"),
    ("higher cap", lambda api, token: billed(token, budget_usd=1.0), 422, "capped at $0.75"),
]


@pytest.mark.parametrize(
    ("name", "make", "status", "needle"), REFUSALS, ids=[r[0] for r in REFUSALS]
)
def test_every_way_a_billed_launch_can_be_refused(
    api: Api, name: str, make: Callable[[Api, str], dict[str, Any]], status: int, needle: str
) -> None:
    token = token_for(api)
    refused = api.post("/api/tasks", make(api, token))
    assert refused.status_code == status, refused.text
    assert needle in refused.json()["error"]
    assert api.get("/api/jobs").json() == []  # nothing started
    assert not list((api.private / "jobs").glob("*"))
    # no refusal spends the token
    assert api.post("/api/tasks", billed(token, run_id="after-refusal")).status_code == 202


def test_a_token_works_once(api: Api) -> None:
    token = token_for(api)
    assert api.post("/api/tasks", billed(token, run_id="once-1")).status_code == 202
    again = api.post("/api/tasks", billed(token, run_id="once-2"))
    assert again.status_code == 403 and "unknown, used or expired" in again.json()["error"]


def test_a_token_expires(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "unused.sqlite"))
    gate = SpendGate(tmp_path / "ledger.sqlite", 150.0, allow_real=True, phase_start_usd=0.0)
    api = Api(tmp_path, gate, Preflights(ttl_s=60, clock=lambda: now[0]))
    token = token_for(api)
    now[0] += 61
    late = api.post("/api/tasks", billed(token))
    assert late.status_code == 403 and "expired" in late.json()["error"]
    assert api.get("/api/jobs").json() == []


def test_the_server_flag_is_checked_at_launch_too(api: Api) -> None:
    token = token_for(api)
    api.spend.gate = dataclasses.replace(api.spend.gate, allow_real=False)
    refused = api.post("/api/tasks", billed(token))
    assert refused.status_code == 403 and "FRACTALSWARM_ALLOW_UI_REAL" in refused.json()["error"]
    assert api.get("/api/jobs").json() == []


def test_the_caps_are_checked_again_at_launch_and_the_token_is_kept(api: Api) -> None:
    token = token_for(api)
    ledger = api.spend.gate.ledger_path
    fill_ledger(ledger, reserved=49.9)  # something else reserved the room since the preflight
    refused = api.post("/api/tasks", billed(token))
    assert refused.status_code == 409 and "phase cap" in refused.json()["error"]
    assert api.get("/api/jobs").json() == []

    ProjectLedger(ledger, 1000.0).settle("a-open", 0.0)  # that reservation came to nothing
    assert api.post("/api/tasks", billed(token, run_id="after-room")).status_code == 202


def test_only_one_billed_job_runs_at_a_time(api: Api) -> None:
    first = api.post("/api/tasks", billed(token_for(api), run_id="first-billed"))
    assert first.status_code == 202
    token = token_for(api)
    second = api.post("/api/tasks", billed(token, run_id="second-billed"))
    assert second.status_code == 409 and "one at a time" in second.json()["error"]
    pair = api.post(
        "/api/arena",
        billed(token_for(api, "/api/arena/preflight", rival="central"), rival="central"),
    )
    assert pair.status_code == 409 and "one at a time" in pair.json()["error"]

    api.post(f"/api/jobs/{first.json()['job_id']}/cancel")  # room again; the token was kept
    assert api.post("/api/tasks", billed(token, run_id="third-billed")).status_code == 202


def test_a_billed_launch_that_cannot_start_gives_the_token_back(
    api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = token_for(api)
    monkeypatch.setattr(jobs, "LAUNCH", [str(api.runs / "no-such-python")])
    failed = api.post("/api/tasks", billed(token, run_id="cannot-start"))
    assert failed.status_code == 500 and api.get("/api/jobs").json() == []
    monkeypatch.setattr(jobs, "LAUNCH", [sys.executable, "-c", STAND_IN])
    assert api.post("/api/tasks", billed(token, run_id="can-start")).status_code == 202


def test_a_billed_pair_is_refused_like_a_billed_run(api: Api) -> None:
    pair = {"spec": SPEC, "rival": "central", "backend": "real", "confirm": CONFIRM_WORD}
    assert api.post("/api/arena", pair).status_code == 403
    task_token = token_for(api)  # a task's token does not clear a pair
    wrong = api.post("/api/arena", pair | {"preflight_token": task_token})
    assert wrong.status_code == 403 and "different request" in wrong.json()["error"]
    assert api.get("/api/jobs").json() == [] and api.get("/api/pairs").json() == []


# -- the pieces ------------------------------------------------------------------------------


def test_a_digest_binds_what_a_launch_runs_and_not_how_it_is_named() -> None:
    base = {"spec": SPEC, "scenario": "swarm", "chaos": "C0", "speed": 1.0}
    same = base | {"backend": "real", "run_id": "x", "preflight_token": "t", "confirm": "SPEND"}
    assert digest_of("task", base) == digest_of("task", same)
    assert digest_of("task", base) != digest_of("arena", base)
    assert digest_of("task", base) != digest_of("task", base | {"chaos": "C1"})
    assert digest_of("task", base) != digest_of("task", base | {"spec": SPEC | {"seed": "9"}})


def test_tokens_are_pruned_and_can_be_given_back() -> None:
    now = [0.0]
    store = Preflights(ttl_s=10, clock=lambda: now[0])
    first = store.issue("a", 0.75)
    now[0] = 11
    second = store.issue("b", 0.75)
    assert list(store.issued) == [second]  # the expired one is gone
    issued = store.redeem(second, "b")
    with pytest.raises(jobs.JobError, match="unknown, used or expired"):
        store.redeem(second, "b")
    store.restore(second, issued)
    assert store.redeem(second, "b").worst_case_usd == 0.75
    with pytest.raises(jobs.JobError):
        store.redeem(first, "a")


def test_a_gate_from_the_settings_follows_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FRACTALSWARM_ALLOW_UI_REAL", "1")
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "l.sqlite"))
    monkeypatch.setenv("FRACTALSWARM_PROJECT_CAP_USD", "12.5")
    gate = SpendGate.from_settings(Settings())
    assert gate.allow_real is True and gate.project_cap_usd == 12.5
    assert gate.ledger_path == tmp_path / "l.sqlite"
    monkeypatch.setenv("FRACTALSWARM_ALLOW_UI_REAL", "0")
    assert SpendGate.from_settings(Settings()).allow_real is False
    assert not (tmp_path / "l.sqlite").exists()
