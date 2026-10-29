# W1 rival: notes

Worker W1, branch `Yoelcanarion/arena-rival`, from `Yoelcanarion/arena` at 3b1fe9b. Brief: `.plans/arena/w1-rival.md`.
Everything below was run on the fake LLM, in scratch dirs. No real call was made.

## Part 1: the durable modes

### What was built
- `baselines/durable.py`: `DURABLE_MODES = ("durable-max", "durable")`, the `OwnEffectsView` reducer (`in_flight`, `completion`, `tags_in_flight`) and the new event `supervisor.adopted`.
- `coord/tree.py`: new event `goal.opened` and its `TreeView` branch. Both share one `_register`, so the first record of a goal still wins.
- `actors/orchestrator.py`:
  - `CENTRAL_MODES` includes the durable modes; new `SQUAD_MODES`.
  - `goal.opened` is emitted in the central branch of `_assign_children`, for the durable modes only.
  - `_crash` has a durable branch (`_crash_durable`); `_redo` calls `_recover` for them.
  - `state["restart_ms"]` and `state["detect_ms"]` carry the sweep knobs.
- `actors/swarm.py`: scenarios `DURABLE_MAX` and `DURABLE`; `OwnEffectsView` installed for them only; `sweep_knobs(params)` builds the root's args.
- `runs.py` (`SCENARIOS`), `bench/workflows.py` (registered, `scalable`), `cli.py` (`--scenario`).
- `bench/profiles.py`: `half_the_brains_plan(seed)`.
- Tests: `tests/unit/test_durable_views.py`, `tests/integration/test_durable_rivals.py`, and `test_bench_smoke.py` extended to the durable modes.

### How a durable restart works (`_recover`)
It walks the goals in sorted order and adopts from the log; the coordinator's memory survives, a free checkpoint the swarm's heirs do not get.
- **Scanning / planning:** adopt the logged completion; wait while the call is in flight (`durable-max`); re-issue it (`durable`, whose crash cancelled it).
- **Contract running:** adopt the logged result; wait while the agent is alive; `_retry(..., "lost")` only if the agent is dead.
- **Judging:** `_judge` reuses the logged verdict; waits for a call in flight; otherwise asks again.
- **Booking:** `_accept` (the logged outcome, else the booking is sent again).
- Then `_dispatch` for pending contracts, and the next pending crash.

