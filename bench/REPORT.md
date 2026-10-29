# FractalSwarm benchmark report

> Status: **skeleton**. Every number below is a placeholder (`TBD`) until the matrix
> runs. Regenerate the tables from `bench/results/<version>/results.csv`.

## 1. Rivals and fairness rules (read these first)

Every workflow runs on the same runtime, models, tools, budgets and scoring. The rival gets
every advantage we can implement fairly; nothing here is a straw man.

### Workflows

- **`swarm`** (FractalSwarm): ten orchestrators in a depth-2 tree (root → tracks → sessions)
  lead 12 agents. When an orchestrator dies, the survivors re-own its work by deterministic
  hashing from the log: no supervisor, no election, and no LLM call.
- **`durable-max`** (the ideal durable supervisor): one coordinator, o0, with the same 12
  agents and the same log. When o0 crashes, its agents keep working; results sent while it is
  down are logged and adopted when it restarts, and so are its own plan and judge calls. It
  restarts 5 s after the crash, the restart takes 0 s, and recovery uses no LLM: a hot standby
  that takes over after a 5 s lease.
- **`durable`** (a realistic durable supervisor): the same, except that o0's own in-flight plan
  and judge calls are lost and redone after the restart, as in LangGraph or CrewAI supervisors.
- **`central`, the in-process supervisor** (reference row): the Phase 1 baseline, kept with this
  explanation. Its workers run inside its process, so a crash cancels their calls. In its real
  C3 run (`t2-real-c3-central-seed1`) it lost 27 calls:

  | Cause | Calls |
  |---|---|
  | Its own workers, stopped by the simulated process-tree stop | 19 |
  | Its own plan and judge calls, which a process death really loses (the swarm lost 1) | 5 |
  | Chaos agent kills, which hit every workflow (the swarm lost 2) | 3 |

  Its restarts then re-dispatched 22 contracts that the crashes had cancelled (`lost in a
  crash`) and adopted nothing from the log: the bench counts 42 calls in that run as paid
  twice, about $0.22 of its $0.601. That is more than the whole gap to the swarm in that run
  ($0.501 at C3, $0.454 at C0), which is therefore mostly a design artifact, not evidence
  against a well-built supervisor. (From the recorded log: `fractalswarm recovery
  t2-real-c3-central-seed1` shows the 5 own calls cancelled, the 34 workers stopped and the 42
  calls paid twice; the 19 and the 3 are the 22 cancelled worker calls grouped by the stop that
  cancelled each.)
- **`single`, `pipeline`, `langgraph`:** secondary rows.

### What we grant the rival

These assumptions are also shown as a caption in the arena and stated in the video. The
sensitivity sweep (§4) checks that the conclusion does not hinge on them.

| Assumption | Value in the main runs | Why | Checked by |
|---|---|---|---|
| Failure detection | 5 s, the same as the swarm's heartbeats | Same detector for both | Sweep {1, 2, 2.5, 5, 10 s}, symmetric; 0.5 s and 20 s as reported extremes |
| Restart or failover | 0 s after detection (an ideal hot standby) | Best case for the rival | Sweep {0, 1, 3 s} |
| Detection asymmetry | None | A process manager can see a crash at once, while heartbeats can't | "Fast external restart": rival at 0.5 s and 1 s, swarm at 5 s |
| False deaths | The simulated supervisors have no detector and no bus, so they are never declared dead by mistake; the swarm's detector can declare a live coordinator dead when its heartbeats are dropped, delayed or cut off | An advantage granted to the rival (`bench/PREREG.md` §5); it stays | The false deaths are counted at every setting (§4) |
| Workers | Survive the crash; results kept and adopted from the log | A well-built system runs workers apart | — |
| The rival's own LLM calls | `durable-max`: survive. `durable`: lost | Two variants bound the realistic range | Both rows |
| Shared state | The same durable log as the swarm | Same storage for both | — |
| Failure model | The same number of coordinator crashes at the same progress points (C1/C2/C3 = 1/3/5) | The existing chaos profiles | The per-process view (§4): the swarm runs 10 coordinator processes, the rival 1 |

### Fairness rules

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
   - All **completed** work is preserved through native persistence: the durable
     supervisors and central keep their logged results, LangGraph its checkpointer, single
     its transcript, pipeline its stage outputs.
   - No LLM re-planning is added unless the framework does it natively (LangGraph's
     supervisor re-reads state through the LLM).
3. **Process-tree semantics only in the reference rows.** In `central` and `langgraph`,
   workers run inside the supervisor's run, as in standard supervisor frameworks, so a
   supervisor crash cancels its in-flight worker calls. In `durable-max` and `durable`, as in
   the swarm, agents are independent: their work survives the crash and is adopted.
4. **Network faults** affect the bus-based workflows. LangGraph has no bus; its rows note
   that caveat.
5. **Every point is replayable.** Each row of `results.csv` names its run directory, and
   `fractalswarm replay <run_dir> --verify` rebuilds that run bit for bit.
