"""Build the static showcase: the web app and the recorded runs it needs, for GitHub Pages.

    uv run python scripts/build_static_site.py                       # demo/backup and demo/toy
    uv run python scripts/build_static_site.py --runs demo/final --pair demo/swarm:demo/central

The site needs no server and no API key. Vite builds the web app in its ``static`` mode, where
``web/src/static/`` answers the app's ``api/...`` calls from JSON files; this script writes those
files under ``data/``. They are not a second implementation of the API: the runs are copied into a
scratch catalog, the real ``create_app`` is built over it and every read route is called through
Starlette's test client, so a file holds what the live server answers. The replay check
(``POST /verify``) runs here, at build time, and its report is stored with the commit and the date.

Nothing from the private directory goes in, and no run on live input: the same refusal as
``fractalswarm bundle``. The finished site is scanned for the secrets and for the paths of this
machine, and the build fails if it finds one.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from starlette.testclient import TestClient

from fractalswarm.api.app import BENCH_RESULTS_DIR, DEMO_DIR, MAX_PAGE, create_app
from fractalswarm.api.catalog import DEMO_PREFIX
from fractalswarm.config import Settings
from fractalswarm.intake.guard import first_event, inside, private_reason
from fractalswarm.runs import SCENARIOS

REPO = Path(__file__).resolve().parents[1]
WEB = REPO / "web"
DEFAULT_RUNS = ("demo/backup", "demo/toy")
DEFAULT_OUT = REPO / "dist" / "static-site"  # under dist/, which .gitignore already covers
DATA = "data"
MANIFEST_FORMAT = 1
PAGE_SIZE = MAX_PAGE  # what the client asks for: `limit=5000`, so a page file is a whole answer
INLINE_MAX = 4096  # an answer this small travels in the manifest, one request less
BUDGET_MB = 40
LOOPBACK = "http://127.0.0.1"
SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
# What a run adds to the log's own size: read routes of ``/api/runs/{id}/<route>``.
RUN_ROUTES = ("feasibility", "takeover", "recovery", "metrics", "calls", "models", "disputes")
# What a build leaves at the top of ``--out`` (the app, its data, the Pages marker). A folder with
# anything else in it is not ours to empty.
OUTPUT_NAMES = {"index.html", "assets", "favicon.svg", DATA, ".nojekyll"}
TEXT_SUFFIXES = {".json", ".html", ".js", ".css", ".svg", ".txt", ".map", ".md"}
# Files of a run that the site may read. Nothing else is copied out of a run directory.
RUN_FILES = ("events.jsonl", "cassette.jsonl", "HEAD")


class Refused(Exception):
    """A run, a path or a build the site will not take; the message says why."""


@dataclass(frozen=True)
class Source:
    """A finished run or bundle to publish."""

    path: Path
    kind: Literal["bundle", "run"]

    @property
    def run_id(self) -> str:
        """The id the catalog gives it: bundles are listed as ``demo-<name>``."""
        return DEMO_PREFIX + self.path.name if self.kind == "bundle" else self.path.name


@dataclass(frozen=True)
class Provenance:
    """What the site was built from, and when."""

    commit: str
    dirty: bool
    built_at: str

    def stamp(self) -> dict[str, Any]:
        return {
            "commit": self.commit,
            "commit_short": self.commit[:12],
            "dirty": self.dirty,
            "built_at": self.built_at,
        }


@dataclass
class RunReport:
    run_id: str
    events: int
    head: str | None
    verified: bool
    bytes: int = 0
    files: int = 0
    notes: list[str] = field(default_factory=list)


@dataclass
class SiteReport:
    runs: list[RunReport] = field(default_factory=list)
    pairs: list[str] = field(default_factory=list)
    data_bytes: int = 0
    web_bytes: int = 0

    @property
    def total_bytes(self) -> int:
        return self.data_bytes + self.web_bytes


# ---- what to publish --------------------------------------------------------------------------


def resolve_source(arg: str, runs_dir: Path) -> Source:
    """A run directory, a bundle directory, a run id under ``runs/`` or a bundle name under
    ``demo/``. A directory that holds a ``HEAD`` file is a bundle (``fractalswarm bundle``)."""
    for candidate in (Path(arg), REPO / arg, runs_dir / arg, DEMO_DIR / arg):
        if candidate.is_dir():
            if not (candidate / "events.jsonl").is_file():
                raise Refused(f"{candidate} has no events.jsonl: the run did not finish")
            kind = "bundle" if (candidate / "HEAD").is_file() else "run"
            return Source(candidate.resolve(), kind)
    raise Refused(f"no run or bundle {arg!r} (looked here, in {runs_dir} and in {DEMO_DIR})")


def refuse_private(source: Source, private_dir: Path) -> None:
    """The refusal of ``fractalswarm bundle`` for anything a person typed, and a little more:
    a run whose spec points at an intake or inline input is refused too."""
    if inside(source.path, private_dir):
        raise Refused(f"{source.path} is in the private directory, which is never published")
    started = first_event(source.path / "events.jsonl")
    reason = private_reason(started)
    inputs = (((started.get("payload") or {}).get("params") or {}).get("spec") or {}).get("inputs")
    if (
        reason is None
        and isinstance(inputs, dict)
        and (inputs.get("intake") or inputs.get("inline"))
    ):
        reason = "its spec points at an intake or at inline text"
    if reason:
        raise Refused(
            f"{source.path.name}: {reason}; a published site holds nothing a person typed"
        )


def split_pair(text: str) -> tuple[str, str]:
    """``left:right``. The colon of a Windows drive (``C:\\runs\\a:C:\\runs\\b``) is not the cut."""
    cuts = [
        i
        for i, char in enumerate(text)
        if char == ":" and not _is_drive_colon(text, i) and 0 < i < len(text) - 1
    ]
    if len(cuts) != 1:
        raise Refused(f"--pair takes LEFT:RIGHT (the swarm run, then its rival); got {text!r}")
    return text[: cuts[0]], text[cuts[0] + 1 :]


def _is_drive_colon(text: str, i: int) -> bool:
    return (
        i >= 1
        and text[i - 1].isalpha()
        and (i == 1 or text[i - 2] in ":;")
        and text[i + 1 : i + 2] in ("\\", "/")
    )


# ---- the scratch catalog ----------------------------------------------------------------------


def stage(sources: Sequence[Source], root: Path) -> tuple[Path, Path]:
    """Copy the files the site reads into a scratch ``runs/`` and ``demo/``, the layout the API's
    catalog lists. The first source is the newest, so a run listed from ``runs/`` comes first."""
    runs_dir, demo_dir = root / "runs", root / "demo"
    runs_dir.mkdir(parents=True)
    demo_dir.mkdir(parents=True)
    newest = time.time_ns()
    taken: set[str] = set()
    for index, source in enumerate(sources):
        if source.run_id in taken:
            raise Refused(f"two sources would be listed as {source.run_id!r}")
        taken.add(source.run_id)
        if not SAFE_ID.fullmatch(source.run_id):
            raise Refused(
                f"{source.run_id!r} is not a name the site can use (letters, digits, . _ -)"
            )
        target = (demo_dir if source.kind == "bundle" else runs_dir) / source.path.name
        target.mkdir()
        for name in RUN_FILES:
            if (source.path / name).is_file():
                shutil.copyfile(source.path / name, target / name)  # not copy2: refs are read-only
        stamp = newest - index * 1_000_000_000
        os.utime(target / "events.jsonl", ns=(stamp, stamp))
    return runs_dir, demo_dir


def scratch_client(runs_dir: Path, demo_dir: Path, bench_dir: Path, root: Path) -> TestClient:
    """The real API over the scratch catalog. No private directory: no job, no intake, no pair."""
    app = create_app(runs_dir, demo_dir, bench_dir, root / "no-static")
    return TestClient(app, base_url=LOOPBACK)


# ---- writing the data -------------------------------------------------------------------------


class Data:
    """The ``data/`` folder of the site, and the manifest that tells the shim what is in it."""

    def __init__(self, out: Path) -> None:
        self.root = out / DATA
        self.written = 0
        self.files = 0

    def write(self, relative: str, content: bytes) -> dict[str, Any]:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        self.written += len(content)
        self.files += 1
        return {"file": relative, "bytes": len(content)}

    def entry(self, relative: str, status: int, content: bytes) -> dict[str, Any]:
        """How the shim answers one route: a status, and a body in the manifest if it is small,
        else a file. An error always travels in the manifest."""
        if status != 200 or len(content) <= INLINE_MAX:
            return {"status": status, "body": _json_or_text(content)}
        return {"status": status, **self.write(relative, content)}


def _json_or_text(content: bytes) -> Any:
    try:
        return json.loads(content)
    except ValueError:
        return {"error": content.decode("utf-8", errors="replace")}


def _dump(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def read_route(client: TestClient, url: str) -> tuple[int, bytes, Exception | None]:
    """A GET as the live server answers it. A route that raises answers 500 there (uvicorn), while
    the test client re-raises: keep the answer, and the exception for the build report."""
    try:
        found = client.get(url)
    except Exception as exc:
        return 500, b"Internal Server Error", exc
    return found.status_code, found.content, None


def export_run(
    client: TestClient, data: Data, run_id: str, provenance: Provenance
) -> tuple[dict[str, Any], list[str]]:
    """Everything the app reads for one run: its log in pages, its read routes, its calls in full
    and the replay check. Returns the run's part of the manifest, and what the build report
    should say about it."""
    base = f"/api/runs/{run_id}"
    notes: list[str] = []
    folder = f"run/{run_id}"  # not runs/: the repo's .gitignore skips every folder of that name
    routes: dict[str, Any] = {}

    summary = client.get(base)
    if summary.status_code != 200:
        raise Refused(f"{run_id}: the API answered {summary.status_code} for the run")
    if not summary.json()["chain"]["ok"]:
        raise Refused(f"{run_id}: its hash chain is broken: {summary.json()['chain']}")
    routes["summary"] = data.entry(f"{folder}/summary.json", 200, summary.content)

    pages, last_seq = export_events(client, data, run_id, folder)
    for name in RUN_ROUTES:
        status, content, error = read_route(client, f"{base}/{name}")
        routes[name] = data.entry(f"{folder}/{name}.json", status, content)
        if error is not None:
            notes.append(
                f"{run_id}: GET {name} raised {type(error).__name__}: {error}; the live server "
                "answers 500 for it, and so does the site"
            )

    try:
        verified = client.post(f"{base}/verify", json={})
    except Exception as exc:  # the replay itself failed: the test client re-raises what the app did
        raise Refused(f"{run_id}: the replay failed: {exc!r}") from exc
    report = verified.json()
    if verified.status_code != 200:
        raise Refused(f"{run_id}: the API would not verify it ({verified.status_code}): {report}")
    if not (report["ok"] and report["bundle_head_ok"]):
        raise Refused(f"{run_id}: the replay does not match its log: {report['detail']}")
    stored = report | {"static": {"where": "build"} | provenance.stamp()}
    routes["verify"] = data.entry(f"{folder}/verify.json", 200, _dump(stored))

    manifest: dict[str, Any] = {
        "events": {"last_seq": last_seq, "pages": pages},
        "routes": routes,
    }
    edges = export_edges(client, data, run_id, folder, last_seq)
    if edges is not None:
        manifest["events"]["edges"] = edges
    calls = export_call_details(client, data, run_id, folder)
    if calls is not None:
        manifest["calls"] = calls
    return manifest, notes


def export_events(
    client: TestClient, data: Data, run_id: str, folder: str
) -> tuple[list[dict[str, Any]], int]:
    """The log in pages of ``PAGE_SIZE``, each file exactly the API's answer for the request the
    client makes (``from_seq=1``, ``6001``, ... with ``limit=5000``)."""
    pages: list[dict[str, Any]] = []
    from_seq = 1
    while True:
        found = client.get(f"/api/runs/{run_id}/events?from_seq={from_seq}&limit={PAGE_SIZE}")
        if found.status_code != 200:
            raise Refused(f"{run_id}: events from {from_seq}: the API answered {found.status_code}")
        page = found.json()
        seqs = [event["seq"] for event in page["events"]]
        if seqs != list(range(from_seq, from_seq + len(seqs))):
            raise Refused(f"{run_id}: the log's seq are not 1, 2, 3 ... around {from_seq}")
        pages.append(data.write(f"{folder}/events-{len(pages) + 1:04d}.json", found.content))
        if page["done"] or not seqs:
            return pages, page["last_seq"]
        from_seq = page["next_seq"]


def export_edges(
    client: TestClient, data: Data, run_id: str, folder: str, last_seq: int
) -> dict[str, Any] | None:
    """The first and the last event, each as the API answers a request for that one event
    (``from_seq=N&limit=1``), in one small file. The Runs page asks for both of every run it
    lists: from the pages that would be a whole page (megabytes) each."""
    seqs = sorted({1, last_seq} - {0})
    if not seqs:
        return None
    answers: dict[str, Any] = {}
    for seq in seqs:
        found = client.get(f"/api/runs/{run_id}/events?from_seq={seq}&limit=1")
        if found.status_code != 200:
            raise Refused(f"{run_id}: event {seq}: the API answered {found.status_code}")
        answers[str(seq)] = found.json()
    return {"seqs": seqs, **data.write(f"{folder}/edges.json", _dump(answers))}


def export_call_details(
    client: TestClient, data: Data, run_id: str, folder: str
) -> dict[str, Any] | None:
    """Every call in full (``calls/{effect_id}``) in one file, read when the lens opens a call."""
    status, content, error = read_route(client, f"/api/runs/{run_id}/calls")
    if status != 200:
        if error is not None:
            raise Refused(f"{run_id}: the calls could not be read: {error!r}") from error
        return None  # the route is not offered for this run: nothing to open in full
    rows = json.loads(content).get("calls") or []
    if not rows:
        return None
    details: dict[str, Any] = {}
    for row in rows:
        status, content, error = read_route(client, f"/api/runs/{run_id}/calls/{row['effect_id']}")
        if status != 200:
            raise Refused(
                f"{run_id}: call {row['effect_id']}: the API answered {status}: {error!r}"
            )
        details[row["effect_id"]] = json.loads(content)
    return {"ids": list(details), **data.write(f"{folder}/call-details.json", _dump(details))}


def pair_listing(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """One entry of ``GET api/pairs`` for two recorded runs, in the shape ``api/arena.py`` writes
    for a launched pair. ``left`` and ``right`` are ``{"id", "started"}``."""
    names = {path: name for name, path in SCENARIOS.items()}
    sides = {}
    for side, found in (("left", left), ("right", right)):
        scenario = found["started"].get("scenario")
        sides[side] = {
            "run_id": found["id"],
            "scenario": names.get(scenario, scenario),
            "private": False,
            "status": "completed",
        }
    plan = ((left["started"].get("params") or {}).get("chaos")) or {}
    chaos = {"name": plan.get("profile") or "none", "actions": len(plan.get("actions") or [])}
    seed = left["started"].get("seed")
    rival = sides["right"]["scenario"]
    return {
        "pair_id": f"{left['id']}+{right['id']}",
        "label": f"swarm vs {rival}, {chaos['name']}, seed {seed}",
        "created_at": None,
        "seed": seed,
        "clock": left["started"].get("clock"),
        "private": False,
        "billed": False,
        "rival": rival,
        "chaos": chaos,
        **sides,
        "state": "completed",
        "warnings": [],
    }


def public_bench(content: bytes) -> bytes:
    """``GET api/bench/results`` names the file it read by its path on this machine; the site
    says where it lives in the repo. The one thing that differs from the live answer."""
    body = json.loads(content)
    source = body.get("source") if isinstance(body, dict) else None
    if isinstance(source, str) and source != "fixture":
        body["source"] = f"bench/results/{Path(source).name}"
        return _dump(body)
    return content  # any other shape: the scan of the finished site still looks for a local path


def export_globals(
    client: TestClient, data: Data, pairs: Sequence[tuple[str, str]], started: dict[str, Any]
) -> dict[str, Any]:
    found: dict[str, Any] = {}
    runs = client.get("/api/runs")
    found["runs"] = data.entry("runs.json", runs.status_code, runs.content)

    live = client.get("/api/capabilities").json()
    off = {key: False for key in live} | {"static": True}
    found["capabilities"] = data.entry("capabilities.json", 200, _dump(off))

    listing = [
        pair_listing(
            {"id": left, "started": started[left]}, {"id": right, "started": started[right]}
        )
        for left, right in pairs
    ]
    found["pairs"] = data.entry("pairs.json", 200, _dump(listing))

    results = client.get("/api/bench/results")
    content = public_bench(results.content) if results.status_code == 200 else results.content
    found["bench/results"] = data.entry("bench-results.json", results.status_code, content)
    honesty = client.get("/api/bench/honesty")
    found["bench/honesty"] = data.entry("bench-honesty.json", honesty.status_code, honesty.content)
    return found


# ---- the site ---------------------------------------------------------------------------------


def export_site(
    sources: Sequence[Source],
    pairs: Sequence[tuple[Source, Source]],
    out: Path,
    provenance: Provenance,
    bench_dir: Path = BENCH_RESULTS_DIR,
    settings: Settings | None = None,
) -> SiteReport:
    """Write ``<out>/data/`` and its manifest. The web app is not touched."""
    settings = settings or Settings()
    ordered = list(sources)
    for left, right in pairs:
        ordered += [found for found in (left, right) if found not in ordered]
    for source in ordered:
        refuse_private(source, settings.private_dir)

    data = Data(out)
    report = SiteReport()
    with tempfile.TemporaryDirectory(
        prefix="fractalswarm-site-", ignore_cleanup_errors=True
    ) as scratch:
        root = Path(scratch)
        runs_dir, demo_dir = stage(ordered, root)
        client = scratch_client(runs_dir, demo_dir, bench_dir, root)

        listed = {row["id"]: row for row in client.get("/api/runs").json()}
        missing = [source.run_id for source in ordered if source.run_id not in listed]
        if missing:
            raise Refused(f"the catalog does not list {', '.join(missing)}")
        started = {
            source.run_id: first_event(_staged(runs_dir, demo_dir, source) / "events.jsonl")[
                "payload"
            ]
            for source in ordered
        }
        pair_ids = [(left.run_id, right.run_id) for left, right in pairs]

        runs: dict[str, Any] = {}
        for run_id in listed:
            before = (data.written, data.files)
            runs[run_id], notes = export_run(client, data, run_id, provenance)
            report.runs.append(
                RunReport(
                    run_id,
                    listed[run_id]["events"],
                    listed[run_id]["head"],
                    verified=True,
                    bytes=data.written - before[0],
                    files=data.files - before[1],
                    notes=notes,
                )
            )
        globals_ = export_globals(client, data, pair_ids, started)

    report.pairs = [f"{left}:{right}" for left, right in pair_ids]
    manifest = {
        "format": MANIFEST_FORMAT,
        "site": provenance.stamp()
        | {"generator": "scripts/build_static_site.py", "page_size": PAGE_SIZE},
        "global": globals_,
        "runs": runs,
    }
    data.write("manifest.json", _dump(manifest))  # on the startup path: no indentation
    report.data_bytes = data.written
    return report


def _staged(runs_dir: Path, demo_dir: Path, source: Source) -> Path:
    return (demo_dir if source.kind == "bundle" else runs_dir) / source.path.name


# ---- the web app ------------------------------------------------------------------------------


def build_web(out: Path) -> None:
    """``vite build --mode static`` into ``out``. The build is the whole of ``out`` afterwards
    (Vite empties it first), so this runs before the data is written."""
    node = shutil.which("node")
    vite = WEB / "node_modules" / "vite" / "bin" / "vite.js"
    if node is None or not vite.is_file():
        raise Refused("vite is not installed: run `npm --prefix web install` first")
    command = [node, str(vite), "build", "--mode", "static", "--outDir", str(out), "--emptyOutDir"]
    subprocess.run(command, cwd=WEB, check=True)
    if not (out / "index.html").is_file():
        raise Refused(f"vite did not write {out / 'index.html'}")


def check_out(out: Path) -> None:
    """The build empties ``out`` first. Only a folder that is empty, or holds an earlier build of
    this script, may be emptied: a mistyped ``--out`` must not wipe a repo or a home folder."""
    if not out.exists():
        return
    if not out.is_dir():
        raise Refused(f"{out} is a file, not a folder")
    foreign = sorted(path.name for path in out.iterdir() if path.name not in OUTPUT_NAMES)
    if foreign:
        raise Refused(
            f"{out} holds {', '.join(foreign[:4])}, which a build of this script does not write, "
            "so it will not be emptied: name a new folder"
        )


def finish(out: Path) -> None:
    """What GitHub Pages needs next to the app: no Jekyll, so no file or folder is skipped."""
    (out / ".nojekyll").write_text("", encoding="utf-8")


# ---- checks on the finished site --------------------------------------------------------------


def forbidden(settings: Settings, private_dir: Path) -> dict[str, str]:
    """What must not appear in a file of the site: the secrets and this machine's paths."""
    needles = {f"secret {i + 1}": value for i, value in enumerate(settings.secret_values())}
    for label, path in (
        ("the home directory", Path.home()),
        ("the private directory", private_dir),
        ("the repository path", REPO),
    ):
        for form in {str(path), path.as_posix()}:
            needles[f"{label} ({form})"] = form
    return {label: needle for label, needle in needles.items() if len(needle) >= 8}


