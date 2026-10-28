// Market & budget (spec §7): the run's money as a fold over the budget events.
//
//   run.started        {run_cap_usd, project_remaining_usd}
//   budget.cap_set     {level, key, usd}                       a cap set during the run
//   budget.shock       {level, key, usd, reason}               a new cap from outside (UI or API)
//   budget.reserved    {effect_id, usd, scopes: {run, squad, contract, ...}}
//   budget.settled     {effect_id, reserved_usd, actual_usd}   the difference is released
//   budget.refused     {effect_id, usd, level, key}
//   run.halted         {reason, by}                            the kill switch
//   effect.started / effect.completed (kind llm)                who spent it: role and model
//
// Market families that land later (epochs, bids, allocations, top-ups, feasibility, risk) show as
// generic rows until this fold learns their fields.

import { claimedBy } from "./families";
import {
  appendCapped,
  asNumber,
  asRecord,
  asString,
  GENERIC_CAP,
  genericEntry,
  type GenericEntry,
} from "./generic";
import type { RunEvent } from "./types";

// config/defaults.yaml budget.ladder and breakers.global_spend (market/ladder.py, spend_breaker.py).
export const LADDER = { L1: 0.8, L2: 0.9, stop: 0.95 } as const;
export const BURN_WINDOW_MS = 60_000;
export const BURN_LIMIT_SHARE = 0.2;
const BURN_POINTS = 600;
const REFUSALS_KEPT = 30;

export type LadderLevel = "L0" | "L1" | "L2" | "stop";

export interface Reservation {
  usd: number;
  squad: string | null;
}

export interface SquadSpend {
  squad: string;
  spent: number;
  reserved: number;
  calls: number;
  refused: number;
}

