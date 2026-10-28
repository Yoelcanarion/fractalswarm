# Worker brief W1 — `rival`

- **Branch:** `Yoelcanarion/arena-rival`. The coordinator created it from `Yoelcanarion/arena` as a child worktree, and you are already in it: do not create another worktree or branch.
- **Model:** Sonnet 5.5 at max effort. Invoke `/hard-task` for the recovery logic in `_recover`, the metric definitions and the pre-registration.
- **Setup:** run `uv sync` first.

## Why this matters
Phase 2 compares FractalSwarm against the **strongest supervisor we can implement fairly**. The old `central` baseline lost 27 calls at C3, but 19 of them were its own simulated process-tree stop killing its workers, so that comparison proves little. You build the fair rival and the metrics that decide the headline honestly, in either direction. **Never tune anything to make the swarm win.**

## Read first
- `CLAUDE.md` (binding), especially the determinism rules.
- `.plans/arena-spec.md`: §0, §1, §A, §B and §C, all of them.
- `.plans/arena/backend-design.md`: §0, §1, §2, §3 and §7. **This is your design.** The line numbers refer to `actors/orchestrator.py` after the Phase 0 merge.
- `bench/REPORT.md` §1, the fairness rules.
- The code:
  - `actors/orchestrator.py`: `CENTRAL_MODES`, `_central_step`, `_crash`, `_restart`, `_redo`, `_pull`, `_logged`, `_judge`, `_accept`, `_assign_children`, `_squad`;
  - `coord/tree.py`, `actors/swarm.py`, `runs.py`, `bench/{scoring,harness,registry,charts,profiles,workflows}.py`;
  - `verify/takeover.py`, `coord/membership.py`, `kernel/events.py`.

## Your files
See backend-design §7.
- **You own:**
  - `actors/orchestrator.py` (the central section, `_squad`, `_assign_children`);
  - `coord/tree.py`;
  - new `baselines/durable.py`;
  - `actors/swarm.py` (the scenarios);
  - `bench/workflows.py`;
  - new `bench/recovery.py`;
  - `bench/{scoring,harness,registry,charts}.py`;
  - `llm/calibrate.py`;
  - new `verify/recovery.py`;
  - `verify/takeover.py`;
  - new `bench/PREREG.md`;
  - `bench/matrix-*.yaml`;
  - `bench/REPORT.md`.
- **Light, additive edits:** `runs.py` and `cli.py`.
- **Not yours:** `intake/`, `planning/taskspec.py`, `bench/tasks/*`, `api/*`, `kernel/*` (W2); `actors/board.py`, the arbitration and lens modules (W3); `web/` (W4, W5).
- **If you need a change in a file you don't own,** ask the coordinator.
- **New payload models:** register them in your own module if the registry allows. Otherwise add one block at the end of `kernel/events.py` and tell the coordinator.

## Replay-safety rules (backend-design §0)
- **Never add a field, even a defaulted one, to an existing event payload model.** `validate_payload` writes the defaults into the log, so every old run would stop replaying.
- New facts go into **new event types**: `goal.opened` and `supervisor.adopted`.
- New behaviour is gated by **new modes** (`durable-max`, `durable`) or **new params** that old logs don't have (`recovery_ms`, `rival_recovery_ms`, `knobs`).
- **The default path stays event-identical.** That means swarm, central, single and pipeline, with or without chaos. The coordinator checks it with the $0 reference runs at every merge. Run the same comparison yourself before you report:
  1. Record the references at your branch point.
  2. Run the same command lines again at your HEAD.
  3. Diff the event logs.
- **Determinism:**
  - no `hash()`;
  - no unsorted set iteration;
  - no wall clock in handlers;
  - randomness only through `random.Random(f"{run_seed}:{actor_id}:{purpose}")`.

## Your job, in order

