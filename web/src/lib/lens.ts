// The Muse lens: every LLM call of a run, joined from its log by the API (api/lens.py, W3), and the
// pure functions the lens panel and the Muse meter are built from.
//
// The API sends three things, all under /api/runs/{id}:
//   /calls            one row per call: who made it, which model, tokens, cost, latency, status
//   /calls/{effect}   one call in full: prompt, output, the facts it published next to their source
//                     sentences, the events its answer caused
//   /models           the Muse meter: $ and tokens by model, the cache share, coordination and
//                     recovery tokens
// Times are the run's virtual milliseconds, as in the event log, so a call can be placed on the
// playhead: a replay at t shows what had happened by t and nothing after it.
//
// Nothing here reads a payload that an old server would not send: every reader falls back to a
// default instead of throwing, because the lens must never take the run page down.

import { asNumber, asRecord, asString, asStrings } from "./generic";

// ---- the API's shapes (see .plans/notes/arena-meta.md, "Endpoint shapes (for W4)") ----

export type Badge = "wonder" | "spark" | "contributor" | "other";
export type Purpose =
  | "work"
  | "planning"
  | "verification"
  | "arbitration"
  | "intake"
  | "safety"
  | "coordination"
  | "recovery"
  | "ablation"
  | "other";
export type CallStatus = "ok" | "incomplete" | "error" | "cancelled" | "inflight";

export interface Usage {
  input_tokens: number;
  cached_tokens: number; // part of input
  output_tokens: number;
  reasoning_tokens: number; // part of output
  searches: number;
}

export interface CallRef {
  kind: string | null; // "plan" | "judge" | "agent" | "ablate" | ...
  goal_id?: string;
  attempt?: number;
  contract_id?: string;
  contract_kind?: string; // agent turns: "extract", "place", "blurb"
  step?: number;
  note_id?: string;
}

export interface Routing {
  contributor: boolean;
  reason: string;
  findings: { kind: string; category: string; start: number; end: number }[];
}

export interface Cancel {
  kind: "halted" | "actor_stopped" | "coordinator_crash" | "cancelled" | string;
  reason: string;
  fault?: string | null;
  detail: string; // one English sentence, ready to show
  seq: number;
  ts_virtual: number;
  by: string;
}

export interface CallRow {
  effect_id: string;
  seq: number;
  actor: string;
  tag: string | null;
  ref: CallRef;
  role: string;
  purpose: Purpose;
  level: string;
  model: string | null;
  badge: Badge;
  effort: "low" | "medium" | "high" | null;
  max_output_tokens: number | null;
  routing: Routing | null;
  status: CallStatus;
  usage: Usage;
  cost_usd: number;
  estimated: boolean; // cut off before it completed: billed the bench estimate
  latency_ms: number | null;
  attempts: number | null;
  http_status: number | null;
  started_ts: number;
  ended_ts: number | null;
  elapsed_ms: number | null;
  error: string | null;
  incomplete_reason: string | null;
  reissued: { ambiguous: boolean; reason: string } | null;
  cancel: Cancel | null;
}

export interface Refused {
  effect_id: string;
  actor: string;
  tag: string | null;
  level: string;
  key: string;
  worst_case_usd: number;
  ts_virtual: number;
}

export interface CallsResponse {
  run_id: string;
  calls: CallRow[];
  refused: Refused[];
}

export interface FactEvidence {
  field: string;
  source_id: string;
  start: number; // UTF-16 offsets into sources[source_id].text
  end: number;
  text: string;
  score: number;
}

export interface Fact {
  key: string; // "speaker:S12:availability"
  kind: "availability" | "attendance" | "other" | string;
  subject: string;
  value: unknown;
  reading: string | null;
  via: "publish" | "answer" | string;
  reused: boolean; // read from the board, not from this call's sources
  sources: string[];
  evidence: FactEvidence[];
  unmatched: string[]; // fields for which no source sentence was found
}

export interface Source {
  id: string;
  kind: "email" | "abstract" | string;
  text: string;
  speaker_id?: string;
  from?: string;
  subject?: string;
  title?: string;
}

