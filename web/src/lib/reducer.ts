// The run view: a pure fold over the event stream (spec §16: "the UI is a pure projection
// of the event stream, so the same views serve live runs and replays").
//
// Kernel events (actor.*, msg.sent, effect.*, budget.*, run.*) and the takeover events of
// spec §5.2–5.3 exist today. Payload fields as coord/ and comms/ emit them (the names this UI
// proposed on Day 7 are still read, in brackets):
//
//   chaos.injected      {fault [kind], target? [targets], detail}   fault: kill_coordinator | kill_agent |
//                                                                   partition | heal | the network faults
//   member.suspected    {member}
//   member.dead         {member, incarnation?}                 envelope member_epoch is bumped
//   tree.adopted        {dead [from], adopter [to, new_parent], children?, duties?}
//   ownership.assigned  {key, owner}
//   ownership.remapped  {key | keys, owner [to], previous [from], duties?}   duties ["root"] = root succession
//
// The baselines' supervised coordinator (baseline.crashed -> baseline.restarted) takes the node
// through "restarting": ``outage`` carries what the restart ring needs, and ``supervision`` keeps one
// record per crash (lib/supervision.ts). ``arena`` holds the running counters of the arena
// (lib/arena.ts).
//
// The supporting panels (Market & budget, Rate limits, Breakers, Memory, Collisions, Escalations,
// Results) are folded in ``panels``; ``groups`` counts events per list group for the event list.

import { emptyArena, fingerprint, foldArena, type ArenaState } from "./arena";
import { eventGroup } from "./eventlog";
import { asNumber, asString } from "./generic";
import { emptyPanels, foldPanels, type PanelsState } from "./panels";
import { emptySchedule, foldSchedule, type ScheduleState } from "./schedule";
import { emptySupervision, foldSupervision, type SupervisionState } from "./supervision";
import type { RunEvent } from "./types";

// "restarting": a supervised coordinator that crashed and is on its way back (see ``outage``).
export type ActorStatus = "alive" | "stopped" | "killed" | "dead" | "restarting";

/** A crashed coordinator's way back: the ring fills from ``sinceTs`` over ``restartInMs`` of
 * virtual time (lib/decay.ts restartProgress). */
export interface Outage {
  crash: number;
  sinceTs: number;
  sinceSeq: number;
  restartInMs: number;
}

export interface ActorNode {
  id: string;
  kind: string;
  parent: string | null;
  originalParent: string | null;
  spawnedSeq: number;
  status: ActorStatus;
  suspected: boolean;
  statusSeq?: number;
  statusTs?: number;
  stopReason?: string; // actor.stopped's reason: "crash" is a stop the restart undoes, "chaos" is not
  outage?: Outage;
  restartedTs?: number;
  adoptedBy?: string;
  adoptedSeq?: number;
  adoptedTs?: number;
  duties: string[];
  llmCalls: number;
  tokens: number;
  lastActiveSeq: number;
}

/** An LLM call between effect.started and its completion or cancellation. */
export interface InflightCall {
  actor: string;
  coordination: boolean;
  key: string; // fingerprint of the request: the same request twice is the same work done twice
  tag: string; // the effect's tag; an agent's is "<contract idem_key>:<step>"
}

export interface MessageFlash {
  seq: number;
  ts: number;
  from: string;
  to: string;
  topic: string;
}

export interface ChaosEntry {
  seq: number;
  ts: number;
  kind: string;
  targets: string[];
}

export interface Counters {
  events: number;
  messages: number;
  heartbeats: number;
  llmCalls: number;
  llmTokens: number;
  spentUsd: number;
  coordinationTokens: number;
  kills: number;
  deaths: number;
  adoptions: number;
  remappedKeys: number;
}

