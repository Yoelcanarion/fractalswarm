# W4 ui-core: notes

Branch `Yoelcanarion/arena-ui-core`. Web only: no Python was touched.

## Status

| Step | State |
|---|---|
| 1 Tokens and theme | done |
| 2 Fonts and icons, offline | done (bundle not yet checked for network use: needs a build slot) |
| 3 Store factory, shared clock, fixed step | done |
| 4 Reducer additions | done, checked against `takeover.analyze` on 3 real runs and against W1's `bench/recovery.py` on 4 (see Arena counters) |
| 5 Motion | done; frame times measured, relative numbers only, the 60 fps budget is not met (see Frame times) |
| 6 Controls state | done |
| 7 Shared components | done: `Stat`, `ModelBadge`, `Card`, `Skeleton`, `Tooltip`, `ThemeToggle` |
| 8 Proof surfaces | done: timeline marks, replay badge, takeover chip (against `GET api/runs/{id}/takeover`, 404 fallback) |
| 9 Muse lens | done: drawer, Muse meter, fixtures from two recorded runs (W3's API is merged) |
| Build, screenshots, checks | done (see Checks and Screenshots) |
| Frame times, absolute | done in the quiet window of Oct 29 (19:23-19:27 CET): see Frame times; the 60 fps budget is not met |

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
Display values, as a pure fold. The official numbers are Python's (`/api/runs/{id}/metrics`). Two of the counters are ports of the
scored definitions (`lib/recovery.ts`, Oct 29 evening) and end on the scored number, to the millisecond; the others approximate, and
the table says which.

| Counter | Definition |
|---|---|
| `coordinatorCrashes` | one per `kill_coordinator` fault, or per `baseline.crashed` that no fault explains |
| `coordinatorDownMs` | per crash a window: a supervisor's crash → restart; the swarm's kill → last `ownership.remapped`/`tree.adopted`/`member.dead` for the victim. An open window grows with `nowMs` |
| `idleAgentMs`, `idleAgentsNow` | agents that are **alive**, have no LLM call in flight, and answer to a coordinator that is killed or restarting. An agent that a crash stopped is gone (the supervisor's restart respawns it and its work is redone), not idle: since Oct 29 evening it no longer counts, because `bench/recovery.py` scores the central and the pipeline baseline 0.0. A member the detector declared dead with no kill (a false death) does not count. Approximates "idle agent-seconds", which also needs the agent's session to have work waiting on the coordinator |
| `redispatches` | `contract.dispatched` of work rejected as `lost`, or of an `idem_key` sent before |
| `duplicatedCalls` | **the scored `dup_calls`** (`lib/recovery.ts`, a port of `_fates`): a call of an attempt that a later attempt of its contract replaced (once that one is verified), an own call (`plan\|`, `judge\|`, `scan\|`) asked again once the later one has completed, and a completed call whose request was already paid for. A failed call (`error`, `refused`) is never one |
| `dependencyMs` | **the scored coordinator-dependency time `cdt_s`** (a port of `_items`, `_outages`, `_Owners` and the run-level overlap): the contract-time that work spent waiting (dispatch, result, judge, booking, plan, a lost own call) while the coordinator that owned its goal was down. "So far" is the scored analysis of the log up to the playhead, so it moves when a wait *ends*, not while it goes on |
| `costUsd`, `hardViolations` | `budget.settled` summed; the schedule check once it lands |

**Superseded check (`verify/takeover.py::analyze`, the first version of the duplicated-calls counter):** the fold was equal to it on three
recorded runs (duplicated calls 27 / 5 / 3 for central, pipeline, swarm). That is an older and narrower definition than the one
`bench/recovery.py` scores (42 / 5 / 13), so the counter now follows the scored one (below). `arena.real.test.ts` keeps the headline
numbers of each run and skips itself where the runs are not on disk.

**Check against W1's scored metrics (`bench/recovery.py::analyze`, what `/api/runs/{id}/metrics` serves as `recovery`), on four
logs, `arena.parity.test.ts` with `lib/fixtures/recovery-official.json`.** The scoreboard shows the fold while a run plays and the
scored number once it ended, so where they differ a figure jumps at the last event:

| Counter | demo-backup (swarm, committed) | central | swarm-c3 | pipeline-c3 | Verdict |
|---|---|---|---|---|---|
| crashes | 5 / 5 | 5 / 5 | 5 / 5 | 5 / 5 | equal |
| outage windows (crash outages) | identical to the ms | identical | identical | identical | equal |
| contracts sent again / `lost_redispatches` | 0 / 0 | 22 / 22 | 2 / 2 | 5 / 5 | equal |
| idle agent-seconds / `idle_agent_s` | 14.08 / 9.44 | 0 / 0 | 26.56 / 26.56 | 0 / 0 | equal, except the demo, where the fold is above: the scored one also needs the session to have work waiting. (Before the fix of the evening it said 170.7 for central and 25.0 for pipeline: it counted the agents the crash stopped.) |
| duplicated calls / `dup_calls` | 11 / 11 | 42 / 42 | 13 / 13 | 5 / 5 | **equal** since the port (it was 0 / 27 / 3 / 5: the old fold had no notion of work redone after a rejected verdict or of an attempt a later one replaced) |
| `dependencyMs` / `cdt_s` (coordinator-dependency time) | 4.719 / 4.719 | 135.587 / 135.587 | 26.564 / 26.564 | 99.0 / 99.0 | **equal** since the port, to the millisecond |
| waits it is made of / `blocked_total_s` | 5.532 / 5.532 | 135.587 / 135.587 | 28.797 / 28.797 | 985.582 / 985.582 | equal |
| outage window (`coordinatorDownMs`) / `cdt_s` | 23.67 / 4.72 | 25.11 / 135.59 | 30.85 / 26.56 | 25.00 / 99.00 | **not the same quantity**, and the test says so: the window is the length of the outage, `cdt_s` is contract-seconds of waiting inside it. A row named "Coordinator-dependency time" must read `dependencyMs`; `coordinatorDownMs` is the outage length |
| every prefix of the log, 413 of them | equal | equal | equal | equal | `analyze()` run in Python on `events[:k]` (k at every 5 %, and just after each crash, restart, chaos fault, takeover and completed goal) against `recoveryAt` after the first k events; the fixture holds the Python numbers |

So: crashes, outage windows, re-dispatches, duplicated work and coordinator-dependency time are what the scoring says at every event
of the four logs; the one counter that still differs is the idle agent-seconds of the demo (above the scored figure, which needs the
session to have work waiting). W5's `rows.ts` can now feed the "Coordinator-dependency time" row from `counters.dependencyMs` instead of
`coordinatorDownMs` (their row is named for what it shows until they do).

Cost (`recoveryAt`, 14,047-event swarm log, 2,257 of them kept): the fold adds about 1 ms per 200 events (it keeps the few events the
figures read, as a persistent list); the first read after a change takes 7 ms, a repeat read 0.03-0.15 ms; folding 200 events and
reading the counters again takes 1.7 ms.

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

### Frame times (`t2-real-c3-swarm-seed1b`, 14,047 events, 20x)

**The quiet window of Oct 29, 19:23-19:27 CET (the numbers to quote).** Same harness as below (`pw/compare.mjs`, not in git):
Playwright Chromium 130, headless 1920x1080, software rendering (SwiftShader), a generic `requestAnimationFrame` logger, the seven
variants taken in turns, one warm-up pass, three counted rounds; nothing else of mine was running. Medians (per round in brackets);
style and script are % of wall time:

| Variant | fps | p95 frame | style | script |
|---|---|---|---|---|
| Phase 1 UI (`before`) | 44.3 (44.2 / 44.3 / 45.9) | 33.4 ms | 31 | 28 |
| Phase 2, before the clock fix (`old`) | 33.3 (31.7 / 33.3 / 34.1) | 50.0 ms | 40 | 27 |
| Phase 2, this build (`new`) | 37.3 (36.3 / 38.3 / 37.3) | 33.4 ms | 33 | 30 |
| `new` with `?lite=all` | 39.6 (37.3 / 39.6 / 40.5) | 33.4 ms | 31 | 32 |
| `new` with `?lite=anim` | 36.7 (36.4 / 36.7 / 38.3) | 33.4 ms | 33 | 30 |
| `new` with `?lite=filter` | 37.4 (37.4 / 36.6 / 39.6) | 33.4 ms | 33 | 30 |
| `new` with `?lite=shadow` | 40.5 (38.2 / 40.5 / 43.1) | 33.4 ms | 31 | 30 |

Reading: **the clock fix is real** (33.3 -> 37.3 fps; p95 50 -> 33.4 ms; frames over 34 ms in round 1: 21 of 220 -> 9 of 252).
**Of the three lite parts only `shadow` moves the number** (about +3 fps, up to 43 in round 3); `anim` and `filter` alone are inside
the round-to-round spread (about +/-1.5 fps). All three together are no better than `shadow` alone. **The 60 fps budget is not met**
(software rendering; the main thread is busy 96-100 % of the wall time in every variant), and the Phase 1 UI is still about 7 fps
faster than this build: the gap is the extra DOM per frame (run strip, lens buttons, node buttons) and the style recalculation it
causes. `lite_check.mjs` confirmed beforehand that each `?lite` part changes the computed style it names (`animation-name`
`dashdraw` -> `none`; `filter` `drop-shadow(...)` -> `none`; `box-shadow` of the 4 px ring -> `none`; all three together). Whether
`shadow` is worth the loss of the takeover rings is for the coordinator; nothing turns it on.

**The first measurement (Oct 29, 13:15-13:40 CET; superseded by the one above).** Yoel opened the UI at 13:13, so the machine was
not quiet (his browser, a second server, under 2 GB free). Those are **relative** numbers, kept for how they were found:

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

**The fix itself was measured in the window** (the table at the top): `old` 33.3 -> `new` 37.3 fps. The suspects (the animated
edges, the `drop-shadow` filter on talking edges, the card shadows) were tried as the product's `?lite` switch: only the shadows
matter. The rest of the gap to Phase 1 is the extra DOM per frame of the run strip, the lens buttons and the node buttons.

### Deviations (this part)
- `VerifyBadge` moved from the top bar into the run strip (same component, same behaviour).
- The chip says "No takeover to check" instead of "Takeover OK" for a run with no takeover: a pass with nothing to check
  would claim a proof the run never exercised.
- The tree nodes are now buttons (`role="button"`, `tabIndex=0`); React Flow's own node focus is off so there is one tab
  stop per node.
- The 60 fps budget of step 5 is not met (see above); reported, not hidden.

### Lite motion switch (in the bundle since the build of the Oct 29 evening window)
The coordinator asked for the three CSS toggles as one switch, so the quiet window needs one build. `lib/lite.ts` and
`styles/lite.css`: `?lite=all`, or `?lite=anim,filter,shadow`, in the query string or in the hash query, sets
`<html data-lite="...">`. It is off by default and changes nothing without the attribute. Parts:
- `anim`: the dashed-line animation of the lit edges (React Flow moves `stroke-dashoffset` on the main thread);
- `filter`: the `drop-shadow` glow of a talking edge (the edge keeps its colour and width);
- `shadow`: the `box-shadow` rings of the nodes and the colour easing of their state changes.

The rules out-rank the ones they switch off by specificity (no `!important`), and a page can flip the parts while it
runs by setting the attribute. `lite.test.ts` keeps the part list and the CSS in step (every part has a rule, every rule
is keyed on a part). **A trade, not a free win:** with `shadow` the adopted and restarted rings, the cue for a takeover,
are not drawn, and with `anim` the lit edges keep their dashes but stop moving. Whether any part is worth it, and
whether it should switch on by itself at a high speed, is for the measurements and the coordinator; nothing turns it on.
Measured in the window: only `shadow` moves the frame rate (about +3 fps); see Frame times.

### Since the resume (Oct 29 evening; arena merged into this branch at f0ee8bb, from afcf732)
No plan by days any more (Yoel): each item as soon as its inputs exist.

**Live control in the UI (518653e).** W2's routes answer 200 for `kill_half`, `kill_agent` and an approval, 422 for `api_storm`
and `net_fault`, 409 for a run that cannot take controls; every refusal is `{"error": reason}`, which `postControl` already
read into `detail`. So:
- the dead "Not wired yet" text is gone from the chaos panel, the plan view, the run controls and the new-task form (none of
  those routes answers 501 now; the only 501 left is W3's real-ablation route, which no component of mine calls), and the
  comments that said "answers 501" say what the routes do;
- a refused chaos kind shows the server's own words ("api_storm cannot be injected into a running run: it is part of the chaos
  plan a run starts with; live kinds are kill_half, kill_coordinator, kill_agent"), not a copy of them in the UI;
- an approval or a rejection is built by `approveBody(proposal, approve, reason)` (`lib/plan.ts`): it names the plan on screen by
  its `plan_hash`. That is the `plan_hash` of the latest `plan.proposed` for the goal (the fold keeps the latest), which the
  runtime logs as the scope token and compares with the control's (`actors/orchestrator.py`, the plan hold), so when the root dies
  holding the plan and its heir proposes another, a click on the old one cannot approve the new one. A rejection carries its
  reason (the planner's feedback); an approval carries none. A plan with no hash (an older log) is sent without one;
- `kill_half` no longer sends `profile: "C3"` (the server ignores it);
- tests: `approveBody` (plan.test.ts, including the heir's new hash) and `postControl` against W2's real refusal texts (api.test.ts).
Not done, not asked: an answer UI for an escalation (`POST /api/runs/{id}/escalations/{eid}` with `{choice}`): no component of mine
posts it (the panel now shows the window, the options and the verdicts; see "Escalations" below).

**The New task form (33cf10b), found by W5.** `POST /api/tasks` takes `{spec, scenario?, chaos?, clock?, speed?, backend?, run_id?,
budget_usd?, ...}` with extra keys forbidden (`api/jobs.py` `TaskRequest`), and the form posted the bare TaskSpec, so every launch
was a 422 (`spec: Field required`). Now it posts `{spec, backend: "fake"}` (`taskLaunchBody`, `lib/taskspec.ts`: the type allows no
other backend, so a billed run cannot start from this form; scenario, chaos and clock are the server's defaults: swarm, C0, the
simulated clock). The answer is `launchTask` (`lib/api.ts`): the run it started, linked (`#/run/<id>`, or `/plan` when the form
asked for a person's approval), the warnings of the launch, or the server's own reason for a refusal (409 used run id, 422 spec or
input, 429 at 8 active jobs, 503 without a private directory; FastAPI's own list of problems is read too). The default form now
carries `fixture: tasks/fixtures/t2/seed-1` (the server refuses a conference task with no input), and a conference task with none
is told so by the form before the request. Removed: the "Or upload a TaskSpec YAML" box, which posted `{yaml}` (the Day 7 fallback
for a server that parses YAML text; none does, so it could only 422), and the stale hint under the YAML. Checked against the real
`parse_request` on eight shapes of the form (default, manual approval, autoscale, contributor, t3 report, poison, generate_seed,
seed 4): all accepted wrapped, all refused bare. Tests: `taskspec.test.ts`, `api.test.ts` (the 202 of the API reference, each
refusal), `NewTaskForm.test.ts` (render of the answer).

**Escalations (5df8812), found by W3.** `foldHuman` closed an escalation on every `escalation.answered`; W3's answer path logs a
verdict for each answer, and an ignored one (not an option, a second one, too late, an unknown id) has `accepted: false` and leaves
the escalation open. It now closes only on an accepted answer (an answer with no `accepted` field still closes: the shape the panel
was built on), keeps the ignored ones with their `reason`, and reads what `escalation.opened` carries (`question`, `options`,
`default`, `timeout_ms`). `escalationState(h, nowTs, ended)` gives `waiting | answered | overruled | expired | closed` the way
`GET /disputes` does (an answer given at the last millisecond of the window is in time), and `timeLeftMs` is `deadline - nowTs` in
the run's **virtual** time (`ViewState.lastTs`), never the wall clock. The Escalations panel says which, and why: "needs a human" only
while the window is open (with the options, the ruled label and the time left), "confirmed", "overruled (a person chose A over B)",
"expired (nobody answered in time; B stands)", "closed (the run ended before anyone answered)", and each ignored answer with its
reason. The "5 · human" count is the escalations that are waiting. Tests: `escalations.test.ts` (fold and selectors),
`EscalationsPanel.test.ts` (render). No answer buttons yet.

**Counters against W1's metrics (f39f0e2).** See "Arena counters" above: the fold no longer counts an agent that a crash stopped as
idle, and `arena.parity.test.ts` pins the four logs beside the scored numbers.

**`rootHolder` (849f9ea), found by W5.** The reducer gave `duties: ["root"]` to every actor spawned with no parent: `board`,
`net` and `chaos` too, which every run spawns that way, so `rootHolder` answered `chaos` even on a run that never lost its root,
and a real root takeover (an `ownership.remapped` of the key `root` with no `duties`) never moved it: the ROOT tag of the tree
was never on the real root. Now `rootHolder` is the owner of the `root` key (it stays with a dead owner until its heir takes over),
else the root actor (the parentless actor that is not infrastructure); infrastructure never gets the duty; the heir of a root
remap gets `root` in its `duties`. `ViewState` keeps its shape. Checked on three real logs: `demo/backup` (committed; o0 -> o1 ->
o2 -> o3 at events 4538, 5722, 6856, and no other change), `t2-real-c3-swarm-seed1b` (one remap, o0 -> o0, a reclaim) and
`t2-real-c3-central-seed1` (no remaps); W5's `rootOf` (arena/board.ts) gives the same answer as `rootHolder` at every event of
the three, so it works unchanged before and after the merge. `rootHolder.test.ts` (13 tests; 11 fail on the old reducer).
Visible: the ROOT tag now shows on o0 and follows the heirs. W5 was told (msg_5c7e799aa147).

**Prepared for the window (scratch, not in git):** `pw/proof.mjs` (chip against the real `/takeover`, the badge against the
real `/verify` behind the guard including a bare POST that must get 415, and the ROOT tag at events 10, 4537, 4538, 5722, 6856
and the end of `demo-backup`), `pw/form.mjs` (the New task form on the real server: the default inputs, the missing-input message,
Submit to a 202 with `{spec, backend: "fake"}`, the link to the run, the job ending, Replay verified on the run it left) and
`pw/live.mjs` (a fake-LLM run launched through the API with `auto_approve` off, driven through the UI: the two 422 reasons, Approve
with the hash, Kill half, Verify replay after the run ends; then a second run whose root is killed while it holds the plan, to see
the heir's new hash reach the approval). All three ran in the window; results below.

### The quiet window (Oct 29: GO 19:21; my session was down 19:30-20:07 on a network error; finished 20:15)
One build, a server on scratch dirs on port 8794, one headless Chromium at a time, fake backend only ($0), nothing written to
the repo but these notes and the bundle. The server and every browser were stopped at 20:15; the 7 fake-LLM jobs of the window
had all ended (one cancelled by me).

| Script | Result |
|---|---|
| `npm --prefix web run build` | 4.6 s at tree `46c524e`; `index-CKgXM_1N.js` 1,015 kB (310 kB gzip), `index-Cnh2QwWT.css` 69 kB; `favicon.svg` restored. The answer buttons are not in it |
| `lite_check.mjs` | each `?lite` part changes the computed style it names (see Frame times) |
| `final.mjs` | 6 shots, all publishable (no MISMATCH badge), 0 errors: `final-demo-end`, `final-demo-lens-facts`, `final-demo-lens-facts-light`, `final-demo-lens-inflight` (1920x1080), `final-clip-actor`, `final-clip-cancelled` (720x827 clips of the lens drawer) |
| `compare.mjs` | the table at the top of Frame times |
| `proof.mjs` | 15 of 15: the takeover chip says "Takeover OK ✓ 7 hand-overs" against the real `GET /takeover` (5 kills, 7 takeovers, 0 violations); the app's own `POST /verify` is JSON and gets 200, a bare POST gets 415; the ROOT tag sits on one node at every step and moves o0 -> o1 -> o2 -> o3 at events 4538, 5722, 6856 of 8177 |
| `form.mjs` | 15 of 15: the default input `fixture: tasks/fixtures/t2/seed-1`; no YAML upload; Submit waits for a goal; the missing-input message; `POST /api/tasks` gets 202 with exactly `{spec, backend: "fake"}`; the answer links the run; the job completes (6,698 events); the link opens the run and Replay verified; near its end the tree shows 22 actors |
| `live.mjs` | 14 of 14 (run 1: 10, run 2: 4): `api_storm` and `net_fault` show the server's own 422 words; Approve sends `plan_hash` and gets 200 ("approved by human"); Kill half = 5 chaos actions; Verify replay gets 200 and ends in Replay verified; the log holds one `approve` and five `chaos` controls. Run 2: o3 takes the `root` key (`ownership.remapped`, seq 1643, 24.4 s) and proposes the plan again (seq 1854, 31.1 s); the plan page shows it awaiting approval and the approval names its hash |

Shots, all in the scratchpad (not in git): `win-final/` (the 6 above), `win-proof/` (`proof-runstrip-demo` 1920x53,
`proof-root-at-4538`, `proof-root-at-end`), `win-form3/` (`form-input-missing`, `form-started`, `form-run-opened`), `win-live2/`
(`live-1-plan-awaiting`, `live-1-chaos-422`, `live-1-plan-approved`, `live-1-chaos-kill-half`, `live-1-verified`,
`live-2-plan-heir`, `live-2-plan-approved`).

Found in the window:
- **Script bugs of mine, not app bugs** (fixed in the scratch scripts): `form.mjs` expected nodes at event 0 (a finished run opens
  paused at its first event, where the tree is still empty: "Waiting for the first actor to spawn") and navigated by hash alone,
  which does not re-read `?at=`; `live.mjs` expected the heir's plan to carry another hash.
- **The heir's plan has the same hash as the first one on a fake run** (`scope-1b3d2f26e494...` both times): the fake planner is
  deterministic. So "the approval names the heir's plan, not the first" cannot be told apart by hash on a fake run; what the run
  shows is that the heir proposes again after the takeover and holds again, and the approval names the hash of the latest
  `plan.proposed`. A real planner that answers differently would make the two hashes differ.
- A run launched from the New task form opens, from its link, at event 0 with an empty tree until Play (or `?at=`). That is how every
  finished run opens; mentioned because the form's answer says "Started run ...", and a fast fake run is finished by the time it is clicked.
- My first `live.mjs` left its second job running (waiting for approval for ever) after the script failed; I cancelled it
  (`POST /api/jobs/{id}/cancel`) and the script now cancels a job it leaves behind.

### Plan for the quiet window (kept for the record; done above)
1. `npm --prefix web run build` (about 4 s), restore `favicon.svg`.
2. `lite_check.mjs` (scratch, not in git): opens the swarm run where edges are lit and reads the computed
   `animation-name`, `filter` and `box-shadow` with and without each part, so a lite number is known to come from a switch
   that changed something.
3. `final.mjs`: the lens re-shoot (demo scenes as full frames, Phase 1 scenes as drawer clips, MISMATCH checked by the script).
4. `compare.mjs`, variants taken in turns: `before` (Phase 1 UI), `old` (before the clock fix), `new` (this build),
   `new-lite`, `new-lite-anim`, `new-lite-filter`, `new-lite-shadow` (the product switch in the same build), and the
   injected-CSS variants as a cross-check. 3 counted rounds after one warm-up: about 10 minutes for 7 variants.
5. `proof.mjs` (chip, Verify against the 415 guard, ROOT tag), `form.mjs` (the New task form end to end), then `live.mjs`
   (the chaos panel and the approve flow on fake-LLM runs launched through the API), each on a server with scratch dirs.

### Still to do (needs a slot or a later merge)
1. (done in the window of Oct 29, see above) A quiet window: absolute frame times, the fix measured, the three CSS toggles tried; the lens scenes re-shot on the
   final build, using `demo-backup` wherever a badge is visible. **The app verifies a completed run as soon as it opens
   it** (`App.tsx` calls `runVerify`), so every scene on a Phase 1 run shows MISMATCH in the run strip, clicked or not;
   leaving Verify alone does not avoid it. `demo-backup` has no cancelled LLM call (its 10 `effect.cancelled` are not
   model calls), so the "calls lost" scene exists only on the Phase 1 central run. Plan: the demo scenes as full frames
   (MATCH, with the new chip "Takeover OK ✓ 7 hand-overs"), the Phase 1 scenes as clips of the lens drawer, which leave the
   strip out. The scratch script `final.mjs` (not in git) enforces it: a shot whose region overlaps a MISMATCH badge goes
   to `internal/` and is marked `publishable: false`.
2. (done) The static bundle was rebuilt in the window (tree `46c524e`): the chip fix, the lite switch, the New task form, the
   escalations panel and the dup/cdt port. The answer buttons (below) need one more build.
3. (done in the window) W2's merge is in arena (24995b5): the chip against the real endpoint ("Takeover OK ✓ 7 hand-overs" with
   MATCH) and the Verify button against the guard (JSON 200, bare 415).