export interface DecisionEvent {
  seq: number;
  type: string;
  actor: string;
  ts_virtual: number;
  summary: string;
  bookkeeping: boolean; // budget.settled: hidden by default
  payload: unknown;
  payload_truncated: boolean;
}

export interface ToolCall {
  name: string;
  call_id: string;
  arguments: unknown;
}

export interface CallDetail extends CallRow {
  request_extras: Record<string, unknown>;
  reported_model: string | null;
  cost_breakdown: { input_usd: number; cached_input_usd: number; output_usd: number; reasoning_usd: number; search_usd: number } | null;
  attempt_log: { status: number | null; latency_ms: number; error: string | null; retry_after_ms: number | null }[] | null;
  prompt: {
    instructions: string | null;
    text: string;
    data: Record<string, unknown>;
    untrusted: Record<string, unknown>;
    tools: string[];
    schema: string | null;
  };
  output: { text: string; parsed: unknown; tool_calls: ToolCall[] };
  decision: { events: DecisionEvent[]; sentences: { field: string; text: string }[] };
  facts: Fact[] | null;
  sources: Record<string, Source> | null;
}

export interface MeterTotals {
  calls: number;
  completed: number;
  cancelled: number;
  errors: number;
  cost_usd: number;
  settled_cost_usd: number;
  estimated_cost_usd: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_hit_share: number | null; // cached / input, completed calls only
  coordination_tokens: number;
  recovery_tokens: number;
  lost_to_cancellation: { calls: number; cost_usd: number; tokens: number };
}

export interface ModelRow {
  model: string;
  badge: Badge;
  calls: number;
  completed: number;
  cost_usd: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_hit_share: number | null;
  share_of_cost: number | null;
  share_of_tokens: number | null;
}

/** What the strip shows: the totals and the models, from the server or folded from the calls. */
export interface MeterView {
  totals: MeterTotals;
  models: ModelRow[];
}

/** The server's meter: a MeterView with the figures only the server can compute (it has the price
 * table) and the one-line meaning of each metric, for tooltips. */
export interface Meter extends MeterView {
  run_id: string;
  cache_saved_usd: number;
  definitions: Record<string, string>;
}

// ---- reading what the server sent ----

const STATUSES: readonly CallStatus[] = ["ok", "incomplete", "error", "cancelled", "inflight"];
const BADGES: readonly Badge[] = ["wonder", "spark", "contributor", "other"];

const num = (value: unknown, fallback = 0): number => asNumber(value) ?? fallback;
const numOrNull = (value: unknown): number | null => asNumber(value);
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

function readUsage(value: unknown): Usage {
  const u = asRecord(value);
  return {
    input_tokens: num(u.input_tokens),
    cached_tokens: num(u.cached_tokens),
    output_tokens: num(u.output_tokens),
    reasoning_tokens: num(u.reasoning_tokens),
    searches: num(u.searches),
  };
}

function readRouting(value: unknown): Routing | null {
  if (value === null || typeof value !== "object") return null;
  const r = asRecord(value);
  const findings = Array.isArray(r.findings) ? r.findings.map(asRecord) : [];
  return {
    contributor: r.contributor === true,
    reason: asString(r.reason),
    findings: findings.map((f) => ({ kind: asString(f.kind), category: asString(f.category), start: num(f.start), end: num(f.end) })),
  };
}

function readCancel(value: unknown): Cancel | null {
  if (value === null || typeof value !== "object") return null;
  const c = asRecord(value);
  return {
    kind: asString(c.kind, "cancelled"),
    reason: asString(c.reason),
    fault: strOrNull(c.fault),
    detail: asString(c.detail),
    seq: num(c.seq),
    ts_virtual: num(c.ts_virtual),
    by: asString(c.by),
  };
}

