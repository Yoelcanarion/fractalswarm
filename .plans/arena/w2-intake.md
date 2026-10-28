# Worker brief W2 — `intake`

- **Branch:** `Yoelcanarion/arena-intake`. The coordinator created it from `Yoelcanarion/arena` as a child worktree, and you are already in it: do not create another worktree or branch.
- **Model:** Sonnet 5.5 at max effort. Invoke `/hard-task` for the truth modes, the job manager's spend safety and any kernel change.
- **Setup:** run `uv sync` first.

## Why this matters
In the demo, Yoel types a small, messy conference in plain English. Muse turns it into a problem, he approves the reading, and both systems run on it side by side, under the same failures. You build that path end to end, plus the API that launches runs from the UI.
- **It must be safe:** PII and money.
- **It must replay:** determinism.
- **It must work at $0:** a fake backend for every step.

## Read first
- `CLAUDE.md` (binding): the determinism, security and budget rules.
- `.plans/arena-spec.md`: §0, §1, §D, §E (items 1 and 3) and §J.
- `.plans/arena/backend-design.md`: §0, §4, §5 and §7. **This is your design.**
- The code:
  - `planning/taskspec.py` (and how the T3 fields use `exclude=True`);
  - `bench/tasks/t2_conference/{task,generator,fake}.py`;
  - `verify/checks.py`;
  - `actors/swarm.py` (the boot);
  - `runs.py`, `cli.py`;
  - `api/{app,ws,catalog}.py`;
  - `config.py`, `config/roles.yaml`;
  - `kernel/{scheduler,replay,effects,events}.py` (read-only until step 7);
  - `comms/chaos.py`;
  - `tests/integration/test_api.py`.
- `docs/api-notes.md`: the structured outputs (strict `json_schema` needs `additionalProperties: false`), effort levels, and `max_output_tokens`, which covers the reasoning too.

## Your files
See backend-design §7.
- **You own:**
  - new `intake/*`;
  - `planning/taskspec.py`;
  - `bench/tasks/t2_conference/task.py` and `generator.py`;
  - `config.py` and `config/roles.yaml`;
  - new `api/jobs.py`, `api/app.py` and `api/catalog.py`;
  - `kernel/{scheduler,replay,effects,events}.py` and `comms/chaos.py`, for step 7 only.
- **Light, additive edits:** `actors/swarm.py` (the boot), `runs.py` (`LIVE`), `cli.py`, and the `_planned` hook.
- **Not yours:**
  - the durable modes, metrics, `bench/*` outside `tasks/t2_conference/`, and `verify/recovery.py` (W1);
  - `api/lens.py`, ablation and arbitration (W3). Your `app.py` includes W3's router with one line, which W3 may add;
  - `web/` (W4, W5).
- **If you need a change in a file you don't own,** ask the coordinator.

## Replay-safety rules (backend-design §0)
- **Never add a field, even a defaulted one, to an existing event payload model.** New facts go into new event types: `intake.proposed`, and `control.injected` if step 7 happens.
- **New behaviour is gated by new inputs or params that old logs don't have:** `TaskInputs.inline` and `TaskInputs.intake`, `params.input`. `final_report` adds `truth_mode` **only** when the goal carries it.
- **The default path stays event-identical.** Before reporting, record the $0 references at your branch point, re-run them at your HEAD, and diff:
  - `fractalswarm run tasks/examples/t2-conference.yaml --chaos C0|kill-half|C3`;
  - the T1 and T3 smokes;
  - `bench bench/matrix.yaml --fake --out <dir>`.
- **Determinism:**
  - no `hash()`;
  - no unsorted set iteration;
  - no wall clock in handlers;
  - all nondeterminism enters as effect completions.

## Your job, in priority order
Merge points are marked. If time runs short, the items at the end drop first.

### 1. Run status: a quick win (backend-design §5)
- `record_run` writes `<run>/LIVE` (with the pid) and touches it from `poll_control`, then deletes it on exit.
- `api/catalog.py` `_status` returns `completed`, `halted`, `running` (fresh `LIVE`) or `interrupted`.
- Crashed runs must stop showing "running" forever.
- Test with a killed subprocess.

### 2. The job manager and launch API (fake first)
- **`api/jobs.py`:**
  - each run is its own subprocess, never inside the API's event loop;
  - jobs persist in the private dir;
  - list, status and cancel.
- **Endpoints:**
  - `POST /api/tasks` launches a run on the fake backend from a TaskSpec;
  - **`GET /api/runs/{id}/metrics`** returns the run's metrics (`score_run` today; W1's recovery metrics once they merge), so the UI's counters end on the official numbers.
- Replace the 501 stubs that this makes real, and update `tests/integration/test_api.py`.
- **Limits:** at most one live-clock job at a time; warn when the CPU is high.

### 3. Inline input and truth modes (backend-design §4)
1. `TaskInputs.inline` and `TaskInputs.intake`, with `exclude=True`, following the T3 precedent. **Replay must work from the run directory alone.**
2. `run_params` builds the corpus and the truth. For these runs only, it adds `params.input{source, sha256, truth_mode}`.
3. `root_children` uses `goal["truth"] or derived_truth(corpus, plan)`. The derived truth is structural. `check_context`, `bookings` and `checks.py` stay unchanged.
4. `final_report` adds `truth_mode` only when the goal carries it.
5. **PII:**
   - `FRACTALSWARM_PRIVATE_DIR` (default `~/.fractalswarm/private`) holds intake runs, approved inputs and live-input runs;
   - the catalogue lists them, marked private, so they replay locally;
   - email addresses are pseudonymized before the corpus enters a run log (names optional), and the mapping stays private;
   - Contributor is forced off;
   - **bundling refuses** runs whose `input.source` is `intake`.

