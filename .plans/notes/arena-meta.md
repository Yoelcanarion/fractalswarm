# Arena notes — W3 `meta`

Branch `Yoelcanarion/arena-meta` (from `Yoelcanarion/arena`, Phase 0 end `3b1fe9b`).
Owner of: `api/lens.py`, the ablation, Wonder arbitration. Only the coordinator edits `.plans/progress.md`.

| Step | State |
|---|---|
| 1. Muse lens API (merge point 1) | **done**, see below |
| 2. Ablation (merge point 2, own commit) | **done and merged** into arena at 9140dce (my 73a33fe); see "Step 2" below |
| 3. Wonder arbitration (merge point 2, own commit) | **done and merged** into arena (24995b5); see "Step 3" below |
| 4. The answer path of `escalation.opened` | **built, tested at $0, merge_ready**; suite 1924 passed, references 43/43; see "Step 4" below |

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
  kind: "plan" | "judge" | "agent" | "ablate" | "arbitrate" | string | null;
  goal_id?: string; attempt?: number;
  contract_id?: string;                   // judge, agent
  contract_kind?: string; step?: number;  // agent turns only ("extract", "place", "blurb")
  note_id?: string;                       // kind "ablate": the note this Muse call read (step 2)
  key?: string;                           // kind "arbitrate": the disputed fact (step 3); attempt: 1, 2 after a takeover
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

