# Day 6 — Sat 31 Oct — ★ Hero chart: $0 gate, then v1

Paste this into a **new Claude Code chat**. Branch/worktree: `day-06-bench`, from `master`.

## Read first
- `CLAUDE.md`
- `.plans/fractalswarm-spec.md` §15 (all; especially §15.2 fairness and §15.5 hero chart), §19, §20, §22
- `.plans/progress.md` (last entry)

## Goal
Produce the hero chart under fair failure semantics: **stall time** and **extra cost vs C0**, against coordinators killed. First prove for $0, with the calibrated fake LLM, that the lines separate. Only then spend credits on v1.

## Tasks (in order)
1. `baselines/supervisor.py`: the best-case supervisor.
   - A crashed coordinator restarts **5 s after the crash**, the same as our detection latency, and the restart itself takes 0 s.
   - Completed work is preserved.
   - Process-tree semantics: a coordinator crash cancels its in-flight worker calls.
2. `baselines/central.py`, `baselines/single.py` and `baselines/pipeline.py`, sharing the same runtime, tools, budgets and scoring.
3. `bench/harness.py`.
   - Matrix YAML, seeds, C-profiles.
   - Resumable runs.
   - Cost pre-flight with `--dry-run`.
   - A `--fake` mode with the calibrated fake LLM.
   - Contributor opt-in in the bench config.
4. `bench/scoring.py`: the metrics.
   - Stall time (no agent work in flight anywhere).
   - Extra cost vs C0, and time lost vs C0.
   - Completion, validity, coordination tokens, messages, breaker trips.
5. `bench/charts.py`: the hero chart, written as PNG plus JSON.
   - Two panels: stall time, and extra cost vs coordinators killed (0/1/3/5).
   - A secondary row with completion and validity.
   - A coordination-tokens panel.
6. T1: generator and scorer in `bench/tasks/t1_extraction`.
7. **GATE.**
   - Run the fake-LLM mini-matrix: swarm vs central on T2 at C0–C3.
   - **`test_bench_smoke`** asserts that the swarm's stall time and extra cost are lower than central's at C2 and C3.
   - **If the chart is flat: stop.** Revisit the metrics and semantics, never the fairness rules. Write it up in the progress log and tell Yoel before spending anything.
8. After the gate passes, run v1: 4 workflows × T2 × C0–C3 × 2 seeds in **Contributor mode**. Commit the chart, the CSV, and `bench/REPORT.md` with the fairness rules stated first.

## Exit criteria
- [ ] The gate passed.
- [ ] Chart v1 is committed (PNG, JSON, CSV, REPORT.md).
- [ ] Spend today ≤ $8.

## Allowed fallbacks today
- None for the gate.
- v1 may use 1 seed if time is short; rerun it later.

## Out of scope today
LangGraph (Day 9), UI, market.

## End of day
- Tests and lint green.
- Append to `.plans/progress.md`, including the gate numbers.
- Commit.
- Ask before merging into `master` or pushing.
