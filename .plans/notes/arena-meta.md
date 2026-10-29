# Arena notes — W3 `meta`

Branch `Yoelcanarion/arena-meta` (from `Yoelcanarion/arena`, Phase 0 end `3b1fe9b`).
Owner of: `api/lens.py`, the ablation, Wonder arbitration. Only the coordinator edits `.plans/progress.md`.

| Step | State |
|---|---|
| 1. Muse lens API (merge point 1) | **done**, see below |
| 2. Ablation (merge point 2, own commit) | **done** (own commit), see "Step 2" below |
| 3. Wonder arbitration (merge point 2, own commit) | waits for W1's durable modes |

---

## Step 1 — the Muse lens API

### Done
- `src/fractalswarm/api/lens.py` (new): three read-only routes. It adds nothing to any event, so it has no replay risk, and it works on every run recorded before it existed.
- `src/fractalswarm/api/app.py`: +2 lines (the import and `*lens_routes(catalog)` after the feasibility route).
- `tests/integration/test_api_lens.py` (new, 27 tests): exact numbers from `demo/backup` (summed from its `events.jsonl` by a separate script), a fake C3 swarm run in Contributor mode (cancelled calls with their cause, routing, retries from the cassette), a fake central run (coordinator crashes), pure-function tests of the sentence matcher.
- Smoke-tested on every run in `~/.fractalswarm/runs` plus `demo/backup` and `demo/toy`: no failure on any list, meter or detail call. The 153k-event sqlite run builds in about 2.8 s; the others in under 0.3 s.

### Deviations
1. **`read_blocks` → `BLOCK`.** The brief says to split prompts with `read_blocks`. It merges DATA and UNTRUSTED blocks by name and drops which kind a block was, and the lens must show the kind. `lens.py` uses the same `BLOCK` regex from `planning/planner.py`. No change to that file.
2. **Evidence offsets are UTF-16 code units**, not Python code points, so the browser can do `source.text.slice(start, end)` even when an emoji comes before the sentence (live input typed by a human can have one). Tested.
3. `describe(event)` falls back to the bare event type if a payload does not fit, so a newer event shape (W1, W2) can never turn the detail route into a 500.

### Limits to know
- **Facts and source sentences exist only for extraction calls** (`ref.contract_kind == "extract"` with emails or abstracts in the prompt). `facts` and `sources` are `null` for every other call.
- Matching is deterministic and heuristic (cue regexes over the sentences of the note). `unmatched` lists the fields for which no sentence scored; the UI should say "no source sentence found" instead of guessing. Attendance needs the number written in digits in the sentence.
- Reasoning content is encrypted by the provider: the lens gives `encrypted: true` and the size, never content.
- A call cut off before it completed (chaos, crash, halt) has `estimated: true`: its cost and tokens are the bench estimate (`bench/scoring.py`), `cached_tokens` is 0.
- One index per run is cached in memory (at most 8 runs). It is rebuilt when the log grows (key: last seq and hash), so a run that is still recording is fine.
- `coordination_tokens` and `recovery_tokens` are 0 on every recorded run because no call has such a role or tag. They are computed from roles and tags, never hard-coded (a test gives a call each of those roles and checks the tokens show).
### $0 reference comparison
The CLI part of `scripts/refs/record_refs.ps1` recorded at commit `839e8fe` and compared with the coordinator's Phase 0 set (`~/.fractalswarm/refs/phase0-3b1fe9b`) by `compare_refs.py`: **11 of 11 runs identical** (same event counts and head hashes, e.g. `t2-swarm-C0` 6619 events `ec6d153d964d`, `t2-swarm-killhalf` 5001 events `987721d37e1c`). The 32-cell fake matrix was **not** re-recorded for step 1, which touches only `api/` (only `serve` and `demo` import `api.app`, lazily; `run`, `bench` and `replay` do not). It will be for steps 2 and 3, which touch the run path.

### Open questions
- None blocking. W5 (ablation UI) will need the ablation routes below once step 2 lands.

---

## Endpoint shapes (for W4)

All under `/api/runs/{run_id}`. Errors are `{"error": "<text>"}` with status 404 (unknown run or call). Times (`started_ts`, `ended_ts`, `ts_virtual`, `elapsed_ms`) are the run's virtual milliseconds, as in the event log.

