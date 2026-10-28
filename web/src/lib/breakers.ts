// Breakers (spec §8): circuit breakers as a fold over the breaker.* events.
//
//   breaker.opened     {breaker, until_ms, trips, reason}      closed -> open (until_ms is virtual time)
//   breaker.half_open  {breaker}                               open -> half-open: one probe goes through
//   breaker.closed     {breaker}                               the probe succeeded
//
// Today only the model endpoint breaker emits them (``breaker: "model:<name>"``). The channel,
// topic and global-spend breakers of spec §8 will use the same family, so any ``breaker.*`` type
// is read by its last segment (``breaker.channel.opened`` opens a breaker too), and a segment
// this fold does not know is kept as a plain transition.

import { appendCapped, asNumber, asString, GENERIC_CAP, genericEntry, type GenericEntry } from "./generic";
import type { RunEvent } from "./types";

export type BreakerState = "closed" | "open" | "half_open";
export type BreakerKind = "model" | "channel" | "topic" | "global" | "other";

export interface Transition {
  seq: number;
  ts: number;
  event: string; // opened | half_open | closed | the suffix of an unknown breaker.* type
  reason: string;
}

export interface BreakerRow {
  name: string;
  kind: BreakerKind;
  state: BreakerState;
  trips: number;
  openedTs: number | null;
  untilMs: number | null;
  reason: string;
  lastSeq: number;
  history: Transition[];
}

export interface BreakersState {
  rows: Record<string, BreakerRow>;
  order: string[];
  transitions: number;
  other: GenericEntry[];
}

export const emptyBreakers = (): BreakersState => ({ rows: {}, order: [], transitions: 0, other: [] });

const HISTORY_KEPT = 20;
// The last segment of the type, or its last word: ``opened``, ``channel_opened``, ``topic_half_open``.
const OPENED = /(^|[_-])(opened|open|tripped)$/;
const HALF_OPEN = /(^|[_-])half[_-]?open(ed)?$/;
const CLOSED = /(^|[_-])(closed|close|recovered|reset)$/;

export function breakerKind(name: string): BreakerKind {
  const lower = name.toLowerCase();
  if (lower.startsWith("model")) return "model";
  if (lower.startsWith("channel") || lower.startsWith("chan")) return "channel";
  if (lower.startsWith("topic")) return "topic";
  if (lower.includes("spend") || lower.startsWith("global")) return "global";
  return "other";
}

export function foldBreakers(state: BreakersState, event: RunEvent): BreakersState {
  if (!event.type.startsWith("breaker.")) return state;
  const p = event.payload;
  const suffix = event.type.split(".").at(-1)!; // breaker.opened and breaker.channel.opened alike
  const name = asString(p.breaker ?? p.name ?? p.channel ?? p.topic ?? p.key, "breaker");
  const previous = state.rows[name];
  const row: BreakerRow = previous ?? {
    name,
    kind: breakerKind(name),
    state: "closed",
    trips: 0,
    openedTs: null,
    untilMs: null,
    reason: "",
    lastSeq: event.seq,
    history: [],
  };
  let next: BreakerRow = { ...row, lastSeq: event.seq };
  const reason = asString(p.reason);
  // Half-open first: ``half_open`` also ends in ``_open``.
  const known = HALF_OPEN.test(suffix) || OPENED.test(suffix) || CLOSED.test(suffix);
  if (HALF_OPEN.test(suffix)) {
    next = { ...next, state: "half_open", untilMs: null };
  } else if (OPENED.test(suffix)) {
    next = {
      ...next,
      state: "open",
      trips: asNumber(p.trips) ?? row.trips + 1,
      openedTs: event.ts_virtual,
      untilMs: asNumber(p.until_ms),
      reason,
    };
  } else if (CLOSED.test(suffix)) {
    next = { ...next, state: "closed", openedTs: null, untilMs: null };
  }
  next.history = appendCapped(row.history, { seq: event.seq, ts: event.ts_virtual, event: suffix, reason }, HISTORY_KEPT);
  return {
    rows: { ...state.rows, [name]: next },
    order: previous ? state.order : [...state.order, name],
    transitions: state.transitions + 1,
    other: known ? state.other : appendCapped(state.other, genericEntry(event), GENERIC_CAP),
  };
}

/** Seconds of virtual time until an open breaker lets a probe through, or null. */
export const secondsUntilProbe = (row: BreakerRow, now: number): number | null =>
  row.state === "open" && row.untilMs !== null ? Math.max((row.untilMs - now) / 1000, 0) : null;
