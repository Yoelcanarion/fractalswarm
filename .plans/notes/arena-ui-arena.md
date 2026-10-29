# W5 `ui-arena` — notes

Branch `Yoelcanarion/arena-ui-arena` (from the arena tip `52db68e`). This file is the coordinator's reference
for what W5 built and which shapes it relies on. It is updated at each merge point.

## Status

| Step | State |
|---|---|
| 1. Arena `#/arena/<left>/<right>` (two stores on one clock, shared timeline, counters, caption, picker) | built and committed; looked at in a browser once on scratch pairs; the static build and `demo --verify` wait for a slot |
| 1b. Supervisor recovery chip on W1's `GET /api/runs/{id}/recovery` | done, tested on real report JSON |
| 2. "Where it helps" panel `#/helps` on `GET /api/bench/honesty` | done, tested; a browser look at the final version waits for a slot |
| 3. Intake and review UI | not started |
| 4. Ablation view | not started |
| 5. Director mode `#/director/<scene>` | not started |
| 6. `scripts/record_scenes.*` | not started |

No recorded pair is bundled: the coordinator said to wait for the post-freeze pair (Mon Nov 2). The arena runs on
scratch pairs made with the fake LLM at $0.

## Design

The arena layout, the board and the director's design ran under `/hard-task`. The decisions that are not obvious
from the code:

- **One clock, two stores.** `createPairSession` (session.ts) makes both stores from `createRunStore()` and aligns
  them at `run.started`, so one scrubber and one speed control move both boards. The swarm is always on the left.
- **SVG boards, not DOM.** `ArenaBoard` lays the tree out in `board.ts` (pure, tested) and draws it as SVG, so a
  screenshot at 1920×1080 is the same on every machine. Agents are dots under the coordinator they answer to; a
  rival's workers are dots under its supervisor.
- **Live counters on W4's fold, official numbers at the end.** `Scoreboard` counts from each log up to the
  playhead with W4's `Stat`; a ✓ marks a number that `GET /api/runs/{id}/metrics` has scored, which is where the
  count ends up. The caption under the strip says so.
- **The assumptions caption is always visible** (`assumptions.ts`, from the run params of both logs).
- **The root tag** is on whoever holds the `root` key (`rootOf` in board.ts). The reducer's `rootHolder` also
  counts the `board` and `net` actors (spawned without a parent, like the root), and a real root takeover is an
  `ownership.remapped` of the key `root` with no `duties`, so it picked the wrong chip. `rootOf` reads the key and
  ignores the infrastructure actors. W4's lens and tree may have the same gap (open item below).

## The panel `#/helps`

