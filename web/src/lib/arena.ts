// Running counters for the arena: what a run has cost and suffered so far, as a pure fold.
//
// These are DISPLAY values, built from what the log shows event by event so a scrubber can drag
// them through a run. The official numbers (time to recover, coordinator-dependency time, wasted
// dollars) are scored by the Python metrics and served by the API; the claims in the video come
// from those. Where a display value approximates a metric, the comment says which.
//
//   coordinator crashes   chaos.injected kill_coordinator, or a baseline.crashed with none before it
//   coordinator down-time per crash, one window: a supervisor's baseline.crashed -> baseline.restarted;
//                         the swarm's kill -> the last takeover event for the victim (bench/recovery.py
//                         ends it at the last ownership.remapped, and tree.adopted lands with it)
//   idle agents           an agent that is alive (or stopped by the crash and waiting for the restart),
//                         has no call in flight, and answers to a coordinator that is down; integrated
//                         over virtual time in agent-ms. Approximates "idle agent-seconds", which also
//                         needs its session to have a blocked contract
//   re-dispatches         contract.dispatched of work that was rejected as lost, or of an idem_key that
//                         went out before
//   duplicated calls      LLM calls cancelled and then redone, plus completed calls whose request is one
//                         already paid for. "Redone" is the same request starting again (a plan, a
//                         judge) or, for an agent's call, its contract dispatched again. Approximates
//                         takeover.py's CancelledCall.redone / work_dispatched_again and Duplicates.groups
//   hard violations       the final schedule check, once task.result lands
//   cost so far           budget.settled, summed (Counters.spentUsd)

import { asString, asStrings } from "./generic";
import type { ActorNode, ViewState } from "./reducer";
import type { RunEvent } from "./types";

export interface OutageWindow {
  coordinator: string;
  since: number;
  until: number | null; // null while the coordinator is still down
  source: "chaos" | "supervisor"; // who reported it: a chaos kill (swarm) or a baseline.crashed
}

/** A cancelled call that has not been redone yet. */
interface Cancelled {
  key: string; // fingerprint of its request
  work: string | null; // an agent's call: the contract (goal/contract) it served
}

export interface ArenaState {
  windows: OutageWindow[];
  idleAgentMs: number;
  idleNow: number; // idle agents right now, as of the last event
  lastTs: number;
  redispatches: number;
  lostWork: Record<string, true>; // work rejected as lost and not sent again yet
  dispatchedKeys: Record<string, true>;
  attemptWork: Record<string, string>; // contract idem_key -> work
  duplicatedCalls: number;
  cancelled: Record<string, Cancelled>; // by effect id, until redone
  cancelledByRequest: Record<string, string[]>; // fingerprint -> effect ids
  cancelledByWork: Record<string, string[]>; // work -> effect ids
  paidRequests: Record<string, true>;
}

export const emptyArena = (): ArenaState => ({
  windows: [],
  idleAgentMs: 0,
  idleNow: 0,
  lastTs: 0,
  redispatches: 0,
  lostWork: {},
  dispatchedKeys: {},
  attemptWork: {},
  duplicatedCalls: 0,
  cancelled: {},
  cancelledByRequest: {},
  cancelledByWork: {},
  paidRequests: {},
});

/** The counters as the arena shows them. */
export interface ArenaCounters {
  costUsd: number;
  coordinatorCrashes: number;
  coordinatorDownMs: number;
  idleAgentMs: number;
  idleAgentsNow: number;
  redispatches: number;
  duplicatedCalls: number;
  hardViolations: number | null; // null until the run has been checked
}

/** 53-bit string hash of any JSON value: two LLM calls with the same request get the same key. */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const isLeaf = (actor: ActorNode): boolean => actor.kind === "agent" || actor.kind === "worker";
// A coordinator that is really out: killed, or crashed and restarting. One the detector declared
// dead with no kill (a false death) may still be working, so its agents are not waiting.
const DOWN: ReadonlySet<string> = new Set(["restarting", "killed"]);
const PAID: ReadonlySet<string> = new Set(["ok", "incomplete"]); // takeover.py PAID: a completion with these was billed

