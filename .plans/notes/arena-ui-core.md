# W4 ui-core: notes

Branch `Yoelcanarion/arena-ui-core`. Web only: no Python was touched.

## Status

| Step | State |
|---|---|
| 1 Tokens and theme | done |
| 2 Fonts and icons, offline | done (bundle not yet checked for network use: needs a build slot) |
| 3 Store factory, shared clock, fixed step | done |
| 4 Reducer additions | done, checked against `takeover.analyze` on 3 real runs |
| 5 Motion | next |
| 6 Controls state | next |
| 7 Shared components | done: `Stat`, `ModelBadge`, `Card`, `Skeleton`, `Tooltip`, `ThemeToggle` |
| 8 Proof surfaces | next |
| 9 Muse lens | next (fixture until W3 merges) |

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
- Which endpoint backs the "takeover OK" chip (step 8)? `/api/runs/{id}/takeover`?
- The W3 lens shapes and the W1 fixture, when they merge.

## Status when the usage limit hit (Oct 29, 01:47 CET)

Commits on `Yoelcanarion/arena-ui-core`: `c292602` (steps 1-4 and 7; merge_ready sent), `fd9b341`
(steps 5 and 6), `bf09899` (step 8, timeline). At `bf09899`: typecheck clean, vitest 19 files / 266 tests.
Not run since `fd9b341`, because they need a SLOT: web build, `uv run pytest`, ruff, `tests/integration/test_api.py`,
`fractalswarm demo --verify`.

### Done since the first merge
- **Step 5, motion.** Tree glide in JS (`lib/glide.ts`, `components/useTreeMotion.ts`), camera fit only when the
  structure changes, grid cells animate only on a new placement, charts animate on first draw only, reduced motion.
  Dev frame logger: open the app with `?frames` on a dev server (or a scratch build with `VITE_FRAME_LOG=1`) and
  read `window.__frames.report()`. **The frame-time numbers are not measured yet.**
- **Step 6, controls.** `lib/controls.ts`, `components/ControlButton.tsx` (`useControlState`), `StatusBadge`.
  The store has `runStatus` (from the catalog), `capabilities` and a 5 s status poll while a run is live.
  A crashed run (catalog `interrupted`) opens as a recording and is no longer tailed.
- **Step 8, partly.** Timeline marks (`lib/timeline.ts`: coordinator kill tall and red, agent kill, crash, restart,
  adoption, verdicts, collisions, halt), each mark jumps to its moment; the playhead is a 6x24 px thumb.
  `VerifyBadge` already goes pending -> "Replay verified ✓ hash match <12-char head>"; no change was needed.

### Not done
- **Step 8:** the "takeover OK" chip. No takeover endpoint exists. The check is `verify.takeover.check_run` /
  `analyze` -> `TakeoverReport.ok` (+ `violations`).
- **Step 9:** the Muse lens (side panel with `motion/react` AnimatePresence, the Muse meter in the top bar, a fixture
  until W3 merges).
- **Measurements and visuals:** frame times on `t2-real-c3-swarm-seed1b` (14,047 events) at 20x; before/after
  screenshots at 1920x1080; the static build into `src/fractalswarm/api/static/` with the stale hashed assets removed.
- **Final checks** listed in the brief, then `worker_done`.

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