/** One call row, or null when it is not a call at all (no effect id). */
export function readCall(value: unknown): CallRow | null {
  const r = asRecord(value);
  if (typeof r.effect_id !== "string" || r.effect_id === "") return null;
  const ref = asRecord(r.ref);
  const model = strOrNull(r.model);
  const status = STATUSES.includes(r.status as CallStatus) ? (r.status as CallStatus) : "ok";
  const effort = r.effort === "low" || r.effort === "medium" || r.effort === "high" ? r.effort : null;
  const reissued = r.reissued !== null && typeof r.reissued === "object" ? asRecord(r.reissued) : null;
  return {
    effect_id: r.effect_id,
    seq: num(r.seq),
    actor: asString(r.actor),
    tag: strOrNull(r.tag),
    ref: { ...ref, kind: strOrNull(ref.kind) } as CallRef,
    role: asString(r.role),
    purpose: asString(r.purpose, "other") as Purpose,
    level: asString(r.level),
    model,
    badge: BADGES.includes(r.badge as Badge) ? (r.badge as Badge) : "other",
    effort,
    max_output_tokens: numOrNull(r.max_output_tokens),
    routing: readRouting(r.routing),
    status,
    usage: readUsage(r.usage),
    cost_usd: num(r.cost_usd),
    estimated: r.estimated === true,
    latency_ms: numOrNull(r.latency_ms),
    attempts: numOrNull(r.attempts),
    http_status: numOrNull(r.http_status),
    started_ts: num(r.started_ts),
    ended_ts: numOrNull(r.ended_ts),
    elapsed_ms: numOrNull(r.elapsed_ms),
    error: strOrNull(r.error),
    incomplete_reason: strOrNull(r.incomplete_reason),
    reissued: reissued ? { ambiguous: reissued.ambiguous === true, reason: asString(reissued.reason) } : null,
    cancel: readCancel(r.cancel),
  };
}

/** ``GET /calls``. Rows come in the order the calls started; a row that is not a call is dropped. */
export function readCalls(body: unknown): CallsResponse {
  const b = asRecord(body);
  const calls = (Array.isArray(b.calls) ? b.calls : []).map(readCall).filter((c): c is CallRow => c !== null);
  const refused = (Array.isArray(b.refused) ? b.refused : []).map((value) => {
    const r = asRecord(value);
    return {
      effect_id: asString(r.effect_id),
      actor: asString(r.actor),
      tag: strOrNull(r.tag),
      level: asString(r.level),
      key: asString(r.key),
      worst_case_usd: num(r.worst_case_usd),
      ts_virtual: num(r.ts_virtual),
    };
  });
  return { run_id: asString(b.run_id), calls, refused };
}

function readFact(value: unknown): Fact {
  const f = asRecord(value);
  const evidence = Array.isArray(f.evidence) ? f.evidence.map(asRecord) : [];
  return {
    key: asString(f.key),
    kind: asString(f.kind, "other"),
    subject: asString(f.subject),
    value: f.value,
    reading: strOrNull(f.reading),
    via: asString(f.via, "publish"),
    reused: f.reused === true,
    sources: asStrings(f.sources),
    evidence: evidence.map((e) => ({
      field: asString(e.field),
      source_id: asString(e.source_id),
      start: num(e.start),
      end: num(e.end),
      text: asString(e.text),
      score: num(e.score),
    })),
    unmatched: asStrings(f.unmatched),
  };
}

function readSources(value: unknown): Record<string, Source> | null {
  if (value === null || typeof value !== "object") return null;
  const out: Record<string, Source> = {};
  for (const [id, raw] of Object.entries(asRecord(value))) {
    const s = asRecord(raw);
    out[id] = {
      id: asString(s.id, id),
      kind: asString(s.kind, "email"),
      text: asString(s.text),
      ...(typeof s.speaker_id === "string" ? { speaker_id: s.speaker_id } : {}),
      ...(typeof s.from === "string" ? { from: s.from } : {}),
      ...(typeof s.subject === "string" ? { subject: s.subject } : {}),
      ...(typeof s.title === "string" ? { title: s.title } : {}),
    };
  }
  return out;
}

