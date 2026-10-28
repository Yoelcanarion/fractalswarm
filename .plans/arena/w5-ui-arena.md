# Worker brief W5 — `ui-arena`

- **Branch:** `Yoelcanarion/arena-ui-arena`. The coordinator created it from `Yoelcanarion/arena` after W4's first merge, as a child worktree, and you are already in it: do not create another worktree or branch.
- **Model:** Sonnet 5.5 at max effort. Invoke `/hard-task` for the arena layout, the director-mode design and the scene choreography.
- **Setup:** run `uv sync` and `npm --prefix web install` first.

## Why this matters
You build the screens that carry the video's story. The jury must understand three things in three minutes:
1. **What problem FractalSwarm solves.** The arena: two teams, the same failures.
2. **Why Meta's models matter.** Intake and ablation.
3. **What evidence shows that recovery works.** The arena counters, the "where it helps" panel, and the proof chips.

**Director mode** turns these screens into repeatable 1080p takes, and the recorder captures them.

## Read first
- `CLAUDE.md` (binding).
- `.plans/arena-spec.md`:
  - §0, the north star;
  - §1;
  - §A, "What we grant the rival": the caption text comes from there;
  - §C.5, the claim rules;
  - §D, live input;
  - §E, items 1 and 3;
  - §F;
  - §G.
