# W4 ui-core: notes

Branch `Yoelcanarion/arena-ui-core`. Web only: no Python was touched.

## Status

| Step | State |
|---|---|
| 1 Tokens and theme | done |
| 2 Fonts and icons, offline | done (bundle not yet checked for network use: needs a build slot) |
| 3 Store factory, shared clock, fixed step | done |
| 4 Reducer additions | done, checked against `takeover.analyze` on 3 real runs |
| 5 Motion | done; frame times measured, relative numbers only, the 60 fps budget is not met (see Frame times) |
| 6 Controls state | done |
| 7 Shared components | done: `Stat`, `ModelBadge`, `Card`, `Skeleton`, `Tooltip`, `ThemeToggle` |
| 8 Proof surfaces | done: timeline marks, replay badge, takeover chip (against `GET api/runs/{id}/takeover`, 404 fallback) |
| 9 Muse lens | done: drawer, Muse meter, fixtures from two recorded runs (W3's API is merged) |
| Build, screenshots, checks | done (see Checks and Screenshots) |
| Frame times, absolute | pending a quiet window |

## For W5: what to build on

### Tokens (`web/src/styles/tokens.css`)
The only file with hex literals (`tokens.test.ts` fails on a hex anywhere else). Dark is the default;
light is `:root[data-theme="light"]` and nothing follows `prefers-color-scheme`. `?theme=light` forces
it, and `lib/theme.ts` has `setTheme`, `useTheme`.

- Surfaces and text: `--bg`, `--surface-1..3`, `--border`, `--border-strong`, `--text-primary|secondary|muted|inverse`.
- Status families, each with `-text`, `-ink`, `-bg`, `-bg-strong`, `-border`: `--ok`, `--warn`, `--danger` (+ `--danger-solid*`), and `--accent`.
- Ownership (adjacent pairs pass CVD, the first four pass all-pairs): `--own-1..10`, `--own-root`.
- Models (all-pairs): `--model-wonder|spark|contributor|guard`.
- Scales: `--fs-*`, `--space-1..7`, `--radius-1..4|pill`, `--z-*`, `--dur-fast|base|slow`, `--ease-standard`, shadows `--shadow-ring|ring-hover|raised|overlay`.
- Text never wears a series colour: use the `-text` tokens, and put the series colour on a mark beside it.

### Stores and the clock
```ts
const store = createRunStore();            // vanilla zustand store; Folder and tail are inside it
const clock = createClock({ mode: "realtime" | "fixed", speed: 4 });
clock.attach(storeA); clock.attach(storeB);  // one rAF loop, one virtual time, any number of stores
```
- `RunStoreProvider store={...}` + `useRunStore(selector)`, `useRunStoreShallow(selector)` for objects, `useRunStoreApi()` for actions.
- `useRun` is still the default store, so the old pages are unchanged.
- Fixed-step mode advances `speed × 1000/60` ms per frame with no real frame time, so a take repeats exactly. `clock.step(n)` advances n frames by hand (tests, director mode).
- Store writes happen on a cursor change, otherwise at most every 50 ms of real time. Anything smoother than that must not go through React: `useClockFrame((t) => ...)` (lib/clockHooks.ts) runs after every frame with the exact virtual time `t` in ms and after every render, and writes to the DOM through a ref.
- The idle-gap skip is on the union of the next events of all attached stores, so two runs stay in step.

### The `--now` convention (CSS driven by virtual time)
`TreeGraph` writes `--now` (virtual ms) on its wrapper every frame. An element that fades sets
`--born` and `--life` (`glowVars(born, life)` in lib/decay.ts) and styles.css derives `--glow` (1 at
birth, 0 after the life). The restart ring uses `--since`/`--dur` (`ringVars`). Lifetimes live in
lib/decay.ts only: `MESSAGE_LIFE_MS = 1200`, `ADOPTION_LIFE_MS = 4000`. An animated property must not
also be in a CSS `transition` (it would ease on top of the per-frame value).

### Shared components (`components/ui`, `import { Stat, ... } from "../components/ui"`)
- `Stat { label, value, decimals?, prefix?, unit?, tone?, delta?, hero?, animate?, durationMs?, hint? }`.
  A number counts to a new value in the DOM (no React render per frame). `animate={false}` snaps; use it for live readouts and for fixed-step takes, because the count-up runs on real time. It also snaps under `prefers-reduced-motion` and on the first paint.
- `ModelBadge { model, version? }` takes an id (`muse-spark-1.3-contributor`) or a family; `modelFamily(id)` is exported.
- `Card { title?, hint?, actions?, tone?, flush?, interactive?, as? }`.
- `Skeleton`, `SkeletonText`, `SkeletonGroup` (one `role="status"` message for the group).
- `Tooltip { label, placement?, focusable? }`: hover and focus, Escape closes it, the pointer may move onto it. Use `focusable` on a disabled control so a keyboard user can still read why.
- Styles for all of them are in `styles/ui.css`, which W5 can leave alone. Put arena CSS in a new file.

## What the reducer now reads

`ViewState` gained `supervision`, `arena`, and per actor `outage`, `restartedTs`, `adoptedTs`, `statusTs`, `stopReason`. `ActorStatus` gained `"restarting"`.
Nothing here adds a field to an event payload; every read is tolerant of a missing or renamed key.

| Event | Read | Effect |
|---|---|---|
| `baseline.crashed` | `coordinator`, `crash`, `dispatched`, `lost[]`, `restart_in_ms` | node `restarting` with `outage`; a crash record; opens a down-time window (the chaos kill that caused it already opened it, so it is not counted twice) |
| `baseline.restarted` | `coordinator`, `crash`, `redo[]` | node `alive`, `restartedTs`; closes the window; `redo` is what was redone |
| `supervisor.adopted` (W1) | `results`, `verdicts`, `plans`, `bookings`, `waiting` as a number, a list or a map | the crash record's `adopted` counts |
| `goal.opened` (W1) | `goal_id`, `owner`, `parent`, `level`, `goal` | `view.supervision.goals` |
| `collision.detected` with `kind: "semantic"` (W3) | `key` (or `fact_key`, `dispute_id`), `holders` | a collision row with the disputed `key` |
| `arbitration.requested` / `.ruled` (W3) | `key`; `winner` (or `value`, `ruling`), `reason` (or `rationale`), `confidence`, `evidence` (or `evidence_ids`, `sources`) | `view.panels.collisions.arbitrations` |

The W1 and W3 shapes are the ones in their briefs. If they change, tell me and I adjust the readers.

### Arena counters (`arenaCounters(view, nowMs)`)
Display values, as a pure fold. The official numbers are Python's (`/api/runs/{id}/metrics`).

| Counter | Definition |
|---|---|
| `coordinatorCrashes` | one per `kill_coordinator` fault, or per `baseline.crashed` that no fault explains |
| `coordinatorDownMs` | per crash a window: a supervisor's crash → restart; the swarm's kill → last `ownership.remapped`/`tree.adopted`/`member.dead` for the victim. An open window grows with `nowMs` |
| `idleAgentMs`, `idleAgentsNow` | agents that are alive (or stopped by the crash and waiting for the restart), have no LLM call in flight, and answer to a coordinator that is killed or restarting. A member the detector declared dead with no kill (a false death) does not count. Approximates "idle agent-seconds", which also needs a blocked contract |
| `redispatches` | `contract.dispatched` of work rejected as `lost`, or of an `idem_key` sent before |
| `duplicatedCalls` | LLM calls cancelled and then redone (same request again, or the agent's contract dispatched again), plus completed calls whose request was already paid for |
| `costUsd`, `hardViolations` | `budget.settled` summed; the schedule check once it lands |

**Check against Python (`verify/takeover.py::analyze` on copies of three recorded runs):** equal on every run.

| Run | crashes | duplicated calls | contracts dispatched again |
|---|---|---|---|
| `t2-real-c3-central-seed1` | 5 / 5 | 27 / 27 (5 by request + 22 by contract) | 22 / 22 |
| `tmp-pipeline-c3` | 5 / 5 | 5 / 5 | 5 / 5 |
| `t2-real-c3-swarm-seed1b` | 5 / 5 | 3 / 3 | 2 / 2 |

`arena.real.test.ts` keeps these numbers and skips itself where the runs are not on disk. The parity test against W1's metrics waits for W1's fixture.

## Deviations
- Statuses: `"restarting"` is a new `ActorStatus`; `Counters` shows "down" (killed, dead or restarting) instead of "killed / dead".
- Idle agents: see the table. The first version counted every leaf under a `dead` or `killed` parent forever (13 agents gave 834 k agent-ms in a run with 31 s of outages); it now counts only the ones really waiting.
- Count-up runs on real time. It is off (`animate={false}`) in the live counters.

## Open questions
- Answered (Oct 29): the takeover chip reads `GET api/runs/{id}/takeover`, which W2 adds (at least `ok` and `violations`).
  It is built against that, with a 404 fallback. **W2: please send the whole `TakeoverReport` if you can** (`successions`,
  `adoptions`, `kills`): the chip then says how many hand-overs it recomputed an heir for. With only `ok` and `violations` it still
  works, deciding "No takeover to check" from the log.

## Status when the usage limit hit (Oct 29, 01:47 CET)

Commits on `Yoelcanarion/arena-ui-core`: `c292602` (steps 1-4 and 7; merge_ready sent), `fd9b341`
(steps 5 and 6), `bf09899` (step 8, timeline). At `bf09899`: typecheck clean, vitest 19 files / 266 tests.
Not run since `fd9b341`, because they need a SLOT: web build, `uv run pytest`, ruff, `tests/integration/test_api.py`,
`fractalswarm demo --verify`.

### Done since the first merge
- **Step 5, motion.** Tree glide in JS (`lib/glide.ts`, `components/useTreeMotion.ts`), camera fit only when the
  structure changes, grid cells animate only on a new placement, charts animate on first draw only, reduced motion.
  Dev frame logger: open the app with `?frames` on a dev server (or a scratch build with `VITE_FRAME_LOG=1`) and
  read `window.__frames.report()`. The numbers are under Frame times, at the end.
- **Step 6, controls.** `lib/controls.ts`, `components/ControlButton.tsx` (`useControlState`), `StatusBadge`.
  The store has `runStatus` (from the catalog), `capabilities` and a 5 s status poll while a run is live.
  A crashed run (catalog `interrupted`) opens as a recording and is no longer tailed.
- **Step 8, partly.** Timeline marks (`lib/timeline.ts`: coordinator kill tall and red, agent kill, crash, restart,
  adoption, verdicts, collisions, halt), each mark jumps to its moment; the playhead is a 6x24 px thumb.
  `VerifyBadge` already goes pending -> "Replay verified ✓ hash match <12-char head>"; no change was needed.

### Not done
Nothing of steps 1-9. What waits for a slot or a merge is under "Still to do" at the end.

### Open asks for the coordinator (W2 / W3)
1. `GET api/capabilities` -> `{tasks, chaos, approve, budget, halt}` booleans. Without it (404) the UI offers budget
   and halt on live runs and keeps chaos, approve and new task off with a tooltip.
2. Catalog `status` values `running | completed | halted | interrupted | empty`, as in backend-design.
3. A takeover endpoint for the chip, for example `GET api/runs/{id}/takeover` -> `{ok, violations}`.
4. The shape of W3's lens endpoint, and W1/W3 fixtures.

### For W5
`ControlButton` / `useControlState`, `StatusBadge`, store fields `runStatus`, `capabilities` and `epoch` (counts jumps),
`clock.motion()` (animation time, deterministic in fixed-step mode), `ClockScope` (`--now` for CSS decay),
`lib/chartMotion.ts`, `marksOf` in `lib/timeline.ts`.

## Steps 8 and 9, finished (Oct 29)

Final state: web typecheck clean, vitest 25 files / 373 tests. No Python was touched. The checks, screenshots and frame
times are at the end of this file.

### The Muse lens (step 9)
**Where it lives.** `lib/lens.ts` (types, tolerant readers, the meter fold, the readable form of an answer),
`lensStore.ts` (one lens per run store, so W5's two arena stores get one each), `components/lens/` (`LensDock`,
`CallList`, `CallView`, `Output`, `MuseMeter`, `LensButton`), `styles/lens.css` (tokens only).

**How a person opens it.** Click a node of the tree (that actor's calls, at the call it had reached on the playhead),
click the Muse meter (every call of the run), or the sparkle button on an `effect.*` row of the event feed or list (that
call). Esc or the X closes it. A second click on the same node closes it. Nodes are buttons: Tab, Enter and Space work.

**It follows the playhead.** The drawer is `position:absolute` inside `.run`, above the timeline, so the scrubber stays
in reach. A call that has started but not ended shows what the model was given and "Waiting for the model", never its
answer; a call that has not started shows only when it starts. Scrubbing back therefore shows a call in flight and then
not started.

**What one call shows.** Model badge, effort, purpose and where it sits in the plan; input, cached, reasoning and output
tokens, cost with its breakdown, latency; notices (cancelled and billed the estimate, refused, reissued, incomplete); the
answer in the shape of the call:
- facts next to the source sentence each came from, with the evidence highlighted and its field named (offsets are UTF-16
  and checked against the text);
- plan tracks and contracts, placements, a judge's verdict with its reasons, workspace writes, memory searches;
- "In the model's own words" for the sentences the model wrote;
- then, folded, the prompt it was given, the raw answer, and the events its answer caused.

Text that came from outside (abstracts, emails, a model's own output) is rendered as text, never as markup, and the
input blocks that came from outside are labelled untrusted. A test feeds a source with `<script>` and `<img onerror>`.

**The Muse meter.** Dollars and tokens per model, "N% of input tokens served from cache", "coordination tokens N ·
recovery tokens N" (a green check at zero, a warning otherwise; computed from the calls, never asserted), and "N calls
lost · $X" when a baseline lost calls to crashes. Before the end of the run it is folded from the calls that had ended by
the playhead (`foldMeter`); at the end it is the server's own `/models`. `lens.test.ts` checks that the fold equals the
server on both fixtures, so the meter does not jump at the last event. On a server without the lens routes (404) the
meter and the drawer stay out of the way.

**Fixtures.** `lib/fixtures/lens-demo-backup.json` (79 calls: Wonder plan, Spark plans, extract, place, judge, blurb;
$0.4948; 60.6% of input tokens cached; coordination and recovery tokens 0) and `lens-central-c3.json` (103 calls, 27
cancelled by coordinator crashes and chaos, $0.1458 lost). They hold the verbatim `/calls` and `/models` responses and a
trimmed set of `/calls/{effect_id}`, captured with starlette's TestClient on the recorded runs. Nothing secret or
personal is in them (speakers and emails are the synthetic `example.org` ones).

**API read.** `GET api/runs/{id}/calls`, `/calls/{effect_id}`, `/models`, as in `arena-meta.md`. A 404, or a body with no
`calls` list, means "no lens here".

### Proof surfaces (step 8)
- **Run strip** under the top bar (`components/RunStrip.tsx`): the Muse meter on the left, the takeover chip and the
  replay badge on the right. The 60 px top bar has no room for the meter at 1920 px.
- **Takeover chip** (`lib/takeover.ts`, `components/TakeoverChip.tsx`; store field `takeover`, action `runTakeover`):
  - needs a boolean `ok`; reads `violations`, and counts `successions`, `adoptions` and `kills` when they are lists. A
    succession of kind `takeover` is an heir; one of kind `reclaim` (`owner == previous`: a member back from a false death
    took its own goal back) is counted apart, because the check compares no heir for it (`verify/takeover.py`);
  - "Takeover OK ✓ N hand-overs" when an heir was recomputed for each and none differs from the one the run used (the
    coordinator chose "hand-overs" over "heirs": 7 hand-overs beside 5 kills reads true, 7 heirs does not). The hover
    says "N hand-overs: the heir of each, recomputed from the log, is the one the run used", then names the reclaims
    ("1 reclaim: a member back from a false death took its own goal back (no heir is compared)") and the adoptions;
  - "No takeover to check" when no goal changed hands: the report counts zero, or, when the report does not count, the
  log has no `ownership.remapped` and no `tree.adopted` (the two events the check starts from). The real swarm run
    with chaos has 12 and 12 (11 takeovers and 1 reclaim); the central baseline has none, and `takeover.real.test.ts`
    keeps both. A run with only a reclaim says "No goal was taken over", not "No goal changed hands";
  - "Takeover check failed: N violations", with the first ones on hover;
  - nothing on 404, 405, 409 (the run has not completed) or 501; "Takeover check unavailable" on any other error;
    nothing while a run is recording.

### Checks (Oct 29, under the slot)
| Check | Result |
|---|---|
| web typecheck (`tsc --noEmit`) | clean |
| `vitest run` | 25 files, 373 tests, all pass |
| web build into `src/fractalswarm/api/static/` | ok; the stale hashed assets are gone (`index-DB44qtFJ.js`, `index-sTYETGc2.css` deleted; `index-8U4ZH3Bx.js` and `index-BjrwZHkT.css` added); no external URL in the html, css or js (fonts are bundled) |
| `tests/integration/test_api.py` | 29 passed, also against the final build |
| merge check `uv run pytest -m 'not promptguard' -q` | 1271 passed, 3 deselected, 13 min 48 s, on the tree before the last web edits (they touch no Python; `test_api` re-ran after them) |
| `uv run ruff check` | all checks passed |
| `demo --verify --no-serve --no-browser` | `MATCH backup: 8177 events` |

After the takeover chip fix and the hand-overs wording (second slot, Oct 29, 14:28-14:30 CET, foreground, no browser, no
server):

| Check | Result |
|---|---|
| web typecheck | clean |
| `vitest run` | 25 files, 378 tests, all pass (373 before, plus 5 takeover tests) |
| `npm --prefix web run build` | ok in 3.3 s: `index-D1vVofcs.js` replaces `index-8U4ZH3Bx.js`, the css is unchanged (`index-BjrwZHkT.css`), `index.html` points at the new script; `favicon.svg` restored; no absolute resource load (only the SVG namespace and documentation links inside library strings) |
| `tests/integration/test_api.py` and `test_guard.py` | 36 + 50 = 86 passed, against the rebuilt bundle (scratch `FRACTALSWARM_*` paths) |
| `ruff check` | all checks passed (no Python touched) |

Not re-run: the full pytest and `demo --verify` (no Python and no recorded run changed since the runs above).

Not run: the `$0` reference comparison (no Python was touched), the `PromptGuard` tests (deselected by the merge check).

### Screenshots (Playwright Chromium 130, headless, exactly 1920x1080, read-only server on scratch dirs)
Folder: `C:\Users\yogar\AppData\Local\Temp\claude\C--Users-yogar-orca-workspaces-work-orquestrator-arena-ui-core\9bbeb686-ccdc-4c1b-8133-12229dcad625\scratchpad\shots\`
(`report.json` there has the layout numbers). Not in git. **Do not publish the ones marked MISMATCH**: the badge is the
server's verdict on a Phase 1 recording (known and accepted, see below), not something the web code does.

| File | What it shows | Badge |
|---|---|---|
| `before-swarm-end.png`, `after-swarm-end.png` | `t2-real-c3-swarm-seed1b` at the end, Phase 1 UI and now | MISMATCH |
| `before-demo-end.png`, `after-demo-end.png` | `demo-backup` at the end, Phase 1 UI and now (run strip: Muse meter, replay badge) | MATCH |
| `after-lens-facts.png` | `demo-backup`: one extraction call, each fact next to the source sentence it came from, evidence highlighted | MATCH |
| `after-lens-facts-light.png` | the same in the light theme | MATCH |
| `after-lens-actor.png` | swarm run: a node opened in the lens at its last call (a blurb, read as text in a quotation) | MISMATCH |
| `after-swarm-mid.png` | swarm run at 57.6 s: a call in flight shows "Waiting for the model", no answer yet | MISMATCH |
| `after-lens-cancelled.png` | central baseline: a call killed by chaos, billed the estimate, "27 calls lost · $0.1458" | MISMATCH |

Layout, from `report.json`: the drawer ends at y=990 and the timeline starts at y=1000, so the scrubber is never covered;
no horizontal scroll at any scene; no page error. The only console noise is the two 404s of endpoints that reach arena
with W2's next merge (`/api/capabilities`, `/api/runs/{id}/takeover`): the fallbacks work, so **the takeover chip is not in
any screenshot yet** (it shows nothing on a 404). It is to be shot against the real endpoint after that merge.

### Found while checking
- **The chip counted a reclaim as an heir (found against the real `/takeover` code on Oct 29, fixed in source).**
  The merged chip said "12 heirs recomputed from the log, none different from the one the run used" for the swarm run.
  `verify/takeover.py` reports 12 successions there, 11 of kind `takeover` and 1 of kind `reclaim` (seq 11191: `o0 -> o0`
  on the root goal, recomputed heir `o1`, `ok`); the heir comparison runs for takeovers only, so the sentence was false
  for that one. The chip now counts 11 hand-overs and names the reclaim apart (`readTakeover` splits on `kind`;
  `takeover.test.ts` and `takeover.real.test.ts` cover it). I ran `check_run` on copies of the logs (scratch dir, nothing
  under `~/.fractalswarm/runs` was opened): `t2-real-c3-swarm-seed1b` ok, 0 violations, 11 kills, 12 successions (11
  takeover + 1 reclaim), 12 adoptions, so the chip reads "Takeover OK ✓ 11 hand-overs"; `t2-real-c3-central-seed1` ok, 11
  kills, 0 successions, 0 adoptions, so "No takeover to check (11 kills)"; `t2-real-killhalf-seed1` and `demo/backup`
  (the same log, 8177 events) ok, 5 kills, 7 successions (all takeover), 7 adoptions, so "Takeover OK ✓ 7 hand-overs".
  The static build was rebuilt after the fix (second slot). The label first said "N heirs", which counts goals handed
  over and not distinct heirs (7 for 5 coordinator kills, because a coordinator can hold two goals); the coordinator
  chose "N hand-overs", and the hover text says what was checked.
- **Against the API guard (`api/guard.py`).** A refused POST answers `{"error": ...}` (not `detail`); `api.ts` reads both,
  so the server's reason shows. `real` in `/api/capabilities` is a boolean, as the types assume. The only POSTs in
  `web/src` are `verifyRun` and `postControl`, both JSON; any new POST (W5's launch and intake) must send
  `Content-Type: application/json` or use `postControl`. The Vite dev proxy keeps the browser's Host and Origin, so a
  WebSocket from `localhost:5173` passes the guard's same-origin check.
- **The API does not say which code version recorded a run**, only `recorded_head` (the hash-chain head). So the badge
  does not say "recorded by an older code version"; `demo/backup/evidence/code.json` has the commit, but only for the
  bundle and not served. Not guessed in the UI.
- **Chromium 130 crashes its renderer on a container query.** The lens drawer used `container: lens / inline-size` and
  `@container lens (min-width: 620px)`. In Playwright 1.48's Chromium (130.0.6723.31, the browser the video is recorded
  with) opening the lens killed the tab ("Target crashed"). A bisect over six variants (reduced motion, no content
  visibility, no shadow, no animation, no overflow clip) showed only removing the container saves it. It is now
  `@media (min-width: 660px)` in `styles/lens.css`, with a comment. Do not use container queries in this app until the
  recording browser moves on.
- **"Replay MISMATCH" on the Phase 1 real runs.** `POST api/runs/{id}/verify` on `t2-real-c3-swarm-seed1b` (seq 9) and
  `t2-real-c3-central-seed1` (seq 18) fails at the first `firewall` effect: commit 8ac7536 made `T2Task.attachments()` scan
  `From:` as well, so the request differs. Known and accepted by the coordinator (those runs verify at 8fddeba; the
  headline runs and the demo bundle are recorded after the handler freeze). The Phase 1 UI shows the same badge. A later
  polish, only if the API exposes the recording's code version: say so next to the badge.
- **The meter and "Spent" differ on a baseline that lost calls**, on purpose: the per-model dollars include each cancelled
  call at its estimate, so they exceed "Spent" by the "calls lost" amount ($0.5590 + $0.0419 against $0.4552, and "27
  calls lost · $0.1458"). The strip shows that chip next to it.
- **The orchestrator tree is small at 1080p**: about 45 nodes fitted into an 800 px panel, node text near 5 px. Same in
  Phase 1; not changed. A bigger tree panel for the director's scenes would be the fix.

### Changes after the first screenshots
- A call cut off before it completed no longer shows "0 cached · 0%" and "reasoning 0": its tokens read "estimated" and
  the reasoning share "not known".
- A small flat answer (a blurb call answers `{"blurb": ..., "path": ...}`) is read as text with the blurb in a
  quotation, not as a JSON fold; the fields the model's own words already carry are not repeated.
- The list's filter bar sticks to the top edge with nothing showing above it, and the open row scrolls clear of it.
- `lib/api.ts`: every POST sends `Content-Type: application/json` and `{}` (W2's API guard answers 415 otherwise; `verifyRun`
  had none). `fetchTakeover` takes 409 (the run has not completed) as "show nothing", like 404, 405 and 501.
  `Capabilities` has an optional `real` (billed launches allowed and a key present), read when the server sends it.
  `lib/api.test.ts` covers these.
- The schedule grid's clock scope writes `--now` only while a ruling mark fades (see frame times).

### Frame times (`t2-real-c3-swarm-seed1b`, 14,047 events, 20x): **absolute numbers pending a quiet window**
Everything below was measured between about 13:15 and 13:40 CET. Yoel opened the UI at 13:13, so the machine was not quiet
(his browser, a second server, under 2 GB free). Read these as **relative** numbers; the absolute ones are to be taken
again when the coordinator says the machine is quiet.

Harness (not in git; `scratchpad\pw\compare.mjs`): Playwright Chromium 130, headless, 1920x1080, software rendering
(SwiftShader), a generic `requestAnimationFrame` logger injected into both builds, the browser's own CPU counters, the
builds taken in turns (A, B, C, A, B, C ...) so a busier or quieter machine hits all alike, one warm-up pass, three
counted passes. Medians:

| Build | fps | p95 frame | style recalc, % of wall time | script, % |
|---|---|---|---|---|
| Phase 1 UI (the "before" build) | 31.1 | 50 ms | 31 | 28 |
| Phase 2 UI, before the clock fix | 21.1 | 66.7 ms | 40 | 28 |
| same, the grid's `--now` writes switched off | 24.4 | 50.1 ms | 32 | 31 |
| same, the tree's `--now` writes switched off | 21.9 | 66.7 ms | 39 | 28 |
| same, all `--now` writes switched off | 25.5 | 66.6 ms | 32 | 31 |

An earlier, not interleaved run gave the same ordering: Phase 1 about 39 fps, Phase 2 26-29, Phase 2 with the lens open
20-23. The app's own `?frames` logger (a `VITE_FRAME_LOG=1` scratch build) read 20-22 fps in both variants. With GPU
compositing on (`--headless=new`, ANGLE D3D11) the numbers did not move (Phase 1 about 38, Phase 2 about 27, lens open
about 26): **the main thread is the limit** (it is busy 97-100% of the wall time in every run), not rasterisation.

A CPU profile of one pass (unminified scratch build): script is about 28% of the main thread and spread thin (React's work
loop 21% inclusive, the reducer `foldEvent` 3.3%, the clock loop 4%, React Flow's measuring about 3%); about 68% is native
work, style recalculation first. No single JS function is above 2%.

**Cause found:** the schedule grid's `ClockScope` wrote `--now`, an inherited custom property, on the grid every frame, which
restyled its 72 cells and everything in them: about 8 points of the 40% and about 3 fps. **Fix, in the final build:** the
grid's scope writes `--now` only while a ruling mark is fading, and once after the last one ends (`needsNow`, `rulingsEnd`;
tested). The tree's scope still writes every frame; switching it off changed nothing measurable. I first tried writing
`--now` only on the elements that fade, and dropped it: an element React creates while the clock is paused (after a seek)
would never get it and would stay fully lit, whereas an inherited value is always right.

**The fix itself is not measured yet** (the run that would have measured it was cut by the release request), and the
screenshots predate it. Expected: back to the "grid switched off" row, about 24 fps, still **below Phase 1 (31 fps in the same
harness) and far below the 60 fps of the brief**. So the budget is **not met**, and it was not met by the Phase 1 UI either.
Suspects not yet tested, with toggles ready in `compare.mjs` (`new-noanim`, `new-nofilter`, `new-noshadow`): the animated
edges (React Flow animates `stroke-dashoffset` on the main thread; at 20x they are lit almost all the time), the
`drop-shadow` filter on talking edges, the card shadows; and the extra DOM per frame of the run strip, the lens buttons and
the node buttons, which is the rest of the gap to Phase 1.

### Deviations (this part)
- `VerifyBadge` moved from the top bar into the run strip (same component, same behaviour).
- The chip says "No takeover to check" instead of "Takeover OK" for a run with no takeover: a pass with nothing to check
  would claim a proof the run never exercised.
- The tree nodes are now buttons (`role="button"`, `tabIndex=0`); React Flow's own node focus is off so there is one tab
  stop per node.
- The 60 fps budget of step 5 is not met (see above); reported, not hidden.

### Still to do (needs a slot or a later merge)
1. A quiet window: absolute frame times, the fix measured, the three CSS toggles tried; re-shoot the lens scenes on the
   final build, using `demo-backup` wherever a badge is visible. **The app verifies a completed run as soon as it opens
   it** (`App.tsx` calls `runVerify`), so every scene on a Phase 1 run shows MISMATCH in the run strip, clicked or not;
   leaving Verify alone does not avoid it. `demo-backup` has no cancelled LLM call (its 10 `effect.cancelled` are not
   model calls), so the "calls lost" scene exists only on the Phase 1 central run. Plan: the demo scenes as full frames
   (MATCH, with the new chip "Takeover OK ✓ 7 hand-overs"), the Phase 1 scenes as clips of the lens drawer, which leave the
   strip out. The scratch script `final.mjs` (not in git) enforces it: a shot whose region overlaps a MISMATCH badge goes
   to `internal/` and is marked `publishable: false`.
2. (done, second slot) The static bundle is rebuilt for the chip fix of Oct 29.
3. W2's merge is in arena (24995b5): the chip screenshot against the real endpoint (a server on scratch dirs; the demo
   bundle shows "Takeover OK ✓ 7 hand-overs" with MATCH), and a run of the Verify button against the guard. Both come
   with the quiet window, after the coordinator's combined merge.