export interface ViewState {
  runId: string | null;
  scenario: string | null;
  seed: string | null;
  started: boolean;
  completed: boolean;
  lastSeq: number;
  lastTs: number;
  memberEpoch: number;
  marketEpoch: number;
  headHash: string | null;
  actors: Record<string, ActorNode>;
  order: string[];
  messages: MessageFlash[];
  chaos: ChaosEntry[];
  netFaults: Record<string, number>; // drop | delay | duplicate | reorder | partition_drop -> count
  ownership: Record<string, string>;
  inflight: Record<string, InflightCall>;
  counters: Counters;
  schedule: ScheduleState;
  panels: PanelsState;
  supervision: SupervisionState;
  arena: ArenaState;
  groups: Record<string, number>;
}

export const MESSAGE_WINDOW = 40;
const KILL_REASONS = new Set(["killed", "chaos", "crash", "crashed"]);
const HEARTBEAT_TOPICS = new Set(["heartbeat", "member.heartbeat"]);
// Faults of the chaos network: thousands per run, so they are counted, not listed.
const NET_FAULTS = new Set(["drop", "delay", "duplicate", "reorder", "partition_drop"]);

export const emptyView = (): ViewState => ({
  runId: null,
  scenario: null,
  seed: null,
  started: false,
  completed: false,
  lastSeq: 0,
  lastTs: 0,
  memberEpoch: 0,
  marketEpoch: 0,
  headHash: null,
  actors: {},
  order: [],
  messages: [],
  chaos: [],
  netFaults: {},
  ownership: {},
  inflight: {},
  counters: {
    events: 0,
    messages: 0,
    heartbeats: 0,
    llmCalls: 0,
    llmTokens: 0,
    spentUsd: 0,
    coordinationTokens: 0,
    kills: 0,
    deaths: 0,
    adoptions: 0,
    remappedKeys: 0,
  },
  schedule: emptySchedule(),
  panels: emptyPanels(),
  supervision: emptySupervision(),
  arena: emptyArena(),
  groups: {},
});

// An LLM call made for coordination (membership, ownership, takeover). FractalSwarm never
// makes one, so the counter stays at 0 by construction; the tag convention lets a baseline
// that does (an LLM supervisor re-reading state) show up here.
const isCoordinationCall = (payload: Record<string, unknown>): boolean => {
  const tag = typeof payload.tag === "string" ? payload.tag : "";
  const role = (payload.request as Record<string, unknown> | undefined)?.role;
  return tag.startsWith("coord") || role === "coordination";
};

function patchActor(state: ViewState, id: string, patch: Partial<ActorNode>): ViewState {
  const actor = state.actors[id];
  if (!actor) return state;
  return { ...state, actors: { ...state.actors, [id]: { ...actor, ...patch } } };
}

function bump(state: ViewState, patch: Partial<Counters>): ViewState {
  const counters = { ...state.counters };
  for (const [key, value] of Object.entries(patch) as [keyof Counters, number][]) {
    counters[key] += value;
  }
  return { ...state, counters };
}

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)];

function markDown(state: ViewState, ids: string[], status: ActorStatus, seq: number, ts: number): ViewState {
  let next = state;
  for (const id of ids) {
    const actor = next.actors[id];
    if (!actor) continue;
    // A detected death never hides the earlier kill: both show the red ✕.
    const keep = actor.status === "killed" && status === "dead";
    next = patchActor(next, id, {
      status: keep ? "killed" : status,
      statusSeq: keep ? actor.statusSeq : seq,
      statusTs: keep ? actor.statusTs : ts,
      suspected: false,
    });
  }
  return next;
}

function adopt(state: ViewState, event: RunEvent): ViewState {
  const p = event.payload;
  const dead = String(p.dead ?? p.from ?? "");
  const adopter = String(p.adopter ?? p.to ?? p.new_parent ?? "");
  if (!adopter) return state;
  const children = p.children
    ? asList(p.children)
    : state.order.filter((id) => state.actors[id].parent === dead);
  let next = state;
  for (const child of children) {
    if (child === adopter) continue;
    next = patchActor(next, child, { parent: adopter, adoptedBy: adopter, adoptedSeq: event.seq, adoptedTs: event.ts_virtual });
  }
  next = addDuties(next, adopter, asList(p.duties));
  return bump(next, { adoptions: 1 });
}