Reads `GET /api/bench/honesty` (W1's route, `bench/results/honesty.json` as committed) and nothing else:

- **No bundled fallback and no "Sample data" chip** (coordinator, msg_e0f80ba4c62f): a 404 is a plain empty state
  that names the file and the command that writes it; a failed request, or a file this panel cannot read, says so
  with the reason. The 360 KB `fixtures/honesty.sample.json` is a vitest fixture only; the app does not import it.
- **Every number comes from the file; the panel adds nothing up.** The per-rival "All H1 to H6" row and the
  "locality holds at 7 settings, ties at 18 and fails at 2" line are shown from `tally_by_rival` and
  `locality_by_rival` (W1, 48601df), and only when the file has them. Counts that are not whole numbers are
  refused with their path (a loss that read as 0 would be a loss hidden; the real file has none).
- **Axes are named as `bench/PREREG.md` §5 names the assumption each checks:** Failure detection, Restart or
  failover time, Fast external restart, Coordination density, Width; the default point is "the gate".
- **Every row names its failure model** (`models.ts`): a "Per crash" tag on the outcome, the head of the map, each
  map row ("Per crash · 5 crashes (C3)" for a sweep), the head of the table, each hypothesis row and the total, and
  a "Per process" tag on the per-process section. The tag's hint says what the model is (PREREG §6).
- **The regime map is a matrix of strips**, one row per axis and one cell per setting, because the data are 1-D
  sweeps from the default point and two assumptions are never varied together (like W1's `regime.png`). A cell is
  a shape (filled holds, hollow ties, a cross fails) plus the cdt ratio, so it never rests on colour; the heavy
  outline marks the cells that decide the outcome (the gate's default settings and the plausible region).
- **Losses are not hidden:** each count is a button that lists the settings behind it; the per-process loss on time
  to recover is drawn as a loss in its own section.
- **Claims** come from `claims.ts`, held to `docs/claims.md` by `claims.test.ts` (same words; `placeholder` exactly
  while the table says "pending"). R1 to R3 are pending until the gate, so they are drawn as "Placeholder wording,
  pending the decision gate". When the gate flips a status in `docs/claims.md`, that test fails until `claims.ts`
  follows: flip `placeholder` there.
- **Static definitions that are not in the file** stay and are cited to PREREG: the crash plans (C1/C2/C3 = 1/3/5
  crashes, §6). Asked in msg_07bbfb0f3326; say if they should come out.

## Shapes I rely on

- `GET /api/pairs`, `GET /api/runs/{id}/metrics` (top-level `recovery`), `GET /api/runs/{id}/takeover`: W2/W1, as in
  arena since `0025e22`.
- `GET /api/runs/{id}/recovery` (W1, fb7df39): `{run_id, events, system, supervised, metrics, restarts[], checks[{name,
  title, applies, detail, violations[], ok}], ok}`; 409 until the run completes. The chip says "Recovery OK ✓ N
  restarts" when `ok` and `supervised`, "Recovery check failed: <rules>" otherwise, and never "OK" for a run with no
  supervisor crash. A report whose `ok` its checks do not add up to is not trusted. A server without the route
  (404, 405, 501, 409) gets the log's own count, labelled as that. `fixtures/recovery.*.json` are real output of
  W1's `check_run` over my scratch runs.
- `GET /api/bench/honesty` (W1, fb7df39): the committed file; 404 when missing. `schema_version` 1.
- The Vite dev proxy in `web/vite.config.ts` is hardcoded to `127.0.0.1:8765`. For a second stack I used an
  untracked scratch config (not committed). An env override in `vite.config.ts` would be a one-line change for W4.

## Collisions found and resolved

W4's `styles.css` is global and already has `.chip` (a pill button), `.cell` (a schedule grid cell) and `.mark`
(a timeline tick). My board chips are `coord`, the panel's cells `rcell` and its shapes `locality`; the arena
timeline reuses W4's `.mark`, `.btn`, `.speeds`, `.badge`, `.empty` and `.stat` on purpose. `assumptions.ts` gained
an exported `systemName(system)`.

## Open items

1. W4's `rootHolder` (lib/reducer.ts) counts `board` and `net` as root holders and ignores the `root` key of an
   `ownership.remapped`; the lens and tree may show the wrong root after a takeover. Not touched (not my file).
2. The "Talks placed" meter on a board stays at 0 until the final integration, so it only moves at the very end.
   It could count contracts completed instead; I left it until the video needs it.
3. The panel's look at its final version (the failure-model tags in the map heads, the totals row) has not been
   seen in a browser; it needs a slot and a server that has `GET /api/bench/honesty` (W1's branch, or a scratch merge).
4. Merge point 1 needs, after RELEASE and a slot: `npm run build` copied into `src/fractalswarm/api/static/` (stale
   assets removed), `demo --verify --no-serve --no-browser`, and the $0 reference comparison.

## Tests

`npm --prefix web test` runs vitest in node: the pure modules, and the components drawn on the server
(`renderToStaticMarkup`). The panel's tests run over the bench's own `honesty.json`; the recovery tests over real
`check_run` output. Mutation-checked: flipping a claim's placeholder, hiding the loss counts, dropping the row
model and toning down the per-process loss each fail tests (reverted).
