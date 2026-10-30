# W6 `home` — notes

Branch `Yoelcanarion/arena-home` (from `Yoelcanarion/arena` 287704a). Brief: `.plans/arena/w6-home.md`. W7 `home-viz` works beside me
on `web/src/home/viz/**` and `web/src/home/data/story.json`.

## What exists (web only; nothing under `src/fractalswarm`, `docs/claims.md`, `bench/`)

| Piece | Where |
|---|---|
| Route and bundle split | `web/src/main.tsx` loads fonts, `tokens.css` and `home/Root.tsx`. `Root` shows `HomePage` for `isHomeHash` (`""`, `#`, `#/`, `#/?...`, `#/home`) and lazy-loads `App.tsx` (which now carries the shell CSS) for every other hash. The home page never touches the zustand store, recharts or React Flow. |
| Deep links | `#/?at=<problem|solution|models|evidence|enter|tie>` opens at a chapter or at the beat `tie`; `#/?still` (or `?still`) shows every beat in its final state, as reduced motion does. |
| Pinned stages | `scroll/Stage.tsx` + `scroll/timeline.ts` (pure maths, tested). A tall section, a `position: sticky` visual and a column of steps; the wheel is never intercepted. Reading line at `anchor + p·(height−1)` vh. |
| Chapters | `chapters/{Hero,Problem,Solution,Models,Evidence,Enter}.tsx`. Words in `copy.ts`, numbers from the story (`numbers.ts`), never typed. |
| Bar and rail | `bar/TopBar.tsx` (brand, "Enter the simulation", theme switch), `bar/ChapterRail.tsx` (right edge, hidden on the hero). |
| Style | `home.css` (class prefix `home-`, scoped under `.home`, tokens only, media queries only). New tokens in `styles/tokens.css`: display type scale, `--space-8..10`, `--dur-reveal`. No new colours. |
| Display face | `"Inter Opsz"` declared in `home.css` from `inter-latin-opsz-normal.woff2` (72.9 KB, `font-display: block`); the global font is unchanged. |
| Tests | `src/home/*.test.ts`: timeline, route, emailSegments, format, numbers, copy guard, claims guard (against `docs/claims.md`), doors, and a whole-page render (`HomeView.test.ts`) with a made-up story (`testing.ts`). |

## The contract with W7

`web/src/home/data/types.ts` (W7) is the one place the story is typed (coordinator, Oct 30) and `data/story.ts` exports the typed `story`.
Without the data every number is "—" and every claim says NO DATA YET; a visual W7 has not written yet draws as a labelled placeholder
that shows its progress (`visuals.tsx`). W7's commit 9bca49d makes the data follow the list below. What the page reads itself:

- `claims.<id> = {text, status}` for S1–S7, R1–R5: the rows of `docs/claims.md`, verbatim, markdown stripped from `text`'s quotes only.
  The page quotes `text` as is and tags the row PENDING when `status` contains "pending"; "not claimed" rows are never drawn.
