// Recovery figures of a run so far: W1's definitions of coordinator-dependency time (`cdt_s`) and of duplicated work
// (`dup_calls`) in bench/recovery.py, run on the events a view has folded, so a scrubber can drag them through a run
// and the figure the arena shows live is the one it ends on.
//
// A port, function for function, of what `analyze` needs for those two figures: the wait intervals of the contracts
// (`_items`), the down span of each goal an outage took (`_outages`, `_Owners`), their overlap (`cdt`), and the fate of
// every LLM call (`_fates`). Times are virtual ms. "So far" is `analyze` applied to the log up to the playhead, with the
// end of the run at the playhead: a wait counts once both its ends are in the log (an open one is not an interval yet),
// and an outage still going ends at the playhead. The figure therefore moves when a wait ends, not while it goes on. At
// the last event it is the scored number, to the millisecond; arena.parity.test.ts checks the full logs and 400 prefixes
// of them against Python.
//
// Not ported, because the figures here do not need it: the cause of a duplicate, the idle agent-seconds, the blast
// radius, the cost.

import { asNumber, asString, asStrings } from "./generic";
import type { RunEvent } from "./types";

const OWN_PREFIXES = ["plan|", "judge|", "scan|"];
const PAID: ReadonlySet<string> = new Set(["ok", "incomplete"]);
const ENV = "@env";
const SEP = "\u0000";

type Span = readonly [number, number];

// -- the events that are kept ----------------------------------------------------------------

const KEPT: ReadonlySet<string> = new Set([
  "run.started",
  "run.completed",
  "actor.spawned",
  "actor.stopped",
  "contract.created",
  "contract.dispatched",
  "contract.verified",
  "contract.completed",
  "contract.rejected",
  "verify.judged",
  "plan.proposed",
  "plan.refined",
  "goal.completed",
  "goal.opened",
  "ownership.assigned",
  "ownership.remapped",
  "tree.adopted",
  "baseline.crashed",
  "baseline.restarted",
  "chaos.injected",
]);

const isOwnTag = (tag: string): boolean => OWN_PREFIXES.some((prefix) => tag.startsWith(prefix));

/** Whether the recovery figures read this event. A log has thousands of timer effects and heartbeats and a few hundred
 * of these. */
export function isRecoveryEvent(event: RunEvent): boolean {
  if (KEPT.has(event.type)) return true;
  const p = event.payload;
  if (event.type === "msg.sent") return p.topic === "contract.result" || p.topic === "book.result";
  if (event.type === "effect.started" || event.type === "effect.completed" || event.type === "effect.cancelled") {
    return p.kind === "llm" || isOwnTag(asString(p.tag));
  }
  return false;
}

/** The kept events, as a persistent list (chunks that are never changed, and a short tail that is copied), so a view
 * can hold them and an older view still sees only its own. */
export interface Recorded {
  full: readonly (readonly RunEvent[])[];
  tail: readonly RunEvent[];
}

const CHUNK = 64;
export const emptyRecorded = (): Recorded => ({ full: [], tail: [] });

export function record(rows: Recorded, event: RunEvent): Recorded {
  const tail = [...rows.tail, event];
  return tail.length >= CHUNK ? { full: [...rows.full, tail], tail: [] } : { full: rows.full, tail };
}

const flat = new WeakMap<Recorded, RunEvent[]>();
export function recordedEvents(rows: Recorded): RunEvent[] {
  let events = flat.get(rows);
  if (!events) {
    events = [...rows.full.flat(), ...rows.tail];
    flat.set(rows, events);
  }
  return events;
}

// -- the log ---------------------------------------------------------------------------------

interface Call {
  effectId: string;
  actor: string;
  tag: string | null;
  request: string;
  startSeq: number;
  closeSeq: number | null;
  status: string;
}

const pairKey = (goal: string, contract: string): string => `${goal}${SEP}${contract}`;
const attemptKey = (goal: string, contract: string, attempt: number): string => `${goal}${SEP}${contract}${SEP}${attempt}`;
const keyOf = (p: Record<string, unknown>): string => attemptKey(asString(p.goal_id), asString(p.contract_id), asNumber(p.attempt) ?? 0);

function push<T>(map: Map<string, T[]>, key: string, item: T): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

