# Stream: day-07-ui

Branch `Yoelcanarion/day-07-ui`, base `b6abd07` (Day 3 kernel + the real one-call golden).
This stream was started by a background agent of the day-03-kernel session on 2026-10-27 and paused
mid-work to move it into its own Orca workspace. Everything it had written is in the
`wip(day-07-ui)` commit, including a built bundle in `src/fractalswarm/api/static/` that is already
stale relative to the source. **Nothing has been verified as a whole.**

You are already in this stream's Orca workspace: do not create another worktree or branch.
Run `uv sync` and `npm --prefix web install` first.

## Parallel streams (do not edit their files)
- `day-04-slice`: T2 task, planning/, actors/, memory/, coord/hrw.py, coord/leases.py, verify/checks.py, verify/judge.py. Its event types (placements, contracts) are what the schedule grid will consume after the merge.
- `day-05-coord-foundations`: comms/, coord/membership.py (emits member.suspected / member.dead / write.fenced), llm/transport.py, llm/calibrate.py.
- `day-06-bench-foundations` (finished, committed): `bench/charts.py` writes the hero chart as PNG + JSON (top row: stall time and extra cost vs C0 against coordinators killed 0/1/3/5; bottom row: completion, validity, coordination tokens; mean over seeds with min–max; each point keeps its run directory). Align `web/src/lib/hero.ts` and `api/fixtures/hero_chart.json` with that JSON after the merge.
- `day-08-safety-economy` (finished, committed): adds `fractalswarm halt RUN` and `fractalswarm budget RUN --usd X` (control files in the run directory) and scope/security events: the chaos/halt/budget endpoints should call those after the merge.

The lead merges the streams in this order: 4 → 5 → 6/8 → 7.

## Original brief (verbatim)

You are building FractalSwarm (a multi-agent LLM runtime for a hackathon). You work alone in your own git worktree, in parallel with other agents who own other modules. Repo base commit: b6abd07 (Day 3 kernel done).

FIRST: ~~`git switch -c Yoelcanarion/day-07-ui`~~ (already on it), then `uv sync`. Read `CLAUDE.md` (binding rules; stack: web in `web/` = Vite + React + TS; built assets copied to `src/fractalswarm/api/static/`), `.plans/days/day-07.md`, spec `.plans/fractalswarm-spec.md` §0.1, §16, §17, §23, and the last entries of `.plans/progress.md`. Study `src/fractalswarm/kernel/{events,store,replay}.py`, `runs.py`, `cli.py`, `actors/toy.py`, and the golden bundles in `tests/golden/toy` and `tests/golden/one-call`.

YOUR JOB: Day 7 tasks 1–9 as far as possible without the Day 4/5 runtime (other agents are building the T2 slice and takeover now; event types like tree.adopted, member.dead, schedule placements don't exist yet):
1. `api/app.py` + `api/ws.py` (FastAPI or Starlette + uvicorn; add deps): REST for runs (list, get, events page, verify → calls kernel replay), bench results (read a JSON file), plus stub endpoints for tasks/approve/chaos/budget/halt/escalations that return 501 with a clear message until wired. WebSocket event stream with `from_seq`, working for recorded runs (replay-paced, 1–20×) and tailing a live run's SQLite store. `fractalswarm serve`.
2. `web/` app: Vite + React + TS, @xyflow/react, recharts, zustand; an event-store client that folds the event stream into view state (pure reducer, unit-tested with vitest).
3. Fractal tree graph from actor.spawned/actor.stopped/msg.sent, with ownership colors and animated message edges, red ✕ on death; design the reducer so that `tree.adopted` / `member.dead` (spec §5) re-wire the tree — write the handling now against the spec's event shapes, tested with synthetic events.
4. T2 schedule grid (rooms × slots × day) driven by a reducer over placement events — define the expected event shape from the spec and test with synthetic data; it gets wired when the slice lands.
5. Chaos controls UI (buttons call the stub endpoints).
6. Replay page: timeline scrubber 1–20×, "Replay verified ✓" badge backed by the verify endpoint.
7. Charts page reading the hero-chart JSON (shape: coordinate with spec §15.5; another agent writes bench/charts.py — read its JSON if a file exists, otherwise use a fixture).
8. `npm --prefix web run build` → copy into `src/fractalswarm/api/static/` (commit the built assets). `fractalswarm demo --verify` must work from a clean checkout with no API key and no Node: it verifies the bundled run in `demo/` (for now copy tests/golden/toy as `demo/toy/`; the real backup bundle comes later) and prints MATCH, and `fractalswarm demo` serves the UI on the bundled replay.
Design: clean, dark-friendly, legible on a video recording at 1080p. It is the main surface of a 3-minute hackathon video.

NOT yours (do not create/edit): kernel internals beyond read access, coord/, comms/, planning/, actors/, memory/, verify/, bench/ (except reading JSON), safety/, tools/, market/. Keep edits to cli.py and pyproject.toml additive.

HARD RULES:
- Do NOT make any real Meta Model API call. Fake LLM and recorded bundles only.
- Never touch ~/.fractalswarm/ledger.sqlite from tests.
- Do not edit `.plans/progress.md`; write your entry (done, deviations, issues, what needs wiring once the slice/takeover lands) to `.plans/notes/day-07-ui.md`.

END: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `npm --prefix web run build` (and the web unit tests) green; commit on your branch (end message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Don't commit node_modules. Do NOT merge or push. Report: branch, worktree path, commit hash, test counts, done/not done, deviations.

## Done so far (from the WIP diff; unverified)
The agent was writing "chaos, timeline, counters, feed" components when it was paused.
- API: `api/{app,ws,catalog}.py`, `api/fixtures/hero_chart.json`, `tests/integration/test_api.py`; deps in `pyproject.toml`/`uv.lock`; new commands in `cli.py`.
- Demo bundle: `demo/toy/{events.jsonl,cassette.jsonl,HEAD}` (copy of tests/golden/toy).
- Web: Vite/TS config, `store.ts`, `lib/{api,reducer,playback,schedule,hero,layout,types,testing}.ts` with vitest tests for reducer, playback, schedule and hero; components `TreeGraph`, `ScheduleGrid`, `ChaosPanel`, `Timeline`, `Counters`, `EventFeed`, `VerifyBadge`; pages `Runs`, `Run`, `Charts`.
- A built bundle in `api/static/` (stale; rebuild before closing).

## Remaining
1. Read every WIP file; finish the components the agent was on (ChaosPanel, Timeline, Counters, EventFeed) and make the app compile.
2. Web unit tests green (`npm --prefix web test` or the configured vitest script; add the script if missing).
3. Python API tests green; `fractalswarm serve`, `fractalswarm demo`, `fractalswarm demo --verify` (prints MATCH, no key, no Node).
4. Rebuild `web` and copy into `src/fractalswarm/api/static/` (remove stale hashed assets).
5. Look at the UI in a browser on `demo/toy` (use the `run` skill or a screenshot) at 1080p: tree, replay scrubber 1–20×, verified badge, charts page with the fixture.

## How to close
- `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `npm --prefix web run build` and the web tests all green.
- Write `.plans/notes/day-07-ui.md` (done, deviations, issues, what needs wiring once the slice/takeover/safety land).
- Commit on `Yoelcanarion/day-07-ui` (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never commit node_modules.
- Do not merge or push. Tell Yoel it is ready, with the commit hash and test counts.
