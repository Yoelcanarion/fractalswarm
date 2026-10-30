# W6 `home` and W7 `home-viz`: the home page as a presentation

Yoel's first priority (arena spec §M.2, §M.10). Two workers, one page, this one brief.
- **W6 `home`** owns the page: story, copy, layout, scroll scaffolding, the menu, the route.
- **W7 `home-viz`** owns the pictures: the data generator and every animated visual.

Read first, in order: `CLAUDE.md`, this brief, `.plans/arena-spec.md` §0 and §M, `docs/claims.md`, `.plans/arena/worker-rules.md`, `bench/REPORT.md` §1 and §5, `docs/video-script.md` (for the tone), `web/src/styles/tokens.css`, `web/src/lib/motion.ts`.

Skills to load before you start the matching work: `dataviz` (before any chart), `animate` (before any motion), `better-ui` (for surfaces and detail). Use `/hard-task` for the design decisions and for anything that fights you.

## The goal

Today `#/` opens straight into a run. Nobody who opens the app learns what it is for. The home page fixes that: a person who has never heard of FractalSwarm scrolls for two minutes and can say **what problem it solves, why Meta's models matter to it, and what evidence shows that recovery works** (spec §0). Then a menu takes them into the simulation.

This page is the first thing the jury sees, and it is judged on craft. It must feel made by a good design studio. Restraint and precision beat effects: one idea per screen, exact alignment, real data, motion that explains. If an animation does not explain something, cut it.

**Style (Yoel, Oct 30):** a mix. The top is a product landing: dark, large type, one striking animated object. The body is a data story in the manner of The Pudding or the NYT: sticky visuals that change as you scroll, short sentences beside them.

## Hard rules