/** ``GET /calls/{effect_id}``, or null when the body is not a call. */
export function readCallDetail(body: unknown): CallDetail | null {
  const row = readCall(body);
  if (!row) return null;
  const b = asRecord(body);
  const prompt = asRecord(b.prompt);
  const output = asRecord(b.output);
  const decision = asRecord(b.decision);
  const breakdown = b.cost_breakdown !== null && typeof b.cost_breakdown === "object" ? asRecord(b.cost_breakdown) : null;
  return {
    ...row,
    request_extras: asRecord(b.request_extras),
    reported_model: strOrNull(b.reported_model),
    cost_breakdown: breakdown
      ? {
          input_usd: num(breakdown.input_usd),
          cached_input_usd: num(breakdown.cached_input_usd),
          output_usd: num(breakdown.output_usd),
          reasoning_usd: num(breakdown.reasoning_usd),
          search_usd: num(breakdown.search_usd),
        }
      : null,
    attempt_log: Array.isArray(b.attempt_log)
      ? b.attempt_log.map((a) => {
          const x = asRecord(a);
          return { status: numOrNull(x.status), latency_ms: num(x.latency_ms), error: strOrNull(x.error), retry_after_ms: numOrNull(x.retry_after_ms) };
        })
      : null,
    prompt: {
      instructions: strOrNull(prompt.instructions),
      text: asString(prompt.text),
      data: asRecord(prompt.data),
      untrusted: asRecord(prompt.untrusted),
      tools: asStrings(prompt.tools),
      schema: strOrNull(prompt.schema),
    },
    output: {
      text: asString(output.text),
      parsed: output.parsed ?? null,
      tool_calls: (Array.isArray(output.tool_calls) ? output.tool_calls : []).map((c) => {
        const x = asRecord(c);
        return { name: asString(x.name), call_id: asString(x.call_id), arguments: x.arguments };
      }),
    },
    decision: {
      events: (Array.isArray(decision.events) ? decision.events : []).map((e) => {
        const x = asRecord(e);
        return {
          seq: num(x.seq),
          type: asString(x.type),
          actor: asString(x.actor),
          ts_virtual: num(x.ts_virtual),
          summary: asString(x.summary),
          bookkeeping: x.bookkeeping === true,
          payload: x.payload ?? null,
          payload_truncated: x.payload_truncated === true,
        };
      }),
      sentences: (Array.isArray(decision.sentences) ? decision.sentences : []).map((s) => {
        const x = asRecord(s);
        return { field: asString(x.field), text: asString(x.text) };
      }),
    },
    facts: Array.isArray(b.facts) ? b.facts.map(readFact) : null,
    sources: readSources(b.sources),
  };
}

function readModelRow(value: unknown): ModelRow {
  const m = asRecord(value);
  return {
    model: asString(m.model),
    badge: BADGES.includes(m.badge as Badge) ? (m.badge as Badge) : "other",
    calls: num(m.calls),
    completed: num(m.completed),
    cost_usd: num(m.cost_usd),
    input_tokens: num(m.input_tokens),
    cached_tokens: num(m.cached_tokens),
    output_tokens: num(m.output_tokens),
    reasoning_tokens: num(m.reasoning_tokens),
    cache_hit_share: numOrNull(m.cache_hit_share),
    share_of_cost: numOrNull(m.share_of_cost),
    share_of_tokens: numOrNull(m.share_of_tokens),
  };
}

/** ``GET /models``, or null when the body has no totals. */
export function readMeter(body: unknown): Meter | null {
  const b = asRecord(body);
  if (b.totals === null || typeof b.totals !== "object") return null;
  const t = asRecord(b.totals);
  const lost = asRecord(t.lost_to_cancellation);
  const definitions: Record<string, string> = {};
  for (const [key, text] of Object.entries(asRecord(b.definitions))) if (typeof text === "string") definitions[key] = text;
  return {
    run_id: asString(b.run_id),
    cache_saved_usd: num(t.cache_saved_usd),
    definitions,
    totals: {
      calls: num(t.calls),
      completed: num(t.completed),
      cancelled: num(t.cancelled),
      errors: num(t.errors),
      cost_usd: num(t.cost_usd),
      settled_cost_usd: num(t.settled_cost_usd),
      estimated_cost_usd: num(t.estimated_cost_usd),
      input_tokens: num(t.input_tokens),
      cached_tokens: num(t.cached_tokens),
      output_tokens: num(t.output_tokens),
      reasoning_tokens: num(t.reasoning_tokens),
      cache_hit_share: numOrNull(t.cache_hit_share),
      coordination_tokens: num(t.coordination_tokens),
      recovery_tokens: num(t.recovery_tokens),
      lost_to_cancellation: { calls: num(lost.calls), cost_usd: num(lost.cost_usd), tokens: num(lost.tokens) },
    },
    models: (Array.isArray(b.models) ? b.models : []).map(readModelRow),
  };
}

