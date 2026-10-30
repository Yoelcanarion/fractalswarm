// The work lanes as pure data: one recorded run of the in-process supervisor, read from the
// ``lanes.central`` slice. Lanes, bars, crashes, kills and the periods nobody worked, plus the time
// map that turns the visual's progress into a moment of the run. Nothing here touches the DOM.

import type { LanesSlice } from "../../data/types";
import { clamp01, smoothstep, span } from "../shared";

export type BarKind = "counted" | "cut" | "again" | "other";
export type BarCause = "none" | "crash" | "kill" | "other";

export interface LaneInfo {
  index: number;
  id: string;
  /** What the lane is called on screen: "brain", "a1", "a13". */
  label: string;
  brain: boolean;
  /** Sub-rows the lane needs for calls that overlap in time (the brain makes several at once). */
  rows: number;
  /** When the lane's agent was killed for good, if it was. */
  killedAtMs: number | null;
  /** The spans in which the lane's process was alive. */
  life: { startMs: number; endMs: number }[];
}

export interface Bar {
  index: number;
  lane: number;
  row: number;
  startMs: number;
  endMs: number;
  kind: BarKind;
  cause: BarCause;
  costMicro: number;
}

export interface Crash {
  n: number;
  atMs: number;
  restartAtMs: number;
}

export interface Stall {
  index: number;
  startMs: number;
  endMs: number;
  /** The number of the crash that opens it, when one does: otherwise the agents waited for the coordinator. */
  crash: number | null;
}

export interface Keyframes {
  filled: number;
  crash: number;
  restart: number;
  redone: number;
  end: number;
}

export const DEFAULT_KEYFRAMES: Keyframes = { filled: 0.28, crash: 0.33, restart: 0.62, redone: 0.78, end: 1 };

export interface LanesModel {
  lanes: LaneInfo[];
  bars: Bar[];
  crashes: Crash[];
  stalls: Stall[];
  kills: { lane: number; atMs: number }[];
  durationMs: number;
  /** Money paid by kind of call, in micro-dollars, and in all. */
  micro: Record<BarKind, number> & { total: number };
  counts: Record<BarKind, number>;
  stallMs: number;
  keyframes: Keyframes;
  /** Calls of the first agent lane to work and the last to be given work before the first crash. */
  workStartMs: number;
  filledMs: number;
}

const CAUSES: BarCause[] = ["none", "crash", "kill", "other"];

const labelOf = (id: string, brain: boolean): string => (brain ? "brain" : (id.split(".").pop() ?? id));

/** Calls that overlap in one lane go to separate sub-rows (greedy interval partitioning, by start time). */
function packRows(bars: { startMs: number; endMs: number }[]): { row: number[]; rows: number } {
  const order = bars.map((_, i) => i).sort((a, b) => bars[a]!.startMs - bars[b]!.startMs || bars[a]!.endMs - bars[b]!.endMs);
  const ends: number[] = [];
  const row = new Array<number>(bars.length).fill(0);
  for (const i of order) {
    const bar = bars[i]!;
    let r = ends.findIndex((end) => end <= bar.startMs);
    if (r < 0) {
      r = ends.length;
      ends.push(bar.endMs);
    } else {
      ends[r] = bar.endMs;
    }
    row[i] = r;
  }
  return { row, rows: Math.max(1, ends.length) };
}

