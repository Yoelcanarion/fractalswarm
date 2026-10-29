"""Bundles never hold live input.

``fractalswarm bundle`` copies a finished run into ``demo/<name>``, and refuses a run on text a
person typed: an intake, a run on an approved intake or on an inline corpus, anything in the
private directory. A scan of the bundles already in git says the same, so a copy made by hand
is caught before it is committed.
"""

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from fractalswarm.bench.tasks.t2_conference.generator import live_sample
from fractalswarm.cli import app as cli
from fractalswarm.intake import service
from fractalswarm.intake.guard import first_event, private_reason
from fractalswarm.intake.store import PrivateDir

REPO = Path(__file__).resolve().parents[2]
BUNDLE_ROOTS = (REPO / "demo", REPO / "tests" / "golden")


@pytest.fixture
def dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    found = {"runs": tmp_path / "runs", "private": tmp_path / "private", "out": tmp_path / "demo"}
    monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(found["runs"]))
    monkeypatch.setenv("FRACTALSWARM_PRIVATE_DIR", str(found["private"]))
    monkeypatch.setenv("FRACTALSWARM_LEDGER_PATH", str(tmp_path / "ledger.sqlite"))
    return found


def invoke(*args: str):
    return CliRunner().invoke(cli, list(args))


def bundle(run: str, dirs: dict[str, Path], name: str = "mine", *more: str):
    return invoke("bundle", run, "--name", name, "--out", str(dirs["out"]), *more)


def test_a_normal_run_is_bundled_and_the_bundle_replays(dirs: dict[str, Path]) -> None:
    assert invoke("toy", "--run-id", "plain").exit_code == 0
    done = bundle("plain", dirs)
    assert done.exit_code == 0, done.output
    folder = dirs["out"] / "mine"
    assert sorted(path.name for path in folder.iterdir()) == [
        "HEAD",
        "cassette.jsonl",
        "events.jsonl",
    ]
    last = json.loads((folder / "events.jsonl").read_text().splitlines()[-1])
    assert (folder / "HEAD").read_text().strip() == last["hash"]
    verified = invoke("replay", str(folder), "--verify")
    assert verified.exit_code == 0 and verified.output.startswith("MATCH"), verified.output


def test_a_bundle_is_replaced_only_when_asked(dirs: dict[str, Path]) -> None:
    assert invoke("toy", "--run-id", "plain").exit_code == 0
    assert bundle("plain", dirs).exit_code == 0
    again = bundle("plain", dirs)
    assert again.exit_code != 0 and "--force" in again.output
    assert bundle("plain", dirs, "mine", "--force").exit_code == 0
    assert bundle("plain", dirs, "../escape").exit_code != 0


def test_an_intake_run_is_never_bundled(dirs: dict[str, Path], tmp_path: Path) -> None:
    sample = live_sample(1)
    private = PrivateDir(dirs["private"])
    service.create_input(
        private, "pasted", {k: sample[k] for k in ("conference", "talks", "notes")}
    )
    assert invoke("intake", "pasted").exit_code == 0

    refused = bundle("pasted", dirs)  # by id: it is in the private directory
    assert refused.exit_code == 1 and "private directory" in refused.output

    copied = tmp_path / "copied"  # by hand into an ordinary place: the run itself says what it is
    copied.mkdir()
    for name in ("events.jsonl", "cassette.jsonl"):
        (copied / name).write_bytes((private.intake_dir("pasted") / name).read_bytes())
    refused = bundle(str(copied), dirs)
    assert refused.exit_code == 1 and "intake run" in refused.output
    assert not dirs["out"].exists()


def test_a_run_on_input_a_person_gave_is_never_bundled(
    dirs: dict[str, Path], tmp_path: Path
) -> None:
    corpus = json.loads((REPO / "tasks/fixtures/t2/seed-1/corpus.json").read_text("utf-8"))
    spec = tmp_path / "inline.json"
    spec.write_text(json.dumps({"goal": "Program it", "inputs": {"inline": {"corpus": corpus}}}))
    assert invoke("run", str(spec), "--run-id", "typed").exit_code == 0

    refused = bundle("typed", dirs)
    assert refused.exit_code == 1 and "'inline'" in refused.output
    assert not dirs["out"].exists()


def bundles() -> list[Path]:
    return [path for root in BUNDLE_ROOTS for path in sorted(root.glob("*/events.jsonl"))]


def test_there_are_bundles_to_check() -> None:
    assert len(bundles()) >= 3


@pytest.mark.parametrize("path", bundles(), ids=lambda p: f"{p.parent.parent.name}/{p.parent.name}")
def test_no_bundle_in_git_holds_live_input(path: Path) -> None:
    assert private_reason(first_event(path)) is None
    assert "example.invalid" not in path.read_text(encoding="utf-8")  # the pseudonyms' domain
