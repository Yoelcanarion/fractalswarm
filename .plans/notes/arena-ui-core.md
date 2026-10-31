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
| Answer buttons (Escalations panel) | done: in the bundle, and clicked in a real browser on a real server (see The GO window) |
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
`EscalationsPanel.test.ts` (render). The answer buttons came after (see Answer buttons).

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

### Answer buttons (Escalations panel; the coordinator's second light item)
For each human escalation that **waits** (`escalationState === "waiting"`, at the virtual time the log has reached) the panel shows
a button per option (`item.options`; the ruled label reads "B (ruled)"). It does so only on a run page: `EscalationsPanel` takes the
`runId` from `PanelsPage`, and a view with no run behind it only shows. With no options there is a line saying so, not a guess.

A click sends `POST api/runs/{id}/escalations/{eid}` with `{choice}` and nothing else (`answerEscalation`, through `postControl`; the
server reads the goal from its log). The line under the buttons (`AnswerStatus`, `role="status"`) is the server's own words, as
`postControl` reads them: 200 "answer to {eid} requested for {goal}"; 409 "run '{id}' was not launched to take controls: start it from
the API"; 422 "choice is required: what the person decided" / "the escalation id is not valid"; 404 "no escalation '{eid}' in run
'{id}'". A refusal is drawn like the chaos panel's (`chaos__result--bad`).

The server only *requests* the answer: the goal's owner takes it or ignores it on its next turn, and the verdict is the
`escalation.answered {accepted, overruled, reason}` in the log. So after a 200 the box **reads the verdict back** from
`GET api/runs/{id}/disputes` (`fetchDisputes` and `lib/disputes.ts`) at 0.4, 1.4, 3.4 and 7.4 s, and says "accepted: A overrules B",
"accepted: B confirms B" or "not accepted: {the owner's reason, as it logged it}"; "no verdict in the log yet" if none arrives. Only an
answer newer than the last one the panel had seen when the person clicked (`seq`) counts, and only the escalation that was answered.
If the live stream brings the verdict before the poll does (or after it gave up), the box shows the one in the page's own copy of the
log (`withLoggedVerdict`), so it never says "no verdict" under a row that already reads "overruled".
A server that has no `disputes` view (404) or does not answer ends the reading without a verdict, not with an error. Buttons stay
disabled while an answer is in flight, so a verdict is never read for the wrong click; once the escalation closes (an accepted
answer, the window passed, the run ended) the buttons go and the line stays, to say how the last answer went.

Tests: `disputes.test.ts` (reading the view; the verdict wording; `sendAnswer` against a stand-in server: a refusal reads nothing back,
a 200 finds its verdict at the right look, an ignored answer gives its reason, another escalation's answers are not mixed in, it
gives up, 404, the caller gone), `AnswerBox.test.ts` (buttons, ruled mark, no options, nothing once closed; the status line for a
pending request, each verdict and the 409/422/404 refusals), `EscalationsPanel.test.ts` (buttons only with a `runId`, only while it
waits, still there after an ignored answer), `api.test.ts` (route and body with the ids escaped; the refusal words verbatim;
`fetchDisputes`).
Checked in a real browser on a real server in the GO window of Oct 29 evening (see The GO window): a 200, the owner's verdict read
back, a 409 in the server's words.

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

