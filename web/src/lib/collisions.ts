// Collisions log (spec §6): every booking conflict, and how it was resolved, as a fold.
//
//   lease.booked         {holder, goal_id, keys}                 a squad took its slot and speaker keys
//   collision.detected   {kind, goal_id, holder, conflicts: [{key, reason, holder, version}]}
//   collision.resolved   {kind, goal_id, resolution}             emitted by the owner that re-placed it
//
// ``collision_id`` and ``arbiter`` (the shape the schedule grid proposed on Day 7) are read too.
//
// A semantic collision (two contracts published different values for one key) carries ``kind:
// "semantic"`` and the disputed ``key``; the owner of the lowest common ancestor goal then
// arbitrates (actors/arbitration.py, W3):
//
//   arbitration.requested  {key, ...}                                    the arbiter call went out
//   arbitration.ruled      {key, winner, reason, confidence, evidence}   the ruling; ``evidence`` is
//                                                                        the ids of the sources
//
// Aliases are read for the ruling's fields (value for winner, rationale for reason, evidence_ids
// or sources for evidence), because the event shapes are still settling.

import { claimedBy } from "./families";
import {
  appendCapped,
  asNumber,
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
  key?: string; // the disputed fact, for a semantic collision
}

export interface ArbitrationRow {
  id: string;
  key: string;
  status: "requested" | "ruled";
  arbiter: string;
  requestedSeq: number;
  requestedTs: number;
  ruledSeq?: number;
  ruledTs?: number;
  winner?: string;
  reason?: string;
  confidence?: number;
  evidence: string[];
}

export interface CollisionsState {
  rows: CollisionRow[];
  arbitrations: ArbitrationRow[];
  leases: number;
  leasedCells: number;
  leasedSpeakers: number;
  holders: Record<string, number>; // squad -> leases booked
  other: GenericEntry[];
}

export const emptyCollisions = (): CollisionsState => ({
  rows: [],
  arbitrations: [],
  leases: 0,
  leasedCells: 0,
  leasedSpeakers: 0,
  holders: {},
  other: [],
});

const ROWS_KEPT = 300;
const COLLISION_TYPES: ReadonlySet<string> = new Set([
  "lease.booked",
  "collision.detected",
  "collision.resolved",
  "arbitration.requested",
  "arbitration.ruled",
]);

/** A value the payload gives as text, a number or a structure, on one line. */
function shown(value: unknown, max = 160): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const firstOf = (p: Record<string, unknown>, ...names: string[]): unknown => names.map((n) => p[n]).find((v) => v !== undefined && v !== null);
const disputeKey = (p: Record<string, unknown>): string => asString(firstOf(p, "key", "fact_key", "dispute_id", "collision_id"));

function conflictsOf(payload: Record<string, unknown>): Conflict[] {
  if (Array.isArray(payload.conflicts)) {
    return payload.conflicts.map((entry) => {
      const c = asRecord(entry);
      return { key: asString(c.key), reason: asString(c.reason), holder: asString(c.holder) };
    });
  }
  if (payload.kind === "semantic") {
    return [{ key: asString(payload.key), reason: "different values", holder: asStrings(firstOf(payload, "holders", "contracts", "squads")).join(" vs ") }];
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
      const kind = asString(p.kind, "temporal");
      const key = kind === "semantic" ? disputeKey(p) : undefined;
      const sameSubject = state.rows.filter((row) => (key !== undefined ? row.key === key : row.goalId === goalId)).length;
      const row: CollisionRow = {
        id: asString(p.collision_id, `${key ?? goalId}#${sameSubject + 1}`),
        kind,
        goalId,
        holder: asString(p.holder, event.actor),
        conflicts: conflictsOf(p),
        status: "open",
        detectedSeq: event.seq,
        detectedTs: event.ts_virtual,
        ...(key !== undefined && { key }),
      };
      return { ...state, rows: appendCapped(state.rows, row, ROWS_KEPT) };
    }
    case "collision.resolved": {
      const goalId = asString(p.goal_id);
      const byId = p.collision_id === undefined ? null : asString(p.collision_id);
      const semantic = p.kind === "semantic";
      const key = disputeKey(p);
      const rows = state.rows.map((row) => {
        if (row.status !== "open") return row;
        const same =
          byId !== null
            ? row.id === byId
            : semantic
              ? row.key === key
              : row.goalId === goalId && row.kind === asString(p.kind, row.kind);
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
    case "arbitration.requested": {
      const key = disputeKey(p);
      const sameKey = state.arbitrations.filter((row) => row.key === key).length;
      const row: ArbitrationRow = {
        id: `${key}#${sameKey + 1}`,
        key,
        status: "requested",
        arbiter: asString(firstOf(p, "arbiter", "owner"), event.actor),
        requestedSeq: event.seq,
        requestedTs: event.ts_virtual,
        evidence: asStrings(firstOf(p, "evidence", "evidence_ids", "sources")),
      };
      return { ...state, arbitrations: appendCapped(state.arbitrations, row, ROWS_KEPT) };
    }
    case "arbitration.ruled": {
      const key = disputeKey(p);
      let index = -1;
      for (let i = state.arbitrations.length - 1; i >= 0; i--) {
        if (state.arbitrations[i].key === key && state.arbitrations[i].status === "requested") {
          index = i;
          break;
        }
      }
      const ruling = {
        status: "ruled" as const,
        ruledSeq: event.seq,
        ruledTs: event.ts_virtual,
        winner: shown(firstOf(p, "winner", "value", "ruling")),
        reason: shown(firstOf(p, "reason", "rationale"), 240),
        confidence: asNumber(p.confidence) ?? undefined,
        evidence: asStrings(firstOf(p, "evidence", "evidence_ids", "sources")),
      };
      // A ruling with no request before it (the request was in an earlier window) still shows.
      const arbitrations =
        index >= 0
          ? state.arbitrations.map((row, i) => (i === index ? { ...row, ...ruling, evidence: ruling.evidence.length ? ruling.evidence : row.evidence } : row))
          : appendCapped(
              state.arbitrations,
              { id: `${key}#${state.arbitrations.filter((r) => r.key === key).length + 1}`, key, arbiter: event.actor, requestedSeq: event.seq, requestedTs: event.ts_virtual, ...ruling },
              ROWS_KEPT,
            );
      return { ...state, arbitrations };
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

export const openArbitrationCount = (state: CollisionsState): number =>
  state.arbitrations.reduce((count, row) => (row.status === "requested" ? count + 1 : count), 0);
