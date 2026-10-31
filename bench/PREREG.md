# Pre-registration: swarm against durable supervisors

Written before any gate run (arena spec §C.3, backend-design §3). It fixes what is measured, what
counts as a difference, what each hypothesis predicts, and how the two outcomes of the decision
gate are chosen. `fractalswarm bench verdicts OUT... --prereg` applies these rules mechanically
(`src/fractalswarm/bench/verdicts.py`) and prints the SHA of this file next to its verdicts.

After the first gate run this file changes only by an appended, dated amendment that says what
changed and why; the rules above it stay as they were. The fairness rules of arena spec §A are
never revisited to rescue a result.

## 1. What is compared

The subject is `swarm`. Its rivals are `durable-max` (workers survive; the coordinator's own plan
and judge calls survive), `durable` (workers survive; its own calls in flight are lost) and
`central` (today's in-process supervisor: a crash stops the workers). `single` and `pipeline` are
secondary rows and take part in no verdict. Every comparison is **swarm against one rival**, at
one regime point: a task, a chaos profile, and the sweep settings.

The replicates are the seeds. A seed fixes the task instance and the chaos plan for every
workflow, so the swarm's run and the rival's run of one seed are a pair. The gate has seeds 1–4;
a sweep has seeds 1–3.

## 2. Metrics and their readings

All of them are functions of the recorded log (`bench/scoring.py`, `bench/recovery.py`), with the
same rule for a swarm log and a supervisor log. A run's value of a per-crash metric is its mean
over the run's crashes; the figures that are sums are per run.

| Key | Metric | Better |
|---|---|---|
| `stall_s` | stall time | lower |
| `extra_cost_pct` | extra cost against the same cell at C0 | lower |
| `ttr_own_mean_s` | time to recover: the outage window, crash to the heir or the restart | lower |
| `ttr_drain_mean_s` | time to recover, to the release of the work the outage held up (reported, no verdict) | lower |
| `cdt_s` | coordinator-dependency time, contract-seconds | lower |
| `blast_sessions_mean_pct` | share of sessions held up by a crash | lower |
| `blast_agents_mean_pct` | share of agents held up by a crash (reported next to the sessions) | lower |
| `idle_agent_s` | idle agent-seconds, **session reading** (see below) | lower |
| `unnecessary_reassignments` | lost re-dispatches of live or finished work, plus false-death remaps | lower |
| `dup_chaos_pct` | work paid twice because a coordinator died or was wrongly declared dead (`dup_crash_usd + dup_false_death_usd`), as points of the cell's C0 cost | lower |
| `preserved_pct` | calls in flight at a crash that were completed and used | higher |

**Idle agent-seconds** has three readings that bracket each other. The **session reading** is the
primary one and the only one that carries a verdict: an agent counts while it is alive, holds no
dispatched attempt, and a session it serves has work waiting for a down coordinator. The **own**
reading (a lower bound) counts only the agents named by a waiting item; the **wide** reading (an
upper bound) counts every alive agent that belongs to the crashed coordinator. All three are
reported in the tables.

`dup_agent_kill` and `dup_other` duplicates are reported but carry no verdict: the same agents die
at the same points in every workflow, and retries after a rejected verdict are not a failure
effect. Exposure (the most sessions one coordinator owns) is reported, no verdict.

## 3. What counts as a difference

A result is a **tie** unless every seed agrees and the difference reaches the minimum effect.

For one seed, let `a` be the swarm's value and `b` the rival's.

**Difference rule.** For a metric where lower is better the seed is a *win* if `b − a ≥ δ`, a
*loss* if `a − b ≥ δ`, and a tie otherwise (the signs flip where higher is better).

| Metric | δ |
|---|---|
| `stall_s` | 3 s |
| `extra_cost_pct` | 5 points |
| `ttr_own_mean_s` | 1 s |
| `dup_chaos_pct` | 5 points |
| `unnecessary_reassignments` | 1 |
| `preserved_pct` | 10 points |

**Ratio rule.** The seed is a *win* if `a ≤ 0.5·b` and `b ≥ floor`, a *loss* if `b ≤ 0.5·a` and
`a ≥ floor`, and a tie otherwise. The floor keeps two near-zero values from counting as a ratio.

| Metric | Floor |
|---|---|
| `cdt_s` | 1 contract-second |
| `blast_sessions_mean_pct`, `blast_agents_mean_pct` | 5 points |
| `idle_agent_s` | 1 agent-second |

**A comparison's verdict over its seeds:** *win* if every seed is a win, *loss* if every seed is a
loss, *tie* otherwise (a mixed comparison is a tie and is marked mixed). A seed in which either run
has no value for the metric (it logged no crash, nothing was at risk, or it has no C0 twin to
measure against) is left out, and a comparison with no seed left is *n/a*. A comparison in which either run did not complete is *incomplete* and
counts as neither. No run is dropped for any other reason.

## 4. Hypotheses

The spec's H1–H3 refined into backend-design's H1–H6. Each is evaluated for the swarm against each
rival, at C1, C2 and C3 of the gate on both tasks, and at C3 in every sweep. The expectation is
what the design predicts; the verdict is whatever the data says.

| # | Hypothesis | Metric | Expected |
|---|---|---|---|
| H1 | Preserved work | `preserved_pct` | durable-max ≥ swarm ≈ durable ≫ central |
| H2 | Extra cost | `extra_cost_pct` | swarm and durable-max tie |
| H3 | Time to recover | `ttr_own_mean_s` | the supervisor wins or ties (5 s against the swarm's 5–7 s) |
| H4 | Locality | `cdt_s`, `blast_sessions_mean_pct`, `idle_agent_s` | swarm ≤ 0.5 × durable-max |
| H5 | Unnecessary reassignments | `unnecessary_reassignments` | durable ≈ 0; the swarm's are its false deaths |
| H6 | Duplicated spend | `dup_chaos_pct` | durable-max = 0 ≤ swarm |

**H4 is the spec's H2** ("only the dead orchestrator's subtree waits"). It is read as three
comparisons: H4a on `cdt_s`, H4b on `blast_sessions_mean_pct`, H4c on `idle_agent_s`.
**Locality holds** at a regime point when H4a and H4b are wins and H4c is not a loss. It **fails**
when H4a or H4b is a loss. Otherwise it **ties**. `stall_s` is reported with the hypotheses but is
not one of them.

The spec's H3 ("the gap grows with failure count, detection latency and coordination density, and
shrinks with fast detection, up-front dispatch and the per-process model") is read off the
sweeps of §5 and the per-process view of §6, not tested as a single number.

## 5. The sweeps and the plausible region

All sweeps run at $0 with the calibrated fake LLM on the sim clock, at C3 (each cell has its C0
twin), swarm against `durable-max` and `durable` (the `central` row is in the gate).

**The fault profile.** C3 is one plan for every workflow: five coordinator crashes at 20, 35, 50,
65 and 80% of the contracts dispatched; half of the agents killed; 20% API faults; and one 8 s
partition. On the swarm's bus, which only the swarm has, 20% of the frames are dropped, 10%
duplicated, 20% delayed by 200–1500 ms and 10% reordered by 20–200 ms.

**An asymmetry that favours the rival, and stays.** The swarm learns that a coordinator is dead
from heartbeats that cross that bus, and declares it dead after five missed beats: `recovery_ms`
is that time, so the beat comes every `recovery_ms / 5`. Under C3 a live member's beats are
dropped, delayed or cut off by the partition, so at the short settings the swarm's detector can
declare a live coordinator dead (a false death: its work is re-owned and the duplicate is paid
for). That is counted in `unnecessary_reassignments` and `dup_false_death_usd`, and the swarm
bears it. The simulated supervisors have no detector and no bus: they are told when their process
died and are back `recovery_ms` (plus `rival_restart_ms`) later, so they never see a false death.
It is an advantage granted to the rival; it is not removed to improve the swarm's numbers.

| Sweep | Settings | Rival assumption it checks |
|---|---|---|
| `recovery_ms` | 0.5, 1, 2, 2.5, 5, 10, 20 s, the same for the swarm's detection and the supervisor's restart | failure detection |
| `rival_restart_ms` | 0, 1, 3 s on top of the 5 s detection, the swarm unchanged | restart or failover time |
| `rival_recovery_ms` | 0.5, 1 s for the supervisors while the swarm keeps 5 s | a fast external restart (asymmetric detection) |
| `agent_latency_scale` | 0.25, 0.5, 1, 2 on the agents' latency | coordination density |
| `agents` | 4, 8, 12, 24, 48 | width |
| task | T1 and T2 | where it helps (read off the gate) |

**The plausible region** is the part of the rival's assumptions a real deployment could have. It is
fixed here, before any result: `recovery_ms` ∈ {1, 2, 2.5, 5, 10} s; `rival_restart_ms` ∈ {0, 1, 3} s;
and `rival_recovery_ms` ∈ {0.5, 1} s (arena spec §A: a process manager that sees an exit at once
can bring a hot standby up in half a second, and leaving that case out would tilt the outcome
toward A). The symmetric extremes (`recovery_ms` 0.5 s and 20 s) and the workload sweeps
(`agent_latency_scale`, `agents`, the task) are reported in the regime map as conditions; they do
not decide the outcome.

## 6. The failure models

**Per crash** is the main view: every system loses the same number of coordinators at the same
progress points (C1, C2, C3 = 1, 3, 5), and the tables above are per crash.

**Per process** asks what happens when every coordinator *process* fails at the same rate λ, so
the swarm, which runs 10 coordinators, sees about ten times the crashes of a supervisor, which
runs one. The impact of one crash is measured with a probe: `K-<target>`, one coordinator crash
on a named actor at half the contracts dispatched, no other fault (T2, seeds 1–4).

| System | Probes | Count at that level |
|---|---|---|
| swarm, level 0 | `K-o0` | 1 |
| swarm, level 1 | `K-o1`, `K-o2`, `K-o3` | 3 |
| swarm, level 2 | `K-o1.1`, `K-o1.2`, `K-o2.1`, `K-o2.2`, `K-o3.1`, `K-o3.2` | 6 |
| each supervisor | `K-o0` | 1 |

For an impact `m` (`cdt_s`, `idle_agent_s`, `ttr_own_mean_s`, `blast_agents_mean_pct`), let `m_L` be
its mean over the probes of level `L` and over the seeds. The expected impact per hour of work at
rate λ is `λ · (m_0 + 3·m_1 + 6·m_2)` for the swarm and `λ · m_o0` for a supervisor, so
**the ratio of the two does not depend on λ**:

    r = (m_0 + 3·m_1 + 6·m_2) / m_o0(rival)

`r ≤ 0.5` means the swarm still has the lower expected impact per hour under this model, `r ≥ 2`
that the supervisor has, and anything between is comparable. A probe that finds no coordinator to
crash (the target has finished, so no crash is logged) is left out and counted. The per-process
ratio is reported next to the per-crash results whatever it shows, and every claim built on the
locality names the failure model it holds in.

## 7. The decision rules (spec §C.4)

**Outcome A**: locality holds against `durable-max` on T2 at C2 and at C3 of the gate (the default
assumptions), *and* at every point of the plausible region of §5. The headline is "recovery stays
local to the affected subtree", with the cost tie stated plainly and the conditions in which the
gap shrinks named: the regime points where locality ties or fails, and the per-process ratio.

**Outcome B**: anything else. The headline becomes "resilience comparable to an ideal durable
supervisor, without a central coordinator or a separate recovery mechanism", and the conditions
in which A would hold, if any, are named.

A result that holds only at one setting of the rival's assumptions is reported with that
condition, never as a general claim. The tool prints the outcome it derives and the points that
decide it; the headline sentence is the coordinator's and Yoel's call at the decision gate
(`docs/claims.md` lists what each outcome allows). "Cheaper" is claimed only if H2 is a win
against the same rival under the same failures; "no supervisor needed" is not "simpler", "cheaper"
or "more reliable".

## 8. What is reported

Every comparison of §4, for every rival and every regime point, including the losses and the ties,
in `honesty.json` and in the printed tables. The regime map shows every sweep point, plausible or
not. Nothing is tuned to make the swarm win, no test asserts that it does, and a result that
contradicts the design's expectation is printed as plainly as one that confirms it.

## 9. Amendments

2026-10-29, before the first gate run, so in place: the plausible region of §5 gained
`rival_recovery_ms` 0.5 s, and §5 now states the fault profile of the sweeps and the asymmetry in
the failure detector. Both came from the coordinator's review.

2026-10-31, appended before any of these runs (Yoel's decision 4 of that day, with a strict limit
of $5 on top of what had been spent): **the real rows of a track lead's death.** None of the 86 real
crashes of the bench hit a track lead, so what §6 says of level 1 rests on the fake model alone. The
rules above stay as they were, and no verdict of §7 reads these rows.

- *Cells.* `bench/matrix-midlevel-swarm.yaml`: the probes `K-o1@0.04`, `K-o2@0.04` and `K-o3` (at
  0.5) on seeds 1 and 2, 6 cells. `bench/matrix-midlevel-rival.yaml`: `durable-max` at `K-o0@0.04`
  and `K-o0` on the same seeds, 4 cells. 10 paid cells, each capped at $0.50, so the worst case is
  $5.00. The C0 twins are the cell files of `results/headline`, copied in and not run again. A
  probe that finds nothing to crash is counted as skipped and is not replaced. A failed cell is
  reported as failed and is not run again.
- *Conditions.* Those of `matrix-headline.yaml`: T2, Contributor routing, detection 5 s, the run
  cap, the same fixtures. `any_survivor` stays off. The code is the frozen handlers plus changes
  that are off in these runs.
- *Why these points.* `at` 0.04 is the first contract dispatched. In the real C0 logs o2 on seed 1
  and o1 on seed 2 still have their plan call in flight at that point, which is the swarm's worst
  moment on the fake model. `K-o1@0.04` on seed 1 and `K-o2@0.04` on seed 2 are the same point
  with no plan in flight. `K-o3` is the point of §6. The points were read from C0 logs only.
- *The reading.* For each crash, from the log: the time to recover, the cdt by branch of the task
  (a branch is the first part of a goal's id), the contracts verified in each branch while the
  outage lasts, the goals remapped, `fractalswarm takeover`, and `replay --verify`; and for the
  whole run, the span and the cost against its C0 twin, whose real latencies differ, so those two
  are reported and not judged.
- *What would refute the isolation.* In any swarm cell with a crash: cdt above 0 in a branch the
  dead lead did not own; a goal remapped outside the branch it owned; the takeover check or the
  replay failing. One such cell is enough, and it is reported as a refutation.
- *What the rows cannot say.* Two seeds and six crashes support no hypothesis of §4 and no ratio
  of §6. Whether the swarm's worst case beats the rival's on one seed is reported and not judged.