### The GO window (Oct 29 evening, 21:26-21:37 CET): build, tests, references, the answer buttons on a real server
**Merge first.** arena `a6db325` (W5 MP1, W1's matrix, notes) is merged into this branch (`5d9c80b`). Only the static bundle conflicted
(two builds of the same sources, two hashes); it was arena's until the rebuild below. `web/src` merged clean.

| Step | Result |
|---|---|
| Build at tree `3a14838` (21:26) | vite 2.9 s, 6.5 s with `tsc`. `index-B9ApM25o.js` 1,205 kB (368 kB gzip), `index-CJ0yU3pF.css` 113 kB (22 kB gzip): W5's arena views are in it, which is the growth from 1,015 kB. `favicon.svg` restored |
| tsc, vitest (one worker) | clean; 71 files / 1,122 tests |
| `tests/integration/test_api.py` + `test_guard.py`, `ruff check` | 87 passed (10 s); all checks passed |
| `demo --verify --no-serve --no-browser` | MATCH, 8,177 events, head `b052b4bc33cf` |
| `$0` references vs `arena-c2b5e08` (`record_refs.ps1` then `compare_refs.py`, 2.5 min) | **43 of 43 runs have identical event bodies** (11 runs + 32 bench cells) |
| The buttons on a real server (`pw/answer.mjs` and `esc/escalate.py`, scratch; 8794, one browser) | 15 of 15, below |
| A second build (21:36), after the `lcrow` fix below | vite 0.8 s, 2.4 s with `tsc`: `index-CuucwkCz.js` 1,205 kB, `index-DDb34IoW.css` 113 kB. This is the bundle in the tree. vitest 72 files / 1,126 tests |

**The answer buttons, clicked.** No recorded run holds an escalation, and a live one needs the scripted backend of
`tests/integration/test_escalation_answer.py` (a forced dispute on S02, an arbiter that rules with confidence 0.4, the blurbs 50 s
late so the run outlasts the time to answer). `esc/escalate.py` (scratch, not in git) records that run on the live clock (speed 2) into
the scratch runs dir, once with `live_control` on and once off; the server finds it like any run. Fake LLM only, $0.
- **Run A (takes controls; the ruling is B).** The panel shows "needs a human ... options A, B (ruled: B) · 58.5 s left" and the
  buttons "A" and "B (ruled)". A click on A sends `POST /api/runs/{id}/escalations/arbitration%3Aspeaker%3AS02%3Aavailability` with
  `{"choice":"A"}` and gets 200; the line reads "A: answer to arbitration:speaker:S02:availability requested for goal:root · asking
  the server how the owner took it…", then "· accepted: A overrules B". The poll of `GET /disputes` came 451 ms after the request
  (200). The row reads "overruled ... a person chose A over B", the buttons are gone, the line stays. The log holds one answer:
  accepted, overruled, by human, reason "overrules B with A". No console error, page error or 404.
- **Run B (not launched to take controls).** The same click gets 409 and the line is the server's own words: "A: run 'ui-ans-b-...' was
  not launched to take controls: start it from the API". Nothing is read back from `/disputes` (0 requests in 6 s), and the buttons
  stay, enabled: the escalation still waits. The browser logs its own "Failed to load resource ... 409" line, nothing else.
- My first pass said 14 of 15: the script counted the `/disputes` requests at the instant the verdict showed, but the stream had
  brought the verdict before the poll's first look at +0.4 s (the fallback of `withLoggedVerdict`: the box shows the verdict in the
  page's own copy of the log). The look still comes; the script now waits for it. Not an app fault.
- Shots (scratch): `win-answer2/answer-a-waiting`, `answer-a-verdict`, `answer-b-refused` (1920x1080).

**Found by the click: two stylesheets, one class name.** The screenshot of the Panels page showed the Collisions card with a
collision key wrapped one character per line. The Muse lens's call rows (`components/lens/CallList.tsx`, `styles/lens.css`) and the
Collisions panel's rows (`components/CollisionsPanel.tsx`, `styles.css`) were both `crow`; the lens's `display: grid` won, so a
collision row laid out as a call row (the key in a zero-width track). It has been so since step 9 and no check looked at a collision
row. Measured on the real page: the row was 366 px tall with the key 0 px wide; after the rename it is 99 px tall, the key one line.
The lens rows are `lcrow` now (CSS, `CallList.tsx`, my scratch scripts). `styles/classnames.test.ts` keeps the lens's class names to
itself: no class the lens's stylesheet starts a rule with may also start a rule in another stylesheet, except `run`, `timeline` and
`actor`, which the lens adds a property or two to on purpose (a positioning context, a minimum height, a pointer; none of them is a
property the base rule sets). The six lens shots were taken again after the rename (`win-final2/`, 0 errors, publishable): the drawer
is pixel-identical to the earlier one by eye. Shot of the card: `win-crow/collisions-card.png`.

**`loadAllEvents` and W3's events fix (b702dc5, `.plans/notes/arena-meta.md` "Shape for W4").** `GET /api/runs/{id}/events` keeps
`{events, next_seq, last_seq, done}`; the page and `last_seq` now come from one snapshot, so `done` is true as soon as a page reaches
the end of the log as it was when the page was read, however fast a live run writes (before, a run committing thousands of events a
second kept `done` false for as long as it ran, and the UI's pager followed it). `loadAllEvents` as written
(`if (page.done || page.events.length === 0) return`) needs no change; what is committed after the snapshot comes over the WebSocket
tail from `next_seq`, as today. Pinned in `api.test.ts` ("reading a whole log"): a log of 12,000 events read in 3 pages in order; a log
that grows by 300 events after every page is read in 3 pages, with no gap and no repeat; the same test fails (the reader is "still
chasing the log after 20 pages") against a server that reads `last_seq` at a second moment, which is the old behaviour.

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
   escalations panel and the dup/cdt port; and again in the GO window of the evening (arena merged, the answer buttons, the
   `lcrow` fix: see The GO window).
3. (done in the window) W2's merge is in arena (24995b5): the chip against the real endpoint ("Takeover OK ✓ 7 hand-overs" with
   MATCH) and the Verify button against the guard (JSON 200, bare 415).

## Round 2 (polish, arena spec §M.2): where it stands at Yoel's STOP (Oct 30, about 12:00 CET)

Branch `Yoelcanarion/arena-ui-core`, last code commit `e95864c`, nothing pushed. The heartbeat loop is ended; no background command of mine is running.

### Done (committed)
- `6d3ddd0` the API serves recorded hero sets (the one granted change under `src/fractalswarm`: the `HERO_SETS` lookup in `api/app.py`); `846d802` the rivals-gate set; `1e2ee91` Charts on recorded sets (R5 "In-process supervisor"), never a fixture shown as measured.
- `c35ef31` shared Tooltip, glossary `Term`, `PageHeader`, `EmptyState`, `Skeleton` and the title helper in `components/ui`.
- `0ba8b4e` the Runs catalogue (`components/catalogue/`, `lib/catalogue.ts`, `lib/factsLoader.ts`): states in words, live runs apart, sort and filter, a replay check per run, and the New task form with help text. `05e5f0a` merges arena `d8e8d28`.
- `c18f901` Results, Plan, Panels, Security and Events open with a name and one sentence of purpose; one gate for "no run / loading (skeleton) / failed (try again, open the runs)"; a first-visit guide on the Run page that explains the playhead; hints through the shared tooltip; no "spec §" on screen.
- `e95864c` the type scale held: 22 rules moved from 12px to the 14px body size, `.mono` never under it, guarded by `styles/typescale.test.ts`; the intake reads the optional `approved.proposal` and starts a reopened approved intake from the approved rows.
- Checks at `e95864c`: `tsc --noEmit` clean, vitest 84 files / 1296 tests green (single worker). `merge_ready` #1 went out for `05e5f0a` (msg_25dde0f8dd5f); `c18f901` and `e95864c` are not announced yet.

### Half done or not started
- **Never seen in a browser** (no RELEASE came while the paid block ran): no audit screenshots (1920x1080 and 1366x768, dark and light, real log and empty state), so no ranked audit list, no before/after paths, no frame-time reading (the run page was 37 fps at 20x) and no console check. Unchecked by eye: tooltip placement, the Charts range bands, the Runs page, the Run page at 1366x768 with the compact head and the guide strip, the light theme.
- **App shell** (brief priority 1: four main places, run views only inside a run, a way home, `document.title`, no flash) is not started: it waits for the coordinator's word on `App.tsx`.
- Keyboard: the Events view opens a row from the keyboard; the clickable `<tr>` rows in `intake/ReviewTables.tsx` are not checked; there is no `outline: none` in my sheets. Reduced motion was audited and is already covered (global rule in `styles.css`, `lib/motion.ts`), so nothing changed.
- Intake, ablation and where-it-helps: their heads are still `h2` in their own styles, they have no loading skeleton or failed state with a way out yet, and some native `title=` hints are left.
- Not run (they need a SLOT): `demo --verify --no-serve --no-browser` and `uv run pytest -m 'not promptguard' -q`.

### Next step
1. Read the mailbox: a RELEASE, the `App.tsx` go-ahead, or a HOLD.
2. With a RELEASE: start the audit harness (`serve_audit.ps1` for the API on 8796, `node pw/dev.mjs` on 5176; playwright-core scripts in the session scratchpad, `...\9e97009a-a246-4f4b-9410-64146e824692\scratchpad\pw\`, not in git, so recreate them if it is gone), run `audit.mjs` in chunks under 10 minutes, look at the shots, write the ranked list here, send its top as a `status`, then fix in small commits.
3. Without one: the `App.tsx` shell if allowed (code and vitest only), then heads and states for intake, ablation and helps.
4. Then the frame-time reading, `demo --verify`, the pytest merge check, a `merge_ready` for `05e5f0a..HEAD`, and `worker_done`.

### Deviations (round 2)
- The Runs components live in `components/catalogue/`, not `components/runs/`: `.gitignore:13` ignores any directory named `runs/`.
- `store.runsLoaded` is a new store flag (the skeleton shows until the first listing arrives); the old `.runs` grid CSS was removed from `styles.css`.

### Since the resume (Oct 30 afternoon, on HOLD: code, tsc and vitest only)

Arena `76ac1f0` merged in (`2c86ca1`, clean). Commits, none pushed: `8528535`, `a488c11`, `e6cad99`. At `e6cad99`: `tsc --noEmit` clean, vitest 85 files / 1319 tests green (single worker). No browser has been opened since the reboot.

#### Done
- `8528535` **Intake, ablation, where it helps.** One head each (`PageHeader`, the page's one `h1`); a loading skeleton shaped like what is coming; a failed state with a way out (Try again, plus where to go) for each of the three; `useHonesty()` returns `reload`. A bug found on the way: a failed listing of ablations read as "No ablation has been recorded"; it now says the list could not be read. New glossary word `muse`.
- `a488c11` **Keyboard.** Every native `title` that carried a meaning goes through the new shared `Hint` (`components/ui/Hint.tsx`): a bubble for the pointer, a tab stop with the words as its description where it stands alone, the same words as text for a screen reader where it does not. That is the panel chips and stats, the status and model badges, the verify and takeover badges, the Muse meter's failure, the schedule cells, the plan rows, the market ladder, the provenance badges, the speaker who cannot be taken out, and the ablation terms and filters. The run page has a "Skip the tree and go to the replay bar" button, and the tree's cards are its only tab stops (`nodesFocusable` and `edgesFocusable` off). Reduced motion needed no change: the global rule in `styles.css`, `lens.css`, `intake.css` and every script-driven motion read `prefersReducedMotion()`.
- `e6cad99` **Light theme by code.** `styles/contrast.test.ts` reads every sheet and checks 4.5:1 in both themes for each text/background pair a rule sets (80 pairs, `:hover`, `:focus-visible` and `[aria-…]` variants included). It found one: the intake's current-step number (primary text on `--accent`: 3.2:1 dark, 4.2:1 light; no text token reads on the accent in both themes). It is now the accent's text tone with inverse text (7.5:1 and 6.5:1). A slot a speaker can do is a tick as well as a fill (dark green against dark grey is a small step, and none for some eyes). No colour sits outside `tokens.css` anywhere (no `rgb()`, no named colour, no inline colour prop); the light theme defines every dark colour; the `opacity` uses are disabled controls, marks and the dimming of dead tree cards.

#### Found by code, to look at in a browser at RELEASE
- **A saved light theme flashes dark on load.** `initTheme()` runs when the bundle evaluates, which can be after the first paint. The fix is a short inline script in `web/index.html` that sets `data-theme` from `?theme=` and the saved choice before paint. That file is outside my brief: asked the coordinator.
- **Dead and restarting tree cards dim their text by `opacity`** (0.45 and 0.6). A rough blend puts primary-coloured text at about 4:1 (dark) and 3:1 (light) against the card's tint. Measure it from a screenshot; if it reads badly, give the text a token colour in place of the opacity.
- **Muted text on `--ok-bg-strong` is 3.98:1 and on `--warn-bg-strong` 4.25:1 in the dark theme.** Nothing in my sheets puts it there (those rules set their own text colour). `arena/arena.css` has `.tl__key--restart` and `.band--supervisor` on `--warn-bg-strong` with no text colour of their own: not my sheet, and only a problem if they ever hold text.
- **Hint wrappers.** A hint wraps its trigger in the inline-flex `.tip`. A block that fills its container (the ladder bar) got `role="img"` and an `aria-label` for that reason. Check that chips and badges line up as before (Panels, the Run page counters).
- **New heads at 1366x768** (intake, ablation, where it helps) and the skip button when it takes focus.

#### After the first status (coordinator, 15:17 UTC: `index.html` yes; `App.tsx` waits for W6's first merge, about 16:55, and I am told the moment it is in; my browser slot comes after W6's and W7's)
- `ae7aa7f` **The app shell, built and tested, not wired in.** `components/shell/TopBar.tsx` (+ `shell.css`): the brand as the way home; four places (Arena, Runs, New task, Evidence) with the current one marked by `aria-current` (`page` on the page the link opens, `true` on a place's other pages: a run is in Runs, `#/helps` and `#/ablation` are in Evidence); a second row only where a place has views of its own: a run's six (with the run picker, its status, and the Security count as a hint) or the evidence's three. It sets `document.title` (`Plan · <run> · FractalSwarm`), announces the page in a `role="status"` line, and has a "Skip to the page" button (a button, since a `#main` link would trigger the hash router; it focuses `#main`). `lib/shell.ts` is the pure model (places, views, which place a page is in, names and titles); the bar's tests are `components/shell/shell.ui.test.ts` and `lib/shell.test.ts`.
- `ae7aa7f` **Run pages no longer flash "no run".** The store opens a run in an effect after the page's first paint, so a first visit to `#/run/x` painted "No run selected", and a switch from the Runs list painted the previous run (mounting its heavy tree for nothing) before the skeleton. `lib/address.ts` says what the address names (`namedRunId`) and what a run page is about to open (`openingRun`); `RunGate` holds the page's place with its own skeleton until then ("Loading the runs" before the list has answered, "Loading <run>" after). `namedRunId` also survives a malformed `%` escape, which `decodeURIComponent` in `App.tsx`'s `parseHash` would throw on.
- `457968b` **The Runs lead names what the "Replays" door promises.** Yoel looked at the home page at 17:00 and expects the same care inside; the Runs page is the first stop of that door. Its lead now says a recorded run replays from its log "and has a replay check", with *replay check* a `Term` that defines it where it is named (the glossary entry the key and the column already use).
- `2b5168f` **The theme goes on before the first paint.** An inline script in `web/index.html` (placed after the icon link, a line apart from W6's title and description lines; the dark `<meta name="color-scheme">` line is untouched) reads `?theme=` and the saved choice, storage behind a try, and sets `data-theme` and the meta. `paint()` in `lib/theme.ts` keeps the meta with the theme when it is switched. `lib/theme.test.ts` runs the script and `initTheme()` against the same stubbed pages (ten situations) and requires the same result.
- Checks at `2b5168f`: `tsc --noEmit` clean, vitest 89 files / 1383 tests green (single worker).

#### `App.tsx`, when it is released: the wiring (a handful of lines)
1. Import `TopBar` (`./components/shell/TopBar`), `namedRunId` (`./lib/address`) and `RUN_VIEWS`, `runViewHash`, `type RunView` (`./lib/shell`). Delete `App.tsx`'s own `RUN_VIEWS`, `RunView`, `VIEW_TITLES` and `viewHash`, and the `StatusBadge` and `ThemeToggle` imports.
2. In `parseHash`, `runId: namedRunId(hash)` in place of `parts[0] === "run" && parts[1] ? decodeURIComponent(parts[1]) : null`.
3. Replace the `<header className="topbar">…</header>` block with `<TopBar where={route} runId={runId} runs={runs} runStatus={runStatus} scenario={scenario} blocked={blocked} onPickRun={(id) => { window.location.hash = runViewHash(id, route.page === "run" ? route.view : "overview"); }} />`. `Where` takes the route as it is (extra fields are fine). W6 loads the home page on its own (`home/Root.tsx` tells `#/` from the rest before the app chunk is fetched), so `App` never sees the home route and `Where` has no home (`4ec2320`). Read from W6's worktree (arena-home, `cc039bd`): its `App.tsx` differs from mine only by five style imports at the top, so the anchors below still hold; the scratchpad script `wire_shell.py` does steps 1 to 4 and refuses an anchor that is not found exactly once (`--dry` first; it has been dry-run against the current file: six anchors, all found).
4. `<main className="content" id="main" tabIndex={-1}>` (the skip button focuses it).
5. After wiring, look at it: the second row costs about 44px of height on a run page at 1366x768 (the picker and status moved into it from the top bar); the `RunStrip` stays under it. If the run page is too tight, the first thing to give is the top bar's 60px.

#### The slot (browser audit), as planned
The harness is outside git, in the session scratchpad `...\9e97009a-a246-4f4b-9410-64146e824692\scratchpad\` (recreate it if it is gone: playwright-core against Playwright's Chromium 130, headless, exact viewports). In `pw\`: `lib.mjs` (launch, page with console, page-error and CLS collection, the in-page lint, the keyboard walk), `audit.mjs` (every screen at 1920x1080 and 1366x768, dark and light, real log, empty catalogue and error states; env `OUT`, `LABEL`, `STATES`, `VIEWPORTS`, `THEMES`, `ONLY`), `dev.mjs` (the repo's Vite config on port 5176 with `/api` proxied to the audit API on 8796), and three added while on HOLD, never run yet:
- `flash.mjs`: the theme at first paint (a saved light, a light asked in the address, dark asked over a saved light, nothing said: the attribute and the meta must be right at the first paint), the states the run page passes through on a first visit and on a switch from another run through the Runs list, at DOM commits and at animation frames (it must never paint "No run selected" or the previous run).
- `deadtext.mjs`: the contrast the dimmed text on dead, restarting and stopped tree cards really has (group opacity composited over what is behind), both themes, with a crop of each kind of card.
- `preview.mjs` and `frames.mjs`: a scratch production build (`npx vite build --outDir <scratch> --emptyOutDir`, from `web/`) served with the API proxied, and a generic `requestAnimationFrame` logger that takes variants in turns with a warm-up round and reports medians (fps, p95, frames over 34 ms). The Oct 29 numbers to compare with: `new` 37.3 fps, p95 33.4 ms, `?lite=shadow` 40.5 fps, at 20x on `t2-real-c3-swarm-seed1b`, 1920x1080, software rendering.
Order in the slot: serve (`serve_audit.ps1`, `pw\dev.mjs`), `audit.mjs` in chunks under 10 minutes, `flash.mjs`, `deadtext.mjs`, read the shots and write the ranked list here, send its top as a `status`; the build and `frames.mjs` (the build is heavy); then the merge checks (`uv run pytest -m 'not promptguard' -q` in chunks, `demo --verify --no-serve --no-browser`, `scripts/refs/record_refs.ps1` and `compare_refs.py` against `arena-c2b5e08`, 43 of 43), `merge_ready` for `05e5f0a..HEAD`, `worker_done`.

### RELEASE (Oct 30 evening): the browser audit, the shell wired in, the first merge point

Arena `7452747` (W6) merged at `961c413`, arena `86f2951` (the looping hero) at `cdface9`, both clean. `App.tsx` was released and the shell is wired in (`70505b2`). Playwright Chromium 130, headless, one browser at a time, free memory 1.9-3.4 GB (the harness stops under 1.2 GB). Shots are in the scratchpad `shots\`: `audit1` is the first look at `4926a5b` (all 32 real-log screens at 1920x1080 and 1366x768, dark, plus an Arena pair), `audit3`/`audit5` are after the run-page fixes, `audit4` is the light theme at 1366x768 (17 screens). Titles are right on every page ("Plan · demo-backup · FractalSwarm" ...; the Director page keeps the site title, it is W5's).

#### The ranked list (what Yoel meets first from the home page comes first)
1. **Runs.** Looks finished: the lead names the replay check, "Start a run" is the inverted neutral, the live strip and the table are in place. Left as it is: four large logs keep a skeleton row for about 1.2 s while their facts load (the loader reads logs progressively); the rows shift the page by 0.03-0.06 when they arrive.
2. **The run view at 1366x768 (the worst thing in the app; fixed).**
   - V1: the tree's canvas (min-height 300) ran under the replay bar and the chaos list over the event log; the chrome was 263 px of 768 (top bar 60, second row 44, strip 91, replay bar 68). Now, under 900 px of height the page is as tall as its panels (`.run__main { flex: 1 0 560px }`, a definite basis, so the tree's camera is fitted once) and scrolls, with the replay bar sticky and a shadow in the page colour under it; under 820 px the top bar is 52 px. (`31f6f6a`)
   - V2: layout shift 0.07-0.18 from the status badge, the picker width and the strip's proof chips arriving. The picker has one width, the scenario and status sit at the end of the row, the open run is in the picker from the first paint; the strip's place is held from the first paint (`461cdf6`); under 1500 px the strip is one row (53 px, was 91): the cache share, the token counts and the replay hash move into the hints. Light, run at its end, measured twice: 0.15-0.18 -> 0.01.
   - V3: `.actor__adopted` was 4.38:1 (the track colour on the card); it is pulled toward the text colour.
   - V4 (not changed): the tree's node text is about 5 px at 1080p. It is W5's `arena/` and the tree's own scale; it is the biggest thing left in this view.
   - V5: panel titles wrap instead of squeezing their hint ("ORCHESTRATOR TREE" + hint, "T2 SCHEDULE" + badge).
3. **Header.** The brand is the home lockup (17 px, 650, tight tracking) and is the way back to the home (`a.brand href="#/"`, "FractalSwarm, home"); four places with the current one marked; each page has a tab title and an announcement; the second row is a run's own views (or the evidence's three pages). The primary button is the home's inverted neutral everywhere, in both themes (the coordinator's decision, Oct 30 evening).
4. **Opening a recorded run (the coordinator's decision, Oct 30 evening).** From the Runs list, the results table and the run picker a recorded run opens at its end (`?at=end` in the address: `openedRunHash`, `pickedRunHash`), with the whole picture at once and "Play from the start" one click away. A hand-typed `#/run/<id>`, an explicit `?at=` and a play link keep the start of the log; a live run opens at its head either way; the store is unchanged (`ee045c1`).
5. **Console.** Only React Flow's "hiding the attribution" line, and only in the dev server: the library prints it when `NODE_ENV` is `development` (`@xyflow/system` `handleAttributionWarning`). Not in a build.
6. **Where it helps / Ablation.** The outcome's headline had a gap before its comma (three flex items in a gap-ed row; now one item). Ablation's form was a centred 960 px column while the Evidence pages are left-aligned, so the title jumped sideways between the tabs; it keeps the left edge now.

#### Not mine (reported to the coordinator)
- W6: `home/home.css` `.home-extract__mark[data-lit]`, `--text-inverse` on `--accent`, 4.30:1 in the light theme (AA needs 4.5). `styles/contrast.test.ts` has a `REPORTED` list for findings in files that are not this worker's: the entry is checked for staleness, so the guard fails the day the finding is fixed.
- W5: `#/arena` with no pair on record is nearly empty and its text is for developers ("open #/arena/<swarm run>/<rival run> ... POST /api/arena ..."); with a pair on record it is polished. The Director page shifts by 0.06-0.16 when its list arrives.
- `tests/unit/test_home_data.py` failed on this branch until arena `175bc4f` (the digest of `bench/REPORT.md`); green after the merge.

#### Checks at `ee045c1` (the first merge point of this slot)
- `uv run pytest -m 'not promptguard'` in chunks, scratch runs dir and ledger, `FRACTALSWARM_ALLOW_UI_REAL` unset: unit 1093 (28 s); integration a-c 318 (5:40), d-l 289 (5:00), m-r 107 (4:36), s-z 186 (1:19); the 13 strict-mode-rules tests of `test_planning.py` + `test_intake_flow.py` pass; whole collection 1994 of 1997 (3 promptguard deselected): 1093 + 900 + 1 whole-suite-only `[IntakeOutput]` = 1994.
- `fractalswarm demo --verify --no-serve --no-browser`: `MATCH backup: 8177 events, head b052b4bc33cfe1b54c7b6ceb2872de26`.
- `scripts/refs/record_refs.ps1` (scratch dir, 125 s) and `compare_refs.py` against `arena-c2b5e08`: 43 of 43 runs have identical event bodies.
- Web: `tsc --noEmit` clean; vitest single worker green (118 files, 1815 tests at `461cdf6`; the last commits add and change a handful: see the merge_ready).

#### Deviations (this part)
- Primary button look (inverted neutral), the open-at-end rule and the contrast guard's `REPORTED` list are the three things that change what the app looks like or does outside my files' own area; the first two are the coordinator's decisions.
- No change to `store.ts`, to any event model, or to `web/src/home/**`, `web/src/static/**`, `web/src/arena/**` (except `arena/helps/**`, mine) or `director/**`.

#### Still to do in this slot
1920x1080 light, the empty and error states, keyboard walks, the dimmed text on dead tree cards (`deadtext.mjs`), the theme and run-opening flashes (`flash.mjs`), frame times on a scratch build (`frames.mjs`), a last `merge_ready`.

#### After the first merge point (f384db9, merged at 99dad26): later fixes, and what is left (my usage limit was reached here)
- 0866822 Rate limits: the panels' Meter wrapper carried the class `meter`, which the Muse lens styles as a flex row, so the quota meters had no bar since Oct 29; it is a plain block now, and `styles/classnames.test.ts` lists where components outside `components/lens/` use a class only the lens styles.
- dc9f891 A run page with no run to open, or one that failed to load, has no empty strip band and no "..." status badge (`openingRun` decides; `TopBar` gets `opening`).
- 87a3751 Dead, restarting and finished tree cards: text at AA by colour, not by group opacity (before: meta 2.2:1 dark and 1.9:1 light, id 4:1 and 2.9:1 on a dead card); `styles/contrast.test.ts` reads the three states.
- e8c1365 A launch opens its page only once its runs are listed (`untilRunsListed`, `listedRuns`): `POST api/arena` answers 202 before the runs exist, and the arena page opened at once stayed on "Could not load the pair" until a reload. Checked in a browser on the fake model: the pair lands on the arena page, no console errors.
- Checks: web suite green at 14ba712 (125 files, 1913 tests); intake 9 files / 168 tests green at e8c1365; Python, `demo --verify` and the references as at ee045c1 (not re-run since).
- Frame times, production scratch build, 1920x1080, 20x, the first 6 s while playing, three passes: 32.8, 28.5 (`lite=shadow`), 27.4 fps. The machine was busy and identical passes drifted by 6 fps, so this does not compare with the quiet-window 37.3 of Oct 29. Theme before the bundle: right in the four cases on the build. Tooltips: 14 bubbles at 1366x768, none outside the viewport or over its trigger.
- Left: the one-run launch in a browser; a 1920x1080 dark pass after these fixes; the run view's tree text (about 5 px at 1080p: 17 leaf cards make a width-limited fit); W5's Arena page with no pair on record; W6's `.home-extract__mark[data-lit]` (4.30:1 light).


## Round 3: the redesign of the app (Oct 30 night; `redesign.md`, "The app")

Yoel found the app too full: too many functions, buttons and information ("yo sabria como usarlo pero si alguien quiere probarlo, no"). No feature is removed; what a stranger does not need at first moved under one fold. Branch `Yoelcanarion/arena-ui-core`, from `Yoelcanarion/arena` `3b22208`.

### The rules every page now follows
- **One line** that says what the page is for (the `PageHeader` lead, plain words, a term keeps its tooltip), **one main action** (the one `btn btn--on`), and the essentials. Everything else is in **`Details`** (`components/ui/Details.tsx`), the one fold of the app: a native `<details>`, so it is a fold for the keyboard and for a screen reader. It opens by a prop (`open`), or from the address (`?details=<id>[,<id>]`, `lib/details.ts`: `withDetails(hash, id)`), also when the address changes while the page is open. `menu` makes a short list that floats under its summary (closes on Escape, on a click elsewhere and when the address changes); `inline` is the same fold inside a card.
- **No bare page.** Every page-level empty state names what to do next with a button: Arena (Start a pair, Open the runs), Runs (Start a run), Run (Open the runs), Charts and Helps (Try again, Open the charts/runs), Ablation. A bare `#/run` opens `demo-final` at its end (`lib/address.ts`: `defaultRunId`, the first listed run on a server without it); `#/arena` alone opens the newest public pair behind a skeleton. The small "Nothing" notes inside the cards of Plan, Panels, Results and Security say what the card would hold; they are not pages.
- **The 3-step guide** (`lib/guide.ts`, `components/shell/Guide.tsx`; the "Guide" button of the top bar): 1 choose a run (Open the final run), 2 kill half the brains, 3 verify the replay. Open the first time, dismissible ("Got it"), reopened by the same button, never blocking (it sits above the page, not over it). The seen flag is `fractalswarm.guide.seen` in `localStorage`, every read and write in try/catch. Honest about a recorded run: step 2 says that in the final run half of the coordinators were killed on purpose and Play shows the rest taking over, that **a recording cannot be changed**, and that to kill some yourself you start a run (button "Start a run"); step 3 says a recorded run checks itself when it opens.
- One tab stop for a row of small buttons (`components/useRoving.ts`): the tree's cards, the run bar's marks, each arena lane's bands and marks. Tab lands on one, the arrow keys, Home and End move along the row. This is why the old "Skip the tree" button is gone.

### Checklist: every control that moved (each is at most two clicks away)
Fold ids are the `?details=` values. "1 click" is the fold's summary; a menu or a select adds one.

| Page | Control | Now | Clicks |
|---|---|---|---|
| Every page | Guide | "Guide" button in the top bar (new) | 1 |
| Run, Plan, Results, Panels, Security, Events | Plan, Panels, Security, Events tabs | menu "More views" (`views`) in the run bar; the open view is always a tab; Run and Results stay tabs; the blocked count of Security is the menu's hint | 2 |
| `#/run` | Skip the tree | removed: the tree is one tab stop | 0 |
| `#/run` | The old guide panel | the shell Guide, the lead of the page, and "Play from the start" | 1 |
| `#/run` | Replay speeds 1×, 2×, 5×, 10×, 20× | one select "Speed" in the bar | 2 |
| `#/run` | Kill half the brains (live) | in view, the main action of a live run | 1 |
| `#/run` | The other chaos controls (live) | "More ways to break it" (`chaos`) | 2 |
| `#/run` | The chaos controls on a recorded run | "Chaos controls, live runs only" (`chaos`), all disabled, under a sentence that says why and a link to start a run | 1 |
| `#/runs` | Search, state and workflow filters, sort, refresh, check all | "All N runs" (`all`) | 1 |
| `#/runs` | The table of runs and "How to read this table" | "All N runs" (`all`), the key a fold inside it | 1, 2 |
| `#/runs` | Start a run (the form) | "Start a run of your own" (`start`); the empty list's button opens it by address | 1 |
| `#/runs` | Open a recorded run | the final run is the main action; the final run and up to three finished runs are in view (`FeaturedRuns`) | 1 |
| `#/arena` | Swarm and Rival selects | menu "Choose the two runs yourself" (`runs`); the Pair select stays in view | 2 |
| `#/arena` | Replay speeds | one select "Speed" | 2 |
| `#/arena` | Play both | "Play both from the start" in view (new, the main action) | 1 |
| `#/new` | Emails or notes, Conference, Rooms (add, remove), the speakers' names switch | "Add emails, notes, rooms or a conference name" (`more`); it opens by itself when any holds text, e.g. after "Use the sample text" | 1 |
| `#/new` | Clear | "Clear everything", inside the same fold | 2 |
| `#/new` | Reader (practice reader or Muse) | "Reader" (`reader`), open when Muse is chosen; its hint says which one is chosen | 1 |
| `#/new` | The advice of the approval | "N things to know", the shared inline fold | 1 |
| `#/charts` | Workflow toggles (hide or show one in every chart) | "Hide a workflow, show the band of seeds, or read every number" (`more`); in view the key is only a legend | 1 |
| `#/charts` | "Show the lowest to highest seed" | the same fold | 1 |
| `#/charts` | Table of every number | the same fold (it had a fold of its own) | 1 |
| `#/helps` | The full count: wins, ties and losses per setting and rival, and the buttons that list each result | "The full count" (`table`); it also opens by `open` (a cell asked for) and by the prop `unfold` | 1 |
| `#/helps` | How a result is decided, Conditions the decision rule names | inline folds (`rules`), under the map | 1 |
| `#/ablation` | Emails, Abstracts, Seed | "Change the notes or the seed" (`more`); it opens by itself when the form has a problem | 1 |
| `#/ablation` | The ablations on record | the newest four in view; "All N ablations on record" (`all`) when there are more | 1 |
| `#/ablation` | The six note filters | one select "Show", each option with its count; the definition of "where they differ" is still the hover of the select | 2 |
| Plan, Results | The raw plan, the raw report | the shared inline fold (`raw`) | 1 |
| Plan | Reason, Approve plan, Reject (disabled on a recording) | in view only while a run waits for a person; otherwise "Approve or reject the plan" (`approval`) | 1 |
| Events | Search, Hide the noise, the group chips | "Filter the events" (`filter`); its hint says whether the noise is hidden | 1 |
| Run strip, Results, Panels, Events, Plan | The tooltips of the proof chips, of the terms in the views' lines and of the plan's track ids | hover only, no tab stop: the bubble and a copy for a screen reader stay in the page | 0 |

Kept in view on purpose: the Pair select on Arena; the set picker of Charts; the rival select of Helps (it changes the map); the talks box and "Use the sample text" on New; the replay bar's play, step and scrub; the run picker and the proof chips of the strip.

### For W5 (director anchors; `director/targets.ts` is untouched)
- **Moved under a fold: `[data-helps="table"]` only.** It is inside "The full count" (`table`) on `#/helps`. A scene that points at it has to open the fold: the director's frame renders `<HelpsPage />` (`director/StageViews.tsx:48`) with no address of its own, so pass **`<HelpsPage unfold />`** there for the `table` scene (or any scene that needs the list buttons). `?details=table` in a real address does the same; `WhereItHelps`, `HelpsView` and `HelpsPage` all take `unfold`. `outcome`, `map` and `process` are in view.
- **In view, unchanged:** the arena anchors (`.side--swarm`, `.side--rival`, `.side__head`, `.side__proof`, `.side__board`, `.status`, `.work`, `.score`, `.arena__assumptions`), the run anchors (`.run__tree .react-flow__node`, `.run__grid`, `.meter`, `.runstrip__proof`, `.lens`, `.counters`, `.run__side`), `.tl, .timeline`, `.abl__head`, `.abl__caveats`, `.abl__break`, `.abl__notes`, `.metric[data-row]`, `[data-actor]`.
- Things a scene may have clicked or read that changed: the speeds are a select (`select[aria-label="replay speed"]`, on the run bar and the arena bar) instead of five `.speeds button`; the arena picker's Swarm and Rival selects are inside the `runs` menu; the ablation's filters are a select. The director and the home do not use the old selectors (searched `director/**` and `home/**`).
- `web/src/arena/**` stays mine until W5 comes back: `ArenaPage`, `ArenaTimeline` and `PairPicker` changed as in the table; `ArenaBoard` and the bands are untouched.

### Decisions and deviations
- The "Skip the tree" button is gone, not folded: the tree is one tab stop now, which solves what it was for.
- The lens's own nested folds (`lens-fold`: what the model was given, the answer as written, a piece's label) are native `<details>` and were not moved to the shared component: they only appear once a model call is selected and they nest three deep. Listed so nobody thinks it was missed.
- `#/helps` is one column: the table no longer sits beside the map (it was the part with 18+ buttons).
- The Charts key lost its toggles in view; a hidden workflow is still told to a screen reader.
- The guide's trailer for steps 1 and 2 are links ("Open the final run", "Start a run"); no step is a modal, a tour or a lock.
- No event model, `store.ts`, or any file under `home/` or `director/` changed.

### Counts and checks (RELEASE, Oct 30 night, `ee52fe1` plus this note)
How: one script (`controls.mjs`, in my scratchpad, outside the repo) on both builds, Playwright Chromium 130, exactly 1920x1080, dark, a fresh browser context per page, 2.5 to 5 s to settle. The new code is my dev server on 5176; the baseline is the committed arena bundle on 8765; both read the same API (8765, 33 runs), so the data is the same. Read-only: nothing was clicked that starts a run.

What is counted, in the window only (a control is counted when it is rendered, not inside a closed fold, and is the topmost thing at its centre):
- **controls**: links, buttons, inputs, selects, textareas, summaries and the `role=button`, `tab`, `switch`, `menuitem`, `checkbox`, `radio`, `slider`. A tree card, a mark of the bar and a band of a lane are each one control here, although each row is one tab stop.
- **tab stops**: what Tab walks through (`tabindex >= 0`, not disabled); a tooltip trigger with `tabindex=0` is one.
- The chrome of every app page is 7 (the brand, the four places, Guide, the theme); a run page adds 5 (the picker, Run, Results, More views, the meter). "First visit" has the guide open (4 more controls); "returning" has its flag set.

| Page | Baseline: controls in view / whole page | Baseline: tab stops | New, first visit (guide open): controls / tab stops | New, returning: controls in view / whole page | New, returning: tab stops | Words in view, baseline -> new |
|---|---|---|---|---|---|---|
| `#/run/demo-final?at=end` | 70 / 85 | 71 | 63 / 28 | 60 / 74 | 25 | 525 -> 490 |
| `#/run` (bare; the new one opens the final run, the old one opened the first listed) | 45 / 54 | 48 | 63 / 28 | 60 / 74 | 25 | 257 -> 490 |
| `#/runs` | 49 / 86 | 50 | 17 / 18 | 14 / 15 | 15 | 466 -> 105 |
| `#/arena/<swarm>/<rival>` | 49 / 55 | 49 | 22 / 21 | 46 / 52 | 19 | 209 -> 241 |
| `#/arena` (bare) | 44 / 50 | 44 | 14 / 17 | 27 / 47 | 18 | 208 -> 239 |
| `#/new` | 16 / 17 | 14 | 15 / 15 | 12 / 13 | 12 | 243 -> 188 |
| `#/charts` | 19 / 21 | 29 | 16 / 25 | 13 / 15 | 23 | 246 -> 241 |
| `#/helps` | 73 / 94 | 53 | 14 / 14 | 11 / 15 | 11 | 611 -> 409 |
| `#/ablation` | 13 / 14 | 14 | 15 / 16 | 12 / 13 | 13 | 87 -> 85 |
| `.../plan` | 44 / 47 | 49 | 42 / 30 | 39 / 42 | 27 | 468 -> 459 |
| `.../results` | 41 / 44 | 44 | 38 / 24 | 35 / 38 | 21 | 312 -> 302 |
| `.../panels` | 43 / 46 | 49 | 41 / 30 | 38 / 41 | 27 | 650 -> 641 |
| `.../security` | 41 / 44 | 43 | 39 / 24 | 36 / 39 | 21 | 290 -> 281 |
| `.../events` | 106 / 773 | 109 | 98 / 84 | 103 / 768 | 89 | 336 -> 327 |

The coordinator's baseline (`#/run` 53, `#/runs` 50 (87 in all), `#/arena` 50, `#/new` 17, `#/charts` 20, `#/helps` 74 (94 in all, 981 words)) is close to this script's for every page but `#/run`, which counted differently (this script counts the 22 tree cards and 18 marks as controls). `#/helps` has 981 words by `innerText` in the baseline, as the brief says; it is 783 now with the count folded.

Reading it, without dressing it up:
- Runs, Where it helps, New task and Charts are at about the brief's size once the 7 of the chrome are taken out (`#/runs` 14 in all: 7 chrome + Open the final run + 4 runs + 2 folds; `#/helps` 11: 7 + the rival select + 3).
- Run and Arena went from 71 and 49 tab stops to 25 and 19. Their controls stay at 60 and 46 only because each tree card, mark and band is still a button to click; each row is one tab stop.
- **Not much changed on Plan, Results, Panels, Security, Events** (21 to 27 tab stops, 89 on Events, whose list rows are buttons). Their first view is the chrome (12), the replay bar (5) and the cards; Plan also shows three disabled approval controls on a recorded run, and eight tooltip triggers are tab stops. Those views are one "More views" menu away now and were not part of the baseline list.
- The run page's visuals (the counters, the schedule grid, the event log) are what the page is for and are unchanged: its words in view went 525 -> 490.

The acceptance walk in the browser (`walk.mjs`), 22 of 22 passed: a first visit opens the guide (3 steps) and a bare `#/run` opens `demo-final` at its end (event 8771 / 8771); "Got it" closes it and stores `fractalswarm.guide.seen`; a later visit keeps it closed; the Guide button reopens it (`aria-expanded`); "Play from the start" moves the clock from event 0 (t = 2.65 s, event 325 after 2.5 s); "More views" lists Plan, Escape closes it, and Plan opens in two clicks; `?details=table` (helps), `?details=all` and `?details=start` (runs), `?details=more` (charts, ablation) and `?details=reader` (new) open their folds; a recorded run says why it cannot be killed and links to start a run, with its chaos controls folded; no page errors.

Found while checking, not mine: `t2-real-c3-swarm-seed1b` and `t2-real-c3-central-seed1` (the pair the arena page opens by address) show "Replay MISMATCH at seq 9" and "at seq 18" on the 8765 server. `POST /api/runs/<id>/verify` says the same: `first_divergence` 9 and 18, "effect.started differs in payload" on a `firewall` effect. Those two older recordings no longer replay under the current code; `demo-final` verifies (hash `a199a768072b`, `bundle_head_ok`). The page shows it as it is.

### The five More views (after the merge at `5f4519e`; the coordinator's go: fold the approval of a recording, tooltips out of the tab order, fold the events filter, a line for each view)
- Done as listed, commit `75db2e4`: Plan's approval is a fold unless the plan awaits a person; Events' filter is one fold; the proof chips, the terms in the views' lines (playhead, breakers, AIMD quota, market epoch, task spec) and the plan's track hints are no tab stops. `components/lens/lens.ui.test.ts` had a test that the takeover chip is a tab stop; it now says the chip carries the server's words as a hover and as text for a screen reader, and is none.
- A line that says what each view is for was already there (`RunFrame` asks for a `lead`): Plan "The plan the root proposed for this task, who approved it, and what the approved plan lets a subgoal do."; Results "What the run reported, how each goal was checked and what it spent, as they stood at the playhead."; Panels "Money, rate limits, breakers, memory, booking conflicts and escalations, as they stood at the playhead."; Security "Emails are scanned before any agent reads them, and every subgoal has to be a node of the approved plan. This is what was stopped, and why."; Events "Every event in the run's log up to the playhead, newest first. Press a row for its payload, or its number to move the playhead there." Not changed.
- Tab stops in the first view, returning visitor, before -> after (same script, same data): Run 25 -> 23, Plan 27 -> 20, Results 21 -> 18, Panels 27 -> 22, Security 21 -> 19, Events 89 -> 64. What is left is the chrome (12), the replay bar (5) and the page's own content: the events' rows are buttons (that is the list), and Panels still has the cap and the kill switch, three disabled controls on a recording, which were not on the list.
- The replay check's wording (the coordinator's "One more", commit `9620d4e`): when verify answers `ok` false with `chain_ok` true, the badge on the run strip and on both arena sides, and the Runs table, say "Log intact. This code does not reproduce this recording: first difference at seq N." in amber (`badge--warn`) instead of "Replay MISMATCH" in red; with no divergence number the sentence ends after "recording". `chain_ok` false stays red, as it was. It says nothing about the recording's age or version, which the check cannot know. One place makes the words (`lib/catalogue.ts`: `notReproduced`, `notReproducedWords`), used by `VerifyBadge` and `verifyWords`. Looked at in a browser on the two old arena recordings: the amber chip fits in the strip, and on an arena side it squeezes the run id next to the title (an ellipsis); no horizontal overflow.

### The run page, second pass (the coordinator's mail "The run page, not done yet", Oct 30 night): the tree is the page
- Commits: `68555d1` (the tree, the line, the Details, the wording) and the one after it (the phone bars and the controls fold), on top of arena `1dca2fc`.
- **The tree.** Fixed in the run page's own `TreeGraph` (the home SwarmTree draws a precomputed story slice, so it does not fit a live `ViewState`, and W7 owns it). Cards are 100 / 84 / 76 px wide (`lib/layout.ts`, kept in step with `.actor` in `styles.css`), 80 px between levels; the camera fits the tree to the pane up to 1.5x (`useTreeMotion.ts`) and re-fits when the pane is resized. Ids on screen, measured: 1920x1080 brains 25.5 px, leaves 22.5, fallen 21; 1366x768 17.2, 15.2, 14.2 (before about 6 px and 3 px).
- **Why it was small, and the rule that fixes it** (`forestOf` in `lib/layout.ts`, a view rule only; the reducer, the events and the replay are untouched). `tree.adopted` re-parents only a dead brain's children, so the adopter keeps its own parent and a root that died three times is a chain of dead brains (o0 -> o1 -> o2 -> o3 in demo-final): the tree was six rows tall and one colour. Now a dead brain whose ownership keys have all moved (`ownership.remapped`) is *fallen*: it leaves for a row under the tree, in the order they died, and what hung from it hangs from its nearest standing ancestor (so the root of the picture is the brain that holds the root duty, o3 at the end of demo-final, and a subtree has its heir's colour). A dead brain that still holds a key stays where it fell with its children under it: that is the picture of a death. A run with no ownership events (a baseline) keeps its dead in place.
- **The line** (`lib/runstate.ts`, `components/RunState.tsx`): "Finished: 48 of 48 talks placed, 5 coordinators crashed, replay verified." The headline is At the start / Running / Replaying (playing) / Paused (stopped midway) / Finished / Halted / Interrupted / Ended without finishing; "so far" says a count can still change; "replay verified" only at the end of a recording the replay check has passed. Three numbers beside it: coordination tokens, hand-overs, spent.
- **Under Details** (`<details id="more">`, closed): the other counters, the T2 schedule with its violations badge, the chaos list, the event log. The schedule is in Details, not Results (my call). The Muse meter is a fold in the strip, "What the models cost" (`id="meter"`); the meter inside is unchanged. `<RunPage unfold />` and `<RunStrip unfold />` open them (for the director's stage), and so do `?details=more` and `?details=meter`.
- **Wording.** "finished" instead of "0 actors alive" on a finished run; "1 call lost"; "membership changes" for member epoch (same tooltip); the button says "Play from the start", "Pause" while it plays and "Carry on" when stopped midway.
- **The phone (item 4).** The shell's bars wrap under 760 px (`components/shell/shell.css`): brand, guide and theme are a row, the four places the next, the run picker is full width. Checked at 390x844 on all twelve app pages: no sideways scroll (it was 269 px). Also on the run page: the replay bar wraps in two rows (the speed label is hidden, the select keeps its aria-label), the three numbers wrap, the strip's fold drops its hint. The tree itself was still the whole tree in 358 px (ids about 5 px at 390) here; the sideways tree below is the fix.
- **The controls (item 5).** `RunControls` (cap input, Apply cap, Kill switch) is `<Details inline id="controls">` on a recording and in view while the run is live, the plan approval's pattern; "recorded run: controls available on live runs" stays in view.
- **The lens drawer** (`.lens`, `styles/lens.css`) was anchored to the bottom of `.run`; the page is now as tall as its content, so with Details open it would have been 3.8k px tall. On the run page it is as tall as the window leaves it (815 px at 1080p), open or closed. A click on a card opens it; note that a click with no time between mouse down and up (a script's `page.mouse.click`) does not reach the card through React Flow's pan handling, a person's does: script it with a 60 ms pause.
- **For W5 (director anchors; `director/` untouched).** Kept: `.run__tree .react-flow__node`, `[data-id="oX"]`, `[data-actor]`, `.timeline`, `.runstrip__proof`, `.lens`, `.run__tree`. `.counters` is now the headline row (first in the document, so `region(RUN, ".counters")` takes it). In closed folds (in the DOM, not visible): `.run__grid`, `.run__side` and the full counters row in `#more`; `.meter` in `#meter`. New: `.runstate`, `.run__legend` (a React Flow Panel), `.run--overview`, `.actor--fallen`, `#controls` on Panels. `$crashed:N`, `$heir:N` and `$root` still resolve; the top node is the brain that holds the root duty.
- **Checks.** tsc clean; web suite on one worker, 81 files and 1241 tests green outside `src/home`. New: `lib/layout.test.ts` and `lib/runstate.test.ts` (against the committed `demo/final` log), run page line / fold / button, singular call, strip fold, controls fold, the shell's phone rules. Not mine and red on the arena head: 35 tests in `src/home/viz/charts/{dots,line,pairs}.test.ts` and `src/home/viz/redesign.test.ts` (W7's; they expect "3 seeds" and the old numbers, the data is 10 seeds now).

### The coordinator's list of Oct 31, 00:15 (the phone tree, the honest label, Ablation, Trade-offs, the arena at 390)

- **#/helps says what its counts were made on (b).** The page reads `honesty.json`, which is the $0 evidence (the sources are `rivals-gate` and the sweeps: fake model, simulated clock, `docs/claims.md` "Against the rivals"), and no word on it said so. One line under the head, before the outcome strip and every count, in view and in no fold: a tag "Fake model, simulated clock", then "The $0 runs: they check the design and do not measure the real model, so a win or a tie here is not a real-run result. The real-model reading is on the evidence page." (a link to `#/evidence`). The sentence "it checks the design; it does not measure the real model" is the one `lib/heroText.ts` already says for the fake set (bench/REPORT.md section 3). Only on the panel: the loading, missing, unreachable and invalid states show no counts, so they state no setting. `data-helps="setting"` is a new anchor for W5 (`director/` untouched); the old four stay.
- **Trade-offs (d).** The tab, the page title and the tab's announcement are "Trade-offs" (`EVIDENCE_TITLES.helps`, `HelpsHead`, the section's aria-label, the arena Scoreboard's pointer). The route `#/helps`, the stage id `helps` and the `data-helps` anchors stay. `home/copy.test.ts` already bans "where it helps" in the home's copy (R4 is a tie at ten seeds); the app now agrees. Not changed: docs or the home's prose, if either still says "Where it helps" (`grep -ri "where it helps" docs README*` is the check).
- **The Ablation tab (c).** The Evidence row shows Ablation only once an ablation is on record (`isAblationRun`, the page's own predicate, over the runs the store lists), or while the person is on `#/ablation`. The route and the launcher stay. The tab appears when the run list has loaded and names one.
- **The arena at 390 (e).** `.side__top` wraps under 760 px, so the card's "Replay verified" goes under the title from the left. The pair's closed select cut its name ("swarm vs durable-max, half-tl"), and three of the six pairs differ only in "private" and "billed": under 760 px the whole name is shown wrapped (`.picker__shown`) with the select laid over it, unseen, to take the tap; off a phone the select is the control as before and may be 520 px wide instead of 260. Not done, W5's: the arena's own boards (`ArenaBoard`) are still the whole tree in a card 326 px wide at 390 (ids about 6 px).
- **The tree on its side (a).** Under 760 px (`lib/phone.ts`, `usePhone`, the same width as the sheets) the run page's tree is turned: the levels are columns left to right, the siblings are stacked, the fallen are the last column (in the order they died), the colours and the adoption edges are the same. `layoutTree(view, across)` takes the orientation (the default is the upright one, unchanged: `layout.test.ts` and `motion.test.ts` pass as they were); a card is `ACROSS` wide (54 brain, 62 agent, 58 fallen, 27 high, 4 between cards, 12 between columns) and the camera shows it at a scale of one, so the ids are `--fs-body`, 14 px, on screen (measured: zoom 1, 14 px, at the end and halfway). Four levels and the fallen are 346 px wide, which fits the 356 px pane. The pane is as tall as the tree (12 agents are 384 px), the page scrolls past it, and a touch on it scrolls the page (`panOnDrag`, pinch and wheel zoom off, `touch-action: pan-y` on the pane: React Flow's sheet says `none`). Hidden on its side: the legend panel, the "adopted by" pill and the "restarting" line (they hang off the card into its neighbours; the title and the ring say it). The cards' sizes are in `styles.css` `.actor--across`, and a test reads them against `ACROSS`.
- **What a phone shows first.** The bars above the page (shell, run bar, strip) are 270 to 370 px of an 844 px window and the replay bar 112, so the page has about 360 px, and the tree is reached by scrolling a little: the state line is the first thing under the bars and the replay bar stays at the foot. Not done (not asked): the three numbers beside the line are two rows at 390 because their labels do not wrap; with wrapping labels they fit one row and the tree comes up by 60 px.
- **Looking at it without the server.** The API on 8765 was down for this check, so the shots use a stand-in for the run API that serves `demo/final/events.jsonl` (`page.route` in Playwright's Chromium 130; nothing is written). The "Replay MISMATCH" badge on those shots is the stand-in's verify answer, not the page.
- **Checks.** tsc clean; the web suite outside `src/home` on one worker, 92 files and 1477 tests. New: layout tests for the sideways tree (same cards and hangings, columns, no card on its neighbour, fits 356 px at four levels, taller than wide at the end, the fallen last, the sheet's widths), the helps setting line, the Evidence row with and without an ablation, the arena's phone rules and the picker's whole name.

### The first coordinator's review of the run page (Oct 31, 00:49): the wheel, the line's tone, the first crash, Details, the key, the 501, the hand-overs

- **The wheel (1).** `preventScrolling={false}` on the tree's ReactFlow: a plain wheel over the tree scrolls the page, and Ctrl and the wheel (a trackpad's pinch) still zooms. Looked at in headless Chromium at 1366x768 on demo-final: five notches leave the zoom at 1.014 (cards 77 px) and move the page; Ctrl and the wheel takes it to 0.669 (cards 51). The phone's pan, pinch and double-click zoom stay off (`ON_A_PHONE`).
- **The line's tone (2).** At the end of a finished recording `stateLine` adds "N unplaced" when the talks placed are fewer than the plan's, and "N hard violation(s)" when the final check found any (`view.schedule.hardViolations`, null until the check lands), and its dot is the warn tone, not green. A replay on its way, a live run and a halted run say nothing of it. I have not seen t2-real-seed1 itself; the case is built from demo-final with 16 cells taken out.
- **Watch the first crash (3).** `components/PlayAction.tsx`: on a recording with a coordinator kill, stopped at its start or its end, the main action is "Watch the first crash" (primary) with "Play from the start" beside it. It moves the playhead to 3 s before the first `coordinator-kill` mark (`lib/timeline.ts` `firstCrashStart`, 50.3 s on demo-final), sets the speed to 1x and plays, in that order (playing a recording that stands at its end starts it from the beginning). Only the playhead moves; the log stays whole. Midway the action is "Carry on", while it plays "Pause", and a run with no coordinator kill has "Play from the start" as before. The empty tree at the start offers the same two, so the page does not have two main actions. A click on a mark of the bar moves the playhead and nothing else, so a replay that is playing carries on (a stopped one stays stopped); dragging the slider still pauses.
- **Details and height (4).** `<Details reveal>` (a new prop of `components/ui/Details.tsx`, used by the run page's fold only): a person's click on the summary scrolls the fold to the top of the page (smooth, plain under reduced motion; `scroll-margin-top` 12 px), a prop or an address does not. Measured at 1366x768: the bar lands 12 px under the top of the page with 498 px of its body in view above the replay bar; before, the click changed only the chevron. The Run title and its lead are off the run page (the sub-nav and the state line say both; an `h1.sr-only` "Run" stays for the heading outline) and the play actions sit on the state's row, between the line and the numbers. At 1366x768 the tree starts at y 233, not 282, and the pane is 381 px tall instead of 338 (it takes the slack, so the page no longer scrolls there); at 1920x1080 the pane is 683 px. The live run's lead ("Kill half the brains and watch the rest take over") went with it. Anchors: nothing in `director/` looked for the header or the old button; the actions are `.runstate__actions`.
- **A short window (4).** At 1366x650 the Details bar was 15 px behind the pinned replay bar at the top of the page. Under 700 px of height the rows of the run page sit 8 px apart and the tree's least height is `clamp(280px, 44vh, 680px)`; the bar's foot is then 8 px above the replay bar (demo-final through the live API). A strip two rows tall (the Muse meter fold and a long badge, as on t2-real-seed1) pushes the page down by its second row, so a window that short still scrolls a little there.
- **On the real API (2, 6).** t2-real-seed1 reads "Finished: 32 of 48 talks placed, 16 unplaced, 16 hard violations, no coordinator crashed." with the warn dot. The page of demo-pair-central-rival makes no request that is answered with an error and logs nothing to the console.
- **The phone's first screen (4, last).** At 390x844 the tree starts at y 417 on landing and 487 midway (was 604): the title, lead and a full-width Play row are one row of two buttons on the state's row, and the three numbers are one row (labels wrap, values at `--fs-lead` and `--fs-title`, no overflow). About 250 px of the tree is on the first screen. The bars above the page (270 px) are the shell's and I left them.
- **The key (5).** `frameTree` (a pure function in `components/useTreeMotion.ts`) keeps the cards below the key of the tree, measured, because it wraps as the pane narrows: in the rootless seconds (53.3 to 58.8 s) three brains stand in the top row and the leftmost was under the key. The tree is 4.5 percent smaller at 1366x768 on that frame (zoom 1.014 to 0.968). A tree on a phone has no key.
- **The 501 (6).** `isSupervisorLog` (`lib/takeover.ts`, the server's own rule: a `baseline.crashed` in the log): the store takes such a log's takeover as absent without asking. All four rival logs in demo/ have five.
- **The hand-overs (7).** The counter's hint says one coordinator's root duties and its subtree are two hand-overs, so there can be more of them than crashes (demo-final: o1 and o2 hand over twice each; 5 crashes, 7 hand-overs).
- **Looking without the server.** 8765 was down again: the shots use `page.route` serving `demo/final/events.jsonl` (nothing written). The red "Replay MISMATCH" badge on them is the stand-in's verify answer.

### The first coordinator's review of 8c4ae3a (Oct 31, 02:00): a rival's supervisor, two presses, the phone, the guide

- **A rival's supervisor (1).** `crashedCoordinators` (`lib/runstate.ts`) is the larger of three counts: the brains down at the playhead (killed or dead: a swarm's false deaths are in this one only), the `kill_coordinator` faults injected so far (a restart undoes none; the leaf kinds a fault names are not counted), and the supervisor's crashes in the log (`view.supervision.crashes`). Before, a rival's supervisor was up again after each crash, so every rival's page said "no coordinator crashed" beside five red marks, and the count fell back to 0 between crashes. Where the log holds supervisor crashes the clause is "its supervisor crashed 5 times" ("2 times so far" on the way), the arena's end card's words. demo-pair-central-rival now reads "Finished: 48 of 48 talks placed, its supervisor crashed 5 times, replay verified". A swarm reads as before ("5 coordinators crashed").
- **Two presses (2).** Not the phone's layout: a finger's tap (touchstart, touchend, then mouse-down and mouse-up in one task) opened none of 5 cards at 390 and none of 6 at 1366, and a mouse press escapes it only when it is held for a frame. Every render of the tree makes new node objects, and React Flow takes a node object with no `measured` for a new node: it forgets its size and handles, hides it (`visibility: hidden`, which is also out of the hit test) and measures it again on the next frame (`useNodeObserver`, a ResizeObserver). The press renders the tree (the focus sets the card Tab lands on), so the mouse-up that follows in the same task landed on the pane and the click went to the pane. It is true of every render: while a replay plays the tree renders 20 times a second, and in 3 s the 22 nodes went hidden 1364 times, 12 ms each (a quarter of the time, seen with a MutationObserver on the nodes' style). It did not make a held click fail: on the old code a mouse click held 80 ms while the replay played opened 16 of 16 cards in headless Chromium, and a touch tap opened none of 11 whether it played or not, because the press itself renders. So the playing case is a window that exists and that I could not catch with a real press; I do not claim more of it. `useTreeMotion` now hands each node back with the size React Flow measured (`keepSizes`, from `getInternalNode`), after the glide has set the positions. Measured on demo-final: taps open 5 of 5 (390) and 6 of 6 (1366) on the first press with the replay paused, 4 of 4 and 6 of 6 while it plays, and the nodes go hidden 0 times in 3 s of playing. The edges still follow the cards through the root's takeover. Not done: the nodes are still new objects on every render, so the library still builds its internal copy for each at 20 Hz; a node whose data did not change could be the same object (the card memo would then skip it too).
- **Watch on a phone (3).** On a 390x844 phone 370 px of bars stood above the scroller and 110 px of replay bar below it, so the tree started at y 569 and Watch the first crash showed a line that said a coordinator had crashed with o0's cross out of sight. Under 760 px the run page (and no other: `.app--run`, set in `App.tsx` for the run overview) is scrolled as a page: the top bar, the strip and the guide go up with it, and only the replay bar stays (it was sticky already). The lens, a drawer over the window, is fixed. A press on Watch the first crash, Play from the start or Carry on scrolls the state row to the top of the window (`bringRunIntoView`, in `PlayAction.tsx`), after the next frame: a run at its start has no tree yet and the page is too short to scroll that far before it has one. A wider window shows the tree on its first screen and nothing moves. Measured on demo-final at 390x844, 5 s after Watch: the state row is at y 55, the tree at 242 to 644 with all 22 cards and o0's cross at 429, over the replay bar at 734. Details lands 12 px under the top of the window on a phone, as before at 1366.
- **The guide (4).** `useGuide` has three modes (`GuideMode` in `lib/guide.ts`): a first visit gets the short band, "Guide" in the top bar adds what each step says (and closes it when it shows), "Got it" closes it for good. The short band is a heading and where it is done for each step, one row each (the number, the heading, the link), "Got it" beside the last row at 1100 px and under, in the row's free space. Measured: 105 px at 390 (was 446), 55 px at 1366 (was 143), 105 px at 900 (was 316). The full band is as it was (446, 143, 316). The sentences are not in the short band's markup at all, so a screen reader gets the headings and links, and the Guide button for the rest.
- **The lens's close button (low).** `.icon-btn` is 36 px and the lens header's chips squeezed it to 23 px of width on a phone: it keeps its size (`flex: none`), and under 760 px it is 44 by 44. Not done: the Details bar at 1280x585 is behind the replay bar until the page is scrolled (the tree's least height is 280 px, and the rows above it and the bar leave less than the bar needs); and the state line wraps to two lines at 1366 beside its two buttons when a rival's sentence is long.
- **Looking.** 5176 (my dev server) in front of the API on 8765 for the arena, a stand-in for the run API (`page.route`, serving `demo/final/events.jsonl`) for the run page; the red "Replay MISMATCH" badge on those shots is the stand-in's verify answer.

### The first coordinator's review of 96b24af (Oct 31, 03:05): the focus on Pause, the replay bar's place

- **The focus on Pause (1).** `keepFocusOnPause` (`components/PlayAction.tsx`): the start buttons (the row's two and the empty tree's) give way to Pause when the replay plays, so a key press on one that has the focus left it on the body and Space pressed nothing. Reproduced first, with Playwright's keyboard on demo-final at 1366 and 390: Enter on "Play from the start" (row or tree) and on "Watch the first crash" in the tree left the focus on the body, and Space did nothing (the replay carried on); Enter on "Watch the first crash" in the row was the one case that kept it, because React reuses the first button of the row for Pause (the row's children are an array, and Watch is its first). Now the press gives the focus to the Pause button (`data-replay-pause`) after the next frame, `preventScroll` so that it does not fight the phone's scroll to the row; only a button that has the focus gives it up (a click that did not focus it, as Safari's buttons, moves nothing). All four cases at both widths: the focus is on Pause, and Space pauses ("Paused: at ...", the action says Carry on). Pause and Carry on were one element already.
- **The replay bar's place (2).** The bar stood 12 px above the foot of the window where the page ended (the page's own bottom padding) and flush with it where the page went on and the bar was sticking (`bottom: 0`), so it moved by 12 px whenever the page's foot came within 12 px: a phone's tree changes its height as the replay plays, and the page's foot with it (722..832 and 734..844 at 390x844). One variable, `--foot` (12 px; 8 px in a short window, where the rows sit closer), is the page's bottom padding and the sticky offset and the strip's shadow, in both sticky rules (`.run--overview > .timeline` and the `max-height: 900px` one for `.run > .timeline`). Measured at 390x844 from 200 px to 0 px from the foot, and with Details open at the foot: the bar is at 722..832 every time. At 1366x768 and 1920x1080 the gap is 12 px, and at 1366x650 it is 8, closed and open, at five scroll positions. This is the bar's resting place everywhere (the other run views too), not only the phone's; the place it rests in did not change, only the place it stuck in.