```ts
type Badge = "wonder" | "spark" | "contributor" | "other";   // Contributor = model name ends "-contributor"
type Purpose = "work" | "planning" | "verification" | "arbitration" | "intake"
             | "safety" | "coordination" | "recovery" | "ablation" | "other";
type CallStatus = "ok" | "incomplete" | "error" | "cancelled" | "inflight";

interface Usage { input_tokens: number; cached_tokens: number; output_tokens: number;
                  reasoning_tokens: number; searches: number }   // cached ⊂ input, reasoning ⊂ output

interface CallRef {                       // what the call is for
  kind: "plan" | "judge" | "agent" | "ablate" | string | null;
  goal_id?: string; attempt?: number;
  contract_id?: string;                   // judge, agent
  contract_kind?: string; step?: number;  // agent turns only ("extract", "place", "blurb")
  note_id?: string;                       // kind "ablate": the note this Muse call read (step 2)
}

interface Routing { contributor: boolean; reason: string;
                    findings: { kind: string; category: string; start: number; end: number }[] }

interface Cancel {                        // why a call never completed
  kind: "halted" | "actor_stopped" | "coordinator_crash" | "cancelled";
  reason: string;                         // "chaos" | "crash" | kill-switch text | ""
  fault?: string | null;                  // chaos fault, e.g. "kill_agent" (actor_stopped only)
  detail: string;                         // one English sentence, ready to show
  seq: number; ts_virtual: number; by: string;
}

interface CallRow {
  effect_id: string; seq: number;         // seq of effect.started
  actor: string; tag: string | null; ref: CallRef;
  role: string; purpose: Purpose; level: string;
  model: string | null; badge: Badge;
  effort: "low" | "medium" | "high" | null; max_output_tokens: number | null;
  routing: Routing | null;                // null unless the Contributor mode is on
  status: CallStatus; usage: Usage;
  cost_usd: number; estimated: boolean;   // estimated: cut off, billed the bench estimate
  latency_ms: number | null; attempts: number | null; http_status: number | null;
  started_ts: number; ended_ts: number | null; elapsed_ms: number | null;
  error: string | null; incomplete_reason: string | null;
  reissued: { ambiguous: boolean; reason: string } | null;
  cancel: Cancel | null;
}
```

### `GET /calls` → `{ run_id, count, calls: CallRow[], refused: Refused[] }`
- Rows are in the order the calls started (`seq`).
- Optional exact-match filters: `role`, `status`, `actor`, `model`, `purpose`.
- `refused`: calls the budget refused before they started (no prompt exists): `{effect_id, actor, tag, level, key, worst_case_usd, ts_virtual}`.

Real row (`demo/backup`, the root planner):
```json
{"effect_id":"eff-408.1","seq":411,"actor":"o0","tag":"plan|root|0",
 "ref":{"kind":"plan","goal_id":"root","attempt":0},"role":"root_planner","purpose":"planning",
 "level":"L0","model":"muse-wonder-1.0","badge":"wonder","effort":"high","max_output_tokens":16384,
 "routing":null,"status":"ok",
 "usage":{"input_tokens":2037,"cached_tokens":2036,"output_tokens":2333,"reasoning_tokens":1685,"searches":0},
 "cost_usd":0.0470712,"estimated":false,"latency_ms":14612,"attempts":1,"http_status":200,
 "started_ts":3390,"ended_ts":18031,"elapsed_ms":14641,"error":null,"incomplete_reason":null,
 "reissued":null,"cancel":null}
```

### `GET /calls/{effect_id}` → `CallRow` plus

