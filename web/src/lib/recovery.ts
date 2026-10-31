// Recovery figures of a run so far: W1's definitions of coordinator-dependency time (`cdt_s`), of duplicated work
// (`dup_calls`) and of idle agent-seconds (`idle_agent_s`) in bench/recovery.py, run on the events a view has folded, so a
// scrubber can drag them through a run and the figure the arena shows live is the one it ends on.
//
// A port, function for function, of what `analyze` needs for those three figures: the wait intervals of the contracts
// (`_items`), the down span of each goal an outage took (`_outages`, `_Owners`), their overlap (`cdt`), the fate of every
// LLM call (`_fates`), and, for the idle agent-seconds, the lifetime of each agent, the spans in which it holds an attempt
// and the sessions it served (`_lifetimes`, `_held`, `_idle`). Times are virtual ms. "So far" is `analyze` applied to the
// log up to the playhead: a wait counts once both its ends are in the log (an open one is not an interval yet), so a
// figure moves when a wait ends, not while it goes on. The playhead itself changes nothing: every interval ends at an
// event, so the end of the run (where an outage, an agent or an attempt that is still going ends) cuts none of them, and
// the figures are a function of the events alone. At the last event they are the scored numbers, to the millisecond;
// arena.parity.test.ts checks the shipped logs, whole and at their prefixes, against Python.
//
// Not ported, because the figures here do not need it: the cause of a duplicate, the blast radius, the cost.

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

  /** The end of the run: its completion, else its last event. */
  get end(): number {
    return this.completedAt ?? this.lastTs;
  }

  /** The agents, by name (``_Log.agents``). */
  agents(): string[] {
    const agents: string[] = [];
    for (const [actor, kind] of this.kind) if (kind === "agent") agents.push(actor);
    return agents.sort();
  }

  /** The spans in which ``actor`` was alive, one per incarnation (``_Log.lifetimes``). */
  lifetimes(actor: string): Span[] {
    return (this.spawns.get(actor) ?? []).map((spawn): Span => [spawn.ts_virtual, this.stopAfter(actor, spawn.seq)?.ts_virtual ?? this.end]);
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

// -- idle agent-seconds ----------------------------------------------------------------------

/** The parts of ``spans`` that lie inside any of ``inside`` (``_within``). */
function within(spans: readonly Span[], inside: readonly Span[]): Span[] {
  const parts: Span[] = [];
  for (const [from, to] of inside) {
    for (const [start, end] of spans) {
      const a = Math.max(start, from);
      const b = Math.min(end, to);
      if (b > a) parts.push([a, b]);
    }
  }
  return parts;
}

/** How much of ``spans`` the agent was alive for and held no attempt (``_free``): the spans, cut to its lifetime, merged,
 * less the spans of the attempts it held. */
function freeMs(spans: readonly Span[], alive: readonly Span[], busy: readonly Span[]): number {
  const holes = merge(busy);
  let free = 0;
  let first = 0;
  for (const [start, end] of merge(within(spans, alive))) {
    free += end - start;
    while (first < holes.length && holes[first][1] <= start) first += 1;
    for (let i = first; i < holes.length && holes[i][0] < end; i += 1) free -= Math.min(end, holes[i][1]) - Math.max(start, holes[i][0]);
  }
  return free;
}

/** One agent as the idle agent-seconds read it: when it was alive, when it held an attempt, and the sessions it served. */
interface Hand {
  alive: Span[];
  busy: Span[];
  sessions: ReadonlySet<string>;
}

/** The agents that served a session. A session is served by the assignee of a contract when it is created and by the
 * assignee of each dispatch of it (``serves`` in ``analyze``). An agent holds an attempt from its dispatch to the
 * result it sends, or to its stop (``_held``). */
function handsOf(log: Log): Hand[] {
  const serves = new Map<string, Set<string>>();
  const serve = (agent: string, goal: string): void => {
    if (!agent) return;
    const goals = serves.get(agent);
    if (goals) goals.add(goal);
    else serves.set(agent, new Set([goal]));
  };
  for (const created of log.created.values()) {
    const contract = (created.payload.contract ?? {}) as Record<string, unknown>;
    serve(asString(contract.assignee), asString(contract.goal_id));
  }
  const held = new Map<string, Span[]>();
  for (const [key, sent] of log.dispatches) {
    const goal = key.split(SEP)[0];
    for (const dispatch of sent) {
      const agent = asString(dispatch.payload.assignee);
      serve(agent, goal);
      const ends = [log.end];
      const result = after(log.results.get(keyOf(dispatch.payload)), dispatch.seq);
      if (result) ends.push(result.ts_virtual);
      const stop = log.stopAfter(agent, dispatch.seq);
      if (stop) ends.push(stop.ts_virtual);
      push(held, agent, [dispatch.ts_virtual, Math.max(Math.min(...ends), dispatch.ts_virtual)]);
    }
  }
  const hands: Hand[] = [];
  for (const agent of log.agents()) {
    const sessions = serves.get(agent);
    if (sessions) hands.push({ alive: log.lifetimes(agent), busy: held.get(agent) ?? [], sessions });
  }
  return hands;
}

/** The waits of an outage, by session: each wait interval cut to the down span of its goal (what ``_idle`` collects from the
 * outage's blocked items). */
function waitsOf(outage: Outage, byGoal: ReadonlyMap<string, Item[]>): Map<string, Span[]> {
  const waits = new Map<string, Span[]>();
  for (const [goal, [from, to]] of outage.spans) {
    for (const item of byGoal.get(goal) ?? []) {
      const start = Math.max(item.start, from);
      const end = Math.min(item.end, to);
      if (end > start) push(waits, goal, [start, end]);
    }
  }
  return waits;
}

/** Idle agent-ms (``idle_agent_s``, the primary reading in bench/PREREG.md), added up over the outages: for each, the time
 * an agent was alive and held no attempt while one of the sessions it served had work waiting on a coordinator that was
 * down. A session is waiting while one of its wait intervals runs inside the down span of its goal. */
function idleMsOf(log: Log, outages: readonly Outage[], byGoal: ReadonlyMap<string, Item[]>): number {
  const waited = outages.map((outage) => waitsOf(outage, byGoal)).filter((waits) => waits.size > 0);
  if (waited.length === 0) return 0;
  let idle = 0;
  for (const { alive, busy, sessions } of handsOf(log)) {
    for (const waits of waited) {
      const spans: Span[] = [];
      for (const goal of sessions) for (const span of waits.get(goal) ?? []) spans.push(span);
      if (spans.length > 0) idle += freeMs(spans, alive, busy);
    }
  }
  return idle;
}

// -- the figures -----------------------------------------------------------------------------

export interface Recovery {
  /** Coordinator-dependency time (``cdt_s``): contract-ms that work waited on a coordinator that was down. */
  dependencyMs: number;
  /** Every wait interval, outage or not (``blocked_total_s``). */
  blockedMs: number;
  /** Calls that were duplicated work (``dup_calls``). */
  duplicatedCalls: number;
  /** Idle agent-seconds (``idle_agent_s``), in ms: agent-time spent alive, holding no attempt, while a session the agent served
   * had work waiting on a coordinator that was down. */
  idleMs: number;
  /** A coordinator's crash stopped workers. An in-process supervisor takes its workers down with it, and a worker that is gone
   * is not idle: what such a side scores on ``idleMs`` is not how long its workers waited. */
  crashStopped: boolean;
}

const NOTHING: Recovery = { dependencyMs: 0, blockedMs: 0, duplicatedCalls: 0, idleMs: 0, crashStopped: false };

function analyse(rows: Recorded): Recovery {
  const log = new Log(recordedEvents(rows));
  const items = itemsOf(log);
  const byGoal = new Map<string, Item[]>();
  let blockedMs = 0;
  for (const item of items) {
    push(byGoal, item.goal, item);
    blockedMs += item.end - item.start;
  }
  const outages = outagesOf(log, new Owners(log), log.end);
  const down = new Map<string, Span[]>();
  for (const outage of outages) for (const [goal, span] of outage.spans) push(down, goal, span);
  let dependencyMs = 0;
  for (const [goal, spans] of down) {
    const merged = merge(spans);
    for (const item of byGoal.get(goal) ?? []) dependencyMs += overlap([item.start, item.end], merged);
  }
  return {
    dependencyMs,
    blockedMs,
    duplicatedCalls: duplicatedCalls(log),
    idleMs: idleMsOf(log, outages, byGoal),
    crashStopped: log.of("actor.stopped").some((stop) => stop.payload.reason === "crash"),
  };
}

const figures = new WeakMap<Recorded, Recovery>();

/** The figures of the kept events: the log so far, read once per change of it, however often a frame asks. The playhead is
 * only accepted, because the callers have it: the figures do not depend on it (see the head of this file). */
export function recoveryAt(rows: Recorded, _playheadMs?: number): Recovery {
  if (rows.full.length === 0 && rows.tail.length === 0) return NOTHING;
  let found = figures.get(rows);
  if (!found) {
    found = analyse(rows);
    figures.set(rows, found);
  }
  return found;
}