/** The key order of an object does not change what a request says: the same hash as Python's canonical JSON. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

const requests = new WeakMap<RunEvent, string>();
function requestOf(event: RunEvent): string {
  let key = requests.get(event);
  if (key === undefined) {
    key = canonical(event.payload.request);
    requests.set(event, key);
  }
  return key;
}

class Log {
  events: RunEvent[];
  completedAt: number | null = null;
  lastTs = 0;
  root = "o0";
  coordinators = new Set<string>();
  kind = new Map<string, string>();
  parent = new Map<string, string | null>();
  spawns = new Map<string, RunEvent[]>();
  stops = new Map<string, RunEvent[]>();
  byType = new Map<string, RunEvent[]>();
  created = new Map<string, RunEvent>();
  dispatches = new Map<string, RunEvent[]>();
  verified = new Map<string, RunEvent[]>();
  completed = new Map<string, RunEvent[]>();
  rejected = new Map<string, RunEvent[]>();
  results = new Map<string, RunEvent[]>();
  judged = new Map<string, RunEvent[]>();
  booked = new Map<string, RunEvent[]>();
  judgeDone = new Map<string, RunEvent[]>();
  planDone = new Map<string, RunEvent[]>();
  plans = new Map<string, RunEvent[]>();
  goalDone = new Map<string, RunEvent>();
  starts = new Map<string, RunEvent>();
  ends = new Map<string, RunEvent>();
  calls = new Map<string, Call>();

  constructor(events: RunEvent[]) {
    this.events = [...events].sort((a, b) => a.seq - b.seq);
    for (const event of this.events) {
      this.add(event);
      this.lastTs = Math.max(this.lastTs, event.ts_virtual);
      if (event.type === "run.completed" && this.completedAt === null) this.completedAt = event.ts_virtual;
    }
    const orchestrators = [...this.kind].filter(([, kind]) => kind === "orchestrator").map(([actor]) => actor);
    const roots = orchestrators.filter((actor) => this.parent.get(actor) == null);
    this.root = roots[0] ?? orchestrators[0] ?? "o0";
    this.coordinators = new Set(orchestrators);
  }

  /** The end of the run: its completion, else the playhead (never before the last event). */
  endAt(playhead: number): number {
    return this.completedAt ?? Math.max(this.lastTs, playhead);
  }

  private add(event: RunEvent): void {
    const p = event.payload;
    const type = event.type;
    push(this.byType, type, event);
    switch (type) {
      case "actor.spawned": {
        const id = asString(p.actor_id);
        if (!this.kind.has(id)) this.kind.set(id, asString(p.kind));
        if (!this.parent.has(id)) this.parent.set(id, typeof p.parent === "string" ? p.parent : null);
        push(this.spawns, id, event);
        break;
      }
      case "actor.stopped":
        push(this.stops, asString(p.actor_id), event);
        break;
      case "contract.created": {
        const contract = (p.contract ?? {}) as Record<string, unknown>;
        const key = pairKey(asString(contract.goal_id), asString(contract.id));
        if (!this.created.has(key)) this.created.set(key, event);
        break;
      }
      case "contract.dispatched":
        push(this.dispatches, pairKey(asString(p.goal_id), asString(p.contract_id)), event);
        break;
      case "contract.verified":
        push(this.verified, pairKey(asString(p.goal_id), asString(p.contract_id)), event);
        break;
      case "contract.completed":
        push(this.completed, keyOf(p), event);
        break;
      case "contract.rejected":
        push(this.rejected, keyOf(p), event);
        break;
      case "verify.judged":
        push(this.judged, keyOf(p), event);
        break;
      case "msg.sent": {
        const body = (p.body ?? {}) as Record<string, unknown>;
        push(p.topic === "contract.result" ? this.results : this.booked, keyOf(body), event);
        break;
      }
      case "plan.proposed":
      case "plan.refined":
        push(this.plans, asString(p.goal_id), event);
        break;
      case "goal.completed": {
        const goal = asString(p.goal_id);
        if (!this.goalDone.has(goal)) this.goalDone.set(goal, event);
        break;
      }
      case "effect.started":
        this.start(event);
        break;
      case "effect.completed":
      case "effect.cancelled":
        this.close(event);
        break;
    }
  }

  private start(event: RunEvent): void {
    const p = event.payload;
    const id = asString(p.effect_id);
    if (!this.starts.has(id)) this.starts.set(id, event);
    if (p.kind === "llm") {
      this.calls.set(id, {
        effectId: id,
        actor: event.actor,
        tag: typeof p.tag === "string" ? p.tag : null,
        request: requestOf(event),
        startSeq: event.seq,
        closeSeq: null,
        status: "inflight",
      });
    }
  }

  private close(event: RunEvent): void {
    const p = event.payload;
    const id = asString(p.effect_id);
    if (!this.ends.has(id)) this.ends.set(id, event);
    const call = this.calls.get(id);
    if (call && call.closeSeq === null) {
      call.closeSeq = event.seq;
      call.status = event.type === "effect.cancelled" ? "cancelled" : asString(p.status);
    }
    if (event.type === "effect.completed" && event.actor === ENV && PAID.has(asString(p.status))) {
      const parts = asString(p.tag).split("|");
      if (parts[0] === "judge" && parts.length === 4) push(this.judgeDone, attemptKey(parts[1], parts[2], Number(parts[3])), event);
      else if (parts[0] === "plan" && parts.length === 3) push(this.planDone, parts[1], event);
    }
  }

  of(type: string): RunEvent[] {
    return this.byType.get(type) ?? [];
  }

  stopAfter(actor: string, seq: number): RunEvent | undefined {
    return (this.stops.get(actor) ?? []).find((stop) => stop.seq > seq);
  }

  aliveAt(actor: string, seq: number): boolean {
    const spawns = (this.spawns.get(actor) ?? []).filter((e) => e.seq < seq).map((e) => e.seq);
    const stops = (this.stops.get(actor) ?? []).filter((e) => e.seq < seq).map((e) => e.seq);
    return spawns.length > 0 && (stops.length === 0 || stops[stops.length - 1] < spawns[spawns.length - 1]);
  }
}

