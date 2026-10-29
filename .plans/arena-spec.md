# FractalSwarm Phase 2 — "Arena" spec

**Status:** approved by Yoel on Wed Oct 28, 2026, after a four-round interview. Its decisions are final unless Yoel changes them. Record every deviation in `.plans/progress.md`.

**Scope:** Oct 29 to Nov 4, in the Orca workspace `arena` (branch `Yoelcanarion/arena`), run by an Orca coordinator plus workers.
- Coordinator brief: `.plans/arena/coordinator.md`.
- Worker briefs: `.plans/arena/w1-rival.md` … `w5-ui-arena.md`.

**Precedence:**
- Where `.plans/fractalswarm-spec.md` (§0.1 claims, §15 fairness, §23 video) or `.plans/days/day-10.md` disagree with this document, this document wins.
- Day 10's checklists still apply: README sections, fresh clone, logged-out check and the submit URL.

---

## 0. Why this phase

**State at the end of Day 9** (branch `Yoelcanarion/day-09`, b07fa0c):
- Days 3–8 are integrated and the $0 gate passed.
- Real runs are verified, including the backup bundle in which the root's owner dies three times.
- Chart v1 has 29 of 32 cells.
- Spend: $11.8194 settled, plus $2.9458 reserved (mostly stale reservations of cancelled calls).

**Still open:**
- `master` is stale (2440cc6).
- Four worker branches were merged into `Yoelcanarion/day-09-integration` (c14231c: scaling, LangGraph, resume, economy). Nothing beyond ruff ran on them.
- The run evidence is untracked: `bench/results/` and `runs/` live only in the day-09 worktree.
- Day 9's own list is unfinished: the v1 tail, publishing, LangGraph, headline runs, final bundle and attack clip.

**Yoel's goals for the phase:**
1. **The strongest fair rival.** Compare against a recoverable supervisor under the same failures, and check honestly whether both keep the same work and cost the same. If they do, find the concrete advantage that remains: recovery time, unnecessary reassignments, duplicated work, or dependence on a central coordinator.
2. **Meta's models visibly carry value**, so the project is not just a framework.
3. **A polished, fluid UI** where Yoel types a small real input live, watches the system act on it, and then uses that same input for a side-by-side comparison.
4. **A dynamic 3-minute video** with Yoel's English voice-over, plus the texts for the submission form.

### North star
The aim is not to show more features than the other projects. In three minutes, the jury must understand three things:
1. **What problem FractalSwarm solves.**
2. **Why Meta's models matter to it.**
3. **What evidence shows that recovery works.**

Every feature, screen and second of video must serve one of these three answers. Anything else stays in the app and the README, but out of the story.

### Forensic finding: the old baseline's 27 lost calls
The old `central` baseline lost 27 LLM calls at C3 in its real run (`t2-real-c3-central-seed1`):

| Cause | Calls |
|---|---|
| Its own workers, killed by the baseline's simulated process-tree stop (`_crash` stops every agent with `cancel=True`, `actors/orchestrator.py` ~1376) | 19 |
| Its own plan and judge calls, which a process death genuinely loses (the swarm lost 1 such call) | 5 |
| Chaos agent kills, which hit both systems (the swarm lost 2) | 3 |

Its restart re-dispatched the work its stopped workers had lost. The run has 41 dispatches of 18 pieces of work, so 23 are re-dispatches:
- 21 follow a "lost in a crash" rejection;
- 2 are of one contract (`track-data/d2/place`), re-dispatched twice after its result had been logged.

W1's duplicate count for this run is 42 calls paid twice ($0.22), more than the whole $0.10 gap to the swarm ($0.601 against $0.501).

*Corrected Thu Oct 29 (found by W1, checked on the log by the coordinator):* this paragraph used to say that the restart re-dispatched 22 contracts whose results were already in the log, because `TreeView` never registers central goals. The log does not show that.

