# Backend design for Phase 2: durable rivals, recovery metrics, real input, launch API and Meta visibility

- **Origin:** a read-only design review of `Yoelcanarion/day-09-integration` (c14231c), done on Oct 28 during the Phase 2 interview. No code was changed or run.
- **Line numbers** refer to `actors/orchestrator.py` on that branch. They match `arena` once Phase 0 has merged it.
- **Names** follow `.plans/arena-spec.md`:
  - the realistic rival is `durable` (the review called it `durable-real`);
  - the ruling event is `arbitration.ruled`.
- **Workers:** the review's five backend workstreams (A–E) map onto W1–W3:
  - **W1 `rival`:** A (rivals) and B (metrics);
  - **W2 `intake`:** C (input) and D (launch API);
  - **W3 `meta`:** E (Meta visibility).

This document is the shared reference. The worker briefs say which sections each worker owns.

---

## 0. Findings that shape the design
- **New fields break old replays.** `validate_payload` (`kernel/events.py`) writes default values into the log.
  - Adding even a defaulted field to an existing payload model changes new events, and breaks the replay of old runs.
  - **Rule:** new facts go into **new event types**, and new behaviour is gated by **new modes or parameters** that old logs don't have.
  - `RunMetrics` is never logged, so it can grow freely.
- **Handlers can't see in-flight effects.** `View` has no list of them, so durable recovery needs a reducer.
- **`kill-half` doesn't port to central.** Its explicit targets (`o2.1`, `o1`, …) are skipped there, because `_act` only accepts candidates. Arena plans must target `o0` or let the targeting rule pick.
- **The sim clock with the real backend.** `_drive_sim` waits for every newly started call before completing the next one. It is slow in wall time, but it cannot produce load-induced false deaths. That makes it the arena's fallback.

---

## 1. Durable supervisors: `durable-max` and `durable` (W1)

### Modes
- Add `DURABLE_MODES` and append both modes to `CENTRAL_MODES`. That alone gives them signal crashes (`swarm.py` boot) and the `member.joined` of o0 in `_central_step`.
- `_squad` (~365): the durable modes split squads the way central does.
- `BenchWorkflow.scalable`: include both modes.
- `orchestrator_init`: read `restart_ms` from args, defaulting to `RESTART_DELAY_MS`.

### Registering central goals
- In the central branch of `_assign_children` (~516), the durable modes emit a **new** event, `goal.opened{goal_id, owner, parent, level, goal}`, before `_start_goal`.
- `TreeView.apply` (`coord/tree.py`) registers it the same way it registers an `assign`.
- Log reuse then works, **in the durable modes only**:
  - `_logged`;
  - the judge reuse in `_judge` (~786);
  - the booking reuse in `_accept` (~1019);
  - the tick `_pull`, which adopts results.

  Central logs never contain `goal.opened`, so they replay unchanged.

### New reducer `OwnEffectsView` (new `baselines/durable.py`)
- `SwarmScenario.reducers()` installs it for the durable modes only.
- It maps `effect_id → (actor, tag)` for the `plan|`, `judge|` and `scan|` tags.
- It answers `in_flight(actor, tag)` and `completion(actor, tag)`. A completion comes back as the stored `effect.completed` Event, so `_planned` and `_scanned` take it unchanged.

### Crash, restart and recovery
- **`_crash` (~1440), durable branch:**
  - emits `baseline.crashed` with the same schema: `lost=[]` for `durable-max`, and the cancelled own tags for `durable`;
  - `durable` only: `Cancel` on its own `plan|`, `judge|` and `scan|` tags;
  - never stops agents, so `crashed_agents` stays empty and `_restart` needs no change.