// -- who owned each goal ---------------------------------------------------------------------

class Owners {
  goal = new Map<string, [number, string][]>();
  fallback = new Map<string, string>();
  first = new Map<string, number>();

  constructor(private log: Log) {
    for (const event of log.events) {
      const p = event.payload;
      if (event.type === "ownership.assigned" || event.type === "ownership.remapped") {
        push(this.goal, asString(p.key), [event.seq, asString(p.owner)]);
      } else if (event.type === "goal.opened") {
        push(this.goal, asString(p.goal_id), [event.seq, asString(p.owner)]);
      }
    }
    const created = [...log.created.values()].sort((a, b) => a.seq - b.seq);
    for (const event of created) {
      const contract = (event.payload.contract ?? {}) as Record<string, unknown>;
      const goal = asString(contract.goal_id);
      if (!this.fallback.has(goal)) this.fallback.set(goal, asString(event.payload.owner) || log.root);
      if (!this.first.has(goal)) this.first.set(goal, event.seq);
    }
  }

  ofGoal(goal: string, seq: number): string | null {
    let owner: string | null = null;
    for (const [at, name] of this.goal.get(goal) ?? []) {
      if (at > seq) break;
      owner = name;
    }
    if (owner !== null) return owner;
    if (goal === "root") return this.log.root;
    return this.goal.has(goal) ? null : (this.fallback.get(goal) ?? null);
  }

  opened(goal: string, seq: number): boolean {
    if (goal === "root") return true;
    const history = this.goal.get(goal);
    if (history) return history[0][0] <= seq;
    const first = this.first.get(goal);
    return first !== undefined && first <= seq;
  }

  goals(): string[] {
    return [...new Set(["root", ...this.goal.keys(), ...this.fallback.keys()])].sort();
  }

  /** The goals ``coordinator`` owned at ``seq`` that were not completed yet. */
  unfinished(coordinator: string, seq: number): string[] {
    return this.goals().filter((goal) => {
      const done = this.log.goalDone.get(goal);
      return this.opened(goal, seq) && this.ofGoal(goal, seq) === coordinator && (done === undefined || done.seq > seq);
    });
  }
}

// -- spans -----------------------------------------------------------------------------------