- `facts {talks, tracks, days, sessions, orchestrators, agents}`.
- `hero {task, title, series.<workflow>.points[{profile, x, stall_s, extra_cost_pct, seeds[]}]}` — `hero-t2_conference.json` as is; "real" is read from `title` (`rivals-real`).
- `headline`: whatever `DotPlot` draws, plus the number of seeds as `seeds` (a count or a list) or `cells[].seed`, and optionally `real: boolean`. `verdicts` for `PairedBars`, `regime` for `RegimeStrip`.
- `finish {talksPlaced, talksTotal, hardViolations, duplicateCalls, costUsd, task, real, seeds}`, `takeover {killed, rootChain[], deathVerdictS, keyframes}`, `lanes.central {stallS, keyframes}`.
- `failures {fastRestart[{value,label}], falseDeaths[{value,label}], perProcess{value,label,decimals}}` (R3's 13.2 / 5.7, 1.25–2.25, 0.90).
- `assumptions[{id,label,value}]`, `tokens {coordination, recovery}` and `tokensByModel`, `extraction {email, constraints[{text, source}], model}`, `ablation {parser, muse, total}`, `proof.lines[]` (the real `demo --verify` output).
- `keyframes` inside a visual's own slice: `tree {grown, log, kill1, verdict1, heir1, adopt1, kill5, settled}` and `lanes.central {filled, crash, restart, redone, end}`, in that visual's progress (0–1).

Visual conventions: components fill their parent (`position: relative`, the parent sets the size); `progress` is a `MotionValue<number>`
(0–1; scroll-driven in the stages, time-driven on enter elsewhere); `still` means the final state with no motion; `DoorGlyph` gets `data = door.id`
(`arena`, `live`, `replays`, `new-task`, `director`, `numbers`, `ablation`). A visual that draws from `progress` reads it with `useTransform`/`useMotionValueEvent`, never React state per frame.

## Static showcase (W8)

`isStaticShowcase()` is `import.meta.env.MODE === "static"` (the coordinator's message, Oct 30). The doors that need the local server
(`live`, `new-task`, `ablation`) show their `closedNote` instead of a link in that build.

## Decisions and deviations

1. **The hero subtitle is R6, not R2** (coordinator, Oct 30): R6 verbatim, one sentence to a line, then the visible link "Where this holds, and where it does not"
   to the beat `tie` (`#/?at=tie`) of the evidence chapter, where R2 and R3 stand one under the other.
2. **R5 everywhere it appears** carries the rival named, the setting and the reason ("In-process: its workers die with it, so most of the gap comes from that design.").
3. **The primary button is the inverted neutral pill**, not the accent: the accent is the colour of the swarm at work, and accent-on-inverse is 4.3:1 in the light theme.
4. "A live run" and "New task" both lead to `#/new` (the intake page has a sample button). Two doors, one page, until there is a better target.
5. `Inter Opsz` is a second family only for display type, so the app's type does not change.

## State at the Oct 30 12:00 stop (Yoel's STOP)

**Done.** Everything in the table above: route and bundle split, the five chapters and the hero (R6 + link to `tie`), claims drawn verbatim (PENDING tag,
code spans as code), the terminal with both proof commands, the doors, the tests. At `e32c5fd` (before the last merge): `tsc` clean, `vitest run src/home
src/lib/tokens.test.ts --maxWorkers=1` 138 of 139 passed (the one failure: R6 missing from the old `story.json`, which 9bca49d fixes). Merged into this branch:
`Yoelcanarion/arena` (R6) and W7's `Yoelcanarion/arena-home-viz` up to 9bca49d (merge `bfc0046`).

**Half done.** After that merge the page does not typecheck (not re-run): `story.ts`, `numbers.ts`, `visuals.tsx`, `testing.ts` and the tests read the typed schema W7 had
at 79fbfe6, and 9bca49d replaced it with the page's contract. No build, browser check, screenshots, bundle size or fps yet (they waited for the RELEASE).

**Next step.** (1) Re-adapt to the new `data/types.ts`: claims `{text,status,state}`; `facts` with `days`; `hero.series.<wf>.points[]` (`stall_s`, `extra_cost_pct`) and
`hero.{task,model,seedCount}`; `headline.{real,seedCount}`; `finish.{task,real,seeds,talksPlaced}`; `takeover.{killed,rootChain}`; `failures` (ratios at 1 decimal, as R3 writes them);
`tokens`; `proof` + `proof.takeover` (two commands in the terminal); `assumptions[{id,label,value,why,checkedBy}]`. Each visual takes only its slice
(`<Viz data={slice(story,"tree"|"hrw"|"hashes"|"lanes.central"|...)}>`, SwarmTree `pacing`, HrwPanels `round`); `TREE_KEYFRAMES` is a name-to-progress record; `lanes.central.keyframes` and
`stallS` are in the data, so the waiting counter is `stallS` times a ramp from crash to restart (drop `lanesBeats`/`waitedSeconds`). `e32c5fd` keeps what survives: `parts/Inline.tsx`,
`Terminal` with steps, the fixture built as a tweaked clone of the real story, the test structure. (2) The one route line W7 asked for: `#/home-lab` renders `HomeLab` (`isHomeLabHash`).
(3) `tsc` + `vitest` (one worker); after a RELEASE: build and report the first-load bundle size, dev server on 5174, Playwright screenshots (1920x1080, 1366x768, 390x844; both themes; reduced motion),
`?frames` fps, polish in the order 2, 0, 1, 4, 5, 3. (4) `extraction` comes from W7 later, `ablation` stays PENDING; the counter shows this run's 101.8 s beside R5's 2-seed mean 92.6 s, so label it "this run".
(5) Update this file, `merge_ready`, then `worker_done`.