// ---- where a call sits on the playhead ----

/** Before the call started, while it ran, or once it ended (completed, failed or cancelled). */
export type CallPhase = "future" | "inflight" | "done";

export function phaseAt(call: CallRow, t: number): CallPhase {
  if (call.started_ts > t) return "future";
  return call.ended_ts !== null && call.ended_ts <= t ? "done" : "inflight";
}

const indexes = new WeakMap<CallRow[], Map<string, CallRow>>();

/** The calls by effect id. Made once per list: the same array gives back the same index, so a
 * component can ask on every render. */
export function callIndex(calls: CallRow[]): Map<string, CallRow> {
  let index = indexes.get(calls);
  if (!index) {
    index = new Map(calls.map((call) => [call.effect_id, call]));
    indexes.set(calls, index);
  }
  return index;
}

/** The calls that had started by ``t``, in the order they started. */
export const startedBy = (calls: CallRow[], t: number): CallRow[] => calls.filter((c) => c.started_ts <= t);

/** The call to show when a person opens ``actor``: the newest one it had started by ``t``, or its
 * first one when it has not started any yet. Null for an actor with no calls at all. */
export function pickCall(calls: CallRow[], actor: string, t: number): CallRow | null {
  const own = calls.filter((c) => c.actor === actor);
  if (own.length === 0) return null;
  const begun = own.filter((c) => c.started_ts <= t);
  return begun.length > 0 ? begun[begun.length - 1] : own[0];
}

// ---- the Muse meter, folded at a moment of the replay ----

const COORDINATION_ROLES: ReadonlySet<string> = new Set(["coordinator", "supervisor", "router", "recovery"]);

const isCoordination = (call: CallRow): boolean => COORDINATION_ROLES.has(call.role) || (call.tag ?? "").startsWith("coord:");
const isRecovery = (call: CallRow): boolean => call.role === "recovery" || (call.tag ?? "").startsWith("recovery:");
const isDone = (call: CallRow): boolean => call.status === "ok" || call.status === "incomplete";
const share = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

const emptyTotals = (): MeterTotals => ({
  calls: 0,
  completed: 0,
  cancelled: 0,
  errors: 0,
  cost_usd: 0,
  settled_cost_usd: 0,
  estimated_cost_usd: 0,
  input_tokens: 0,
  cached_tokens: 0,
  output_tokens: 0,
  reasoning_tokens: 0,
  cache_hit_share: null,
  coordination_tokens: 0,
  recovery_tokens: 0,
  lost_to_cancellation: { calls: 0, cost_usd: 0, tokens: 0 },
});

/** The meter of the calls that had ended by ``t`` (a call in flight has billed nothing yet), or of
 * every call when ``t`` is null. Same definitions as the server's /models (api/lens.py), so at the
 * end of a run the two agree: input and output tokens and cost count every call, cancelled ones at
 * their estimate; cached and reasoning tokens and the cache share count completed calls only. */