/** An agent that is waiting on its coordinator rather than finished or gone: alive, or stopped by
 * the crash (the restart brings it back). One that finished, or was killed by chaos, is not. */
const awaitsCoordinator = (actor: ActorNode): boolean =>
  actor.status === "alive" || (actor.status === "killed" && actor.stopReason === "crash");

/** Agents waiting on a coordinator that is down, and not in the middle of an LLM call. */
export function idleAgents(view: ViewState): number {
  const busy = new Set(Object.values(view.inflight).map((call) => call.actor));
  let idle = 0;
  for (const id of view.order) {
    const actor = view.actors[id];
    if (!isLeaf(actor) || busy.has(id) || !awaitsCoordinator(actor)) continue;
    const owner = actor.parent === null ? undefined : view.actors[actor.parent];
    if (owner && !isLeaf(owner) && DOWN.has(owner.status)) idle += 1;
  }
  return idle;
}

const workKey = (p: Record<string, unknown>): string => `${asString(p.goal_id)}/${asString(p.contract_id)}`;

function windowsFor(state: ArenaState, event: RunEvent): OutageWindow[] {
  const p = event.payload;
  const ts = event.ts_virtual;
  const lastOpen = (coordinator: string, source: OutageWindow["source"]): number => {
    for (let i = state.windows.length - 1; i >= 0; i--) {
      const w = state.windows[i];
      if (w.coordinator === coordinator && w.until === null && w.source === source) return i;
    }
    return -1;
  };
  const patch = (index: number, change: Partial<OutageWindow>): OutageWindow[] =>
    state.windows.map((w, i) => (i === index ? { ...w, ...change } : w));

  switch (event.type) {
    case "chaos.injected": {
      if (String(p.fault ?? p.kind ?? "") !== "kill_coordinator") return state.windows;
      const targets = [...asStrings(p.target), ...asStrings(p.targets)];
      return [...state.windows, ...targets.map((t): OutageWindow => ({ coordinator: t, since: ts, until: null, source: "chaos" }))];
    }
    case "baseline.crashed": {
      const coordinator = asString(p.coordinator, event.actor);
      const claimed = lastOpen(coordinator, "chaos");
      // The chaos kill that caused it already opened this window: the supervisor now owns it.
      if (claimed >= 0) return patch(claimed, { source: "supervisor" });
      return [...state.windows, { coordinator, since: ts, until: null, source: "supervisor" }];
    }
    case "baseline.restarted": {
      const index = lastOpen(asString(p.coordinator, event.actor), "supervisor");
      return index < 0 ? state.windows : patch(index, { until: ts });
    }
    case "member.dead":
    case "tree.adopted":
    case "ownership.remapped": {
      // The swarm's outage ends with the last takeover event for the victim, so each one
      // pushes the end of its window out.
      const victim = asString(event.type === "member.dead" ? p.member : event.type === "tree.adopted" ? (p.dead ?? p.from) : (p.previous ?? p.from));
      if (!victim) return state.windows;
      let changed = false;
      const windows = state.windows.map((w) => {
        if (w.coordinator !== victim || w.source !== "chaos") return w;
        changed = true;
        return { ...w, until: Math.max(w.until ?? w.since, ts) };
      });
      return changed ? windows : state.windows;
    }
    default:
      return state.windows;
  }
}

/** Calls cancelled earlier that this event redoes: count each once and forget it. */
function settleRedone(state: ArenaState, index: "cancelledByRequest" | "cancelledByWork", key: string): ArenaState {
  const ids = state[index][key];
  if (!ids) return state;
  const cancelled = { ...state.cancelled };
  let redone = 0;
  for (const id of ids) {
    if (cancelled[id]) {
      delete cancelled[id];
      redone += 1;
    }
  }
  const rest = { ...state[index] };
  delete rest[key];
  return { ...state, cancelled, [index]: rest, duplicatedCalls: state.duplicatedCalls + redone };
}