- `docs/video-script.md`: the scene ids, what each scene shows, and its timing.
- `.plans/notes/arena-ui-core.md` (W4's notes) and W4's code: the store factory, the shared clock (with its fixed-step mode), the tokens, `Stat`, `ModelBadge`, `Card`, `Skeleton`.
- The API notes from W2 (`.plans/notes/arena-intake.md`) and W3 (`.plans/notes/arena-meta.md`). Until they merge, build against fixtures in `web/src/lib/fixtures/`.

## Your files
- **You own:**
  - new `web/src/arena/*`;
  - new `web/src/director/*` (with its scene scripts);
  - new `web/src/intake/*`;
  - new `web/src/ablation/*`;
  - new `scripts/record_scenes.*`;
  - the `video/` entry in `.gitignore`.
- **Light edits:** `App.tsx` (new routes) and the nav.
- **Not yours:** W4's core (`store.ts`, `lib/*`, the shared components, the run page and the lens UI) and all Python. Ask the coordinator for changes there.

## Your job, in order

### 1. The arena `#/arena/<left>/<right>` (spec §F.4)
- **Layout:**
  - two run views side by side, on two stores from W4's `createRunStore()`, driven by **one shared clock**;
  - both runs are aligned at `run.started`, with one scrubber and one speed control;
  - the swarm is on the left, the rival on the right.
- **A shared timeline** with the crash markers of both runs, and per-side "down / restarting" bands.
- **Per-side cards:**
  - the verify badge;
  - "takeover OK" (swarm) or the recovery report (supervisor), when the API exposes them.
- **Face-to-face counters,** using W4's `Stat` with count-up:
  - idle agent-seconds;
  - time to recover;
  - coordinator-dependency time;
  - cost;
  - duplicated work;
  - reassignments;
  - hard violations.

  They run on W4's fold while playing, and end on the official numbers from `GET /api/runs/{id}/metrics`.
- **The assumptions caption**, always visible: "Rival: ideal durable supervisor — 5 s detection · 0 s restart · workers survive · same log". The text comes from the run's params, so a sweep run shows its own values.
- **Pair picker:** `GET /api/pairs` (W2). Any two run ids also work through the URL.
- **Development data:**
  - fake pairs at $0, generated locally in a scratch runs dir: swarm vs `central` until W1 merges, then swarm vs `durable-max`;
  - at least one recorded pair bundled for offline viewing. Ask the coordinator which one; the live-input pairs are private and never bundled.

### 2. The "where it helps" panel (spec §1, §C)
- It reads `honesty.json` (W1's `charts.py`): wins, ties and losses by regime, plus the per-process view.
- It is a regime map (detection latency × coordination density) and a plain table: **where it helps, where it ties, where it loses.**
- It never hides a loss, and it names the failure model of every row.

### 3. Intake and review (spec §D)
- **A "New task (live)" form:**
  - text boxes for talks and for emails or notes; rooms are optional;
  - the fixed shape is shown (2 days, 3 tracks × 2 blocks);
  - a PII warning ("stays on this machine; never bundled").
- **"Read with Muse":** `POST /api/intake`, then a review table:
  - talks, tracks and speakers;
  - constraints (availability, preferences, attendance);
  - **each with its source sentence highlighted in the original text.**

  Yoel edits, deletes or adds rows, then approves (`POST /api/intake/{id}/approve`). Every row shows its provenance: Muse, or edited by Yoel.
- **Run:** a single run, or **Run arena pair** (`POST /api/arena`, with the rival selectable).
- **Real spend** goes through W2's two steps: preflight, then the typed "SPEND". Show the worst case and the caps before he types.

### 4. The ablation view (spec §E.3)
- Per note: what the regex parser extracted, next to what Muse extracted, with ✓/✗ against the approved reading. The differences are highlighted.
- A headline line: "parser N of M · Muse K of M".
- The caveats from the result payload, in small print.

### 5. Director mode `#/director/<scene>` (spec §F.7)
- **Scene scripts** live in `web/src/director/scenes/<scene-id>.json`, one per scene in `docs/video-script.md`.
- **A scene** names its run or pair, and a list of steps on the virtual clock:
  - `seek`, `play`, `pause`, `speed`;
  - `camera` (fit a node or a subtree, zoom, pan, with easing);
  - `highlight` (a node, a cell, a counter);
  - `caption` (a lower third: text and duration);
  - `lens` (open a call);
  - `panel` (show or hide);
  - `wait`.
- **The frame:** 1920×1080, no app chrome, with safe margins for the captions.
- **Repeatable takes:** director mode drives the stores with W4's **fixed-step** clock, so the same scene renders the same frames every time.
- **The live-input scenes** (typing, Read with Muse, approve) are recorded from the real live session. Director mode covers what follows them, replaying that private run locally.

### 6. The scene recorder `scripts/record_scenes.*`
- **The browser.** There is no Chrome or Edge on this machine. Use Playwright's Chromium at `~/AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe`, which matches Playwright 1.48:
  - either Node `playwright-core@1.48.2`, installed in a scratch dir outside `web/`'s dependencies (proven on this machine);
  - or the Python `playwright==1.48.*` as a dev dependency.

  Pick one and document it at the top of the script.
- **What it does:** it launches the browser headless at an exact 1920×1080 viewport (`deviceScaleFactor: 1`), opens `#/director/<scene>`, waits for the scene's ready signal, records, and stops at the scene's end. The output is one clip per scene in `video/clips/`, which is gitignored.
- **Quality.** Check it at full size. If `recordVideo` looks soft, step the fixed clock frame by frame, take screenshots, and encode at 60 fps with ffmpeg. Check whether ffmpeg is installed; **ask the coordinator before installing anything.**
- **Never** run it during a paid run.

## Hard rules
- No real Meta API calls. Fixtures, fake runs and recorded runs only.
- At most one dev server. Stop it on HOLD; no recordings or builds until RELEASE.
- Every user-visible string is in English. Claims shown on screen (captions, counters, the honesty panel) must match `docs/claims.md`, or be marked as placeholders.
- Don't edit `.plans/progress.md`. Write your notes to `.plans/notes/arena-ui-arena.md`.

## Tests and checks
- vitest for the pure parts: arena alignment and the shared clock, the parsing and validation of scene scripts, the review-table edits and the ablation diffing.
- `npm --prefix web run typecheck`, `npm --prefix web test` and `npm --prefix web run build`. Copy the build into `src/fractalswarm/api/static/` and remove stale hashed assets.
- `uv run fractalswarm demo --verify` (MATCH).
- **Screenshots at an exact 1920×1080** of the arena (mid-run and end), intake, review, ablation, and one frame per director scene. Attach them to your report.

## End
- Commit on your branch. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't merge or push.
- Report to the coordinator: the branch and the commit, the test counts, the screenshots, done and not done, and deviations.