### 4. Intake (backend-design §4)
1. **The `intake` scenario.** One LLM effect with the new role `intake` (muse-spark-1.3, effort high, never degraded, no Contributor). It emits `intake.proposed`, and is logged, replayable and visible in W3's lens.
2. **The strict schema `t2_intake`:**
   - tracks, and talks with their track, abstract and attendance, plus the evidence for each;
   - speakers and emails, and optional rooms;
   - `reference`: availability, preferences and attendance, **each with its source sentence**;
   - warnings.
3. **The pasted text** is firewall-scanned and spotlighted before the call. Never put it in a system prompt.
4. **`intake/shape.py` is deterministic:**
   - exactly 3 tracks, at least 2 talks per track, 8–15 talks;
   - days [1, 2] and the generator's `SLOT_STARTS`;
   - Yoel's rooms or the generator's `ROOMS`;
   - ids T01, S01, E01;
   - a warning for every merge or split.
5. **Approval:** `POST /api/intake/{id}/approve`, with Yoel's edits, writes `approved.json` plus its sha256 in the private dir, in the checker's truth schema. Log which fields he edited.
6. **The $0 path:**
   - `intake/fake.py`: generator wording through `parse_email` and `parse_attendance`;
   - `generator.live_sample(seed)`: a 12-talk input.
7. **Endpoints:** `POST /api/intake` (fake by default) and `GET /api/intake/{id}`.
8. **Tests:**
   - `shape` with hypothesis;
   - the derived truth;
   - pseudonymization;
   - fake intake → approve → swarm on the inline data → replay MATCH;
   - a truth-free run completes.

**→ First merge: steps 1–4.** Report to the coordinator.

### 5. Arena launch (backend-design §5)
1. **New CLI flags:**
   - `--chaos-plan FILE`: one ChaosPlan JSON for every run of a pair;
   - `--start-barrier FILE`: each process warms PromptGuard, writes `READY`, and waits for `go`.
2. **`POST /api/arena`:**
   - starts two subprocesses (swarm and a selectable rival, `durable-max` by default) with the same seed, the same approved input and the same chaos plan;
   - writes a pair manifest (`pair_id → [left_run, right_run]`) that the UI reads through `GET /api/pairs`.
3. **The default plan, "half the brains":**
   - 5 coordinator crashes at fixed progress points;
   - the first targets `o0` in both systems, the rest are rule-targeted;
   - no agent kills or API faults.

   W1 owns the pure helper that builds it in `bench/profiles.py`. Use it once W1 has merged, and until then a JSON fixture.
4. **The sim-clock fallback:** a pair can run on the sim clock, which can't produce load-induced false deaths.
5. **Test:** a fake pair (swarm and durable-max, once W1 has merged; swarm and central until then). Both runs replay MATCH, and both `run.started` events are identical except for the scenario.

### 6. Real spend from the UI (backend-design §5)
1. `POST /api/tasks/preflight` returns the worst case (the T2 preflight on the corpus) and checks the caps:
   - settled spend plus open reservations against the project ledger;
   - the phase cap of $50, measured from $11.82 settled.
2. `POST /api/tasks` and `POST /api/arena` with `backend: real` need:
   - the preflight token;
   - the typed word "SPEND";
   - the server flag `FRACTALSWARM_ALLOW_UI_REAL`;
   - one real job at a time;
   - `--no-paid-retries`;
   - a $0.75 run cap.
3. **Tests:** every refusal path, with a fake ledger in a tmp dir. **Never** the real one.

**→ Second merge: steps 5–6.**

### 7. Stretch: live control (only with the coordinator's OK)
- A new ENV event `control.injected{op, body, to}`, wired into:
  - `Runtime.inject`;
  - `apply_control`;
  - a branch in replay's `_advance`.
- **Chaos at a progress point**, so the arena's kill button hits both runs at the same point.
- **Approve when `auto_approve: false`.**
- **This is the riskiest change, because it touches the kernel.** If it is not merged by Sat Oct 31 at 20:00, drop it. Scheduled plans chosen before the launch are the fallback.

## Hard rules
- **No real Meta API calls.** Fake LLM and recorded runs only. The coordinator runs the one golden real intake (about $0.02) after your merge.
- **Never touch `~/.fractalswarm/ledger.sqlite` or `~/.fractalswarm/private` from tests:** use tmp dirs. **Never print or log secret values.**
- **Nothing that Yoel types enters git.** The tests use synthetic text from the generator.
- **When the coordinator sends HOLD,** stop test suites, servers and builds until RELEASE.
- **Don't edit `.plans/progress.md`.** Write your notes to `.plans/notes/arena-intake.md`: done, deviations, issues, open questions, and the API reference that W4 and W5 need (routes, request and response shapes).

## End of each merge step
- Green: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `uv run fractalswarm demo --verify` (MATCH).
- The reference comparison is clean, or every difference is explained and gated.
- Commit on your branch. End the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't merge or push.
- Report to the coordinator:
  - the branch and the commit;
  - the test counts;
  - the reference comparison;
  - done and not done;
  - deviations;
  - the API reference.
