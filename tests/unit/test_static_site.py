"""The static showcase's exporter, scripts/build_static_site.py.

A page on GitHub Pages has no server, so what the API would answer is written to files at build
time and a shim in the page serves them. These tests export bundles of the repo and ask the real
API, through the test client, the same questions: every file must hold what the live server
answers. The Vite build is not run here (``--no-build``); its checks are in ``web/src/static``.

The small site under ``web/src/static/fixtures/site`` is this export of ``demo/toy`` and
``tests/golden/one-call``, with a fixed stamp. The shim's tests read it, so that they run the
app's own client code on real answers. ``UPDATE_STATIC_FIXTURE=1 uv run pytest
tests/unit/test_static_site.py`` writes it again after the exporter changes.
"""

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, NamedTuple

import pytest
from starlette.testclient import TestClient

from fractalswarm.api.app import create_app
from fractalswarm.config import Settings
from fractalswarm.intake.guard import INTAKE_SCENARIO

REPO = Path(__file__).resolve().parents[2]
FIXTURE = REPO / "web" / "src" / "static" / "fixtures" / "site"
TOY = "demo/toy"
ONE_CALL = "tests/golden/one-call"
REGENERATE = "UPDATE_STATIC_FIXTURE=1 uv run pytest tests/unit/test_static_site.py"


