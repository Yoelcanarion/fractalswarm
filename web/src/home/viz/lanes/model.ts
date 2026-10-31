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

/** The moments the film's captions hang on, as shares of the run: where the playhead, which crosses the run at one speed, reaches each. */
export interface Keyframes {
  /** The first crash. */
  crash: number;
  /** The start of the longest wait. */
  wait: number;
  /** The end of the last wait. */
  restart: number;
}

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
  const longest = stalls.reduce<Stall | null>((a, s) => (a && a.endMs - a.startMs >= s.endMs - s.startMs ? a : s), null);
  const shareOfRun = (ms: number): number => (data.durationMs > 0 ? ms / data.durationMs : 0);

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
    keyframes: {
      crash: shareOfRun(firstCrash),
      wait: shareOfRun(longest?.startMs ?? firstCrash),
      restart: shareOfRun(stalls[stalls.length - 1]?.endMs ?? firstCrash),
    },
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

export interface TimeMap {
  /** The moment of the run, in ms, shown at progress ``p``. */
  tAt(p: number): number;
  /** 0 until the last wait ends, then up to 1 at the end of the run: the cut and repeated calls stand out. */
  emphasisAt(p: number): number;
}

/**
 * The map from the visual's progress to a moment of the run: a straight line, so the playhead crosses the run at one speed. A pace of
 * its own (a crawl before the crash, a burst through the work, a stop to show the damage) stutters however well the frames hold, and
 * it is what rule 3 of the redesign forbids. The damage is shown while the run plays out, and the axis stays true all the way.
 */
export function timeMap(model: LanesModel): TimeMap {
  const kf = model.keyframes;
  const tAt = (p: number): number => clamp01(p) * model.durationMs;
  const emphasisAt = (p: number): number => smoothstep(span(p, kf.restart, 1));
  return { tAt, emphasisAt };
}

/** How much of the progress the fade-in of a caption takes (about a third of a second of the film's seven). */
export const MOMENT_FADE = 0.04;

/**
 * The progress at which each of the film's three captions begins to appear, read from the run: the first so that it is there as the
 * crash strikes, the second as the longest wait begins, the third as the last wait ends and the damage is shown. Each stays once it is
 * there, so the last picture of the film (and the still one) tells all three.
 */
export function momentStarts(kf: Keyframes): number[] {
  return [Math.max(0, kf.crash - MOMENT_FADE), kf.wait, kf.restart];
}

/** How visible caption ``index`` is at progress ``p``: 0 before its start, 1 once it has faded in. */
export function momentOpacity(kf: Keyframes, index: number, p: number): number {
  const start = momentStarts(kf)[index];
  return start === undefined ? 0 : smoothstep((p - start) / MOMENT_FADE);
}