### 1. The durable modes (backend-design §1)
1. Add `DURABLE_MODES = ("durable-max", "durable")` and append them to `CENTRAL_MODES`. Then wire them into `_squad`, `BenchWorkflow.scalable`, and `orchestrator_init` (`restart_ms`).
2. Add the new event `goal.opened{goal_id, owner, parent, level, goal}`, emitted in the central branch of `_assign_children` **for the durable modes only**. Register it in `TreeView.apply`.
3. Add the `OwnEffectsView` reducer in `baselines/durable.py`, installed only for the durable modes. It maps `plan|`, `judge|` and `scan|` effects to `in_flight()` and `completion()`.
4. Add a durable branch to `_crash`:
   - it never stops agents;
   - it emits `baseline.crashed` with the existing schema;
   - **`durable`** cancels its own `plan|`, `judge|` and `scan|` tags, and lists them in `lost`;
   - **`durable-max`** cancels nothing.
5. Add `_recover`, the durable branch of `_redo`. It goes through the goals in sorted order and adopts from the log:
   - planning or scanning: adopt the completion, or wait while the call is in flight (max), or re-issue it (realistic);
   - contract running: adopt the result if it is logged; keep waiting while the agent is alive; `_retry(..., "lost")` if the agent is dead;
   - judging: reuse `TreeView.judged`, and wait while the judge call is in flight under max;
   - booking: `_accept`;
   - then emit `supervisor.adopted{results, verdicts, plans, bookings, waiting}` and `baseline.restarted{redo}`, and handle `pending_crashes`.
6. Wire them: two scenarios in `swarm.py`, `runs.py` `SCENARIOS`, `bench/workflows.py`, and `cli.py --scenario`.
7. **Knobs,** passed only when set:
   - `params.recovery_ms`: the supervisors' `restart_ms` and the swarm Detector's `dead_after`;
   - `params.rival_recovery_ms`: the supervisors only;
   - a rival restart time added after the detection.

   Check that `coord/membership.py`'s Detector handles a sub-second `dead_after`, with the heartbeat interval scaled. If it can't, say so; don't silently clamp.
8. **The arena plan.** Make sure a single ChaosPlan JSON with 5 coordinator crashes works for both the swarm and the supervisors. The first action targets `o0`; the rest are rule-targeted. Remember that `kill-half`'s explicit targets are skipped in central (backend-design §0). W2 adds the `--chaos-plan FILE` flag; agree the plan's shape with W2 through the coordinator. A pure helper in `bench/profiles.py` that builds it is yours.
9. **Tests** (fake LLM; integration tests in tmp dirs):
   - durable workers keep running across a crash, and none is stopped by its coordinator's crash;
   - `durable-max` adopts its own plan and judge completions, and **no call is paid twice**;
   - `durable` cancels exactly its in-flight own calls and re-issues them;
   - results logged while o0 was down are all consumed after the restart;
   - the old `central`, `single` and `pipeline` runs and the golden bundles still replay MATCH;
   - the existing "same number of crashes" test, extended to the durable modes;
   - a guard: the durable modes preserve at least as much work as the process-tree `central`.

**→ First merge: the durable modes.** Report to the coordinator, who runs the reference comparison and merges.

### 2. Metrics (backend-design §2)
1. In `bench/recovery.py`:
   - the outage windows;
   - `TTR_own` and `TTR_drain`;
   - coordinator-dependency time (CDT) and `blocked_total`;
   - blast radius and exposure;
   - idle agent-seconds;
   - unnecessary reassignments;
   - duplicated work, split by cause;
   - preserved work.
2. **The definitions must be event-symmetric:** the same rule applied to swarm and supervisor logs. Write each one as a docstring with its exact event boundaries.
3. Wire it in:
   - `RunMetrics` fields (with defaults; `RunMetrics` is never logged);
   - the `score_run` columns in `harness.py`;
   - `Matrix.knobs` and `Cell.knobs` in `registry.py`;
   - `backend_factory(cell)`, a per-role latency scale in `llm/calibrate.py`.
