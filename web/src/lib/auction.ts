// The epoch auction (spec §7.2) and autoscale (§7.3) as a fold over the events the market makers
// log (market/events.py). Each parent is the market maker of its goal, so every event names its
// ``goal_id``. Money in these events is in micro-dollars.
//
//   market.epoch_closed  {goal_id, owner, epoch, reason, at_ms, completions, member_epoch}
//                        reason: start | timer | completions | membership | ownership | shock
//   market.bids          {goal_id, epoch, bids: [{child, resources: {name: {q, floor}}, value, density}]}
//   market.cleared       {goal_id, epoch, mode, resources: {name: {envelope, reserve, pool, grants: {child: n}}},
//                         caps: {child: cap}, base: {child: committed}}
//                        conservation: sum(grants) + pool + reserve == envelope
//   market.refund        {goal_id, epoch, refunds: {child: micros}, total_micros}
//   market.topup         {goal_id, epoch, child, requested_micros, granted_micros, reserve_left_micros, cap_micros}
//   scaling.decided      {owner, kind: orchestrators | agents | recursion, before, after, target, reason, detail}
//
// ``market.quota`` (the AIMD quotas) is read by limits.ts. Other market.* types are shown as
// generic rows by economy.ts.

import { appendCapped, asNumber, asRecord, asString } from "./generic";
import type { RunEvent } from "./types";

const MICROS = 1_000_000;
const EPOCHS_KEPT = 40;
const ROWS_KEPT = 30;

export const AUCTION_TYPES: ReadonlySet<string> = new Set([
  "market.epoch_closed",
  "market.bids",
  "market.cleared",
  "market.refund",
  "market.topup",
  "market.quota",
  "scaling.decided",
]);

export interface EpochRow {
  seq: number;
  ts: number;
  goalId: string;
  owner: string;
  epoch: number;
  reason: string;
  completions: number;
}

export interface Grant {
  child: string;
  usd: number;
}

/** One clearing of one goal's market, for the money resource. */
export interface Clearing {
  seq: number;
  ts: number;
  goalId: string;
  epoch: number;
  mode: string;
  resource: string | null; // the money resource's name; null when the event carries none
  envelopeUsd: number;
  reserveUsd: number;
  poolUsd: number;
  grants: Grant[]; // largest first
  resources: number; // how many resources were cleared (money, and rpm/tpm slices)
}

export interface TopUp {
  seq: number;
  ts: number;
  goalId: string;
  child: string;
  requestedUsd: number;
  grantedUsd: number;
  reserveLeftUsd: number;
}

export interface ScalingDecision {
  seq: number;
  ts: number;
  owner: string;
  kind: string;
  before: string;
  after: string;
  reason: string;
}

export interface AuctionState {
  epochs: EpochRow[];
  epochCount: number;
  bidSets: number;
  clearings: Record<string, Clearing>; // the latest per goal
  clearingOrder: string[];
  refundedUsd: number;
  topups: TopUp[];
  requestedUsd: number;
  grantedUsd: number;
  scaling: ScalingDecision[];
}

export const emptyAuction = (): AuctionState => ({
  epochs: [],
  epochCount: 0,
  bidSets: 0,
  clearings: {},
  clearingOrder: [],
  refundedUsd: 0,
  topups: [],
  requestedUsd: 0,
  grantedUsd: 0,
  scaling: [],
});

const usd = (micros: unknown): number => (asNumber(micros) ?? 0) / MICROS;

/** The resource that is money: ``usd`` if present, else the first one that is not a rate slice. */
function moneyOf(resources: Record<string, unknown>): string | null {
  if ("usd" in resources) return "usd";
  return Object.keys(resources).find((name) => !/^(rpm|tpm)\b/.test(name)) ?? null;
}

function clearing(event: RunEvent): Clearing {
  const p = event.payload;
  const resources = asRecord(p.resources);
  const name = moneyOf(resources);
  const money = name === null ? {} : asRecord(resources[name]);
  const grants = Object.entries(asRecord(money.grants))
    .map(([child, micros]) => ({ child, usd: usd(micros) }))
    .sort((a, b) => b.usd - a.usd || a.child.localeCompare(b.child));
  return {
    seq: event.seq,
    ts: event.ts_virtual,
    goalId: asString(p.goal_id),
    epoch: asNumber(p.epoch) ?? 0,
    mode: asString(p.mode),
    resource: name,
    envelopeUsd: usd(money.envelope),
    reserveUsd: usd(money.reserve),
    poolUsd: usd(money.pool),
    grants,
    resources: Object.keys(resources).length,
  };
}

export function foldAuction(state: AuctionState, event: RunEvent): AuctionState {
  const p = event.payload;
  switch (event.type) {
    case "market.epoch_closed": {
      const row: EpochRow = {
        seq: event.seq,
        ts: event.ts_virtual,
        goalId: asString(p.goal_id),
        owner: asString(p.owner, event.actor),
        epoch: asNumber(p.epoch) ?? 0,
        reason: asString(p.reason),
        completions: asNumber(p.completions) ?? 0,
      };
      return { ...state, epochs: appendCapped(state.epochs, row, EPOCHS_KEPT), epochCount: state.epochCount + 1 };
    }
    case "market.bids":
      return { ...state, bidSets: state.bidSets + 1 };
    case "market.cleared": {
      const cleared = clearing(event);
      return {
        ...state,
        clearings: { ...state.clearings, [cleared.goalId]: cleared },
        clearingOrder: state.clearings[cleared.goalId] ? state.clearingOrder : [...state.clearingOrder, cleared.goalId],
      };
    }
    case "market.refund":
      return { ...state, refundedUsd: state.refundedUsd + usd(p.total_micros) };
    case "market.topup": {
      const row: TopUp = {
        seq: event.seq,
        ts: event.ts_virtual,
        goalId: asString(p.goal_id),
        child: asString(p.child),
        requestedUsd: usd(p.requested_micros),
        grantedUsd: usd(p.granted_micros),
        reserveLeftUsd: usd(p.reserve_left_micros),
      };
      return {
        ...state,
        topups: appendCapped(state.topups, row, ROWS_KEPT),
        requestedUsd: state.requestedUsd + row.requestedUsd,
        grantedUsd: state.grantedUsd + row.grantedUsd,
      };
    }
    case "scaling.decided": {
      const row: ScalingDecision = {
        seq: event.seq,
        ts: event.ts_virtual,
        owner: asString(p.owner, event.actor),
        kind: asString(p.kind),
        before: asString(p.before),
        after: asString(p.after),
        reason: asString(p.reason),
      };
      return { ...state, scaling: appendCapped(state.scaling, row, ROWS_KEPT) };
    }
    default:
      return state;
  }
}

/** Does the clearing add up? ``sum(grants) + pool + reserve == envelope`` (spec §7.2), to a micro-dollar. */
export const conserved = (c: Clearing): boolean =>
  Math.abs(c.grants.reduce((sum, g) => sum + g.usd, 0) + c.poolUsd + c.reserveUsd - c.envelopeUsd) < 1.5 / MICROS;

/** The clearing to show: the root's market, else the latest one. */
export function headline(state: AuctionState): Clearing | null {
  if (state.clearingOrder.length === 0) return null;
  const goal = state.clearings.root ? "root" : state.clearingOrder.reduce((a, b) => (state.clearings[a].seq > state.clearings[b].seq ? a : b));
  return state.clearings[goal];
}