- **`_redo` (~1483), durable branch → a new `_recover`.** It walks the goals in sorted order:
  - **planning or scanning:** adopt the logged completion. If there is none and the call is still in flight, wait (`durable-max`); otherwise re-issue it (`durable`);
  - **contract running:** adopt the logged result via `_contract_result`. If the agent is alive, keep waiting; **this is the key difference from central**. If the agent is dead, `_retry(..., "lost")`;
  - **judging:** `_judge` reuses `TreeView.judged`. If the judge call is still in flight under `durable-max`, wait;
  - **booking:** `_accept`;
  - then it emits a **new** `supervisor.adopted{results, verdicts, plans, bookings, waiting}`, then `baseline.restarted{redo}`, and handles `pending_crashes`.

### While o0 is down
- **What reaches o0:** deliveries still arrive (o0 is never stopped), but `_central_step` drops them.
- **What stays in the log:** the agents' `contract.result` and the board's `book.result` are `msg.sent` events, and `TreeView` records them. Timers keep firing.
- **The workers** finish their in-flight contracts, then go idle, because dispatch, judging and booking need o0.
- **o0's in-memory state** survives, which amounts to a free, perfect checkpoint. **Keep that advantage, for fairness.** Only what arrived while o0 was down is read from the log.

### What each variant loses
- **`durable`:** its own in-flight plan and judge calls. They are billed, then re-issued at the restart, which matches the swarm's killed orchestrator.
- **`durable-max`:** nothing, except the 5 s absence.

### Wiring
- `swarm.py`: two new scenarios.
- `runs.py`: add them to `SCENARIOS`.
- `bench/workflows.py`: register both.
- `cli.py`: add them to `--scenario`.

### Sweep knobs
They are passed only when set, so the default runs are unchanged.
- `params.recovery_ms`: sets `restart_ms` for the supervisors and the Detector's `dead_after` for the swarm (symmetric detection).
- The asymmetric "fast external restart" case and the restart-time sweep (spec §C.2) need the supervisors' delay separately: `rival_recovery_ms` overrides `restart_ms` for the supervisors only.
- **Check the Detector:** it must support sub-second `dead_after`, with a heartbeat interval scaled to match (`coord/membership.py`).

---

## 2. Metrics (W1): new `bench/recovery.py`, wired into `score_run`

### The outage window of each crash
- **Swarm:** from the kill (`chaos.injected` plus `actor.stopped`) to the last `ownership.remapped{previous: victim}` among the goals the victim owned, using `TreeView` folded up to the kill. Partitions that end in `member.dead` count too.
- **Supervisors:** from `baseline.crashed` to `baseline.restarted`.

### Definitions
- **Time to recover:**
  - `TTR_own`: the window's length;
  - `TTR_drain`: the end of the last blocked interval that the crash caused.
- **Coordinator-dependency time (CDT).** For each contract attempt, the time spent waiting for a coordinator:
  - result sent → `contract.completed`;
  - judge completion → `verify.judged`;
  - `book.result` → `contract.verified` or `contract.rejected`;
  - plan completion → the `plan.*` event;
  - ready (dependencies verified, or work lost at `actor.stopped` or `effect.cancelled`) → `contract.dispatched`;
  - a lost own call → its re-issue.

  CDT is the sum of these intervals' overlap with the outage windows of the work's owner, in contract-seconds.
  - Report `blocked_total` too: it shows the structural waiting of `single` and `pipeline`.
  - In sim, CDT is about 0 at C0.
