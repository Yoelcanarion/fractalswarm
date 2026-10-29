# FractalSwarm benchmark report

> Status: **the $0 sections, the headline and the reading in §5 are written; the real-model
> results are not.** §3 (setup) and §4 (results) report the fake-LLM runs of the arena phase on the
> simulated clock: the rivals gate, the sensitivity sweeps, the per-process view and the false
> deaths. Every number in them is read from files committed under `bench/results/` (`results.csv`,
> `results.json`, `honesty.json`, `verdicts.txt`). What needs the real model (the `TBD` rows of §3,
> §4.10 and the results of §8) is not written yet.

**Headline (decision gate, Oct 29: outcome B). Resilience comparable to an ideal durable
supervisor, without a central coordinator or a separate recovery mechanism.** Against
`durable-max`, stall time and extra cost tie at all six gate points, and locality ties on T2 at C2
and C3, so the stronger claim, that recovery stays local to the affected subtree, is not made
(§4.5, §4.9). Locality would hold where the supervisor needs 1–3 s more to restart a coordinator,
and it fails where an external supervisor detects and restarts within 0.5–1 s (§4.6). Per process
the two are comparable, and the supervisor recovers sooner (§4.7); the swarm's failure detector
produces false deaths, the supervisors' none (§4.8). Against the in-process supervisor
(`central`), whose workers die with it, the swarm stalls 1.2 s against 34.3 s and pays −1.0%
against +66.6% extra on T2 at C3 (§4.1, §4.2). What a headline may say is fixed in
`bench/PREREG.md` §7; the claims, each with its evidence, are in `docs/claims.md`.

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

### The real-model matrix (not run yet)

| Item | Value |
|---|---|
| Matrix | `bench/matrix.yaml` (chart v1: 4 workflows × T2 × C0–C3 × 2 seeds = 32 runs) |
| Models | TBD (Contributor routing, opted in for synthetic tasks) |
| Topology | swarm: depth 2, 10 orchestrators, 12 agents; durable-max, durable and central: 1 coordinator, 12 agents |
| Pre-flight worst case | TBD (`fractalswarm bench bench/matrix.yaml --dry-run`) |
| Actual spend | TBD |
| $0 gate (fake LLM) | Run: the next table and §4 |

### The $0 runs behind §4

Every number in §4 comes from runs of the fake LLM with calibrated latencies on the simulated
clock: no network, no real call, $0 of spend. **T2** is the conference schedule (six sessions,
each a chain of three contracts: extract, place, blurb) and **T1** the extraction task.

| Item | Value |
|---|---|
| Gate | `bench/matrix-rivals-gate.yaml`: swarm, durable-max, durable and central × T2 and T1 × C0–C3 × seeds 1–4 = **128 cells, 0 failed**. Detection is 5 s for every system, and the supervisors restart at once. |
| Chaos profiles | C0: none. C1: 1 coordinator crash, 10% of agents killed, 5% API faults, 5% message loss. C2: 3 crashes, 30% killed, 10% API faults, 10% message loss and a partition. C3: 5 crashes at 20/35/50/65/80% of the contracts dispatched, 50% killed, 20% API faults, 20% message loss and one 8 s partition. The crash points and agent kills are the same for every workflow; the bus faults (loss, duplication, delay, reordering, partition) reach only the swarm's bus, since the supervisors have none (§1, rule 4; PREREG §5). |
| Sensitivity sweeps | Six matrices, **378 cells**: swarm, durable-max and durable × T2 × C0 and C3 × seeds 1–3. `recovery_ms` {1, 2, 2.5, 5, 10, 20 s} (108) and {0.5 s} (18); `rival_restart_ms` {0, 1, 3 s} (54); `rival_recovery_ms` {0.5, 1 s} (36); `agent_latency_scale` {0.25, 0.5, 1, 2} (72); agents {4, 8, 12, 24, 48} (90). |
| Per-process probes | **68 cells**, T2, seeds 1–4: the swarm at C0 and at ten single-crash probes `K-<target>` (44 cells), and the three supervisors at C0 and `K-o0` (24 cells). |
| Seeds | Gate and per-process probes: 1–4. Sweeps: 1–3. The default settings (5 s detection, no extra restart, 1× latency, 12 agents) are in the gate and in four of the sweeps (`recovery_ms` 5 s, `rival_restart_ms` 0, latency 1×, 12 agents), so the same cells are read twice, with different seeds: the locality ratios at T2 C3 against durable-max (cdt / blast / idle) are 0.37 / 0.29 / 0.47 at the gate (4 seeds) and 0.48 / 0.32 / 0.62 in the sweeps (seeds 1–3, identical in all four). |
| Rules | `bench/PREREG.md`, written before the first gate run and applied mechanically by `fractalswarm bench verdicts --prereg`; SHA `25d4a75919b3`. Ratio of the seed means, win, tie and loss are defined in §4. |
| Verdicts | Run over everything at commit `48601df` with a clean tree: `bench/results/honesty.json` (every comparison, losses and ties included), `verdicts.txt`, `regime.png`, `regime.json`. The gate alone gives `bench/results/rivals-gate/` the same files, where the outcome reads PENDING because it has no sweeps. |
| Files | Each results directory holds `cells/`, `results.csv`, `results.json` and the charts. The run bundles (`runs/`, about 5 GB) are not committed; each row names its run directory, and `fractalswarm replay <run_dir> --verify` rebuilds a run bit for bit. The matrices are deterministic: the default cells recur in four sweeps and are identical in all four. |
| Cost of the runs | About 29 minutes of compute on one core in all (table below); peak working set 145 MB for the gate and up to 730 MB for the 0.5 s detection sweep. |

| Stage | Cells | Wall time | Peak memory |
|---|---|---|---|
| Gate | 128 | about 2 min + 125.5 s (two chunks) | 145 MB |
| `recovery_ms` 1–20 s | 108 | 348.7 s | 418 MB |
| `recovery_ms` 0.5 s | 18 | 225.6 s | 730 MB |
| `rival_restart_ms` | 54 | 123.2 s | 137 MB |
| `rival_recovery_ms` | 36 | 86.2 s | 130 MB |
| `agent_latency_scale` | 72 | 159.4 s | 146 MB |
| Agents (width) | 90 | 365.2 s | 561 MB |
| Per-process, swarm | 44 | 135.3 s | 147 MB |
| Per-process, supervisors | 24 | 31.2 s | 137 MB |

### Two facts about the setup

**At C0 the four systems start from the same run on T1, not quite on T2.** On T1 they make the same
46 LLM calls with the same cost and makespan on all four seeds. On T2 the swarm's makespan is 3.5–5.0 s
longer on all four seeds, and on seeds 2 and 3 it makes 3 and 4 more calls than the other three, which
are identical to each other:

| Task | Seed | swarm | durable-max | durable | central |
|---|---|---|---|---|---|
| T2 | 1 | 58 / 70.8 s / $0.294 | 58 / 65.8 s / $0.291 | 58 / 65.8 s / $0.291 | 58 / 65.8 s / $0.291 |
| T2 | 2 | 64 / 53.9 s / $0.301 | 61 / 50.0 s / $0.284 | 61 / 50.0 s / $0.284 | 61 / 50.0 s / $0.284 |
| T2 | 3 | 69 / 78.4 s / $0.323 | 65 / 73.5 s / $0.315 | 65 / 73.5 s / $0.315 | 65 / 73.5 s / $0.315 |
| T2 | 4 | 67 / 89.8 s / $0.389 | 67 / 86.3 s / $0.392 | 67 / 86.3 s / $0.392 | 67 / 86.3 s / $0.392 |
| T1 | 1 | 46 / 33.3 s / $0.170 | 46 / 33.3 s / $0.170 | 46 / 33.3 s / $0.170 | 46 / 33.3 s / $0.170 |
| T1 | 2 | 46 / 41.5 s / $0.201 | 46 / 41.5 s / $0.201 | 46 / 41.5 s / $0.201 | 46 / 41.5 s / $0.201 |
| T1 | 3 | 46 / 57.4 s / $0.179 | 46 / 57.4 s / $0.179 | 46 / 57.4 s / $0.179 | 46 / 57.4 s / $0.179 |
| T1 | 4 | 46 / 54.5 s / $0.158 | 46 / 54.5 s / $0.158 | 46 / 54.5 s / $0.158 | 46 / 54.5 s / $0.158 |

