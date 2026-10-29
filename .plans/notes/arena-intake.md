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
| 5. Arena launch (`--chaos-plan`, `--start-barrier`, `POST /api/arena`, `GET /api/pairs`) | not started (second merge) |
| 6. Real spend from the UI (preflight, token, "SPEND") | not started (second merge) |
| 7. Live control (kernel) | only with the coordinator's OK |

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

## Out-of-brief edit

`tests/unit/test_determinism_lint.py` (the coordinator approved it): it now lists the pure modules of the
intake scenario (`intake/actor.py`, `shape.py`, `truth.py`, `pseudonym.py`). That is the only file edited
outside the brief's list.

## $0 references (first merge point)

Recorded at `133fd58` (arena `c9603e2` merged) with `scripts/refs/record_refs.ps1`, compared with
`C:\Users\yogar\.fractalswarm\refs\phase0-3b1fe9b`: **43 runs, all with the same event count, each
differing in exactly one event**: `run.started` (seq 1), and there only by `+config.llm.roles.roles.intake`,
the new role of deviation 1. Every other event body of every run is identical (the hash chain cascades from
seq 1, so heads differ). `demo --verify --no-serve --no-browser` gives MATCH.

## Open questions for the coordinator

1. **`LIVE` for other runners.** `LiveMarker` wraps `record_run` only. A runner that records a run
   without `record_run` (`resume.py`, `baselines/langgraph_teams.py`) shows `interrupted` in the
   catalog while it runs, and so cannot be halted from the API. The fix is three lines:
   `with LiveMarker(paths.live):` around the run. W1 owns those files; the durable modes go through
   `record_run` and are not affected.

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

Status codes used: 200, 202 (accepted, started), 403 (refused by policy), 404, 409 (conflict: busy,
used, already done), 422 (bad request), 429 (too many jobs), 503 (no private dir).

### Jobs

`POST /api/tasks` → **202**

```jsonc
{
  "spec": { /* a TaskSpec as in tasks/examples/*.yaml, as JSON: goal, task, inputs, seed, scaling... */ },
  "scenario": "swarm",        // swarm | central | single | pipeline          (default swarm)
  "chaos": "C0",              // C0 | C1 | C2 | C3 | kill-half                  (default C0)
  "clock": "sim",             // sim | live                                     (default sim)
  "speed": 1.0,               // live clock speed-up, 0 < speed <= 1000
  "backend": "fake",          // real → 403 until the preflight flow (step 6)
  "run_id": "my-run",         // optional; default ui-<yyyymmdd-hhmmss>-<4 hex>
  "budget_usd": 2.0,          // optional run cap
  "cross_audit": false, "feasibility_report": false
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
  "backend": "fake" }          // real → 403 until the preflight flow (step 6)
```
→ `{ "intake_id", "job_id", "state": "reading", "private": true, "warnings": [] }`. Pasted text is
limited to 200 000 characters per box; email addresses are pseudonymized on arrival.

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
`test_run_status.py` (LIVE, killed subprocess), `test_api.py` (501 list updated).
