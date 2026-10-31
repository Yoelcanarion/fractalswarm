# W7 `home-viz`: notes

Branch `Yoelcanarion/arena-home-viz`, a worker branch of `Yoelcanarion/arena`. Brief: `.plans/arena/w6-home.md`. W6's side of the
seam (the page, the stages, the copy) is in `.plans/notes/arena-home.md`. Everything up to 146bbe8 is merged into arena; the
commits after it (the DotPlot below a thousand pixels, the motion guard, this file) are on the branch and wait for a merge_ready.
Nothing here was pushed to `master`; no real call was made; nothing was written to `~/.fractalswarm`.

## What W7 owns

`web/src/home/viz/**` (the visuals and their tests, the standalone lab), `web/src/home/data/**` (`story.json`, `types.ts`),
`scripts/build_home_data.py` and `tests/unit/test_home_data.py`, `chapters/Hero.tsx`, `chapters/hero.css`, `chapters/hero.test.ts`.
Two lines of W6's, applied on my branch with the coordinator's word: `ease: "linear"` in `hooks.ts` and `chapters/Enter.tsx`.
The page imports everything from `viz/index.ts`; a visual is a component of `{ progress, data, still?, stillAt? }` and the page
decides what drives `progress` (the scroll's stage clock, the time of a loop, the pointer on a door).

## The data

`scripts/build_home_data.py` writes `web/src/home/data/story.json` (67 KB, sorted keys, deterministic). It holds no number of its
own: every figure is read from a committed result or from a recorded run, and `sources` says where each came from. The claims are
copied from `docs/claims.md` by row id, in the row's wording.

- The page reads the bundle `demo/final` now: run `final-kill-half-1`, 8,771 events, 121.2 s, head `a199a768072b817c406b85822f3fe647`,
  5 coordinators killed (o0 at 53.3 s, o2.1 at 63.5 s, o1 at 65.5 s, o3.2 at 74.2 s, o2 at 90.4 s), 7 HRW rounds, 48 of 48 talks, 0 hard
  violations, 0 duplicate calls, 0 coordination tokens, $0.478. `proof.lines` is `MATCH  final: 8771 events, head a199a768...`.
- Regenerate: `uv run python scripts/build_home_data.py` (`--check` exits 1 when the file is stale; `--bundle demo/final` is the
  default; `--central-run <dir>` when `central__t2_conference__C3__s1` is not in this checkout, since `lanes.central` is carried over
  from the committed file when its source is absent).
- **`--hero-set v1|headline-10`** picks the result set the hero chart and the figures beside R5 are read from. `headline-10` stops with
  "the headline-10 reading cannot be the hero yet" while `bench/results/headline-10/results.json` does not exist, and
  `test_home_data.py` holds that. The coordinator runs it when the 10-seed results exist; I did not run it. `hero.seedCount` and the
  chart's setting line come from the data, so nothing in `LineDraw` is written for two seeds.
- Slices added by me this week: `extraction` (below). `ablation` stays absent and its door keeps the PENDING tag.
- `tests/unit/test_home_data.py`: 22 tests (the slices against the committed results, the claims against `docs/claims.md`, the email
  and the facts re-read straight from `events.jsonl`, spans in order and inside the email, `slot_words`). ruff check and format clean.

### The extraction slice (Models chapter)

One speaker's email as the `extract` call of the bundle read it, and the three constraints that call published through
`memory.publish_fact`, in words, each with the stretch of the email it is read from: speaker S12, effect `eff-3895.0`
(event 4564), 2 readings that agree. Constraints: "Day 2: from 10:30" (chars 156-220), "Day 1: any time" (221-244), "No time preference"
(246-282). The run publishes the same reading twice. The facts are the model's; the map from a constraint to its words is mine,
written in the script and checked to occur once. The caption says the email is generated for the test and is not a real person's.
Additive: schema stays 1; `sources.extraction` names the effect, the event, the speaker and the email.

## The visuals

All are pure frames of a progress plus a painter that writes only what changed (`Pen` skips a write of the same value; `Pen.text()`
changes its one text node in place). No SVG filter, no blur, colours only through tokens, media queries only (no container queries),
reduced motion and `?still` give one complete frame. Each prints its setting unless the page passes `setting={false}`.

| Visual | Files | What it is |
| --- | --- | --- |
| `SwarmTree` | `viz/tree/*` | The log as a tree of brains and agents: grow, work, kill, memorial row, takeover by HRW, re-wire. Two pacings (`story`, `hero`), plus the ambient layer. |
| `WorkLanes` | `viz/lanes/*` | One lane per actor, one bar per LLM call; the time map is piecewise linear (stalls by their length, work by the root of its length) so the stall counter is a straight line of the progress between the crash and the restart. |
| `HrwPanels` | `viz/hrw/*` | One panel per survivor, every candidate's real score computed digit by digit, the heir where all agree. Fits the box in three tiers (`full`, `compact`, `tiny`). |
| `HashStrip` | `viz/hash/*` | A sample of the log's events with their real hashes; the chain and the head. |
| `LineDraw`, `DotPlot`, `PairedBars`, `RegimeStrip`, `TokenBar` | `viz/charts/*` | The evidence: hand-built SVG, direct labels, real axes, a text alternative and a table for each. |
| `CountUp` | `viz/parts/*` | A number that counts once to the number it is; the end number's width is kept from the first frame. |
| `DoorGlyph` | `viz/doors/*` | One pictogram for each of six doors (arena, live, replays, director, numbers, ablation); progress is the pointer on the door. |

### The hero: a loop and an ambient layer (`chapters/Hero.tsx`, `viz/loop.ts`, `useLoop.ts`, `viz/tree/ambient.ts`)

Yoel's verdict on the home was that the hero should never stop. The tree plays on a clock of its own: grow 1.3 s, run 8.8 s at constant
speed, rest 1.8 s on the settled tree, fold 0.9 s into the root, again. The clock of the recorded run restarts with the loop. Off
screen or in a hidden tab there is no animation frame at all (IntersectionObserver and `visibilitychange`); with reduced motion or
`?still` there is one frozen frame (the end of the run). The ambient layer runs in every phase, the rest included: comets along live
edges (root to leaves and back in alternate sweeps, brighter where a model call is in flight), a halo breathing round live brains and a
ring pinging round agents that work. It reads busy or waiting from the recorded frame and carries no number and no label, so the
recorded frames keep their meaning. The scroll-linked fade is gone: the hand-over is a `data-leaving` attribute flipped by an
IntersectionObserver and a CSS transition. The line under the figure says it is a recorded run replayed on a loop and gives its setting,
derived from the data (`hero.test.ts` pins "T2 conference planning · 5 coordinators crashed · real model · 1 seed").

Measured on the hero alone, 1920x1080, Vite dev server (bundle `demo/backup`, before the move to `demo/final`):

| | fps | frame p50 / p95 / p99 / max | over 17 ms | CPU per frame |
| --- | --- | --- | --- | --- |
| Chromium 130 headless, before (scroll-linked) | 59.9 | 16.7 / 16.7 / 16.8 / 33.4 ms | 0.2% | 2.85 ms |
| Chromium 130 headless, loop, 30 s, all phases | 60 | 16.7 / 16.8 / 16.8 / 16.8 ms | 0% | 3.96 ms |
| Firefox 1465 headless, 165 Hz display, 30 s | 164.9 | 6.1 / 6.1 / 6.1 / 6.1 ms | 0% | n/a |

Five minutes of looping in Chromium (GC forced): heap 21.9 MB at 5 s and 22.3 MB at 300 s (flat from 180 s), 6,699 DOM nodes at both
ends, 183 listeners at both ends. Writes per frame: run 60 (transform 31, opacity 17, r 7, edge `d` 3.5), rest 36 (all ambient),
grow 52. The numbers on `demo/final`, which is 2.6 s longer, are taken again at a RELEASE (see the end).

## The motion rules (Yoel's "crude" motion, item 2)

**The rule, page-wide (coordinator, Oct 30): the progress that drives a visual is linear in time, and each element eases itself once,
over its own stretch of it.** The finding behind it: the page eased every time-driven draw twice. `useEnterProgress` and the door hover
eased the progress with the strong ease-out, and the visuals then eased each element again inside its own span, which squeezed every
stretch into the first fifth of the time and flattened every stagger. Measured on the page, on a stepped clock, before and after the
two linear lines:

| Draw | Before | After |
| --- | --- | --- |
| Token bars' wipe (1.2 s) | 0.79 at 100 ms, 1.00 at 200 ms | 0.01 at 100 ms, 0.24 at 300 ms, 0.55 at 400 ms, 0.93 at 600 ms, 1.00 at 800 ms |
| Arena door, the X (0.9 s hover) | 0.90 at 50 ms, 1.00 at 100 ms | 0.33 at 150 ms, 0.67 at 200 ms, 0.93 at 300 ms, 1.00 at 400 ms |
| Live door | all over by 350 ms | stream to 450 ms, tree fills 360-720 ms, crosshair lands 650-870 ms |

Audit of what is left (Oct 30 evening, by reading every file under `home/`): the drivers are the enter progress, the door hover, the
stage clock (`scroll/tween.ts`: a ramp of at most 0.2 s up to a constant speed and down again, W6's), the hero loop (`viz/loop.ts`),
and the lab's playback; all are linear. `animate()` with an ease appears once, in `parts/Figure.tsx`, the count-up of a number, which has
no visual in it. There is no spring. Inside the visuals each element is one `smoothstep`, `easeOutCubic` or `easeInOutCubic` of a
`span(p, a, b)`. The bare spans are constant motion on purpose: the numbers door's marker ("an even pace"), the pulses of the live and
ablation doors, the ambient comets (half linear, half smoothstep), and the lanes' stall counter, which counts seconds. The one bare
fade was the dot plot's row opacity; it is `smoothstep` now. `viz/drivers.test.ts` holds all of this: the two drivers say
`ease: "linear"`, a scan of every source file allows `animate()` only with a linear ease (but for `Figure.tsx`) and no `useSpring`, and a
staged stretch of a linear 1.4 s draw takes over 0.25 s where an eased driver gave it under 0.1 s.

What a frame paints (read, not yet measured with `?frames` on the visuals other than the hero): every painter goes through `Pen`, so a
frame writes only the attributes that changed; layout reads (`clientWidth`, `getBoundingClientRect`, `offsetLeft`) are in the
measuring hooks that run on resize (`charts/parts.tsx`, `WorkLanes`, `HashStrip`, the door's `useWide`), never in an `apply`; there is no
SVG filter and no React render during a motion. Two deliberate exceptions to "transform and opacity only": the SVG attributes the tree
and the charts write (`d`, `r`, `stroke-dashoffset`) which are repaint-only, and the HRW score digits, which are revealed with
`clip-path: inset()` (paint only, no layout).

## Doors (`viz/doors/*`, `viz.css`)

- **One glyph height.** The svg is `--door-glyph-h` tall (140 px unless the page sets it) for all six doors at every width measured
  (1920, 1440, 1280, 1024, 768, 390), so the box no longer depends on the window or on the drawing. The glyph box is 161.8 or 183.5 px in
  the replays and numbers cards because W6's grid stretches it (`1fr` row); that is `home.css`, not the drawing.
- **Clapper.** Its open pose reached 18.2 px above its glyph box and touched the card's edge; it is 5.9 px inside it now. A test turns
  it through its whole closing and holds every corner in the canvas (it fails when the clapper opens to 30 degrees).
- **Wide doors.** The arena's drawing was 245.6 px of a 682 px box (36%) and the live run's 268.8 px; now 580.4 px (85%) and 584.4 px at
  1920, 523 of 551 px at 1440 and 451 of 475 px at 1280. Each has a second drawing on a 480-unit canvas (the swarm with three
  coordinators over six sessions beside a supervisor with six workers; a text of six lines, a long arrow, a tree of three over six),
  used when the glyph's box is at least 3.2 times wider than tall (`WIDE_FROM`), decided in a layout effect before the first paint, so
  it does not depend on W6's breakpoints. Below that (1024, 390) the compact drawing stays.
- The numbers chart starts at the same left edge as the others (10 units); the marker runs to 4 units past the end.
- Tests: the drawings are scanned (circles, rectangles, lines, paths) and held inside their canvas with 2 units of air, and where each
  moving part ends up is held there too, for all six doors in both sizes (49 tests in `doors.test.ts`).

## What W6 found, and what changed (Oct 30)

1. **`LineDraw` negative `<rect>`.** A 154 px container made the plot narrower than nothing and the console said
   `<rect> attribute width: A negative value is not valid, "-18.00"`. The clip rect is clamped. (Playwright's full-page screenshot goes
   through a 1x1 window and shows it too.) Other geometry at container widths under about 200 px was not audited.
2. **KILLED label over an empty row.** It was on for about a second of the hero loop (2.9 to 3.9 s) with nothing under it; it comes in
   when the first dead brain sets off for the memorial row. A test walks the whole run (`render.test.ts`).
3. **`HrwPanels` in Firefox.** `apply()` costs 0.2 ms at the median and 0.5 ms at p95 in Chromium, so the cost is not my JavaScript.
   What changed: a score is drawn once, whole, and clipped to the digits computed (`clip-path: inset`), so a step of the reveal is one
   style write per row instead of two text nodes rebuilt in each of the nine panels' rows. Headless Firefox, the heir and adopt steps,
   2 passes of 15 s, three runs each, 165 Hz so one frame is 6.1 ms: frames over 20 ms **6, 8, 9 before and 0, 1, 7 after**; frames over
   two refreshes (12 ms) 86, 82, 85 before and 76, 72, 102 after, which is no change. The machine was busy, so the runs vary. A
   `will-change` on the panels, no row transition and no clip on the bars did not help; with the digits hidden entirely the frames over
   20 ms fell to 3, so what is left is the panels' repaint in software rendering. Chromium, same pass: 789 frames, p99 and max 16.8 ms.
4. **`DotPlot` below about 1000 px** (W6 saw it at 820 and 944 px). Two collisions, both in the layout. (a) The header of a panel (title
   and subtitle) was allowed to run to the edge of the mean column, where the right-aligned "mean" ends, so the long subtitle of the
   extra-cost panel overlapped it from 822 to 878 px wide, and in the stacked layout at 430x340 by 33 px. It stops 12 px short of the
   label now, and the short subtitle is used where the long one does not fit. (b) The vertical grid and the zero line ran through the
   band that carries a group's title, so "5 coordinators killed (C3)" was crossed by the axis wherever the row labels are short (the
   names turn short below 967 px, and always when stacked). The grid is drawn for the rows of each group now (`panel.spans`) and the
   title comes from the layout. The test holds the header against the mean column, the grid against every title and the title against
   the mean column for widths from 350 to 1700 in steps of 10 at five heights; the old header rule fails it at 820x420. The labels are
   still the claims' own names from 967 px up and the short ones below; I left those tiers alone.

## The redesign (Oct 30, evening; `.plans/arena/redesign.md`)

The six pieces W6 asked for, each in its own file under `web/src/home/viz/` (W6 imports the files, not `index.ts`), and each reading
`useStill()` (`../hooks`) and `useStory()` (`../story`) itself through `viz/page.ts`; the props of the brief are all it takes, and
`still`, `data` and `className` are optional extras for the lab and the tests.

| Piece | File | Props | What it is |
| --- | --- | --- | --- |
| `ProblemFilm` | `film/ProblemFilm.tsx` | `{ play }` | `WorkLanes` over the in-process supervisor's recorded lanes, one 7 s playhead under the shared ease, per increment of `play` |
| `StepDrawing` | `steps/StepDrawing.tsx` | `{ step: log\|heir\|adopt, active }` | three svg drawings moved by CSS transitions on `data-on`, delays spread over about 0.9 s; the heir's bars are the first recorded round's fractions |
| `KillDemo` | `demo/KillDemo.tsx` | `{}` | the hero's tree with the real heir rule in TypeScript; `note` prints the "illustration" sentence |
| `ProofBars` | `charts/ProofBars.tsx` | `{ play }` | one svg, measured to its width (see below) |
| `GrowNumber` | `parts/GrowNumber.tsx` | `{ value, format, play }` | HTML number; a missing value is a dash; the end width is kept from the first frame |
| `DoorThumb` | `doors/DoorThumb.tsx` | `{ door: string }` | the door's glyph going there and back (a triangle wave of 2.4 s a leg run through the ease), only while on screen |

- **The shared ease** (`viz/ease.ts`, `--ease-play` in `viz.css`): `cubic-bezier(0.3, 0.05, 0.7, 0.95)`. Its peak speed is 1.357 times
  the mean and it has covered 12.8% of the way at 20% of the time (the limits are 1.6 and 10%). `SECONDS` holds the durations: numbers
  and bars 1.6, film 7, hover 0.8, a takeover 2.6. `ease.test.ts` holds the limits, that the CSS token is the same curve, and the
  durations.
- **The heir rule in TypeScript** (`viz/hrw/`): BLAKE2b with an 8-byte digest over the canonical JSON `["hrw", key, member]`, rank by
  score then id, `capacity = max(1, ceil(1.25 K / N))`, `remap` keeps the survivors and moves orphans in `(-priority, key)` order. The
  test holds the Python vectors (block boundaries, UTF-8, seven remap cases) and every score and ranking of the recorded run.
- **The click demo** (`viz/demo/`): `sim.ts` is the rules, `stage.ts` the picture over time, `KillDemo.tsx` the DOM. Replaying
  `o0, o2.1, o1, o3.2, o2` gives the recorded run's 7 rounds, every score, the survivors and the adoptions; 300 random click orders
  keep one tree. A kill: a flash, the neighbours notice at about 0.4 s, suspect, the verdict, the candidates' scores, the heir's crown,
  the orphans re-wire, the dead go to the KILLED row. Takeovers overlap and nothing jumps. Tab and Enter, tap, "Kill half" (five kills
  in turn), "Reset", one `aria-live` line, a reset after 16 s idle or 4.5 s with everyone down ("There is nobody left to take over."),
  instant changes under reduced motion and `?still`. It carries no time, hash, cost or count from a run.
- **ProofBars** is one svg, because the page counts the words of its HTML and not those drawn inside an svg, and the chart needs the
  rivals' names, the setting and the numbers. Against the in-process supervisor it is a bar and a number each (stall 14.6 s against
  92.6 s, extra cost +6.6% against +75.6%, the setting "Real model · T2 conference · C3 · 2 seeds"). Against the ideal durable
  supervisor the data's verdict is a tie (the rule is "every seed agrees and the difference reaches the minimum effect"), and two bars
  of the means, 10.3 s and 32.0 s, would read as a win. So each seed is a dot on one shared axis (swarm 7.1, 22.6, 1.2; durable-max
  9.8, 0, 86.2 s; the extra-cost axis is signed, with a zero line), the swarm's filled and the rival's a ring, and the chip beside it
  prints the data's verdict as it is. Every bar, number and line of dots has its own eased share (`shareAt`): lines start 0.05 s apart
  and end together at 1.6 s. One frame loop writes them through `Pen`, only while the chart is on screen.
- **Words**: `KillDemo` adds nine ("Click a coordinator to crash it." + "Kill half" + "Reset"); its sentence "An illustration in your
  browser, not a real run." is off by default because the page prints it above the demo. The film, the drawings, the thumbnails and
  ProofBars draw their words inside an svg: none are counted.

Deviations from the brief: (1) when a whole group of coordinators dies the demo gives its goals to the owner of the parent goal, where
the run spawns a new member; all of one coordinator's fallback goals go to one heir, so the tree stays one tree. (2) A takeover takes
2.6 s, not 2: about 1 s of notice plus the takeover itself (the brief's range of 1.2 to 2 s is for the takeover, which is 1.6 s). (3)
Against the ideal durable supervisor ProofBars draws seeds, not bars, for the reason above; the brief says "bars against both rivals".
(4) The step drawings take about 0.9 s from the first part to the last, a little over the 0.6 to 0.9 s of a hover.

## Browser pass (Oct 30, 22:55 to 23:10 CET, after W6's frames; `0e993b5`)

The lab (`#/home-lab`, on a spare Vite port) in Chromium 130 and in Firefox (Playwright, headless), dark and light, at 1920x1080,
1280x900, 600, 390 and 320 wide, and under reduced motion. It found three things, all fixed:

1. **The film had an empty counter band** (the lanes keep a probe for their readout) and was clipped at 390 wide. `.hv-film` now has
   its own height, `clamp(400px, 44vw, 460px)`, and a 24 px probe, so the lanes fill the box. W6 can drop `--fs-figure: 0px` and
   the `.home-film .hv-film` clamp.
2. **The lanes' key ran out of its box on a phone**: "no agent working 101.8 s" needs about 176 px and a cell had 155 to 167.
   `ledgerColumns(width)` in `lanes/layout.ts` takes four, two or one columns by what each cell needs (swatch, words, the widest value),
   pulls each column back so the ones after it fit, and the lanes make room for the extra rows. A test walks every width from 210 to
   1700 px: nothing is clipped by the box and no two cells touch.
3. **The click demo's "KILLED" label was covered** by the dead once the row filled (Kill all). In the demo it now sits above the rule
   (`labelOnRule` on `TreeSvg`); the hero keeps it beside its row.

Frames at 1920x1080 (headless; gaps between `requestAnimationFrame` calls in ms; no row has a frame over 33 ms). Chromium runs at 60 Hz
and every row is p50 16.7, p95 16.7 to 16.8, p99 16.8, max 16.8. Firefox runs at about 164 Hz:

| animation | frames | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| baseline (nothing in view moves) | 549 | 6.1 | 12.1 | 12.1 | 18.2 |
| demo idle (the ambient layer) | 730 | 6.1 | 12.1 | 12.1 | 12.1 |
| demo, one takeover | 407 | 6.1 | 12.1 | 12.1 | 24.3 |
| demo, Kill half (five takeovers) | 1775 | 6.1 | 12.1 | 12.1 | 18.2 |
| problem film (7 s) | 1187 | 6.1 | 12.1 | 12.1 | 12.1 |
| step card hover | 232 | 6.1 | 6.1 | 6.1 | 6.1 |
| proof bars and numbers (1.6 s) | 353 | 6.1 | 6.1 | 12.1 | 12.1 |
| grow numbers (1.6 s) | 363 | 6.1 | 6.1 | 6.1 | 6.1 |
| door thumbnails loop | 823 | 6.1 | 6.1 | 6.1 | 12.8 |

The demo, 19 checks in each browser, all passed, with no console error or warning: by mouse (a click says who crashed at once and
then who takes over; Reset; Kill half; with everyone down the line says nobody is left; it puts itself back), by keyboard (Tab reaches
a coordinator button named "Crash Conference (o0)"; Enter and Space crash it), by tap at 390 wide (the stage is 292 px, a target is
40 px, nothing reaches past the screen) and under reduced motion (the takeover is told at once, with the heir). Under reduced motion
the proof chart, the film, the drawings and the numbers show their end state.

## Checks (Oct 30, 23:11 CET)

- `npx tsc --noEmit -p .` clean. `npx vitest run --maxWorkers=1 src/home`: 40 files, 639 tests passed (`redesign.test.ts` 40,
  `lanes/lanes.test.ts` 36).
- A scratch `npx vite build --outDir <scratch> --emptyOutDir` builds (the lab's chunk is 42 kB, 15 kB gzipped).
- I touch nothing under `src/fractalswarm/`, so the full pytest and the $0 reference comparison are the coordinator's at the merge
  ("skip pytest and the refs").

## Not done

- DotPlot at 820, 944, 1000 and 1147 px in a browser: the redesign's six do not use it, so it was not looked at again.
- The real `demo --verify --no-serve --no-browser` against `proof.lines` and the $0 references (43 of 43): the coordinator's, at the merge.
- ProofBars draws its words (about 58) inside its svg, which W6's counter does not count; a reader still sees them, so if the
  230-word budget is ever counted by what is on screen, the chart adds about 58 to what the counter says.

## Rules kept

Fake LLM only (never `--backend real`, never `--confirm-real-spend`); any run of mine sets `FRACTALSWARM_RUNS_DIR` and
`FRACTALSWARM_LEDGER_PATH` to scratch dirs; claims only from `docs/claims.md` (the visuals' own test bans "valid" outside a claim,
"every run finished", "simpler/cheaper/more reliable" and "first"); every result names its setting (task, model, seeds, failure
profile).

## W7 home-viz, Oct 30 night to Oct 31: the coordinator's order, (A) to (F)

Done, on Yoelcanarion/arena-home-viz (each step mailed to the coordinator as merge_ready):
- 62d0e52 (A): the ten seeds. DotPlot leaves central out by default (`systems` prop, `systems={null}` draws it); PairedBars says "tie · the seeds disagree" and prints the pre-registered rule; ProofBars names the extra cost's basis; on a phone the unit leaves a measure's title and the name is written smaller before a verdict touches it.
- 66c88aa (B, C): the demo's result stays (touch() when the Kill half queue drains), `crashLine()` says "take over" for two heirs, a pending line is dropped when another coordinator crashes, the main button keeps its ink on hover. The step cards' drawn-on lines use `vector-effect: none` and a stroke of 1: a non-scaling stroke counts a dash in screen pixels, so the curves peeked out at rest and stopped short.
- d8fa8f4: "pre-registered basis" in the extra-cost headers of LineDraw and DotPlot (DotPlot has three forms; a phone gets "% extra").
- 80cab4a (D): ProofBars in two columns from a box of 1000 px (48 gap, up to 1480; one column up to 840 below it); a setting both panels share is said once under them; `ProofDrawing` is exported for the server tests.
- 6dc9acd: the Proof says "a dot for each run" (the row, the reading for a screen reader, and each dot's hover text: "Run 3: 11.2 s"); the setting line keeps "10 seeds". The evidence page's table keeps its Seed columns.
- 9b13828: the band under the demo's tree. `memorialSlots` puts the row of the dead one row under the deepest row (it was a row and half a unit) and `boundsOf` ends the picture 0.25 unit under it (it was 0.5): from the agents' row to the bottom of the picture it is 3.25 units, was 4.0. With the scale measured on the page that is, at 820 wide, 184 px down to 150 px, and at 1024x768 (where the window's height sets the size, so the tree grew 7%, 788 to 843 px wide) 198 px down to 172 px; W6 saw 170 to 220. What is left is the shelf's own room: the dead's rings (their ticks reach about 0.9 unit above the centre), the DEAD stamps and the id labels need about 1.8 units, which at 1024x768 is the 111 px under the faint rule, with about 50 px of air above it. Going further means drawing something in that room (ten faint slots, or a line saying where the crashed ones land) or showing the dead somewhere else. Not done: it adds an element to a page that asked for fewer.
- (F) the hero's tree. The figure's column is a square (80svh at most) with one line under the figure; the run's picture is 1.48 to 1, so it filled two thirds of the square (385 of 572 px at 1366x768) and was drawn at 0.56 of its size (agents 14 px, labels 6.4 px). `fitted(model, aspect)` in `tree/model.ts` draws the same tree to a given shape: the layout narrower (x about the centre, down to 0.7 of its spacing, which the page then draws larger), taller if that is not enough, and each epoch reaching down to the deepest row, so that the survivors of the last takeovers spread over the room the tracks left instead of hanging above a hole over the row of the dead. The dead keep the step of their row. `treePlayer(tree, pacing, aspect?)` and `SwarmTree`'s new `aspect` prop use it; the model the film and the demo share is not touched, and the timeline is the same (it reads times, never places). The hero passes `HERO_ASPECT = 1.12`. Measured: the figure is 572x511 at 1366x768 (was 385 tall), 688x614 at 1920x1080 (was 463) and 349x312 at 390 wide; the caption sits under it inside the square (545 of 572 px); the viewBox is 770 wide, not 1020, so every glyph is 1.32 times larger (agents 19 px, labels 8.5 px). I looked at six frames of the loop at 1366x768 (2.6 to 10.6 s): nothing overlaps in the takeovers (scores, stamps, crowns) that I could see. `tree/fitted.test.ts` (10 tests) holds: the shape asked, the narrowest spacing, the order of rows and columns, every epoch reaching the row of the dead, the step of the dead, every node of 41 frames inside the picture, the same timeline, and that the shared model is untouched; `hero.test.ts` holds the viewBox's shape in the markup.

- (G, the coordinator's mail of 00:49) The step cards play once on arrival, one after the other, and rest on the last frame; a hover, a key on the card (`:focus-visible`) or a tap plays them again. Before, they played only on hover, focus or a tap and rested on the first frame, so a visitor who did not hover read "The heir takes over" above a crashed node with its workers unconnected. `viz/steps/turns.ts` (`createTurns`, `STEP_PLAY_MS` = 1000) hands out the turns: a card that asks while another is playing waits for the rest of it, one that asks later waits for nobody, and a card that asks again gets the same moment (StrictMode runs an effect twice). `StepDrawing` gets `replay` (a counter, 0 when absent: each increment cuts the drawing back to its first frame with no transition, `data-reset`, and lets it play once that frame has been painted); `active` is unchanged, and the lab and the old tests keep working. `chapters/Solution.tsx` (W6's): `Solution` makes the turns, `StepCard` takes them, plays through `useArrival`, and `data-active` (the card's highlight) still means hover or focus, or "played" on a touch screen, or still. I first remounted the svg on a replay and it looped: React sees a pointer under a new element as entering the card again, which replayed it again; the cut is an attribute on the same element now. Measured in Chromium at 1366x768 (every frame, in the page): the cards start at 0.03, 1.04 and 2.04 s after they scroll in and are complete 0.6 s later, resting on their last frame; a hover cuts the drawing back at once (no easing back), starts two frames later, is at 40% after 0.32 s and complete after 0.64 s. At 390x844 with touch the three arrive together and play 0, 1.0 and 2.0 s; a tap replays. Tests: `viz/steps/turns.test.ts` (4), two in `redesign.test.ts` (the replay's first frame and the cut's rule), `chapters/solution.test.ts` (3: the cards as the server draws them, first frame, and at their end for a still page).

- (H, the coordinator's mail of 02:00: the first coordinator's review of 8c4ae3a) Two items on the hero.
  (1) The title wrapped as "Kill half the / brains. It / still finishes." at 1920x1080 and on a phone: at 108 px the longest sentence is 826 px wide in a 735 px column, and on a phone 387 px in 349. `Hero.tsx` now sets the tagline as its two sentences (`SENTENCES`, split from `TAGLINE`, so copy.ts is untouched), each in a block of its own (`.home-hero__sentence`), and `hero.css` sets the title's size to what the longest sentence needs: 7.604 font sizes wide (measured in Chromium, display face at the title's weight and tracking) against the column: `min(5.6vw, 92px)` on two columns and `min(11vw, 76px)` on one (was `var(--fs-display-xl)` and `clamp(44px, 13vw, 76px)`). The rule is `.home-hero .home-hero__title`, so home.css's own `font-size` declarations on the title are overridden and now dead (W6 may delete them). Measured at 14 widths from 320 to 3840 px: every sentence on one line, 4.4% to 6.7% of the column to spare. The title is 86 px at 1536 (was 89), 76.5 at 1366 (was 79), 43 at 390 (was 51) and two lines everywhere; a phone's title is 84 px tall instead of 150, so its figure comes up. `hero.test.ts` holds 7.604 ems to the column at 17 widths, with the layout numbers it assumes (the 6.2fr/5.8fr split, the padding, the gap, 1480 px) read from home.css, so a change there fails the test and says to derive the size again.
  The blank under the caption at 1920x1080 (210 px to the bottom of the frame, 147 px between the bar and the figure) is the hero's 100svh with its content centred, in home.css (W6's): the figure is as wide as its column, 688 px, and 688 tall in an area 938 px tall. I did not change the hero's height or its columns. A shorter hero would let the next section's title show at the bottom of a 1080 frame, cut in half. A wider figure column (5.6fr to 6.4fr from 1650 px) makes the figure 10% wider, 759 px, and the title 84 px, and takes only about 30 px off the blank. Both are for the coordinators to ask for.
  (2) The KILLED shelf from frame one: `SwarmTree` has a `slots` prop, which the hero passes. The rule and the label are drawn in full from the first frame, with an empty dashed place (`.hv-slot`, `--border-strong`) for each brain the run kills, at its memorial position and the size of its own ring, under the edges and the nodes. `paintTree` opens a place as `1 - buried * appear` of its brain: it closes as its own brain lands and no other, stays closed for the rest of the run, and opens again as the graves fade when the tree folds, so nothing pops when the loop starts over. No layout shift: the shelf was already in the picture's bounds. The click demo is as it was (a faint shelf with no places, as the coordinator decided) and so is the story's own tree; a frame that is given no `shelf` still waits for the first dead brain (render.test.ts). Tests: `viz/tree/slots.test.ts` (7: the markup, the first frame, taken one at a time, open again on the fold, none in the story's tree or the demo), one in `hero.test.ts`. Seen in Chromium at 1920x1080 and 390x844 (a frame at 0.3 s, one at 5.4 s, one at rest): the shelf with its five places is on the first frame under the root, the first grave lands in its place, and all five rest in theirs with no dashed ring left. I did not start the loop nearer the first kill: its opening seconds, a healthy tree at work, are what the crash is measured against, and they are no longer blank.

Checks at this commit: tsc clean, `vitest run --maxWorkers=1 src/home`: 45 files, 704 tests green. No build, no pytest, no refs (the coordinator's).

Scratch tools, not in git, in the session scratchpad `shots/`: chart_shots.js, demo_fit_page.js, demo_text_probe.js, demo_rest.js, step_frames.js, proof_page.js, hero.js, vb.js, sheet.js. The lab dev server on 5175 is stopped when I am not taking a shot.