*Calls / makespan / cost of each C0 run.* There is no chaos event and no false death at C0. The extra
calls belong to one more re-dispatch of a `place` contract and its judge call (`place` is retried in
every system on T2, and the swarm retried it once more on seeds 2 and 3). The cause is not traced to
the end; a likely one is that the bus's latency changes the order in which colliding bookings reach
the schedule.

**Extra cost is measured against each system's own C0**, so on T2 the swarm's percentages start from
a base that is a little dearer than the others' ($0.327 against $0.320, §4.2). The other metrics do not
use C0.

## 4. Results

Everything in this section is from the $0 runs of §3 (fake LLM, simulated clock). A table value is
the mean over the seeds of one task, workflow and profile (gate: seeds 1–4; sweeps: seeds 1–3).
**T2** is the conference schedule and **T1** the extraction task. C1, C2 and C3 crash 1, 3 and 5
coordinators, which is half of the swarm's ten at C3. The metrics are defined in §2.

**How to read the verdicts.** *Win*, *tie* and *loss* are the swarm's against one rival, by the
rules of `bench/PREREG.md` (fixed before the runs): a seed is a win only if it reaches the minimum
effect, and a comparison is a win only if every seed is one; otherwise it is a tie, marked `*` when
the seeds disagree. **Locality** *holds* when the swarm wins the coordinator-dependency time (cdt) and
the blast radius and does not lose the idle agent-seconds; it *fails* when it loses cdt or blast;
otherwise it *ties*. Next to each locality verdict the tables print the **ratios of the seed means**,
swarm / rival, for cdt / blast / idle. They are *descriptive, no verdict*: a ratio of 0.40 can still
be a tie, because one seed misses the threshold.

### 4.1 Hero chart and stall time

![The gate on T2: stall time and extra cost against the coordinators killed](results/rivals-gate/hero-t2_conference.png)

*T2 at the gate, seeds 1–4: stall time and extra cost (top), completion, validity and coordination
tokens (bottom), against the coordinators killed (C0–C3 = 0, 1, 3, 5). Points are means over seeds,
whiskers min–max. The chart is T2's, and T1 is in the tables. The validity panel is explained in §4.4.*

Stall time (s), mean over seeds:

| Task | Workflow | C0 | C1 | C2 | C3 |
|---|---|---|---|---|---|
| T2 | swarm | 0.6 | 1.5 | 4.9 | 1.2 |
| T2 | durable-max | 0.2 | 2.1 | 9.9 | 2.4 |
| T2 | durable | 0.2 | 2.5 | 1.4 | 13.8 |
| T2 | central (in-process supervisor) | 0.2 | 16.0 | 30.6 | 34.3 |
| T1 | swarm | 0.6 | 5.8 | 1.3 | 14.8 |
| T1 | durable-max | 0.6 | 0.0 | 6.3 | 0.5 |
| T1 | durable | 0.6 | 0.9 | 1.4 | 20.9 |
| T1 | central (in-process supervisor) | 0.6 | 11.2 | 16.0 | 37.0 |

On T2 the swarm stalls less than `durable-max` at C2 and C3 (4.9 against 9.9 s, 1.2 against 2.4 s)
and about as much at C1 (1.5 against 2.1 s); `central` stalls 16–34 s, and `durable` 13.8 s at C3.
Stall time is reported and is not one of the hypotheses (PREREG §4). The tool reads it against
`durable-max` as a tie at all six gate points, since a win needs 3 s on every seed.

On T1 it reverses at C1 and C3: the swarm stalls 5.8 and 14.8 s against 0.0 and 0.5 s for
`durable-max`. This is reported as it is, and it comes from a few runs:

| Profile | Workflow | Seed 1 | Seed 2 | Seed 3 | Seed 4 | Mean |
|---|---|---|---|---|---|---|
| C1 | swarm | 2.8 | 16.0 | 1.6 | 2.7 | 5.8 |
| C1 | durable-max | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| C2 | swarm | 0.0 | 0.5 | 1.6 | 3.0 | 1.3 |
| C2 | durable-max | 1.5 | 20.5 | 0.0 | 3.0 | 6.3 |
| C3 | swarm | 22.2 | 0.0 | 37.1 | 0.0 | 14.8 |
| C3 | durable-max | 0.0 | 1.9 | 0.0 | 0.0 | 0.5 |

*Stall time (s) of each T1 run.* Three runs carry it, and in each the stall is mostly one stretch in
which no agent call is in flight but a coordinator-side call is. T1 C1 seed 2 is one stretch of
15.95 s with one judge call in flight; the swarm's cdt is 0.00 at T1 C1, so no work waited for a dead
coordinator. T1 C3 seed 1 is one stretch of 22.19 s, again with one judge call in flight. T1 C3
seed 3 has 32.67 of its 37.12 s in one stretch with three sub-planner calls in flight, in a run whose
root planner call took 64.0 s (two attempts: an injected 503 overload with a 60 s Retry-After) against
3.9 s in `durable-max`, `durable` and `central` (§6, unpaired API faults). Stall time counts only the
gaps with no agent call in flight, so a long planner or judge call shows up as stall.

### 4.2 Extra cost

Extra cost against the same system's own C0 (%), mean over seeds:

| Task | Workflow | C1 | C2 | C3 |
|---|---|---|---|---|
| T2 | swarm | -3.9 | -2.2 | -1.0 |
| T2 | durable-max | 1.2 | 3.9 | 8.4 |
| T2 | durable | 5.2 | 13.1 | 13.0 |
| T2 | central (in-process supervisor) | 13.8 | 47.0 | 66.6 |
| T1 | swarm | 0.7 | 2.3 | 5.7 |
| T1 | durable-max | 0.8 | 2.9 | 3.0 |
| T1 | durable | 3.4 | 9.9 | 12.5 |
| T1 | central (in-process supervisor) | 8.2 | 36.0 | 65.6 |

The same costs in dollars, C0 included, so that both readings are visible:

| Task | Workflow | C0 | C1 | C2 | C3 |
|---|---|---|---|---|---|
| T2 | swarm | 0.327 | 0.315 | 0.319 | 0.324 |
| T2 | durable-max | 0.320 | 0.323 | 0.333 | 0.347 |
| T2 | durable | 0.320 | 0.336 | 0.361 | 0.361 |
| T2 | central (in-process supervisor) | 0.320 | 0.363 | 0.471 | 0.537 |
| T1 | swarm | 0.177 | 0.178 | 0.181 | 0.187 |
| T1 | durable-max | 0.177 | 0.179 | 0.182 | 0.183 |
| T1 | durable | 0.177 | 0.183 | 0.195 | 0.199 |
| T1 | central (in-process supervisor) | 0.177 | 0.192 | 0.241 | 0.292 |

On T2 the swarm's extra cost is negative and the rivals' is positive. The swarm's C0 is also a little
dearer than theirs ($0.327 against $0.320, §3), so its percentages start from a different base. In
dollars at C3 the swarm's mean is $0.324 against $0.347 for `durable-max`. By the preregistered
rule (PREREG §3: a difference of 5 points on every seed) H2 is a tie against `durable-max` at all six
gate points (§4.5), so the gate does not support the word *cheaper* (PREREG §7; `docs/claims.md`,
"Not claimed").

### 4.3 Recovery, per crash