```ts
interface CallDetail extends CallRow {
  request_extras: Record<string, unknown>;   // contributor, keep_reasoning, prompt_cache_key, max_tool_calls (when set)
  reported_model: string | null; response_id: string | null; rate_limits: unknown;
  cost_breakdown: { input_usd: number; cached_input_usd: number; output_usd: number;
                    reasoning_usd: number; search_usd: number } | null;   // null if estimated or not completed
  // paid = input_usd + cached_input_usd + output_usd = cost_usd ; reasoning_usd is the part of output_usd that was reasoning
  attempt_log: { status: number | null; latency_ms: number; error: string | null;
                 retry_after_ms: number | null }[] | null;                // from the cassette; null if no cassette
  refusal: unknown | null;
  prompt: {
    instructions: string | null;             // the static system text of the role
    text: string;                            // the free text of the first message, blocks removed
    data: Record<string, unknown>;           // <<<DATA name ...>>> blocks, JSON-decoded when they are JSON
    untrusted: Record<string, unknown>;      // <<<UNTRUSTED name ...>>> blocks: show them as untrusted
    turns: Item[];                           // the conversation so far (tool calls and outputs), encrypted blobs removed
    chars: number; tools: string[]; schema: string | null;
  };
  output: {
    text: string;                            // output_text as the model wrote it
    parsed: unknown | null;                  // text decoded when it is JSON
    tool_calls: { type: "function_call"; name: string; call_id: string; arguments: unknown }[];
    items: Item[];                           // reasoning (encrypted: true, chars), function_call, message
  };
  decision: {
    events: { seq: number; type: string; actor: string; ts_virtual: number;
              summary: string;               // one English sentence
              bookkeeping: boolean;          // true for budget.settled: hide it by default
              payload: unknown | null; payload_truncated: boolean }[];   // payloads over 4096 chars are left out
    sentences: { field: string; text: string }[];   // the model's own reasons: feasibility, limitations[i], reasons[i], notes, ...
  };
  facts: Fact[] | null;                      // extraction calls only
  sources: Record<string, Source> | null;
}

interface Fact {
  key: string;                               // "speaker:S12:availability" | "talk:T03:attendance"
  kind: "availability" | "attendance" | "other"; subject: string;
  value: unknown;                            // exactly what was published
  reading: string | null;                    // "day 1: all day; day 2: 10:30-17:00; no time preference"
  via: "publish" | "answer";                 // a memory.publish_fact call, or a row of the final answer
  reused: boolean;                           // read from the board, not from this call's sources
  sources: string[];                         // ids into `sources`
  evidence: { field: "available" | "preference" | "expected_attendance";
              source_id: string; start: number; end: number;   // UTF-16 offsets into sources[source_id].text
              text: string; score: number }[];
  unmatched: string[];                       // fields with no source sentence found
}
interface Source { id: string; kind: "email" | "abstract"; text: string;
                   speaker_id?: string; from?: string; subject?: string; title?: string }
```

Highlighting: `source.text.slice(ev.start, ev.end) === ev.text`. A tool-only step of an extraction (a `memory.search` call) has `facts: []`; a judge or planner call has `facts: null`.

Real fact (`demo/backup`, `eff-3895.0`):
```json
{"key":"speaker:S12:availability","kind":"availability","subject":"S12",
 "reading":"day 1: all day; day 2: 10:30-17:00; no time preference","via":"publish","reused":false,
 "sources":["E12"],
 "evidence":[{"field":"available","source_id":"E12","start":156,"end":245,
              "text":"My train arrives late on day 2, so nothing before 10:30 that day (the other day is fine).","score":6},
             {"field":"preference","source_id":"E12","start":246,"end":282,
              "text":"No preference on the time otherwise.","score":6}],
 "unmatched":[]}
```

### `GET /models` → the Muse meter
```ts
interface Meter {
  run_id: string;
  totals: {
    calls: number; completed: number; cancelled: number; errors: number;
    cost_usd: number;                 // = bench/scoring cost, cancelled calls at their estimate
    settled_cost_usd: number; estimated_cost_usd: number;
    input_tokens: number; cached_tokens: number; output_tokens: number; reasoning_tokens: number;
    cache_hit_share: number | null;   // cached / input, completed calls only
    cache_saved_usd: number;          // what the cached tokens saved against the uncached price
    coordination_tokens: number;      // input+output of coordinator/supervisor/router/recovery roles or "coord:" tags
    recovery_tokens: number;          // input+output of the recovery role or "recovery:" tags
    lost_to_cancellation: { calls: number; cost_usd: number; tokens: number };
  };
  models: ModelRow[];                 // by model, most expensive first
  by_role: RoleRow[];                 // by role, most expensive first
  definitions: Record<string, string>;   // the one-line meaning of the metrics, for tooltips
}
interface ModelRow { model: string; badge: Badge; calls: number; completed: number; cost_usd: number;
  input_tokens: number; cached_tokens: number; output_tokens: number; reasoning_tokens: number;
  cache_hit_share: number | null; share_of_cost: number | null; share_of_tokens: number | null;
  efforts: Record<string, number>; roles: Record<string, number> }
interface RoleRow { role: string; purpose: Purpose; /* same numbers as ModelRow */ models: Record<string, number> }
```