### Event shapes other workers can rely on
- `goal.opened{goal_id, owner, parent, level, goal}`: durable modes only, one per child goal, emitted where a swarm would send `assign`. The root goal comes from `actor.spawned.args.root_goal`, as before.
- `supervisor.adopted{coordinator, crash, results, verdicts, plans, bookings, waiting}`, right after each `baseline.restarted`:
  - work keys are `goal_id/contract_id`; a goal id can contain `/` (`track-ai/d1/blurb` is goal `track-ai/d1`, contract `blurb`);
  - `plans` holds goal ids (a scan is `goal_id/source`);
  - `waiting` mixes work keys (a live worker's contract) and own-call tags (`plan|...`, `judge|...`, `scan|...`) still in flight.
- `baseline.crashed` keeps its schema. `lost` is `[]` for `durable-max` and the cancelled own tags for `durable`. `restart_in_ms` is `state["restart_ms"]` (5000 unless a sweep says otherwise).
- `baseline.restarted{coordinator, crash, redo}`: `redo` names work, not tags: a goal id (plan), `goal_id/source` (scan), `goal_id/contract_id` (a judge asked again, or a contract whose agent died).
- Order at a restart: `baseline.restarted`, `supervisor.adopted`, then whatever the adoption causes (`contract.completed`, `verify.judged{reused}`, `contract.verified`, ...).
- No worker is stopped by a durable crash: no `actor.stopped{reason: crash}`.
- `half_the_brains_plan(seed)` returns the plan as a plain dict (a `ChaosPlan`'s JSON, importable without `comms/chaos.py`). Write it with `json.dumps`, or pass it as `params["chaos"]`. W2's `--chaos-plan FILE` reads exactly this shape.
- Scenario names for `fractalswarm run --scenario`: `durable-max`, `durable`.

### Knobs (only when set; a default run records the args it always did)
| param | swarm | supervisors (`central`, `single`, `pipeline`, durable) |
|---|---|---|
| `recovery_ms` | Detector detection time (`detect_ms`) | restart delay |
| `rival_recovery_ms` | nothing | restart delay (wins over `recovery_ms`) |
| `rival_restart_ms` | nothing | added to the delay |

The swarm's Detector keeps `suspect_after=3`, `dead_after=5` and scales `interval_ms = recovery_ms / 5`. A time that is not a multiple of 5 ms, or under 50 ms, is refused with a `ValueError` at boot; nothing is clamped.

**The Detector does support sub-second detection.** Measured on T2, swarm, arena plan, no net faults (run plus replay):

| recovery_ms | heartbeat | events | wall | death delay after the kill | false deaths |
|---|---|---|---|---|---|
| 5000 | 1000 ms | 5,565 | 1.4 s | 4750-5000 ms | 0 |
| 1000 | 200 ms | 21,985 | 7.4 s | 800-950 ms | 0 |
| 500 | 100 ms | 42,541 | 16.2 s | 400-450 ms | 0 |

Events grow like 1/interval. A 100 ms detection would be about 200K events and a minute or two per run. Under the C2/C3 net faults (delays of 200-1500 ms) a heartbeat can arrive later than a short detection time, so expect false deaths there; the sweeps should say which profile they use.

### Deviations from the brief and the design
1. **`baseline.restarted` is emitted before `supervisor.adopted`** (the design lists them the other way round). With `restarted` first the outage window `[baseline.crashed, baseline.restarted]` holds nothing o0 authors except timers, which the invariant "o0 authors only timers while it is down" (backend-design §2) needs.
2. **A durable supervisor stays down until `_recover` runs.** `_restart` normally sets `up=True` and a 0 ms timer then calls `_redo`. In that gap the 1 s `CENTRAL_TICK` could run `_pull` and consume logged results first, so `supervisor.adopted` undercounted (found by `test_results_logged_while_the_coordinator_was_down_are_all_consumed`). For the durable modes `_restart` leaves `up=False` and `_recover` sets it. The old modes are untouched.
3. A pending crash is not applied once every goal is done (the swarm's monkey stops at completion too).
4. `tests/integration/test_bench_harness.py` needed **no** edit: its `workflows == {...}` line reads the v1 matrix file, not the registry. The coordinator had approved the edit; I did not use it.
5. New public helpers: `heartbeat_interval_ms` (orchestrator.py) and `SwarmScenario.sweep_knobs`.

### Observations (fake LLM, one seed, T2; not claims)
Arena plan, seed 1, all four runs finish `ok` with 0 hard violations and replay MATCH:

| system | LLM calls | cancelled | stall | makespan | cost |
|---|---|---|---|---|---|
| swarm | 58 | 0 | 0.5 s | 70.7 s | $0.2919 |
| central | 85 | 19 | 52.3 s | 152.1 s | $0.4450 |
| durable-max | 58 | 0 | 0.0 s | 76.8 s | $0.2917 |
| durable | 63 | 5 | 28.2 s | 112.7 s | $0.3256 |

The swarm's five kills were `o0`, `o3.2`, `o3.1`, `o1.1`, `o1.2`: no crash was skipped. In this run `durable-max` makes the same number of calls as the swarm and shows no stall, so a comparison with it cannot rest on those two numbers; it rests on the other metrics (Part 2).

## Part 2: metrics, knobs, checker (no new event, no payload field changed)

### What was built
- `bench/recovery.py`: every recovery metric, as pure functions of the log with one rule for swarm and supervisor logs. The module docstring is the definition, with the exact event boundaries: outage windows, `ttr_own_s` and `ttr_drain_s`, wait intervals, `cdt_s`, `blocked_total_s`, blast radius (sessions and agents), exposure, idle agent-seconds (the session reading is primary, `own` and `wide` bracket it), unnecessary reassignments (and false-death remaps), duplicated work split by cause (`coordinator_crash`, `agent_kill`, `false_death`, `other`) and preserved work.
- Wiring: `RunMetrics` fields (defaults, never logged), `score_run` columns and `RESULT_COLUMNS` in `harness.py`, `Matrix.knobs` and `Cell.knobs` in `registry.py` (`knobs` column `a=1;b=0.5`), `cell_backend` in `bench/workflows.py`, a per-role latency scale in `llm/calibrate.py` (`agent_latency_scale`).
- `bench rescore OUT`: recomputes the metrics of the cells on disk from their logs, at $0. A cell whose run directory is gone keeps its old metrics and is reported; a pre-arena number that moves is printed as MOVED (exit 1 only if a cell failed to score).
- `verify/recovery.py` and `fractalswarm recovery RUN [--json]`: a table per crash, and the supervisor checks: `restarted`, `quiet` (o0 authors only timers, plus the respawn of the workers a process-tree crash stopped), `consumed` (durable: every result logged while down is consumed after the restart, and `supervisor.adopted.results` is exactly that set), `own_calls` (durable-max cancels no own call; durable cancels exactly the calls in flight), `no_repeat` (no call paid twice, no contract dispatched twice). Exit 1 on a violation.
- `fractalswarm takeover RUN` on a supervisor log (`baseline.crashed` present) exits **2** and says to use `recovery` (`verify/takeover.py`: `SupervisorLog`, `is_supervisor_log`, `duplicates_of`). On a swarm log it is unchanged.
- CLI: `bench` is now a group (`bench MATRIX.yaml` still means `bench run MATRIX.yaml`): `run`, `rescore`, `verdicts`.

### Checked on the recorded arena runs (fake LLM, seed 1, T2, arena plan)
`recovery` is green on all four: durable-max (6 results consumed, 0 own cancelled), durable (5 in flight, 5 cancelled), central (12 workers stopped per crash, `quiet` holds with the respawn allowance) and swarm (`no_repeat` only).

## Part 3: protocol tooling

### What was built
- `bench/PREREG.md`: the hypotheses H1-H6 (H4 read as H4a cdt, H4b blast, H4c idle), the minimum effects, the tie rule, the failure models, the decision rules of spec §C.4. **Amended in place on Thu Oct 29 before any gate run, on the coordinator's review:** `rival_recovery_ms` 0.5 s joined the plausible region, and §5 states the C3 fault profile and the false-death asymmetry in the swarm's detector (§9 records both). Its SHA is `blake2b(digest_size=6)` of the file with line endings normalised; honesty.json and regime.json carry it.
- `bench/verdicts.py` and `fractalswarm bench verdicts OUT... [--prereg] [--json PATH]`: applies PREREG mechanically to results dirs (a dir with `cells/`, a `results.json`, or a dir of those). It always prints. Only with `--prereg` does it write `honesty.json` (to `--json`, else the first OUT) and draw `regime.png` and `regime.json` next to it.
- `bench/charts.py`: the durable modes in `KNOWN_WORKFLOWS` (appended, so existing colours stay), `recovery_chart` (six panels against the coordinators killed, or against a sweep axis at the matrix's most chaotic profile) and `regime_chart` (the locality ratios against each rival at every regime point). `harness.draw_charts` draws them from `run_matrix`: a sweep matrix gets the recovery chart along its axis and no hero chart (it would average over the knob).
- Matrices in `bench/`: `matrix-rivals-gate.yaml` (128 cells), `matrix-sweep-recovery.yaml` (0.5 s taken out), `matrix-sweep-recovery-extreme.yaml` (0.5 s alone), `matrix-sweep-restart.yaml`, `matrix-sweep-fast-restart.yaml`, `matrix-sweep-density.yaml`, `matrix-sweep-width.yaml`, `matrix-per-process-swarm.yaml`, `matrix-per-process-rivals.yaml`. Outputs go to `results/rivals-gate` and `results/sweeps/<axis>`.

### `honesty.json` (schema_version 1; `Honesty` in `bench/verdicts.py`)
- `prereg{path, sha}`, `sources[]`, `rules{...}` (the minimum effects and floors, as applied).
- `outcome{label: A|B|pending, against, gate[], plausible[], conditions[]}`: the outcome PREREG §7 derives, and the points that decide it. The headline sentence is not in it. Each `gate[]` and `plausible[]` entry carries `cdt_ratio`, `blast_ratio` and `idle_ratio` (the ratios of the seed means, swarm / rival, marked descriptive: no verdict), and each `conditions[]` line prints them.
- `code{commit, dirty}`: the commit and tree state the verdicts were produced at (3e723a8, clean).
- `false_deaths[]{workflow, task, profile, axis, value, runs, remaps_mean, remaps_max, spent_usd_mean}`: the swarm's false deaths per run, and the work paid twice because of them (`dup_false_death_usd`); the supervisors read 0 by construction.
- `hypotheses[]{id, name, metric, expected, tally{rival: {win, tie, loss, na}}}`, `tally` overall.
- `comparisons[]{hypothesis, metric, rival, source, task, profile, axis, value, knobs, agents, seeds, swarm, rival_value, ratio, difference, verdict, mixed}`: every comparison, losses and ties included. `verdict` is the swarm's: win, tie, loss, n/a, incomplete.
- `regimes[]{source, axis, value, plausible, task, profile, rival, locality: holds|ties|fails|n/a, cdt_ratio, blast_ratio, idle_ratio}`: one row per regime point (the "where it helps" panel).
- `per_process[]{task, swarm_levels[{level, targets, count, runs, skipped, impact}], swarm_expected, rivals, ratio, reading: swarm lower|comparable|rival lower|n/a}`.
- Suggested path: `bench verdicts bench/results/rivals-gate bench/results/sweeps --prereg --json bench/results/honesty.json`.

### Cost of one fake sim run (this machine, one process per run, peak working set)
| cell (T2, seed 1) | wall | events | peak memory | disk |
|---|---|---|---|---|
| swarm C3 | 5.7 s | 16K | 125 MB | 17 MB |
| central C3 | 1.4 s | 2.7K | 76 MB | 5 MB |
| durable-max C3 | 1.1 s | 1.9K | 73 MB | 4 MB |
| durable C3 | 1.2 s | 2.5K | 75 MB | 4.5 MB |
| swarm C3, T1 | 3.7 s | 10K | 104 MB | 11 MB |
| swarm C3, `recovery_ms` 2500 | 8.8 s | 25K | 156 MB | 26 MB |
| swarm C3, `recovery_ms` 1000 | 19 s | 56K | 267 MB | 56 MB |
| swarm C0, `recovery_ms` 500 | 23 s | 58K | 298 MB | 63 MB |
| swarm C3, `recovery_ms` 500 | 60 s | 152K | 614 MB | 149 MB |
| swarm C3, 48 agents | 36 s | 103K | 445 MB | 101 MB |

Estimates for the matrices (sequential, one process each; interpolated between the measured points, so give or take 30%): gate 3-5 min, under 150 MB; `recovery_ms` sweep (1-20 s) about 5 min, under 300 MB; its 0.5 s extreme about 5 min and 620 MB, 0.6 GB of runs; `rival_restart_ms` about 2 min; `rival_recovery_ms` about 1 min; latency scale about 3 min; width about 6 min and 450 MB; per-process about 2 min. About 25-30 min in all, 2-3 GB of `runs/` (gitignored). The summaries are small.

### Deviations from the brief and the design
1. **honesty.json is written by `bench/verdicts.py`, not `charts.py`.** The verdict rules and the file's model live together, and the chart reads the model.
2. **`--prereg` gates the writing** of `honesty.json`; without it `bench verdicts` only prints. `--json` without `--prereg` is refused.
3. The `takeover` exit code on a supervisor log is 2 (the brief says only that it points to `recovery`).
4. The `recovery_ms` sweep omits 0.5 s: its swarm runs take a minute and 600 MB at C3, so it has its own matrix (`matrix-sweep-recovery-extreme.yaml`), read in the same column of the regime map and outside the plausible region.
5. The gate's seeds 3-4 generate fixtures under `tasks/fixtures` the first time they run. I first said not to commit them, then did (0284766, eight files): a second generation is byte-identical to them, and a fresh generation of seeds 1-2 equals the tracked blobs, so the gate reproduces from the branch. `tasks/fixtures` is not in the brief's file list: drop that commit if you would rather they stayed generated.
6. Two measuring processes (`recovery_ms` 500 at C3, 614 MB; 48 agents, 445 MB) went over 300 MB before I had asked for a SLOT, and the harness tests ran their toy matrices (34 s) without one. Nothing else heavy has run.

## Part 4: the $0 gate, the sweeps and the per-process probes (fake LLM, scratch dirs; no real call)

### Where things are
- **Committed results** (b053a07): `bench/results/rivals-gate/` (128 cells), `bench/results/sweeps/<axis>/` (378 cells) and `sweeps/per-process-{swarm,rivals}/` (68 cells): `cells/`, `results.csv`, `results.json`, charts. Over everything, in `bench/results/`: `honesty.json`, `verdicts.txt`, `regime.png`, `regime.json` (code 3e723a8, clean tree, PREREG sha 25d4a75919b3, outcome **B**). The gate alone has its own copies in `rivals-gate/` (outcome PENDING: no sweeps). The run bundles `runs/` (about 5 GB) are gitignored.
- **REPORT**: sections 3, 4, 6, 7 and Appendices A-B are written from those files. The headline, the §5 reading and the conclusions are marked `[PLACEHOLDER]`; §1's central row stays as corrected in 7bac37d. The tables are laid out from `results.json` and `honesty.json` by a scratch script (not in the repo; say if you want it committed).
- **Cost**: 574 cells, 0 failed, about 29 min of compute, $0. Peak working set: gate 145 MB; `recovery_ms` 1-20 s 418 MB (my estimate was under 300 MB, so it was low); `recovery_ms` 0.5 s 730 MB; width sweep 561 MB; the rest 130-147 MB. Free memory at each start was 2.49-3.03 GB.

### Facts the runs showed (the REPORT has the tables)
- **Gate.** Against `durable-max` the swarm's wins are all locality (blast radius 5 of 6 points, cdt and idle 3 of 6); H1, H2, H3, H6 and stall tie at all six; H5 is a loss at the four points with chaos beyond C1 (false deaths). Locality ties at T2 C2 and C3 because not every seed reaches the threshold (C2 seed 1; C3 seeds 2 and 3), although the ratios of the seed means are below 0.5. No seeds were added.
- **Sweeps.** Outcome B: the plausible region has 2 holds (`rival_restart_ms` 1 and 3 s), 6 ties and 2 fails (`rival_recovery_ms` 0.5 and 1 s: the supervisor is back after 0.5-1 s while the swarm keeps 5 s detection; cdt ratio 13.2 and 5.7). Against `durable` locality holds at 13 of 21 sweep points.
- **H2.** The 9 sweep wins against `durable-max` are 3-seed cells; at the gate T2 C3 the per-seed differences are 12.34, 15.06, 5.24, 4.89 against 5, so the 4-seed verdict is a tie. In dollars the swarm is cheaper on all four seeds at T2 C3, but the C0 bases differ.
- **False deaths** (swarm, T2 C3 per run): 24.7 at `recovery_ms` 0.5 s ($0.096 paid twice), 12.7 at 1 s, 4.7 at 2 s, 1.3 at 2.5 s, 2.3 at 5 s, 0.3 at 10 s, 0.7 at 20 s; gate 0 at C1, 1.25-1.50 at C2, 1.50 (T1) and 2.25 (T2) at C3. Not monotone; not traced.
- **Per process** (T2): swarm levels 0/1/2 cdt 0.00/0.00/1.29, idle 0.00/0.00/2.57; expected per hour cdt 7.71, idle 15.42, ttr 47.25. Ratios r: 0.90 (cdt), 0.90 (idle), 9.45 (ttr), 1.00 (blast) against `durable-max`: comparable except ttr, where the rival is lower; against `central` cdt 0.26 and blast 0.50 (swarm lower), idle undefined (central 0).
- **C0 twin.** On T1 the four systems are identical at C0 (46 calls, same cost and makespan, all 4 seeds). On T2 the swarm's makespan is 3.5-5.0 s longer on all 4 seeds and it makes 3 and 4 more calls on seeds 2 and 3 (one more `place` re-dispatch and its judge). Cause not traced to the end. Extra cost is against each system's own C0, so it starts from different bases on T2.
- **T1 stall.** The swarm's 5.8 s (C1) and 14.8 s (C3) against 0.0 and 0.5 s come from three runs, each mostly one stretch with a judge or sub-planner call in flight and no agent call: C1 seed 2 (15.95 s), C3 seed 1 (22.19 s), C3 seed 3 (32.67 of 37.12 s). In C3 seed 3 the root planner call took 64.0 s (two attempts, a 503 overload with a 60 s Retry-After) against 3.9 s in the other three.
- **Unpaired API draws.** The draw is keyed `api-fault:{seed}:{effect_id}:{n}` and effect ids differ between workflows, so each workflow gets the same fault rate and seed but not the same faults on the same calls. About 1.5% of attempts at C3 draw the 60 s overload. No change in this phase (the coordinator's decision); it is in the REPORT's limitations.
- **T2 seed 3** is invalid at C0 for all four workflows (`placed 40/48, hard violations 8, gaps 2`), so T2 validity reads 75-81%. Not traced.
- **H4c against `central`** is a loss at C2 and C3 by construction (central's idle agent-seconds is 0: its workers stop with it), which makes its locality read ties; cdt and blast are wins on every seed.

### Changes since Part 3 (after the first gate)
1. **`honesty.json`** gained `code{commit, dirty}` and `false_deaths[]`, and `outcome.gate[]`/`plausible[]` carry the three descriptive ratios; `render_text` prints them next to every locality verdict. The regime chart's title is neutral and its footnote says which marker is the verdict and which line is descriptive. (Commits 7dace82, 0b7fdeb, 3e723a8.)
2. **`bench/recovery.py`: `payload["fault"]` became `payload.get("fault")`** at three sites (the crash scan, `_partitions` and the heal search). A chaos event without a fault key made `score_run` raise `KeyError` (found at the merge check by `test_breaker_trips_and_chaos_events_are_counted_when_present`: my regression). Real logs always carry the key, so no figure of any of the 574 cells changes. New test `test_a_chaos_event_without_a_fault_is_skipped_by_every_scan`, which fails on the old code. (268fa3e.)
3. **`harness.draw_charts` draws no chart for a matrix that has a single-crash probe**, also when its C0 twin is in the same matrix (it was `all`, now `any`): the per-process matrices had drawn hero and recovery charts that average over the probes' targets. New test `test_probes_beside_their_c0_twin_get_no_chart_either`, which fails on the old condition. The eight chart files it had produced under `sweeps/per-process-*` are removed from the results. No metric, run or verdict is affected.
4. **`bench/workflows.py` module docstring** said "at C0 they make the same LLM calls"; it now says that this holds on T1 and nearly on T2, and that API fault draws are keyed per effect id. Docstring only.
5. **Text I did not write, in `bench/REPORT.md`**: the status banner, the `$0 gate` row of §3, the empty tables and intro paragraphs of §4 (replaced by the results), the last bullet of §6 ("TBD: anything the runs reveal"). §5 keeps the skeleton's two bullets under a `[PLACEHOLDER]` and a flag on the first one (its "only one doesn't stall or pay twice" is not what the gate shows against `durable-max`).

### Merge checks (arena 24995b5 merged into this branch at 2b58d12, then these notes)
- **Merge**: arena 24995b5 (W3 step 3), clean (`cli.py` auto-merged). The arena tip has since moved to 6ffa8fa (W3 follow-up, W4's takeover chip); that is not merged here.
- **Tests**: unit 965 passed, 3 deselected (the PromptGuard ones: this venv has no safety extra); integration 764 passed in three chunks (251 + 271 + 242, 3m43 + 3m29 + 5m31); `ruff check` and `ruff format --check` clean (294 files). Before the merge, at 268fa3e: 894 unit + 539 integration.
- **$0 references**: recorded on the merged tree with `scripts/refs/record_refs.ps1` and compared with the shared `arena-c2b5e08`: 43 of 43 runs identical.
- **Demo**: `fractalswarm demo --verify --no-serve` reads `MATCH backup: 8177 events, head b052b4bc33cfe1b54c7b6ceb2872de26`, exit 0. Without `--no-serve` the command goes on to serve the UI, and port 8765 was in use.
- **Verdicts**: `bench verdicts` over the committed results, re-run on the merged tree, prints the same text as `bench/results/verdicts.txt` apart from the `Code:` stamp.
- **Merged**: the coordinator merged this branch into the arena as 0025e22 (clean), accepted deviations 1, 2 and 5, kept the fixture commit, and asked for the follow-up below.

## Part 5: the follow-up for W5 (on the arena tip 0025e22, which holds Parts 2-3)

My branch was moved to the arena tip with `git merge --ff-only` (nothing of the arena's changed), so that the follow-up sits on W2's current `api/app.py` and on `docs/claims.md`.

### What was built
- **`recovery` in `GET /api/runs/{id}/metrics`** (`api/app.py`, `run_metrics`): the top-level key that was reserved and null is now the run's `RecoveryMetrics` from `bench/recovery.py`, the object `metrics.recovery` already carried: `idle_agent_s`, `ttr_own_mean_s`, `cdt_s`, `blast_*`, `dup_*`, `preserved_*`, `false_death_remaps`, and one `outages[]` row per crash or partition. A mean over no crashes is null (a run with no crash: `crashes: 0`, `ttr_own_mean_s: null`); the whole of it is never null, because the route scores the log it is given, a run still recording included.
- **`GET /api/runs/{id}/recovery`**: the `RecoveryReport` of `verify/recovery.py` as JSON (`run_id`, `events`, `system`, `supervised`, `metrics`, `restarts[]`, `checks[]`, `ok`), shaped like `/takeover`: 409 until the run has completed, 404 for an unknown run, cached per (run path, head hash). For a swarm log `restarts` is empty and only the table and `no_repeat` apply; its kills are `/takeover`'s.
- **`GET /api/bench/honesty`** (the coordinator's second request, for W5's where-it-helps panel): `bench/results/honesty.json` as committed, parsed and returned as the body; 404 until the file exists. Tests: the committed file comes back equal, and 404 without it (`tests/integration/test_api_recovery.py`).
- **`bench/tables.py`** and `fractalswarm bench tables [NAME] [--results DIR] [--check REPORT]`: the generator of the REPORT's 26 tables (the scratch script of Parts 3-4, typed, in the repo). It reads `honesty.json` and `rivals-gate/results.json`, prints the tables, and `--check` exits 1 naming any table that is not in the report word for word. Its output is byte-identical to what the REPORT holds. The per-seed win rule of `gate_t2_seeds` is `verdicts.judge` on `verdicts.RULES`, not a second copy of the floors; the seed columns come from the rows. `tests/unit/test_report_tables.py`: every table is in `bench/REPORT.md` word for word, a moved number is named, and the CLI.
- **REPORT**: the headline placeholder cites `bench/PREREG.md` §7 for what a headline may say and `docs/claims.md` for the claims the project makes; the *cheaper* sentence of §4.2 cites both; §7 says how the tables are made and checked. Only text of mine, plus the headline placeholder's pointer, which was the coordinator's to fix.

### Tests
- `tests/integration/test_api_recovery.py` (7): `/metrics` over the real C3 swarm run (5 crashes, `ttr_own_mean_s` 4.73), over a run with no crash (null means) and over a run still recording; `/recovery` over the swarm run, over a `durable-max` T2 run with one crash (one restart row, the five checks ok, `ttr_own_mean_s` equal to the restart's `down_s`), 409 and 404, and one computation per head.
- `tests/integration/test_launch_api.py` (W2's file): one assertion pinned `recovery` to null for a launched run. It now says that the key is the run's own recovery and that a run without chaos has no crash. A one-line consequence of filling the key.

## Part 6: the matrix of the real rival rows (spec C.6; prepared at $0, never run by me)

`bench/matrix-rivals-real.yaml`, with `tests/integration/test_bench_rivals_real.py` (the matrix loads and registers every cell, shares the results dir with v1 and the final matrix, and its cap covers what is left after v1).
- **Cells**: durable-max and durable x {T2, T1} x C0-C3 x 2 seeds = 32 paid cells, Contributor routing, run cap $0.50, the settings of `matrix-final.yaml`. The four in-house workflows are listed too (96 cells in all): the harness writes `results.json`, `results.csv` and the charts from the cells of the matrix it ran (`load_results(out_dir, matrix)`), so a matrix of the two rivals alone in `results/v1` would overwrite v1's with rivals-only versions. Their cells with a result file are skipped, so what is paid is the 32 rival cells, the 32 T1 rows of the final matrix and the 3 T2 pipeline cells that v1 never finished. Run it instead of `matrix-final.yaml`; after `matrix-final.yaml` it pays only the 32 rival cells. Run again when everything is done, it pays nothing and writes `results.json` and the charts again from all six workflows.
- **Dry-run** (this tree: v1 has 29 of 32 T2 cells; missing: pipeline C2 s2, C3 s1, C3 s2): 96 cells, 29 done, 67 to run, worst case $33.50 (cap $33.50); the rival cells $16.00 (32 x $0.50). Every cell registered. `matrix-final.yaml` has the same 3 cells to run: its worst case is $17.50 against its cap of $16.00, and `bench run` refuses a real run when the worst case exceeds the cap. Not changed.
- **One cell at a time**: `run_matrix` loops over the cells and awaits each; there is no concurrency. The order is workflow, then task, then profile, then seed (rivals first in the list). A real run is on the live clock, so the time is the sum of the makespans. Resumable: a cell with a result file is skipped, but a cell that died before it was scored is wiped and run again in full, and its first spend is lost.
- **Expected cost** (projection, not a measurement): the v1 means over its 29 cells are $0.307 and 339 s per run; on T2 real cost over the fake gate's cost is x0.995 for the swarm and x1.043 for `central` (seeds 1-2), and real time over sim time is about x2.0. The fake cost of the 32 rival cells, times those ratios, is $8.2-8.4 (durable-max T2 $2.4-2.5, T1 $1.5-1.6; durable T2 $2.6-2.7, T1 $1.6) and about 1.5 hours in all; there is no real T1 run yet, so the T1 ratio is the T2 one.
- **The command refuses** a real run when the worst case exceeds the matrix cap or the project ledger's remainder.

## Part 7: `tally_by_rival` and `locality_by_rival` in `honesty.json` (the coordinator's request, for W5's panel)

- **`bench/verdicts.py`**: two new keys at the end of `Honesty`, with empty defaults: `tally_by_rival` (per rival, `win`/`tie`/`loss`/`na` over H1-H6, stall left out; the three of them add up to the existing `tally`) and `locality_by_rival` (per rival, `holds`/`ties`/`fails`/`na` over its regime points, the gate's and the sweeps'). No existing key, no `schema_version` and no printed text changed. Three tests in `tests/unit/test_verdicts.py` (the sums, the counts with and without a slow setting, and the keys in the written file).
- **Regenerated** with `bench verdicts bench/results/rivals-gate bench/results/sweeps --prereg --json bench/results/honesty.json` at 48601df on a clean tree. Redirect the output to a file outside the tree and copy it in: a redirect onto the tracked `verdicts.txt` makes the tree dirty before the code stamp is read. Against the committed files: `verdicts.txt` differs in the `Code:` stamp only; `honesty.json` in `code.commit` and the two new keys; `regime.png` and `regime.json` are byte-identical. `bench tables --check bench/REPORT.md`: 26 of 26. The two places of the REPORT that name the commit of the verdicts now say 48601df.
- **The numbers** (all comparisons and regime points, gate and sweeps): durable-max 42 wins, 141 ties, 33 losses; durable 91, 98, 27; central 30, 10, 8. Locality: durable-max 7 holds, 18 ties, 2 fails; durable 18, 8, 1; central 2, 4, 0 (27, 27 and 6 points). They agree with the REPORT's Appendix B (durable: 13 holds, 7 ties, 1 fail over the sweeps, plus the gate's 5 and 1).

## Part 8: crash-time jitter (spec C.2), an exploratory $0 sensitivity

Design and tests, before the sweep (it waits for a SLOT).

- **The knob** `crash_jitter_pct`, in `registry.CHAOS_KNOBS` and so in `KNOBS`: whole points of progress (percent of the contracts dispatched), 0 to 15 (`profiles.JITTER_MAX_PCT`; the matrix refuses anything else, and refuses it together with a `K-` probe, which sets its own time). Each coordinator crash of the plan moves by `round(J x u)` points, `u` a draw in [-1, 1].
- **The draws** come from the seed alone: `random.Random(f"{seed}:chaos:crash-jitter")`, always five of them (`profiles.crash_jitter`). So every workflow and profile of a seed gets the same crash times (C2's three crashes take the first three of C3's five), a wider jitter stretches the same draws, and 0 is the gate's plan. Only the coordinator crashes move: agent kills, the partition, the network and API faults stay, so the one thing that changes is when a coordinator dies. For the swarm that also changes who dies (the targeting rule picks the coordinator with the most work left at that moment).
- **How it reaches a run**: `workflows._params` spells the plan out (`build_plan(...)` through `profiles.jittered_plan`) and puts it in `params["chaos"]`, the form the `K-` probes and the arena's half-the-brains plan already use and `plan_from` already reads. So: no new event type, no new field on a payload model, `comms/chaos.py` untouched, a cell without the knob gets `{"profile", "seed"}` as before (old runs replay as they did). The plan keeps the order a built plan has (the monkey walks the actions with a cursor and needs it by progress). `crash_jitter_pct` is not a run param.
- **Why 15 at most**: the crash points are 15 apart, so at the cap a crash lands anywhere in a band as wide as the gap between two of them. Order can change and two crashes can fall on the same point: the monkey fires both at once, a supervisor that is down crashes again after its restart (`pending_crashes` in `actors/orchestrator.py`: a rival still loses five), the swarm picks another victim. T2 has 18 contracts, so a point is 0.18 of one: +-5 moves a crash by about one contract, +-15 by up to three. The settings are 0 (the gate, spelled out: its own control), 5, 10 and 15.
- **Fidelity**: through the bench workflow (`tests/integration/test_crash_jitter.py`, as a matrix cell runs, API faults included) the plain C3 `durable-max` seed 1 fires its crashes at 0.2222, 0.3889, 0.5, 0.6667, 0.8333, the same as the committed gate cell, and `crash_jitter_pct=0` reproduces that run metric for metric. At 15 the plan for seed 1 is 0.22, 0.33, 0.62, 0.63, 0.8 (two crashes fire together at 0.6667) and the rival still logs five crashes and completes; the swarm of the seed gets the same plan.
- **The matrix** `bench/matrix-sweep-jitter.yaml`: swarm, durable-max, durable x T2 x C0, C3 x seeds 1-4 x the four settings = 96 cells, `--fake`, $0 (a real run is refused by the cap). Seeds 1-4 only: more seeds need new fixtures, which I did not generate (ask if you want them). Estimate from the measured cells of the other sweeps: swarm C3 about 6 s, swarm C0 about 3 s, a rival about 1 s, so about 4 minutes in sequence and under 300 MB. Its results go to `bench/results/exploratory/crash_jitter_pct`, **not** under `bench/results/sweeps`: `bench verdicts ... bench/results/sweeps --prereg` reads that directory for the decision, and this sweep is not in PREREG (`bench/PREREG.md` does not list it; its sha is unchanged). It is read apart and the REPORT labels it exploratory wherever it is quoted.
- **Tests**: `tests/unit/test_bench_knobs.py` (the draws, the refusals, a zero jitter is the plan spelled out, only crashes move, the cell's params, the matrix and the committed jitter matrix), `tests/unit/test_recovery_charts.py` (the axis label and chart), `tests/integration/test_crash_jitter.py` (four fake runs, a rival's and the swarm's at jitter 15 replayed bit for bit, about 14 s), and `tests/unit/test_report_tables.py` (the jitter tables on a synthetic sweep: `bench/tables.py` lays out `jitter_locality`, `jitter_means` and `jitter_seeds` from the sweep's own rows, only once `exploratory/crash_jitter_pct/results.json` exists, so until then the tables of the report are as they were).

### The sweep, run under the coordinator's GO (`msg_90601e183aa8`), and its write-up

`bench bench/matrix-sweep-jitter.yaml --fake` in one process, scratch runs dir and ledger, free memory 6.06 GB before it: **96 cells ran, 0 skipped, 0 failed, 260.5 s, peak working set 139 MB**. Results in `bench/results/exploratory/crash_jitter_pct/` (`cells/`, `results.csv`, `results.json`, the chart and its json; `runs/` is git-ignored, 665 MB).

- **Setting 0 is the gate**: 24 of 24 cells equal the committed gate rows in every metric column (the cell name, the run directory and the knobs apart). At C0 the 36 cells of settings 5, 10 and 15 equal those of setting 0 (no crash to move). All 96 cells completed and every C3 cell logged its 5 crashes. 23 cells are invalid, all of them T2 seed 3 (the one valid seed-3 cell is `durable` C3 at setting 0, as at the gate), which is invalid at C0 for every workflow.
- **What it shows** (T2 C3, seeds 1-4, descriptive; REPORT §4.6.1 has the tables): locality ties against durable-max at all four settings (ratios of the means 0.29-0.53), holds against durable at 0 and +-5 and ties at +-10 and +-15; H5 is the only loss. Per seed, the cdt ratio against durable-max runs 0.15-0.78, and the swarm reaches the minimum effect on cdt in 8 of the 16 seed-and-setting cells (blast radius 14, idle 9), so the ties are single seeds.
- **A finding to know about**: the swarm's mean stall at +-15 is 14.5 s against 1.2 s for durable-max, and it is one run, seed 2: 55.1 s in one stretch (129.5-184.6 s) with one judge call in flight (106.1-184.6 s: two injected 503s, the first with a 60 s Retry-After, three attempts, 78.5 s), after the last crash (91.0 s) and the last member death (99.0 s). The fault key is `effect_id:n` and an effect id is `eff-<seq of the cause>.<n>`, so moving a crash moves which calls draw faults: the unpaired API-fault noise of REPORT §6, here across settings. durable stalls 44.6 s on that seed (37.0 s on seed 1). Reported as it is, and it is in the means.
- **Verdicts**: adding the sweep to the gate and the sweeps in `bench verdicts` leaves outcome B, the gate points and the plausible points as they are and adds four conditions ("outside the plausible region"); `PLAUSIBLE` does not know the axis, so it cannot decide. `honesty.json` and `verdicts.txt` are not regenerated (the sweep is outside `sweeps/`), so they still stamp `48601df`.
- **Tables**: `bench/tables.py` lays out five (`jitter_plans`, `jitter_locality`, `jitter_tally` (wins, ties and losses per hypothesis, from `evaluate`), `jitter_means`, `jitter_seeds`), only when the sweep's `results.json` exists. REPORT §4.6.1 holds them word for word (`bench tables --check`: 31 of 31); §3, §6, §7 and the status line mention the sweep, and §6 now says crash times are swept only exploratorily.
- **Checks that ran**: `test_bench_knobs` 46, `test_recovery_charts` 18, `test_crash_jitter` 5, `test_report_tables` 4, ruff check and format clean. **Not re-run**: the full suite, the $0 references and the demo (a full run needs a GO). PREREG is untouched.

## Part 9: the matrix of the standard headline runs (spec C.6, second bullet), prepared at $0, never run by me

`bench/matrix-headline.yaml` and `tests/integration/test_bench_headline.py` (4 tests, 19 s). For after the handler freeze; the coordinator runs it. I made no real call and did not run it, not even with `--fake`: only `--dry-run` and the pre-flight in a test.

- **What**: swarm, durable-max, durable x T2 x {C0, C3} x seeds 1, 2, 3 = **18 paid cells** (9 at C3 and their 9 C0 twins). Contributor routing, run cap $0.50, matrix cap $9.00 (the worst case, 18 x the cap), the fairness defaults of the rival rows (no knob, no agents axis: detection 5 s for everyone, the supervisors restart at once), the same notes. The spec says "at C3 x 3 seeds"; C0 is in because the harness measures the extra cost and pairs a run against the same workflow's own C0 on the same seed, so a C3-only matrix would have no extra cost and no H2.
- **Results dir**: `bench/results/headline`. The cells in `results/v1` were run before the freeze and the harness skips a cell that has a result file, so a shared dir would hand back those cells. Nothing writes to `results/v1`.
- **Order**: workflow by workflow (swarm, durable-max, durable; within one, C0 then C3, seed by seed). Resumable: a stop loses at most the running cell (up to the $0.50 cap). The harness runs one cell at a time on the live clock, so the time is the sum of the makespans.
- **Dry-run** (scratch ledger): 18 cells, 0 done, 18 to run, every cell registered, contributor ON, worst case $9.00 (matrix cap $9.00).
- **Expected cost and time**, from the 24 real T2 cells of these three workflows at C0-C3 x seeds 1-2 in the arena (v1 dir, tip afcf732; all 24 are valid and completed): per-cell means by profile, swarm C0 $0.281 / 182 s, C3 $0.299 / 200 s; durable-max C0 $0.304 / 206 s, C3 $0.283 / 235 s; durable C0 $0.312 / 326 s, C3 $0.275 / 241 s (n = 2 each). Three seeds of those six: **$5.26 and 69.5 min**. With the means over the four profiles of each workflow (n = 8: $0.290, $0.291, $0.286; 204, 204, 257 s): $5.20 and 66.5 min. With the largest real cell of each workflow ($0.350, $0.318, $0.325; 236, 241, 338 s): $5.96 and 81.5 min. Worst case (the caps): $9.00. C3 only (9 cells) would be $2.57 and 33.8 min. The largest real cell is under the $0.50 cap. The cells' `cost_usd` for the 16 rival cells sums to $4.61 against the ledger's $4.54, so these figures are about 1.5% high. There is no real seed-3 cell: the projection assumes it costs like seeds 1-2.
- **Seed 3**: T2 seed 3 is invalid at C0 for every workflow under the fake LLM (REPORT 4.4); its real validity is unknown (all 24 real cells of seeds 1-2 are valid). The matrix has seeds 1-3, like the sweeps; `[1, 2, 4]` is a one-line change (the fixtures exist).
- **The $0 rehearsal** (the coordinator's GO, 19:04 CET): `bench bench/matrix-headline.yaml --fake --out <scratch>`, one process: **18 ran, 0 skipped, 0 failed, 77.4 s, peak 137 MB**. It wrote `cells/`, `results.json` and `.csv`, `hero-t2_conference.png` and `.json`, `recovery-t2_conference.png` and `.json`; the repo tree stayed clean. The hero chart draws two points per workflow (C0 at 0, C3 at 5 coordinators killed) with the extra cost on the C3 points; the recovery chart has its per-crash panels at C3 only. `bench verdicts <dir>` (print only) reads the dir: outcome PENDING (no sweeps), a "gate C3" point with H1-H6 and the stall against durable-max and durable over the three seeds.
- **The rehearsal's rows are not the gate's, and that is expected.** The 18 cells' run params with Contributor off equal the gate's (18 of 18), and Contributor routing changes only the `contributor` param; but the fake runs then differ: the fake cost is 38% below the gate's for the same cells ($3.43 for the 18 against $5.57), and the outputs differ too (T2 seed 3: 6 of 6 valid, against 1 of 6 at the gate; the three-seed locality ratios read 0.99 / 0.57 / 0.84 against 0.48 / 0.32 / 0.62 at the gate's seeds 1-3). Two consequences. (a) A fake run of this matrix cannot predict the real cost: the real cells ($0.29 each) match the fake gate at default routing (swarm x0.995, Part 6), not the fake Contributor run ($0.19); the projection above stands. (b) REPORT 4.4's "a property of that instance under the fake LLM" for T2 seed 3 holds for the gate's configuration; under the fake Contributor run seed 3 is valid. I did not trace why the fake outputs change with the flag.
- **Reading it**: `bench verdicts bench/results/headline` prints the T2 C3 point as "gate C3" (a dir with no knob is a gate source): H1-H6 over the three seeds against durable-max and durable (`central` is absent), and writes nothing. Checked on the gate's fake rows cut to this shape (18 rows): it reads them (locality ties, ratios 0.48 / 0.32 / 0.62, the same three-seed numbers as the sweeps). The headline is not in `honesty.json` unless it is regenerated with this dir among the sources. The hero chart draws from C0 and C3 alone (two points per workflow, the C3 point with its extra cost): the last test.

## Open questions
- None blocking.
