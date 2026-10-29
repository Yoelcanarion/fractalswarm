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

## Open questions
- None blocking.