def _load_script() -> ModuleType:
    path = REPO / "scripts" / "build_static_site.py"
    spec = importlib.util.spec_from_file_location("build_static_site", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_static_site"] = module
    spec.loader.exec_module(module)
    return module


build = _load_script()
PROVENANCE = build.Provenance("a" * 40, False, "2026-10-30T10:00:00Z")


def settings_in(base: Path) -> Settings:
    """Settings that read nothing of this machine: no shared .env, all paths in ``base``."""
    return Settings(
        _env_file=None,
        FRACTALSWARM_PRIVATE_DIR=str(base / "private"),
        FRACTALSWARM_RUNS_DIR=str(base / "runs"),
        FRACTALSWARM_LEDGER_PATH=str(base / "ledger.sqlite"),
    )


def live_client(base: Path, bench: Path, bundles: list[Path]) -> TestClient:
    """The API as ``fractalswarm serve`` runs it, with the bundles listed under ``demo/``."""
    demo = base / "live-demo"
    demo.mkdir()
    for bundle in bundles:
        shutil.copytree(bundle, demo / bundle.name)
    (base / "live-runs").mkdir()
    return TestClient(create_app(base / "live-runs", demo, bench, base / "no-static"))


class Exported(NamedTuple):
    out: Path
    manifest: dict[str, Any]
    report: Any
    live: TestClient
    base: Path
    bench: Path


def export(
    base: Path, *, sources: tuple[str, ...], pairs: tuple[tuple[str, str], ...] = ()
) -> Exported:
    out, bench = base / "site", base / "bench"
    out.mkdir()
    bench.mkdir()
    cfg = settings_in(base)
    names = dict.fromkeys([*sources, *(name for pair in pairs for name in pair)])
    found = {name: build.resolve_source(name, cfg.runs_dir) for name in names}
    named = [(found[left], found[right]) for left, right in pairs]
    report = build.export_site(
        [found[name] for name in sources], named, out, PROVENANCE, bench, cfg
    )
    manifest = json.loads((out / "data" / "manifest.json").read_bytes())
    live = live_client(base, bench, [source.path for source in found.values()])
    return Exported(out, manifest, report, live, base, bench)


@pytest.fixture(scope="module")
def site(tmp_path_factory: pytest.TempPathFactory) -> Exported:
    return export(
        tmp_path_factory.mktemp("static-site"), sources=(TOY, ONE_CALL), pairs=((TOY, ONE_CALL),)
    )


def answer_of(site: Exported, entry: dict[str, Any]) -> tuple[int, Any]:
    """What the shim serves for an entry: its status and its body (inline, or from its file)."""
    if "body" in entry:
        return entry["status"], entry["body"]
    return entry["status"], json.loads((site.out / "data" / entry["file"]).read_bytes())


RUN_IDS = ["demo-toy", "demo-one-call"]


class TestEveryFileHoldsWhatTheApiAnswers:
    @pytest.mark.parametrize("run_id", RUN_IDS)
    @pytest.mark.parametrize("route", ["summary", *build.RUN_ROUTES])
    def test_read_routes(self, site: Exported, run_id: str, route: str) -> None:
        url = f"/api/runs/{run_id}" + ("" if route == "summary" else f"/{route}")
        live = site.live.get(url)
        status, body = answer_of(site, site.manifest["runs"][run_id]["routes"][route])
        assert (status, body) == (live.status_code, live.json())

    @pytest.mark.parametrize("run_id", RUN_IDS)
    def test_event_pages_are_the_apis_pages_byte_for_byte(
        self, site: Exported, run_id: str
    ) -> None:
        pages = site.manifest["runs"][run_id]["events"]["pages"]
        size = site.manifest["site"]["page_size"]
        assert pages
        for index, page in enumerate(pages):
            live = site.live.get(
                f"/api/runs/{run_id}/events?from_seq={index * size + 1}&limit={size}"
            )
            assert (site.out / "data" / page["file"]).read_bytes() == live.content
            assert page["bytes"] == len(live.content)

    @pytest.mark.parametrize("run_id", RUN_IDS)
    def test_every_call_in_full(self, site: Exported, run_id: str) -> None:
        calls = site.manifest["runs"][run_id]["calls"]
        details = json.loads((site.out / "data" / calls["file"]).read_bytes())
        listed = site.live.get(f"/api/runs/{run_id}/calls").json()["calls"]
        assert calls["ids"] == [row["effect_id"] for row in listed] == list(details)
        for effect_id, detail in details.items():
            assert detail == site.live.get(f"/api/runs/{run_id}/calls/{effect_id}").json()

    @pytest.mark.parametrize("run_id", RUN_IDS)
    def test_replay_report_is_the_apis_with_the_build_stamped_on(
        self, site: Exported, run_id: str
    ) -> None:
        _status, stored = answer_of(site, site.manifest["runs"][run_id]["routes"]["verify"])
        live = site.live.post(f"/api/runs/{run_id}/verify", json={}).json()
        stamp = stored.pop("static")
        assert stored == live
        assert stored["ok"] and stored["bundle_head_ok"]
        assert stamp == {
            "where": "build",
            "commit": "a" * 40,
            "commit_short": "a" * 12,
            "dirty": False,
            "built_at": "2026-10-30T10:00:00Z",
        }

    def test_the_run_list_holds_the_runs_exported_as_the_api_lists_them(
        self, site: Exported
    ) -> None:
        _status, listed = answer_of(site, site.manifest["global"]["runs"])
        live = {row["id"]: row for row in site.live.get("/api/runs").json()}
        assert sorted(row["id"] for row in listed) == sorted(RUN_IDS)
        assert all(row == live[row["id"]] for row in listed)

    def test_bench_results_and_honesty(self, site: Exported) -> None:
        # No hero chart in the scratch bench folder: the API answers with its packaged fixture.
        for name, route in (
            ("bench/results", "/api/bench/results"),
            ("bench/honesty", "/api/bench/honesty"),
        ):
            live = site.live.get(route)
            assert answer_of(site, site.manifest["global"][name]) == (live.status_code, live.json())
        assert answer_of(site, site.manifest["global"]["bench/results"])[1]["source"] == "fixture"


class TestWhatTheSiteSaysAboutItself:
    def test_the_capabilities_are_all_off_and_say_static(self, site: Exported) -> None:
        status, capabilities = answer_of(site, site.manifest["global"]["capabilities"])
        live = site.live.get("/api/capabilities").json()
        assert status == 200
        assert capabilities.pop("static") is True
        assert set(capabilities) == set(live)
        assert not any(capabilities.values())

    def test_the_manifest_names_its_format_and_the_build(self, site: Exported) -> None:
        assert site.manifest["format"] == build.MANIFEST_FORMAT == 1
        assert site.manifest["site"] == PROVENANCE.stamp() | {
            "generator": "scripts/build_static_site.py",
            "page_size": 5000,
        }
        assert set(site.manifest["global"]) == {
            "runs",
            "capabilities",
            "pairs",
            "bench/results",
            "bench/honesty",
        }

    def test_a_small_answer_travels_in_the_manifest_and_a_large_one_in_a_file(
        self, site: Exported
    ) -> None:
        entries = [
            *site.manifest["global"].values(),
            *(entry for run in site.manifest["runs"].values() for entry in run["routes"].values()),
        ]
        for entry in entries:
            if "file" in entry:
                assert entry["status"] == 200
                assert entry["bytes"] > build.INLINE_MAX
                assert (site.out / "data" / entry["file"]).stat().st_size == entry["bytes"]
            elif entry["status"] == 200:
                assert len(build._dump(entry["body"])) <= build.INLINE_MAX

    def test_an_error_of_the_api_is_kept_with_its_status(self, site: Exported) -> None:
        # A run with no feasibility check: the API's own 404, which the app reads as "not offered".
        live = site.live.get("/api/runs/demo-toy/feasibility")
        status, body = answer_of(site, site.manifest["runs"]["demo-toy"]["routes"]["feasibility"])
        assert (status, body) == (live.status_code, live.json())
        assert status == 404 and "error" in body

    def test_a_pair_is_listed_the_way_the_arena_page_reads_it(self, site: Exported) -> None:
        status, pairs = answer_of(site, site.manifest["global"]["pairs"])
        assert status == 200
        assert len(pairs) == 1
        pair = pairs[0]
        assert pair["pair_id"] == "demo-toy+demo-one-call"
        assert (pair["left"]["run_id"], pair["right"]["run_id"]) == ("demo-toy", "demo-one-call")
        assert pair["private"] is False and pair["billed"] is False and pair["state"] == "completed"
        started = json.loads(
            (REPO / TOY / "events.jsonl").read_text(encoding="utf-8").splitlines()[0]
        )
        assert pair["seed"] == started["payload"]["seed"]
        assert set(pair["chaos"]) == {"name", "actions"}

    def test_the_report_counts_what_it_wrote(self, site: Exported) -> None:
        assert sorted(run.run_id for run in site.report.runs) == sorted(RUN_IDS)
        assert all(run.verified for run in site.report.runs)
        written = sum(
            path.stat().st_size for path in (site.out / "data").rglob("*") if path.is_file()
        )
        assert site.report.data_bytes == written
        assert site.report.pairs == ["demo-toy:demo-one-call"]
        text = build.describe(site.report)
        assert "verified at build" in text and "demo-toy" in text and "OVER BUDGET" not in text


class TestARouteThatRaises:
    def test_the_site_keeps_the_500_the_live_server_gives_and_says_so(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The takeover route of a supervisor's log (the central rival) raises; uvicorn answers 500.
        from fractalswarm.verify import takeover

        def refuse(run: Any, **_: Any) -> None:
            raise takeover.SupervisorLog("supervisor log: use `fractalswarm recovery`")

        monkeypatch.setattr(takeover, "check_run", refuse)
        site = export(tmp_path, sources=(TOY,))
        routes = site.manifest["runs"]["demo-toy"]["routes"]
        assert routes["takeover"] == {"status": 500, "body": {"error": "Internal Server Error"}}
        assert routes["recovery"]["status"] == 200  # the other routes are not touched
        notes = site.report.runs[0].notes
        assert len(notes) == 1
        assert "GET takeover raised SupervisorLog" in notes[0] and "answers 500" in notes[0]
        assert f"note: {notes[0]}" in build.describe(site.report)


class TestPairsAndTheRunsTheyNeed:
    def test_a_run_in_two_pairs_is_exported_once_and_listed_in_both(self, tmp_path: Path) -> None:
        other = tmp_path / "bundles" / "toy-b"
        shutil.copytree(REPO / TOY, other)
        base = tmp_path / "export"
        base.mkdir()
        site = export(base, sources=(), pairs=((TOY, ONE_CALL), (TOY, str(other))))
        assert sorted(site.manifest["runs"]) == ["demo-one-call", "demo-toy", "demo-toy-b"]
        _status, listed = answer_of(site, site.manifest["global"]["pairs"])
        assert [pair["pair_id"] for pair in listed] == [
            "demo-toy+demo-one-call",
            "demo-toy+demo-toy-b",
        ]
        assert site.report.pairs == ["demo-toy:demo-one-call", "demo-toy:demo-toy-b"]

    def test_a_site_with_runs_and_no_pair_lists_none(self, tmp_path: Path) -> None:
        site = export(tmp_path, sources=(TOY,))
        assert answer_of(site, site.manifest["global"]["pairs"]) == (200, [])


class TestALogInPages:
    def test_pages_tile_the_log_and_end_where_the_api_says_it_does(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(build, "PAGE_SIZE", 20)
        site = export(tmp_path, sources=(TOY,))
        pages = site.manifest["runs"]["demo-toy"]["events"]["pages"]
        whole = site.live.get("/api/runs/demo-toy/events?limit=5000").json()
        assert site.manifest["site"]["page_size"] == 20
        assert (
            len(pages) == 3
            and whole["last_seq"] == site.manifest["runs"]["demo-toy"]["events"]["last_seq"]
        )
        seen: list[dict[str, Any]] = []
        for index, page in enumerate(pages):
            body = json.loads((site.out / "data" / page["file"]).read_bytes())
            assert body["events"][0]["seq"] == index * 20 + 1
            assert body["done"] is (index == len(pages) - 1)
            seen += body["events"]
        assert seen == whole["events"]


class TestWhatIsNeverPublished:
    def copy_bundle(self, base: Path, name: str = "toy") -> Path:
        target = base / "bundles" / name
        shutil.copytree(REPO / TOY, target)
        return target

    def rewrite_started(self, bundle: Path, change: Any) -> None:
        lines = (bundle / "events.jsonl").read_text(encoding="utf-8").splitlines()
        started = json.loads(lines[0])
        change(started["payload"])
        lines[0] = json.dumps(started, separators=(",", ":"))
        (bundle / "events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def refuse(self, base: Path, bundle: Path) -> str:
        cfg = settings_in(base)
        source = build.resolve_source(str(bundle), cfg.runs_dir)
        out = base / "site"
        out.mkdir()
        with pytest.raises(build.Refused) as refused:
            build.export_site([source], [], out, PROVENANCE, base / "bench", cfg)
        assert not (out / "data" / "manifest.json").exists()
        return str(refused.value)

    def test_an_intake_run_is_refused(self, tmp_path: Path) -> None:
        bundle = self.copy_bundle(tmp_path)
        self.rewrite_started(bundle, lambda payload: payload.update(scenario=INTAKE_SCENARIO))
        assert "intake run" in self.refuse(tmp_path, bundle)

    @pytest.mark.parametrize("source", ["intake", "inline"])
    def test_a_run_on_live_input_is_refused(self, tmp_path: Path, source: str) -> None:
        bundle = self.copy_bundle(tmp_path)
        self.rewrite_started(
            bundle,
            lambda payload: payload.update(
                params={**(payload.get("params") or {}), "input": {"source": source}}
            ),
        )
        assert f"input.source is '{source}'" in self.refuse(tmp_path, bundle)

    def test_a_run_whose_spec_points_at_pasted_text_is_refused(self, tmp_path: Path) -> None:
        bundle = self.copy_bundle(tmp_path)
        spec = {"spec": {"inputs": {"intake": "i1"}}}
        self.rewrite_started(
            bundle, lambda payload: payload.update(params={**(payload.get("params") or {}), **spec})
        )
        assert "intake or at inline text" in self.refuse(tmp_path, bundle)

    def test_anything_in_the_private_directory_is_refused(self, tmp_path: Path) -> None:
        bundle = self.copy_bundle(tmp_path)
        private = settings_in(tmp_path).private_dir / "runs" / "toy"
        private.parent.mkdir(parents=True)
        shutil.move(str(bundle), str(private))
        assert "private directory" in self.refuse(tmp_path, private)

    def test_a_log_that_was_changed_is_refused(self, tmp_path: Path) -> None:
        bundle = self.copy_bundle(tmp_path)
        lines = (bundle / "events.jsonl").read_text(encoding="utf-8").splitlines()
        event = json.loads(lines[20])
        event["payload"] = {**event["payload"], "tampered": True}
        lines[20] = json.dumps(event, separators=(",", ":"))
        (bundle / "events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        assert any(word in self.refuse(tmp_path, bundle) for word in ("chain", "replay"))

    def test_two_runs_with_one_name_are_refused(self, tmp_path: Path) -> None:
        cfg = settings_in(tmp_path)
        first = build.resolve_source(str(self.copy_bundle(tmp_path)), cfg.runs_dir)
        second = build.resolve_source(str(self.copy_bundle(tmp_path / "other")), cfg.runs_dir)
        with pytest.raises(build.Refused, match="listed as 'demo-toy'"):
            build.stage([first, second], tmp_path / "stage")

    def test_a_name_the_site_cannot_use_is_refused(self, tmp_path: Path) -> None:
        cfg = settings_in(tmp_path)
        source = build.resolve_source(str(self.copy_bundle(tmp_path, "my run!")), cfg.runs_dir)
        with pytest.raises(build.Refused, match="not a name the site can use"):
            build.stage([source], tmp_path / "stage")

    def test_a_directory_with_no_log_is_not_a_run(self, tmp_path: Path) -> None:
        (tmp_path / "empty").mkdir()
        with pytest.raises(build.Refused, match="no events.jsonl"):
            build.resolve_source(str(tmp_path / "empty"), tmp_path / "runs")
        with pytest.raises(build.Refused, match="no run or bundle"):
            build.resolve_source("nowhere/at/all", tmp_path / "runs")

    def test_only_the_log_the_cassette_and_the_head_are_copied_out_of_a_run(
        self, tmp_path: Path
    ) -> None:
        bundle = self.copy_bundle(tmp_path)
        (bundle / "notes.txt").write_text("keep out", encoding="utf-8")
        cfg = settings_in(tmp_path)
        runs_dir, demo_dir = build.stage(
            [build.resolve_source(str(bundle), cfg.runs_dir)], tmp_path / "stage"
        )
        assert sorted(path.name for path in (demo_dir / "toy").iterdir()) == sorted(
            name for name in build.RUN_FILES if (bundle / name).exists()
        )
        assert not any(runs_dir.iterdir())


class TestTheFinishedSiteIsScanned:
    def test_a_secret_or_a_path_of_this_machine_in_a_text_file_is_found(
        self, tmp_path: Path
    ) -> None:
        needles = {"home": r"C:\Users\somebody", "token": "sk-live-0123456789"}
        (tmp_path / "a.json").write_text(json.dumps({"path": needles["home"]}), encoding="utf-8")
        (tmp_path / "b.js").write_text('var t="sk-live-0123456789";', encoding="utf-8")
        (tmp_path / "c.png").write_bytes(b"sk-live-0123456789")  # not text: not scanned
        (tmp_path / "ok.json").write_text('{"fine": true}', encoding="utf-8")
        assert build.scan(tmp_path, needles) == ["a.json: home", "b.js: token"]

    def test_the_needles_are_the_secrets_the_home_the_private_directory_and_the_repo(
        self, tmp_path: Path
    ) -> None:
        cfg = settings_in(tmp_path)
        needles = build.forbidden(cfg, cfg.private_dir)
        text = " ".join(needles)
        assert (
            "the home directory" in text
            and "the private directory" in text
            and "the repository path" in text
        )

    def test_a_clean_site_has_nothing_in_it(self, site: Exported) -> None:
        cfg = settings_in(site.base)
        assert build.scan(site.out, build.forbidden(cfg, cfg.private_dir)) == []


class TestPairs:
    @pytest.mark.parametrize(
        ("text", "left", "right"),
        [
            ("a:b", "a", "b"),
            ("runs/t2-swarm:runs/t2-central", "runs/t2-swarm", "runs/t2-central"),
            (r"C:\runs\a:C:\runs\b", r"C:\runs\a", r"C:\runs\b"),
            ("C:/runs/a:D:/runs/b", "C:/runs/a", "D:/runs/b"),
            (r"C:\runs\a:relative\b", r"C:\runs\a", r"relative\b"),
            (r"rel\a:C:\runs\b", r"rel\a", r"C:\runs\b"),
        ],
    )
    def test_the_cut_is_the_one_colon_that_is_not_a_drive(
        self, text: str, left: str, right: str
    ) -> None:
        assert build.split_pair(text) == (left, right)

    @pytest.mark.parametrize("text", ["", "alone", ":b", "a:", "a:b:c", r"C:\only"])
    def test_anything_else_is_refused(self, text: str) -> None:
        with pytest.raises(build.Refused, match="LEFT:RIGHT"):
            build.split_pair(text)

    def test_the_listing_names_the_rival_the_plan_and_the_seed(self) -> None:
        started = {
            "scenario": "fractalswarm.scenarios.swarm:SWARM",
            "seed": "7",
            "clock": "live",
            "params": {"chaos": {"profile": "kill-half", "actions": [1, 2, 3, 4, 5]}},
        }
        rival = {**started, "scenario": "fractalswarm.scenarios.central:CENTRAL", "params": {}}
        pair = build.pair_listing(
            {"id": "swarm-run", "started": started}, {"id": "central-run", "started": rival}
        )
        assert pair["pair_id"] == "swarm-run+central-run"
        assert pair["chaos"] == {"name": "kill-half", "actions": 5}
        assert pair["seed"] == "7" and pair["clock"] == "live"
        assert pair["left"]["run_id"] == "swarm-run" and pair["right"]["run_id"] == "central-run"
        assert (
            pair["label"].startswith("swarm vs ")
            and "kill-half" in pair["label"]
            and "seed 7" in pair["label"]
        )
        assert pair["created_at"] is None and pair["billed"] is False and pair["private"] is False


class TestBenchResults:
    def test_a_measured_chart_names_its_file_in_the_repo_and_not_on_this_machine(self) -> None:
        live = json.dumps(
            {
                "source": r"C:\Users\somebody\repo\bench\results\hero_chart.json",
                "fixture": False,
                "data": [1],
            }
        )
        body = json.loads(build.public_bench(live.encode()))
        assert body == {"source": "bench/results/hero_chart.json", "fixture": False, "data": [1]}

    @pytest.mark.parametrize("body", [[1, 2], {"data": []}, {"source": 3}, "text"])
    def test_any_other_shape_goes_through_unchanged(self, body: Any) -> None:
        content = json.dumps(body).encode()
        assert build.public_bench(content) == content

    def test_the_packaged_fixture_keeps_saying_it_is_one(self) -> None:
        live = json.dumps({"source": "fixture", "fixture": True, "data": []})
        assert json.loads(build.public_bench(live.encode()))["source"] == "fixture"


class TestTheCommand:
    def test_it_writes_the_data_and_says_what_it_wrote(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        for name, value in (
            ("RUNS_DIR", "runs"),
            ("PRIVATE_DIR", "private"),
            ("LEDGER_PATH", "ledger.sqlite"),
        ):
            monkeypatch.setenv(f"FRACTALSWARM_{name}", str(tmp_path / value))
        out = tmp_path / "site"
        assert (
            build.main(
                ["--runs", TOY, "--out", str(out), "--no-build", "--bench-dir", str(tmp_path)]
            )
            == 0
        )
        printed = capsys.readouterr().out
        assert (
            "demo-toy" in printed
            and "verified at build" in printed
            and "OVER BUDGET" not in printed
        )
        assert (out / "data" / "manifest.json").is_file()
        assert (out / ".nojekyll").is_file()

    def test_it_refuses_with_a_reason_and_a_status(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path / "runs"))
        assert (
            build.main(["--runs", "no/such/run", "--out", str(tmp_path / "site"), "--no-build"])
            == 1
        )
        assert capsys.readouterr().err.startswith("refused: no run or bundle 'no/such/run'")

    def test_it_will_not_publish_a_tree_with_uncommitted_changes_when_asked_not_to(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setenv("FRACTALSWARM_RUNS_DIR", str(tmp_path / "runs"))
        monkeypatch.setattr(
            build,
            "current_provenance",
            lambda: build.Provenance("b" * 40, True, "2026-10-30T10:00:00Z"),
        )
        argv = ["--runs", TOY, "--out", str(tmp_path / "site"), "--no-build", "--require-clean"]
        assert build.main(argv) == 1
        assert "uncommitted changes" in capsys.readouterr().err
        assert not (tmp_path / "site" / "data").exists()


class TestTheFixtureOfTheShimsTests:
    def test_it_is_what_the_exporter_writes_now(self, site: Exported) -> None:
        written = {
            path.relative_to(site.out).as_posix(): path.read_bytes()
            for path in sorted(site.out.rglob("*"))
            if path.is_file()
        }
        if os.environ.get("UPDATE_STATIC_FIXTURE"):
            shutil.rmtree(FIXTURE, ignore_errors=True)
            for name, content in written.items():
                target = FIXTURE / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
        kept = {
            path.relative_to(FIXTURE).as_posix(): path.read_bytes().replace(b"\r\n", b"\n")
            for path in sorted(FIXTURE.rglob("*"))
            if path.is_file()
        }
        assert sorted(kept) == sorted(written), f"run {REGENERATE}"
        stale = [name for name in written if kept[name] != written[name]]
        assert not stale, f"{stale} changed: run {REGENERATE}"
