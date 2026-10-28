# Day 7 stream — UI, API and demo (`Yoelcanarion/day-07-ui`)

Started by a background agent of the day-03 session on Tue 27 Oct, paused (`wip(day-07-ui)` commit),
finished in its own Orca workspace on Wed 28 Oct. Spend: $0 (fake LLM and recorded bundles only).

## Done
- **API** (`api/app.py`, `api/ws.py`, `api/catalog.py`; Starlette + uvicorn):
  - REST: `GET /api/runs`, `GET /api/runs/{id}`, `GET /api/runs/{id}/events?from_seq=&limit=`,
    `POST /api/runs/{id}/verify` (kernel replay; cached per run head), `GET /api/bench/results`
    (first of `bench/results/{hero_chart,hero,charts}.json`, else `api/fixtures/hero_chart.json`).
  - Stubs answering 501 with a clear message: `POST /api/tasks`, `/approve`, `/chaos` (validates the
    kind), `/budget`, `/halt`, `/escalations/{eid}`.
  - `WS /api/runs/{id}/events?from_seq=&speed=1..20&pace=none`: a finished run is replayed at its
    virtual pace (idle gaps capped at 2 s); a running one is tailed from its SQLite log.
  - The catalog lists `runs/` plus the bundles under `demo/` (ids `demo-<name>`).
- **CLI** (additive): `fractalswarm serve`, `fractalswarm demo [--verify] [--bundle] [--no-serve]`.
  `demo --verify` replays `demo/backup` if present, else `demo/toy`, prints `MATCH`, then serves the UI
  on that replay (spec §0.1 item 2). Needs no key and no Node: the built UI is committed.
- **Web** (`web/`, Vite + React + TS, @xyflow/react, recharts, zustand):
  - Pure reducers, unit-tested with vitest: `lib/reducer.ts` (tree, counters, ownership, chaos,
    takeover), `lib/schedule.ts` (T2 grid), `lib/playback.ts` (scrubber, 1–20×), `lib/hero.ts`.
  - Run page: counters (coordination tokens first), fractal tree with ownership colours, animated
    message edges and red ✕ on death, T2 schedule grid, chaos panel, event feed, timeline scrubber
    with chaos/death/adoption marks, "Replay verified ✓" badge backed by the verify endpoint.
  - Charts page (hero chart: stall time + extra cost on top; completion, validity, coordination tokens
    below; table view; a "fixture data" banner when no bench JSON exists). Runs page with a
    TaskSpec upload form (stub).
  - Shareable replay links: `#/run/<id>?at=end|<n>&speed=<1|2|5|10|20>&play`.
- **Demo bundle:** `demo/toy/` is a byte-exact copy of `tests/golden/toy/` (guarded by a test).
- Checked in a 1920×1080 headless browser on `demo-toy`: tree, feed, scrubber, verified badge,
  charts page with the fixture, runs page.

## Deviations
- **Starlette instead of FastAPI**: the API is a handful of JSON routes and one WebSocket; pydantic
  models are already in the kernel. Same uvicorn server.
- `.gitattributes`: `demo/**` and `src/fractalswarm/api/static/**` are `-text`, so Windows
  checkouts keep LF and the bundle's bytes match the golden.
- The WS pacing test runs at 5× with a 0.6 margin (Windows timers are ~16 ms coarse; at 20× it flaked).

## Tests
- `uv run pytest`: 106 passed. `ruff check` and `ruff format --check`: clean.
- `npm --prefix web test`: 27 passed (4 files). `npm --prefix web run build`: clean.

## Wiring needed after the merge (lead merges 4 → 5 → 6/8 → 7)
- **Day 4 slice** — the schedule reducer expects:
  - `run.started.payload.params.grid = {days, rooms, slots}` (fixes the axes; otherwise they grow
    from placements);
  - `schedule.placed {day, room, slot, talk_id, title?, speaker?, squad?}`,
    `schedule.removed {day, room, slot, talk_id?}`;
  - `collision.detected {collision_id, kind, cells: [{day, room, slot}], squads}`,
    `collision.resolved {collision_id, arbiter, rule?, winner?}`;
  - `schedule.checked {hard_violations, soft_score}`.
  Rename fields in `lib/schedule.ts` if the slice's events differ. Wire `POST /api/tasks` and
  `/approve` to the planner.
- **Day 5 takeover** — the tree reducer handles `member.suspected {member}`, `member.dead {member}`,
  `tree.adopted {dead|from, adopter|to|new_parent, children?, duties?}`,
  `ownership.assigned {key, owner}`, `ownership.remapped {key|keys, to, duties?}`, and
  `chaos.injected {kind, target|targets}` (kinds starting with `kill` mark targets killed). Check
  them against the real event shapes; coordination tokens come from LLM effects tagged as
  coordination (see `reducer.ts`). Wire `POST /chaos` to the chaos injector.
- **Day 6 bench** — point `HERO_FILES` / `BENCH_RESULTS_DIR` at what `bench/charts.py` writes and
  align `lib/hero.ts` and `api/fixtures/hero_chart.json` with its JSON.
- **Day 8 safety** — `POST /halt` and `/budget` should call `fractalswarm halt RUN` /
  `budget RUN --usd X` (control files in the run directory); add the scope/security events to the
  feed's `summarize`/`tone`.
- **Backup bundle** — record the real T2 kill-half run into `demo/backup/` (with `HEAD`);
  `demo --verify` picks it up automatically.

## Issues
- The JS bundle is ~730 kB (220 kB gzip); fine for a local tool, could be split later.
- The chaos buttons answer 501 on every run for now; on recorded runs the panel says so.