Per-crash values are means over the run's crashes, then over seeds. Idle agent-seconds, calls
cancelled, paid twice and false deaths are per run. *Calls cancelled* is every cancelled LLM call of
the run, whatever the cause (a coordinator crash, a killed agent, a worker stopped with its
coordinator); *paid twice* is the cost of work done again, by any cause. *Time to recover* for the
supervisors is their configured restart delay, 5 s: an input, not a measurement. The swarm's is
measured, from the crash to its heir.

C2 (three coordinator crashes):

| Task | Workflow | Idle agent-s | Dependency time (s) | Time to recover (s) | Blast (% of sessions) | Preserved (%) | Calls cancelled | Paid twice ($) | False deaths |
|---|---|---|---|---|---|---|---|---|---|
| T2 | swarm | 11.0 | 7.9 | 5.48 | 13.9 | 93.8 | 0.8 | 0.006 | 1.25 |
| T2 | durable-max | 29.4 | 19.7 | 5.00 | 40.3 | 96.9 | 1.0 | 0.016 | 0.00 |
| T2 | durable | 59.0 | 37.6 | 5.00 | 45.8 | 66.4 | 5.2 | 0.043 | 0.00 |
| T2 | central (in-process supervisor) | 0.0 | 83.8 | 5.00 | 88.9 | 0.0 | 16.8 | 0.157 | 0.00 |
| T1 | swarm | 11.3 | 7.8 | 5.33 | 13.9 | 100.0 | 1.5 | 0.003 | 1.50 |
| T1 | durable-max | 60.1 | 30.9 | 5.00 | 51.4 | 100.0 | 2.0 | 0.004 | 0.00 |
| T1 | durable | 93.6 | 47.3 | 5.00 | 69.4 | 67.3 | 7.2 | 0.017 | 0.00 |
| T1 | central (in-process supervisor) | 0.0 | 90.0 | 5.00 | 100.0 | 0.0 | 18.0 | 0.063 | 0.00 |

C3 (five):

| Task | Workflow | Idle agent-s | Dependency time (s) | Time to recover (s) | Blast (% of sessions) | Preserved (%) | Calls cancelled | Paid twice ($) | False deaths |
|---|---|---|---|---|---|---|---|---|---|
| T2 | swarm | 17.4 | 12.0 | 5.99 | 10.8 | 90.5 | 2.2 | 0.015 | 2.25 |
| T2 | durable-max | 36.7 | 32.9 | 5.00 | 37.5 | 94.8 | 2.5 | 0.031 | 0.00 |
| T2 | durable | 50.6 | 48.8 | 5.00 | 32.5 | 68.9 | 7.8 | 0.053 | 0.00 |
| T2 | central (in-process supervisor) | 0.0 | 118.8 | 5.00 | 75.0 | 0.0 | 23.8 | 0.219 | 0.00 |
| T1 | swarm | 19.8 | 19.0 | 5.89 | 16.7 | 94.1 | 2.5 | 0.008 | 1.50 |
| T1 | durable-max | 47.8 | 37.5 | 5.00 | 43.3 | 100.0 | 2.0 | 0.005 | 0.00 |
| T1 | durable | 75.9 | 60.6 | 5.00 | 53.3 | 74.4 | 8.5 | 0.022 | 0.00 |
| T1 | central (in-process supervisor) | 0.0 | 138.8 | 5.00 | 92.5 | 0.0 | 27.8 | 0.114 | 0.00 |

### 4.4 Secondary: completion, validity, coordination tokens

All profiles pooled, 16 runs per row:

| Task | Workflow | Completion | Validity | Coordination tokens / run | Makespan (s) | Cost ($) |
|---|---|---|---|---|---|---|
| T2 | swarm | 100% | 81% | 0 | 104.4 | 0.321 |
| T2 | durable-max | 100% | 75% | 0 | 100.6 | 0.331 |
| T2 | durable | 100% | 81% | 0 | 114.6 | 0.344 |
| T2 | central (in-process supervisor) | 100% | 81% | 0 | 126.4 | 0.423 |
| T1 | swarm | 100% | 100% | 0 | 83.2 | 0.181 |
| T1 | durable-max | 100% | 100% | 0 | 70.8 | 0.180 |
| T1 | durable | 100% | 100% | 0 | 74.0 | 0.189 |
| T1 | central (in-process supervisor) | 100% | 100% | 0 | 85.9 | 0.225 |

Every run completed, and no workflow spends LLM tokens on coordination (the swarm's takeover makes no
LLM call). T2 validity is below 100% for every workflow, and **all 13 invalid cells are T2 seed 3**:
the checker reports `placed 40/48, hard violations 8, gaps 2` for all four workflows at C0 on that
seed, and at 9 of its 12 chaos cells. It is a property of that instance under the fake LLM, not of
the chaos (the cause is not traced). It is also why `durable-max`, invalid on all four profiles of
seed 3, reads 75% and the others 81%.

### 4.5 Verdicts at the gate

Swarm wins / ties / losses over the six gate points (T1 and T2 at C1, C2, C3), by hypothesis
(PREREG §4):

| Hypothesis | vs durable-max | vs durable | vs central |
|---|---|---|---|
| H1 Preserved work | 0 / 6 / 0 | 3 / 3 / 0 | 6 / 0 / 0 |
| H2 Extra cost (%) | 0 / 6 / 0 | 2 / 4 / 0 | 6 / 0 / 0 |
| H3 Time to recover (s) | 0 / 6 / 0 | 0 / 6 / 0 | 0 / 6 / 0 |
| H4a Dependency time (s) | 3 / 3 / 0 | 5 / 1 / 0 | 6 / 0 / 0 |
| H4b Blast radius (% sessions) | 5 / 1 / 0 | 6 / 0 / 0 | 6 / 0 / 0 |
| H4c Idle agent-seconds | 3 / 3 / 0 | 5 / 1 / 0 | 0 / 2 / 4 |
| H5 Unnecessary reassignments | 0 / 2 / 4 | 0 / 2 / 4 | 0 / 2 / 4 |
| H6 Duplicated spend (points) | 0 / 6 / 0 | 0 / 6 / 0 | 6 / 0 / 0 |
| S Stall time (s), not a hypothesis | 0 / 6 / 0 | 0 / 6 / 0 | 2 / 4 / 0 |

Against `durable-max`, the rival that decides the outcome, the swarm's wins are all in locality: the
blast radius at 5 of 6 points, and cdt and idle agent-seconds at 3 of 6. Everything else is a tie
(H1, H2, H3, H6, stall) except H5, which is a loss at the four points with chaos beyond C1: the
swarm's detector declares live coordinators dead and re-owns their work (§4.8), and the supervisors
have no detector. The whole comparison on T2, as *verdict (swarm / rival)*:

|  | C1 | C2 | C3 |
|---|---|---|---|
| H1 Preserved work | tie (100.00 / 100.00) | tie* (93.75 / 96.88) | tie (90.53 / 94.83) |
| H2 Extra cost (%) | tie* (-3.87 / 1.20) | tie* (-2.23 / 3.88) | tie* (-1.02 / 8.37) |
| H3 Time to recover (s) | tie (4.69 / 5.00) | tie* (5.48 / 5.00) | tie* (5.99 / 5.00) |
| H4a Dependency time (s) | win (0.00 / 5.47) | tie* (7.85 / 19.73) | tie* (12.03 / 32.86) |
| H4b Blast radius (% sessions) | win (0.00 / 25.00) | win (13.89 / 40.28) | win (10.83 / 37.50) |
| H4c Idle agent-seconds | win (0.00 / 6.06) | tie* (10.97 / 29.42) | tie* (17.41 / 36.73) |
| H5 Unnecessary reassignments | tie (0.00 / 0.00) | loss (1.25 / 0.00) | loss (2.25 / 0.00) |
| H6 Duplicated spend (points) | tie (0.00 / 0.00) | tie (0.00 / 0.00) | tie (1.34 / 0.00) |
| S Stall time (s), not a hypothesis | tie* (1.46 / 2.15) | tie* (4.93 / 9.86) | tie* (1.22 / 2.40) |