function merge(spans: Iterable<Span>): Span[] {
  const merged: [number, number][] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (end <= start) continue;
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

const overlap = (span: Span, within: Iterable<Span>): number => {
  let sum = 0;
  for (const [start, end] of within) sum += Math.max(0, Math.min(span[1], end) - Math.max(span[0], start));
  return sum;
};

// -- wait intervals --------------------------------------------------------------------------

interface Item {
  kind: "dispatch" | "result" | "judge" | "book" | "plan" | "lost";
  goal: string;
  start: number;
  end: number;
}

const after = (events: readonly RunEvent[] | undefined, seq: number): RunEvent | undefined => (events ?? []).find((event) => event.seq > seq);

/** When the dispatch ``index`` of a contract could first have gone out. */
function ready(log: Log, goal: string, cid: string, sent: RunEvent[], index: number): number | null {
  const dispatch = sent[index];
  if (index === 0) {
    const created = log.created.get(pairKey(goal, cid));
    if (!created) return null;
    let at = created.ts_virtual;
    const contract = (created.payload.contract ?? {}) as Record<string, unknown>;
    for (const dep of asStrings(contract.depends_on)) {
      const done = (log.verified.get(pairKey(goal, dep)) ?? []).find((v) => v.seq < dispatch.seq);
      if (done) at = Math.max(at, done.ts_virtual);
    }
    return Math.min(at, dispatch.ts_virtual);
  }
  const previous = sent[index - 1];
  const rejections = log.rejected.get(attemptKey(goal, cid, asNumber(previous.payload.attempt) ?? 0)) ?? [];
  const rejection = [...rejections].reverse().find((r) => r.seq < dispatch.seq);
  if (!rejection) return null;
  let at = rejection.ts_virtual;
  const stop = log.stopAfter(asString(previous.payload.assignee), previous.seq);
  if (rejection.payload.stage === "lost" && stop && stop.seq < rejection.seq) at = Math.min(at, stop.ts_virtual);
  return Math.min(at, dispatch.ts_virtual);
}

/** Own calls (any kind: a scan is a firewall effect) cancelled and then asked again. */
function lostCalls(log: Log): Item[] {
  const items: Item[] = [];
  const started = [...log.starts.values()].sort((a, b) => a.seq - b.seq);
  for (const event of started) {
    const tag = asString(event.payload.tag);
    const end = log.ends.get(asString(event.payload.effect_id));
    if (!isOwnTag(tag) || !end || end.type !== "effect.cancelled") continue;
    const again = started.find((s) => s.seq > end.seq && s.payload.tag === tag);
    if (again) items.push({ kind: "lost", goal: tag.split("|")[1] ?? "", start: end.ts_virtual, end: again.ts_virtual });
  }
  return items;
}

function itemsOf(log: Log): Item[] {
  const items: Item[] = [];
  for (const [key, sent] of log.dispatches) {
    const [goal, cid] = key.split(SEP);
    sent.forEach((dispatch, index) => {
      const at = ready(log, goal, cid, sent, index);
      if (at !== null) items.push({ kind: "dispatch", goal, start: at, end: dispatch.ts_virtual });
    });
  }
  for (const [key, results] of log.results) {
    const [goal, cid, attempt] = key.split(SEP);
    const sent = (log.dispatches.get(pairKey(goal, cid)) ?? []).find((d) => asNumber(d.payload.attempt) === Number(attempt));
    const first = results.find((r) => !sent || r.seq > sent.seq);
    const done = first ? after(log.completed.get(key), first.seq) : undefined;
    if (first && done) items.push({ kind: "result", goal, start: first.ts_virtual, end: done.ts_virtual });
  }
  for (const [key, verdicts] of log.judged) {
    let used = 0;
    for (const verdict of verdicts) {
      const calls = (log.judgeDone.get(key) ?? []).filter((c) => used < c.seq && c.seq < verdict.seq);
      if (calls.length > 0) {
        const call = calls[calls.length - 1];
        used = call.seq;
        items.push({ kind: "judge", goal: key.split(SEP)[0], start: call.ts_virtual, end: verdict.ts_virtual });
      }
    }
  }
  for (const [key, books] of log.booked) {
    const [goal, cid, attempt] = key.split(SEP);
    const ended = [...(log.verified.get(pairKey(goal, cid)) ?? []), ...(log.rejected.get(key) ?? [])]
      .filter((e) => asNumber(e.payload.attempt) === Number(attempt))
      .sort((a, b) => a.seq - b.seq);
    const done = after(ended, books[0].seq);
    if (done) items.push({ kind: "book", goal, start: books[0].ts_virtual, end: done.ts_virtual });
  }
  for (const [goal, calls] of log.planDone) {
    let used = 0;
    for (const call of calls) {
      const plan = after(log.plans.get(goal), Math.max(call.seq, used));
      if (plan) {
        used = plan.seq;
        items.push({ kind: "plan", goal, start: call.ts_virtual, end: plan.ts_virtual });
      }
    }
  }
  items.push(...lostCalls(log));
  return items;
}

// -- outages ---------------------------------------------------------------------------------

interface Outage {
  spans: Map<string, Span>; // goal -> its down span
}

function swarmOutage(log: Log, owners: Owners, kill: RunEvent, victim: string, heal: number | null, end: number): Outage {
  const spans = new Map<string, Span>();
  for (const goal of owners.unfinished(victim, kill.seq)) {
    const remap = log
      .of("ownership.remapped")
      .find((r) => r.seq > kill.seq && r.payload.key === goal && r.payload.previous === victim && r.payload.owner !== victim);
    const done = log.goalDone.get(goal);
    const ends: number[] = remap ? [remap.ts_virtual] : [];
    if (heal !== null) ends.push(heal);
    else if (!remap && done && done.seq > kill.seq) ends.push(done.ts_virtual);
    if (ends.length === 0) ends.push(end);
    spans.set(goal, [kill.ts_virtual, Math.max(Math.min(...ends), kill.ts_virtual)]);
  }
  return { spans };
}

function supervisorDown(log: Log, crashed: RunEvent, seq: number): boolean {
  const back = log.of("baseline.restarted").find((r) => r.payload.crash === crashed.payload.crash && r.seq > crashed.seq);
  return back === undefined || back.seq > seq;
}

function partitions(log: Log, owners: Owners, supervised: boolean, end: number): Outage[] {
  const outages: Outage[] = [];
  const crashes = log.of("baseline.crashed");
  for (const event of log.of("chaos.injected")) {
    const p = event.payload;
    const target = asString(p.target);
    if (p.fault !== "partition" || !log.coordinators.has(target)) continue;
    if (!log.aliveAt(target, event.seq)) continue; // already down: its crash covers the goals
    const detail = (p.detail ?? {}) as Record<string, unknown>;
    const heal = log
      .of("chaos.injected")
      .find((h) => h.payload.fault === "heal" && ((h.payload.detail ?? {}) as Record<string, unknown>).partition === detail.partition && h.seq > event.seq);
    let healed: number;
    if (heal) healed = heal.ts_virtual;
    else {
      const lasts = asNumber(detail.duration_ms);
      healed = lasts === null ? end : Math.min(end, event.ts_virtual + Math.trunc(lasts));
    }
    if (supervised && crashes.some((c) => c.payload.coordinator === target && c.seq < event.seq && supervisorDown(log, c, event.seq))) continue;
    if (supervised) {
      const spans = new Map<string, Span>();
      for (const goal of owners.unfinished(target, event.seq)) spans.set(goal, [event.ts_virtual, healed]);
      outages.push({ spans });
    } else {
      outages.push(swarmOutage(log, owners, event, target, healed, end));
    }
  }
  return outages;
}

function outagesOf(log: Log, owners: Owners, end: number): Outage[] {
  const outages: Outage[] = [];
  const crashes = log.of("baseline.crashed");
  const supervised = crashes.length > 0;
  if (supervised) {
    for (const crashed of crashes) {
      const p = crashed.payload;
      const back = log.of("baseline.restarted").find((r) => r.payload.crash === p.crash && r.seq > crashed.seq);
      const finish = back ? back.ts_virtual : end;
      const spans = new Map<string, Span>();
      for (const goal of owners.unfinished(asString(p.coordinator), crashed.seq)) spans.set(goal, [crashed.ts_virtual, finish]);
      outages.push({ spans });
    }
  } else {
    for (const kill of log.of("chaos.injected")) {
      const target = asString(kill.payload.target);
      if (kill.payload.fault === "kill_coordinator" && target) outages.push(swarmOutage(log, owners, kill, target, null, end));
    }
  }
  outages.push(...partitions(log, owners, supervised, end));
  return outages;
}

// -- the fate of every call ------------------------------------------------------------------

/** How many LLM calls were duplicated work: asked again after a later attempt replaced them, asked again under the
 * same own tag, or answered twice with one request (``_fates``; the cause of each is not needed here). */
function duplicatedCalls(log: Log): number {
  const fate = new Map<string, "consumed" | "duplicated" | "unconsumed" | "failed">();
  const attemptOf = new Map<string, [string, string, number]>();
  for (const [key, sent] of log.dispatches) {
    const [goal, cid] = key.split(SEP);
    for (const dispatch of sent) {
      const idem = asString(dispatch.payload.idem_key);
      if (!attemptOf.has(idem)) attemptOf.set(idem, [goal, cid, asNumber(dispatch.payload.attempt) ?? 0]);
    }
  }
  const verified = new Map<string, Set<number | null>>();
  for (const [key, events] of log.verified) verified.set(key, new Set(events.map((v) => asNumber(v.payload.attempt))));
  const own = new Map<string, Call[]>();
  const calls = [...log.calls.values()].sort((a, b) => a.startSeq - b.startSeq);
  for (const call of calls) {
    if (call.status === "error" || call.status === "refused") {
      fate.set(call.effectId, "failed");
      continue;
    }
    const tag = call.tag ?? "";
    if (isOwnTag(tag)) {
      push(own, tag, call);
      continue;
    }
    const work = attemptOf.get(tag.split(":")[0]);
    if (!work) {
      fate.set(call.effectId, PAID.has(call.status) ? "consumed" : "unconsumed");
      continue;
    }
    const won = verified.get(pairKey(work[0], work[1]));
    if (won?.has(work[2])) fate.set(call.effectId, "consumed");
    else if (won && won.size > 0) fate.set(call.effectId, "duplicated");
    else fate.set(call.effectId, "unconsumed");
  }
  for (const group of own.values()) {
    // Own calls (plan, judge, scan) asked more than once under one tag: the last one that completed is the one used.
    const used = [...group].reverse().find((c) => PAID.has(c.status));
    for (const call of group) {
      if (call === used) fate.set(call.effectId, "consumed");
      else if (!used) fate.set(call.effectId, "unconsumed");
      else if (call.startSeq < used.startSeq) fate.set(call.effectId, "duplicated");
      else fate.set(call.effectId, "unconsumed");
    }
  }
  // Completed calls with an identical request beyond the first.
  const groups = new Map<string, Call[]>();
  for (const call of calls) if (PAID.has(call.status)) push(groups, call.request, call);
  for (const group of groups.values()) {
    for (const call of group.slice(1)) {
      const was = fate.get(call.effectId);
      if (was !== undefined && was !== "consumed") continue;
      fate.set(call.effectId, "duplicated");
    }
  }
  let count = 0;
  for (const value of fate.values()) if (value === "duplicated") count += 1;
  return count;
}

// -- the figures -----------------------------------------------------------------------------

export interface Recovery {
  /** Coordinator-dependency time (``cdt_s``): contract-ms that work waited on a coordinator that was down. */
  dependencyMs: number;
  /** Every wait interval, outage or not (``blocked_total_s``). */
  blockedMs: number;
  /** Calls that were duplicated work (``dup_calls``). */
  duplicatedCalls: number;
}

interface Analysis {
  log: Log;
  owners: Owners;
  items: Item[];
  blockedMs: number;
  duplicatedCalls: number;
}

const analyses = new WeakMap<Recorded, Analysis>();

function analysisOf(rows: Recorded): Analysis {
  let found = analyses.get(rows);
  if (!found) {
    const log = new Log(recordedEvents(rows));
    const items = itemsOf(log);
    found = { log, owners: new Owners(log), items, blockedMs: items.reduce((sum, item) => sum + (item.end - item.start), 0), duplicatedCalls: duplicatedCalls(log) };
    analyses.set(rows, found);
  }
  return found;
}

/** The figures of the kept events at virtual time ``playheadMs`` (the end of the run so far). */
export function recoveryAt(rows: Recorded, playheadMs: number): Recovery {
  if (rows.full.length === 0 && rows.tail.length === 0) return { dependencyMs: 0, blockedMs: 0, duplicatedCalls: 0 };
  const { log, owners, items, blockedMs, duplicatedCalls: dup } = analysisOf(rows);
  const down = new Map<string, Span[]>();
  for (const outage of outagesOf(log, owners, log.endAt(playheadMs))) {
    for (const [goal, span] of outage.spans) {
      const spans = down.get(goal);
      if (spans) spans.push(span);
      else down.set(goal, [span]);
    }
  }
  const merged = new Map([...down].map(([goal, spans]) => [goal, merge(spans)] as const));
  let dependencyMs = 0;
  for (const item of items) dependencyMs += overlap([item.start, item.end], merged.get(item.goal) ?? []);
  return { dependencyMs, blockedMs, duplicatedCalls: dup };
}
