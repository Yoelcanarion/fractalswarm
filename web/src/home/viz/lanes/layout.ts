// Where everything of the work lanes sits, in pixels, for a measured box. Pure: the same model and
// size always give the same layout, and every label is placed so that none overlaps another.

import type { Bar, LanesModel } from "./model";

/** Room for the lane names on the left, and a margin on the right. */
export const LABEL_W = 44;
export const RIGHT_PAD = 14;
/** What the bottom of the box holds: the stall labels, the axis, the ledger and the setting. */
export const BOTTOM = 126;
/** The same in the film's plain form, which has a key of two and no setting. */
export const BOTTOM_PLAIN = 80;
/** The brain's lane is taller than an agent's: it makes several calls at once. */
const BRAIN_WEIGHT = 1.7;
/** One character of the mono labels (12 px) in pixels. */
export const CHAR_W = 7.2;
/**
 * What each cell of the key needs, in pixels: its swatch, its words and the widest value it gets (counted $0.000, cut off $0.000,
 * paid again $0.000, no agent working 000.0 s), and the air between two columns.
 */
const LEDGER_NEED = [16 + 7 * CHAR_W + 8 + 6 * CHAR_W, 16 + 7 * CHAR_W + 8 + 6 * CHAR_W, 16 + 10 * CHAR_W + 8 + 6 * CHAR_W, 16 + 16 * CHAR_W + 8 + 7 * CHAR_W];
/** The film's key: cut off and paid again. */
const LEDGER_PLAIN_NEED = [LEDGER_NEED[1]!, LEDGER_NEED[2]!];
const LEDGER_GAP = 12;
/** The air between the two cells of the film's key, which stand together at the left instead of sharing the width. */
const LEDGER_PACK = 40;
/** One character of the film's captions (the page's display face, 600) in em: a little over the widest caption's (0.47), so none runs out of its box. */
export const MOMENT_EM = 0.5;
/** The air between two captions that stand in a row. */
export const MOMENT_GAP = 48;
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

/** The film's captions: where each is written, in a row when the box is wide and one under the other when it is not. */
export interface MomentsLayout {
  /** The font size and, in a column, the step between two lines. */
  size: number;
  lead: number;
  row: boolean;
  /** The left and the baseline of each caption. */
  at: { x: number; y: number }[];
  /** The height of the band the captions take above the lanes. */
  height: number;
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
  moments: MomentsLayout | null;
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

/** The width each column of a key needs when its cells are laid out `columns` to a row. */
export const ledgerNeed = (columns: number, cells: readonly number[] = LEDGER_NEED): number[] =>
  Array.from({ length: columns }, (_, k) => Math.max(...cells.filter((_, i) => i % columns === k)));

/**
 * Where the columns of the key start in a box `width` wide: as many columns as fit (four, two or one). Each starts where an even
 * share of the box would put it, pulled back as far as it takes for the columns after it to fit, so no cell is clipped or overlaps
 * its neighbour, whatever the width.
 */
export function ledgerColumns(width: number, cells: readonly number[] = LEDGER_NEED, packed = false): number[] {
  for (const count of [4, 2, 1].filter((c) => c <= cells.length)) {
    const need = ledgerNeed(count, cells);
    const total = need.reduce((a, b) => a + b, 0) + (count - 1) * (packed ? LEDGER_PACK : LEDGER_GAP);
    if (count > 1 && total > width - 16) continue;
    if (packed) {
      let x = 8;
      return need.map((n) => {
        const here = x;
        x += n + LEDGER_PACK;
        return here;
      });
    }
    const cell = (width - 16) / count;
    const xs: number[] = [];
    let end = 0;
    for (let k = 0; k < count; k++) {
      const latest = width - 8 - need.slice(k).reduce((a, b) => a + b, 0) - (count - 1 - k) * LEDGER_GAP;
      const x = Math.max(8, Math.min(Math.max(k === 0 ? 8 : end + LEDGER_GAP, 8 + k * cell), latest));
      xs.push(x);
      end = x + need[k]!;
    }
    return xs;
  }
  return [8];
}

/**
 * Where the film's captions are written. In a row, left to right, at the largest of 32, 28 and 24 px at which the three fit the box;
 * when none does (a phone, a narrow column), one under the other at the size at which the longest fits, up to 22 px.
 */
export function momentsLayout(texts: readonly string[], width: number, x0: number): MomentsLayout {
  const room = width - x0 - 8;
  const chars = texts.reduce((n, t) => n + t.length, 0);
  for (const size of [32, 28, 24]) {
    if (chars * MOMENT_EM * size + (texts.length - 1) * MOMENT_GAP > room) continue;
    let x = x0;
    const at = texts.map((t) => {
      const here = { x, y: size + 6 };
      x += t.length * MOMENT_EM * size + MOMENT_GAP;
      return here;
    });
    return { size, lead: 0, row: true, at, height: size + 24 };
  }
  const longest = Math.max(1, ...texts.map((t) => t.length));
  const size = clamp(Math.floor(room / (longest * MOMENT_EM)), 12, 22);
  const lead = Math.round(size * 1.25);
  return { size, lead, row: false, at: texts.map((_, i) => ({ x: x0, y: size + 4 + i * lead })), height: texts.length * lead + 14 };
}

export interface LayoutOptions {
  /** The film's plain form: these captions above the lanes, no lane names, a key of two and no setting. */
  moments?: readonly string[] | undefined;
}

export function layoutFor(model: LanesModel, width: number, height: number, top: number, captions: string[] = [], options: LayoutOptions = {}): LanesLayout {
  const plain = (options.moments?.length ?? 0) > 0;
  const x0 = (plain ? 0 : LABEL_W) + 8;
  const x1 = Math.max(x0 + 80, width - RIGHT_PAD);
  const pxPerMs = (x1 - x0) / Math.max(1, model.durationMs);
  const xAt = (ms: number): number => x0 + ms * pxPerMs;

  const cells = plain ? LEDGER_PLAIN_NEED : LEDGER_NEED;
  const columns = ledgerColumns(width, cells, plain);
  const ledgerRows = Math.ceil(cells.length / columns.length);
  // The film has no counter over its top left: the captions take that band, and the lanes start under it.
  const moments = plain ? momentsLayout(options.moments!, width, x0) : null;
  const base = moments ? moments.height : top;
  const markY = base + 8;
  const yTop = base + 20;
  const reserve = plain ? BOTTOM_PLAIN + (ledgerRows - 1) * 22 : BOTTOM + Math.max(0, ledgerRows - 2) * 22;
  const yBottom = Math.max(yTop + model.lanes.length * 12, height - reserve);
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

  // The ledger: counted, cut off, paid again, and the stalls' key. One row when the box is wide, two or four rows as it narrows.
  const ledgerTop = tickY + 22;
  const ledger: LedgerCell[] = Array.from({ length: cells.length }, (_, i) => ({ x: columns[i % columns.length]!, y: ledgerTop + Math.floor(i / columns.length) * 22 }));
  const captionY = ledgerTop + ledgerRows * 22 + 10;

  const room = width - 16;
  const caption = plain ? "" : (captions.find((c) => textWidth(c) <= room) ?? captions[captions.length - 1] ?? "");

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
    moments,
    xAt,
    barBox,
  };
}
