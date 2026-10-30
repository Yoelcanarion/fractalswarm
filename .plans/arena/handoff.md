# Handoff to the second Phase 2 coordinator (Fri Oct 30, 2026)

The first coordinator handed over at about 03:00 CET and stopped (Yoel's decision, arena spec §M).
You now hold the whole coordinator role:
- the web and the app;
- every paid run, within Yoel's budget;
- merges into `Yoelcanarion/arena`;
- the story files: `docs/claims.md`, `bench/REPORT.md` (the top, §5, conclusions), `docs/video-script.md`, `docs/submission.md`, `README.md`;
- the progress log and the nightly push.

Talk to Yoel in Spanish; everything in the repo stays in English. Where this note and
`.plans/arena/coordinator.md` disagree, this note wins. Arena spec §M wins over both.

## Start here

1. **Take the branch.** In your worktree, run `git switch Yoelcanarion/arena`. The first coordinator's worktree
   (`C:\Users\yogar\orca\workspaces\work-orquestrator\arena`) is detached at the branch's tip as of the handoff (the commit that added this note), so the branch is free.
   - Orca created your worktree on a branch of its own. Leave that branch alone: deleting branches needs Yoel's OK.
   - Never use a bare `git stash`.
2. **Set up.** Run `uv sync --extra safety`. A plain `uv sync` strips torch, and the PromptGuard tests then skip silently. Then run `npm --prefix web install`.
3. **Read**, in this order:
   - `CLAUDE.md`;
   - `.plans/arena-spec.md`: §M first, then the rest;
   - `.plans/arena/coordinator.md` (your brief, apart from what §M and this note change);
   - the last entry of `.plans/progress.md` ("Phase 2, Thu 29 Oct", with its night part);
   - `docs/claims.md`;
   - the top and §1 of `bench/REPORT.md`.

   Your memory files load by themselves. They hold this machine's quirks: Orca mailbox acks, the safety extra, the full suite in chunks, quiet windows, load experiments, PowerShell and UTF-8, headless screenshots, and asking Yoel at most 5 questions at once.
4. **Set up Orca.** Run `orca skills get orchestration`.
   - The first coordinator's Run is `run_b6aeda164409`. Leave it; create and bind your own with `orca orchestration run-create`.
   - No worker is running. Start each one as a new Task on its existing worktree (table below) with `C:\Users\yogar\.fractalswarm\coord\start_worker.ps1`.
5. **Write to Yoel in Spanish:** say that you have taken over, and what you are starting with.

## Where things stand (about 03:00)

- **arena HEAD:** the commit that added this note, on top of 6377a51.
- **Tag `handler-freeze`:** a5e9609. After it, nothing that a recorded run replays through may change: kernel, coord, market, actors, comms, planning, tasks and the baselines. Only the UI, the API, docs and bench reporting change. If you find a handler bug, don't fix it in place: ask Yoel.
- **Merged on Oct 29–30:**
  - W1: the jitter sweep and the headline matrix;
  - W3: the answer path, the last handler change (dedde57);
  - W4: live controls, answer buttons, scored counters;
  - W5 MP1 and MP2: arena, "where it helps", intake review, ablation, director, recorder;
  - W3's events-API fix (6377a51): `Catalog.page` reads a page and the last seq in one snapshot. Full checks green: unit 1077, integration 897, PromptGuard 3.
- **The real evidence** (Contributor routing, live clock):
  - `bench/results/v1`: 96 runs, all completed and valid. 6 workflows × T1, T2 × C0–C3 × seeds 1–2. The cells come from several commits; aggregates from all 96. Hero chart: `hero-t2_conference.png`.
  - `bench/results/headline`: 18 runs, recorded at e307ca1 after the freeze. Swarm, durable-max and durable × T2 × C0, C3 × seeds 1–3. All 18 completed and valid; $5.15.
    - `bench verdicts bench/results/headline` against `durable-max` at T2 C3: locality holds (H4a, H4b and H4c win on every seed).
    - H1–H3, H6 and stall time tie; H5 loses (2.0 false deaths per run).
    - Claims R2 and R4 carry the numbers.
  - Coordination tokens: 0 in every real run, rivals included.
  - Reading so far: against `central` (in-process supervisor) the swarm's stall and extra cost are a fraction of central's. Against the durable rivals it ties within the noise. This is outcome B, as at the $0 gate. `docs/claims.md` has the numbers.
- **Spend:** at 02:20 `fractalswarm spend` showed settled $24.6654, reserved $4.1279 and remaining $121.21 of $150. The reserved money is stale: calls cut off in flight, kept open on purpose.
  - **Budget (§M):** keep about **$30** of the credits. Stop and ask before any run that would leave less than about $30 in `remaining`.
- **Decided by Yoel on Oct 30** (§M):
  - full handoff to you;
  - the tagline is "Kill half the brains. It still finishes." only (claims S7);
  - the final arena pair is recorded against both `central` and `durable-max`;
  - the 10-seed extension plus `central`;
  - ffmpeg is installed (9.0.2, with winget; it is on the user PATH for new shells);
  - his old W4 tab is closed.

## Workers

All are done and merged; none is running. Start them again as new Tasks on these worktrees (all under
`C:\Users\yogar\orca\workspaces\work-orquestrator\`). Each branch is merged into arena: merge arena into it first.

| Worker | Worktree / branch | What it knows | Open item |
|---|---|---|---|
| W1 rival | `arena-rival` | rivals, PREREG, verdicts, REPORT §4 | REPORT §3 and §4.10 with the real rows, plus the seed-3 wording (§4.4, §5). A spec draft is in `coord\spec-w1-report-draft.txt`, filled in for arena 6377a51 and the headline at 098f405. Add R4 and the 10-seed rows to what it asks. |
| W2 intake | `arena-intake` | intake, approved truth, PII | After approval, `GET /api/intake/{id}` still returns Muse's proposal; there is no endpoint for the approved reading (W5's notes, item 6). |
| W3 meta | `arena-meta` | Muse lens, Wonder arbitration, the events API | Seen, not fixed: `events_page` runs blocking sqlite and pydantic on the event loop (about 170 ms per 5,000-event page), which matters for the live UI. |
| W4 ui-core | `arena-ui-core` | design system, motion, live controls, counters | — |
| W5 ui-arena | `arena-ui-arena` | arena view, "where it helps", director scenes, recorder | The final pair: in one commit, `web/src/director/sources.json` and `"real": true`; tuning of s4 and s6 from the real lengths (its notes, "Tuning the scenes on the final pair"); one recorder slot per pass. |

- **New work** goes to new workers in new child worktrees branched from arena, for example W6 for the home page.
- **At most 4 workers at a time** (machine: 15 GB, 16 CPUs). Yoel's Firefox, Discord and Steam take about 5 GB.
- **Workers are Sonnet 5.5 at max effort.** They escalate with `/hard-task` themselves.
- **Every spec** = the item + `coord\spec-rules.txt`, the shared rules: no real calls, slots, ack every batch, notes, merge_ready, trailer. No double quotes in a spec.

## Yoel's priorities now (§M), in order

1. **The home page as a presentation.** Today `#/` opens straight into a run (`web/src/App.tsx`, `parseHash`); there is no home page.
   - Build a scroll story that explains the problem (one coordinator is a single point of failure: when it dies, work stalls or is paid for twice) and the solution (a fractal tree of orchestrators, leaderless HRW takeover, a hash-chained log that replays bit for bit), told with charts.
   - End it in a menu into the simulation: the arena pair, a live run, the replays, intake ("new task"), director, charts.
   - Use the real numbers from the committed files only: `bench/results/v1/hero-t2_conference.json`, `bench/results/headline/...`, `bench/results/honesty.json`, the regime map. Every claim on the page must be an allowed row of `docs/claims.md`, in its wording.
   - The three questions of spec §0 decide what goes on it: the problem, why Meta's models matter, and the evidence.
2. **Animation and visual effects tied to the charts as the page scrolls:** charts that draw, count up and reveal as they enter; a tree that loses half its brains and heals.
   - Quality matters. Respect `prefers-reduced-motion`. Work offline (`demo --verify` serves the bundle; fonts are bundled).
   - Stay smooth on this machine (W4 measured about 37 fps on a heavy run page with software rendering).
   - The stack: `motion` 14 (`useScroll`, `useInView`), `recharts` 3, `@xyflow/react`.
   - The headless Chromium 130 of Playwright crashes on CSS container queries: use media queries.
3. **Polish the whole web UI**, then the whole app. Yoel: "No te detengas en el paso 10; haz todo lo posible". When spec §I is done, keep improving until the submission.

## Paid queue (approved by Yoel, §M; keep about $30)

Each run goes in a quiet window:
1. HOLD to the workers, and wait for their HOLD acks.
2. Start the chain detached.
3. Poll in chunks under 9 minutes.
4. Afterwards: `spend`, commit the cells and the aggregates, RELEASE.

No merges into arena while a block runs.

1. **The 10-seed headline extension plus `central`** (`bench/matrix-headline-10.yaml`, about $20, 4.5–5 h).
   - First copy `bench/results/headline/cells` and `bench/results/headline/runs` into `bench/results/headline-10`.
   - The dry-run must then read 80 cells, 18 done, 62 to run, worst case $31.
   - Run it in blocks between the UI's slots; finished cells are skipped. Read it with `bench verdicts bench/results/headline-10`.
   - Report it next to the pre-registered 3-seed reading, never instead of it.
2. **The final arena pairs**, through the UI/API arena launcher (spec §D.6, "half the brains", same input, started together):
   - swarm against `central`, and swarm against `durable-max`;
   - first with the sample text; Yoel's own text for the final take.
   - Then W5 sets up the director on them.
3. **The final demo bundle:** a fresh real kill-half T2 run after the freeze (the Day 9 command is in progress, "the root dies in a real run"), checked like Day 9's (root death, heir, adoption, no duplicate calls).
   - Then `fractalswarm bundle <run> --name <name>`, and `demo --verify` and `replay --verify` at HEAD.
   - The attack clip and its wording wait for Nov 3 (Yoel).
4. **The LangGraph rows** (`bench/matrix-langgraph.yaml`): its `--fake` gate first.
5. **The scaling sweep** (`bench/matrix-scaling.yaml`): its `--fake` run first.
6. **T3 real.**
7. **Live-input rehearsals** (intake, review, run, arena pair), with the sample text.
8. **With what is left** above the $30 floor: more seeds or takes where the evidence or the video needs them.

## $0 queue

- **REPORT** §3 and §4.10 (W1), then the top of the REPORT and §5 with the real rows (yours).
- **`docs/claims.md`** (yours):
  - the real rows: done for the headline (R2, R4); add the 10-seed rows when they exist, whatever they show;
  - S5 once the final recordings MATCH at HEAD;
  - S1 and S2 with the final bundle's takeover report.
- **`docs/video-script.md`** (v0.1, outcome B): the tagline of S7 and the real numbers.
- **`docs/submission.md` and `README.md`:** Day 10's list (`.plans/days/day-10.md`), which arena spec §M extends.
- **A secret and PII scan dry run** (spec §I.5).
- **The intake endpoint (W2) and the event-loop note (W3)** above.
- **Merges into `master`, making the repo public, the attack clip, the voice-over:** with Yoel (spec §I.6).

## Tools the first coordinator left

These live in `C:\Users\yogar\.fractalswarm\coord\`, outside the repo. Logs go to `coord\logs\`.
- `paid_chain.ps1 -Repo <worktree> -BlockList "label|bench/<matrix>.yaml[|out];..." [-FloorUsd 30]`: start it detached with `Start-Process ... -WindowStyle Hidden`; the header has the line. It stops before a block whose worst case would take `remaining` below the floor.
- `merge_checks.ps1 -Label <x> [-Web] [-Pytest <files>] [-SkipRefs] [-SkipPytest]`: ruff, demo and replays, the references, tsc and vitest, pytest. For a Python merge, run the full suite in chunks under 9 minutes, PromptGuard included.
- `cells_status.ps1 -Dir bench\results\<dir> [-Filter 'swarm__*']` and `cells_summary.py <dir>`: the cells, and the means per workflow and profile with the extra cost against C0.
- `wait_real.ps1 -Run <your run> -Seconds 540`: waits for real mail and acks heartbeat-only batches. Ack real batches yourself, in a separate call.
- `start_worker.ps1 -SpecFile <f> -Worktree <path> -Title <t>`, with `spec-rules.txt`.
- Nightly push, pre-approved for the working branches: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push -u origin <branch>`. `master` and publishing still need Yoel's OK.