1. **Real numbers only.** Every number on the page comes from a committed result or from a recorded run, through the generated data file. No number is typed by hand into a component. A structural fact (10 orchestrators, 12 agents) comes from the data too.
2. **Every claim is an allowed row of `docs/claims.md`, in its wording.** The generator copies the row's text into the data file by id; components render that text. A claim whose row is `pending` must not reach the final page: during development it renders with a visible `PENDING` tag, and the coordinator turns the rows to allowed when the final bundle exists. If the story needs a sentence that makes a claim and has no row, ask the coordinator for a row. Do not edit `docs/claims.md` yourself.
3. **Never** write "simpler", "cheaper", "more reliable", "first", or "without stalling or paying twice". The tagline is exactly `Kill half the brains. It still finishes.` and the measured numbers go under it, each with its rival named.
4. **Every result names its setting** in a small caption: the task, the failure profile, real model or fake, the number of seeds. A locality number names its failure model (per crash). R4 appears only with its setting and next to the $0 gate, where locality tied. R2 and R3 always appear together.
5. **Honesty is a feature.** The page shows where FractalSwarm does not help: the fast external restart (it loses), false deaths (it loses), per process (comparable), the log as a central component (S6's limitation). A jury trusts the page more for this. Do not bury it.
6. **Offline.** No external URL of any kind. Fonts are bundled. The data is bundled. The page makes no API call at all, so it also works with no server (the static showcase, W8).
7. **Reduced motion.** With `prefers-reduced-motion`, nothing scrubs or moves: every beat shows its final state, the sticky sections become normal flow, and the page still reads well. Use `prefersReducedMotion()` from `lib/motion.ts`.
8. **Media queries only, never CSS container queries** (the headless Chromium 130 crashes on them).
9. **Colours only through tokens** (`lib/tokens.test.ts` enforces it). New tokens go in `tokens.css` with both themes, and pass that test. Dark is the default; light must also look right.
10. **Smooth on this machine.** It renders in software in the headless browser. Target at least 50 fps through a full scroll at 1920×1080, measured (`lib/perf.ts`). Animate only `transform` and `opacity` where you can. No large `filter: blur`, no `backdrop-filter`, no layout reads in a scroll handler. Drive scroll work through `motion` values, never through React state on every frame. Use canvas when an SVG gets heavy.
11. **No scroll-jacking.** The wheel always moves the page at its normal speed. Sticky sections pin; they never take over the input.
12. **The handler freeze holds.** Change nothing under `src/fractalswarm` except what a section below names. No real calls, ever.

## The story, beat by beat

The words below are a draft for W6 to sharpen, in plain English, with short sentences and no jargon that is not explained on the spot. The structure is fixed. Where a sentence states a measured fact, the data decides the number.

The reader meets one running example: **planning a conference from messy emails** (task T2: 48 talks placed into sessions across three tracks and two days).

### 0. Hero (one screen)
- Small line: `FractalSwarm · multi-agent runtime on Muse Spark and Muse Wonder`.
- H1: `Kill half the brains. It still finishes.` (S7), very large.
- Under it, the subtitle: the numbers with the rival named (S7's evidence; R5 against the in-process supervisor; R2 against the ideal durable supervisor). Two short lines at most, in the muted text colour.
- The object: **the real tree** (root, 3 tracks, 6 sessions, 12 agents) on the right or behind the text. On load it plays once, about 8 s: the run's real sequence of five kills, and the tree heals. Then it breathes quietly (heartbeats). On scroll it hands over to the next beat.
- Two actions: `See how it works` (scrolls to beat 1) and `Enter the simulation` (scrolls to the menu). `Enter the simulation` stays reachable all the way down, in a small fixed bar.

### 1. The problem (sticky stage, about 4 screens)
Left, short steps; right, the stage (W7's **work lanes** on a real run of the in-process supervisor: one lane per agent, each LLM call a bar, on a shared clock).
1. `A team of AI agents usually has one coordinator. It plans, assigns and checks the work.` The lanes fill with bars as you scroll.
2. `Then it crashes.` A red line drops through all the lanes at the real crash time. The lanes go grey. A large seconds counter runs while the work waits.
3. `In a simple setup the workers die with it. Their calls were already paid for, and now they are paid for again.` Cancelled bars turn red, redone bars amber. A cost counter climbs.
4. Real numbers, count-up: R5, stall and extra cost at C3. The caption says what this rival is, and that most of its gap comes from that design (`bench/REPORT.md` §1).
5. `A better supervisor fixes the paying twice: its workers survive, and a standby takes over. But then you run a supervisor, a standby and something to watch them. Even an ideal one has to stop to recover.` A small diagram of those parts.
6. The question, alone on screen: `Can a team recover without one?`

### 2. The solution (sticky stage, about 6 screens). The centre of the page
The stage is W7's **tree**, driven by scroll through the real kill sequence of the demo bundle (`fractalswarm takeover demo/backup --json`).
1. `Replace the one coordinator with a tree of small ones.` The tree grows: root, tracks, sessions, agents.
2. `They share a log, not a brain.` (S6, with its limitation as a caption.) A thin strip of the event log runs under the tree. Every event carries the hash of the one before.
3. `Kill the root.` The real first kill. The node dies, its heartbeats stop, and the seconds count until the real death verdict.
4. `Every survivor reads the same log and computes the same heir.` W7's **HRW moment**: one panel per survivor, each computing `hash(goal, member)` with the real scores from the run, and all reaching the same answer at the same instant. No arrows between them: nothing was sent. `No vote. No election. No tokens.` (S1, S3, S4.)
5. `The heir adopts the work, and every result already in the log.` The subtree re-wires to the heir (edges follow, a pulse travels along them).
6. `Again.` Scroll now runs through the other four real kills, faster: a session, a track, another session, another track, the root moving o0 → o1 → o2 → o3. Half the brains are gone.
7. `It still finishes.` The tree settles, and the real final numbers count up: talks placed, hard violations, duplicate calls, cost (S2).

### 3. Why Meta's models matter (a calmer section, about 3 screens)
Spec §E. No sticky stage needed; things reveal as they enter.
1. `The hard part of this task is reading people.` A messy email next to the constraints Muse Spark drew from it, each linked to its source sentence (a real example from a recorded run's extraction; the lens data has them).
2. `Is the model really doing the work?` The ablation result, when its row exists: the same notes, a hand-written parser against Muse. Until then, this block shows its `PENDING` tag.
3. `Muse does the understanding. Recovery costs no tokens.` One row per model with what it does: Spark reads, places and checks; Wonder plans and arbitrates; Llama PromptGuard 2 guards the inputs. Beside it a single stacked bar of tokens by model for the demo run, and `coordination tokens 0 · recovery tokens 0` (S4, as a property of the design, never as an advantage).

### 4. The evidence (mixed, about 6 screens)
1. **The fair fight.** `We built the strongest rival we could, and gave it every advantage.` The table of what we grant the rival (`bench/REPORT.md` §1), short: 5 s detection, 0 s restart, workers survive, same log.
2. **Hero chart.** Stall time and extra cost against coordinators killed, for each workflow on the real model (`bench/results/v1/hero-t2_conference.json`, and `headline`). Axes first, then the lines draw, then direct labels at the line ends (no legend box). Swarm in the accent colour; rivals quieter.
3. **The tie, said plainly.** R2 in large type, R3 right under it. Per-seed dots for stall and extra cost against `durable-max`: the reader sees the two clouds overlap. The word `Tie.` is allowed to be large.
4. **Where it helps.** R4, with its setting: three pairs of bars (coordinator-dependency time, blast radius, idle agent-seconds), and next to them the note that at $0 locality tied.
5. **Where it does not.** The tone turns: the fast external restart (R3: 13.2 and 5.7 times the supervisor's), false deaths, per process. The regime map as a strip: at each assumption of the rival, does locality hold, tie or fail. Say `Here the supervisor wins.`
6. **Proof.** The hash strip comes back and runs to its end. `Every run replays bit-for-bit from a hash-verified log.` (S5.) A terminal block types `uv run fractalswarm demo --verify`, then the real `MATCH` line with the head hash, and `TAKEOVER OK`. Say what replay proves and what it does not (claims, Rules).

### 5. Enter the simulation (the menu, one screen)
A grid of doors, each with a one-line purpose and a small live glyph drawn from the same visual language:
- **The arena**: two systems, same failures, side by side (`#/arena`).
- **A live run**: launch one and kill its coordinators yourself (`#/new`, and the run view).
- **Replays**: every recorded run, with its verification (`#/runs`).
- **New task**: paste your own messy text and let Muse read it (`#/new`).
- **Director**: the video's scenes, played on real logs (`#/director`).
- **The numbers**: charts and where it helps (`#/charts`, `#/helps`).
- **Ablation**: parser against Muse (`#/ablation`).

Each door reads its availability from a small list W6 owns, so the static showcase (W8) can mark a door `needs the local server` instead of leading to a dead page.

## Art direction

- **One visual language from top to bottom:** a brain is a circle with a thin ring; an agent is a small square; a message is a short bright dash along an edge; a dead brain is an ember (dim, cracked ring); a call is a bar.
- **One colour meaning from top to bottom:** accent = the swarm at work; `--danger` = death and lost work; `--warn` = paid twice; grey = waiting; `--ok` = verified. Rivals use quiet neutrals. Never use colour for decoration.
- **Type:** Inter Variable at display sizes with tight tracking (add display tokens, up to about 96px, fluid with `clamp`); JetBrains Mono for numbers, hashes, run ids and captions, always `font-variant-numeric: tabular-nums`.
- **Space:** a 12-column grid, generous margins, one idea per screen. Text columns stay under about 60 characters.
- **Motion:** eased, short, and physically plausible. Reveals stagger by 40–60 ms at most. A scroll-driven value passes through a light spring so the wheel's steps do not show. Nothing bounces. Nothing loops except the heartbeat.
- **A chapter rail** on the side: Problem · Solution · Models · Evidence · Enter, showing where you are, each a link.

## Ownership

**W6 (`Yoelcanarion/arena-home`)** may edit:
- `web/src/home/**` except `web/src/home/viz/` and `web/src/home/data/`;
- `web/src/App.tsx`, only to add the home route and to split the bundle (below);
- `web/src/styles/tokens.css`, only to add tokens;
- `web/src/main.tsx`, only if the split needs it;
- `web/index.html`, for the title and the meta description;
- its notes, `.plans/notes/arena-home.md`.

**W7 (`Yoelcanarion/arena-home-viz`)** may edit:
- `web/src/home/viz/**`, `web/src/home/data/**`;
- `scripts/build_home_data.py`, and its test in `tests/unit/test_home_data.py`;
- `web/src/styles/tokens.css`, only to add tokens, coordinated with W6 through the coordinator;
- its notes, `.plans/notes/arena-home-viz.md`.

Neither edits `docs/claims.md`, `bench/`, `src/fractalswarm/` or `.plans/progress.md`.

## The contract between W6 and W7

Each visual is a pure component in `web/src/home/viz/`:

```ts
interface VizProps {
  /** 0..1, how far through its beat this visual is. A motion value, so a scroll updates it without a React render. */
  progress: MotionValue<number>;
  /** The slice of the generated data this visual draws. */
  data: ...;
  /** Final state, no motion: reduced motion, or a static capture. */
  still?: boolean;
}
```

- W7 keeps a lab route `#/home-lab` (behind a dev flag, or simply unlinked) that shows every visual with a slider for `progress`, so it can work and be reviewed without W6's page.
- W6 builds with placeholder boxes of the agreed size until W7's visuals land, and imports them from `web/src/home/viz/index.ts`.
- The beats (`steps`, thresholds) live in W6's code; a visual knows only `progress`. Where a visual has internal keyframes that the text must match (a kill at 0.32), W7 exports them, for example `TREE_KEYFRAMES`.
- W6 and W7 do not message each other. Anything they must agree on goes through the coordinator.

## The visuals (W7)

- **`SwarmTree`**: the real tree. Nodes, edges, message dashes, heartbeats, kills, verdict delay, HRW takeover, edge re-wiring that follows the nodes, the root's succession. Used by the hero (time-driven) and beat 2 (scroll-driven).
- **`WorkLanes`**: one lane per agent, one bar per LLM call, on the run's clock, with crash lines, cancelled and redone calls coloured. Canvas is probably right here. Revealed by `progress`.
- **`HrwPanels`**: the survivors computing the same heir, with the real scores.
- **`HashStrip`**: a band of real events with their real hashes, each pointing at the one before, moved by `progress`; it ends on the run's head hash and the `MATCH` stamp.
- **`LineDraw`**, **`DotPlot`**, **`PairedBars`**, **`RegimeStrip`**, **`TokenBar`**: small SVG charts with `pathLength`-style drawing, hand-built so that every stage of the draw is under control. Direct labels, real axes, a text alternative for screen readers.
- **`CountUp`**: a number that counts once when it enters, tabular, respecting `still`.
- **`DoorGlyph`**: the small drawings of the menu.

## The data (W7)

`scripts/build_home_data.py` writes `web/src/home/data/story.json`. It holds no number of its own: it reads them all.

| Slice | Source |
|---|---|
| `claims` | `docs/claims.md`, by row id: text and status, verbatim |
| `tree`, `takeover`, `hrw`, `finish` | the demo bundle: `fractalswarm.verify.takeover` on `demo/backup` (the bundle's name is a parameter: the final bundle replaces it), and the run's `task.result` |
| `lanes.central` | a real C3 run of `central`: `bench/results/v1/runs/central__t2_conference__C3__s1` (`effect.started`, `effect.completed`, `effect.cancelled` by agent; reuse `bench/scoring.py` rather than recompute) |
| `lanes.swarm` | the demo bundle |
| `hashes` | the demo bundle's events: a thin sample, and its head |
| `hero` | `bench/results/v1/hero-t2_conference.json` |
| `headline` | `bench/results/headline/results.json`, per seed |
| `verdicts` | `bench/results/headline` through the code behind `bench verdicts`, or its stored output |
| `regime`, `perProcess`, `falseDeaths` | `bench/results/honesty.json`, `bench/results/regime.json` |
| `tokensByModel` | the demo bundle's `effect.completed` usage |
| `assumptions` | `bench/REPORT.md` §1's table, or a constant checked against it |

- It records each source's path and, for a run, its id and head hash, in `story.json`.
- It is deterministic: run twice, same bytes (sorted keys, fixed precision).
- `tests/unit/test_home_data.py` regenerates and compares with the committed file, for the slices whose sources are in git. A slice whose source run is not in git keeps its derived file and is checked against the committed summary cell (for example the lanes' stall time against the cell's `stall_s`).
- Keep `story.json` under about 150 KB. Lanes in compact arrays.
- A later bench result (the 10-seed extension lands in `bench/results/headline-10`) must reach the page by re-running the script, with no code change. Put `headline-10` in as an optional source now, shown next to the 3-seed reading and never instead of it.

## The route and the bundle (W6)

- `#/` is the home page, with its own chrome (not the app's top bar): a small fixed bar with the brand, the chapter rail, `Enter the simulation` and the theme toggle.
- `#/run` (no id) opens the first listed run, as `#/` does today. Every existing deep link keeps working. In the app's top bar the brand already links to `#/`.
- `App.tsx` today imports every page, so the home page would pull recharts and React Flow into its first load (the bundle is 1.2 MB). Split it: the home page loads first and alone; the app shell is a lazy chunk. The home page makes no API call, and the store is not touched until the shell loads. Check the size of the first load and report it.
- `web/index.html`: a real title and description.

## Tests and evidence

- Vitest for everything pure: the step maths, the keyframes, the data selectors, and a guard that holds the page's quoted claims to `story.json` and refuses a `not claimed` row.
- `npm --prefix web run typecheck`, `npm --prefix web test`, `npm --prefix web run build`.
- Playwright screenshots (Chromium headless): 1920×1080, 1366×768 and 390×844, dark and light, plus reduced motion, at each beat. Check them yourself: read the images, and be hard on them. Look for clipped text, overlaps, things that do not line up, empty space that looks like a mistake. Keep the capture script in `web/scripts/` or `scripts/`, in your own file.
- A frame-time run through the whole page at 1920×1080. Report fps and p95.
- `demo --verify --no-serve --no-browser` still MATCHes.

## How to work

1. Read, then **sketch the page in code quickly**: every beat in rough form, real data where it exists, placeholders elsewhere. `merge_ready` as soon as it scrolls end to end, even if it is plain. The coordinator merges it early, so that everyone sees the page and other work rebases on the new route.
2. Then iterate beat by beat, in the order 2, 0, 1, 4, 5, 3. Each iteration: look at it, fix what is weakest. The coordinator reviews screenshots and sends notes. Expect several rounds; the quality comes from them.
3. Merge often (`merge_ready`), small and working. Keep your notes file current.
4. Slots: browsers, dev servers and builds run only between the coordinator's paid blocks. You get a RELEASE message when they are allowed and a HOLD when they stop. While on HOLD keep working on code, `tsc`, and vitest on one worker (`npx vitest run <dir> --maxWorkers=1`). You do not need to ask for a slot during a RELEASE window: one dev server each, on its own port (W6 5174, W7 5175).