const withId = (index: Record<string, string[]>, key: string, id: string): Record<string, string[]> => ({
  ...index,
  [key]: [...(index[key] ?? []), id],
});

/** Fold one event. ``before`` is the view before the event, ``after`` the view after the tree
 * and panels have folded it. */
export function foldArena(state: ArenaState, event: RunEvent, before: ViewState, after: ViewState): ArenaState {
  const p = event.payload;
  const ts = event.ts_virtual;
  let next = state;

  // Idle agent-time accrues over the stretch since the previous event, at the count it left.
  if (state.idleNow > 0 && ts > state.lastTs) {
    next = { ...next, idleAgentMs: next.idleAgentMs + state.idleNow * (ts - state.lastTs) };
  }

  const windows = windowsFor(next, event);
  if (windows !== next.windows) next = { ...next, windows };

  switch (event.type) {
    case "contract.rejected":
      if (p.stage === "lost") next = { ...next, lostWork: { ...next.lostWork, [workKey(p)]: true } };
      break;
    case "contract.dispatched": {
      const work = workKey(p);
      const sent = asString(p.idem_key);
      const again = next.lostWork[work] === true || (sent !== "" && next.dispatchedKeys[sent] === true);
      const lostWork = { ...next.lostWork };
      delete lostWork[work];
      next = {
        ...next,
        lostWork,
        dispatchedKeys: sent ? { ...next.dispatchedKeys, [sent]: true } : next.dispatchedKeys,
        attemptWork: sent ? { ...next.attemptWork, [sent]: work } : next.attemptWork,
        redispatches: next.redispatches + (again ? 1 : 0),
      };
      next = settleRedone(next, "cancelledByWork", work);
      break;
    }
    case "effect.cancelled": {
      const id = asString(p.effect_id);
      const call = before.inflight[id];
      if (!call) break;
      const work = next.attemptWork[call.tag.split(":", 1)[0]] ?? null;
      next = {
        ...next,
        cancelled: { ...next.cancelled, [id]: { key: call.key, work } },
        cancelledByRequest: withId(next.cancelledByRequest, call.key, id),
        cancelledByWork: work === null ? next.cancelledByWork : withId(next.cancelledByWork, work, id),
      };
      break;
    }
    case "effect.started": {
      const call = after.inflight[asString(p.effect_id)];
      if (call) next = settleRedone(next, "cancelledByRequest", call.key);
      break;
    }
    case "effect.completed": {
      const call = before.inflight[asString(p.effect_id)];
      if (!call || !PAID.has(asString(p.status))) break;
      next = next.paidRequests[call.key]
        ? { ...next, duplicatedCalls: next.duplicatedCalls + 1 }
        : { ...next, paidRequests: { ...next.paidRequests, [call.key]: true } };
      break;
    }
  }

  const anyDown = next.windows.some((w) => w.until === null) || Object.values(after.actors).some((a) => DOWN.has(a.status));
  const idleNow = anyDown ? idleAgents(after) : 0;
  return idleNow === next.idleNow && ts === next.lastTs ? next : { ...next, idleNow, lastTs: ts };
}

/** The counters at virtual time ``nowMs``. An outage that has not ended keeps growing with the
 * playhead, which is why the time is passed in. */
export function arenaCounters(view: ViewState, nowMs: number): ArenaCounters {
  const { arena } = view;
  const down = arena.windows.reduce((sum, w) => sum + Math.max(0, (w.until ?? nowMs) - w.since), 0);
  const idle = arena.idleAgentMs + (arena.idleNow > 0 ? arena.idleNow * Math.max(0, nowMs - arena.lastTs) : 0);
  return {
    costUsd: view.counters.spentUsd,
    coordinatorCrashes: arena.windows.length,
    coordinatorDownMs: down,
    idleAgentMs: idle,
    idleAgentsNow: arena.idleNow,
    redispatches: arena.redispatches,
    duplicatedCalls: arena.duplicatedCalls,
    hardViolations: view.schedule.hardViolations,
  };
}