export function foldMeter(calls: CallRow[], t: number | null = null): MeterView {
  const rows = t === null ? calls : calls.filter((c) => phaseAt(c, t) === "done");
  const totals = emptyTotals();
  const byModel = new Map<string, CallRow[]>();
  let settledInput = 0;
  for (const call of rows) {
    const done = isDone(call);
    const tokens = call.usage.input_tokens + call.usage.output_tokens;
    totals.calls += 1;
    totals.cost_usd += call.cost_usd;
    totals.input_tokens += call.usage.input_tokens;
    totals.output_tokens += call.usage.output_tokens;
    if (done) {
      totals.completed += 1;
      totals.settled_cost_usd += call.cost_usd;
      totals.cached_tokens += call.usage.cached_tokens;
      totals.reasoning_tokens += call.usage.reasoning_tokens;
      settledInput += call.usage.input_tokens;
    }
    if (call.status === "cancelled") totals.cancelled += 1;
    if (call.status === "error") totals.errors += 1;
    if (call.estimated) totals.estimated_cost_usd += call.cost_usd;
    if (isCoordination(call)) totals.coordination_tokens += tokens;
    if (isRecovery(call)) totals.recovery_tokens += tokens;
    if (call.status === "cancelled" || call.status === "inflight") {
      totals.lost_to_cancellation.calls += 1;
      totals.lost_to_cancellation.cost_usd += call.cost_usd;
      totals.lost_to_cancellation.tokens += tokens;
    }
    const members = byModel.get(String(call.model));
    if (members) members.push(call);
    else byModel.set(String(call.model), [call]);
  }
  totals.cache_hit_share = share(totals.cached_tokens, settledInput);

  const grandTokens = totals.input_tokens + totals.output_tokens;
  const models: ModelRow[] = [...byModel.entries()].map(([model, members]) => {
    const settled = members.filter(isDone);
    const row: ModelRow = {
      model,
      badge: members[0].badge,
      calls: members.length,
      completed: settled.length,
      cost_usd: members.reduce((sum, c) => sum + c.cost_usd, 0),
      input_tokens: members.reduce((sum, c) => sum + c.usage.input_tokens, 0),
      cached_tokens: settled.reduce((sum, c) => sum + c.usage.cached_tokens, 0),
      output_tokens: members.reduce((sum, c) => sum + c.usage.output_tokens, 0),
      reasoning_tokens: settled.reduce((sum, c) => sum + c.usage.reasoning_tokens, 0),
      cache_hit_share: null,
      share_of_cost: null,
      share_of_tokens: null,
    };
    row.cache_hit_share = share(row.cached_tokens, settled.reduce((sum, c) => sum + c.usage.input_tokens, 0));
    row.share_of_cost = totals.cost_usd > 0 ? row.cost_usd / totals.cost_usd : null;
    row.share_of_tokens = share(row.input_tokens + row.output_tokens, grandTokens);
    return row;
  });
  // Most expensive first, then by name: the server's order.
  models.sort((a, b) => b.cost_usd - a.cost_usd || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  return { totals, models };
}

// ---- words for a call ----

const PURPOSE_LABELS: Record<string, string> = {
  work: "Work",
  planning: "Planning",
  verification: "Verification",
  arbitration: "Arbitration",
  intake: "Intake",
  safety: "Safety",
  coordination: "Coordination",
  recovery: "Recovery",
  ablation: "Ablation",
  other: "Call",
};

export const purposeLabel = (purpose: string): string => PURPOSE_LABELS[purpose] ?? purpose;

const capitalize = (text: string): string => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** A call in two lines: what it did ("Extract") and where ("track-data/d2 · step 2"). */
export function describeCall(call: CallRow): { title: string; where: string } {
  const ref = call.ref;
  const goal = ref.goal_id ?? "";
  const retry = (ref.attempt ?? 0) > 0 ? ` · attempt ${(ref.attempt ?? 0) + 1}` : "";
  switch (ref.kind) {
    case "plan":
      return { title: goal === "root" ? "Root plan" : "Plan", where: `${goal && goal !== "root" ? goal : call.actor}${retry}` };
    case "judge":
      return { title: "Judge", where: `${[goal, ref.contract_id].filter(Boolean).join("/") || call.actor}${retry}` };
    case "agent": {
      const step = ref.step !== undefined ? ` · step ${ref.step}` : "";
      return { title: capitalize(ref.contract_kind ?? "agent"), where: `${[goal, ref.contract_id].filter(Boolean).join("/") || call.actor}${step}${retry}` };
    }
    case "ablate":
      return { title: "Ablation", where: ref.note_id ? `note ${ref.note_id}` : call.actor };
    default:
      return { title: purposeLabel(call.purpose), where: call.tag ?? call.actor };
  }
}

/** 1234 -> "1.2k", 1234567 -> "1.23M". */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Dollars with enough digits for a single call to read, four after the point under a dollar like
 * the "spent" counter: $0.0088, $0.4948, $12.30. */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  return `$${Math.abs(usd) < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export const formatPercent = (share: number | null): string => (share === null ? "—" : `${Math.round(share * 100)}%`);

/** 6880 -> "6.9 s", 420 -> "420 ms". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms - minutes * 60_000) / 1000)} s`;
}

