# FractalSwarm benchmark report

> Status: **skeleton**. Every number below is a placeholder (`TBD`) until the matrix
> runs. Regenerate the tables from `bench/results/<version>/results.csv`.

## 1. Fairness rules (read these first)

Every workflow runs on the same runtime, models, tools, budgets and scoring. The baselines
get the best case we can give them; nothing here is a straw man.

1. **Same failures for everyone.**
   - Every workflow suffers the **same number of coordinator crashes at the same logical
     progress points**: C1 = 1, C2 = 3, C3 = 5 crashes, at 20/35/50/65/80% of contracts
     dispatched.
   - Each crash targets the coordinator with the most remaining owned work. In
     single-coordinator workflows that is always the same process; in the swarm it is a
     different orchestrator each time, so C3 means "half the brains".
   - The same share of agents (0/10/30/50%) is killed at the same points.
   - API and network faults use the same seeds.
2. **Best-case supervisor for the baselines.**
   - A crashed coordinator restarts **5 s after the crash**. That equals the swarm's own
     failure-detection latency (5 missed 1 s heartbeats). The restart itself takes 0 s.
   - All **completed** work is preserved through native persistence: central keeps
     persisted results, LangGraph its checkpointer, single its transcript, pipeline its
     stage outputs.
   - No LLM re-planning is added unless the framework does it natively (LangGraph's
     supervisor re-reads state through the LLM).
3. **Process-tree semantics, stated explicitly.** In `central` and `langgraph`, workers run
   inside the supervisor's run, as in standard supervisor frameworks, so a supervisor crash
   cancels its in-flight worker calls. In the swarm, agents are independent actors: orphans
   finish and their results are adopted. This architectural difference is exactly what is
   measured.
4. **Network faults** affect the bus-based workflows. LangGraph has no bus; its rows note
   that caveat.
5. **Every point is replayable.** Each row of `results.csv` names its run directory, and
   `fractalswarm replay <run_dir> --verify` rebuilds that run bit for bit.

## 2. Metrics (all computed from the event log)

Definitions live in `src/fractalswarm/bench/scoring.py`; anyone can recompute them from a
run bundle.

