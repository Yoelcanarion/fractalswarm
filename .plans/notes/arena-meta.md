# Arena notes — W3 `meta`

Branch `Yoelcanarion/arena-meta` (from `Yoelcanarion/arena`, Phase 0 end `3b1fe9b`).
Owner of: `api/lens.py`, the ablation, Wonder arbitration. Only the coordinator edits `.plans/progress.md`.

| Step | State |
|---|---|
| 1. Muse lens API (merge point 1) | **done**, see below |
| 2. Ablation (merge point 2, own commit) | not started |
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
             | "safety" | "coordination" | "recovery" | "other";
type CallStatus = "ok" | "incomplete" | "error" | "cancelled" | "inflight";

interface Usage { input_tokens: number; cached_tokens: number; output_tokens: number;
                  reasoning_tokens: number; searches: number }   // cached ⊂ input, reasoning ⊂ output

interface CallRef {                       // what the call is for
  kind: "plan" | "judge" | "agent" | string | null;
  goal_id?: string; attempt?: number;
  contract_id?: string;                   // judge, agent
  contract_kind?: string; step?: number;  // agent turns only ("extract", "place", "blurb")
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

## Step 2 — ablation (not started)
Plan: a kernel scenario (`fractalswarm.bench.tasks.t2_conference.ablation:ABLATION`, addressed by its `module:attr` path, so no registry edit), so that its Muse calls are real effects: budget reserved and settled, in the log, visible in the lens. The regex side is a pure function inside the handler. New event types only. Fake backend by default; the real one is the coordinator's.
Caveat for the $0 numbers: the fake T2 model *is* `parse_email`, so on the fake backend the parser and "Muse" agree by construction. The $0 run proves the plumbing and the scoring, not the comparison.

## Step 3 — arbitration (not started)
Waits for the coordinator's word that W1's durable modes have merged. Deadline: merged by Sun Nov 1, 14:00, or dropped before the 20:00 freeze.