def scan(out: Path, needles: dict[str, str]) -> list[str]:
    """Every text file of the site that holds a forbidden string, once for each."""
    spellings = {
        label: [needle.encode("utf-8"), needle.replace("\\", "\\\\").encode("utf-8")]
        for label, needle in needles.items()
    }
    found: list[str] = []
    for path in sorted(out.rglob("*")):
        if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
            continue
        content = path.read_bytes()
        for label, forms in spellings.items():
            if any(form in content for form in forms):
                found.append(f"{path.relative_to(out).as_posix()}: {label}")
    return found


def tree_bytes(folder: Path) -> int:
    return sum(path.stat().st_size for path in folder.rglob("*") if path.is_file())


# ---- git and the command line -----------------------------------------------------------------


def current_provenance(now: datetime | None = None) -> Provenance:
    def git(*args: str) -> str:
        done = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True)
        return done.stdout.strip()

    try:
        commit = git("rev-parse", "HEAD")
        dirty = bool(git("status", "--porcelain", "--untracked-files=no"))
    except (OSError, subprocess.CalledProcessError):
        commit, dirty = "unknown", True
    stamp = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return Provenance(commit, dirty, stamp)


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the static showcase (web app + recorded runs) for GitHub Pages.",
    )
    parser.add_argument(
        "--runs",
        nargs="+",
        action="extend",
        default=[],
        metavar="RUN",
        help=f"finished runs or bundles to publish (default: {' '.join(DEFAULT_RUNS)}, unless "
        "--pair names the runs)",
    )
    parser.add_argument(
        "--pair",
        nargs="+",
        action="extend",
        default=[],
        metavar="LEFT:RIGHT",
        help="an arena pair on record: the swarm run, a colon, its rival's run (both published)",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="default: %(default)s")
    parser.add_argument(
        "--bench-dir",
        type=Path,
        default=BENCH_RESULTS_DIR,
        help="where the Charts page's hero_chart.json and the helps page's honesty.json are read",
    )
    parser.add_argument("--no-build", action="store_true", help="write only data/ (no Vite build)")
    parser.add_argument("--web-dist", type=Path, help="copy this build instead of running Vite")
    parser.add_argument(
        "--require-clean", action="store_true", help="fail on uncommitted changes (to publish)"
    )
    return parser.parse_args(argv)