6. **The rules are fixed before the runs.** The hypotheses and the minimum effects are
   committed in `bench/PREREG.md` before any gate run, and the rules are never changed to
   rescue a result. A difference counts only if every seed agrees and it reaches the minimum
   effect; otherwise it is a tie.

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

**Recovery metrics (v2, pre-registered).** Computed for every workflow; the exact readings
are fixed in `bench/PREREG.md` before the gate runs.

| Metric | Definition |
|---|---|
| **Work lost** | LLM calls cancelled or redone because a coordinator crashed, as calls and $. Separate from agent kills and API faults. |
| **Duplicated work** | Calls of a contract step already answered earlier, as calls and $. |
| **Unnecessary reassignments** | Re-dispatches while the assignee was alive, or while its result was already in the log. |
| **Time to recover, per crash** | From the crash to the first decision on the affected work (dispatch, judge or booking), and to its recovered throughput. |
| **Blast radius** | Share of agents and goals waiting on the dead coordinator, and the idle agent-seconds the crash causes (an agent idle while ready work waits for a down coordinator). |
| **Coordinator-dependency time** | Time during which ready work cannot proceed because its deciding coordinator is down. |

## 3. Setup

| Item | Value |
|---|---|
| Matrix | `bench/matrix.yaml` (chart v1: 4 workflows × T2 × C0–C3 × 2 seeds = 32 runs) |
| Models | TBD (Contributor routing, opted in for synthetic tasks) |
| Topology | swarm: depth 2, 10 orchestrators, 12 agents; durable-max, durable and central: 1 coordinator, 12 agents |
| Pre-flight worst case | TBD (`fractalswarm bench bench/matrix.yaml --dry-run`) |
| Actual spend | TBD |
| $0 gate (fake LLM) | TBD: swarm vs central on T2 at C0–C3 (`test_bench_smoke`) |

## 4. Results

![hero chart](results/v1/hero-t2_conference.png)

### Stall time (s), mean over seeds

| Workflow | C0 (0 killed) | C1 (1) | C2 (3) | C3 (5) |
|---|---|---|---|---|
| swarm | TBD | TBD | TBD | TBD |
| durable-max | TBD | TBD | TBD | TBD |
| durable | TBD | TBD | TBD | TBD |
| central (in-process supervisor) | TBD | TBD | TBD | TBD |
| single | TBD | TBD | TBD | TBD |
| pipeline | TBD | TBD | TBD | TBD |

### Extra cost vs C0 (%), mean over seeds

| Workflow | C1 | C2 | C3 |
|---|---|---|---|
| swarm | TBD | TBD | TBD |
| durable-max | TBD | TBD | TBD |
| durable | TBD | TBD | TBD |
| central (in-process supervisor) | TBD | TBD | TBD |
| single | TBD | TBD | TBD |
| pipeline | TBD | TBD | TBD |

### Recovery: blast radius and coordinator-dependency time, per crash

| Workflow | Idle agent-seconds | Coordinator-dependency time (s) | Time to recover (s) | Work lost (calls) |
|---|---|---|---|---|
| swarm | TBD | TBD | TBD | TBD |
| durable-max | TBD | TBD | TBD | TBD |
| durable | TBD | TBD | TBD | TBD |

### Sensitivity sweep ($0)

Does the conclusion hinge on what we grant the rival? Symmetric detection {0.5, 1, 2, 5,
10 s}, rival restart {0, 1, 3 s}, the fast external restart (rival detection 0.5–1 s, swarm
heartbeats 5 s), crash-time jitter and more seeds, coordination density, and T1 against T2.
Results: TBD.

### Per-process view

The main runs give every workflow the same number of coordinator crashes. If instead every
coordinator process fails at the same rate, the swarm, with 10 coordinator processes, sees
about 10 times more crashes than a rival with 1. This view reports the expected idle
agent-seconds and blocking time per hour of work under both failure models, whichever way
they point. Results: TBD.

### Secondary: completion, validity, coordination tokens

| Workflow | Completion | Validity | Coordination tokens / run |
|---|---|---|---|
| swarm | TBD | TBD | TBD |
| durable-max | TBD | TBD | TBD |
| durable | TBD | TBD | TBD |
| central (in-process supervisor) | TBD | TBD | TBD |
| single | TBD | TBD | TBD |
| pipeline | TBD | TBD | TBD |

## 5. Reading the chart honestly

- With best-case supervisors every workflow may finish (completion and validity near
  100%). That is the honest point: "everyone finishes; only one doesn't stall or pay twice".
- TBD: observations, outliers, seed variance.

## 6. Limitations

- The baselines run on our runtime, with the failure semantics above; they are not the
  original frameworks' deployments (except LangGraph).
- The log is centralized (single process); the chaos is simulated by injection. The swarm
  removes the coordinator as a single point of decision, not every single point of failure.
- Having no supervisor is not, by itself, evidence that the system is simpler, cheaper or more
  reliable; each of those would need its own measurement. Against `durable-max` we expect a cost
  tie.
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
