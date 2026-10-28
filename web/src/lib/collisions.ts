// Collisions log (spec §6): every booking conflict, and how it was resolved, as a fold.
//
//   lease.booked         {holder, goal_id, keys}                 a squad took its slot and speaker keys
//   collision.detected   {kind, goal_id, holder, conflicts: [{key, reason, holder, version}]}
//   collision.resolved   {kind, goal_id, resolution}             emitted by the owner that re-placed it
//
// ``collision_id`` and ``arbiter`` (the shape the schedule grid proposed on Day 7) are read too.

import { claimedBy } from "./families";
import {
  appendCapped,
  asRecord,
  asString,
  asStrings,
  GENERIC_CAP,
  genericEntry,
  type GenericEntry,
} from "./generic";
import type { RunEvent } from "./types";

export interface Conflict {
  key: string;
  reason: string; // leased | version | fenced
  holder: string;
}

export interface CollisionRow {
  id: string;
  kind: string;
  goalId: string;
  holder: string;
  conflicts: Conflict[];
  status: "open" | "resolved";
  detectedSeq: number;
  detectedTs: number;
  resolvedSeq?: number;
  resolvedTs?: number;
  resolution?: string;
  arbiter?: string;
}

export interface CollisionsState {
  rows: CollisionRow[];
  leases: number;
  leasedCells: number;
  leasedSpeakers: number;
  holders: Record<string, number>; // squad -> leases booked
  other: GenericEntry[];
}

export const emptyCollisions = (): CollisionsState => ({
  rows: [],
  leases: 0,
  leasedCells: 0,
  leasedSpeakers: 0,
  holders: {},
  other: [],
});

const ROWS_KEPT = 300;
const COLLISION_TYPES: ReadonlySet<string> = new Set(["lease.booked", "collision.detected", "collision.resolved"]);

function conflictsOf(payload: Record<string, unknown>): Conflict[] {
  if (Array.isArray(payload.conflicts)) {
    return payload.conflicts.map((entry) => {
      const c = asRecord(entry);
      return { key: asString(c.key), reason: asString(c.reason), holder: asString(c.holder) };
    });
  }
  // The Day 7 shape: the colliding cells and the squads that wanted them.
  const squads = asStrings(payload.squads);
  return (Array.isArray(payload.cells) ? payload.cells : []).map((cell) => {
    const c = asRecord(cell);
    return { key: `cell:${asString(c.day)}:${asString(c.slot)}:${asString(c.room)}`, reason: "", holder: squads.join(" vs ") };
  });
}

export function foldCollisions(state: CollisionsState, event: RunEvent): CollisionsState {
  const p = event.payload;
  switch (event.type) {
    case "lease.booked": {
      const keys = asStrings(p.keys);
      const holder = asString(p.holder);
      return {
        ...state,
        leases: state.leases + 1,
        leasedCells: state.leasedCells + keys.filter((k) => k.startsWith("cell:")).length,
        leasedSpeakers: state.leasedSpeakers + keys.filter((k) => k.startsWith("speaker:")).length,
        holders: { ...state.holders, [holder]: (state.holders[holder] ?? 0) + 1 },
      };
    }
    case "collision.detected": {
      const goalId = asString(p.goal_id);
      const sameGoal = state.rows.filter((row) => row.goalId === goalId).length;
      const row: CollisionRow = {
        id: asString(p.collision_id, `${goalId}#${sameGoal + 1}`),
        kind: asString(p.kind, "temporal"),
        goalId,
        holder: asString(p.holder, event.actor),
        conflicts: conflictsOf(p),
        status: "open",
        detectedSeq: event.seq,
        detectedTs: event.ts_virtual,
      };
      return { ...state, rows: appendCapped(state.rows, row, ROWS_KEPT) };
    }
    case "collision.resolved": {
      const goalId = asString(p.goal_id);
      const byId = p.collision_id === undefined ? null : asString(p.collision_id);
      const rows = state.rows.map((row) => {
        if (row.status !== "open") return row;
        const same = byId !== null ? row.id === byId : row.goalId === goalId && row.kind === asString(p.kind, row.kind);
        if (!same) return row;
        return {
          ...row,
          status: "resolved" as const,
          resolvedSeq: event.seq,
          resolvedTs: event.ts_virtual,
          resolution: asString(p.resolution, asString(p.rule)),
          arbiter: asString(p.arbiter, event.actor),
        };
      });
      return { ...state, rows };
    }
    default:
      if (claimedBy(event.type) === "collisions" && !COLLISION_TYPES.has(event.type)) {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}

export const openCollisionCount = (state: CollisionsState): number =>
  state.rows.reduce((count, row) => (row.status === "open" ? count + 1 : count), 0);