def describe(report: SiteReport, budget_mb: int = BUDGET_MB) -> str:
    lines = ["run".ljust(34) + "events".rjust(8) + "files".rjust(7) + "size".rjust(11) + "  replay"]
    for run in report.runs:
        lines.append(
            run.run_id.ljust(34)
            + f"{run.events:>8,}"
            + f"{run.files:>7}"
            + f"{run.bytes / 1e6:>8.2f} MB"
            + ("  verified at build" if run.verified else "  NOT VERIFIED")
        )
    lines.append(f"data: {report.data_bytes / 1e6:.2f} MB   app: {report.web_bytes / 1e6:.2f} MB")
    total = report.total_bytes / 1e6
    lines.append(
        f"site: {total:.2f} MB of about {budget_mb} MB"
        + ("  OVER BUDGET" if total > budget_mb else "")
    )
    if report.pairs:
        lines.append("pairs: " + ", ".join(report.pairs))
    lines += [f"note: {note}" for run in report.runs for note in run.notes]
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        settings = Settings()
        runs_dir = settings.runs_dir
        pairs = [tuple(split_pair(text)) for text in args.pair]
        sources = [resolve_source(arg, runs_dir) for arg in args.runs]
        if not args.runs and not args.pair:
            sources = [resolve_source(arg, runs_dir) for arg in DEFAULT_RUNS]
        pair_sources = [
            (resolve_source(left, runs_dir), resolve_source(right, runs_dir))
            for left, right in pairs
        ]
        provenance = current_provenance()
        if args.require_clean and provenance.dirty:
            raise Refused("the working tree has uncommitted changes; commit them to publish")
        out: Path = args.out.resolve()
        check_out(out)
        if args.web_dist is None and not args.no_build:
            build_web(out)
        elif args.web_dist is not None:
            shutil.rmtree(out, ignore_errors=True)
            shutil.copytree(args.web_dist, out)
        else:
            shutil.rmtree(out, ignore_errors=True)
            out.mkdir(parents=True)
        report = export_site(sources, pair_sources, out, provenance, args.bench_dir, settings)
        finish(out)
        report.web_bytes = tree_bytes(out) - report.data_bytes
        findings = scan(out, forbidden(settings, settings.private_dir))
        if findings:
            raise Refused("the site holds what it must not:\n  " + "\n  ".join(findings))
    except Refused as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 1
    print(describe(report))
    print(f"wrote {out}")
    if provenance.dirty:
        print("note: built from a tree with uncommitted changes (the stamp says so)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