export function lanesModel(data: LanesSlice): LanesModel {
  const kindName = (code: number): BarKind => {
    const found = Object.entries(data.kinds).find(([, v]) => v === code)?.[0];
    return found === "cutOff" ? "cut" : found === "again" ? "again" : found === "other" ? "other" : "counted";
  };
  const causeName = (code: number): BarCause => {
    const found = Object.entries(data.causes).find(([, v]) => v === code)?.[0];
    return (CAUSES as string[]).includes(found ?? "") ? (found as BarCause) : "none";
  };

  // The brain first, then the agents in the order of the log.
  const order = [...data.lanes.keys()].sort((a, b) => Number(data.lanes[b]!.kind === "brain") - Number(data.lanes[a]!.kind === "brain") || a - b);
  const display = new Map(order.map((old, i) => [old, i]));

  const raw = data.bars.map((b, index) => ({
    index,
    lane: display.get(b[0]) ?? 0,
    startMs: b[1],
    endMs: Math.max(b[1], b[2]),
    kind: kindName(b[3]),
    cause: causeName(b[5]),
    costMicro: b[4],
    row: 0,
  }));

  const lanes: LaneInfo[] = order.map((old, index) => {
    const info = data.lanes[old]!;
    const mine = raw.filter((b) => b.lane === index);
    const packed = packRows(mine);
    mine.forEach((b, i) => {
      b.row = packed.row[i]!;
    });
    return {
      index,
      id: info.id,
      label: labelOf(info.id, info.kind === "brain"),
      brain: info.kind === "brain",
      rows: packed.rows,
      killedAtMs: null,
      life: data.life.filter((l) => l[0] === old).map((l) => ({ startMs: l[1], endMs: l[2] })),
    };
  });

  const lifeEnds = new Map(data.life.filter((l) => l[3] === "kill").map((l) => [display.get(l[0]) ?? -1, l[2]]));
  for (const lane of lanes) lane.killedAtMs = lifeEnds.get(lane.index) ?? null;
  const kills = lanes.flatMap((l) => (l.killedAtMs === null ? [] : [{ lane: l.index, atMs: l.killedAtMs }])).sort((a, b) => a.atMs - b.atMs || a.lane - b.lane);

  const restarts = new Map(data.marks.flatMap((m) => (m.kind === "restart" ? [[m.n, m.atMs] as const] : [])));
  const crashes: Crash[] = data.marks
    .flatMap((m) => (m.kind === "crash" ? [{ n: m.n, atMs: m.atMs, restartAtMs: restarts.get(m.n) ?? m.atMs + m.restartInMs }] : []))
    .sort((a, b) => a.atMs - b.atMs);

  const stalls: Stall[] = data.stall.spansMs.map(([startMs, endMs], index) => ({
    index,
    startMs,
    endMs,
    crash: crashes.find((c) => Math.abs(c.atMs - startMs) <= 1)?.n ?? null,
  }));

  const micro = { counted: 0, cut: 0, again: 0, other: 0, total: 0 };
  const counts = { counted: 0, cut: 0, again: 0, other: 0 };
  for (const b of raw) {
    micro[b.kind] += b.costMicro;
    micro.total += b.costMicro;
    counts[b.kind] += 1;
  }

  const firstCrash = crashes[0]?.atMs ?? stalls[0]?.startMs ?? data.durationMs;
  const agentStarts = raw.filter((b) => !lanes[b.lane]!.brain).map((b) => b.startMs);
  const beforeCrash = agentStarts.filter((t) => t <= firstCrash - 250);
  const workStartMs = data.stall.windowMs[0] > 0 ? data.stall.windowMs[0] : Math.min(...agentStarts, firstCrash);
  const filledMs = beforeCrash.length ? Math.max(...beforeCrash) : Math.max(workStartMs, firstCrash - 1000);

  return {
    lanes,
    bars: raw,
    crashes,
    stalls,
    kills,
    durationMs: data.durationMs,
    micro,
    counts,
    stallMs: stalls.reduce((sum, s) => sum + (s.endMs - s.startMs), 0),
    keyframes: { ...DEFAULT_KEYFRAMES, ...(data.keyframes ?? {}) },
    workStartMs: Math.min(workStartMs, filledMs),
    filledMs,
  };
}

/** The spans in which an agent's process was alive, one line each, in the order the lanes draw them. The brain's lane has none. */
export function lifeTracks(model: LanesModel): { lane: number; startMs: number; endMs: number }[] {
  return model.lanes.filter((l) => !l.brain).flatMap((l) => l.life.map((s) => ({ lane: l.index, startMs: s.startMs, endMs: s.endMs })));
}

// -- what each part shows at a moment of the run -------------------------------------------

/** How much of a call has been drawn at ``tMs``: nothing before it starts, all of it once it ends. */
export const drawnMs = (bar: { startMs: number; endMs: number }, tMs: number): number => Math.max(0, Math.min(tMs, bar.endMs) - bar.startMs);

export type BarState = "hidden" | "run" | "done";
export function barState(bar: { startMs: number; endMs: number }, tMs: number): BarState {
  if (tMs < bar.startMs) return "hidden";
  return tMs >= bar.endMs ? "done" : "run";
}

/** The money paid so far by kind of call: a call in flight has been paid for in proportion to its time. */
export function spentMicro(model: LanesModel, tMs: number): Record<BarKind, number> & { total: number } {
  const out = { counted: 0, cut: 0, again: 0, other: 0, total: 0 };
  for (const b of model.bars) {
    if (tMs <= b.startMs) continue;
    const length = b.endMs - b.startMs;
    const share = length <= 0 ? 1 : Math.min(1, (tMs - b.startMs) / length);
    out[b.kind] += b.costMicro * share;
    out.total += b.costMicro * share;
  }
  return out;
}