| Metric | Definition |
|---|---|
| **Stall time (s)** | Within the work window (first agent LLM call start → last agent LLM call end), the virtual time during which **no agent LLM call is in flight anywhere**. A call is in flight from `effect.started` to its `effect.completed` or `effect.cancelled`; a call never closed counts until the run ends. Planner, judge and supervisor calls are not agent work. |
| **Extra cost vs C0 (%)** | `(cost(Ck) − cost(C0)) / cost(C0)`, same workflow, task and seed. Cost = sum of `cost_usd` of completed LLM calls, plus an estimate for calls cancelled or still in flight at the end: input billed in full, plus output so far (elapsed × the run's observed output rate for that role, capped at the full answer). Base latency is counted in the rate, so the estimate errs low. |
| **Time lost vs C0 (s)** | `makespan(Ck) − makespan(C0)`, same workflow, task and seed. |
| **Completion / validity** | From each task's deterministic checker (T2: 0 hard-constraint violations; T1: every value well-formed, every slot filled and F1 >= 0.9). |
| **Quality** | T2 soft score; T1 field-level F1. |
| **Coordination tokens** | LLM tokens of calls made to coordinate (roles `coordinator`, `supervisor`, `router`, `recovery`, or effect tags `coord:*`). Takeover in the swarm makes no LLM call. |
| **Messages / breaker trips** | `msg.sent` and `breaker.tripped` events. |

## 3. Setup

| Item | Value |
|---|---|
| Matrix | `bench/matrix.yaml` (chart v1: 4 workflows × T2 × C0–C3 × 2 seeds = 32 runs) |
| Models | TBD (Contributor routing, opted in for synthetic tasks) |
| Topology | swarm: depth 2, 10 orchestrators, 12 agents; central: 1 orchestrator, 12 agents |
| Pre-flight worst case | TBD (`fractalswarm bench bench/matrix.yaml --dry-run`) |
| Actual spend | TBD |
| $0 gate (fake LLM) | TBD: swarm vs central on T2 at C0–C3 (`test_bench_smoke`) |

## 4. Results

![hero chart](results/v1/hero-t2_conference.png)

### Stall time (s), mean over seeds

| Workflow | C0 (0 killed) | C1 (1) | C2 (3) | C3 (5) |
|---|---|---|---|---|
| swarm | TBD | TBD | TBD | TBD |
| central | TBD | TBD | TBD | TBD |
| single | TBD | TBD | TBD | TBD |
| pipeline | TBD | TBD | TBD | TBD |

### Extra cost vs C0 (%), mean over seeds

| Workflow | C1 | C2 | C3 |
|---|---|---|---|
| swarm | TBD | TBD | TBD |
| central | TBD | TBD | TBD |
| single | TBD | TBD | TBD |
| pipeline | TBD | TBD | TBD |

### Secondary: completion, validity, coordination tokens

| Workflow | Completion | Validity | Coordination tokens / run |
|---|---|---|---|
| swarm | TBD | TBD | TBD |
| central | TBD | TBD | TBD |
| single | TBD | TBD | TBD |
| pipeline | TBD | TBD | TBD |

## 5. Reading the chart honestly

- With best-case supervisors every workflow may finish (completion and validity near
  100%). That is the honest point: "everyone finishes; only one doesn't stall or pay twice".
- TBD: observations, outliers, seed variance.

## 6. Limitations

- The baselines run on our runtime, with the failure semantics above; they are not the
  original frameworks' deployments (except LangGraph).
- The log is centralized (single process); the chaos is simulated by injection.
- Fake-LLM gate runs use calibrated latencies; only the paid runs measure real latency.
- Cancelled calls are billed by an estimate, not by the provider's invoice (see Metrics).
- TBD: anything the runs reveal.

## 7. Reproduce

```sh
uv run fractalswarm bench bench/matrix.yaml --dry-run      # cells + worst-case cost
uv run fractalswarm bench bench/matrix.yaml --confirm-real-spend
uv run fractalswarm replay bench/results/v1/runs/<cell> --verify
```

## 8. Scaling sweep (spec §15.6)

`bench/matrix-scaling.yaml`: {swarm, central} × total agents {1, 2, 4, 8, 16} × T2 × C0 × 2 seeds
= 20 runs, Contributor mode, run cap $0.50 (matrix cap $10). No chaos: it measures how makespan,
cost and stall move with the number of agents. Exact scaling only.

**How a total becomes a tree** (`src/fractalswarm/bench/scaling.py`). The tree stays at depth 2
(T2 plans root → tracks → sessions) and holds exactly N agents: N = fanout[0] × fanout[1] ×
agents_per_leaf. Squads of 2 (the demo's value; an odd total gets squads of 1) and two session
orchestrators per track orchestrator (T2 has two days). The swarm grows its brains with its hands,
and the 12-agent demo is a member of the family. Central gets the same numbers, so the two differ
only in who leads: it has fanout[0] × fanout[1] squads of agents_per_leaf agents, led by one
orchestrator, which hands one squad to each session, in turn when there are fewer squads than
sessions.

| Agents | Fanout | Agents per leaf | Swarm orchestrators | Central squads |
|---|---|---|---|---|
| 1 | [1, 1] | 1 | 3 | 1 of 1 |
| 2 | [1, 1] | 2 | 3 | 1 of 2 |
| 4 | [1, 2] | 2 | 4 | 2 of 2 |
| 8 | [2, 2] | 2 | 7 | 4 of 2 |
| 16 | [4, 2] | 2 | 13 | 8 of 2 |
| *12 (demo)* | *[3, 2]* | *2* | *10* | *6 of 2* |

**Read it knowing the ceiling.** T2 has six sessions, each a chain of three contracts (extract,
place, blurb), so at most six agents can work at once. Past six the extra agents idle and the
curves flatten; the chart marks the limit with a dotted line. At C0 stall is a few seconds at most
for every workflow: the metric is built for crashes.

Results: TBD (`bench/results/scaling/scaling-t2_conference.png`, one line per workflow).

```sh
uv run fractalswarm bench bench/matrix-scaling.yaml --fake             # $0, sim clock
uv run fractalswarm bench bench/matrix-scaling.yaml --dry-run
uv run fractalswarm bench bench/matrix-scaling.yaml --confirm-real-spend
```
