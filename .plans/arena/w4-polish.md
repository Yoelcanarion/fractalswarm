# W4 `ui-core`, round 2: polish the whole app

Yoel's second priority (arena spec §M.2): polish the web UI, every screen, then the whole app. Your first brief (`.plans/arena/w4-ui-core.md`) and your notes (`.plans/notes/arena-ui-core.md`) still hold. Merge `Yoelcanarion/arena` into your branch first.

W6 and W7 build the home page at `#/`. You own everything behind it, except the arena and director mode, which W5 will take. Your job is to make every screen feel finished: a stranger who comes through the home page's menu must understand each screen at a glance, never hit a dead end, and never see a rough edge.

## How to work

1. **Audit first.** Capture every screen at 1920×1080 and 1366×768, dark and light, on a real log (`demo/backup`) and on an empty state. Read the images yourself, hard. Write a ranked list in `.plans/notes/arena-ui-core.md`: what is broken, what is confusing, what is merely unpolished. Send the coordinator the top of the list (`status`) before the fixes, in a few lines.
2. **Fix in that order,** in small commits, with `merge_ready` every few fixes. Look again after each.

## What to look at, in this order

1. **The app shell.**
   - The top bar has 12 flat tabs. Give it a structure: the app's main places (Arena, Runs, New task, Evidence), and the run's own views (Run, Plan, Panels, Security, Results, Events) only inside a run. A way back home. Do this **only after W6's first merge** adds the home route to `App.tsx`; the coordinator tells you when.
   - Page titles (`document.title`), a clear current place, and route changes that do not flash.
2. **The run page.** It is what people see after the home page. Fit at 1366×768. Tree, schedule, counters and timeline should read as one picture. A short first-time explanation of what is on screen, and what the playhead does.
3. **Runs.** A real catalogue: what each run is, in words (task, profile, rivals, verified or not), not only ids. Sort and filter. Replays and live runs clearly apart.
4. **Charts.** It should read as an extension of the home page's evidence, with the same honesty captions (setting, seeds, real or fake).
5. **Results, Plan, Panels, Security, Events.** Consistent headers and one sentence on what each view is for; tables, numbers and empty states that match; jargon explained where it appears (C0–C3, T1 and T2, stall, blast radius, HRW, epochs, breakers) through the shared `Tooltip`.
6. **New task and intake, ablation, where it helps.** They are W5's files, but W5 is not running yet: apply the shared fixes there (headers, empty and error states, 1366×768 fit). Do not touch the arena or director mode.
7. **Everywhere:** loading skeletons instead of blank panels; an error state with a way out for an unknown run or a stopped server; focus-visible and keyboard use; no layout shift; `prefers-reduced-motion`; text never below `--fs-body` when a person reads it; light theme as good as dark.
8. **Performance:** the heavy run page was 37 fps at 20x (software rendering). Find what is left to gain without losing the look. Re-measure in a RELEASE window.

## Rules

- Everything in `.plans/arena/worker-rules.md`. No real calls.
- Web only: `web/src/**` except `web/src/home/**`, `web/src/arena/**` and `web/src/director/**`. `web/src/App.tsx` only after the coordinator says so. Nothing under `src/fractalswarm` except the rebuilt static bundle if you are told to commit it (the coordinator rebuilds at merge).
- Claims: `docs/claims.md` is the only source of a comparative sentence. Do not add any.
- Keep the tests honest: when a test pins a word you change, change it for a reason.
- Slots: browsers, dev servers and builds run only between the coordinator's paid blocks. You get RELEASE when they are allowed and HOLD when they stop; no need to ask inside a RELEASE window. Your dev server's port is 5176. On HOLD, keep working on code, `tsc`, and vitest on one worker (`npx vitest run <dir> --maxWorkers=1`).

## Acceptance

Before and after screenshots of each screen in your notes (paths, not the images), typecheck and vitest green, `demo --verify --no-serve --no-browser` MATCH, a frame-time reading, and nothing in the console on any screen.