// ---- evidence: a fact next to its source sentence ----

export interface Segment {
  text: string;
  /** Indices into the evidence list that cover this stretch; empty for plain text. */
  marks: number[];
}

/** Cut ``text`` into stretches, each tagged with the evidence sentences that cover it. Offsets are
 * UTF-16 code units, which is what JavaScript strings index by, so ``text.slice(start, end)`` is
 * the sentence even after an emoji. An offset that does not land on the sentence is searched for
 * instead; one that cannot be found is left out rather than highlighting the wrong words. */
export function highlight(text: string, evidence: { start: number; end: number; text: string }[]): Segment[] {
  const spans: { start: number; end: number; index: number }[] = [];
  evidence.forEach((e, index) => {
    let { start, end } = e;
    const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length;
    if (!valid || text.slice(start, end) !== e.text) {
      const at = e.text ? text.indexOf(e.text) : -1;
      if (at < 0) return;
      start = at;
      end = at + e.text.length;
    }
    spans.push({ start, end, index });
  });
  if (spans.length === 0) return text ? [{ text, marks: [] }] : [];
  const cuts = [...new Set([0, text.length, ...spans.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]];
    const marks = spans.filter((s) => s.start <= from && s.end >= to).map((s) => s.index);
    const last = segments[segments.length - 1];
    if (last && last.marks.length === marks.length && last.marks.every((m, k) => m === marks[k])) last.text += text.slice(from, to);
    else segments.push({ text: text.slice(from, to), marks });
  }
  return segments;
}

// ---- the readable output of a call ----

export interface Placement {
  talk: string;
  day: number | null;
  room: string;
  slot: number | null;
}

export interface Track {
  id: string;
  room: string;
  talks: number;
  priority: number | null;
  risk: number | null;
  acceptance: string;
}

export interface PlannedContract {
  id: string;
  kind: string;
  objective: string;
  dependsOn: string[];
}

export type Readable =
  | { kind: "facts" }
  | { kind: "tracks"; tracks: Track[] }
  | { kind: "contracts"; contracts: PlannedContract[] }
  | { kind: "placements"; placements: Placement[] }
  | { kind: "verdict"; verdict: string; score: number | null }
  | { kind: "ruling"; winner: string; reason: string; confidence: number | null; evidence: string[] }
  | { kind: "write"; path: string; content: string }
  | { kind: "search"; query: string; scope: string }
  | { kind: "message"; text: string }
  | { kind: "fields"; fields: { name: string; text: string }[] }
  | { kind: "json"; label: string; value: unknown };

const BLURB_PATH = /blurb/i;

const MAX_FLAT_FIELDS = 8;

/** A small answer made only of text, numbers and flags, as name and text pairs; null for anything
 * else (nested values, a long object, an array), which stays JSON. */
function flatFields(value: unknown): { name: string; text: string }[] | null {
  const entries = Object.entries(asRecord(value));
  if (entries.length === 0 || entries.length > MAX_FLAT_FIELDS) return null;
  const fields: { name: string; text: string }[] = [];
  for (const [name, field] of entries) {
    if (typeof field === "string") fields.push({ name, text: field });
    else if (typeof field === "number" || typeof field === "boolean") fields.push({ name, text: String(field) });
    else return null;
  }
  return fields;
}

/** The pieces of a call's answer the lens shows as more than text, in reading order: the facts it
 * published, the plan it made, the placements, the judge's verdict, a ruling, what it wrote. The
 * model's own sentences (its reasons, notes and limitations) come from ``decision.sentences``
 * instead, so the two never repeat each other. A call whose answer matches nothing here falls
 * back to its message and then to the JSON, so nothing it said is hidden. */
