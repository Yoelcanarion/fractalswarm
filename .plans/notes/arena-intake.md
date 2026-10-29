# W2 `intake` — notes

Branch `Yoelcanarion/arena-intake` (from `3b1fe9b`). This file is the coordinator's and W3/W4/W5's
reference for everything W2 built. It is updated at each merge point.

## Status

| Step | State |
|---|---|
| 1. Run status (`LIVE`, `halted`/`running`/`interrupted`) | done, committed |
| 2. Job manager and launch API (`api/jobs.py`, `/api/tasks`, `/api/jobs*`, `/api/runs/{id}/metrics`) | done |
| 3. Inline input and truth modes (`TaskInputs.inline`/`intake`, `params.input`, `derived_truth`, `truth_mode`) | done |
| 4. Intake (scenario, schema, shape, fake, approval, endpoints) | done |
| Converter `corpus_and_truth` (approved input → corpus, truth), for W3's ablation | done, in arena since `92b8337` |
| `GET /api/runs/{id}/takeover`, `GET /api/capabilities` | done |
| 5. Arena launch (`--chaos-plan`, `--start-barrier`, `POST /api/arena`, `GET /api/pairs`) | done; the 5 live-clock tests pass (17.9 s) |
| 6. Real spend from the UI (preflight, token, "SPEND") | done |
| Real intake from the UI (`POST /api/intake/preflight`, the same gate; coordinator's Q1) | done |
| `LIVE` marker for `resume.py` and `baselines/langgraph_teams.py` (coordinator's Q2) | done |
| API hardening (`api/guard.py`: Host allowlist, JSON-only POST, WebSocket origin; `serve` loopback-only with real spend on) | done |
| 7. Live control (kernel) | approved with conditions (see the open questions); starts after the steps 5-6 merge |

## Deviations and decisions

1. **New role `intake` in `config/roles.yaml`** (muse-spark-1.3, effort high, `max_output_tokens`
   16384, no Contributor, same at every level, never degraded). This changes the `run.started` roles
   snapshot of **every new run** (accepted by the rules; old runs replay from their own snapshot).
   `compare_refs.py` will show exactly this and nothing else.
2. **Commit trailer.** The brief says `Claude Sonnet 5.5`; the commits of steps 1-4 say `Claude Opus 5.5`,
   because the brief tells me to invoke `/hard-task` for the truth modes and the job manager, and the
   harness attributes the commit to the model that ran. The commits since the resume say `Claude Sonnet 5.5`.
3. **Everything that holds a person's text lives in `FRACTALSWARM_PRIVATE_DIR`** (default
   `~/.fractalswarm/private`), including the job records (`jobs/<id>/job.json`) and the logs of
   every job, because a log line can carry a talk title. `create_app(..., private_dir=None)` has no
   launch routes: they answer **503**. `fractalswarm serve` passes `Settings().private_dir`.
4. `POST /api/tasks` **builds the run's params once at launch** (`run_params`), so a bad input is a
   synchronous 4xx with its reason, not a process that starts and dies.
5. A **`fractalswarm intake INTAKE_ID`** command (reads `input.json` of an intake in the private dir)
   and a **`fractalswarm bundle RUN --name N`** command were added to `cli.py`. `bundle` is the
   "bundling refuses intake" guard of the brief: it copies `events.jsonl`, `cassette.jsonl` and
   `HEAD` into `demo/<name>` and refuses a run in the private dir, an intake run, or any run whose
   `params.input.source` is `intake` or `inline`. `tests/integration/test_bundle_guard.py` also
   scans every bundle in `demo/` and `tests/golden/` so a hand-made copy fails the suite.
6. `final_report` adds `truth_mode` only when the goal carries it (live-input runs). Fixture runs are
   event-identical to before: `run_params` records no `input` and no `contributor` for them (a test
   pins this).
7. **A flaky test of mine, fixed.** `test_a_cancel_that_is_not_answered_kills_the_process_tree` raced a live
   run against `taskkill` and failed once under load (the run answered the halt before it was killed). The
   test now drops the halt request (`RunPaths.request_control` patched out), so the kill is the only way
   out; it passed 5 of 5 runs.
8. **`--start-barrier` is a directory, not a file.** `fractalswarm run --start-barrier DIR` writes
   `DIR/<run_id>.ready` after it has loaded what it needs (firewall warm, input read) and before
   `record_run`, then waits for `DIR/go` (180 s, then exit 1). A file cannot say which of two
   processes is ready; the launcher (`api/arena.py::release_when_ready`) writes `go` once both
   `.ready` files exist, or stops the pair if one process died or neither came in 120 s.
9. **Extra route `POST /api/arena/preflight`** (the brief names `/api/tasks/preflight` only): a pair
   has its own request and costs two runs, so it has its own token. A token is bound to the kind of
   launch (`task`, `arena`, `intake`) and to its fields, so a run's token does not clear a pair.
10. **The arena's plan and rival come from W1.** The default plan is `bench/profiles.half_the_brains_plan(seed)`
    (parsed with `parse_plan`, which rejects an action kind the chaos engine does not run) and the default
    rival is `durable-max`; `central`, `single`, `pipeline` and `durable` can be asked for. A plan with
    `kill_coordinator` actions turns `membership` on in the run's params, because only the swarm uses it
    and it is what makes the swarm answer a kill (the rivals ignore it).
11. **Edits outside the brief, all approved by the coordinator** (see the next section).
12. **`POST /api/intake` with an unknown `backend` answers 422** (it was a 403 for anything but `fake`).
    `real` answers 403 without a valid token and starts a billed reading with one (see "Real spend").
13. **A token is given back when its launch starts nothing** (`Approval.undo`): a refusal after the token
    was redeemed (caps checked again at launch, another billed job running, the process could not start,
    the ledger could not be read) leaves it usable, so a person is not sent back to the preflight for
    a failure that was not theirs.
14. **`serve` and `demo` refuse to start with `FRACTALSWARM_ALLOW_UI_REAL` on and a `--host` that is not
    loopback** (`SpendGate.refuse_exposed`, exit 2 before any server or browser starts). The token and the word
    SPEND protect against a person's slip, not against a stranger: the API hands out both, so a server that
    can spend must not be reachable from the network. Not in the brief.

## Replay safety

- No field was added to any existing event payload model. New event types: `intake.proposed`,
  `intake.refused`, `intake.failed` (`intake/events.py`).
- Gated by new inputs that old logs don't have: `TaskInputs.inline`, `TaskInputs.intake`
  (both `exclude=True`, like the T3 fields) and `params.input` / `params.contributor` (live-input runs
  only). `TaskSpec.model_dump` of a fixture spec is unchanged.
- A live-input run **replays from its own directory**: the corpus, the truth and `params.input` are in
  `run.started`.
- `intake/shape.py`, `intake/pseudonym.py`, `intake/truth.py` are pure. `intake/actor.py` is a handler
  with no I/O (the firewall scan and the LLM call are effects). Not covered by the determinism lint
  today; see the open questions.

## Out-of-brief edits

All approved by the coordinator.

- `tests/unit/test_determinism_lint.py`: it now lists the pure modules of the intake scenario
  (`intake/actor.py`, `shape.py`, `truth.py`, `pseudonym.py`).
- `src/fractalswarm/resume.py` and `src/fractalswarm/baselines/langgraph_teams.py` (W1's files): the
  `LiveMarker` around the driver, three lines each (`with LiveMarker(paths.live):`). A resumed run and the
  LangGraph baseline showed as `interrupted` in the catalog while they ran, and so could not be halted
  from the API. `tests/integration/test_run_status.py` pins both (the marker is there for every call each
  runner sends, and gone at the end; the tests fail without the three lines).
- `tests/conftest.py` (new): `TestClient` defaults to `http://127.0.0.1` and joins WebSocket paths onto its base
  URL, because the API now refuses `Host: testserver` (the guard above).
- Five existing tests send what the UI sends, a JSON content type on a POST that had none:
  `tests/integration/test_api.py` (verify twice, and the two raw-body tests), `test_ablation.py` (the `{nope`
  body) and `test_launch_api.py` (two calls). No assertion changed.

## $0 references (first merge point)

Recorded at `133fd58` (arena `c9603e2` merged) with `scripts/refs/record_refs.ps1`, compared with
`C:\Users\yogar\.fractalswarm\refs\phase0-3b1fe9b`: **43 runs, all with the same event count, each
differing in exactly one event**: `run.started` (seq 1), and there only by `+config.llm.roles.roles.intake`,
the new role of deviation 1. Every other event body of every run is identical (the hash chain cascades from
seq 1, so heads differ). `demo --verify --no-serve --no-browser` gives MATCH.

## $0 references (second merge point, steps 5-6)

Recorded at `cf5b8ce` (arena `c2b5e08` merged) with `scripts/refs/record_refs.ps1`, compared with
`C:\Users\yogar\.fractalswarm\refs\arena-c2b5e08`: **43 of 43 runs identical** (same event count, same event
bodies, and the same heads). `demo --verify --no-serve --no-browser` gives MATCH. The steps add no event type
and change no event payload; a run launched without a chaos-plan file or a barrier is the run it was.

## Open questions for the coordinator

1. **Step 7, live control: approved by the coordinator (Oct 29) on these conditions.** (a) It starts after the
   steps 5-6 `merge_ready`. (b) `control.injected{op, body, to}` is a new ENV event type; no field is added to an
   existing payload model. (c) Nothing changes unless a control is injected: the default runs stay 43 of 43
   identical to `arena-c2b5e08` and every recorded run still replays MATCH. (d) Tests show a run with injected
   controls (a kill at a progress point, a human approve, a re-plan with feedback) replaying MATCH, in a fresh
   process too. (e) W3 answers its `escalation.opened` through `control.injected`; the op and body shape are
   agreed with the coordinator first. (f) `merge_ready` by Sat Oct 31, 16:00 CET or it is dropped (scheduled
   plans chosen before the launch are the fallback, and they work today: `POST /api/arena` takes a full
   ChaosPlan). Until it lands `GET /api/capabilities` says `chaos` and `approve` are `false` and those routes
   answer 501.
2. **`LIVE` for the other runners is done** (deviation 11, your Q2). Closed.

## Private directory layout

```
<private>/
  intake/<intake_id>/   the intake run (events.sqlite, events.jsonl, cassette.jsonl, LIVE) plus
                        input.json      {segments{conference,talks,notes}, rooms, names, created_at}
                        pseudonyms.json {emails{alias: real}, names{alias: real}}   <- the only place a real address is
                        approved.json   the approved input (see below)
                        approved.sha256 its hash
  runs/<run_id>/        runs on live input (a run on `inputs.intake` or `inputs.inline`)
  jobs/<job_id>/        job.json, spec.json, run-<id>.log (+ pseudonyms.json for an inline corpus)
  pairs/                pair manifests (step 5)
```

Email addresses are replaced by `person-NN@example.invalid` **before** the text reaches a log, a
prompt, a cassette or the UI (names too with `names: true`, as `Speaker NN`). Nothing in
`runs/`, in an event log or in an API response carries a real address. Tests assert it by scanning the
bytes of every log.

## API reference (all JSON; errors are `{"error": "<reason>"}`)

Status codes used: 200, 202 (accepted, started), 400 (a `Host` that is not ours), 403 (refused by policy),
404, 409 (conflict: busy, used, already done), 415 (a POST that is not JSON), 422 (bad request), 429 (too many
jobs), 503 (no private dir).

### Who may call it (`api/guard.py`, for W4 and W5)

**The UI sends `Content-Type: application/json` on every POST, even when it has no body (send `body: "{}"`).**
Without it the answer is 415 before the route runs. Today `web/src/lib/api.ts` `verifyRun` (line 39,
`fetch(".../verify", { method: "POST" })`) sends none, so the Verify button gets 415 until it adds the header
(`postControl` already does). The built bundle in `api/static/` needs a rebuild after that.

One middleware sits in front of every route (the UI files and the WebSocket too), so a route added later is
covered without doing anything:

| Check | Answer | Closes |
|---|---|---|
| `Host` must be `127.0.0.1`, `localhost`, `::1` (any port) or the `--host` that `serve` or `demo` was given | 400 `invalid host header` | DNS rebinding: a page on a name that re-resolves to 127.0.0.1 is same-origin with the API |
| every POST must have the media type `application/json` (parameters such as `; charset=utf-8` are fine) | 415 | a cross-site form or `text/plain` POST, which needs no CORS preflight |
| a WebSocket handshake with an `Origin` must come from this server's own origin (`Origin` = `http://` + the `Host` it was reached by); no `Origin` at all (a CLI client) is allowed | closed before accept, code 1008 | a cross-site page opening the events socket of a private run |

- The Vite dev server (`npm run dev`, proxy to 8765, no `changeOrigin`) keeps working: it passes `Host` and
  `Origin` through unchanged, both `localhost:5173`. Reach the UI by `localhost` or `127.0.0.1`; any other name
  needs `serve --host <that name>`.
- `serve --host 0.0.0.0` allows only the literal `0.0.0.0` besides loopback: a LAN client is refused unless
  `--host` is the address it uses. With `FRACTALSWARM_ALLOW_UI_REAL` on, a non-loopback `--host` is refused
  outright (deviation 14).
- Tests: Starlette's `TestClient` says `Host: testserver`, which the API refuses. `tests/conftest.py` makes
  `TestClient(app)` talk to `http://127.0.0.1` and joins a WebSocket path onto that base URL (Starlette joins
  it onto `ws://testserver`). A test of the guard itself passes `headers={"Host": ...}`. A POST in a test
  needs `json=` (or a JSON `Content-Type` header), as it does in the UI.

### Jobs

`POST /api/tasks` → **202**

```jsonc
{
  "spec": { /* a TaskSpec as in tasks/examples/*.yaml, as JSON: goal, task, inputs, seed, scaling... */ },
  "scenario": "swarm",        // swarm | central | single | pipeline | durable-max | durable   (default swarm)
  "chaos": "C0",              // C0 | C1 | C2 | C3 | kill-half                  (default C0)
  "clock": "sim",             // sim | live                                     (default sim)
  "speed": 1.0,               // live clock speed-up, 0 < speed <= 1000
  "backend": "fake",          // real → billed: needs preflight_token and confirm (see "Real spend")
  "run_id": "my-run",         // optional; default ui-<yyyymmdd-hhmmss>-<4 hex>
  "budget_usd": 2.0,          // optional run cap (a billed run: at most 0.75)
  "cross_audit": false, "feasibility_report": false,
  "preflight_token": null, "confirm": null       // billed runs only
}
```

`spec.inputs` is one of: `{fixture: "tasks/fixtures/t2/seed-1", generate_seed?: 1}` (a directory
**inside the repo**), `{intake: "<intake_id>"}` (an approved intake), or
`{inline: {corpus: {...}, truth?: {...}}}` (a corpus in the T2 corpus schema; the truth is optional).
`task` defaults to `t2_conference`; `t1_extraction` and `t3_report` take `fixture` only.

Response:

```jsonc
{ "job_id": "job-20261029-001228-cc5e", "run_id": "my-run", "run_ids": ["my-run"],
  "state": "starting", "private": false, "warnings": [], "job": { /* a Job, below */ } }
```

`private` is true for `inputs.intake` and `inputs.inline`: the run is written to `<private>/runs/` and
the catalogue lists it with `"private": true`. `warnings` carries the high-CPU warning of a live
job (see Limits). Refusals: 409 `run id ... is already used`; 409 `... runs on the live clock: only
one at a time`; 409 `intake ... has no approved input`; 422 with the reason for a malformed
spec, a corpus that fails validation, a truth that does not cover the corpus, a fixture outside the
repo, an unknown `chaos`/`scenario`; 429 when 8 jobs are active.

`GET /api/jobs` → list of Jobs, newest first (without `log_tail`). `GET /api/jobs/{id}` → one Job.
`POST /api/jobs/{id}/cancel` → the Job, `state: "cancelled"` (409 if it is not active).

```jsonc
// Job
{ "id": "job-...", "kind": "run" | "intake" | "arena", "label": "swarm C0 seed 1",
  "created_at": "2026-10-29T00:12:28+00:00", "finished_at": null,
  "state": "starting" | "running" | "completed" | "failed" | "interrupted" | "cancelled",
  "clock": "sim" | "live", "real": false, "private": false, "pair_id": null, "warnings": [],
  "runs": [ { "run_id": "my-run", "role": "run", "scenario": "swarm", "dir": "...", "pid": 1928,
              "log": "run-my-run.log", "exit_code": null,
              "status": "empty" | "running" | "completed" | "halted" | "interrupted",
              "log_tail": "last 4000 bytes of the process output (GET one job only)" } ] }
```

State is derived: `completed` when every run's log ends (a halted run counts), `failed` when every
process exited and some run never ended, `interrupted` for a job whose processes are gone after an API
restart, `running`/`starting` otherwise. Jobs survive an API restart; a restarted API can still list,
halt and cancel them (the run's own `LIVE` file gives the pid).

**Cancel** asks every running run to halt through its control inbox (the log ends with `run.halted`),
waits 10 s, then kills the process tree (and clears `LIVE`, so the run reads `interrupted` at once).

**Limits.** At most one job on the live clock (409). `warnings` holds
`the CPU is at N%: a live-clock run may miss heartbeats...` when the machine is above 80% at launch.
The CPU is read with `GetSystemTimes` on Windows and the load average elsewhere. At most 8 active jobs.
Every job is a detached subprocess (`python -c "from fractalswarm.cli import app; app()"`), so a closed
server or Ctrl+C does not take it down.

### Run numbers

`GET /api/runs/{id}/metrics` → 200

```jsonc
{ "run_id": "...", "status": "completed", "scenario": "swarm", "task": "t2_conference",
  "input": null,   // or {source: "intake"|"inline", sha256, truth_mode: "approved"|"given"|"derived"}
  "metrics": { "run_id", "events", "completed", "valid", "score", "detail",
               "makespan_s", "stall_s", "work_window_s", "work_busy_s", "cost_usd",
               "input_tokens", "output_tokens", "total_tokens", "coordination_tokens",
               "llm_calls", "llm_errors", "cancelled_llm_calls", "work_calls", "messages",
               "breaker_trips", "chaos_events" },     // = bench.scoring.score_run
  "recovery": null }   // reserved for W1's recovery metrics
```

It works on a running run too (the log is read read-only). `valid` is the task checker's verdict
(`t2_checker`/`t1_checker`); the other tasks use the default checker.
`GET /api/runs` and `GET /api/runs/{id}` are unchanged, plus private runs listed with `"private": true`
and `status` in `completed | halted | running | interrupted | empty`.

### What this server can do, and what a finished run proves

`GET /api/capabilities` → `{ "tasks": true, "chaos": false, "approve": false, "budget": true, "halt": true,
"real": false }`. A control that is `false` answers 501 (`tasks` is false, and the launch routes answer 503,
when the API has no private directory). `real` is an extra key beyond the five you asked for: it is true when
a billed launch can pass the gate (the server runs with `FRACTALSWARM_ALLOW_UI_REAL=1` and has a key), so the UI
can show or grey out the "real" choice without posting a preflight. It is false by default. The run catalogue's `status` is one of `running | completed | halted |
interrupted | empty`.

`GET /api/runs/{id}/takeover` → 200 (`verify/takeover.py::check_run`, recomputed from the finished log,
never from what an actor said about itself; cached per run and head hash). 409 until the run ended, 404
for an unknown run.

```jsonc
{ "run_id", "events", "head",
  "ok": true,                                     // false iff violations is not empty
  "violations": [ { "check", "kind", "seq", "detail" } ],
  "kills": [ { "fault", "target", "progress", "seq", "ts_virtual", "remaining_work", "stopped_seq",
               "cancelled_effects", "events_after_stop", "completions_after_stop", ... } ],
  "verdicts": [...], "successions": [...], "chains": { "root": ["o0", "o4", ...], ... },
  "adoptions": [...], "orphan_results": [...],
  "fencing": { "fenced", "owner_writes_checked", "owner_writes_unchecked" },
  "lost_work": { "contracts": [...], "goals": [...], "task": {...} },
  "duplicates": { "llm_started", "llm_paid", "llm_failed", "groups", "cancelled", ... } }
```

For `demo/backup`: `ok` true, no violations, 5 kills, 8177 events.

### Arena: a swarm and a rival on one input

`POST /api/arena` → **202**. Two subprocesses (`fractalswarm run`), one per system, with the same
TaskSpec, seed, approved input and ChaosPlan file, so their `run.started` events differ only in the
scenario (a test pins it). The manifest is `<private>/pairs/<pair_id>.json`.

```jsonc
{ "spec": { /* a TaskSpec, as in POST /api/tasks */ },
  "rival": "durable-max",        // durable-max (default) | durable | central | single | pipeline
  "chaos": "half-the-brains",    // half-the-brains (default: W1's five coordinator kills) | C0 | C1 | C2 | C3
  "chaos_plan": { /* a full ChaosPlan: profile, seed, actions[{at, kind, target}], net, api_fault_rate */ },
                                  // wins over "chaos"; kinds: kill_coordinator | kill_agents | partition
  "clock": "sim",                // sim | live; on live the two processes park at a start barrier until
                                  // both are ready, so the clocks start together
  "speed": 1.0, "backend": "fake", "pair_id": "demo-1", "budget_usd": null,
  "preflight_token": null, "confirm": null }       // a billed pair only
```

→ `{ "pair_id", "job_id", "left": "<pair_id>-swarm", "right": "<pair_id>-<rival>", "state", "private",
"billed", "warnings", "pair": <a Pair, below>, "job": <a Job> }`. The runs are ordinary runs
(`/api/runs/{left}`, `/events`, `/verify`, `/metrics`, `/takeover`); `left` is always the swarm. The job's
`kind` is `arena` and its `pair_id` is set, with both runs in `runs` (roles `left`, `right`). Cancelling the job
halts both (before the barrier is released: kills both parked processes). Refusals: 422 for a bad rival,
plan or spec (the message names the field), 409 for a used pair id or a live-clock job already running,
403 for a billed pair without a valid token.

`GET /api/pairs` → list of Pairs, newest first. `GET /api/pairs/{pair_id}` → one (404 if unknown).

```jsonc
// Pair
{ "pair_id", "created_at", "job_id", "label": "swarm vs durable-max, half-the-brains, seed 1",
  "seed", "clock", "speed", "private", "rival", "billed",
  "chaos": { "name": "half-the-brains", "actions": 5 },
  "input": null,                          // or the params.input of live input: {source, sha256, truth_mode}
  "left":  { "run_id", "scenario": "swarm", "dir", "private", "status": "running" | ... },
  "right": { "run_id", "scenario": "durable-max", "dir", "private", "status": ... },
  "state": "starting" | "running" | "completed" | "failed" | "interrupted" | "cancelled",
  "warnings": [] }
```

### Real spend from the UI (`api/spend.py`)

Three things can be billed from the UI: a run (`POST /api/tasks`), a pair (`POST /api/arena`) and the
reading of pasted text (`POST /api/intake`), each with `backend: "real"`. All three pass the same gate, and
all are **off** unless the server was started with `FRACTALSWARM_ALLOW_UI_REAL=1` (and has `MODEL_API_KEY`):

1. `POST /api/tasks/preflight`, `POST /api/arena/preflight` or `POST /api/intake/preflight` takes the body of
   the launch it prices. It writes nothing, calls nothing and never creates the ledger. It returns **200**:

   ```jsonc
   { "ok": true, "token": "…" | null, "expires_in_s": 600 | null, "confirm_word": "SPEND",
     "kind": "task" | "arena" | "intake", "runs": 1 | 2,
     "calls_per_run": 320,                    // the requests one run sends at their worst
     "estimate_usd_per_run": 8.24,            // those requests priced at their worst case
     "run_cap_usd": 0.75,                     // 0.25 for a reading
     "worst_case_usd": 0.75,                  // runs × min(estimate, cap): what the launch will reserve
     "standing": { "settled_usd", "reserved_usd", "committed_usd", "project_cap_usd",
                   "project_remaining_usd", "phase_start_usd", "phase_cap_usd", "phase_spent_usd",
                   "phase_remaining_usd" },   // from the ledger now
     "refusals": [ "why it cannot go; empty when ok" ] }
   ```

   A token comes back only when `refusals` is empty. 422 for a request that is not valid (the launch
   would refuse it too), 409 for an intake without an approved input. For a conference task on the fixture
   `seed-1`: 320 calls, $8.24 per run uncapped, so $0.75; a pair $1.50 (560 calls per run with five kills);
   the reading of a 7 000-character paste $0.156.
2. The launch carries `"backend": "real"`, `"preflight_token": "<token>"` and `"confirm": "SPEND"`, with
   **the same body** as the preflight (the token is bound to the kind of launch and to every field that
   decides what runs or what it costs: spec, scenario, chaos or plan, clock, speed, cap, the pasted text;
   not to `run_id`/`pair_id`). A token works **once** and expires after 10 minutes (kept in memory: a
   restart voids it).
3. Refusals, in the order they are checked: **403** no token ("real runs need the preflight flow"); **403**
   the server flag is off or there is no key; **403** the word is not `SPEND`; **422** a cap above $0.75;
   **403** the token is unknown, used or expired, or was issued for a different request; **409** the worst
   case no longer fits under the project cap or the phase cap, counted from the ledger now (settled plus open
   reservations); **409** another billed job is running ("one at a time"). A refusal after the token was
   redeemed gives it back.
4. The processes run with `--confirm-real-spend --no-paid-retries` (a request that may have been billed is
   never sent twice; only 429 and 503 are retried), the run cap (`--budget-usd`, at most 0.75; the reading
   runs with the CLI's 0.25), and `FRACTALSWARM_LEDGER_PATH`/`FRACTALSWARM_PROJECT_CAP_USD` of the server, so
   every request reserves its worst case in the project ledger before it is sent and settles after. The
   phase cap counts from the $11.82 settled at the start of the phase (Oct 28) up to $50, and never past the
   hard stop of $61.8.

Billed runs are for the conference task. The job has `"real": true`; `GET /api/jobs` shows it.
The pasted text of a reading is private data: the preflight keeps only a fingerprint of the cleaned text,
the rooms and the names flag, and a reading that starts nothing leaves no text behind.

### Live input

`GET /api/intake/sample?seed=1` → `{conference, talks, notes, rooms}`: synthetic text in the generator's
wording (12 talks, 9 speakers), to try the flow at $0. The answer key is not sent.

`POST /api/intake` → **202**

```jsonc
{ "talks": "...",              // required: the submissions (titles, speakers, abstracts)
  "notes": "...",              // optional: emails/notes from the speakers (availability, preferences)
  "conference": "...",         // optional: a name or a line about it
  "rooms": [{"name": "Hall A", "capacity": 200}],   // optional; default: the generator's four rooms
  "names": false,              // true: speakers' names become "Speaker NN" in what the agents read
  "backend": "fake",           // real → billed: needs preflight_token and confirm (see "Real spend")
  "preflight_token": null, "confirm": null }     // a billed reading only
```
→ `{ "intake_id", "job_id", "state": "reading", "private": true, "billed": false, "warnings": [] }`. Pasted
text is limited to 200 000 characters per box; email addresses are pseudonymized on arrival. An unknown
`backend` is a 422.

`GET /api/intake/{id}` → the state:

```jsonc
{ "intake_id": "...",
  "state": "reading" | "proposed" | "approved" | "refused" | "failed" | "interrupted",
  "status": "running" | "completed" | ...,          // the intake run's status
  "texts": { "conference", "talks", "notes" },     // as stored: addresses already pseudonymized
  "proposal": { /* null until proposed. See below */ },
  "input_sha256": "...",                            // of the texts; ties the proposal to them
  "scans": [ { "source_id": "talks", "decision": "allow", "score": 0.0, "reasons": [], "findings": ["email"] } ],
  "refused": null | { "segments": ["notes"], "reason": "..." },   // the firewall blocked a box
  "failed": null | { "errors": [ ... ] },                         // the model could not fill the schema
  "approved": null | { "sha256", "approved_at", "edits": [...], "truth_mode": "approved", "names_pseudonymized": false },
  "job": { "id", "state" } }
```

`POST /api/intake/{id}/approve` → 200, body `{ "proposal": <the proposal as the person left it> }`
(omit it to approve as read).

```jsonc
{ "intake_id", "sha256", "edits": ["talks[T01].attendance", "speakers[S02].preference"],
  "warnings": [ ... ], "task_inputs": { "intake": "<intake_id>" } }
```

`edits` lists the fields the person changed against Muse's reading (`kind[id].field`, `kind[id] added`,
`kind[id] removed`). 422 when the intake is not `proposed`, the body is malformed, or the proposal
**still has errors** after being fitted (fewer than 8 talks, a track without 2 talks, a talk
whose speaker is missing...). 409 when it was already approved. After approving, run it with
`POST /api/tasks` and `spec.inputs = {"intake": "<intake_id>"}`.

### The `proposal` (what the review table shows)

```jsonc
{ "conference": "DevConf Live", "days": [1, 2],
  "slots": [ {"index": 0, "start": "09:00", "end": "09:45"}, ... 9 ],
  "rooms": [ {"id": "main-hall", "name": "Main Hall", "capacity": 260}, ... ],
  "tracks": [ {"id": "track-data-infrastructure", "name": "Data Infrastructure", "description": ""} ],  // exactly 3
  "speakers": [ { "id": "S01", "name": "...", "email": "person-01@example.invalid", "note": "their email, word for word",
                  "available": [[1,0],[1,1],...] | null,   // [day, slot] cells; null = no constraint stated
                  "availability_source": "the sentence it was read from",
                  "preference": "morning" | "afternoon" | null, "preference_source": "..." } ],
  "talks": [ { "id": "T01", "title": "...", "speaker_id": "S01", "track_id": "...", "track_label": "as written",
               "track_source": "Track: HCC track", "abstract": "...",
               "attendance": 33 | null, "attendance_source": "the sentence" } ],
  "warnings": [ "every merge, split or cap it applied, in words" ],
  "errors": [ "what stops approval; empty when it can be approved" ] }
```

`intake/shape.py` makes the reading fit the program, deterministically: 8–15 talks (more are cut with a
warning), exactly 3 tracks (the two smallest are merged as "A / B", the largest split as "X, part 1/2",
a warning each), at least 2 talks per track, ids `T01.. S01..` by first appearance, days `[1, 2]`,
the generator's 9 slots, the person's rooms or the generator's. Editing a row and approving fits it again.

## The approved input (for W3's ablation, W5's review table, W1's comparison)

`<private>/intake/<id>/approved.json`:

```jsonc
{ "intake_id", "sha256", "approved_at", "truth_mode": "approved", "edits": [...], "names_pseudonymized": false,
  "corpus": { conference, days, slots, rooms, tracks, talks[{id,title,speaker_id,speaker,track_label,abstract}],
              emails[{id, speaker_id, from, subject, body}] },   // what the agents read; one email per speaker note
  "truth": { "track_of": {T01: "track-..."}, "speaker_of": {T01: "S01"}, "attendance": {T01: 33},
             "availability": {S01: [[1,0],...]}, "preferences": {S01: "morning"|null} },   // the checker's schema
  "reference": { "availability": {S01: {cells, source}}, "preferences": {S01: {value, source}},
                 "attendance": {T01: {value, source}} },          // facts with the sentence behind each
  "proposal": { /* the fitted proposal that produced all of the above */ } }
```

- `sha256` is the hash of canonical `{corpus, truth}`. `run_params` re-checks it on every run, and refuses
  an `approved.json` that was edited afterwards (`approved.sha256` is written next to it).
- `reference` is keyed by the same ids as `corpus.emails[].speaker_id` and `corpus.talks[].id`, so the
  ablation can score a parser against it per note (exact cells, Jaccard, preference, attendance ±10%).
  A speaker without a stated constraint has no `reference.availability` entry and the full grid in `truth`.
- **The converter** (`intake/truth.py`): `corpus_and_truth(approved: dict) -> tuple[corpus, truth]` is pure.
  It takes the content of `approved.json` and returns deep copies of its `corpus` and `truth`, the pair a
  run records in `params`. It raises `ValueError("not an approved input: it lacks corpus, truth or
  sha256")` for anything else and `ValueError("it changed after it was approved")` when `input_sha256`
  of the pair is not the recorded `sha256`. `run_params` uses it, so a run and an ablation read the same
  pair; `bench/tasks/t2_conference/ablation.cases_from_corpus(corpus, truth)` takes it as is
  (`tests/integration/test_intake_flow.py` runs both).
- Runs on it record `params.input = {source: "intake", sha256, truth_mode: "approved"}`, `params.contributor = false`,
  and `task.result.report.truth_mode = "approved"`.
- Truth modes: **approved** (a person reviewed Muse's reading), **given** (`inline.truth` sent by the caller),
  **derived** (`inline` without a truth: `derived_truth(corpus, plan)` is structural only, so the checker verifies
  consistency — no double booking, rooms, days, one speaker at a time — but cannot know a stated constraint).
  A swarm and its rival run on the same `params`, byte for byte (a test pins it).

## The intake as a scenario (for W3's lens)

Scenario `intake` (`runs.SCENARIOS`): one actor `intake`. Events: `security.scanned` per pasted box
(`surface: "intake"`, a hostile text is **blocked**, not quarantined), then either `intake.refused
{segments, reason}` (no model call), or one `effect.started` of kind `llm` (role `intake`, tag `read`,
squad scope `intake`, the text in untrusted blocks only), then `intake.proposed {proposal, input_sha256}`;
after a reply that does not fit the schema, one retry with the parse errors as feedback, then
`intake.failed {errors}`. The run is capped at $0.25; it replays like any other run.
The fake (`intake/fake.py`) reads the generator's wording through `parse_email`/`parse_attendance`; a text in
any other wording gets the talks it can parse and a warning, which is the reason the real path calls Muse.

## Tests

`tests/integration/test_launch_api.py` (jobs with real subprocesses, limits, both cancel paths, restart,
the intake over HTTP), `test_intake_flow.py` (reading == what the text was written from for 3 seeds, swarm +
central on one approved input with identical params, derived/given modes, no real address in any log,
Contributor off even when asked, tamper detection, the firewall refusal, retry then fail),
`test_bundle_guard.py`, `tests/unit/test_intake_shape.py` (hypothesis), `test_intake_pseudonym.py`,
`test_run_status.py` (LIVE, killed subprocess, and the marker of a resumed run and of the LangGraph baseline),
`test_api.py` (501 list, capabilities, takeover).

Second merge: `test_arena.py` (the chaos-plan file is the same run as the profile it holds, a bad plan never
starts, the start barrier, a pair on one input with identical `run.started` apart from the scenario and both
runs replaying MATCH, the default rival and plan, a pair on live input stays private, every refusal; on the live
clock: a pair behind a barrier, one live job at a time, cancelling before and after the start, a process that
dies before the barrier); `test_spend.py` (the preflight and the gate for runs, pairs and readings: every way a
billed launch is refused, single use, expiry, the caps again at launch, one billed job at a time, the token
given back, the flags the processes get; every process is a stand-in and the ledger a temp file;
with the gate bypassed 16 of the reading's tests fail); `test_intake_real.py` (the CLI's real path against a
stub of the Meta API: the worst case is reserved before the request and settled after, the $0.25 cap, a 500 is
not resent with `--no-paid-retries` and a 429 is, no spend flag or no key is refused).

Hardening: `test_guard.py` (50 tests: a Host that is not ours is refused on every route, found by walking
`app.routes`; a POST that is not JSON is refused and a cross-site form cannot start a run, a pair, an intake,
a halt or a cancel; a WebSocket from another origin is closed before it opens; `serve` and `demo` hand their
`--host` to the guard; each of the three checks, switched off alone, fails 7 to 17 of them) and in
`test_spend.py` the loopback-only rule for a server that can spend.

Results at `cf5b8ce` (machine shared with W1's gate, one process): the 5 live-clock arena tests 5 passed in
17.9 s (slowest 10.7 s); the whole suite `pytest -m "not promptguard"` 1451 passed (1158 in 6m49s for `unit`
and the integration files a-l, 293 in 7m33s for m-z), 3 deselected; `ruff check` and `ruff format --check`
clean (238 files).

None of these calls the API. Live-clock tests and anything that starts several runs run only in a slot.