The other five grids are in Appendix A.

**Locality at the gate**, with the ratios of the seed means (swarm / rival; cdt / blast / idle;
descriptive, no verdict):

| Task | Profile | vs durable-max | vs durable | vs central |
|---|---|---|---|---|
| T1 | C1 | holds: 0.00 / 0.00 / 0.00 | holds: 0.00 / 0.00 / 0.00 | holds: 0.00 / 0.00 / - |
| T1 | C2 | holds: 0.25 / 0.27 / 0.19 | holds: 0.17 / 0.20 / 0.12 | ties: 0.09 / 0.14 / - |
| T1 | C3 | ties: 0.51 / 0.38 / 0.41 | ties: 0.31 / 0.31 / 0.26 | ties: 0.14 / 0.18 / - |
| T2 | C1 | holds: 0.00 / 0.00 / 0.00 | holds: 0.00 / 0.00 / 0.00 | holds: 0.00 / 0.00 / - |
| T2 | C2 | ties: 0.40 / 0.34 / 0.37 | holds: 0.21 / 0.30 / 0.19 | ties: 0.09 / 0.16 / - |
| T2 | C3 | ties: 0.37 / 0.29 / 0.47 | holds: 0.25 / 0.33 / 0.34 | ties: 0.10 / 0.14 / - |

Against `durable-max` locality holds at C1 on both tasks and at T1 C2, and it ties at T1 C3 and at
**T2 C2 and C3**, the two points that decide the outcome (§4.9). At those two points the ratios of
the seed means are all below 0.5, yet the verdict is a tie, because not every seed reaches the
threshold (a seed is a win when the swarm's value is at most half the rival's and the rival's is above
the floor):

| Profile | Metric | Seed 1 | Seed 2 | Seed 3 | Seed 4 |
|---|---|---|---|---|---|
| C2 | cdt | 6.8 / 10.4 = 0.66 (no win) | 8.9 / 23.8 = 0.37 | 8.4 / 24.2 = 0.35 | 7.2 / 20.5 = 0.35 |
| C2 | blast | 11.1 / 22.2 = 0.50 | 16.7 / 44.4 = 0.38 | 16.7 / 50.0 = 0.33 | 11.1 / 44.4 = 0.25 |
| C2 | idle | 13.7 / 17.0 = 0.80 (no win) | 9.8 / 44.4 = 0.22 | 14.4 / 32.2 = 0.45 | 6.0 / 24.0 = 0.25 |
| C3 | cdt | 12.3 / 28.6 = 0.43 | 13.0 / 25.3 = 0.51 (no win) | 16.0 / 31.5 = 0.51 (no win) | 6.9 / 46.0 = 0.15 |
| C3 | blast | 10.0 / 36.7 = 0.27 | 10.0 / 26.7 = 0.38 | 13.3 / 40.0 = 0.33 | 10.0 / 46.7 = 0.21 |
| C3 | idle | 16.9 / 34.3 = 0.49 | 23.0 / 29.9 = 0.77 (no win) | 16.0 / 26.0 = 0.61 (no win) | 13.7 / 56.7 = 0.24 |

*Swarm / durable-max = ratio, per seed, T2.* At C2 seed 1 misses on cdt (0.66) and idle (0.80); at C3
seeds 2 and 3 miss on cdt (0.51 each) and on idle (0.77, 0.61). The blast radius is a win on all four
seeds at both profiles. The rule was fixed before the runs and is applied as written, and no seeds
were added after these readings.

**Cost (H2), seed by seed on T2.** The swarm's extra cost is lower than `durable-max`'s on every seed
at C2 and C3, but by the 5 points H2 needs on only three of the four seeds at each of C2 and C3 (C2
seed 1: 0.36; C3 seed 4: 4.89, which is 0.11 short), so H2 is a tie. In dollars the swarm's C3 run is
cheaper on all four seeds ($0.282–$0.402 against $0.308–$0.424), its scores are equal or higher at
C3, and it preserves less of the work in flight on seeds 2–4. No verdict is attached to the dollars:
the two systems' C0 bases differ (§3).

| Profile | Seed | Swarm extra cost (%) | durable-max extra cost (%) | Difference (points) | Cost, swarm / durable-max ($) | Preserved, swarm / durable-max (%) | Score, swarm / durable-max |
|---|---|---|---|---|---|---|---|
| C2 | 1 | 0.54 | 0.89 | 0.36 | 0.295 / 0.293 | 100 / 100 | 0.833 / 0.889 |
| C2 | 2 | -6.78 | 3.50 | 10.28 | 0.281 / 0.294 | 100 / 100 | 0.760 / 0.720 |
| C2 | 3 | -0.38 | 7.56 | 7.94 | 0.322 / 0.339 | 100 / 94 | 0.818 / 0.818 |
| C2 | 4 | -2.30 | 3.55 | 5.85 | 0.380 / 0.406 | 75 / 94 | 0.826 / 0.870 |
| C3 | 1 | 1.08 | 13.42 | 12.34 | 0.297 / 0.330 | 100 / 96 | 0.833 / 0.833 |
| C3 | 2 | -6.44 | 8.62 | 15.06 | 0.282 / 0.308 | 88 / 96 | 0.760 / 0.720 |
| C3 | 3 | -2.09 | 3.15 | 5.24 | 0.317 / 0.325 | 86 / 92 | 0.818 / 0.818 |
| C3 | 4 | 3.39 | 8.27 | 4.89 | 0.402 / 0.424 | 89 / 96 | 0.870 / 0.826 |

**The central row, and idle agent-seconds (H4c).** Against `central` the swarm wins preserved work,
extra cost, cdt, blast radius and duplicated spend (H1, H2, H4a, H4b, H6) at all six gate points. Next
to those, central's cost is visible in §4.3: 16.8–27.8 calls cancelled per run at C2–C3, $0.063–$0.219
paid twice, an extra cost of 36–67% (H2) and 34–61 points of duplicated spend (H6). Against `central`
the swarm does not win H4c, and loses it at C2 and C3: central's idle agent-seconds is 0.00 in
every run **by construction**, because its workers run inside its process and stop with it, so no
agent is alive and idle while a session waits. That loss makes locality read *ties* rather than
*holds* against `central` at C2 and C3, although the swarm wins cdt and blast on every seed at all
six points. It is a property of how the reference row is built, not a finding about recovery, and so
is its 0% of preserved work (H1).

### 4.6 Sensitivity sweeps ($0)

Does the conclusion hinge on what we grant the rival? Each sweep moves one assumption on T2 at C3 (every
cell has a C0 twin), the swarm against `durable-max` and `durable`, on seeds 1–3. Settings in the
**plausible region** decide the outcome (PREREG §5, fixed before the runs); the symmetric extremes and the
workload sweeps are reported as conditions and decide nothing. Locality of the swarm against
`durable-max`, with the ratios of the seed means (descriptive):

