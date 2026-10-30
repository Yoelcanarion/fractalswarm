// Where everything of the work lanes sits, in pixels, for a measured box. Pure: the same model and
// size always give the same layout, and every label is placed so that none overlaps another.

import type { Bar, LanesModel } from "./model";

/** Room for the lane names on the left, and a margin on the right. */
export const LABEL_W = 44;
export const RIGHT_PAD = 14;
/** What the bottom of the box holds: the stall labels, the axis, the ledger and the setting. */
export const BOTTOM = 126;
/** The brain's lane is taller than an agent's: it makes several calls at once. */
const BRAIN_WEIGHT = 1.7;
/** One character of the mono labels (12 px) in pixels. */
export const CHAR_W = 7.2;
/** The width of the box that tells the run's time at the cursor: the widest time (345.3 s) and a little air. */
export const READOUT_W = 62;

export interface LaneBox {
  index: number;
  y: number;
  h: number;
  /** The height of a bar in this lane, and the vertical step between the sub-rows of the brain. */
  barH: number;
  rowStep: number;
}

export interface Tick {
  x: number;
  label: string;
}

export interface StallLabel {
  stall: number;
  x: number;
  text: string;
}

export interface CrashMark {
  n: number;
  x: number;
  /** Whether there is room to print the crash's number next to its cross. */
  numbered: boolean;
}

export interface LedgerCell {
  x: number;
  y: number;
}

export interface LanesLayout {
  width: number;
  height: number;
  x0: number;
  x1: number;
  pxPerMs: number;
  /** The top and bottom of the lanes. */
  yTop: number;
  yBottom: number;
  lanes: LaneBox[];
  markY: number;
  axisY: number;
  tickY: number;
  ticks: Tick[];
  stallLabelY: number;
  stallLabels: StallLabel[];
  crashMarks: CrashMark[];
  ledger: LedgerCell[];
  captionY: number;
  caption: string;
  xAt(ms: number): number;
  /** Where a bar sits: its left, its top and its height. */
  barBox(bar: Bar): { x: number; y: number; h: number };
}

export const textWidth = (text: string): number => text.length * CHAR_W;

/** Keeps the labels that do not collide with a more important one: ``items`` come in order of importance. */
export function keepApart<T extends { x: number; w: number }>(items: T[], gap = 4): T[] {
  const kept: T[] = [];
  for (const item of items) {
    if (kept.every((k) => Math.abs(k.x - item.x) >= (k.w + item.w) / 2 + gap)) kept.push(item);
  }
  return kept;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function layoutFor(model: LanesModel, width: number, height: number, top: number, captions: string[] = []): LanesLayout {
  const x0 = LABEL_W + 8;
  const x1 = Math.max(x0 + 80, width - RIGHT_PAD);
  const pxPerMs = (x1 - x0) / Math.max(1, model.durationMs);
  const xAt = (ms: number): number => x0 + ms * pxPerMs;

  const markY = top + 8;
  const yTop = top + 20;
  const yBottom = Math.max(yTop + model.lanes.length * 12, height - BOTTOM);
  const weights = model.lanes.map((l) => (l.brain ? BRAIN_WEIGHT : 1));
  const unit = (yBottom - yTop) / weights.reduce((a, b) => a + b, 0);
  const barH = clamp(unit * 0.5, 6, 20);

  let y = yTop;
  const lanes: LaneBox[] = model.lanes.map((lane, i) => {
    const h = weights[i]! * unit;
    const box: LaneBox = {
      index: lane.index,
      y,
      h,
      barH: lane.brain ? clamp((h - 8) / lane.rows - 1, 3, barH) : barH,
      rowStep: 0,
    };
    box.rowStep = lane.brain && lane.rows > 1 ? box.barH + 1 : 0;
    y += h;
    return box;
  });

  const barBox = (bar: Bar): { x: number; y: number; h: number } => {
    const lane = lanes[bar.lane]!;
    const rows = model.lanes[bar.lane]!.rows;
    const block = lane.barH + (rows - 1) * lane.rowStep;
    return { x: xAt(bar.startMs), y: lane.y + (lane.h - block) / 2 + bar.row * lane.rowStep, h: lane.barH };
  };

  const axisY = yBottom + 26;
  const tickY = axisY + 15;
  const step = (width >= 520 ? 60 : 120) * 1000;
  const ticks: Tick[] = [];
  for (let t = 0; t <= model.durationMs; t += step) ticks.push({ x: xAt(t), label: t === 0 ? "0" : `${t / 1000} s` });

  const stallLabels = keepApart(
    model.stalls
      .filter((s) => s.endMs - s.startMs >= 1000)
      .map((s) => ({ s, text: `${((s.endMs - s.startMs) / 1000).toFixed(1)} s` }))
      .sort((a, b) => b.s.endMs - b.s.startMs - (a.s.endMs - a.s.startMs))
      .map(({ s, text }) => ({ stall: s.index, x: xAt((s.startMs + s.endMs) / 2), w: textWidth(text) + 4, text })),
  ).map(({ stall, x, text }) => ({ stall, x, text }));

  const crashMarks: CrashMark[] = model.crashes.map((c) => ({ n: c.n, x: xAt(c.atMs), numbered: false }));
  // A crash's number is printed beside its cross only where the one before it left room.
  let free = -Infinity;
  for (const mark of crashMarks) {
    if (mark.x - 5 >= free) {
      mark.numbered = true;
      free = mark.x + 5 + textWidth(String(mark.n)) + 6;
    }
  }

  // The ledger: counted, cut off, paid again, and the stalls' key. One row when the box is wide, two otherwise.
  const ledgerTop = tickY + 22;
  const columns = width >= 640 ? 4 : 2;
  const cell = (width - 16) / columns;
  const ledger: LedgerCell[] = Array.from({ length: 4 }, (_, i) => ({ x: 8 + (i % columns) * cell, y: ledgerTop + Math.floor(i / columns) * 22 }));
  const captionY = ledgerTop + (columns === 4 ? 1 : 2) * 22 + 10;

  const room = width - 16;
  const caption = captions.find((c) => textWidth(c) <= room) ?? captions[captions.length - 1] ?? "";

  return {
    width,
    height,
    x0,
    x1,
    pxPerMs,
    yTop,
    yBottom,
    lanes,
    markY,
    axisY,
    tickY,
    ticks,
    stallLabelY: yBottom + 18,
    stallLabels,
    crashMarks,
    ledger,
    captionY,
    caption,
    xAt,
    barBox,
  };
}
