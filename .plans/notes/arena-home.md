# W6 `home` — notes

Branch `Yoelcanarion/arena-home` (from `Yoelcanarion/arena` 287704a; `origin/Yoelcanarion/arena` 76ac1f0 merged at `bb54c58`). Brief: `.plans/arena/w6-home.md`. W7 `home-viz` works beside me
on `web/src/home/viz/**`, `web/src/home/data/**` and `scripts/build_home_data.py`.

## What exists (web only; nothing under `src/fractalswarm`, `docs/claims.md`, `bench/`)

| Piece | Where |
|---|---|
| Route and bundle split | `web/src/main.tsx` loads fonts, `tokens.css` and `home/Root.tsx`. `pageOf(hash)` (`route.ts`) picks the page: `home` for `""`, `#`, `#/`, `#/?...`, `#/home`; `lab` for `#/home-lab` (W7's `HomeLab`, a lazy chunk of its own, so the lab and its CSS stay out of the home bundle); `app` for every other hash (lazy `App.tsx`, which carries the shell CSS). The home page never touches the zustand store, recharts or React Flow. |
| Deep links | `#/?at=<problem|solution|models|evidence|enter|tie>` opens at a chapter or at the beat `tie`; `#/?still` (or `?still`) shows every beat in its final state, as reduced motion does. |
| Pinned stages | `scroll/Stage.tsx` + `scroll/timeline.ts` (pure maths, tested). A tall section, a `position: sticky` visual and a column of steps; the wheel is never intercepted. Reading line at `anchor + p·(height−1)` vh. |
| Chapters | `chapters/{Hero,Problem,Solution,Models,Evidence,Enter}.tsx`. Words in `copy.ts`, numbers from the story (`numbers.ts`), never typed. Each visual gets only its slice: `<Viz data={slice(story, "tree")}>`. |
| Bar and rail | `bar/TopBar.tsx` (brand, "Enter the simulation", theme switch), `bar/ChapterRail.tsx` (right edge, hidden on the hero). |
| Style | `home.css` (class prefix `home-`, scoped under `.home`, tokens only, media queries only). New tokens in `styles/tokens.css`: display type scale, `--space-8..10`, `--dur-reveal`. No new colours. |
| Display face | `"Inter Opsz"` declared in `home.css` from `inter-latin-opsz-normal.woff2` (72.9 KB, `font-display: block`); the global font is unchanged. |
| Tests | `src/home/*.test.ts`: timeline, route (`pageOf`), emailSegments, format, numbers, copy guard, claims guard (against `docs/claims.md`), doors, and a whole-page render (`HomeView.test.ts`) with a made-up story (`testing.ts`, a clone of the real story with changed numbers and made-up claims) and with the real one. |

## The contract with W7

`web/src/home/data/types.ts` (W7) is the one place the story is typed and `data/story.ts` exports the typed `story`. Without the data every number is "—" and every
claim says NO DATA YET; a visual W7 has not written yet draws as a placeholder that says in plain words what will be drawn (`visuals.tsx`, `LABELS`). What the page reads itself:

- `claims.<id> = {text, status, state}` for S1–S7, R1–R6: the rows of `docs/claims.md`. The page quotes `text` as is and tags the row PENDING when `state` is `pending`; `not-claimed` rows (R1) are never drawn.
- `facts {talks, tracks, days, sessions, orchestrators, agents}`.
- `hero {task, model, seedCount, series.<workflow>.points[{profile, x, stall_s, extra_cost_pct, seeds[]}]}`: the reading at the last point (C3, five crashes). `hero10` exists in the type and is `null`: **the page reads `hero`, not `hero10`** (see decision 8).
- `headline {task, real, seeds, seedCount, cells[]}`, `verdicts` (`PairedBars`, and `verdicts.falseDeaths[]` for the real-model false deaths beside R4), `regime` for `RegimeStrip`.
- `finish {talksPlaced, hardViolations, duplicateCalls, costUsd, task, real, seeds}`, `takeover {killed, rootChain[]}`, `lanes.central {stallS, keyframes}`.
- `failures {fastRestart[], falseDeaths[], perProcess}` (R3's 13.2 / 5.7, 1.25–2.25, 0.90; the fast-restart values carry no `decimals`, the page writes them at one decimal as R3 does).
- `assumptions[{id, label, value, why, checkedBy}]`, `tokens {coordination, recovery}` and `tokensByModel`, `proof {command, lines[], takeover {command, line}}`.
- Beats: `TREE_KEYFRAMES` (`viz/keyframes.ts`, a name-to-progress record) for the solution stage and `lanes.central.keyframes` for the problem stage.
- **Not in the data yet:** `extraction` (W7 will add one email and facts with source spans; the model chapter shows NO DATA YET) and `ablation` (stays absent; its tag is PENDING).

Visual conventions: components fill their parent (`position: relative`, the parent sets the size); `progress` is a `MotionValue<number>` (0–1; scroll-driven in the stages, time-driven on enter
elsewhere); `still` means the final state with no motion; `DoorGlyph` gets `data = door.id` (`arena`, `live`, `replays`, `director`, `numbers`, `ablation`: **`new-task` no longer exists**, see decision 4).
A visual that draws from `progress` reads it with `useTransform`/`useMotionValueEvent`, never React state per frame.

## Static showcase (W8)

`isStaticShowcase()` is `import.meta.env.MODE === "static"` (the coordinator's message, Oct 30). The doors that need the local server (`live`, `ablation`) show their `closedNote` instead of a link in that build.

## Decisions and deviations

1. **The hero subtitle is R6, not R2** (coordinator, Oct 30): R6 verbatim, one sentence to a line, then the visible link "Where this holds, and where it does not" to the beat `tie` (`#/?at=tie`) of the evidence chapter, where R2 and R3 stand one under the other.
2. **R5 everywhere it appears** carries the rival named, the setting and the reason ("In-process: its workers die with it, so most of the gap comes from that design.").
3. **The primary button is the inverted neutral pill**, not the accent: the accent is the colour of the swarm at work, and accent-on-inverse is 4.3:1 in the light theme.
4. **One door for "A live run"** (coordinator's copy notes, Oct 30): "A live run" and "New task" both led to `#/new`; now one door, "A live run" ("Paste your own messy text, launch a run, and kill its coordinators yourself."). "Ablation" is titled "Model against parser" (same purpose line). Six doors: two wide, four narrow (`home.css`). W7's `DoorGlyph` needs no glyph for `new-task`.
5. `Inter Opsz` is a second family only for display type, so the app's type does not change.
6. **Nothing on the page says every run was valid** (coordinator, Oct 30; the first invalid real run is `swarm__t2_conference__C0__s5`, no chaos, 40 of 48 talks placed). A guard (`UNIVERSAL` in `testing.ts`, used by `copy.test.ts` and `HomeView.test.ts`) fails on "valid", "every run finished" and "always finishes" in the page's own copy and in any text outside a claim; among the drawn claims only R6 may say it, in the row's words, with its setting ("(C3) · real model") and the link to R2 and R3 beside it. The kill chapter's last step reads "This run still finishes." (it is the recorded demo run). S7 is drawn only as the tagline.
7. **Copy notes of the coordinator (Oct 30)** applied: "In the usual setup" is "In the simplest setup", and for the same reason "The team has one coordinator." replaces "usually has one"; "gave it every advantage" is "the strongest rival we could implement fairly"; the gate sentence is "With a fake model, at our pre-registered gate, this measure tied at three and five crashes.", with the crash counts read from the data (`gateCrashes`: profiles C2 and C3 of the hero points) and on its own line under R4's setting; the lead over the rival's numbers says "in real runs". `copy.test.ts` bans "usual(ly)" and "every advantage".
8. **R5 and R6 will change** (coordinator, 10-seed re-reading): every number printed beside R5 comes from the data (`hero`) and a guard checks that it appears in R5's text. When the rows are rewritten and W7 regenerates the data, `hero` has to carry the same reading (or I switch to `hero10`), or that test fails, on purpose. My side draws the rival's and the swarm's numbers as plain figures, no bars, so a much shorter rival value needs no rescaling here; W7's charts scale from the data. W7's generator takes `--hero-set headline-10` (default `v1`) and then writes the 10-seed reading into `hero` itself (`hero.set` names it), so the page needs no change when that set has its hero file: W7 regenerates, and the R5 guard test says whether the rewritten row and the data agree.
9. **The stall counter** in the problem stage counts the recorded run's own `stallS` (101.8 s) from the crash to the restart of the lanes and says "the work is waiting, in this recorded run": it is one run, not R5's reading.
10. **The real-model false deaths** (2.0 per run, one decimal as R4's row writes it) show only in the beat of R4 and its setting, never in R3's figures; R4's caption is the headline rows' own setting.
11. **Stage pacing is computed, not guessed** (`buildTimeline` with the real keyframes; 1 vh is one screen of scroll). Solution: the tree's clock holds from the death verdict to the heir (22% of the stretch from the kill to the heir), so the survivors' panels follow the reading line across the heir step (`HRW_PLAY` 3.7 to 4.4, about 0.8 vh) and not the tree's progress, which gave them a tenth of a screen; the step of the four other kills is 2 vh tall (about 0.3 vh per kill). Problem (W7's note: the crash-to-redone stretch is a quarter crash cycles and two thirds one long call): the crash and twice steps are 1.6 and 2.2 vh with a short hold, 1.41 vh of scroll for lanes progress .33 to .78 (it was 0.54), so the waiting counter's ramp (crash to restart) gets about one screen. To be judged on screen at the slot.
12. **The fair-fight table shows all eight terms** (they come from the data; one value runs to 207 characters): prose cells, fixed column widths, the why column muted, and a stacked layout below 900 px. The brief says "short"; if the coordinator wants four terms, the cut is a list of ids in `Evidence.tsx`.
13. **The page title is the tagline as written** (`index.html`, `COPY.title`): "FractalSwarm · Kill half the brains. It still finishes."
14. **The capture script is in the repo**, `web/scripts/home-capture.mjs` (shots, frames, first-load network, bundle sizes), as the brief asks. It needs `playwright-core@1.48.2` outside the repo (`PW_DIR`). The build goes into a scratch folder: `vite.config.ts` writes to `src/fractalswarm/api/static`, which is tracked, and `npm run build` would empty and rewrite it.
15. **One setting caption under the hero chart.** W7's `LineDraw` prints its own setting by default (`setting` prop); the page prints it once under the chart (`captionFor(story, "hero")`, the same words as at R5), so the chart is drawn with `setting={false}` (`Chart` in `Evidence.tsx` takes the visual's own props as `extra`).
16. **A `LazyMotion` above the page.** Found at the first look in a browser (Oct 30, 17:05): the minimal `m` component has no renderer, so without a provider it draws the motion value it had at its first render and never subscribes to it again. In both stages the visual moved and the text column stayed empty (every step card at opacity 0 but the first), the layers never came or went, and the hero never faded; in the dev server and the production build alike, and a render to a string cannot see it. `HomeView` wraps the page in `<LazyMotion features={domMin}>`, the smallest feature bundle that carries the renderer (+9 KB raw, +3 KB gzip); `motion.test.ts` pins the provider above every `m` of the page and keeps `m` out of `viz/`. The probe (the computed opacity of each step card at scroll fractions) read 1.00 and 0.00 before and reads 0.69 after, where the timeline's fade says 0.69.
17. **The way into the simulation is one word on a phone.** At 390 px the bar's pill wrapped to two lines and covered the brand. Below 560 px the label is "Enter" (`COPY.bar.enterShort`, the same link's other span, so the link's name is whatever is drawn) and the pill never wraps.

## State on Oct 30, about 17:30 (RELEASE slot: built, looked at, measured; merge_ready follows this commit)

**Done at the slot.**
- Build into the scratch folder (about 1 s); the tracked `src/fractalswarm/api/static` is untouched (`git status` shows only my source edits).
- **First load of `#/`** (`home-capture.mjs bundle` and `net` on `vite preview`): the entry script 454.6 KB raw / 146.7 KB gzip, the stylesheet 50.7 / 12.0, `index.html` 0.8: **506 KB raw, 159 KB gzip loaded by `index.html`**. With the fonts it is 7 requests, 680 KB raw, 332 KB on the wire (text gzipped, fonts as they are: Inter latin 47 KB, Inter Opsz 71 KB, JetBrains Mono latin 40 KB and latin-ext 15 KB). No `/api` call, no page error, no external URL. The lab (11 KB) and `App-*.js` (about 970 KB raw / 293 KB gzip) with its 101 KB stylesheet are lazy chunks. **The trade-off:** the home code now lives in the entry, so any other route's first load is the entry plus the App chunk, about 1.41 MB of script against 1.2 MB of the old single bundle (about +200 KB raw).
- **fps** (production build with `VITE_FRAME_LOG=1`, wheel at 1800 px/s, 1920x1080, `frames`): **60 fps in every segment** (hero, problem 863 frames, solution 862, models, evidence 624, enter), p95 16.8 ms, no frame over 20 ms, no page error.
- **Screenshots** (scratch `shots/`, 102 files): 1920 dark, 1366 dark, 390 dark, 1920 light, 1920 reduced motion and 1920 still. Read by me: all of the 1920 dark set, the hero and the solution at 1366, the hero, problem, solution and hero chart at 390, the hero and hero chart in light.
- **Checks.** `tsc --noEmit` clean. The whole web suite on one worker: 100 files, 1555 tests green (39 s). `uv run pytest tests/unit -m 'not promptguard'`: 1093 passed, 3 deselected (PromptGuard; the coordinator runs those), which includes `test_home_data.py` (19). `fractalswarm demo --verify --no-serve --no-browser`: `MATCH backup: 8177 events, head b052b4bc33cfe1b54c7b6ceb2872de26`, the head the page prints. **Not run:** the integration chunks (about 13 min) and the $0 reference comparison, because the branch changes nothing under `src/fractalswarm` or `tests/integration` (outside `web/` it adds W7's `scripts/build_home_data.py` and `tests/unit/test_home_data.py`, and the notes).

**Found by looking, and fixed.** The `m` components with no `LazyMotion` (decision 16: the text column of both stages was empty, found only in a browser); the bar's pill covering the brand at 390 px (decision 17); the guard's flag on a negated "valid" and the scope of the false-deaths test (earlier).

**Looked at and good.** The hero chart, the dot plot, the paired bars, the "where it does not" figures, the door menu with its glyphs and the fair-fight table read as designed, in dark and light; the placeholders (the model chapter's NO DATA YET line, the PENDING tag) look intended.

**Known and not fixed yet (the polish list, in order).**
1. **Solution stage on a phone.** The six survivors' panels (one column at 390 px) and the hash strip with its HEAD HASH are taller than the 44svh frame and spill over the text column; the strip's `height: 14%` is 52 px on a phone. It needs a phone layout (a taller frame, two columns or fewer panels, the strip anchored at the bottom with its own height).
2. **Problem stage: text-free stretches.** About 1 vh each around progress .5 and .7: a card is visible only within 0.46 vh of its block's centre while the lanes and the counter keep playing. Plan: split the crash step into "Then it crashes." and a new "The work waits." step (weights about 1.0, 1.4, 1.6) so the counter's ramp overlaps text.
3. **Hero.** The headline breaks "brains. It / still finishes." (balance it); the tree's labels are tiny at 1920; W7's `SwarmTree` shows its KILLED label with nothing under it at progress 0 (W7's file: through the coordinator).
4. **A console error in still mode** (W7's file): `<rect> attribute width: A negative value is not valid. ("-18.00")`, the wipe rects of `viz/charts/LineDraw.tsx` (line 77) at a first measure of 154 px, before the chart has its width; it settles (the chart is right in the screenshot) but the console is not clean.
5. **Not in the data:** `extraction` (with `provenance`; the model chapter shows NO DATA YET) and `ablation` (PENDING).

**Next.** `merge_ready` to the coordinator (my first merge frees `App.tsx` for W4 and `main.tsx` for W8). Then the polish list above, then the other order (solution, hero, problem, evidence, enter, models); adopt `extraction` when W7 lands it; the R5 and R6 rewrite (decision 8).
