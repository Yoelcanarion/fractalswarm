# W5 `ui-arena` — notes

Branch `Yoelcanarion/arena-ui-arena` (from the arena tip `52db68e`; arena `b66098b` merged in on the coordinator's
word, and arena `7e64957` on Oct 29 for W1's per-rival keys). This file is the coordinator's reference for what W5
built and which shapes it relies on. It is updated at each merge point.

## Status

| Step | State |
|---|---|
| 1. Arena `#/arena/<left>/<right>` (two stores on one clock, shared timeline, counters, caption, picker) | built; seen in a browser at 1920×1080 on the $0 reference pair and on a pair launched from the intake page (Oct 29) |
| 1b. Supervisor recovery chip on W1's `GET /api/runs/{id}/recovery` | done, tested on real report JSON, seen in a browser |
| 2. "Where it helps" panel `#/helps` on `GET /api/bench/honesty` | done, follows `docs/claims.md` after the gate, tested; seen in a browser with W1's per-rival columns |
| 3. Intake and review UI `#/new` | built (`web/src/intake`), tested on real W2 bodies; **driven end to end in a browser** (sample, practice reader, review, approve, start the arena pair) with no console error |
| 4. Ablation view `#/ablation` | built (`web/src/ablation`), tested on real W3 bodies; **seen in a browser** on a run it started itself |
| 5. Director mode `#/director/<scene>` | built and committed (`web/src/director`), 8 scene scripts, 180 tests; **seen in a browser** through the recorder, first look: see "Director mode" |
| 6. `scripts/record_scenes.*` | written and committed: PNG sequences at 1920×1080, 60 fps; no ffmpeg on the machine (the coordinator said not to install it) |

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
  It is W1's regenerated file at 48601df (with the per-rival keys); re-sync it when 38bad89 is in arena.
- **Every number comes from the file; the panel adds nothing up.** The per-rival "All H1 to H6" row and the
  "locality holds at 7 settings, ties at 18 and fails at 2" line are shown from `tally_by_rival` and
  `locality_by_rival` (W1, 48601df), and only when the file has them. The committed file in arena (code 3e723a8)
  does not have them yet, so the panel shows no totals until W1's 38bad89 merges. Counts that are not whole numbers
  are refused with their path (a loss that read as 0 would be a loss hidden; the real file has none).
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
- **Claims follow `docs/claims.md`** (`claims.ts` is generated from its cells; `claims.test.ts` holds the two
  together, so a status the file changes fails the test until `claims.ts` is regenerated). After the gate (Oct 29):
  R1 "not claimed (outcome B)", R2 "allowed at $0; the real rows are to be added", R3 "allowed, always with R2".
  The strip shows a claim only when the file allows it: it quotes R2 with R3 next to it, never R1 while it is not
  claimed, and for an outcome with no allowed headline it says "No headline claim is allowed for outcome X
  (docs/claims.md)". A claim still `pending` is drawn as "Placeholder wording, pending the decision gate".
  **My addition, say if it should come out:** each shown claim carries "Status in docs/claims.md: <the file's note>"
  (so R2 reads "allowed at $0 …; the real rows are to be added"). Every number R3 quotes was checked against
  `honesty.json` (0.279/0.191, 13.197/5.713, per-process 0.902, false deaths 1.25/2.25).
- **Static definitions that are not in the file** stay and are cited to PREREG: the crash plans (C1/C2/C3 = 1/3/5
  crashes, §6). The coordinator said both defaults are right (msg_be3029d7a885).

## The intake page `#/new` (tab "New task (live)")

`web/src/intake/*`; the address names the reading, `#/new/<intake id>`, so a reload or a link lands on it.

- **The phases are the server's states** (`flow.ts`): the form; reading (`GET /api/intake/{id}` polled every 1 s, and
  asked again every 2 s up to 20 times when the server cannot be reached); review (`proposed`); approved; stopped
  (`refused` with the firewall's reason, `failed` with the schema errors, `interrupted`), each with a way back to the
  form with the text still there. A state the server gave about another reading is ignored.
- **Strict reading of the proposal** (`proposal.ts`): exactly the fields of `intake/proposal.py`, whose rows are all
  `extra="forbid"`, so the page never sends a field the server does not know; a wrong field is refused by its path.
- **Highlighting** (`highlight.ts`): finds each quoted sentence with the server's own test (`present()`: spacing and
  case aside). The sample repeats sentences (the "Track: HCC track" line sits under nine of twelve submissions, a
  speaker's preference sentence under seven of nine), so each is placed at the occurrence nearest its row's abstract
  or email; a mark is never put on another row's text. A sentence not found in the text gets a dashed chip with "?"
  and the pane says "Muse reworded it": nothing is marked in a wrong place. The row that is picked also shows its
  abstract or email; the one sentence picked stands out.
- **Provenance** (`provenance.ts`): Muse, Edited by you (with "Muse read …" for the fields changed), Added by you.
  `diffProposal` mirrors the server's `diff`; two tests hold it to the server's own `edits` for a simple and a mixed
  set of edits (`fixtures/approve.*.json`). Rows taken out are listed with "Put back". An added row takes an id no row
  of the reading has ever had. A speaker who still has a talk cannot be taken out. A speaker's availability cannot be
  emptied (the server reads an empty list as "nothing stated").
- **Approval blocks only on what the server refuses too** (`validate.ts`, limits held to `intake/shape.py` by a test):
  fewer than 8 titled talks, a talk with no speaker or track, a speaker with no name. More than 15 talks, a track
  with fewer than 2 talks, a talk with no title and a speaker with no talk are advice (the server rebalances and
  warns). Muse's own `warnings` are shown ("Muse's notes"); its `errors` are not, because the server recomputes them.
- **Approve sends the person's proposal**, not `{}`, so the server's `edits` list is exact; 409 (already approved)
  refetches and shows the approved state. After approval `GET /api/intake/{id}` still returns *Muse's* proposal, so
  the page keeps its own working copy; a page reopened on an approved reading shows Muse's rows with the server's
  edits list above and says so (open item: there is no endpoint for the approved version).
- **The run panel** opens on the arena pair against `durable-max`, "half the brains", the simulated clock and the
  practice LLM (free). Bodies: pair `{spec, rival, chaos, clock, speed?, backend}`, one run `{spec, scenario, chaos,
  clock, speed?, backend}`, spec `{goal: "Program the live conference", task: "t2_conference", inputs: {intake: id},
  seed: "1"}`. After the launch the page goes to `#/arena/<left>/<right>` or `#/run/<id>`.
- **Real spend** is W2's two steps. Muse (billed) is offered only where `GET /api/capabilities` says `real`. A
  preflight (`/api/intake/preflight`, `/api/arena/preflight`, `/api/tasks/preflight`) is priced for the exact body;
  the page shows the worst case, the caps, and any refusal, and only then the word, which must equal the server's
  `confirm_word` exactly. The token is tied to the canonical body (a changed setting means check again), expires,
  and is spent after one launch. **Every launch goes through `requestFor`** (`launch.ts`), which decides from the body
  itself: a body that does not plainly say `backend: "fake"` leaves only through an open gate, with its token and word.
- **Private text** stays in memory for as long as the page is open (leaving for another tab does not lose it; a reload
  or "Clear" does). `ui.test` reads the sources and refuses `localStorage`/`sessionStorage`/`indexedDB`/cookies,
  `innerHTML`, and any `fetch` outside `api.ts` (every POST sends `Content-Type: application/json`).
- **Fixtures** (`intake/fixtures`): real bodies, captured at $0 with a TestClient, the fake reader and scratch
  runs/ledger/private dirs; no real backend was built. The preflight bodies in tests are written from `api/spend.py`
  (a real preflight needs the server flag and a key).
- **Not covered by a test:** the click handlers and effects of `IntakeFlow` (polling timers, the approve and launch
  sequences) run only in a browser; their decisions are in pure functions that are tested and mutation-checked.

## The ablation `#/ablation` (tab "Ablation")

`web/src/ablation/*`, on W3's `GET /api/ablation/{run_id}` (poll until the status is not `running`) and
`POST /api/ablation`.

- **Headline** "parser N of M · Muse K of M" from `result.parser`/`result.muse`; the server's sentence is its tooltip.
  Before the result exists the line is the notes scored so far, labelled "So far" (counted from the notes, the only
  number the page tallies itself; a test checks that it ends where the server's tallies do).
- **The caveats the result says apply** (`applies: true`) sit under the headline in the server's words, with a
  short label (Generated notes / The reference / Practice backend). None are shown before the result. On a $0 run the
  `fake` caveat says the practice Muse is the parser itself, so the two agree by construction.
- **By kind** (emails: understood, cells exact, preference, mean Jaccard; abstracts: understood, mean error) and the
  split both / only Muse / only the parser / neither, from `result` and `result.agreement`; the definitions are
  tooltips.
- **Per note:** the note as text (untrusted: never markup), the approved reading, and each reader's reading with a
  ✓/✗ plus words, the parts it has wrong struck through (`compare` cuts the reading's words at "; " and checks each
  part against the approved reading), the parts it lacks listed, and how it scored. The notes in `result.differences`
  are marked; filters by who understood or where they differ (disabled until the result is there).
- **A run that did not finish** says so: running (with progress), halted, failed (with the error), interrupted, or
  cut by its deadline (`result.complete: false`); there is no result then.
- **The launcher** (`#/ablation`) starts the generator's notes on the practice backend at no cost
  (`emails`/`abstracts` 0 to 200, not both 0, `seed`) and lists the ablations on record (`GET /api/runs`, those whose
  scenario is the ablation's). It never sends `backend: "real"` (the route answers 501; the coordinator starts a
  billed run from the CLI, then the page reads it by id) and it takes no free text: W3 notes that the route does not
  keep live input private. An ablation of live notes waits for W2's `source: "approved"`.
- **`docs/claims.md` has no ablation claim**, so the view states the numbers and the caveats and claims nothing.
- **Fixtures** (`ablation/fixtures`): `ablation.sample.json` is W3's hand-written approved sample with the Muse they
  *script* per note (recorded with their own test helpers, read through the real route): it shows the view with a
  difference and measures nothing. `ablation.generator.json` is the generator's 16 notes through `POST /api/ablation`
  on the fake backend (parser = Muse by construction). `ablation.running.json` is a real mid-run read (6 of 16);
  `ablation.interrupted.json` is the sample's log cut after three notes and read through the route; plus the error
  bodies and the runs listing.
- The API caller is shared with the intake page (`caller` in `intake/api.ts`, and the strict readers in
  `intake/strict.ts`).

## Director mode `#/director/<scene>`

A scene is a strict JSON script (`web/src/director/scenes/<scene id>.json`, one per scene of `docs/video-script.md`
except `s2-intake`, which is recorded live). `#/director` lists them with what each still needs. The frame is a
logical 1920×1080 box with no app chrome, scaled to the window (scale 1 at exactly 1920×1080).

- **Steps:** `seek`, `play`, `pause`, `speed`, `wait` (a time, or `until` an anchor), `camera` (fit a region, an actor
  or a subtree, with padding and easing), `highlight`, `tooltip` (the hover text an element carries, drawn next to
  it: it has no words of its own, so a scene never retypes the UI), `caption` (lower third or overlay statement),
  `lens` (open or close a call), `panel` (show or hide). Moments are anchors read from the log (`crash:N`, `recovered:N`,
  `call:NAME`, `end`, with an offset like `crash:2-3s`); actors are ids, `$root`, `$crashed:N`, `$heir:N`.
- **A take is a count of frames of 1/60 s**, not a wall clock: the take's clock is W4's fixed-step clock, so the same
  scene shows the same moment of the run on the same frame, on any machine. A pre-roll of 45 frames lets what animates
  by itself settle before frame 1.
- **The runs are not in the scenes.** The final pair is recorded after the scenes were written, so a scene names no
  run: `sources.json` (the coordinator fills it) or the address (`?swarm=&rival=`, `&run=`, `&ablation=`) gives them.
  `&real` (or `"real": true` in `sources.json`) declares that the runs were recorded with the real model.
- **The frame's note.** The video script wants "Replay of a real recorded run · real cost $X" on every replay. A log
  does not say which model wrote it, and a practice run prices its tokens like a real one (the $0 reference pair shows
  a cost of about $0.3 a side), so "real" appears only on a take that declares it, and only with a cost the server
  gave; otherwise it says "practice model, no cost". A declared-real take with no cost is flagged.
- **Captions** are checked by a test to be lines of `docs/video-script.md` (the claims come from `docs/claims.md`
  through the script). The arena's assumptions caption is never touched by a scene.
- **`window.__director`** is what a recorder reads: `ready`, `state`, `frame`, `frames`, `done`, `steps`, `position`,
  `warnings`, `problem`, `note`, `go()`, `restart()`. `&hold` waits for `go()`. `&hud` shows the take's clock.

First look in a browser (Oct 29, on the $0 pair, so every number is a practice number): all eight scenes load, run
their whole script and stop on their last frame; the title card, the helps and ablation scenes and the arena scenes
look right. Found on that look, fixed the same day: the replay note sat over the arena's assumptions caption (it now
takes the empty left of the arena's top bar: `.dir[data-stage="arena"] .dir__note`), and a highlight right after a
`lens open` raised a false "target not on the page" because React had not drawn the drawer yet (a ring now gets
`RING_GRACE_MS` = 500 ms, and still warns if its target is missing after that or when its time is up).

MP2 (commit e5a7fed; written while the machine was held for the paid blocks, so **not yet looked at in a browser**: the
slot for that is queued behind the second paid block):

1. the arena had the frame's height but its content ran about 60 px past it, so its timeline was cut: in a take the
   arena now has the frame's height and its boards shrink to fit (`.dir__stage--fit .arena`, a one-row grid, `min-height: 0`);
2. the camera is kept inside the stage (`within`, camera.ts; the stage's size is the camera element's layout size), so a
   fit near an edge shows no black; a view larger than the stage is centred;
3. the `tree` region is the nodes, not the panel, so a camera on it fills the frame with the tree (s5's pad of 0.02 may
   need to grow if the tree re-lays out after an adoption: look at it on the final pair);
4. on the run page the note covered the **verify badge** at the right end of the strip, not only a few pixels of the
   takeover chip as first thought: the run stage now starts under a 36 px band that holds the note;
5. the `tooltip` step, used by s8 on both proof chips (`swarm-proof`, `rival-proof`); the coordinator's answer to the
   question about the hover was yes, with exactly the title words, which is why the words are read off the page.
6. a verdict chip has no hover text until its check has come back, and on a long log that is not at once: the page does
   not start a take whose tooltips point at a chip that says nothing yet. It waits for the text, up to 30 s after
   everything else is ready (`TIP_WAIT_POLLS`), and then starts anyway: the take warns "has no hover text" and the
   recorder flags it in the sidecar.

Rule from the coordinator (Oct 29): `real` is flipped to `true` in `sources.json` in the same commit that points
it at the final real pair, when the run ids are handed over; never before, and never by hand in a take.

Every scene's timings, `crash:N` indexes and call picks are first drafts, to be tuned on the final pair.

### The recorder `scripts/record_scenes.mjs`

Node and `playwright-core@1.48.2` (the build that matches Playwright's `chromium-1140` here), installed in a scratch
directory outside the repo (`RECORD_TOOLS`, default `%LOCALAPPDATA%\fractalswarm-record`). **Frames mode** (default):
a shim (`record_scenes.shim.js`) replaces `requestAnimationFrame` and `performance.now` and holds the CSS animations,
so the recorder grants the page one frame of 1/60 s, screenshots it, and goes on: the clip has exactly the frames the
scene says, however slowly the machine draws them. Output: a PNG sequence per scene in `video/clips/` (gitignored),
a sidecar JSON with the take's flags, and an mp4 only if ffmpeg is on the machine (`FFMPEG` or the path); without it
the exact command is printed. **Video mode** records in real time (Playwright's `recordVideo`, a webm at 25 fps) for a
quick look at the choreography. `--dry` runs the frames without screenshots; `--from/--to/--every` record a window or
a sample; `--real` declares the runs real. A take with a page error, a scene warning or a script longer than its scene
is flagged and, with `--strict`, fails. Measured on this machine: 1920 frames of an arena scene take about 20 s
without screenshots.

### Tuning the scenes on the final pair (what I do when the coordinator hands me its run ids)

1. In one commit: `web/src/director/sources.json` gets `swarm`, `rival`, `run` (the swarm's unless another) and, only for a
   real pair, `"real": true` (the coordinator's rule); `ablation` when W3's real ablation is on record.
2. A SLOT, the scratch server on 8791 with the fake LLM and a dummy key (it only replays; it never calls a model), and
   `node scripts/record_scenes.mjs all --every 60 --no-encode` (a frame a second of each scene, about 5 minutes).
3. Read each sidecar's `flags` first: a scene warning names the step (`step 7: the run has no "crash:2"` means the pair
   has one crash fewer than the scene assumes), a script shorter or longer than its scene says the waits no longer fit.
   Then look at the frames: s1 (the first crash on both sides at the same second, nothing covering the assumptions
   caption), s5 (`$crashed:N` and `$heir:N` are the coordinators of the real pair, the camera on the tree), s6 (the
   rival's caption always on, the counters moving), s8 (the tooltip's words are the chip's, the badge is not covered).
4. What is tuned lives in the scene JSON only: `crash:N` indexes, the `-Ns` offsets around them, the `wait` lengths, the
   `calls` picks of s4 (`model`, `purpose`, `role`), the camera paddings. The code does not change for a pair; if it
   has to, that is a bug in the director, and it gets a test.
5. A real pair has its root dying first, a practice pair may not: the arena's `root` tag follows the heirs (W4's
   `rootHolder` once merged; my `rootOf` meanwhile), so `$root` after a takeover is the heir, not o0.
6. Every scene must last the seconds the video script gives it (a test pins them); a retime of the script is a change of
   `duration_ms` and of the waits together.

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
- W2's intake API (api/jobs.py, api/spend.py, intake/service.py): `GET /api/capabilities` `{tasks, chaos, approve,
  budget, halt, real}`; `GET /api/intake/sample?seed=1`; `POST /api/intake` (202 `{intake_id, job_id, state, private,
  billed, warnings}`); `GET /api/intake/{id}` (`state` reading | proposed | approved | refused | failed |
  interrupted, `texts`, `proposal`, `scans`, `refused`, `failed`, `approved`); `POST /api/intake/{id}/approve` `{proposal}`
  (422 when it still has errors, 409 when already approved); `POST /api/tasks` and `POST /api/arena` (bodies above);
  the three `…/preflight` routes share one body (`ok, token, expires_in_s, confirm_word, kind, runs, calls_per_run,
  estimate_usd_per_run, run_cap_usd, worst_case_usd, standing, refusals`). Every POST must be JSON (415 otherwise).
- W3's ablation API: see the notes `arena-meta.md` ("Endpoint shapes (for W5)"); I read only the fields I show.
- The Vite dev proxy in `web/vite.config.ts` is hardcoded to `127.0.0.1:8765`. For a second stack I used an
  untracked scratch config (not committed). An env override in `vite.config.ts` would be a one-line change for W4.

## Collisions found and resolved

W4's `styles.css` is global and already has `.chip` (a pill button), `.cell` (a schedule grid cell) and `.mark`
(a timeline tick); `lens.css` has `.source` and `.run*`; `styles.css` has `.grid` and `.run*`. My board chips are
`coord`, the panel's cells `rcell` and its shapes `locality`; the intake page's source pane is `srcpane*`, its
availability grid `avail*`, its run panel `runit*`; the ablation's classes are all `abl*`. The arena timeline reuses
W4's `.mark`, `.btn`, `.speeds`, `.badge`, `.empty` and `.stat` on purpose. `assumptions.ts` gained an exported
`systemName(system)`. A script over the CSS checks every class of the intake and ablation pages against the others.

## Open items

1. W4's `rootHolder` (lib/reducer.ts) counts `board` and `net` as root holders and ignores the `root` key of an
   `ownership.remapped`; the lens and tree may show the wrong root after a takeover. Not touched (not my file).
2. The "Talks placed" meter on a board stays at 0 until the final integration, so it only moves at the very end.
   It could count contracts completed instead; I left it until the video needs it.
3. **W4's `components/NewTaskForm.tsx` posts the bare TaskSpec to `/api/tasks`**, but W2's `TaskRequest` needs
   `{spec: {...}, scenario, chaos, clock, backend, …}` with `extra="forbid"`, so its "Submit for planning" gets a 422.
   Not touched (not my file); the intake page posts the right shape.
4. W1's per-rival keys (`tally_by_rival`, `locality_by_rival`) arrived with the arena merge `7e64957`: the panel shows
   a column per rival (screenshot `helps.png`) and its tests pass on the merged `bench/results/honesty.json`.
5. **Seen in a browser at MP1 (Oct 29), on the scratch server with the key neutralised:** the arena at three points,
   the panel, the intake page from the sample text to the approved reading to "Start the arena pair" (the pair ran and
   opened in the arena), and the ablation (it started its own fake run). No console error, page error or HTTP error in
   any of them. Two things found and fixed on the way: a long run id (a launched pair's) wrapped the title of a side
   and misaligned the two boards (the title stays on one line and the id is truncated, with the full id on hover);
   and, in the director, the run stage waited for a tree node that does not exist at the start of a run.
   Known and left: a hash change to the same pair with a new `?t=` is not a load, so the seek applies only when the
   pair opens (as the page comment says); at 1080 the arena page scrolls inside the content area by about 230 px (the
   timeline is below the fold), which the director works around with a camera.
5b. The practice pair's cost is not zero (about $0.3 a side): the practice model prices its tokens like the real one.
   Anything that says "real cost" must come from a declaration, not from a cost above zero (see the director's note).
6. After approval the server returns Muse's proposal, not the approved one. A reopened page shows Muse's rows plus the
   edits list. An endpoint (or the approved proposal in `GET /api/intake/{id}`) would let it show what was approved.
7. The status note under each claim in the panel ("Status in docs/claims.md: …") is my addition; it can come out.
8. The static `GET /api/ablation` caveat labels (Generated notes / The reference / Practice backend) are mine; the
   text next to them is the server's.
9. **ffmpeg is not on this machine** and installing it waits for Yoel's OK (coordinator, Oct 29). The recorder keeps the
   PNG sequences (`video/clips/<scene>/f00001.png`, 60 fps) and prints the exact mp4 command; Playwright's bundled
   ffmpeg is VP8-only, so it does not help.
10. `docs/video-script.md` s8 mentions hovering a takeover chip ("the heir of each, recomputed from the log, is the one
    the run used"). That text is a native `title`, which a headless screenshot does not draw: the director's `tooltip`
    step draws it (answered yes by the coordinator).
11. The recorder is a browser: every run of it needs a SLOT (the MP1 GO covered one browser, and I used it for the
    screenshots and for a sparse sample of every scene). A full recording of all eight scenes is about 5 minutes of
    one browser. The final pair comes after the handler freeze, which may be the night of Oct 29, not Nov 2.
12. The server refuses `backend: real` without an approval gate, and I additionally ran my scratch server with a dummy
    `MODEL_API_KEY` and an empty `HF_TOKEN`; no real call was possible from any of my runs.
13. W4 told me (Oct 29) that the live "Coordinator-dependency time" is the outage length and not the scored `cdt_s`, and the
    live "Duplicated work" undercounts `dup_calls`; it is porting W1's definitions into the fold (parity test on four real
    logs, `web/src/lib/arena.parity.test.ts`). The coordinator's answer: no liveNotes for those two rows; after W4's merge,
    check my rows (`arena/rows.ts`) against the port, so the live rows equal the scored ones. Also: the live idle
    agent-seconds no longer counts an agent a crash stopped (a worker `killed` with reason `crash`).

## Tests

`npm --prefix web test` runs vitest in node: the pure modules, and the components drawn on the server
(`renderToStaticMarkup`). The panel's tests run over the bench's own `honesty.json`; the recovery tests over real
`check_run` output; the intake tests over real W2 bodies; the ablation tests over real W3 bodies. At MP2 the director's tests are 188 in 9 files, green on one worker (the rest of the web suite is untouched since MP1:
776); the whole suite is rerun at the MP2 slot. `tsc --noEmit` clean. Mutation-checked, each reverted: the panel (flipping a
claim's placeholder, hiding the loss counts, dropping the row model, toning down the per-process loss); the intake
page (20 mutants: a billed launch without the gate, a wrong or lower-case word, a stale or expired token, the approval
not blocked, frozen inputs editable, a wrong provenance, browser storage, a sentence marked that is not in the text,
…); the ablation view (17 mutants: a swapped headline, caveats hidden or not filtered, a flipped mark, the split read
wrong, a lacking part not said, the real backend sent, a note as markup, …). Every one was caught.
The director (54 mutants, vitest only: the waits and their timeouts, the moments and their offsets, which actor a scene
means, the camera's maths and its clamp, the overlay's fades, the take's frames and warnings, the driver's phases, the
note and the sources, the targets, the drawn tooltip): a first, interrupted pass found a padding test that only
covered the limiting side (the width of a wide rectangle and the height of a tall one are pinned now); the full pass
caught 53 of the 54, and the survivor, a seek past the end of the run, is now a test. Every mutant is caught.
