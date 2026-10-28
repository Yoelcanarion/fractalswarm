# Worker brief W4 — `ui-core`

- **Branch:** `Yoelcanarion/arena-ui-core`. The coordinator created it from `Yoelcanarion/arena` as a child worktree, and you are already in it: do not create another worktree or branch.
- **Model:** Sonnet 5.5 at max effort. Invoke `/hard-task` for the design-system decisions and the motion architecture.
- **Setup:** run `uv sync` and `npm --prefix web install` first.

## Read first
- `CLAUDE.md` (binding).
- `.plans/arena-spec.md`:
  - §0, the north star: the UI serves three answers (the problem, why Meta's models matter, the evidence);
  - §F in full;
  - §E.2, the Muse lens;
  - §D, live input;
  - §G, director mode.
- Everything in `web/src/`: `store.ts`, `App.tsx`, `lib/*`, `components/*`, `pages/*` and `styles.css` (2,002 lines).
- `src/fractalswarm/api/{app,ws,catalog}.py`, read-only, to know the endpoints.
- The skills `better-ui` (surfaces, icons, motion values) and `animate` (motion decisions). Load them when you start steps 1 and 5.

## Context
The UI is a pure projection of the run event stream, live or replayed: React 18.3.1, @xyflow/react 12.12, recharts 3.10, zustand 5, Vite 8, TypeScript 7 and vitest 5. The build is copied into `src/fractalswarm/api/static/`, and `fractalswarm demo` serves it with no network and no Node.

It is the main surface of a 3-minute video recorded at 1920×1080.

**Day 9's review found:**
- **Edges detach while nodes glide:** the nodes move by CSS transition, and React Flow does not recompute the edges in between.
- **The camera jumps.**
- **Highlight lifetimes count events, not time:** `MESSAGE_TAIL = 14` and `ADOPTION_GLOW = 60` in `TreeGraph.tsx`.
- **The page re-renders on every frame:** `useRun()` is used without selectors.
- **67 hex literals.**
- **Fonts are declared but never loaded.**
- **Dark theme only.**
- **Chaos, approve and submit answer 501, but their buttons are enabled.**
- **A single global store, with module-level singletons** (`folder`, `stopTail` in `store.ts`).
- **`baseline.crashed` and `baseline.restarted` are not projected:** a supervisor shows a permanent ✕.

## Your job, in order
Your first merge comes after step 4. Tell the coordinator when it is ready, because W5 (the arena) builds on it.

### 1. Design tokens and theme
- Replace every hex literal (CSS and TS, e.g. `lib/layout.ts` `colorOf`) with CSS custom properties on `:root`. Define:
  - surface, border, text and muted tokens;
  - an accent;
  - ok, warn and danger;
  - **one ownership palette of 10 distinct, colour-blind-safe hues** for the orchestrators;
  - **model badge colours** for Wonder, Spark, Spark Contributor and PromptGuard;
  - type, spacing, radius, shadow and z-index scales.
- **Dark stays the default**, because the video uses it. Add a light theme under `[data-theme="light"]`, so both work from the same tokens.
- Contrast must read well on a 1080p video: body text at least 14 px, and AA contrast.

### 2. Fonts and icons, offline
- Bundle Inter and JetBrains Mono through `@fontsource` packages imported in `main.tsx` (variable fonts if available). Pin exact versions.
- Icons come from `lucide-react`, imported one by one.
- Check that the built bundle needs no network: run `uv run fractalswarm demo` with the network off, or check that the built CSS references no external URL.

### 3. Store factory and selectors
- Add `createRunStore()`, a vanilla zustand store (`createStore`). Its playback `Folder` and its tail subscription live **inside the instance**, not at module level.
- Add `RunStoreProvider` (a context) and `useRunStore(selector)`. Use `useShallow` for object selections.
- Keep `useRun` as the default instance, so existing pages keep working. Migrate the components to narrow selectors, so a playhead tick re-renders only what depends on it.
- **A shared clock.** One `requestAnimationFrame` loop drives any number of stores at the same virtual time and speed. W5's arena plays two runs side by side on one scrubber. Expose `createClock()` and `clock.attach(store)`, or an equivalent you document.
- **Throttle playhead writes:** commit to the store when the cursor changes, or at most every ~50 ms of real time.
- **Director mode** (W5) needs a **fixed-step** mode: advance the virtual time by `speed × 1/60 s` per frame, with no real frame time, so takes are identical.

### 4. Reducer additions: pure and tested
1. **The supervisor's crash and restart.** Project `baseline.crashed` and `baseline.restarted`:
   - the coordinator node goes **down**, then shows **restarting** with a ring that fills over the crash-to-restart virtual time (5 s in the main runs), then returns;
   - count the contracts that were redone and the results that were adopted, from the payloads.

   Today's payloads are in `actors/orchestrator.py` (`_crash` at about line 1374, `_restart` at about 1422) and in `baselines/supervisor.py`.
2. **The durable modes' events.** W1 adds them (`durable-max`, `durable`). Use the shapes in `.plans/arena/w1-rival.md`; if they change, the coordinator relays the change. Test with synthetic events until W1 merges.
3. **Arbitration events:** `arbitration.requested` and `arbitration.ruled`, from W3 (shapes in `.plans/arena/w3-meta.md`).
4. **Highlight decay by virtual time, not event counts.** For example, a message edge stays lit for about 1.2 s and an adoption glows for about 4 s of virtual time, at any speed.
5. **Running counters for the arena,** as a pure fold:
   - cost so far;
   - coordinator crashes;
   - coordinator down-time;
   - agents idle while their coordinator is down;
   - re-dispatches;
   - duplicated calls;
   - hard violations.

   **They are display values.** The official numbers come from W1's metrics through the API. Add a vitest case that checks the fold's final values against the Python metrics on one fixture run. Ask the coordinator for the fixture once W1 has merged.

**→ First merge:** tokens, fonts, icons, store factory, shared clock and reducer additions. Report it to the coordinator.

### 5. Motion
Add the `motion` package (`motion/react`), pinned.
- **Tree:** tween the React Flow node positions in JS (rAF interpolation of `position` in the nodes array), so React Flow recomputes the edges every frame and they stay attached. Remove the CSS position transitions.
- **Message edges:** fade in and out by age in virtual time.
- **Camera:** call `fitView` only when the structure changes (a node added, removed or re-parented), with an eased `duration`. Never refit on every event.
- **Count-up numbers** in the stat component (step 7).
- **The schedule grid:** a cell animates only when a new placement lands there. Memoize `ScheduleGrid` and key its cells by placement.
- **Charts:** animate on the first draw only, not on every tick.
- **`prefers-reduced-motion`:** jump instead of tweening, and keep the fades short.
- **Budget:** about 60 fps on the biggest recorded run (16k events) at 20×. Measure frame times with a dev-only rAF logger, and report the numbers.

### 6. Controls state
- **Chaos, approve and new task are enabled only on live runs where the API supports them.** W2 wires the endpoints; until then, disable them with a tooltip ("available on live runs").
- **On recordings they are always disabled.**
- **Run status comes from the catalog.** W2 fixes "crashed runs show as running"; show crashed and finished runs as such.

### 7. Shared components
- `Stat`: label, value, unit, delta and count-up.
- `ModelBadge`: Wonder, Spark, Contributor and PromptGuard.
- `Card`, `Skeleton` (loading states), `Tooltip`.
- Visible focus rings and hover states everywhere.

W5 uses these, so keep their props small and documented in the file.

### 8. The proof surfaces
- **`VerifyBadge`:** goes from pending to "Replay verified ✓", with a short hash.
- **A "takeover OK" chip,** when the API exposes the takeover check. Ask the coordinator which endpoint, or whether W2 adds one.
- **The Timeline:** crash markers (coordinator and agent kills) and the playhead, readable at 1080p.

### 9. The Muse lens UI (spec §E.2)
- **The backend is W3's** (`.plans/arena/w3-meta.md`).
- **Clicking a node or a call opens a side panel with:**
  - the model badge, effort, tokens (input, cached, reasoning, output), cost and latency;
  - the readable output: facts next to their highlighted source sentence, placements, the judge's reasons, blurbs.
- **The "Muse meter" in the top bar shows:**
  - $ and tokens by model;
  - the share of input tokens served from cache;
  - "coordination tokens 0 · recovery tokens 0".
- **Build it against a fixture** until W3's endpoint merges.
- **If W5 is overloaded,** the coordinator may move the arena's "where it helps" panel to you instead; keep the lens first.

## Not yours
- `web/src/arena/*`, `web/src/director/*`, the intake, review and ablation UI, and `scripts/record_scenes.*`. They are W5's, and W5 builds on your store factory, clock, tokens and components.
- All Python. If an endpoint is missing, ask the coordinator: W2 owns `api/`, and W3 owns the lens endpoint.

## Tests and checks
- vitest for every new pure fold and helper: the reducer additions, the virtual-time decay, the clock (fixed-step included) and the selectors.
- `npm --prefix web run typecheck`, `npm --prefix web test` and `npm --prefix web run build`. Copy the build into `src/fractalswarm/api/static/` and remove stale hashed assets.
- `uv run pytest tests/integration/test_api.py` and `uv run fractalswarm demo --verify` (MATCH).
- **Visual check: screenshots at an exact 1920×1080.**
  - There is no Chrome or Edge on this machine. Use Playwright's Chromium at `~/AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe`, driven by `playwright-core@1.48.2`.
  - `npm install` it into a scratch dir outside the repo, then `chromium.launch({executablePath, headless: true})` and `newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})`.
  - Use `#/run/<id>?at=end` or `?at=<n>` to seek.
  - Attach before/after screenshots of the run page to your report.

## Hard rules
- No real Meta API calls; recorded runs and the fake LLM only.
- At most one dev server, and only while you need it. Stop it when the coordinator sends HOLD, and don't run test suites or builds until RELEASE.
- Don't edit `.plans/progress.md`. Write your notes to `.plans/notes/arena-ui-core.md`: done, deviations, issues, and what W5 needs to know.
- Every user-visible string is in English.

## End
- Green: typecheck, vitest, build, `uv run pytest` and `uv run ruff check`.
- Commit on your branch. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Don't commit `node_modules`. Don't merge or push.
- Report to the coordinator: the branch, the commit, the test counts, frame-time numbers, screenshots, done and not done, and deviations.