`demo/backup` (79 calls): $0.49477, input 198,719 (cached 120,350 = 60.6 %), output 80,448 (reasoning 52,501); Wonder 1 call $0.04707, Spark 78 calls $0.44770; coordination and recovery tokens 0.

---

## Step 2 — the ablation

The same notes through the hand-written regex parser and through Muse, scored against the approved reference. Headline for the UI: *"the parser understood N of M notes, Muse K of M"*, with the differences per note.

### Done
- `src/fractalswarm/bench/tasks/t2_conference/ablation.py` (new): a **kernel scenario**, `fractalswarm.bench.tasks.t2_conference.ablation:ABLATION`, addressed by that `module:attr` path (the loader accepts it; no registry edit). One actor, `ablator`. Every Muse call is therefore a real effect: budget reserved and settled, in the log and the cassette, visible in the lens.
  - **Muse side:** per note one call, role `agent` (the extraction's own role: Spark, effort low), tag `ablate|<note id>`, scopes `contract=ablate-<id>` and `squad=ablation`, at most 6 open at once. Email → schema `t2_ablation_email` (`available[{day, slots[]}]`, `preference morning|afternoon|none`); the instructions are `EXTRACT_GUIDE` minus its memory-tool steps and the closing "Finally…" step; DATA blocks `days` and `slots`; the note is an UNTRUSTED block. Abstract → `t2_ablation_abstract` (`expected_attendance`).
  - **Parser side:** `parse_email` / `parse_attendance` of the T2 fake, a pure function run inside the handler.
  - **Scoring:** an email is *understood* when its (day, slot) cells match the reference exactly **and** the preference is equal; also reported: cells exact, Jaccard, preference. An abstract is understood within **±10 %** of the reference attendance (integer arithmetic: exactly 10 % counts; a reference of 0 only matches 0).
  - **Budget:** squad cap and run cap $0.75. A refused call counts as a missed note and the run still completes. **Deadline:** 900 s on the run's clock; notes with no answer by then count as missed, the run still completes, `result.complete` is `false`.
- New event types only: `ablation.note` (one per note, as it is scored) and `ablation.done` (the summary). No existing payload model changed. An ablation run replays bit for bit, also in a fresh process (`fractalswarm replay RUN --verify` → `MATCH`, checked).
- `src/fractalswarm/api/lens.py`: `POST /api/ablation` and `GET /api/ablation/{run_id}` (shapes below), and the lens tags the calls: `purpose: "ablation"`, `ref: {kind: "ablate", note_id}`. No other file changed (`app.py` already includes `lens_routes`).
- `tests/integration/test_ablation.py` (new, 35 tests): the score (exact, partial Jaccard, preference mismatch, the ±10 % boundary, zero reference), a hand-written approved sample with a **scripted Muse** so the numbers are exact ("parser 3 of 6, Muse 5 of 6", agreement 3 / 2 / 0 / 1), the caveats, the prompt (guide in, memory steps out, note untrusted, never in the instructions), budget refusal, the deadline, a window of one, replay MATCH, the routes (generator notes and posted notes), validation, 429, a job that raises, two runs at once with replay MATCH, the view of a log that never ended, and the params of a CLI run (`TaskSpec` → `run_params`) driving the scenario.

### The two caveats (plus one), written into every result
`result.caveats` is a list of `{id, text, applies}`; the UI shows those with `applies: true` next to the headline.
1. **`generator`** (applies when the notes are the generator's): the regex wins by construction, its patterns are the phrasings the generator writes. Read the comparison on notes a person wrote.
2. **`reference`** (applies otherwise): Muse seeds the approved reference and a person approves it, so part of the agreement with Muse is the person accepting its reading.
3. **`fake`** (applies when every Muse call came from the fake backend; **not in the brief**): the fake T2 model *is* `parse_email`, so on a $0 run the parser and "Muse" agree by construction. A $0 run proves the plumbing and the scoring, not the comparison. Detected from the response ids (`resp_fake_…`), so it cannot be forgotten.

### Where the notes come from
- **Generator / CLI TaskSpec:** `params.corpus` + `params.truth` (what `run_params(spec)` records). The reference is the generator's truth; `source` is `generator` because the truth carries `patterns`. Options in `params.ablation`: `emails`, `abstracts` (first N by id; default all: 32 + 48 = 80 on seed 1).
- **Approved intake (W2):** confirmed by the coordinator (backend-design §4): the approved reference uses the checker's truth schema (`track_of`, `speaker_of`, `attendance`, `availability`, `preferences`) and `run_params` builds the corpus in the generator shape (`emails[{id, speaker_id, body}]`, `talks[{id, abstract}]`, `days`, `slots`). A run launched from a TaskSpec with an intake input therefore works with no change: its params carry `corpus` and `truth`, and `source` is `approved` (no `patterns` in the truth). **The one seam is `cases_from_corpus(corpus, truth)`.** I do not parse `approved.json` myself: W2 exposes one pure converter approved intake → `(corpus, truth)`, and a later `source: "approved"` on `POST /api/ablation` will call it. Until it merges the ablation is built and tested on `generate(seed)`; `generator.live_sample` does not exist on this branch yet.
- **Inline:** `params.ablation = {cases: [Case], frame: {days, slots}, source: "inline"}`, what `POST /api/ablation {source: "inline"}` records. For notes with a reference written by hand (the tests' approved sample).

### Endpoint shapes (for W5)
Errors are `{"error": "<text>"}`: 404 (unknown run, or not an ablation), 422 (the body does not fit), 429 (two ablations are already recording), 501 (`backend: "real"`).

```ts
interface Slot { index: number; start: string; end: string }          // "09:00", "09:45"
interface Reading {                                                    // email → available/preference; abstract → expected_attendance
  available?: { day: number; slots: number[] }[]; preference?: "morning" | "afternoon" | "none";
  expected_attendance?: number }
interface Case { id: string /* [\w.:@-]{1,64} */; kind: "email" | "abstract";
                 subject: string; text: string /* ≤ 20,000 chars */; reference: Reading }

// POST /api/ablation  (fake backend only)
interface AblationRequest {
  source?: "generator" | "inline";   // default "generator"
  seed?: number;                     // default 1: the generator's seed; it also salts the run id
  emails?: number; abstracts?: number;          // generator: first N by id, 0..200, default 8 and 8 (not both 0)
  cases?: Case[]; frame?: { days: number[]; slots: Slot[] };   // inline only; ≤ 200 cases; frame defaults to the generator's
  backend?: "fake" | "real";         // "real" → 501: the coordinator launches it (CLI / job manager, preflight and SPEND)
}
// → 202 { run_id, notes, url, started: true }; 200 { …, started: false } if that exact request already has a run
// The run id is "ablation-" + 8 hex of the request's digest: the same request is the same run.

// GET /api/ablation/{run_id}   — poll until status is not "running"
interface AblationStatus {
  run_id: string;
  status: "running" | "completed" | "halted" | "failed" | "interrupted";
  error: string | null;                         // "RuntimeError: …" when failed
  progress: { done: number; of: number };
  result: AblationResult | null;                // null until ablation.done
  notes: AblationNote[];                        // in the order of the cases; grows while running
}
interface Scored { reading: Reading | null; text: string | null;   // text: the reading in words, ready to show
                   score: EmailScore | AbstractScore }
interface AblationNote {
  note_id: string; kind: "email" | "abstract"; subject: string;
  text: string;                                 // the note itself (untrusted: render as text)
  reference: Reading; reference_text: string | null;
  parser: Scored;
  muse: Scored & { effect_id: string | null; error: string | null };   // error: why Muse has no reading
}
type EmailScore = { understood: boolean; cells_exact: boolean; jaccard: number; preference: boolean };
type AbstractScore = { understood: boolean; within: boolean; error: number | null; error_pct: number | null };
interface Side { understood: number; of: number;
  emails: { of: number; understood: number; cells_exact: number; preference: number; mean_jaccard: number | null };
  abstracts: { of: number; understood: number; mean_error_pct: number | null } }
interface AblationResult {
  complete: boolean;                            // false: the deadline cut it; unanswered notes count as missed
  headline: string;                             // "the parser understood 3 of 6 notes, Muse 5 of 6"
  source: "generator" | "approved" | "inline"; backend: "fake" | "real" | "mixed" | "unknown";
  notes: number; parser: Side; muse: Side;
  agreement: { both: number; only_muse: number; only_parser: number; neither: number };
  differences: string[];                        // note ids where the two readings are not the same
  caveats: { id: "generator" | "reference" | "fake"; text: string; applies: boolean }[];
  definitions: Record<string, string>;          // tooltips: understood, jaccard, agreement, differences
}
```
`status: "completed"` also covers a run the deadline cut: read `result.complete`. Each Muse call is in the lens: `GET /api/runs/{run_id}/calls` (purpose `ablation`, `ref.note_id`) and `…/calls/{effect_id}` (the prompt with the note as untrusted, the answer, the cost). The run is an ordinary run in `GET /api/runs`.

Real bodies (fake backend, two posted notes): `POST` → `{"run_id":"ablation-b7874c4c","notes":2,"url":"/api/ablation/ablation-b7874c4c","started":true}`; a note:
```json
{"note_id":"T90","kind":"abstract","subject":"T90","text":"A full room is expected: organizers say about 80 attendees.",
 "reference":{"expected_attendance":80},"reference_text":"about 80 attendees",
 "parser":{"reading":{"expected_attendance":80},"text":"about 80 attendees","score":{"understood":true,"within":true,"error":0,"error_pct":0.0}},
 "muse":{"reading":{"expected_attendance":80},"text":"about 80 attendees","effect_id":"eff-3.3","error":null,
         "score":{"understood":true,"within":true,"error":0,"error_pct":0.0}}}
```

### Running it with the real Muse (the coordinator's, with Yoel's OK)
- `POST /api/ablation` never spends: `backend: "real"` is a 501. A real run needs the real plumbing the CLI and W2's job manager already have (key, firewall, project ledger, preflight, SPEND).
- **Request for the coordinator (cli.py is W1/W2's, so I have not touched it):** `fractalswarm run <t2 taskspec> --scenario ablation` needs `run` to accept `ablation` in its `--scenario` check, to pass `fractalswarm.bench.tasks.t2_conference.ablation.SCENARIO` to `record_run`, and to print `ablation.done`'s headline instead of looking for a `task.result` (it would otherwise exit 1 with "no task.result", though the run is recorded). About 10 lines. I checked with a scratch run that the params `run` builds from the T2 TaskSpec drive the scenario (80 notes, 408 events, replay MATCH, fake-priced $0.13 for the 80 calls; the T2 TaskSpec's own cap is $2). W2's job manager would need the same scenario allowance to launch it from the UI. I can make the cli.py edit and test it at $0 if you say so.
- Cost: 80 Spark calls on the generator's notes (fake-priced $0.13); the budget line in backend-design §3 says ≈ $0.5 for intake and ablation together.

### Deviations
1. **A third caveat, `fake`**, beyond the brief's two (see above). Without it a $0 result reads as "Muse is as good as the parser".
2. **`POST /api/ablation` answers 501 to `backend: "real"`** instead of running it. The brief says "fake by default" and "the coordinator runs the real one": the route cannot reserve budget against the project ledger or ask for SPEND, which the job manager does.
3. The route runs the fake ablation on a **daemon thread in the API process**, not a subprocess (W2's job manager is for real runs). It is $0 and takes under two seconds for the 80 notes (measured with interpreter start included), on the sim clock; a thread was chosen over an asyncio task so the run does not depend on the request's event loop (the test client ends it with the request). At most two at a time. If you want it out of the API process like real jobs, it moves to W2's job manager unchanged: the scenario is addressed by its path.

### Limits to know
- The run id is a digest of the request, so the same request is the same run (`started: false`). A run whose server was killed mid-way stays `interrupted` for that request; change `seed` for a fresh one.
- **Privacy of live input.** Runs are written to the catalog's runs dir (`~/.fractalswarm/runs` under `serve`), which is outside git. W2's plan keeps live-input runs in `FRACTALSWARM_PRIVATE_DIR`, pseudonymizes emails before a corpus enters a run log, and has the bundler refuse runs whose `input.source` is `intake`. An ablation recorded by `POST /api/ablation` carries no such `input` marker, so **notes a person typed must not be posted to a server whose runs dir is bundled**; the fake route is for generator notes and the hand-written sample. For real live input the run goes through W2's job manager (private dir, marker). To settle once W2's converter is in.
- `normalize` makes each day appear once with its slots sorted and unique, and leaves out days with no slot, on both readers and the reference, so equivalent answers are not scored apart.
- The regex's preference defaults to `none` and its availability to "all available", exactly as the fake T2 model does; a note it cannot read counts against it.

### $0 reference comparison
(see the end of this file once recorded)

## Step 3 — arbitration (not started)
Waits for the coordinator's word that W1's durable modes have merged. Deadline: merged by Sun Nov 1, 14:00, or dropped before the 20:00 freeze.