/** The time nobody worked that has gone by at ``tMs``. */
export function stallElapsedMs(model: LanesModel, tMs: number): number {
  return model.stalls.reduce((sum, s) => sum + Math.max(0, Math.min(tMs, s.endMs) - s.startMs), 0);
}

// -- the time map ------------------------------------------------------------------------------

/** The share of the stretch from the crash to the restart that goes to the time nobody worked. */
export const STALL_SHARE = 0.95;

export interface Knot {
  p: number;
  t: number;
}

/**
 * The map from the visual's progress to a moment of the run, as a polyline of knots. Before the first
 * crash it runs at an even pace, slows to a crawl as the team starts, and sits just before the crash.
 * From the crash to the restart it gives every second nobody worked the same stretch of progress (so
 * the stall counted so far is a straight line of the progress, which is how the page counts the seconds
 * waited) and hurries through the work in between. From the restart to the redone mark the run stands
 * still while the damage is shown; then it plays out to the end.
 */
export function buildKnots(model: LanesModel): Knot[] {
  const kf = model.keyframes;
  const first = model.crashes[0]?.atMs ?? model.stalls[0]?.startMs ?? model.filledMs;
  const lastStall = model.stalls[model.stalls.length - 1];
  const settled = lastStall ? lastStall.endMs : first;
  const knots: Knot[] = [
    { p: 0, t: 0 },
    { p: kf.filled * 0.36, t: Math.min(model.workStartMs, model.filledMs) },
    { p: kf.filled, t: model.filledMs },
    { p: kf.crash, t: first },
  ];

  // From the first crash to the end of the last stall: stalls by their length, work by the root of its length.
  const inside = model.stalls.filter((s) => s.endMs > first);
  const stallTotal = inside.reduce((sum, s) => sum + (s.endMs - Math.max(s.startMs, first)), 0);
  const pieces: { startMs: number; endMs: number; stall: boolean }[] = [];
  let cursor = first;
  for (const s of inside) {
    const a = Math.max(s.startMs, first);
    if (a > cursor) pieces.push({ startMs: cursor, endMs: a, stall: false });
    pieces.push({ startMs: a, endMs: s.endMs, stall: true });
    cursor = s.endMs;
  }
  const workRoots = pieces.filter((x) => !x.stall).reduce((sum, x) => sum + Math.sqrt(x.endMs - x.startMs), 0);
  const stallShare = workRoots === 0 ? 1 : stallTotal === 0 ? 0 : STALL_SHARE;
  const range = kf.restart - kf.crash;
  let p = kf.crash;
  for (const x of pieces) {
    const length = x.endMs - x.startMs;
    const share = x.stall ? (stallShare * length) / stallTotal : ((1 - stallShare) * Math.sqrt(length)) / workRoots;
    p += range * share;
    knots.push({ p, t: x.endMs });
  }
  if (!pieces.length) knots.push({ p: kf.restart, t: settled });
  knots[knots.length - 1] = { p: kf.restart, t: settled };

  knots.push({ p: kf.redone, t: settled }, { p: kf.end, t: model.durationMs });
  return knots.filter((k, i, all) => i === 0 || k.p > all[i - 1]!.p || k.t > all[i - 1]!.t);
}

export interface TimeMap {
  knots: Knot[];
  /** The moment of the run, in ms, shown at progress ``p``. */
  tAt(p: number): number;
  /** 0 until the restart, then up to 1 while the damage is shown: the cut and repeated calls stand out. */
  emphasisAt(p: number): number;
}

export function timeMap(model: LanesModel): TimeMap {
  const knots = buildKnots(model);
  const kf = model.keyframes;
  const tAt = (p: number): number => {
    const x = clamp01(p);
    if (x <= knots[0]!.p) return knots[0]!.t;
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1]!;
      const b = knots[i]!;
      if (x <= b.p) return b.p === a.p ? b.t : a.t + ((b.t - a.t) * (x - a.p)) / (b.p - a.p);
    }
    return knots[knots.length - 1]!.t;
  };
  const emphasisAt = (p: number): number => smoothstep(span(p, kf.restart, kf.restart + 0.7 * (kf.redone - kf.restart)));
  return { knots, tAt, emphasisAt };
}

/** The seconds nobody worked counted from the crash to the restart as the page counts them: a straight line of the progress. */
export function linearStallMs(model: LanesModel, p: number): number {
  const kf = model.keyframes;
  return model.stallMs * span(p, kf.crash, kf.restart);
}