function addDuties(state: ViewState, id: string, duties: string[]): ViewState {
  const actor = state.actors[id];
  if (!actor || duties.length === 0) return state;
  const merged = [...actor.duties, ...duties.filter((d) => !actor.duties.includes(d))];
  return patchActor(state, id, { duties: merged });
}

function foldCore(state: ViewState, event: RunEvent): ViewState {
  const p = event.payload;
  switch (event.type) {
    case "run.started":
      return { ...state, runId: event.run_id, scenario: p.scenario, seed: p.seed, started: true };
    case "run.completed":
      return { ...state, completed: true };
    case "actor.spawned": {
      const id = String(p.actor_id);
      const node: ActorNode = {
        id,
        kind: String(p.kind),
        parent: p.parent ?? null,
        originalParent: p.parent ?? null,
        spawnedSeq: event.seq,
        status: "alive",
        suspected: false,
        duties: p.parent ? [] : ["root"],
        llmCalls: 0,
        tokens: 0,
        lastActiveSeq: event.seq,
      };
      const order = state.order.includes(id) ? state.order : [...state.order, id];
      return { ...state, actors: { ...state.actors, [id]: node }, order };
    }
    case "actor.stopped": {
      const id = String(p.actor_id);
      const killed = KILL_REASONS.has(String(p.reason ?? ""));
      // chaos.injected already counted a targeted kill; the stop that follows must not count it twice.
      const fresh = killed && state.actors[id] !== undefined && state.actors[id].status !== "killed";
      const stopped = markDown(state, [id], killed ? "killed" : "stopped", event.seq, event.ts_virtual);
      const next = patchActor(stopped, id, { stopReason: String(p.reason ?? "") });
      return fresh ? bump(next, { kills: 1 }) : next;
    }
    case "msg.sent": {
      const topic = String(p.topic ?? "");
      if (HEARTBEAT_TOPICS.has(topic)) return bump(state, { heartbeats: 1 });
      const flash: MessageFlash = { seq: event.seq, ts: event.ts_virtual, from: event.actor, to: String(p.to), topic };
      const messages = [...state.messages, flash].slice(-MESSAGE_WINDOW);
      const touched = patchActor(state, event.actor, { lastActiveSeq: event.seq });
      return bump({ ...touched, messages }, { messages: 1 });
    }
    case "effect.started": {
      if (p.kind !== "llm") return state;
      const inflight = {
        ...state.inflight,
        [p.effect_id]: {
          actor: event.actor,
          coordination: isCoordinationCall(p),
          key: fingerprint(p.request),
          tag: typeof p.tag === "string" ? p.tag : "",
        },
      };
      const actor = state.actors[event.actor];
      const next = actor
        ? patchActor(state, event.actor, { llmCalls: actor.llmCalls + 1, lastActiveSeq: event.seq })
        : state;
      return bump({ ...next, inflight }, { llmCalls: 1 });
    }
    case "effect.completed":
    case "effect.cancelled": {
      const call = state.inflight[p.effect_id];
      if (!call) return state;
      const inflight = { ...state.inflight };
      delete inflight[p.effect_id];
      const usage = p.result?.usage ?? {};
      const tokens = Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0);
      const actor = state.actors[call.actor];
      let next: ViewState = { ...state, inflight };
      if (actor) next = patchActor(next, call.actor, { tokens: actor.tokens + tokens });
      return bump(next, { llmTokens: tokens, coordinationTokens: call.coordination ? tokens : 0 });
    }
    case "budget.settled":
      return bump(state, { spentUsd: Number(p.actual_usd ?? 0) });
    case "chaos.injected": {
      const kind = String(p.fault ?? p.kind ?? "");
      if (NET_FAULTS.has(kind)) {
        return { ...state, netFaults: { ...state.netFaults, [kind]: (state.netFaults[kind] ?? 0) + 1 } };
      }
      const targets = [...asList(p.target), ...asList(p.targets)];
      const entry: ChaosEntry = { seq: event.seq, ts: event.ts_virtual, kind, targets };
      let next: ViewState = { ...state, chaos: [...state.chaos, entry] };
      if (kind.startsWith("kill")) {
        const fresh = targets.filter((id) => next.actors[id] !== undefined && next.actors[id].status !== "killed");
        next = bump(markDown(next, targets, "killed", event.seq, event.ts_virtual), { kills: fresh.length });
      }
      return next;
    }
    case "member.suspected":
      return patchActor(state, String(p.member), { suspected: true });
    case "member.dead":
      return bump(markDown(state, [String(p.member)], "dead", event.seq, event.ts_virtual), { deaths: 1 });
    case "tree.adopted":
      return adopt(state, event);
    case "baseline.crashed": {
      // The supervisor's node goes down and starts coming back; the chaos kill that caused it had
      // marked it killed for good.
      const coordinator = asString(p.coordinator, event.actor);
      const outage: Outage = {
        crash: asNumber(p.crash) ?? 0,
        sinceTs: event.ts_virtual,
        sinceSeq: event.seq,
        restartInMs: asNumber(p.restart_in_ms) ?? 0,
      };
      return patchActor(state, coordinator, {
        status: "restarting",
        statusSeq: event.seq,
        statusTs: event.ts_virtual,
        suspected: false,
        outage,
      });
    }
    case "baseline.restarted":
      return patchActor(state, asString(p.coordinator, event.actor), {
        status: "alive",
        statusSeq: event.seq,
        statusTs: event.ts_virtual,
        restartedTs: event.ts_virtual,
        outage: undefined,
      });
    case "ownership.assigned":
      return { ...state, ownership: { ...state.ownership, [String(p.key)]: String(p.owner) } };
    case "ownership.remapped": {
      const keys = [...asList(p.keys), ...asList(p.key)];
      const owner = String(p.owner ?? p.to);
      const ownership = { ...state.ownership };
      for (const key of keys) ownership[key] = owner;
      const next = addDuties({ ...state, ownership }, owner, asList(p.duties));
      return bump(next, { remappedKeys: keys.length });
    }
    default:
      return state;
  }
}

