# W7 `home-viz` — notes

Branch `Yoelcanarion/arena-home-viz` (from `Yoelcanarion/arena`; arena merged in on Oct 30 with R5 and R6). Brief:
`.plans/arena/w6-home.md`. **Stopped by Yoel on Oct 30, 12:00 CET** (all Phase 2 work paused); everything is
committed as a WIP commit, nothing pushed or merged. W6's page is in the `arena-home` worktree (`Yoelcanarion/arena-home`,
commit `8bd4f1f`, read only for me); its contract is its `.plans/notes/arena-home.md` and `web/src/home/storyTypes.ts`.

## Done (tested, not yet seen in a browser)

- **Data:** `scripts/build_home_data.py` writes `web/src/home/data/story.json` (about 67 KB, deterministic, sorted keys);
  types in `web/src/home/data/types.ts`; `tests/unit/test_home_data.py` (14 tests). The file follows W6's contract: claims
  `{text,status,state}`, facts, hero (the v1 file's own shape), headline, finish, takeover, failures, assumptions rows, tokens,
  proof, and one self-contained slice per visual (tree, lanes.central, hrw, hashes). `extraction` and `ablation` are NOT in it
  (no source I can use without a real call); the page keeps its PENDING tags.
  Regenerate: `uv run python -I -X utf8 scripts/build_home_data.py --central-run C:/Users/yogar/orca/workspaces/work-orquestrator/arena-coord2/bench/results/v1/runs/central__t2_conference__C3__s1`
- **SwarmTree** (`viz/tree/*`, pure frame function plus a DOM painter, default pacing `story`, optional `hero`),
  **`viz/keyframes.ts`** (`TREE_KEYFRAMES` under W6's names, `TREE_HERO_KEYFRAMES`, `TREE_HERO_SECONDS` 9.1,
  `TREE_STORY_SECONDS` 36.75), **HrwPanels** (`viz/hrw/*`), **HashStrip** (`viz/hash/*`), shared helpers (`viz/shared.ts`),
  `viz/playback.ts`, and a lab with the tree section only (`viz/lab/*`, standalone at `/src/home/viz/lab/index.html`).
- Checks at the last commit: `npx vitest run --maxWorkers=1` in `web/` 79 files / 1195 tests pass; `npx tsc --noEmit -p .` clean;
  `uv run pytest tests/unit/test_home_data.py` 14 pass; ruff check and format clean. Nothing in `src/fractalswarm/` was touched,
  so the full pytest and the $0 reference comparison were not run.
- Status already sent to the coordinator (msg_ebdf99d6c782): the six differences W6 must know (no rename needed).

## Not done

- **Never seen in a browser:** no screenshots, no fps run, no `npm run build`, no `demo --verify` (HOLD was never lifted by a RELEASE).
- `HrwPanels` and `HashStrip` exist but are not yet exported from `viz/index.ts` and have no lab section.
- Not started: **WorkLanes, LineDraw, DotPlot, PairedBars, RegimeStrip, TokenBar, CountUp, DoorGlyph**, and the lab sections for them.
  Nothing is half-written in the tree.

## Next, in order

1. Export `HrwPanels`, `HashStrip` from `viz/index.ts`; add their lab sections (slider per visual, `story.hrw`, `story.hashes`).
2. **WorkLanes** (canvas, data `lanes.central`: 14 lanes, 118 bars `[lane,startMs,endMs,kind,costMicroUsd,cause]`, kinds
   counted 0 / cutOff 1 / again 2 / other 3, causes none 0 / crash 1 / kill 2 / other 3, duration 345.3 s, crashes at
   45.8 / 66.2 / 84.9 / 112.8 / 140.7 s, stall spans total 101.8 s, wasted $0.187 of $0.433). W6 draws the stall counter as
   `stallS × clamp((p − crash)/(restart − crash))` from `lanes.central.keyframes` (filled .28, crash .33, restart .62, redone .78,
   end 1), so the lanes' time map must make the *cumulative stall linear in progress* between `crash` and `restart`:
   `[0,filled]` t 0→44 s; `[filled,crash]` a slow beat to the first crash; `[crash,restart]` t 45.8→279.5 s with stall spans
   getting time in proportion to their length and work gaps squeezed; `[restart,redone]` hold at 279.5 s while the cut-off (red)
   and redone (amber) bars and the "thrown away" tally are shown; `[redone,end]` 279.5→345.3 s. Stall spans hatched grey with
   their durations; no second stall counter. Canvas colours are read from the CSS tokens once per theme change.
3. Charts, hand-built SVG, direct labels, real axes, text alternative, tokens only (the `dataviz` skill applies):
   **LineDraw** (hero series; swarm, durable-max and central in full colour, the rest quiet; axes first, then lines; names its
   setting: T2, real model, 2 seeds), **DotPlot** (headline, per seed, 3 seeds), **PairedBars** (verdicts, with the $0 gate note),
   **RegimeStrip** (holds = accent, ties = neutral, fails = rival neutral; fake model, T2 C3), **TokenBar** (`--model-*` tokens,
   coordination and recovery 0), **CountUp**, **DoorGlyph** (7 doors: arena, live, replays, new-task, director, numbers,
   ablation). Export under exactly these names from `viz/index.ts`.
4. Notes update, tests, then `merge_ready`. At a RELEASE: dev server on port 5175, screenshots (1920×1080, 1366×768, 390×844;
   dark, light, reduced motion), a critical look, fps, build, `demo --verify --no-serve --no-browser` against `proof.lines`;
   iterate the beats in the order 2, 0, 1, 4, 5, 3. One `worker_done` at the end.

## Rules that still apply (brief and CLAUDE.md)

Fake LLM only, no real calls; before any run set `FRACTALSWARM_RUNS_DIR` and `FRACTALSWARM_LEDGER_PATH` to scratch dirs and never
write to `~/.fractalswarm`; media queries only (no container queries), colours only through tokens (both themes), animate
transform and opacity only; claims copied by id from `docs/claims.md`, `pending` rows with a visible PENDING tag; W6 and W7 talk
only through the coordinator; only `viz/**`, `data/**`, the generator, its test and this file are mine.