| Sweep | Setting | In the plausible region | Locality (PREREG) | cdt | blast | idle |
|---|---|---|---|---|---|---|
| detection = restart | 0.5 s | no | ties | 0.74 | 0.57 | 0.23 |
| detection = restart | 1 s | yes | ties | 0.95 | 0.78 | 0.84 |
| detection = restart | 2 s | yes | ties | 0.65 | 0.53 | 0.77 |
| detection = restart | 2.5 s | yes | ties | 0.26 | 0.20 | 0.20 |
| detection = restart | 5 s | yes | ties | 0.48 | 0.32 | 0.62 |
| detection = restart | 10 s | yes | ties | 0.35 | 0.22 | 0.36 |
| detection = restart | 20 s | no | holds | 0.33 | 0.29 | 0.39 |
| rival restart, extra | 0 s | yes | ties | 0.48 | 0.32 | 0.62 |
| rival restart, extra | 1 s | yes | holds | 0.28 | 0.24 | 0.31 |
| rival restart, extra | 3 s | yes | holds | 0.19 | 0.22 | 0.21 |
| rival detection (fast external restart) | 0.5 s | yes | fails | 13.20 | 1.43 | 25.32 |
| rival detection (fast external restart) | 1 s | yes | fails | 5.71 | 1.11 | 10.37 |
| agent latency | 0.25x | no | ties | 0.34 | 0.31 | 0.34 |
| agent latency | 0.5x | no | ties | 0.45 | 0.36 | 0.38 |
| agent latency | 1x | no | ties | 0.48 | 0.32 | 0.62 |
| agent latency | 2x | no | holds | 0.23 | 0.21 | 0.19 |
| total agents | 4 | no | ties | 1.44 | 0.93 | 1.32 |
| total agents | 8 | no | ties | 0.94 | 0.86 | 1.03 |
| total agents | 12 | no | ties | 0.48 | 0.32 | 0.62 |
| total agents | 24 | no | ties | 0.50 | 0.33 | 0.46 |
| total agents | 48 | no | ties | 0.54 | 0.46 | 0.53 |