export interface ModelSpend {
  model: string;
  calls: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface RoleSpend {
  role: string;
  calls: number;
  usd: number;
}

export interface BurnPoint {
  ts: number;
  spent: number;
  reserved: number;
  cap: number | null;
}

export interface CapChange {
  seq: number;
  ts: number;
  level: string;
  key: string;
  usd: number;
  shock: boolean;
  reason: string;
}

export interface Refusal {
  seq: number;
  ts: number;
  actor: string;
  effectId: string;
  usd: number;
  level: string;
  key: string;
}

export interface Halt {
  seq: number;
  ts: number;
  reason: string;
  by: string;
}

export interface EconomyState {
  runId: string | null;
  caps: Record<string, number>; // `${level}:${key}` -> usd
  capChanges: CapChange[];
  spentUsd: number;
  reservedUsd: number;
  open: Record<string, Reservation>;
  settled: number;
  cancelled: number;
  refusals: Refusal[];
  refusedCount: number;
  squads: Record<string, SquadSpend>;
  models: Record<string, ModelSpend>;
  roles: Record<string, RoleSpend>;
  callRole: Record<string, string>;
  burn: BurnPoint[];
  recent: [number, number][]; // (virtual ms, usd) settled inside the burn window
  halted: Halt | null;
  other: GenericEntry[];
}

export const emptyEconomy = (): EconomyState => ({
  runId: null,
  caps: {},
  capChanges: [],
  spentUsd: 0,
  reservedUsd: 0,
  open: {},
  settled: 0,
  cancelled: 0,
  refusals: [],
  refusedCount: 0,
  squads: {},
  models: {},
  roles: {},
  callRole: {},
  burn: [],
  recent: [],
  halted: null,
  other: [],
});

const ECONOMY_TYPES: ReadonlySet<string> = new Set([
  "run.started",
  "run.halted",
  "budget.cap_set",
  "budget.shock",
  "budget.reserved",
  "budget.settled",
  "budget.refused",
  "effect.started",
  "effect.completed",
  "effect.cancelled",
]);

const bump = <T extends { calls: number }>(record: Record<string, T>, key: string, make: () => T): T => {
  const row = record[key] ?? make();
  return { ...row, calls: row.calls + 1 };
};

// Reservations are added and released as floats; what is left over after the last one is noise.
const settleFloat = (value: number): number => (Math.abs(value) < 1e-9 ? 0 : value);

const runCapOf = (state: EconomyState): number | null =>
  state.runId === null ? null : (state.caps[`run:${state.runId}`] ?? null);

function withSquad(state: EconomyState, squad: string, patch: (row: SquadSpend) => SquadSpend): Record<string, SquadSpend> {
  const row = state.squads[squad] ?? { squad, spent: 0, reserved: 0, calls: 0, refused: 0 };
  return { ...state.squads, [squad]: patch(row) };
}

function burnPoint(state: EconomyState, ts: number): BurnPoint[] {
  const point: BurnPoint = { ts, spent: state.spentUsd, reserved: state.reservedUsd, cap: runCapOf(state) };
  const burn = [...state.burn, point];
  return burn.length > BURN_POINTS ? burn.filter((_, i) => i % 2 === 0 || i === burn.length - 1) : burn;
}

function setCap(state: EconomyState, event: RunEvent, shock: boolean): EconomyState {
  const p = event.payload;
  const usdValue = asNumber(p.usd);
  if (usdValue === null) return state;
  const level = asString(p.level, "run");
  const key = asString(p.key, event.run_id);
  const change: CapChange = {
    seq: event.seq,
    ts: event.ts_virtual,
    level,
    key,
    usd: usdValue,
    shock,
    reason: asString(p.reason),
  };
  const next = { ...state, caps: { ...state.caps, [`${level}:${key}`]: usdValue }, capChanges: [...state.capChanges, change] };
  return { ...next, burn: burnPoint(next, event.ts_virtual) };
}

export function foldEconomy(state: EconomyState, event: RunEvent): EconomyState {
  const p = event.payload;
  switch (event.type) {
    case "run.started": {
      const caps: Record<string, number> = {};
      const cap = asNumber(p.run_cap_usd);
      if (cap !== null) caps[`run:${event.run_id}`] = cap;
      const project = asNumber(p.project_remaining_usd);
      if (project !== null) caps["project:project"] = project;
      return { ...state, runId: event.run_id, caps };
    }
    case "run.halted":
      return state.halted
        ? state
        : { ...state, halted: { seq: event.seq, ts: event.ts_virtual, reason: asString(p.reason), by: asString(p.by, "human") } };
    case "budget.cap_set":
      return setCap(state, event, false);
    case "budget.shock":
      return setCap(state, event, true);
    case "budget.reserved": {
      const effectId = asString(p.effect_id);
      const amount = asNumber(p.usd) ?? 0;
      const squad = asString(asRecord(p.scopes).squad) || null;
      const next: EconomyState = {
        ...state,
        open: { ...state.open, [effectId]: { usd: amount, squad } },
        reservedUsd: state.reservedUsd + amount,
      };
      if (squad === null) return next;
      return { ...next, squads: withSquad(next, squad, (row) => ({ ...row, reserved: row.reserved + amount, calls: row.calls + 1 })) };
    }
    case "budget.settled": {
      const effectId = asString(p.effect_id);
      const held = state.open[effectId];
      const actual = asNumber(p.actual_usd) ?? 0;
      const released = held?.usd ?? asNumber(p.reserved_usd) ?? 0;
      const open = { ...state.open };
      delete open[effectId];
      const cutoff = event.ts_virtual - BURN_WINDOW_MS;
      let next: EconomyState = {
        ...state,
        open,
        settled: state.settled + 1,
        spentUsd: state.spentUsd + actual,
        reservedUsd: settleFloat(Math.max(state.reservedUsd - released, 0)),
        recent: [...state.recent.filter(([at]) => at > cutoff), [event.ts_virtual, actual]],
      };
      if (held?.squad) {
        next = {
          ...next,
          squads: withSquad(next, held.squad, (row) => ({
            ...row,
            spent: row.spent + actual,
            reserved: settleFloat(Math.max(row.reserved - released, 0)),
          })),
        };
      }
      return { ...next, burn: burnPoint(next, event.ts_virtual) };
    }
    case "budget.refused": {
      const refusal: Refusal = {
        seq: event.seq,
        ts: event.ts_virtual,
        actor: event.actor,
        effectId: asString(p.effect_id),
        usd: asNumber(p.usd) ?? 0,
        level: asString(p.level),
        key: asString(p.key),
      };
      const squads = withSquad(state, event.actor, (row) => ({ ...row, refused: row.refused + 1 }));
      return { ...state, squads, refusedCount: state.refusedCount + 1, refusals: appendCapped(state.refusals, refusal, REFUSALS_KEPT) };
    }
    case "effect.started": {
      if (p.kind !== "llm") return state;
      const role = asString(asRecord(p.request).role, "unknown");
      return { ...state, callRole: { ...state.callRole, [asString(p.effect_id)]: role } };
    }
    case "effect.cancelled": {
      if (p.kind !== "llm") return state;
      const callRole = { ...state.callRole };
      delete callRole[asString(p.effect_id)];
      return { ...state, callRole, cancelled: state.cancelled + 1 };
    }
    case "effect.completed": {
      if (p.kind !== "llm") return state;
      const effectId = asString(p.effect_id);
      const role = state.callRole[effectId];
      const callRole = { ...state.callRole };
      delete callRole[effectId];
      const result = asRecord(p.result);
      const model = asString(result.model);
      if (!model) return { ...state, callRole };
      const cost = asNumber(result.cost_usd) ?? 0;
      const usage = asRecord(result.usage);
      const modelRow = bump(state.models, model, () => ({ model, calls: 0, usd: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 }));
      const models = {
        ...state.models,
        [model]: {
          ...modelRow,
          usd: modelRow.usd + cost,
          inputTokens: modelRow.inputTokens + (asNumber(usage.input_tokens) ?? 0),
          outputTokens: modelRow.outputTokens + (asNumber(usage.output_tokens) ?? 0),
          cachedTokens: modelRow.cachedTokens + (asNumber(usage.cached_tokens) ?? 0),
        },
      };
      const roleName = role ?? "unknown";
      const roleRow = bump(state.roles, roleName, () => ({ role: roleName, calls: 0, usd: 0 }));
      return { ...state, callRole, models, roles: { ...state.roles, [roleName]: { ...roleRow, usd: roleRow.usd + cost } } };
    }
    default:
      if (claimedBy(event.type) === "market" && !ECONOMY_TYPES.has(event.type)) {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}

// -- selectors ------------------------------------------------------------------------

export const runCap = runCapOf;

/** Settled plus open reservations: what the ladder counts (market/ladder.py). */
export const committed = (state: EconomyState): number => state.spentUsd + state.reservedUsd;

export function ladderLevel(spent: number, cap: number | null): LadderLevel {
  if (cap === null) return "L0";
  if (cap <= 0) return "stop";
  const share = spent / cap;
  if (share >= LADDER.stop) return "stop";
  if (share >= LADDER.L2) return "L2";
  if (share >= LADDER.L1) return "L1";
  return "L0";
}

/** Spend settled in the last minute of virtual time, and the level at which the global spend
 * breaker trips (20% of the budget that is left). */
export function burnRate(state: EconomyState, now: number): { perMinute: number; limit: number | null } {
  const perMinute = state.recent.reduce((sum, [at, usdValue]) => (now - at < BURN_WINDOW_MS ? sum + usdValue : sum), 0);
  const cap = runCapOf(state);
  return { perMinute, limit: cap === null ? null : BURN_LIMIT_SHARE * Math.max(cap - committed(state), 0) };
}