- **Blast radius:** the sessions and agents blocked during a crash's window.
- **Exposure:** the largest share of sessions owned by one live coordinator, over time.
- **Idle agent-seconds:** time when an agent is alive, has no call in flight, and its session has a blocked contract.
- **Unnecessary reassignments:**
  - `contract.rejected{stage: lost}` when chaos did not kill the assignee (its own coordinator's crash stopped it, or it was alive);
  - `ownership.remapped` with a live previous owner (a false death).
- **Duplicated work, in $ and calls, split by cause** (coordinator crash, agent kill, false death):
  - calls cancelled, then redone (the estimate from `_bill_unfinished`);
  - calls paid twice (reuse `takeover._duplicates`);
  - calls paid but never consumed.
- **Preserved work:** calls in flight at a crash whose result was consumed.

### Where it goes
- **`RunMetrics`:** new fields with defaults. `bench rescore OUT` recomputes the v1 rows at $0.
- **`harness.py`:**
  - append the columns;
  - add a `Matrix.knobs` axis and `Cell.knobs` (`registry.py`);
  - add `backend_factory(cell)` for a per-role latency scale in `Calibration.backend`.
- **`charts.py`:**
  - add the durable modes to `KNOWN_WORKFLOWS`;
  - add a `recovery_chart` and a `regime_chart`;
  - write `honesty.json`, which feeds the "where it helps" panel.
- **New `verify/recovery.py` and `fractalswarm recovery RUN`.** They print a table per crash and check the supervisor invariants:
  - o0 authors only timers while it is down;
  - every result logged while o0 was down is consumed after the restart;
  - `durable-max` has zero own calls cancelled; under `durable`, the cancelled own calls equal its in-flight own calls;
  - no attempt is dispatched twice, and no call is paid twice.
- **`takeover`:** for logs that contain `baseline.crashed`, answer "supervisor log: use recovery" instead of reporting violations.

---

## 3. Protocol (W1 builds it; the coordinator runs it and takes it to Yoel)

**Pre-registration.** Commit `bench/PREREG.md` before any gate run. It holds the spec's H1–H3, refined into the testable hypotheses below, plus the decision rules of spec §C.4.

**The $0 gate** (`bench/matrix-rivals-gate.yaml`):
- {swarm, durable-max, durable, central} × {T2, T1} × C0–C3 × seeds 1–4;
- calibrated fake LLM, sim clock.

**What counts as a difference.** A result is a **tie** unless all seeds agree and the difference reaches the minimum effect:

| Metric | Minimum effect |
|---|---|
| Stall | 3 s |
| Extra cost | 5 points |
| TTR | 1 s |
| CDT | ratio ≤ 0.5 |

**Hypotheses:**

| # | Hypothesis | Expected |
|---|---|---|
| H1 | Preserved work | durable-max ≥ swarm ≈ durable ≫ central |
| H2 | Extra cost | swarm vs durable-max within 5 points (tie) |
| H3 | TTR | the supervisor wins or ties: 5 s against the swarm's 5–7 s; report it |
| H4 | CDT and blast radius | swarm ≤ 0.5 × durable-max |
| H5 | Unnecessary reassignments | durable ≈ 0; swarm = its false deaths |
| H6 | Duplicated $ | durable-max = 0 ≤ swarm |

**Reading the results:**
- **H2 ties and H4 holds:** the headline becomes "the same work and cost as the best durable supervisor, a fraction of its blast radius, with no central coordinator". This is outcome A in spec §C.4.
- **H4 ties at the default density:** claim only the regimes that the sweeps show (outcome B, with conditions).
- **`durable-max` is cheaper:** say so.

**The "where it helps" sweeps** ($0, C3, 3 seeds, swarm vs durable-max):
- `recovery_ms` {0.5, 1, 2.5, 5, 10, 20} s, the same for both;
- the asymmetric case: `rival_recovery_ms` {0.5, 1} s while the swarm keeps 5 s; and the rival's restart time {0, 1, 3} s on top of the detection;
- agent latency scale {0.25, 0.5, 1, 2} (coordination density);
- width, through the agents axis {4, 8, 12, 24, 48};
- T1 vs T2.

**The failure model** (spec §C.2):
- **Per crash** is the main view.
- **Per process:**
  1. Measure the impact of a single crash per target level, with explicit targets: swarm root, a track lead, a session orchestrator; supervisor o0.
  2. Compute the expected impact per hour of work when every coordinator process fails at the same rate λ: the swarm adds up its 10 coordinators, the supervisor counts its one.
  3. Report it next to the per-crash results, whatever it shows.

**Output:** a regime map, plus a wins/ties/losses table for the honesty panel (`honesty.json`).

**Real runs.** They come only after the decision gate, and within the spec §J table:

| Run | Expected |
|---|---|
| Rivals matrix v2 (4 workflows × T2 × C0–C3 × 2 seeds, Contributor) | ≈ $10, cap $16 |
| T1: swarm and durable-max at C0 and C3 | ≈ $2.5 |
| Arena: 3 pairs, Standard | ≈ $3 |
| Intake and ablation | ≈ $0.5 |
| Arbitration | ≈ $1 |
| Demo and headline re-records | ≈ $2.5 |

**v1.** The review found that v1's runs replay only at their recording commit (587c88f). The rivals matrix v2 carries the reference rows, so v1's 3 missing cells can be superseded. The coordinator checks this and decides it with Yoel in Phase 0.

**Tests:**
- `test_bench_smoke` keeps its two assertions, relabelled as the process-tree reference row. Only the same-number-of-crashes test is extended to the durable modes.
- New tests check the rivals' own properties, plus one guard: the durable modes are no weaker than the process-tree baseline.
- **No test asserts that the swarm beats a rival.** Verdicts come from `bench verdicts OUT --prereg`.
- Update the columns in `test_bench_harness` and the 501 assertions in `test_api`.

---

## 4. Real input (W2)

### Intake (new `intake/` package)
- **Scenario `intake`:** one LLM effect with a new role `intake` (muse-spark-1.3, effort high, never degraded, no Contributor). It emits `intake.proposed`. Being a scenario, it is logged, replayable and visible in the lens.
- **Schema `t2_intake`:**
  - tracks, and talks with their track, abstract and attendance, plus the evidence for each;
  - speakers and emails, and optional rooms;
  - `reference`: availability cells, preferences and attendance, each with its source sentence;
  - warnings.
- **Scanning:** the pasted text is firewall-scanned and spotlighted before the call. The run's root still scans every email.
- **`intake/shape.py` normalizes deterministically:**
  - exactly 3 tracks (merge or split, with a warning), at least 2 talks per track, 8–15 talks;
  - days [1, 2] and the generator's `SLOT_STARTS`, so the 12:30 and 14:00 cut-offs stay valid;
  - Yoel's rooms if he gives them, else the generator's `ROOMS`;
  - ids T01, S01, E01.
- **Approval:**
  - Yoel's edits produce `approved.json` plus its sha256;
  - the reference uses the checker's truth schema (`track_of`, `speaker_of`, `attendance`, `availability`, `preferences`);
  - log which fields he edited.

### TaskSpec and truth modes
- **`TaskInputs.inline` and `TaskInputs.intake`,** with `exclude=True`, as the T3 fields do. Follow the T3 precedent so that replay works from the run directory alone.
- **`run_params`:** builds the corpus and the truth from them. For these runs only, it adds `params.input{source, sha256, truth_mode}`.
- **`root_children`:** uses `goal["truth"] or derived_truth(corpus, plan)`.
  - The derived truth is structural: `speaker_of` from the talks, the tracks from the plan, attendance 0, every cell available.
  - `check_context`, `bookings` and `checks.py` are then unchanged.
- **`final_report`:** adds `truth_mode` only when the goal carries it (the `swarm.py` boot passes it through).

### PII
- **Storage:** intake runs, approved inputs and live-input runs live in `FRACTALSWARM_PRIVATE_DIR` (`~/.fractalswarm/private`), outside the repo.
- **The catalogue:** it lists them, marked private, so they replay locally.
- **Pseudonyms:** email addresses (names optional) are pseudonymized before the corpus enters a run log. The mapping stays private.
- **Contributor is forced off.**
- **Bundling refuses** runs whose `input.source` is `intake`.

### The $0 path
- `intake/fake.py` parses generator wording with `parse_email` and `parse_attendance`.
- `generator.live_sample(seed)` makes a 12-talk input.
- **Test:** fake intake → approve → swarm and durable-max on the inline data → replay MATCH. The truth-free run completes.
- **One golden real intake** on synthetic text: about $0.02, with Yoel's OK.

---

## 5. Launch API (W2): new `api/jobs.py`

### Job manager
- **Processes:** each run is its own subprocess, never inside the API's event loop. Jobs persist in the private dir.
- **Real spend from the UI takes two steps:**
  1. `POST /api/tasks/preflight` returns the worst case (the T2 preflight on the corpus) and checks the caps: settled spend plus open reservations against the project ledger, and the phase cap of $50, measured from $11.82.
  2. `POST /api/tasks` launches with the preflight token and the typed word "SPEND".
- **Also required:**
  - the server flag `FRACTALSWARM_ALLOW_UI_REAL`;
  - one real job at a time;
  - `--no-paid-retries`;
  - a $0.75 run cap.

### Arena (`POST /api/arena`)
- **One ChaosPlan JSON for both runs,** with the same seed and the same approved input. Both `run.started` events are then identical except for the scenario.
- **Default plan, "half the brains":**
  - 5 coordinator crashes at fixed progress points;
  - the first targets `o0` in both systems, the rest are rule-targeted;
  - no agent kills or API faults, so the pair isolates coordinator recovery.

  The C3 profile stays the matrix's job.
- **New CLI flags:**
  - `--chaos-plan FILE`;
  - `--start-barrier FILE`: each process warms PromptGuard, writes `READY`, and waits for `go`.

### Live control (a stretch goal: start it only with the coordinator's OK)
- **A new ENV event `control.injected{op, body, to}`,** wired into:
  - `Runtime.inject` in the scheduler;
  - new ops in `apply_control`;
  - a branch in replay's `_advance`.
- **Chaos:** the monkey adds an action at `at_progress`. The arena's kill button gives both runs the same progress point.
- **Approve:** only when `auto_approve: false`. The root holds after `plan.proposed`. `/approve` leads to `plan.approved{by: "human"}`, or to a re-plan with the reason as feedback.
- **Fallback, if it slips:** scheduled plans only. The chaos plan is chosen before the launch.

### Crashed-run status
- `record_run` writes and touches `<run>/LIVE` (with the pid) from `poll_control`, and deletes it on exit.
- `_status` returns `completed`, `halted`, `running` (fresh `LIVE`) or `interrupted`.

### Load
- The live clock runs only on a quiet machine. The manager refuses a second live job and warns at high CPU.
- The recovery report flags false deaths.
- The arena's fallback is the sim clock.

### Metrics endpoint
`GET /api/runs/{id}/metrics` returns W1's `score_run` and recovery metrics, so the UI's face-to-face counters end on the official numbers.

---

## 6. Meta visibility (W3)

### Muse lens (new `api/lens.py`; W2's `app.py` includes its router)
**Routes:** `/runs/{id}/calls` and `/runs/{id}/calls/{effect_id}`.

**Per call:**
- the role and level;
- the model, effort and max tokens, recomputed with `LLMClient.build` from the `run.started` snapshot (as scoring already does);
- Contributor routing, from `security.routed`;
- the prompt, split into DATA and UNTRUSTED (`read_blocks`), and the output;
- usage, with cached and reasoning token counts (reasoning content is encrypted);
- cost, latency, attempts (from the cassette) and the cancel cause;
- the decision it caused: the events whose `causation_id` is its completion.

**Per run:** $ and tokens by model.

The lens adds no data to events, so it carries no replay risk.

### Ablation (a scenario on an approved intake)
- **Per email:** the regex `parse_email` against one Muse extraction that uses the extract guide.
- **Per abstract:** `parse_attendance` against Muse.
- **Scoring,** against the approved reference: exact cells, Jaccard, preference, and attendance within ±10 %.
- **Generator emails too.** The regex wins there by construction; say so.
- **Caveat to state:** Muse seeds the reference, and a human approves it.

### Wonder arbitration at the LCA (gated by `params.arbitration`)
- **Detection:**
  - the board sees a publish to a key that holds another contract's different value (canonical JSON);
  - it marks the fact `disputed` and emits `collision.detected{kind: "semantic"}`;
  - a new `DisputesView` reducer tracks the open disputes.
- **Arbitration:**
  - on its tick (the swarm's `_reconcile`, the central tick), the owner of the dispute's lowest-common-ancestor goal runs the `arbiter` call: same track → the track goal; otherwise the root;
  - the call is Wonder at effort high, tagged `arbitrate|key|n`;
  - it emits `arbitration.requested` and `arbitration.ruled`, plus `collision.resolved`, and sends `fact.resolve` to the board;
  - confidence below 0.6 → `escalation.opened`, answered through `control.injected` (or left to the timeout if live control is not merged).
- **Effect on the work:** `_dispatch` holds a place contract whose speaker is disputed (30 s timeout), then overlays the arbitrated value.
- **Recovery:** it is log-driven, so an heir or a restarted o0 picks the dispute up.
- **The $0 test** forces a dispute with a fake script variant.

---

## 7. File ownership

`+` marks a new file. "Light" means small, additive edits that the coordinator reconciles at merge time.

| Worker | Owns | Light edits |
|---|---|---|
| **W1 `rival`** | `actors/orchestrator.py` (central section, `_squad`, `_assign_children`), `coord/tree.py`, +`baselines/durable.py`, `actors/swarm.py` (scenarios), `bench/workflows.py`, +`bench/recovery.py`, `bench/scoring.py`, `bench/harness.py`, `bench/registry.py`, `bench/charts.py`, `llm/calibrate.py`, +`verify/recovery.py`, `verify/takeover.py`, +`bench/PREREG.md`, `bench/matrix-*.yaml`, `bench/REPORT.md` | `runs.py`, `cli.py` |
| **W2 `intake`** | +`intake/*`, `planning/taskspec.py`, `bench/tasks/t2_conference/task.py`, `bench/tasks/t2_conference/generator.py`, `config.py`, `config/roles.yaml`, +`api/jobs.py`, `api/app.py`, `api/catalog.py`, `kernel/scheduler.py`, `kernel/replay.py`, `kernel/effects.py`, `kernel/events.py`, `comms/chaos.py` | `actors/swarm.py` (boot), `runs.py` (`LIVE`), `cli.py`, the `_planned` hook |
| **W3 `meta`** | +`api/lens.py`, +`bench/tasks/t2_conference/ablation.py`, +`actors/arbitration.py`, +`bench/tasks/t2_conference/arbitration.py`, `actors/board.py` | The orchestrator hooks (`_reconcile`, central tick, `_dispatch`), the `params.arbitration` flag in the TaskSpec, one line in `api/app.py` to include the lens router |

**Order and gates:**
- W1, W2, and W3's lens and ablation start together. W3's arbitration rebases on W1 once W1 has merged.
- Merge order: W1 (durable modes, then metrics) → W2 → W3.
- **After each merge:**
  - full pytest, ruff and `demo --verify`;
  - check that the fixture runs (swarm, central, single and pipeline, each at C0, C3 and kill-half) are event-identical to the references.
- **The decision gate:** the $0 rivals gate runs after W1 has merged. Yoel reviews it before any real rival spend.
- **The handler freeze:** after W1, W2's kernel work, and W3's arbitration (or drop arbitration). Tag it `handler-freeze`, by Sun Nov 1 at 20:00 at the latest. Afterwards only analytics, the API and the UI change. All final recordings happen after the tag.

---

## 8. Top risks

| Risk | Mitigation |
|---|---|
| Old recordings stop replaying | The gating rules (§0), plus the reference diff after every merge |
| The rival ties on the headline metrics | The pre-registered rules, the regime map and the honesty panel |
| Metric bias | Event-symmetric definitions, tests on synthetic logs, and reporting the swarm's TTR loss |
| `durable-max` issues a call twice | `OwnEffectsView`, plus a test that asserts no call is paid twice |
| False deaths in the arena | Subprocesses, the start barrier, a quiet machine, and the sim-clock fallback |
| PII leaks | The private dir, pseudonyms and the bundle guard |
| Budget | Caps in `jobs.py`. The ledger understates what remains, because of open reservations |
| The live-control kernel change slips | Fall back to scheduled plans only |
| Merge conflicts | The ownership table above; the coordinator merges |
| Arbitration never triggers on real input | It is priority 4: drop it before the freeze if it is late |