**Conclusion:** the old cost gap comes mostly from the baseline's in-process design: a crash stops its workers, and their work is done and paid for again. It is not evidence against a well-built supervisor. The old row stays as a reference, with this explanation next to it.

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Rival | Two durable supervisors. **`durable-max`**: workers survive the crash and their results are adopted from the log; its own plan and judge calls are durable jobs, so only its 5 s absence remains. **`durable`** (realistic): the same, but its in-flight plan and judge calls are lost, as with LangGraph or CrewAI supervisors. The old `central` stays as a reference row, relabelled "in-process supervisor". |
| Story | Three questions in three minutes (§0). The UI and the video are built around them, not around a feature tour. |
| Two pre-defined conclusions | **A:** if FractalSwarm clearly cuts blocking time and blast radius against the ideal rival, the story is "recovery stays local to the affected subtree". **B:** if it does not, the story says so: "resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism". |
| Claims discipline | "Needs no supervisor" does **not** imply "simpler", "cheaper" or "more reliable". Each of those is a separate claim that needs its own evidence, or it is not made. The log is still centralized: we remove the coordinator as a single point of decision, not every single point of failure. |
| Rival assumptions | The rival's 5 s detection and 0 s restart are stated plainly (in REPORT, the arena and the video). A sensitivity sweep checks that the conclusion does not depend artificially on them, or on the failure model (§C.2). |
| Honesty | Show where FractalSwarm helps and where it does not (a "where it helps" panel). Claims come only from data, through `docs/claims.md`. |
| Real input | Yoel types or pastes it **live** in the UI, **in English**. It is **small, with a fixed shape**: 8–15 talks plus a few emails or notes, always mapped to 3 tracks × 2 blocks so the tree keeps 10 orchestrators. Nothing typed live goes into git unless he chooses. |
| Meta visibility, in priority order | (1) Muse intake; (2) Muse lens, a per-call inspector; (3) ablation, regex parser vs Muse; (4) Wonder arbitration at the lowest common ancestor. |
| Arena | Side by side: swarm left, supervisor right, a shared timeline with the crashes, and counters face to face. |
| Video | Director mode in the app. **Captured automatically**: Playwright records one clip per scene at 1920×1080, and any scene that stutters falls back to OBS. Yoel's voice-over follows a **word-for-word script** in plain English, timed per scene, with a key-points version beside it. Light editing. |
| Scope | Nothing is cut from the build: LangGraph rows, scaling sweep, T3 real run and economy panels all stay, in priority order. The video and the top of the README carry only what answers the three questions. |
| Spend | **One total cap of $50** for everything left, with a daily spend report. The hard stop is settled project spend at **$61.8**. |
| Agents | Orca coordinator (Opus 5.5, max effort) plus **4–5 parallel workers** (Sonnet 5.5, max effort, escalating with `/hard-task`), each in its own child worktree. |
| Publish | Nov 3, after recording: final secret and PII scan, make the repo public, check it logged out. |
| Push | Each night the coordinator pushes the working branches (`Yoelcanarion/arena` and the workers' branches) to the **private** repo as a backup. Merging into `master`, pushing `master` and publishing still need Yoel's explicit OK. |
| Most Viral | No. |
| Submission form | Drafts of every text field (`docs/submission.md`). Yoel picks the track and problem statement from the form's list on Nov 4. |

---

## A. Rivals and fairness rules v2

### Workflows
- **`swarm`:** ours, unchanged.
- **`durable-max`:** one coordinator, o0, with 12 agents and the same log.
  - At a crash, its agents keep working. Results sent while o0 is down are logged (the actor drops them) and adopted at restart.
  - Its own plan and judge calls are not cancelled; their completions are adopted from the log.
  - It restarts 5 s after the crash (the same as the swarm's detection latency), and the restart itself takes 0 s.
  - Recovery uses no LLM. This is equivalent to a hot standby taking over after a 5 s lease.
- **`durable`:** the same, except that o0's own in-flight plan and judge calls are cancelled and redone after the restart.
- **`central`** (reference): today's in-process supervisor with process-tree semantics, kept with the 27-call explanation.
- **`single`, `pipeline`, `langgraph`:** secondary rows.

### Fairness
- The `bench/REPORT.md` §1 rules still hold: the same crash points and targeting policy, the same agent-kill share and seeds, the same API-fault seeds, the same 5 s detection, and a best-case 0 s restart.
- New rule: "**the rival gets every advantage we can implement fairly**".
- Every change is gated by mode, so the recorded `central`, `single` and `pipeline` logs still replay MATCH.

### What we grant the rival
These assumptions are published as a table in `bench/REPORT.md` §1, shown as a caption in the arena, and stated in one sentence in the video.

| Assumption | Value in the main runs | Why | Checked by |
|---|---|---|---|
| Failure detection | 5 s, the same as the swarm's heartbeats | Same detector for both | Sweep {0.5, 1, 2, 5, 10 s}, symmetric |
| Restart or failover | 0 s after detection (an ideal hot standby) | Best case for the rival | Sweep {0, 1, 3 s} |
| Detection asymmetry | None | A process manager can see a crash at once, while heartbeats can't | "Fast external restart" case: rival at 0.5–1 s, swarm at 5 s |
| Workers | Survive the crash; results kept and adopted from the log | A well-built system runs workers apart | — |
| The rival's own LLM calls | `durable-max`: survive. `durable`: lost | Two variants bound the realistic range | Both rows |
| Shared state | The same durable log as the swarm | Same storage for both | — |
| Failure model | The same number of coordinator crashes at the same progress points (C1/C3/C5 = 1/3/5) | The existing chaos profiles | The per-process view (§C.2): the swarm runs 10 coordinator processes, the rival 1 |

---

## B. Metrics
These are pre-registered and computed from the log for every workflow.

| Metric | Definition |
|---|---|
| Work lost | LLM calls cancelled or redone because a coordinator crashed, as calls and $. Separate from agent kills and API faults. |
| Duplicated work | Calls of a contract step already answered earlier, as calls and $. |
| Unnecessary reassignments | Re-dispatches while the assignee was alive, or while its result was already in the log. |
| Time to recover, per crash | From the crash to the first decision on the affected work (dispatch, judge or booking), and to its recovered throughput. |
| Blast radius | Share of agents and goals waiting on the dead coordinator, and the idle agent-seconds caused by the crash (an agent idle while ready work waits for a down coordinator). |
| Coordinator-dependency time | Time during which ready work cannot proceed because its deciding coordinator is down. |

- **Kept as they are:** stall, makespan, extra cost vs C0, coordination tokens, validity and soft score.
- **Where:** `bench/scoring.py`, plus the harness columns and charts.
- **Supervisor logs:** a "recovery report" next to `fractalswarm takeover`.

---

## C. Experiment protocol and decision gate

### C.1 The $0 gate v2
- Calibrated fake LLM.
- {swarm, durable-max, durable, central} × {T2, T1} × C0–C3 × seeds 1–3.

### C.2 Sensitivity sweep (at $0)
It checks that the conclusion does not hinge on the rival's assumptions:
- symmetric detection {0.5, 1, 2, 5, 10 s};
- rival restart {0, 1, 3 s};
- the "fast external restart" case: rival detection at 0.5–1 s while the swarm keeps 5 s heartbeats;
- crash-time jitter and more seeds;
- **the failure model:**
  - **per crash** (the main runs): both systems lose the same number of coordinators;
  - **per process:** every coordinator process fails at the same rate, so the swarm (10 coordinators) sees about 10 times more crashes than the rival (1). Report the expected idle agent-seconds and blocking time per hour of work under both models, whatever they show;
- "where it helps": coordination density (contract granularity), and T1 vs T2.

**Back-of-the-envelope** (the sweep says which one holds):
- **Asymmetric detection:** per crash, the swarm idles about 2 agents for 5 s (≈ 10 agent-seconds), while a rival restarted in 1 s idles 12 agents for 1 s (≈ 12 agent-seconds). It may well tie.
- **Per process:** 10 failures × 10 agent-seconds = 100 agent-seconds for the swarm, against 1 × 60 = 60 for the rival at 5 s. The rival may win on this view.

### C.3 Pre-registered hypotheses
- **H1:** `durable-max` ties the swarm on work lost, duplicated work and cost (|Δ extra cost| ≤ 5 points). `durable` loses only its own in-flight calls.
- **H2:** at C2–C3 (per crash), the swarm has clearly lower blocking time, blast radius, idle agent-seconds and coordinator-dependency time (≥ 2×), because only the dead orchestrator's subtree waits.
- **H3:** the gap grows with failure count, detection latency and coordination density. It shrinks toward 0 with fast detection, when work is dispatched up front, and under the per-process failure model.

**`bench/PREREG.md`** (W1) refines these into testable hypotheses (backend-design §3) and is committed **before** any gate run. A difference counts only if all seeds agree and it reaches the minimum effect: stall 3 s, extra cost 5 points, time to recover 1 s, coordinator-dependency time ratio ≤ 0.5. Otherwise it is a tie. The time to recover is expected to favour the supervisor slightly (5 s against the swarm's 5–7 s); report it either way.

### C.4 Decision gate with Yoel, before any real rival run
- **Outcome A** (H2 holds across the plausible part of the sweep): "recovery stays local to the affected subtree". The cost tie is stated plainly, and so are the conditions in which the gap shrinks, the per-process view included.
- **Outcome B** (H2 fails, or holds only at slow detection): say so. The story becomes "resilience comparable to an ideal durable supervisor, without a central coordinator or a separate recovery mechanism". The conditions in which A would hold, if any, are named.
- A result that holds only under one setting of the rival's assumptions is reported **with that condition**, never as a general claim.
- The fairness rules are never revisited to rescue a result.

### C.5 Claim rules
They are enforced through `docs/claims.md`.

| Claim | Allowed when |
|---|---|
| "Recovery stays local" | Outcome A, with the measured blocking time and blast radius, and the failure model named |
| "Comparable resilience, no central coordinator" | Outcome B, or A |
| "No separate recovery mechanism" | Always true by construction: takeover is the same HRW rule from the log. Say exactly that. |
| "Cheaper" | Only if cost is measurably lower against the same rival under the same failures. Against `durable-max` we expect a tie, so it isn't claimed. |
| "Simpler" | Not claimed, because it can't be measured here. Allowed instead: the factual "no process manager, standby or election service", when true. |
| "More reliable" | Not claimed beyond the failure modes actually tested. The log remains a central component (stated limitation). |

### C.6 Real runs, after the gate
- Contributor rows for the new rivals, plus the T1 rows of the final matrix.
- Standard headline runs: swarm vs `durable-max` vs `durable` at C3 × 3 seeds.

### C.7 `docs/claims.md`
Every public claim, mapped to its run ids and metrics. The video script, the README and the form quote only claims that are in it.

### C.8 `test_bench_smoke`
It keeps its swarm-vs-central assertion and adds metric-computation checks for the durable modes. It never asserts a win against them.

---

## D. Live real input: intake → review → run → arena pair
1. **New Task (live) form:** text boxes for talks and for emails or notes; rooms are optional. The shape is fixed: 2 days, slots from the defaults, 3 tracks × 2 blocks.
2. **"Read with Muse":** an intake call (new role `intake`; Wonder or Spark with structured output) produces:
   - the corpus (talks, speakers, emails, rooms, tracks);
   - **reference constraints** (availability, preferences, attendance), with the source sentence for each.

   Yoel reviews and edits them, then approves. **The approved constraints become the checker's truth**, recorded in `run.started`. The agents still extract on their own, so the checker cross-checks them against a human-approved reading.
3. **Run:** a single run, or **Run arena pair**: swarm vs `durable-max` (selectable), the same input and the same failure plan, started together.
   - **Same failures means the same number of coordinator crashes at the same progress points.** Today's CLI `kill-half` gives the central only 1 crash, because o0 is its only candidate and the other 4 actions are skipped.
   - The arena therefore uses a fair "half the brains" plan: the swarm loses its 5 targets (the root and track leads included), and the supervisor crashes at those same 5 points.
4. **Under the hood:**
   - an inline-data TaskSpec;
   - an approved-truth mode in T2 (`_truth_slice`, `bookings`, `check_context`, `final_report`, `t2.session_hard`);
   - a configurable small shape;
   - a fake intake and a fake T2 path, so the whole flow tests at $0.
5. **PII:**
   - Live-input runs, intake runs and approved inputs live in `FRACTALSWARM_PRIVATE_DIR` (`~/.fractalswarm/private`), outside the repo. They replay locally and are never bundled.
   - Email addresses are pseudonymized before they enter a run log.
   - The UI shows a warning.
   - Contributor is forced off: calls that read emails stay on Standard pricing.
6. **The arena's default failure plan, "half the brains":**
   - 5 coordinator crashes at fixed progress points;
   - the first hits `o0` in both systems, the rest are rule-targeted;
   - no agent kills or API faults, so the pair isolates coordinator recovery.

   The C3 profile, with agent kills and faults, stays the matrix's job. The sim clock is the fallback if the live clock produces false deaths.

---

## E. Meta models: visible and load-bearing (in Yoel's order)
1. **Muse intake:** messy text in, structured problem out, reviewed by a human.
2. **Muse lens:**
   - Click a node or a call to see the model badge (Wonder, Spark or Contributor), effort, tokens (input, cached, reasoning, output), cost and latency.
   - It also shows the **readable output**: extracted facts next to their highlighted source email, placements, the judge's reasons, and blurbs.
   - A top-bar "Muse meter" shows $ and tokens by model, the cache-hit share (about 60 % of input tokens), and "coordination tokens 0 · recovery tokens 0".
   - The data is already in the log (`effect.started` holds the full prompt; `effect.completed` holds the model, usage, cost and output), so an API join is enough.
3. **Ablation:** the same live notes go through the regex parser (`parse_email` in the fake T2 backend) and through Muse Spark. For example: "the parser understood 2 of 7 notes, Muse 7 of 7", shown with the differences. This is the evidence that the model carries value by itself.
4. **Wonder arbitration:**
   - Wire the `arbiter` role at the lowest common ancestor for semantic conflicts that the deterministic rules cannot settle, with the source emails as evidence.
   - Events `arbitration.requested` and `arbitration.ruled`; it replays.
   - It appears as a card in the grid and in the lens.

**Message for the form and the video:** Spark turns human language into constraints, Wonder plans and arbitrates, Llama PromptGuard 2 guards the inputs, and the Contributor routing goes through a PII gate. Every Muse token goes to the problem; none goes to coordination or recovery.

---

## F. UI overhaul

**Weak points found on Day 9:**
- edges detach while nodes glide;
- the camera jumps;
- highlight lifetimes are counted in events;
- the page re-renders 60 times a second (`useRun()` without selectors);
- 67 hex literals;
- fonts that never load;
- dark theme only;
- controls that answer 501;
- a single global store;
- central's crash and restart events are not projected (a supervisor would show a permanent ✕).

**Principle:** the UI serves the three answers. Polish goes first to the screens that carry them:
- the **arena** (evidence);
- the **intake and lens** (the problem, and why Meta's models matter);
- the **verify badge and takeover check** (proof).

Every other panel stays and gets the shared design system, but no special effort.

**The work:**
1. **Design system:**
   - every colour as a token;
   - bundled Inter and JetBrains Mono (offline, so `demo --verify` works);
   - icons;
   - one stat component;
   - focus-visible and hover states;
   - skeleton loading.
2. **Motion** (add `motion`):
   - React Flow node positions tweened in JS, so edges follow their nodes;
   - fade-in and fade-out for message edges;
   - the camera fitted only on structural changes, with easing;
   - highlight decay by virtual time;
   - count-up numbers;
   - grid cells that animate only on new placements;
   - animated charts;
   - reduced motion respected everywhere.
3. **Performance:** zustand selectors, a memoized `ScheduleGrid`, throttled playhead writes.
4. **A store factory** (`createRunStore` plus a context) and the **arena** route `#/arena/<left>/<right>`:
   - one shared virtual clock;
   - crash markers;
   - per-side verify badges;
   - face-to-face counters: idle agent-seconds, time to recover, cost, duplicated work, reassignments, violations.
5. **Reducer:**
   - the supervisor's crash and restart events (down, then restarting with a 5 s ring);
   - its redo counts;
   - the durable modes' events;
   - arbitration events.
6. **Wired controls:** new task, approve, and chaos on live runs; controls disabled on recordings; crashed runs no longer show as "running".
7. **Director mode** `#/director/<scene>`: a JSON scene script drives camera moves, highlights, lower-third captions and speed ramps at 1920×1080. Each take is repeatable.
   - `scripts/record_scenes.py` (Playwright Chromium, `recordVideo` at 1920×1080) plays each scene and saves one clip per scene to `video/clips/`, which is gitignored.
   - The live-input scenes are recorded from the real live session (OBS, or a Playwright capture of the live UI), then replayed where possible.

---

## G. Video, director mode and submission form

**Script** (`docs/video-script.md`): 3:00, English voice-over. The numbers are filled in after the gate and the final runs.

Each scene lists:
- the director scene id;
- what is on screen;
- the **exact voice-over sentences**, in plain English, at about 140 words per minute (≈ 400 words in total);
- a key-points version.

Three acts, one per question:

| Time | Act | Content |
|---|---|---|
| 0:00–0:30 | **1. The problem** | Teams of LLM agents depend on one coordinator; when it dies, the work stops, or gets redone. The arena opens: same conference, two systems, coordinators start dying. One line: "Even an ideal supervisor has to stop to recover. Can the team recover without one?" |
| 0:30–1:20 | **2. Why Meta's models matter** | Yoel types messy notes in English (sped up). Muse intake turns them into the problem. Ablation: "a parser understands N of M notes, Muse all of them". In the lens: a Spark fact next to its source sentence, Wonder's plan, and (if wired) a Wonder ruling. "Muse does the understanding; recovery costs zero tokens, so every token goes to the problem." |
| 1:20–2:35 | **3. The evidence** | Recovery in one picture: the same log, every survivor computes the same heir, no election, root succession. Then the fair fight against the **ideal** durable supervisor, with its assumptions on screen (5 s detection, 0 s restart, workers survive). The numbers for outcome A or B, in plain words, plus one line on the sensitivity check. Proof: replay verified (hash match) and `takeover OK` (every heir recomputed from the log). |
| 2:35–3:00 | **Close** | `uv run fractalswarm demo --verify`, with no API key. Built on Muse Spark, Muse Wonder and Llama PromptGuard 2. The repo. |

- **Left out of the video:** the economy, breakers and safety segments, and the attack clip. They stay in the app and the README.
- **Exception:** a ≤ 10 s safety beat goes back in only if it clearly strengthens answer 2. Day 8 found that PromptGuard does not flag the polite poisoned email, and only the scope check blocks it, so it probably won't.
- **Wording:** every number and claim in the script comes from `docs/claims.md`.

**`docs/submission.md`** holds the drafts:
- team (Yoelcanarion / Yoel Garcia);
- track and problem statement (Yoel picks them from the form's list);
- the project description;
- use of Meta products;
- why Meta's models are important;
- feedback on Meta products;
- feedback on partner technologies.

The drafts are ready by Nov 2 and final on Nov 4.

---

## H. Execution: an Orca coordinator plus workers

**Coordinator**, in the `arena` workspace, running Opus 5.5 at max effort:
- It loads `orca skills get orchestration`, runs `run-create`, and starts the workers with `worker-start --worktree new-child --name arena-<stream> --base-branch Yoelcanarion/arena --agent claude --model claude-sonnet-5-5 --effort max`.
- It merges into `Yoelcanarion/arena` in the order below, keeps `progress.md` up to date, and runs every **paid** run itself during a **quiet window**: the workers hold heavy commands, and other apps are closed.
- It sends Yoel the daily spend report.

**Memory rules** (the machine has 15 GB of RAM; it ran out on Oct 28 with 10 Claude processes, Firefox, Discord and Orca open):
- at most 4 workers at the same time; a fifth starts only when another has been released and there is memory to spare;
- at most 2 test suites at the same time;
- one dev server;
- no browser automation during paid runs;
- release each worker's terminal as soon as it is merged.

**Workers.** File ownership is chosen to avoid conflicts; the briefs list the exact files.

| Worker | Scope | Main files |
|---|---|---|
| W1 `rival` | Durable modes; central goal registration; metrics; recovery report; detection, restart and crash-jitter parameters per bench cell for the sensitivity sweep, plus the per-process failure model; matrices; REPORT.md with the rival-assumptions table; tests | `actors/orchestrator.py` (central path), `coord/tree.py`, `actors/swarm.py`, `runs.py`, `bench/*`, `verify/takeover*` |
| W2 `intake` | Inline TaskSpec, intake role, approved-truth T2, small shape, ablation backend, launch API and job manager, pair launch, controls, catalog status | `planning/taskspec.py`, `bench/tasks/t2_conference/*`, `verify/checks.py`, `api/*`, new `intake/`, `config/roles.yaml` |
| W3 `meta` | Lens data endpoint and event enrichment, Wonder arbitration | New `coord/arbitration.py` with a small hook in the orchestrator, merged after W1 |
| W4 `ui-core` | Design system, motion, performance, store factory and shared clock, reducer for supervisor and arbitration events, controls state, the Muse lens UI and the Muse meter | `web/src/*` (core) |
| W5 `ui-arena` | Arena, "where it helps" panel, intake and review UI, ablation UI, director mode, scene recorder | New `web/src/{arena,director,intake,ablation}/*`, `scripts/record_scenes.*`; starts after W4's first merge |

- **The backend design** for W1–W3 (file-level, checked against the code) is in `.plans/arena/backend-design.md`.
- **One rule from it binds every backend change: never add a field to an existing event payload model.** `validate_payload` writes defaults into the log, so old runs would stop replaying. Use new event types, and gate new behaviour by new modes or params.

**Handler freeze:** as soon as the last handler change has merged and the real rival rows have run (§I), and Sun Nov 1, 20:00 at the latest; tagged `handler-freeze`. From then on, only UI, docs and bench reporting change, because the final recordings must replay at HEAD.

---

## I. Order of work

2026-10-29, Yoel: **no plan by days.** Everything is done as soon as its inputs exist, in this order of dependencies, and when the list is done Yoel adds more. Only the submission has a date.

1. **Decision gate with Yoel.** The $0 gate v2 and the sensitivity sweep are done (outcome B, `bench/results/verdicts.txt`). No real rival run before it.
2. **Real rival rows** (Contributor) and the T1 rows of the final matrix, in a quiet window right after the gate. What they reveal in the handlers is fixed before the freeze.
3. **The last handler changes** (Wonder arbitration's answer path), then the **handler freeze**.
4. **After the freeze:** the standard headline runs; the final demo bundle (kill-half plus poisoned email); the LangGraph rows, the scaling sweep and T3 real; end-to-end real input with ablation; the live real-input arena rehearsal.
5. **All along, in parallel:** the UI (arena, where it helps, intake review, director mode, recorder); claims, REPORT and script with the real numbers; form and README drafts; a secret-scan dry run.
6. **With Yoel:** merge into `master` (his OK); attack clip; recording of the director blocks plus his voice-over, and editing; final scan; **repo public** (his OK); logged-out check; final README; fresh-clone `demo --verify`.
7. **Submit by Wed Nov 4, 20:00 CET** (the hard deadline is Thu Nov 5, 03:00 CET), with a feature freeze before the final README and the fresh-clone check.

---

## J. Budget: $50 total cap

| Item | Estimate |
|---|---|
| v1 tail (3 cells) | ~$1 |
| New rival rows, plus T1 rows of the final matrix | ~$13 |
| Headline Standard runs | ~$5 |
| LangGraph rows | ~$4 |
| Scaling sweep | ~$6 |
| T3 real | ~$0.4 |
| Live-input rehearsals and arena pairs | ~$4 |
| Final bundle, attack clip and re-recordings | ~$3 |
| **Total** | **≈ $36** |

- The rest is buffer.
- The coordinator checks `uv run fractalswarm spend` before and after every real run.
- It stops and asks if a run would take settled project spend past **$61.8**.

---

## K. Phase 0: day-09 leftovers (coordinator, Thu morning)
1. **Make the evidence shared, and keep it out of git.** It is `runs/` (510 MB, gitignored) and `bench/results/` (348 MB, **untracked and not ignored**), both in the day-09 worktree.
   - Move `runs/` to `C:\Users\yogar\.fractalswarm\runs`, and set `FRACTALSWARM_RUNS_DIR` in `~/.fractalswarm/.env` so every worktree shares it, like the ledger. Check first that `config.py` reads it from that file.
   - Add `bench/results/*/runs/` to `.gitignore`, and copy those runs next to it.
   - Commit only the `bench/results/v1/cells/*.json` summaries (128 KB).
2. **Merge `day-09-integration`** with the procedure from the Day 9 progress entry:
   - record the $0 references (C0, kill-half and C3 runs; the T1 and T3 smokes; `bench --fake`) in a scratch runs dir and ledger;
   - merge, `uv sync`, record the same runs again and compare event by event;
   - full `pytest`, ruff, `demo --verify`;
   - the economy mutation checks.
3. **The v1 tail** (3 pipeline cells, about $1): finish it, or, with Yoel's OK, supersede it.
   - The design review found that v1's runs replay only at their recording commit (587c88f).
   - The rivals matrix v2 carries the reference rows.
   - Check, then decide in the Phase 0 message.
4. **Fix the known issues:**
   - crashed runs show as "running";
   - the PromptGuard tokenizer warning: check whether it changes the scores;
   - stale reservations from cancelled calls in the project ledger: report them rather than silently release them.
5. **Ask Yoel to merge `day-09` into `master`.**

---

## L. Risks

| Risk | Mitigation |
|---|---|
| H2 fails, and the swarm only ties the durable supervisor | The decision gate decides the honest headline; the parity claim plus "no supervisor needed" is the fallback. |
| The per-process failure model favours the rival | Report it next to the per-crash results; never hide it. Claims name their failure model. |
| Memory or CPU pressure with 4–5 workers, or live-clock false deaths during paid runs | Quiet windows, test-suite limits, paid runs only from the coordinator. |
| Handler changes after the recordings break replay | Freeze on Nov 1 at 20:00, record after the freeze, check `replay --verify` at HEAD. |
| Live-input PII ends up in git or in the public repo | Runs stay outside git; the secret and PII scan runs before publishing. |
| Intake hallucination | Human review and approval; the source sentence is shown for every constraint. |
| The arena's live pair is unstable | Record the pair, and keep a replay of a pair recorded earlier as plan B. |
| Merge conflicts in `orchestrator.py` | W1 owns the central path; W3 works through a new module and a small hook, merged after W1. |

---

## Verification

**Every merge:** `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `npm --prefix web run typecheck`, `npm --prefix web test`, `npm --prefix web run build`, and `demo --verify` MATCH (offline).

**Rivals:**
- New unit and integration tests:
  - durable workers keep running across a crash;
  - `durable-max` adopts its own plan and judge completions;
  - the realistic variant redoes them;
  - old `central`, `single` and `pipeline` logs still replay MATCH.
- Metric tests on synthetic logs.
- The $0 gate v2 is reproducible.

**Real input:** end-to-end with the fake backend (intake → approval → run → checker against the approved truth → arena pair), plus one real smoke run.

**UI:** typecheck and tests for the new folds (supervisor events, arena clock), plus Playwright headless screenshots at 1920×1080 of the arena, the lens, intake and director scenes.

**Final:**
- Every recorded bundle replays MATCH at HEAD.
- `fractalswarm takeover` OK for swarm runs; a recovery report for supervisor runs.
- `docs/claims.md` maps each claim to its evidence.
  - Every number in the video script, README and form matches it.
  - No "simpler", "cheaper" or "more reliable" appears without its own evidence row.
- `bench/REPORT.md` states the rival's assumptions and the sensitivity results next to the main chart.
- **Three-question check on the cut video:** someone who has not seen the project (a friend, or a fresh session given only the transcript and the frames) can say what problem it solves, why Meta's models matter and what the evidence is. If they can't, the script is revised before the Nov 3 recording ends.
- Spend stays within $50.
- Fresh-clone `demo --verify` works with no API key.
