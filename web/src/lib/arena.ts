// Running counters for the arena: what a run has cost and suffered so far, as a pure fold.
//
// These are DISPLAY values, built from what the log shows event by event so a scrubber can drag
// them through a run. The official numbers (time to recover, coordinator-dependency time, wasted
// dollars) are scored by the Python metrics and served by the API; the claims in the video come
// from those. Where a display value approximates a metric, the comment says which; the two that
// are ports of the scored definitions (lib/recovery.ts) end on the scored number, to the
// millisecond (arena.parity.test.ts).
//
//   coordinator crashes   chaos.injected kill_coordinator, or a baseline.crashed with none before it
//   coordinator down-time per crash, one window: a supervisor's baseline.crashed -> baseline.restarted;
//                         the swarm's kill -> the last takeover event for the victim (bench/recovery.py
//                         ends it at the last ownership.remapped, and tree.adopted lands with it)
//   re-dispatches        contract.dispatched of work that was rejected as lost, or of an idem_key that
//                         went out before
//   duplicated calls      the scored "Duplicated work" (bench/recovery.py dup_calls), by the same
//                         rules on the events so far: a call of an attempt that a later attempt of
//                         its contract replaced, an own call (plan, judge, scan) asked again, or a
//                         completed call whose request was already paid for (lib/recovery.ts)
//   dependency time       the scored "coordinator-dependency time" (cdt_s): the contract-time that
//                         work spent waiting while the coordinator that owned its goal was down
//                         (lib/recovery.ts). The window a coordinator was down is `coordinatorDownMs`
//   hard violations       the final schedule check, once task.result lands
//   cost so far           budget.settled, summed (Counters.spentUsd)
//
// The idle agent-seconds are not a counter of this file: the scoreboard reads them from lib/recovery.ts
// (`recoveryAt(...).idleMs`), the scored rule run on the log so far.

import { asString, asStrings } from "./generic";
import type { ViewState } from "./reducer";
import { emptyRecorded, isRecoveryEvent, record, recoveryAt, type Recorded } from "./recovery";
import type { RunEvent } from "./types";

export interface OutageWindow {
  coordinator: string;
  since: number;
  until: number | null; // null while the coordinator is still down
  source: "chaos" | "supervisor"; // who reported it: a chaos kill (swarm) or a baseline.crashed
}

export interface ArenaState {
  windows: OutageWindow[];
  redispatches: number;
  lostWork: Record<string, true>; // work rejected as lost and not sent again yet
  dispatchedKeys: Record<string, true>;
  recorded: Recorded; // the events the scored figures read (lib/recovery.ts)
}

export const emptyArena = (): ArenaState => ({
  windows: [],
  redispatches: 0,
  lostWork: {},
  dispatchedKeys: {},
  recorded: emptyRecorded(),
});

/** The counters as the arena shows them. */
export interface ArenaCounters {
  costUsd: number;
  coordinatorCrashes: number;
  coordinatorDownMs: number;
  dependencyMs: number; // the scored coordinator-dependency time, on the log so far
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

/** Fold one event. The view after the tree and panels have folded it (``_after``) is passed by the reducer and not read here. */
export function foldArena(state: ArenaState, event: RunEvent): ArenaState {
  const p = event.payload;
  let next = state;
  if (isRecoveryEvent(event)) next = { ...next, recorded: record(next.recorded, event) };

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
        redispatches: next.redispatches + (again ? 1 : 0),
      };
      break;
    }
  }

  return next;
}

/** The counters at virtual time ``nowMs``. An outage that has not ended keeps growing with the
 * playhead, which is why the time is passed in. */
export function arenaCounters(view: ViewState, nowMs: number): ArenaCounters {
  const { arena } = view;
  const recovery = recoveryAt(arena.recorded, nowMs);
  const down = arena.windows.reduce((sum, w) => sum + Math.max(0, (w.until ?? nowMs) - w.since), 0);
  return {
    costUsd: view.counters.spentUsd,
    coordinatorCrashes: arena.windows.length,
    coordinatorDownMs: down,
    dependencyMs: recovery.dependencyMs,
    redispatches: arena.redispatches,
    duplicatedCalls: recovery.duplicatedCalls,
    hardViolations: view.schedule.hardViolations,
  };
}