export function readOutput(detail: CallDetail): Readable[] {
  const out: Readable[] = [];
  if (detail.facts && detail.facts.length > 0) out.push({ kind: "facts" });

  const parsed = asRecord(detail.output.parsed);
  if (Array.isArray(parsed.tracks)) {
    out.push({
      kind: "tracks",
      tracks: parsed.tracks.map((raw) => {
        const t = asRecord(raw);
        return {
          id: asString(t.track_id ?? t.id),
          room: asString(t.home_room),
          talks: Array.isArray(t.talk_ids) ? t.talk_ids.length : 0,
          priority: numOrNull(t.priority),
          risk: numOrNull(t.risk),
          acceptance: asString(t.acceptance),
        };
      }),
    });
  }
  if (Array.isArray(parsed.contracts)) {
    out.push({
      kind: "contracts",
      contracts: parsed.contracts.map((raw) => {
        const c = asRecord(raw);
        return { id: asString(c.id), kind: asString(c.kind), objective: asString(c.objective), dependsOn: asStrings(c.depends_on) };
      }),
    });
  }
  if (Array.isArray(parsed.placements)) {
    out.push({
      kind: "placements",
      placements: parsed.placements
        .map((raw) => {
          const p = asRecord(raw);
          return { talk: asString(p.talk_id), day: numOrNull(p.day), room: asString(p.room), slot: numOrNull(p.slot) };
        })
        .sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || (a.slot ?? 0) - (b.slot ?? 0) || (a.room < b.room ? -1 : a.room > b.room ? 1 : 0)),
    });
  }
  if (typeof parsed.verdict === "string") out.push({ kind: "verdict", verdict: parsed.verdict, score: numOrNull(parsed.score) });
  const winner = parsed.winner ?? parsed.ruling ?? (detail.purpose === "arbitration" ? parsed.value : undefined);
  if (winner !== undefined && winner !== null) {
    out.push({
      kind: "ruling",
      winner: typeof winner === "string" ? winner : JSON.stringify(winner),
      reason: asString(parsed.reason ?? parsed.rationale),
      confidence: numOrNull(parsed.confidence),
      evidence: asStrings(parsed.evidence ?? parsed.evidence_ids ?? parsed.sources),
    });
  }

  const answered = out.length > 0;
  for (const call of detail.output.tool_calls) {
    const args = asRecord(call.arguments);
    if (call.name === "workspace.write") {
      out.push({ kind: "write", path: asString(args.path), content: asString(args.content) });
    } else if (call.name === "memory.search") {
      out.push({ kind: "search", query: asString(args.query), scope: asString(args.scope) });
    } else if (call.name === "memory.publish_fact" && detail.facts && detail.facts.length > 0) {
      // already shown as facts, next to their sources
    } else {
      out.push({ kind: "json", label: call.name, value: call.arguments });
    }
  }

  if (!answered) {
    const text = detail.output.text.trim();
    if (detail.output.parsed !== null && detail.output.parsed !== undefined) {
      const fields = flatFields(detail.output.parsed);
      if (fields) {
        // A small flat answer (a blurb, say) reads as text; what the model's own words already carry is not repeated.
        const spoken = new Set(detail.decision.sentences.map((s) => s.text.trim()));
        const fresh = fields.filter((field) => !spoken.has(field.text.trim()));
        if (fresh.length > 0) out.unshift({ kind: "fields", fields: fresh });
      } else {
        // Any other structured answer is shown as JSON, not as one long line.
        out.unshift({ kind: "json", label: "answer", value: detail.output.parsed });
      }
    } else if (text && detail.decision.sentences.length === 0) {
      // Plain text the sentence splitter left out; usually the sentences already carry it.
      out.unshift({ kind: "message", text });
    }
  }
  return out;
}

/** The blurb a call wrote, when it wrote one (the lens shows it as a quotation). */
export const isBlurb = (path: string): boolean => BLURB_PATH.test(path);

/** The model's own sentences, labelled: "limitations[1]" -> "limitation 2", "message" stays. */
export function sentenceLabel(field: string): string {
  const indexed = /^(\w+)\[(\d+)\]$/.exec(field);
  if (!indexed) return field;
  const singular = indexed[1].replace(/ies$/, "y").replace(/s$/, "");
  return `${singular} ${Number(indexed[2]) + 1}`;
}

/** Every distinct source a call's facts cite, in the order they are first cited. */
export function citedSources(detail: CallDetail): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const fact of detail.facts ?? []) {
    for (const id of fact.sources) {
      const source = detail.sources?.[id];
      if (source && !seen.has(id)) {
        seen.add(id);
        out.push(source);
      }
    }
  }
  return out;
}