export function foldEvent(state: ViewState, event: RunEvent): ViewState {
  const core = foldCore(state, event);
  const group = eventGroup(event);
  const folded: ViewState = {
    ...core,
    lastSeq: event.seq,
    lastTs: event.ts_virtual,
    memberEpoch: Math.max(core.memberEpoch, event.member_epoch),
    marketEpoch: Math.max(core.marketEpoch, event.market_epoch ?? 0),
    headHash: event.hash,
    counters: { ...core.counters, events: core.counters.events + 1 },
    schedule: foldSchedule(core.schedule, event),
    panels: foldPanels(core.panels, event),
    supervision: foldSupervision(core.supervision, event),
    groups: { ...core.groups, [group]: (core.groups[group] ?? 0) + 1 },
  };
  return { ...folded, arena: foldArena(folded.arena, event, state, folded) };
}

export const foldEvents = (events: RunEvent[], from: ViewState = emptyView()): ViewState =>
  events.reduce(foldEvent, from);

/** Root duties: the original root while alive, else whoever took them over (spec §5.3). */
export function rootHolder(state: ViewState): string | null {
  const holders = state.order.filter((id) => state.actors[id].duties.includes("root"));
  const alive = holders.filter((id) => state.actors[id].status === "alive");
  return alive.at(-1) ?? holders.at(-1) ?? null;
}
