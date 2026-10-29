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
- `outcome{label: A|B|pending, against, gate[], plausible[], conditions[]}`: the outcome PREREG §7 derives, and the points that decide it. The headline sentence is not in it.
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
5. The gate's seeds 3-4 generate fixtures under `tasks/fixtures` the first time they run (untracked; do not commit them).
6. Two measuring processes (`recovery_ms` 500 at C3, 614 MB; 48 agents, 445 MB) went over 300 MB before I had asked for a SLOT, and the harness tests ran their toy matrices (34 s) without one. Nothing else heavy has run.

## Open questions
- None blocking.
