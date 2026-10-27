# Day 6 — bench foundations (parallel stream, branch `Yoelcanarion/day-06-bench-foundations`)

Base: `b6abd07` (Day 3 kernel + real-call golden). Built in parallel with the Day 4 slice and
the Day 5 takeover streams; only the pieces that need neither.

## Done
- **`bench/scoring.py`**: every metric is a pure function of the event log (EventStore,
  run dir, events.sqlite/.jsonl, or a list of events).
  - LLM call interval: `effect.started` (kind llm) → `effect.completed` / `effect.cancelled`;
    never closed → closes at the run end. Budget-refused calls never start.
  - **Stall time**: inside the work window (first agent-call start → last agent-call end),
    virtual time with no agent LLM call in flight. "Agent work" = request role `agent`
    (pluggable `is_work`). Planner/judge/supervisor calls are not work, so an LLM re-plan
    after a crash still counts as stall.
  - Makespan, cost (sum of `cost_usd`; cancelled calls $0), tokens, LLM calls/errors/cancels,
    `msg.sent` count, `breaker.tripped` count (0 if absent), `chaos.*` count.
  - **Coordination tokens**: tokens of calls with role in {coordinator, supervisor, router,
    recovery} or effect tag `coord:*`. Baseline authors must tag routing/re-plan calls.
  - Completion/validity/score from a pluggable `Checker(events) -> Outcome`.
  - `extra_cost_pct`, `time_lost_s` vs the C0 twin (same workflow, task, seed).
- **`bench/profiles.py`**: C0–C3 (§15.4), crash points 20/35/50/65/80%, 5 s restart delay.
- **`bench/registry.py`**: `Workflow` protocol (`run(CellContext)`, `preflight(cell,
  contributor) -> [LLMRequest dicts]`), `TaskDef(name, checker)`, `register_workflow`,
  `register_task`, and `BUILTIN_MODULES` (import-to-register list; later streams append
  their module there).
- **`bench/toy_workflow.py`**: the kernel toy as stand-in workflow + task `toy`.
- **`bench/harness.py`** + **`fractalswarm bench MATRIX [--dry-run] [--fake] [--out DIR]
  [--confirm-real-spend]`**: matrix YAML (workflows × tasks × profiles × seeds, contributor
  opt-in, run and matrix caps), resumable via `<out>/cells/<cell>.json` (a run dir without
  a result file is wiped and rerun), failing cells reported and not marked done, pre-flight
  with `LLMClient.estimate` (= `PriceTable.worst_case`) over each workflow's worst-case
  requests, `results.csv` + `results.json` + hero chart. Real mode needs
  `--confirm-real-spend` and refuses over the matrix cap or the project remainder.
- **`bench/charts.py`**: hero chart PNG + JSON. Top: stall time, extra cost vs C0. Bottom:
  completion %, validity %, coordination tokens. x = 0/1/3/5; mean over seeds with min–max
  whiskers; fixed colorblind-validated slot per workflow (swarm blue, central orange, single
  aqua, pipeline yellow, langgraph magenta) plus marker + dash per line; rates 0–100%, other
  axes from 0, 0% line on extra cost; rate points dodged sideways so equal values stay
  visible. The JSON keeps the run dirs per point (replay links for the UI).
- **T1** (`bench/tasks/t1_extraction/`): seeded generator (10 companies × 4 dated docs = 40,
  8 fields, ~5 per doc, rival distractors, noise numbers, mutable fields → cross-doc
  contradictions, truth = newest doc wins), `write_instance` (docs.json without the truth),
  field-level F1 scorer with normalization, `check_formats`, `make_checker(truth, extract)`.
- **`bench/matrix.yaml`** (chart v1, 32 cells, contributor on, caps $0.50/run, $8/matrix)
  and **`bench/matrix-smoke.yaml`** (toy × C0–C3 × 2 seeds, runs today with `--fake`).
- **`bench/REPORT.md`** skeleton, fairness rules first, placeholders for numbers.
- **Tests**: 135 green (48 new: scoring on the golden toy log and synthetic logs, hypothesis
  on interval union/stall; T1 generator/scorer with hypothesis; harness end to end with the
  fake LLM, resume, failure, pre-flight, contributor, caps; charts; CLI). Ruff green.

## Deviations
- **matplotlib added to main dependencies** (spec §18 lists it as runtime), not an extra.
- **The stall window is the agent-work window**, not the whole run: root planning before
  the first agent call and integration after the last are excluded (every workflow pays
  them at C0; they are not crash cost). Spec glossary: "total wall time during which no
  agent work is in flight"; this is that, bounded to the work window.
- **Cancelled calls cost $0** in the metric (lower bound; it only flatters the baselines).
- `breaker.tripped` is not registered as an event type here (comms owns breakers); scoring
  counts it by type name.
- The pre-flight only prices registered workflows; for v1, `--dry-run` currently lists all
  32 cells as NOT REGISTERED.
- `bench/profiles.py` defines the C-profiles; if the Day 5 chaos layer defines its own, one
  should import the other.

## Spend
$0. No real API calls. Tests never open the project ledger.

## Issues / what remains of Day 6
- Baselines (`baselines/supervisor.py`, central, single, pipeline): need the slice.
- Register the `swarm`, `central`, `single`, `pipeline` workflows and the `t2_conference`
  task (checker = hard-constraint checker) in `bench.registry` (append modules to
  `BUILTIN_MODULES`). Each workflow's `preflight` must include chaos rework.
- Baselines must tag LLM routing/re-plan calls (`supervisor` role or `coord:` tag) so
  coordination tokens are counted.
- `test_bench_smoke` (the $0 gate: swarm < central on stall and extra cost at C2 and C3),
  then the paid v1 run, then fill REPORT.md.
- A T1 runner (agents extracting from docs.json, a final-predictions event) is not built;
  `make_checker` needs an `extract(events)` once that event type exists.