4. Add `bench rescore OUT`, which recomputes the metrics of existing results at $0.
5. Add `verify/recovery.py` and `fractalswarm recovery RUN`: a table per crash, plus the supervisor invariants of backend-design §2. For a supervisor log, `fractalswarm takeover` points to `recovery`.
6. In `charts.py`:
   - add the durable modes to `KNOWN_WORKFLOWS`;
   - add `recovery_chart` and `regime_chart`;
   - write `honesty.json` (wins, ties and losses by regime, plus the per-process view) for the UI's "where it helps" panel.

   Show W4 and W5 the shape of `honesty.json` early, through the coordinator.
7. **Tests:** synthetic event lists with hand-computed answers, for every metric, for both swarm and supervisor shapes. Include a false death, an agent kill during an outage, and a crash with nothing in flight.

### 3. The protocol tooling (backend-design §3)
1. **`bench/PREREG.md`:**
   - the hypotheses (the spec's H1–H3, refined into backend-design's H1–H6, with the minimum effects);
   - the tie rule;
   - the failure models;
   - the decision rules of spec §C.4.

   Commit it **before** any gate run, and send it to the coordinator.
2. **The matrices:**
   - `bench/matrix-rivals-gate.yaml` ($0: 4 workflows × T2 and T1 × C0–C3 × seeds 1–4, sim clock);
   - the sweep matrices of backend-design §3: symmetric `recovery_ms`, the asymmetric `rival_recovery_ms`, the rival restart time, the latency scale, the width and T1 vs T2;
   - the per-process runs (single crashes with explicit targets: root, a track lead, a session orchestrator; o0 for the supervisor).
3. **`bench verdicts OUT --prereg`:** it applies PREREG's rules to a results dir and prints wins, ties and losses per hypothesis, with their conditions.
4. **The per-process computation:** the expected impact per hour of work at an equal per-process failure rate (10 coordinators against 1), from the single-crash impacts by target level.
5. **Measure** how long one fake sim run takes, and estimate the gate and the sweeps in wall time and CPU. Tell the coordinator **before** running them; they count as a heavy command.

**→ Second merge: the metrics and the protocol.**

### 4. When the coordinator says go
- Run the $0 gate and the sweeps in your worktree. They run at $0, but heavy, so wait for the coordinator's slot. Write the results under `bench/results/rivals-gate/` and `bench/results/sweeps/`; their `runs/` subdirs are gitignored, and the summaries are committed.
- Then write the factual parts of `bench/REPORT.md`:
  - the rival-assumptions table (spec §A);
  - the old `central` row relabelled "in-process supervisor", with the 27-call explanation;
  - the gate results;
  - the sensitivity results;
  - the per-process view.

  The headline sentence is the coordinator's and Yoel's decision; leave a marked placeholder.

## Hard rules
- **No real Meta API calls,** ever. Fake LLM and recorded runs only. The coordinator runs every paid run.
- **Never touch `~/.fractalswarm/ledger.sqlite`.** Use scratch `FRACTALSWARM_RUNS_DIR` and `FRACTALSWARM_LEDGER_PATH` for anything you record.
- **When the coordinator sends HOLD,** stop test suites, bench runs and builds until RELEASE.
- **Don't edit `.plans/progress.md`.** Write your notes to `.plans/notes/arena-rival.md`: done, deviations, issues, and open questions.
- **No test asserts that the swarm beats a rival.** Tests check properties; verdicts come from PREREG.

## End of each merge step
- Green: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `uv run fractalswarm demo --verify` (MATCH).
- The reference comparison is clean, or every difference is explained and gated.
- Commit on your branch. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't merge or push.
- Report to the coordinator:
  - the branch and the commit;
  - the test counts;
  - the reference comparison result;
  - done and not done;
  - deviations;
  - the event shapes you added, which W4 needs.