![Locality of the swarm's recovery against each rival, by regime](results/regime.png)

*The regime map: lines are the ratios of the seed means (descriptive), markers the PREREG verdict.*

- **Detection = restart (`recovery_ms`).** Locality ties at every plausible setting (1–10 s) and at
  0.5 s, and holds at 20 s. At 1 s the ratios are 0.95 / 0.78 / 0.84: with that detection time the
  swarm's cdt is about the supervisor's. Short detection also makes the swarm's detector fire on live
  coordinators (§4.8): at 0.5 s there are 24.7 false deaths per run, and H6 is a loss (30.6 points of
  duplicated spend against 0.0).
- **Rival restart (`rival_restart_ms`).** Locality ties at 0 s, the default, and holds at 1 s and 3 s:
  the cdt ratio falls from 0.48 to 0.28 to 0.19 as the supervisor takes longer to come back.
- **Fast external restart (`rival_recovery_ms`, 0.5 and 1 s).** Locality **fails**. The supervisor is
  back after 0.5 or 1 s while the swarm keeps its 5 s detection, so the swarm's cdt is 13.2 and 5.7
  times the supervisor's (13.75 s against 1.04 and 2.41 s). PREREG §5 put this case in the plausible
  region on purpose, and it is the only sweep in which locality fails.
- **Agent latency (`agent_latency_scale`).** Ties at 0.25×–1× and holds at 2×. A workload condition.
- **Width (agents).** Ties at every width. The cdt ratio is 1.44 at 4 agents and 0.94 at 8, so at
  those widths the swarm's cdt is not lower than the supervisor's; from 12 to 48 agents it is 0.48–0.54. A
  workload condition.

Charts of each sweep (six panels along the sweep's axis, T2 at C3):
[`recovery_ms`](results/sweeps/recovery_ms/recovery-t2_conference-recovery_ms.png),
[`recovery_ms` 0.5 s](results/sweeps/recovery_ms_extreme/recovery-t2_conference-recovery_ms.png),
[`rival_restart_ms`](results/sweeps/rival_restart_ms/recovery-t2_conference-rival_restart_ms.png),
[`rival_recovery_ms`](results/sweeps/rival_recovery_ms/recovery-t2_conference-rival_recovery_ms.png),
[`agent_latency_scale`](results/sweeps/agent_latency_scale/recovery-t2_conference-agent_latency_scale.png),
[agents](results/sweeps/agents/recovery-t2_conference-agents.png) and the
[width scaling chart](results/sweeps/agents/scaling-t2_conference.png). The same table against
`durable`, the weaker rival, is in Appendix B.

**Every hypothesis over every point.** Swarm wins / ties / losses over the 27 points (6 gate points and
21 sweep points; `central` is in the gate only, so 6 points):

| Hypothesis | vs durable-max | vs durable | vs central |
|---|---|---|---|
| H1 Preserved work | 0 / 23 / 4 | 11 / 16 / 0 | 6 / 0 / 0 |
| H2 Extra cost (%) | 9 / 18 / 0 | 16 / 11 / 0 | 6 / 0 / 0 |
| H3 Time to recover (s) | 1 / 22 / 4 | 1 / 22 / 4 | 0 / 6 / 0 |
| H4a Dependency time (s) | 8 / 17 / 2 | 19 / 7 / 1 | 6 / 0 / 0 |
| H4b Blast radius (% sessions) | 15 / 12 / 0 | 19 / 8 / 0 | 6 / 0 / 0 |
| H4c Idle agent-seconds | 9 / 16 / 2 | 16 / 9 / 2 | 0 / 2 / 4 |
| H5 Unnecessary reassignments | 0 / 7 / 20 | 0 / 7 / 20 | 0 / 2 / 4 |
| H6 Duplicated spend (points) | 0 / 26 / 1 | 9 / 18 / 0 | 6 / 0 / 0 |
| S Stall time (s), not a hypothesis | 2 / 25 / 0 | 9 / 18 / 0 | 2 / 4 / 0 |

**Where the swarm loses against `durable-max`**, H5 aside (H5 is a loss at 20 of the 27 points, the false
deaths of §4.8):

- **H1, Preserved work:** total agents 4 (73.22 against 91.11); total agents 24 (75.40 against 96.76); detection = restart 1 s (67.65 against 95.70); detection = restart 2 s (80.09 against 97.10).
- **H3, Time to recover (s):** total agents 4 (7.83 against 5.00); detection = restart 20 s (26.78 against 20.00); rival detection (fast external restart) 0.5 s (5.93 against 0.50); rival detection (fast external restart) 1 s (5.93 against 1.00).
- **H4a, Dependency time (s):** rival detection (fast external restart) 0.5 s (13.75 against 1.04); rival detection (fast external restart) 1 s (13.75 against 2.41).
- **H4c, Idle agent-seconds:** rival detection (fast external restart) 0.5 s (18.63 against 0.74); rival detection (fast external restart) 1 s (18.63 against 1.80).
- **H6, Duplicated spend (points):** detection = restart 0.5 s (30.59 against 0.00).

**H2 over the sweeps, and why it does not carry a cost claim.** H2 against `durable-max` is 9 wins at the 21
sweep points and none at the 6 gate points. Seven of the nine use the default swarm cells (the same cells
counted at 1× latency, 12 agents, `recovery_ms` 5 s, `rival_recovery_ms` 0.5 and 1 s, and
`rival_restart_ms` 0 and 1 s), and the other two are 24 agents and `recovery_ms` 2.5 s. Those cells
have seeds 1–3. With the gate's fourth seed the same cells are a tie: at T2 C3 the difference per
seed (durable-max minus swarm, in points of extra cost) is 12.34, 15.06, 5.24 and 4.89 against a
minimum effect of 5. PREREG §7 allows *cheaper* only for an H2 win against the same rival under the
same failures, and the preregistered gate has none.

### 4.7 Per-process view

The main runs give every system the same number of coordinator crashes. If instead every coordinator
*process* fails at the same rate λ, the swarm, with 10 coordinator processes, sees about ten times the
crashes of a supervisor with one. PREREG §6 measures the impact of one crash with a probe (`K-<target>`:
one crash on a named coordinator at half the contracts dispatched, no other fault; T2, seeds 1–4) and
weights it by the number of coordinators at each level of the tree: 1, 3 and 6 for the swarm, 1 for a
supervisor. Impact of one crash, mean over the level's probes and over seeds (no probe was skipped):

| System | Probes | Runs | cdt (s) | Idle agent-s | Time to recover (s) | Blast (% of agents) |
|---|---|---|---|---|---|---|
| swarm, level 0 (x1) | o0 | 4 (0 skipped) | 0.00 | 0.00 | 5.62 | 0.00 |
| swarm, level 1 (x3) | o1, o2, o3 | 12 (0 skipped) | 0.00 | 0.00 | 4.62 | 0.00 |
| swarm, level 2 (x6) | o1.1, o1.2, o2.1, o2.2, o3.1, o3.2 | 24 (0 skipped) | 1.29 | 2.57 | 4.62 | 8.33 |
| swarm, expected per hour (count x mean) |  |  | 7.71 | 15.42 | 47.25 | 50.00 |
| durable-max, one coordinator | o0 | 4 | 8.55 | 17.10 | 5.00 | 50.00 |
| durable, one coordinator | o0 | 4 | 9.13 | 18.25 | 5.00 | 50.00 |
| central, one coordinator | o0 | 4 | 30.00 | 0.00 | 5.00 | 100.00 |

*Expected per hour* is count × mean, since λ drops out of the ratio. The ratio r = swarm / rival of the
expected impacts, with its preregistered reading (r ≤ 0.5 *swarm lower*, r ≥ 2 *rival lower*, between
*comparable*):

| r = swarm / rival | cdt | Idle agent-s | Time to recover | Blast (agents) |
|---|---|---|---|---|
| durable-max | 0.90 (comparable) | 0.90 (comparable) | 9.45 (rival lower) | 1.00 (comparable) |
| durable | 0.84 (comparable) | 0.84 (comparable) | 9.45 (rival lower) | 1.00 (comparable) |
| central | 0.26 (swarm lower) | - (rival lower) | 9.45 (rival lower) | 0.50 (swarm lower) |

Against `durable-max` and `durable` the per-process ratios for cdt, idle agent-seconds and blast radius
are comparable (0.84–1.00): the swarm's ten coordinators fail ten times as often, and each crash holds
up less. The per-crash cdt ratio against `durable-max` on T2 at the gate (0.40 at C2, 0.37 at C3)
becomes 0.90 per process. A crash of the root or of a track coordinator (levels 0 and 1) held up no
session at all in these probes (cdt 0.00), and only crashes of the six session coordinators (level 2)
did (cdt 1.29). On time to recover the supervisor is lower (r = 9.45): the swarm has ten times as many
outages, each of about the same length (4.6–5.6 s against 5.0 s). Against `central` the swarm is lower
on cdt (0.26) and on blast radius (0.50), and central's idle agent-seconds is 0 (§4.5), so there the
rival is lower by construction.

### 4.8 False deaths

A false death is a live coordinator that the swarm's detector declares dead, because its heartbeats were
dropped, delayed or cut off by a partition (§1; PREREG §5). The supervisors have no detector and no bus,
so they have none by construction: an advantage granted to the rival, which stays. Swarm, per run (mean
over the seeds), and the work paid twice because of them:

| Sweep | Setting | Runs | Per run (mean) | Most in one run | Paid twice per run ($) |
|---|---|---|---|---|---|
| gate | T1 C1 | 4 | 0.00 | 0 | 0.0000 |
| gate | T1 C2 | 4 | 1.50 | 2 | 0.0000 |
| gate | T1 C3 | 4 | 1.50 | 3 | 0.0017 |
| gate | T2 C1 | 4 | 0.00 | 0 | 0.0000 |
| gate | T2 C2 | 4 | 1.25 | 2 | 0.0000 |
| gate | T2 C3 | 4 | 2.25 | 4 | 0.0050 |
| detection = restart | 0.5 s | 3 | 24.67 | 28 | 0.0959 |
| detection = restart | 1 s | 3 | 12.67 | 19 | 0.0141 |
| detection = restart | 2 s | 3 | 4.67 | 6 | 0.0319 |
| detection = restart | 2.5 s | 3 | 1.33 | 2 | 0.0007 |
| detection = restart | 5 s | 3 | 2.33 | 4 | 0.0011 |
| detection = restart | 10 s | 3 | 0.33 | 1 | 0.0010 |
| detection = restart | 20 s | 3 | 0.67 | 1 | 0.0046 |
| rival restart, extra | 0 s | 3 | 2.33 | 4 | 0.0011 |
| rival restart, extra | 1 s | 3 | 2.33 | 4 | 0.0011 |
| rival restart, extra | 3 s | 3 | 2.33 | 4 | 0.0011 |
| rival detection (fast external restart) | 0.5 s | 3 | 2.33 | 4 | 0.0011 |
| rival detection (fast external restart) | 1 s | 3 | 2.33 | 4 | 0.0011 |
| agent latency | 0.25x | 3 | 1.67 | 3 | 0.0052 |
| agent latency | 0.5x | 3 | 1.00 | 1 | 0.0032 |
| agent latency | 1x | 3 | 2.33 | 4 | 0.0011 |
| agent latency | 2x | 3 | 2.33 | 3 | 0.0008 |
| total agents | 4 | 3 | 1.00 | 3 | 0.0104 |
| total agents | 8 | 3 | 1.67 | 4 | 0.0014 |
| total agents | 12 | 3 | 2.33 | 4 | 0.0011 |
| total agents | 24 | 3 | 1.67 | 2 | 0.0018 |
| total agents | 48 | 3 | 2.33 | 3 | 0.0006 |

*Runs* is the number of seeds. At the gate false deaths appear from C2: 1.25–1.50 per run at C2 and 1.50
(T1) and 2.25 (T2) at C3. Over the detection time they rise steeply as it shortens: at 0.5 s they cost
$0.0959 per run, about a third of a run's cost (H6, §4.6), and at 2 s $0.0319. They are not monotone
(2.5 s has fewer than 5 s), and with three seeds per point the counts are noisy; the non-monotone steps
are not traced. At every setting that does not touch the swarm (`rival_restart_ms`, `rival_recovery_ms`)
the swarm's cells are the same.

### 4.9 The deciding points and the derived outcome

PREREG §7 derives the outcome mechanically. **Outcome A** needs locality against `durable-max` to hold on
T2 at C2 and C3 of the gate *and* at every point of the plausible region; anything else is **outcome B**.
The tool (`fractalswarm bench verdicts … --prereg`, commit `48601df`) derives **B**. The deciding points,
in PREREG's order, with the ratios of the seed means (descriptive):

| Point (T2, C3 unless a gate row) | Setting | Locality (PREREG) | cdt | blast | idle |
|---|---|---|---|---|---|
| gate | C2 | ties | 0.40 | 0.34 | 0.37 |
| gate | C3 | ties | 0.37 | 0.29 | 0.47 |
| detection = restart | 1 s | ties | 0.95 | 0.78 | 0.84 |
| detection = restart | 2 s | ties | 0.65 | 0.53 | 0.77 |
| detection = restart | 2.5 s | ties | 0.26 | 0.20 | 0.20 |
| detection = restart | 5 s | ties | 0.48 | 0.32 | 0.62 |
| detection = restart | 10 s | ties | 0.35 | 0.22 | 0.36 |
| rival restart, extra | 0 s | ties | 0.48 | 0.32 | 0.62 |
| rival restart, extra | 1 s | holds | 0.28 | 0.24 | 0.31 |
| rival restart, extra | 3 s | holds | 0.19 | 0.22 | 0.21 |
| rival detection (fast external restart) | 0.5 s | fails | 13.20 | 1.43 | 25.32 |
| rival detection (fast external restart) | 1 s | fails | 5.71 | 1.11 | 10.37 |

B is already fixed by the gate: locality ties at T2 C2 and C3 against `durable-max` (§4.5). The ten points
of the plausible region then read: 2 hold (`rival_restart_ms` 1 s and 3 s), 6 tie (`recovery_ms` 1–10 s
and `rival_restart_ms` 0), and 2 fail (`rival_recovery_ms` 0.5 and 1 s). The headline that goes with the
outcome, settled at the decision gate on Oct 29, is at the top of this report.

### 4.10 The real-model matrix

**[PLACEHOLDER]** Results of the paid runs (`bench/matrix.yaml`, `bench/matrix-final.yaml`), and their hero
chart (`results/v1/hero-t2_conference.png`), once they exist. The coordinator makes every real call.

## 5. Reading the chart honestly

This reading covers the $0 runs of §4; the real-model rows are read in §4.10 when they exist.

- **Everyone finishes.** Every run of every workflow completed, at every profile (§4.4). Finishing
  does not separate the systems; what a crash costs while they finish does.
- **Against a supervisor whose workers die with it** (`central`), a crash is expensive: on T2 it
  stalls 16–34 s and pays 14–67% extra, because the restarted coordinator dispatches the lost work
  again (§4.1–4.3). The swarm stalls 1–5 s and its cost is no higher than its own C0. The hero
  chart shows this comparison, which is with an in-process design, not with a durable one.
- **Against an ideal durable supervisor** (`durable-max`: its workers and its own calls survive a
  crash, and it restarts in 5 s), stall time and extra cost tie at all six gate points (§4.1,
  §4.5). On T2 at C2 and C3 the swarm's blast radius is smaller on every seed, and its
  coordinator-dependency time is 2.5–3 times lower on the seed means, but not below half on every
  seed, which is what the preregistered rule asks; so locality ties (§4.9).
- **Where the comparison turns** (§4.6): a slower supervisor restart (1–3 s more) lets locality
  hold; a fast external restart (0.5–1 s detection while the swarm keeps 5 s) makes it fail, at
  6–13 times the supervisor's dependency time. Per process, the two are comparable (§4.7).
- **What having no supervisor costs:** false deaths. The swarm's detector declares live members
  dead (1.25–2.25 per run at C2–C3 with the default 5 s detection; more, and not monotonically,
  at shorter detection), and each costs a reassignment; the supervisors have none (§4.8).
- **Seed variance:** T2 seed 3 is invalid for every workflow, C0 included, a property of that
  instance under the fake LLM (§4.4); three T1 runs carry the swarm's stall (§4.1). With four
  seeds one outlier moves a mean, which is why every verdict is taken per seed.

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
- **Unpaired API fault draws (known; not changed in this phase).** API faults are drawn from a key made
  of the effect id and the attempt number (`llm/transport.py`), and effect ids differ between
  workflows, so every workflow gets the same fault seed and rate but not the same faults on the same
  calls. At C3 (20% API faults) about 1.5% of attempts draw the 503 overload with a 60 s Retry-After.
  T1 C3 seed 3 is the example: the swarm's root planner call took 64.0 s (two attempts) where
  `durable-max`, `durable` and `central` took 3.9 s on the same call, which shifts everything after
  it, and the swarm's makespan was 199.7 s against 96.0 s for `durable-max` (`central` 148.5 s,
  `durable` 151.7 s). This noise pushes verdicts toward ties, for both sides: a delay that one system
  drew and its rival did not can fall either way, and the rule that every seed must agree turns a
  one-seed difference into a tie.
- **The sweeps have three seeds and the gate four.** The same default cells read differently in the two
  (§3), and the nine H2 wins of the sweeps are three-seed readings that the fourth seed turns into
  ties (§4.6). The sweeps run on T2 only; the task axis is read off the gate.
- **Some numbers are inputs, not measurements.** The supervisors' time to recover is their configured
  restart delay, and H3 compares it with the swarm's measured takeover; `central`'s idle agent-seconds
  and preserved work are 0 by construction (§4.5); and the supervisors have no false deaths because
  they have no detector (§1).
- **Extra cost has different bases.** It is measured against each system's own C0, and on T2 the swarm's
  C0 is a little dearer than the others' (§3, §4.2).
- **Crash times are not swept.** They are fixed at 20/35/50/65/80% of the contracts dispatched, and the
  per-process probes crash one coordinator, once, at 50%. A different time, or two crashes, may give
  different impacts, and r is a ratio of means over four seeds (§4.7). No crash-time jitter sweep
  was run in this phase (it is not in PREREG §5).
- **T2 seed 3 is invalid at C0** for every workflow under the fake LLM (§4.4), so every T2 validity figure
  carries it.

## 7. Reproduce

```sh
uv run fractalswarm bench bench/matrix.yaml --dry-run      # cells + worst-case cost
uv run fractalswarm bench bench/matrix.yaml --confirm-real-spend
uv run fractalswarm replay bench/results/v1/runs/<cell> --verify
```

The $0 runs of §4 (fake LLM, simulated clock) need no key. Point `FRACTALSWARM_RUNS_DIR` and
`FRACTALSWARM_LEDGER_PATH` at scratch paths first, so that the shared runs and ledger stay untouched:

```sh
uv run fractalswarm bench bench/matrix-rivals-gate.yaml --fake      # 128 cells, about 4 min
uv run fractalswarm bench bench/matrix-sweep-recovery.yaml --fake   # the other matrix-sweep-*.yaml and
                                                                    # matrix-per-process-*.yaml likewise
uv run fractalswarm bench verdicts bench/results/rivals-gate bench/results/sweeps --prereg \
    --json bench/results/honesty.json    # the verdicts, the regime map and the derived outcome
uv run fractalswarm bench rescore bench/results/rivals-gate         # metrics again from the logs, $0
uv run fractalswarm recovery <run_dir>                              # a run's table per crash and its checks
uv run fractalswarm bench tables --check bench/REPORT.md            # every table of this file is the results'
```

The tables of §3, §4 and the appendices are laid out from `bench/results/honesty.json` and
`bench/results/rivals-gate/results.json` by `fractalswarm bench tables` (`bench/tables.py`); the
prose around them is written by hand. `--check` names any table that is not in this file word for
word, and `tests/unit/test_report_tables.py` runs the same check, so a number cannot drift from the
files without the test failing.

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

## Appendix A. The gate, every comparison

Each cell reads *verdict (swarm / rival)*: win, tie or loss is the swarm's by the rules of
`bench/PREREG.md`, `*` marks a tie in which the seeds disagree, and the two numbers are the means
over seeds 1–4 of the swarm and of the rival. §4.5 has T2 against `durable-max`.

### A.1 T1 against `durable-max`

|  | C1 | C2 | C3 |
|---|---|---|---|
| H1 Preserved work | tie (100.00 / 100.00) | tie (100.00 / 100.00) | tie* (94.10 / 100.00) |
| H2 Extra cost (%) | tie (0.68 / 0.82) | tie (2.31 / 2.89) | tie* (5.66 / 3.04) |
| H3 Time to recover (s) | tie* (4.94 / 5.00) | tie (5.33 / 5.00) | tie* (5.89 / 5.00) |
| H4a Dependency time (s) | win (0.00 / 10.47) | win (7.82 / 30.90) | tie* (19.04 / 37.53) |
| H4b Blast radius (% sessions) | win (0.00 / 54.17) | win (13.89 / 51.39) | tie* (16.67 / 43.33) |
| H4c Idle agent-seconds | win (0.00 / 17.30) | win (11.26 / 60.07) | tie* (19.79 / 47.81) |
| H5 Unnecessary reassignments | tie (0.00 / 0.00) | loss (1.50 / 0.00) | loss (1.50 / 0.00) |
| H6 Duplicated spend (points) | tie (0.00 / 0.00) | tie (0.00 / 0.00) | tie (0.94 / 0.00) |
| S Stall time (s), not a hypothesis | tie* (5.77 / 0.00) | tie* (1.26 / 6.25) | tie* (14.83 / 0.48) |

### A.2 T2 against `durable`

|  | C1 | C2 | C3 |
|---|---|---|---|
| H1 Preserved work | win (100.00 / 66.67) | tie* (93.75 / 66.38) | tie* (90.53 / 68.86) |
| H2 Extra cost (%) | tie* (-3.87 / 5.16) | win (-2.23 / 13.11) | win (-1.02 / 12.99) |
| H3 Time to recover (s) | tie (4.69 / 5.00) | tie* (5.48 / 5.00) | tie* (5.99 / 5.00) |
| H4a Dependency time (s) | win (0.00 / 12.10) | win (7.85 / 37.58) | win (12.03 / 48.83) |
| H4b Blast radius (% sessions) | win (0.00 / 37.50) | win (13.89 / 45.83) | win (10.83 / 32.50) |
| H4c Idle agent-seconds | win (0.00 / 16.06) | tie* (10.97 / 58.99) | win (17.41 / 50.56) |
| H5 Unnecessary reassignments | tie (0.00 / 0.00) | loss (1.25 / 0.00) | loss (2.25 / 0.00) |
| H6 Duplicated spend (points) | tie* (0.00 / 3.85) | tie* (0.00 / 7.84) | tie* (1.34 / 8.21) |
| S Stall time (s), not a hypothesis | tie* (1.46 / 2.52) | tie* (4.93 / 1.35) | tie* (1.22 / 13.82) |

### A.3 T1 against `durable`

|  | C1 | C2 | C3 |
|---|---|---|---|
| H1 Preserved work | win (100.00 / 63.33) | win (100.00 / 67.33) | tie* (94.10 / 74.43) |
| H2 Extra cost (%) | tie (0.68 / 3.44) | tie* (2.31 / 9.92) | tie* (5.66 / 12.46) |
| H3 Time to recover (s) | tie* (4.94 / 5.00) | tie (5.33 / 5.00) | tie* (5.89 / 5.00) |
| H4a Dependency time (s) | win (0.00 / 15.00) | win (7.82 / 47.34) | tie* (19.04 / 60.61) |
| H4b Blast radius (% sessions) | win (0.00 / 66.67) | win (13.89 / 69.44) | win (16.67 / 53.33) |
| H4c Idle agent-seconds | win (0.00 / 26.24) | win (11.26 / 93.63) | win (19.79 / 75.88) |
| H5 Unnecessary reassignments | tie (0.00 / 0.00) | loss (1.50 / 0.00) | loss (1.50 / 0.00) |
| H6 Duplicated spend (points) | tie (0.00 / 2.59) | tie* (0.00 / 6.89) | tie* (0.94 / 9.37) |
| S Stall time (s), not a hypothesis | tie* (5.77 / 0.92) | tie (1.26 / 1.42) | tie* (14.83 / 20.90) |

### A.4 T2 against `central`

|  | C1 | C2 | C3 |
|---|---|---|---|
| H1 Preserved work | win (100.00 / 0.00) | win (93.75 / 0.00) | win (90.53 / 0.00) |
| H2 Extra cost (%) | win (-3.87 / 13.82) | win (-2.23 / 46.98) | win (-1.02 / 66.65) |
| H3 Time to recover (s) | tie (4.69 / 5.00) | tie* (5.48 / 5.00) | tie* (5.99 / 5.00) |
| H4a Dependency time (s) | win (0.00 / 28.75) | win (7.85 / 83.75) | win (12.03 / 118.75) |
| H4b Blast radius (% sessions) | win (0.00 / 91.67) | win (13.89 / 88.89) | win (10.83 / 75.00) |
| H4c Idle agent-seconds | tie (0.00 / 0.00) | loss (10.97 / 0.00) | loss (17.41 / 0.00) |
| H5 Unnecessary reassignments | tie (0.00 / 0.00) | loss (1.25 / 0.00) | loss (2.25 / 0.25) |
| H6 Duplicated spend (points) | win (0.00 / 10.96) | win (0.00 / 44.60) | win (1.34 / 59.66) |
| S Stall time (s), not a hypothesis | tie* (1.46 / 16.03) | tie* (4.93 / 30.64) | win (1.22 / 34.27) |

### A.5 T1 against `central`

|  | C1 | C2 | C3 |
|---|---|---|---|
| H1 Preserved work | win (100.00 / 0.00) | win (100.00 / 0.00) | win (94.10 / 0.00) |
| H2 Extra cost (%) | win (0.68 / 8.21) | win (2.31 / 35.99) | win (5.66 / 65.63) |
| H3 Time to recover (s) | tie* (4.94 / 5.00) | tie (5.33 / 5.00) | tie* (5.89 / 5.00) |
| H4a Dependency time (s) | win (0.00 / 30.00) | win (7.82 / 90.00) | win (19.04 / 138.75) |
| H4b Blast radius (% sessions) | win (0.00 / 100.00) | win (13.89 / 100.00) | win (16.67 / 92.50) |
| H4c Idle agent-seconds | tie (0.00 / 0.00) | loss (11.26 / 0.00) | loss (19.79 / 0.00) |
| H5 Unnecessary reassignments | tie (0.00 / 0.00) | loss (1.50 / 0.00) | loss (1.50 / 0.00) |
| H6 Duplicated spend (points) | win (0.00 / 7.41) | win (0.00 / 33.52) | win (0.94 / 60.93) |
| S Stall time (s), not a hypothesis | tie* (5.77 / 11.24) | win (1.26 / 15.99) | tie* (14.83 / 37.05) |

## Appendix B. The sweeps against `durable`

Locality of the swarm against `durable`, the weaker rival, T2 at C3, seeds 1–3, with the ratios of the
seed means (descriptive). The outcome is decided against `durable-max` (§4.9). Locality holds at 13 of
the 21 sweep points and at the gate on T2 (C1, C2, C3); it ties at `recovery_ms` 0.5–2.5 s, at 4 and 8
agents and at `rival_recovery_ms` 1 s, and fails at `rival_recovery_ms` 0.5 s (cdt ratio 4.58).

| Sweep | Setting | In the plausible region | Locality (PREREG) | cdt | blast | idle |
|---|---|---|---|---|---|---|
| detection = restart | 0.5 s | no | ties | 0.26 | 0.33 | 0.08 |
| detection = restart | 1 s | yes | ties | 0.28 | 0.39 | 0.23 |
| detection = restart | 2 s | yes | ties | 0.30 | 0.36 | 0.34 |
| detection = restart | 2.5 s | yes | ties | 0.14 | 0.20 | 0.12 |
| detection = restart | 5 s | yes | holds | 0.28 | 0.36 | 0.40 |
| detection = restart | 10 s | yes | holds | 0.29 | 0.26 | 0.37 |
| detection = restart | 20 s | no | holds | 0.36 | 0.35 | 0.48 |
| rival restart, extra | 0 s | yes | holds | 0.28 | 0.36 | 0.40 |
| rival restart, extra | 1 s | yes | holds | 0.21 | 0.27 | 0.30 |
| rival restart, extra | 3 s | yes | holds | 0.18 | 0.29 | 0.28 |
| rival detection (fast external restart) | 0.5 s | yes | fails | 4.58 | 0.83 | 9.32 |
| rival detection (fast external restart) | 1 s | yes | ties | 1.70 | 0.56 | 2.85 |
| agent latency | 0.25x | no | holds | 0.26 | 0.32 | 0.33 |
| agent latency | 0.5x | no | holds | 0.29 | 0.33 | 0.25 |
| agent latency | 1x | no | holds | 0.28 | 0.36 | 0.40 |
| agent latency | 2x | no | holds | 0.24 | 0.27 | 0.24 |
| total agents | 4 | no | ties | 0.80 | 0.87 | 1.12 |
| total agents | 8 | no | ties | 0.52 | 0.69 | 0.71 |
| total agents | 12 | no | holds | 0.28 | 0.36 | 0.40 |
| total agents | 24 | no | holds | 0.33 | 0.30 | 0.34 |
| total agents | 48 | no | holds | 0.32 | 0.36 | 0.42 |
