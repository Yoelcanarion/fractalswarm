// Supervised coordinators: the crash and restart of the baselines' o0, and the goals a durable
// supervisor keeps in its log.
//
//   baseline.crashed    {coordinator, crash, dispatched, lost: [..], restart_in_ms}
//                       lost is the work the crash threw away: the contracts in flight for the
//                       central baseline, the cancelled own call tags for `durable`, and nothing
//                       for `durable-max`
//   supervisor.adopted  {results, verdicts, plans, bookings, waiting}      durable modes only
//                       what the restarted supervisor read back from the log instead of redoing
//   baseline.restarted  {coordinator, crash, redo: [..]}                    the contracts re-run
//   goal.opened         {goal_id, owner, parent, level, goal}               durable modes only
//
// The counts in supervisor.adopted may arrive as numbers or as lists of ids; both are read.

import { asNumber, asRecord, asString, asStrings } from "./generic";
import type { RunEvent } from "./types";

export interface Adoption {
  results: number;
  verdicts: number;
  plans: number;
  bookings: number;
  waiting: number;
  seq: number;
  ts: number;
}

export interface CrashRecord {
  coordinator: string;
  crash: number; // the payload's crash number
  seq: number;
  ts: number;
  restartInMs: number;
  dispatched: number; // contracts in flight when it crashed
  lost: string[];
  restartedSeq: number | null;
  restartedTs: number | null;
  redo: string[]; // contracts re-run after the restart
  adopted: Adoption | null; // what a durable supervisor read back from its log
}

export interface GoalRecord {
  id: string;
  owner: string;
  parent: string | null;
  level: number;
  goal: string;
  seq: number;
  ts: number;
}

export interface SupervisionState {
  crashes: CrashRecord[];
  goals: Record<string, GoalRecord>;
  goalOrder: string[];
}

export const emptySupervision = (): SupervisionState => ({ crashes: [], goals: {}, goalOrder: [] });

/** A count that the payload gives as a number, a list or a map. */
export function countOf(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  const n = asNumber(value);
  if (n !== null) return n;
  return value !== null && typeof value === "object" ? Object.keys(value).length : 0;
}

function patchLast(state: SupervisionState, index: number, patch: Partial<CrashRecord>): SupervisionState {
  const crashes = state.crashes.slice();
  crashes[index] = { ...crashes[index], ...patch };
  return { ...state, crashes };
}

/** The crash a later event belongs to: the coordinator's latest that has not restarted yet, or
 * else its latest. */
function crashIndexFor(state: SupervisionState, coordinator: string): number {
  let latest = -1;
  for (let i = state.crashes.length - 1; i >= 0; i--) {
    if (state.crashes[i].coordinator !== coordinator) continue;
    if (state.crashes[i].restartedSeq === null) return i;
    if (latest < 0) latest = i;
  }
  return latest;
}

export function foldSupervision(state: SupervisionState, event: RunEvent): SupervisionState {
  const p = event.payload;
  switch (event.type) {
    case "baseline.crashed": {
      const record: CrashRecord = {
        coordinator: asString(p.coordinator, event.actor),
        crash: asNumber(p.crash) ?? state.crashes.length + 1,
        seq: event.seq,
        ts: event.ts_virtual,
        restartInMs: asNumber(p.restart_in_ms) ?? 0,
        dispatched: countOf(p.dispatched),
        lost: asStrings(p.lost),
        restartedSeq: null,
        restartedTs: null,
        redo: [],
        adopted: null,
      };
      return { ...state, crashes: [...state.crashes, record] };
    }
    case "supervisor.adopted": {
      const index = crashIndexFor(state, event.actor);
      if (index < 0) return state;
      const adopted: Adoption = {
        results: countOf(p.results),
        verdicts: countOf(p.verdicts),
        plans: countOf(p.plans),
        bookings: countOf(p.bookings),
        waiting: countOf(p.waiting),
        seq: event.seq,
        ts: event.ts_virtual,
      };
      return patchLast(state, index, { adopted });
    }
    case "baseline.restarted": {
      const index = crashIndexFor(state, asString(p.coordinator, event.actor));
      if (index < 0) return state;
      return patchLast(state, index, { restartedSeq: event.seq, restartedTs: event.ts_virtual, redo: asStrings(p.redo) });
    }
    case "goal.opened": {
      const id = asString(p.goal_id);
      if (!id) return state;
      const goal: GoalRecord = {
        id,
        owner: asString(p.owner, event.actor),
        parent: p.parent === undefined || p.parent === null ? null : asString(p.parent),
        level: asNumber(p.level) ?? 0,
        goal: typeof p.goal === "string" ? p.goal : asString(asRecord(p.goal).title ?? asRecord(p.goal).description),
        seq: event.seq,
        ts: event.ts_virtual,
      };
      return {
        ...state,
        goals: { ...state.goals, [id]: goal },
        goalOrder: state.goalOrder.includes(id) ? state.goalOrder : [...state.goalOrder, id],
      };
    }
    default:
      return state;
  }
}

export interface SupervisionTotals {
  crashes: number;
  restarts: number;
  redone: number; // contracts re-run after a restart
  adopted: number; // results read back from the log instead
}

export function supervisionTotals(state: SupervisionState): SupervisionTotals {
  return state.crashes.reduce<SupervisionTotals>(
    (totals, crash) => ({
      crashes: totals.crashes + 1,
      restarts: totals.restarts + (crash.restartedSeq === null ? 0 : 1),
      redone: totals.redone + crash.redo.length,
      adopted: totals.adopted + (crash.adopted?.results ?? 0),
    }),
    { crashes: 0, restarts: 0, redone: 0, adopted: 0 },
  );
}