### `GET /disputes` → the semantic disputes of the run (step 3; step 4 adds the person's answer)
`{ run_id, ended, now_ts, count, open, waiting, disputes: Dispute[] }`. `ended` is true when the log holds `run.completed` or `run.halted`; `open` counts the disputes with no ruling; `waiting` counts the escalations a person can still answer (`escalation.state == "waiting"`); `now_ts` is the virtual time the log has reached (the largest `ts_virtual` of the run's events), the clock to hold `escalation.deadline_ts` against. A run never waits on a person, so a dispute can still be open when it ends: that is what this route lists. A run with no dispute (arbitration off, or nothing disagreed) answers `count: 0`. Unknown run: 404.

```ts
interface Dispute {
  key: string; subject: string;           // "speaker:S02:availability", "S02"
  status: "open" | "ruled" | "answered" | "overruled";  // answered: a person confirmed the ruling; overruled: chose another candidate
  opened_seq: number; opened_ts: number;  // the first collision.detected{kind: "semantic"} for the key
  goal_id: string; holder: string;        // the goal and the agent whose publish opened it
  lca: string | null;                     // the goal whose owner arbitrates; null until arbitration.requested
  candidates: { label: string; value: any; works: string[]; sources: string[] }[];  // the board's last word before the ruling
  calls: { attempt: number; effect_id: string; actor: string; status: CallStatus; model: string | null;
           cost_usd: number; estimated: boolean; started_ts: number; ended_ts: number | null;
           cancel: Cancel | null }[];     // one per arbitration call, in order; effect_id opens GET /calls/{effect_id}
  ruling: null | { winner: string; work: string; reason: string; confidence: number; evidence: string[];
                   by: "arbiter" | "agreement" | "fallback"; attempt: number; reused: boolean;
                   arbiter: string; seq: number; ts_virtual: number };
  escalation: null | { id: string; options: string[]; default: string; confidence: number;
                       timeout_ms: number; ts_virtual: number;
                       goal_id: string; question: string;       // the goal whose owner judges an answer; one English sentence
                       deadline_ts: number;                     // ts_virtual + timeout_ms, in the run's virtual time
                       state: "waiting" | "answered" | "overruled" | "expired" | "closed";
                       answers: { choice: string; by: "human"; accepted: boolean; overruled: boolean;
                                  reason: string; seq: number; ts_virtual: number }[] };  // every answer the log judged, in order
  answer: null | { choice: string; by: "human"; overruled: boolean; seq: number; ts_virtual: number };  // the first accepted one
  standing: null | { winner: string; by: "arbiter" | "agreement" | "fallback" | "human" };  // the label the verified fact stands on
  why_open: string | null;                // one English sentence for a dispute with no ruling, else null
}
```
**Answering (step 4).** `escalation.state` is `waiting` while a person can still answer: no accepted answer yet, the log has not passed `deadline_ts` and the run has not ended. Then `POST /api/runs/{run_id}/escalations/{escalation.id}` with `{choice}`, a label from `escalation.options` (the route reads the goal from the log); it answers 409 unless the run is live and was launched by the API. The owner of `escalation.goal_id` judges the answer from the log and writes `escalation.answered`; the next `GET /disputes` lists it in `escalation.answers` (with `accepted` and, when not, a `reason`). `state` becomes `answered` (the choice was the ruled label), `overruled` (another candidate: `standing` moves to it and `by` is `"human"`; `ruling` stays what the arbiter said), `expired` (the log passed `deadline_ts` with no accepted answer) or `closed` (the run ended before the deadline). An ignored answer (not an option, an unknown id, a second answer, after the deadline) is listed with `accepted: false` and leaves `state` as it was. A UI counts the time left as `deadline_ts - now_ts`, in virtual time, not by the wall clock. `status` follows `state` (`answered`, `overruled`) once an answer is accepted, else it stays `ruled`.
`why_open` is read from the dispute's last call: "no arbitration call was made: nobody had taken the dispute up when the log ended" · "o0 finished its work before the arbiter answered; its call was cancelled" · "the arbiter's call was cancelled: o0 was killed by chaos (kill_coordinator)" · "the arbiter's call was still in flight when the log ended" · "the arbiter's call ended error and no later attempt was made" · "the arbiter's answer is in the log and no ruling followed it". The `ref` of an arbitration call in `GET /calls` is `{kind: "arbitrate", key, attempt}`.

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
- **The CLI edit** (`cli.py` is W1/W2's; the coordinator said GO, so it is one additive edit, listed in the merge): `fractalswarm run <t2 taskspec> --scenario ablation` now works. It is made on top of arena's `--scenario` check with W1's durable modes.
  - `run` accepts `ablation` in its `--scenario` check and passes `ablation.SCENARIO` (the `module:attr` path) to `record_run`, so `runs.py` is untouched.
  - It refuses, before anything is recorded: a TaskSpec whose `task` is not `t2_conference` (the ablation reads a T2 corpus), and `--chaos kill-half` (there is nothing to kill). `C1`–`C3` still inject API faults on the Muse calls. The other flags (`--cross-audit`, `--feasibility-report`, the TaskSpec's market and scaling) are recorded in the params and ignored, as they are for the baselines.
  - It prints `ablation.done` instead of looking for a `task.result`: the headline, how the notes split (both, only Muse, only the parser, neither), what cut the run short, and the caveats that apply. The text comes from `ablation.summary_lines`. Exit 1 when the run has no `ablation.done` (halted) or the deadline cut it (`complete: false`); 0 otherwise.
  - Checked at $0 (fake backend, scratch dirs): `t2-conference.yaml` gives 80 notes, 408 events, fake-priced $0.130851, `replay --verify` MATCH. Five tests (`tests/integration/test_ablation.py`, section "fractalswarm run --scenario ablation"): the output and the replay, a CLI-recorded run read by `GET /api/ablation/{run_id}` and the lens, the refusals, a run cut by its deadline, a run halted before it ended. Eight mutations of the edit are each caught by one of them.
  - W2's job manager needs the same allowance to launch an ablation from the UI: `ablation.SCENARIO` as the scenario and a T2 TaskSpec's `run_params`.
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
- **Suite:** 1133 passed at 73a33fe, accepted by the coordinator.
- **References:** 43 of 43 runs identical to the Phase 0 set (`~/.fractalswarm/refs/phase0-3b1fe9b`) by `compare_refs.py`: the 11 CLI runs and the 32-cell fake matrix. The ablation adds a scenario addressed by its `module:attr` path and two new event types, and touches no default path, so the default-path logs did not move.

## Step 3 — Wonder arbitration at the LCA

Built on arena `b443893` (W1's durable modes and W2 steps 1–4 are in). Off unless `params.arbitration` is set; nothing in a default run's events moves.

### What a dispute looks like in the log
1. Two contracts publish different availability for one speaker (`speaker:S02:availability`). The board marks the fact `disputed` and logs `fact.published{status: "disputed"}` and `collision.detected{kind: "semantic", goal_id: <the later publisher's goal>, holder: <its agent>, conflicts: [{key, subject, candidates: [{label, value, by: [{work, contract, goal, agent, squad, sources, lamport}]}]}]}`. One candidate per distinct value (canonical JSON), labelled A, B, … once and for good. A retry of the same work (`goal/contract`) takes back its earlier word; a rival with the same value is not a dispute.
2. The board sends `arbitration.request{key}` to the owner of the lowest common ancestor goal (the tree's owner of the LCA, else the root's). The owner takes the dispute up at once, on every tick (`_reconcile` for the swarm, the 1 s `central.tick` for the central modes), and after a takeover or restart.
3. `arbitration.requested{key, subject, attempt, lca, arbiter, candidates: [work, …], fence}`, then one `llm` effect tagged `arbitrate|<key>|<attempt>`, role `arbiter` = **muse-wonder-1.0, effort high, 8192 tokens** (checked in the cassette). The prompt carries the candidates' values, the key/subject and the speaker's email as `<<<UNTRUSTED …>>>` blocks; the header and the instructions carry none of it. Not a coordination token (`coordination_tokens == 0`).
4. `arbitration.ruled{key, subject, winner (label), work, contract, value, reason, confidence, evidence: [email ids], attempt, by: arbiter | agreement | fallback, arbiter, lca, reused, fence}`, then `collision.resolved{kind: "semantic", goal_id, resolution}`, `msg.sent fact.resolve{key, contract, by}` to the board, `msg.sent arbitration.ruling{key}` to the owners of the candidates' goals, and the board's `fact.resolved{key, contract, version, by}`: the winner's value is now the verified, global fact.
5. Below 0.6 confidence, also `escalation.opened{id: "arbitration:<key>", kind, key, goal_id, question, options: [labels], confidence, timeout_ms: 60000, default: <the ruled label>, fence}`.
6. Effect on the work: `_dispatch` asks `arbitration.gate` for each contract it is about to send. A `place` whose speakers include a disputed key waits (a `SetTimer` tagged `arb.hold|<goal>`, one per wait) until the ruling or until **30 s after the dispute opened**; with a ruling in the log it goes out with the ruled value laid over its own, with no ruling by then it goes out with its own values. The timer is cancelled when the wait ends early.

Two unusable answers (not JSON, a winner that is no label, an error, a refusal) end in a ruling without the model: the oldest value by Lamport clock, `by: "fallback"`, confidence 0, plus an escalation. No evidence in the LCA goal's data does the same. One unusable answer is asked again with the problem as feedback.

### Where it lives
- `actors/arbitration.py` (new): the events, `DisputesView` (reducer name `disputes`: contract → work, the disputes and their candidates, the rulings, the arbitration calls by tag), `lca_of`, `join`, `read_ruling`, `step` (the owner's turn), `gate`, the prompt.
- `bench/tasks/t2_conference/arbitration.py` (new): T2's side — `fact_keys`, `overlay`, `evidence`, the fake arbiter (registered in `fake.HANDLERS`, reads the email the way the fake extractor does) and `with_dispute(script, speaker, session)`, the fake script variant that makes one session misread one speaker.
- `actors/board.py`: `_contest` (detection), `_resolve` (applies the order), `promote` skips disputed keys.
- Light edits, listed for the merge: `actors/orchestrator.py` (+88 −9): init flag, `_opt_ins`, `_handle` (arbitrate / arb.hold tags, request / ruling topics), `_dispatch` (the gate, the timer, the cancel), `_arb_woken`, `_arb_ruled`, `_arbitrate`, `_parent_of`, one call each in `_reconcile` and the central tick, and **in W1's durable code** `_crash` (cancels the arbitration call in flight) and `_crash_durable(state, view)` (the same, `durable` only; the signature gained `view`). `actors/swarm.py` (+13 −2): `DisputesView` in the reducers, the flag to the board and the root, a `ValueError` for a task with no hooks. `planning/taskspec.py` (+7 −1, the coordinator's OK): `arbitration: bool = Field(default=False, exclude=True)` and `params["arbitration"] = True` in `_with_economy`. `api/lens.py`: sentences for the new events, `ref: {kind: "arbitrate", key, attempt}` on the arbitration call (the lens already labelled the `arbiter` role as `purpose: "arbitration"`), and the route `GET /api/runs/{id}/disputes` (shape under "Endpoint shapes").

### What happens when the arbiter dies mid-call (forced dispute S02 at track-ai/d1, an arbiter 8 s slow, o0 killed at 30 %, all checked in the log)
| System | The call in flight | Who finishes it |
|---|---|---|
| swarm | cancelled by the kill (`effect.cancelled` by `chaos`) | the heir of the root, o1, after `member.dead` and `tree.adopted`: `arbitration.requested` attempt 2 under its own fence; one `ruled`, one `fact.resolved` |
| central | cancelled with the process (`baseline.crashed`) | the restarted o0, attempt 2 |
| durable-max | kept (a durable job); it ends during the outage | the restarted o0 reads the answer from the log: attempt 1, `reused: false`, no second call |
| durable | lost with the process (listed in `baseline.crashed.lost`) | the restarted o0, attempt 2 |
An answer a dead owner got is adopted by the heir without a new call (`reused: true`; unit-tested). Replay is MATCH in every case.

### Tests
- `tests/unit/test_arbitration.py` — 69: the events validate, the LCA, candidates, reading the arbiter's answer, the view, the gate, the board's side (detection, promote, resolve, settled keys), the owner's turn (ask, wait for a live caller, ask again for a dead one or a cancelled one, adopt an answer, fallback, agreement, escalation, the finished goal), spotlighting (an email cannot close its block), T2's hooks, the lens sentences.
- `tests/integration/test_arbitration.py` — 37, on 13 fake T2 runs of 1–3 s: a dispute settled at the root (S02) and at the track (S04); the ruling keeps the reading the email supports; both sessions place with the ruled value; the hold, and the timer left behind; the hold timing out against a slow arbiter; a doubtful and an unusable arbiter; the four kills above; off-path identity (`quiet` vs `default`: with nothing in dispute, an arbitration-on run is event-for-event the run without it); replay MATCH of each recording.
- 22 deliberate breakages of the mechanism (the gate, the hold, the ticks, the crash cancels, the board's rules and its check of the log, the fallback, adoption, the escalation, spotlighting, the flags) are each caught by at least one test.

### Deviations
1. **`escalation.opened` has the timeout path only.** The ruling is applied at once and the escalation says a person may still answer within `timeout_ms` (60 s), `default` being the ruled label. Nothing waits on the person. There is no answer path: `control.injected` has no payload yet (W2 step 7 is not approved). When it exists it needs one more branch in `DisputesView` and a re-ruling; the coordinator asked to keep it behind a check for the event type, and there is nothing to check yet.
2. **The board applies `fact.resolve` only if the log holds a matching `arbitration.ruled`** (same key, same winner contract). A stale owner that was fenced out may still send the order; the log has no ruling from it, so the board ignores it. Not in the brief; it keeps the board and the log from naming two winners.
3. **Light edits outside the brief's list:** `api/lens.py` sentences (mine), `actors/swarm.py` and `planning/taskspec.py` (the coordinator's OK, on top of W2's), W1's `_crash` and `_crash_durable` (minimal, gated by the flag).
4. **A finished goal reads an answer that comes in late but pays for no new call.** If the root completes first, the call is cancelled with the run and the dispute stays open in the log.
5. **`DisputesView` is always installed**, whatever the flag, so replay of a log needs no knowledge of it; it adds no event.

### Decisions on the open questions (the coordinator, at the merge, 24995b5)
1. **Answering an escalation: after W2's step 7, as a separate commit.** The shape W2 proposes, which fits: `control.injected{op: "answer", to: "goal:<escalation.goal_id>", body: {escalation_id, choice}}`, `escalation_id` being the escalation's `id` (`arbitration:<key>`) and `choice` one of its `options` (a candidate label). The ruling is already applied when the escalation opens, so an answer equal to the ruled label confirms it and a different one is an overruling: new event types `escalation.answered{id, choice, by, accepted, overruled}` and `arbitration.overruled{key, winner, contract, value}`, and a board path that replaces the verified fact. Ignored with `accepted: false`: a choice that is not an option, an unknown id, a second answer, an answer after `timeout_ms`. Placed contracts keep their value; those not yet dispatched take the new one. **Not built yet:** it waits for W2 to document the applied event's payload keys and whether a reducer sees it.
2. **No closing event for `escalation.opened`:** fine; the UI derives the end from the event's time plus `timeout_ms`.
3. **A dispute still open when the run ends is not waited for** (a run must not stall on a person). It stays open in the log with no ruling, and `GET /api/runs/{id}/disputes` lists it with `status: "open"` and `why_open`. The contracts went out with their own values after the 30 s, so the result is unaffected.
4. **`HOLD_MS` stays 30 s.** If a real run shows the hold timing out, the coordinator and I decide before the handler freeze (Sun Nov 1, 20:00).

### Limits to know
- **Only T2 has the hooks** (`TASK_HOOKS`): a run with `arbitration` on another task fails at boot with a `ValueError`. Only a `place` reads availability, so only a `place` waits.
- **A disputed fact is invisible** to every squad but the first publisher's (the search filter is "verified or my squad"), until it is ruled.
- **In `single` and `pipeline` no dispute arises**: the later session finds the first one's verified fact and does not publish its own. In the swarm and the central modes the sessions run together and both publish.
- **Constants, not config:** hold 30 s, confidence 0.6, two unusable answers, escalation timeout 60 s (`actors/arbitration.py`).
- **The dispute is forced only in the fake script variant** (`with_dispute`, tests and probes). Whether real Muse extractions of one speaker ever disagree is for the real run to show; with the fake, a default run has no dispute and costs nothing extra. One arbiter call costs $0.0195 at fake prices (Wonder high), a few cents with the real reasoning tokens.
- **A late ruling does not redo work.** After the 30 s a `place` has gone out with its own values; the ruling then only settles the fact. That includes a re-placed contract after a booking conflict.
- Claims: "no supervisor needed" is the only thing these runs back (the heir and the restarted coordinator both finish the job). They do not say arbitration is cheaper or more reliable than anything.

### $0 reference comparison
- **Suite** at `e5061b8` (`pytest -m 'not promptguard'`, run in three chunks because of the 9-minute limit): unit 813 passed, integration 330 + 237 passed, 3 promptguard deselected, 0 failed. `ruff check` and `ruff format --check` clean.
- **What the suite caught:** the board's `_tool` had gained a required `state` argument, and the LangGraph baseline calls it on a bare `Blackboard` (`baselines/langgraph_teams.py:521`); 11 baseline tests errored and 3 more failed downstream. `state` is optional again (without it there are no disputes) and a unit test pins the call shape. The baseline file is untouched.
- **References:** 43 of 43 runs identical to `~/.fractalswarm/refs/arena-c2b5e08` by `compare_refs.py` (the 11 CLI runs and the 32-cell fake matrix; event counts and hash-chain heads equal). Arbitration is off unless `params.arbitration` is set, and `DisputesView` adds no event.
- `fractalswarm demo --verify --no-serve --no-browser` (scratch dirs): MATCH, 8177 events.
- **After merging arena `13f2909`** (8531784, W4 steps 8-9 and W2 steps 5-6, plus the progress commit) into the branch at `418a5d8`: two textual conflicts, both resolved without losing either side. `cli.py`: both sides added a block after `run_id = ...` (my ablation scenario path, W2's `--start-barrier`); both kept. `tests/integration/test_ablation.py`: the same content-type fix on both sides; arena's wording taken. Rerun on the merged head: 415 targeted tests passed (arbitration unit + integration, ablation, lens, LangGraph baseline, API, guard, arena, run status, launch API, replay verify, takeover check, durable rivals, central baseline), and the references are again 43 of 43 identical to `arena-c2b5e08`. The full suite was not rerun on the merged head; it ran at `e5061b8` before the merge.

## Step 4 — the answer path of `escalation.opened`

Built on arena `0025e22` (W2 step 7 in). Off unless the run has arbitration on; a run that nobody answers is the run it was (the references below).

### What an answer does (all of it in the log)
1. **The click.** `POST /api/runs/{id}/escalations/{eid}` (W2) drops `control.injected{op: "answer", to: "goal:<escalation.goal_id>", body: {escalation_id, choice}}` into the live run. Every live orchestrator sees it; the owner of the goal, by its own tree view at that event (after a takeover, the heir), judges it. The judgement reads the log and nothing else.
2. **The verdict**, always logged: `escalation.answered{id, choice, by: "human", accepted, overruled, reason, fence}`, idem key `escalation.answered:<control seq>` (one verdict per control, whoever writes it). Accepted when all four hold: the escalation exists at that goal and has a ruling; nobody answered it before (an ignored answer does not count); the answer was given within `timeout_ms` of the escalation (judged at the control's `ts_virtual`; exactly at the end is in time); the choice is one of its `options`. Otherwise `accepted: false`, `reason` says which ("no escalation X is open at G", "the escalation was already answered (B)", "the answer came N ms after the time to answer (60000 ms)", "C is not one of the options (A, B)"), and **nothing else moves**.
3. **A choice other than the ruled label overrules it** (`overruled: true`): `arbitration.overruled{key, winner, contract, value, work, fence}` (idem `arbitration.overruled:<key>`, one per key) and `msg.sent fact.overrule{key, contract, by}` to the board. The board applies the order only if the log holds that overruling for that contract, a ruling was applied for the key, and the fact does not stand on that contract already (a repeated order is a no-op). It publishes the chosen candidate's value as the verified, global fact (version + 1; the blackboard replaces a verified fact with a verified one) and logs `fact.resolved{key, contract, version, by}`. A choice equal to the ruled label **confirms** it: the verdict is the only event.
4. **Effect on the work.** A `place` already dispatched keeps the value it went out with; one not yet dispatched takes the person's choice (`gate` overlays the value the log's overruling names). In the overrule run `track-hci/d1`'s place had gone out with the ruled value and `track-ai/d1`'s took the person's.
5. **An answer that reached no owner** (the click landed after the owner died and before the heir's `tree.adopted`, or while a central coordinator was down): the log holds it. `DisputesView` keeps every well-formed answer control until some verdict for it appears (`unjudged()`), and `step()` (the owner's turn: the 1 s tick, takeover, restart) judges the oldest one this orchestrator owns now, **as of the click's `ts_virtual`**, one per turn. In the gap run the answer lands at 32.4 s with o0 dead, the heir o1 adopts at 38.0 s and writes the verdict at 39.0 s under its own fence (epoch 11, member o1, resource root).

### Where it lives
- `actors/arbitration.py` (+226 −6): the events, `DisputesView` (reads `escalation.opened`, `escalation.answered`, `arbitration.overruled` and the pending answers), `judge`, `answer`, `_judge_unjudged`, `overruling_of`, `_owns`, `gate` (overlays `dispute.value()`).
- `actors/board.py` (+36 −6): `settled` is now a dict key → candidates (it was a set; only membership was used); `_overrule`; the Fact building shared with `_resolve` (`_verified`).
- `actors/orchestrator.py` (+8 −2) — **out-of-brief edit** (the brief allowed it, to be listed): in `_handle`, the `control.injected` branch gets `if state["arbitration"] and event.payload["op"] == arbitration.OP_ANSWER: return state, arbitration.answer(...)` before `_controlled`; `_arb_tools` is the `Tools(...)` that `_arbitrate` built, extracted so both use it.
- `api/lens.py` (+114 −8): sentences for `control.injected` (every op: chaos, approve, replan, answer, any other), `escalation.answered` and `arbitration.overruled`; `/disputes` (shape above). Two step-3 unit tests that pinned the exact response shape now pin the new one.

### Replay safety
Two new event types; no field added to an existing payload. The handler branch is gated by `state["arbitration"]` and `op == "answer"`; `DisputesView` was already always installed and now also reads the new inputs, which no earlier log holds in a form that changes anything. A run without arbitration, or with an escalation nobody answers, logs what it logged before. Every scenario below replays MATCH in process and in a fresh process.

### Tests
- `tests/unit/test_escalation_answer.py` — 76: the events validate; the view's inputs (an answer attaches, pending answers, the first accepted answer, the first overruling wins); `judge` rule by rule (unknown id, another goal, no ruling, not an option, an option no candidate has, a candidate that was not offered, a second answer, an ignored first answer does not count, late by 1 ms, in time exactly at the end, the escalation's own timeout); `answer` (confirm, overrule both ways, each ignored case logs only its verdict, not the owner, not addressed to a goal, garbage body, truncation, judged at the click's time); `step` (a pending answer judged as of the click, too late judged late, judged once, another owner's goal left alone, one per turn); the gate; the board path (applies the person's choice; idempotent; refuses an order the log does not back, one for another contract, one for a candidate that was not chosen, a key with no ruling, a non-candidate; an overruled key is never disputed again); the lens (sentences for every op and both events; `/disputes` fields, states, deadline, `now_ts`, `waiting`, `standing`).
- `tests/integration/test_escalation_answer.py` — 25 on 13 fake T2 runs of 1–3 s (swarm unless noted): the unanswered baseline; **confirm** (the log is the baseline plus the control and its verdict); **overrule** (the arbiter rules B at confidence 0.4, the person picks A: fact versions 3 then 4, the early place keeps B's value, the later one takes A's); **fumbles** (an unknown id, a non-option, the right answer, a second answer: only the right one moved anything); **late** (the work after the ruling made 50 s slower so the run outlasts the 60 s window; the answer comes after it: logged, nothing moves); **heir** (o0 killed after the escalation, the answer after `tree.adopted`: the heir judges under its own fence); **gap** (the answer lands while nobody owns the goal; the heir judges it after adopting); **central, durable-max, durable** (the coordinator is down when the answer lands; the restarted one judges it); **one HTTP test** (a live run recorded in a thread, its driver held at the person's turn: `GET /disputes` says `waiting` with the options and the deadline, three `POST`s through `/api/runs/{id}/escalations/{eid}`, release, `GET /disputes` says `overruled`). Each recording replays MATCH in process and in a fresh process.
- **Mutation check of the ignore rules:** 26 deliberate breakages (the option check twice, the goal check, the unknown-escalation check, the second-answer check, the late check and its boundary, judging at handling time instead of the click, ownership twice, the pending recovery, one answer per turn, the per-control idem key, the board not told, the overruling not logged, `accepted` always true, an ignored answer counting as an overruling, no truncation, the view settling on an ignored answer, a judged answer staying pending, three checks of the board's order, three of the lens), all killed by the unit tests. One survived the first pass: the board's check that the order names the logged choice (my test's order was also refused by the next guard, "already standing on that contract"); a three-candidate test now kills it. The script is not in the repo (it edits sources in place).

### Deviations
1. **Two optional fields on the new events** beyond the agreed shapes: `reason` on `escalation.answered` (the lens and UI say why an answer was ignored) and `work` on `arbitration.overruled`. Both default to `""`. `fence` is what every owner write carries.
2. **Pending-answer recovery** (item 5) is not in the brief. Without it an answer that lands between an owner's death and the heir's adoption is lost for good.
3. **Judged at the control's `ts_virtual`, not at the handler's time** (`view.now`): an heir that finds the answer later must reach the verdict the dead owner would have.
4. **`/disputes` gained fields** (all additive, shape above) and a `status` of `answered | overruled`; two step-3 unit tests that pinned the old exact response were updated.
5. **`board.settled` set → dict** (internal state, derived from the log).

### Limits to know
- **`escalation.answered` is not always a close.** An ignored answer is logged with `accepted: false` and the escalation stays open. W4's `foldHuman` (`web/src/lib/escalations.ts`) treats every `escalation.answered` as a close: it should read `accepted` (or use `escalation.state` / `answers[]` from `/disputes`). Not my file; for the coordinator to pass on.
- **Only while the run is live.** The API answers 409 to a finished run. A track-level escalation stays answerable as long as the run lives: the track's owner stops only when the root ends the run (checked: S04 at track-data/d2, escalation at 51.8 s, goal and run end at 71.2 s).
- **The window is virtual time.** `deadline_ts` is `ts_virtual + timeout_ms`; a control carries the virtual time of the last completion before the driver polled it. On a real run the calls take real time, so it agrees with the wall clock to within one call's latency; a fake run lasts a few wall seconds, so a person cannot answer one in time (the tests inject from the driver).
- **An answer is lost if nobody ever owns the goal again** (every orchestrator that could hold it is dead, no heir adopts it): the control stays in the log with no verdict.
- **Contracts already placed keep their value** (as agreed): after an overruling, a session that placed before the answer still carries the ruled value (in the overrule run `track-hci/d1`'s place has the misread one). In this fake the misreading changes no placement (0 hard violations, 48 of 48 placed, soft score 0.8333 whichever way the dispute goes, answered or not), so a run cannot show an effect on the program; the log shows the values.
- **`ESCALATION_TIMEOUT_MS` stays a constant** (60 s). No test patches it, so a fresh-process replay emits the same payloads.
- Claims: nothing beyond "no supervisor needed": the heir and the restarted coordinator both judge the answer.

### $0 reference comparison
- **Suite** at `8d94433` (`pytest -m 'not promptguard'`, in chunks because of the 10-minute limit): unit 1052; integration 871 (`test_[a-c]*` 289, `[d-k]` 169, `l` 120, `[m-r]` 107, `[s-z]` 186); and the one test that exists only in a whole-suite collection, `test_planning.py::test_schemas_meet_the_strict_mode_rules[IntakeOutput]` (`pytest tests/integration/test_intake_flow.py tests/unit/test_planning.py -k strict_mode_rules`: 13 passed) — 1924 passed, 3 promptguard deselected, 0 failed. `collect-only` of the whole suite says 1924/1927. `ruff check` and `ruff format --check` clean. Before the suite, the touched areas ran alone: `test_arbitration.py` (integration) 44, `test_determinism_lint.py` 28.
- **References:** 43 of 43 runs identical to `~/.fractalswarm/refs/arena-c2b5e08` by `compare_refs.py` (the 11 CLI runs and the 32-cell fake matrix; event counts and hash-chain heads equal), recorded with `scripts/refs/record_refs.ps1` in scratch dirs. A run without an answer logs what it logged before.
- `fractalswarm demo --verify --no-serve --no-browser` (scratch dirs): MATCH, 8177 events.
