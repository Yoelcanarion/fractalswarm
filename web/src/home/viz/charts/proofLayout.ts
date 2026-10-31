// Where everything of the Proof chart goes, in pixels, for the width the page gives it, and what each part looks like at a moment of
// its growth. No DOM in it: the drawing renders `layoutProof`, and the frame loop paints `paintProof` from the same numbers.
// Every line has one eased share of its own (`shareAt`), so a bar, its number and a line of dots keep time with each other.

import { playhead, SECONDS } from "../ease";
import { fx } from "../shared";
import { Pen } from "../tree/paint";
import { barShare, proofText, type BarRow, type ProofPanel, type SeedRow, type SeedValue, type Unit } from "./proof";

export const MIN_W = 260;
/** The widest the chart is drawn: two columns of panels. */
export const MAX_W = 1480;
/** The widest a single column of panels is drawn, which is what reads well from a phone's width up to `PAIR_FROM`. */
export const COLUMN_W = 840;
/** What the chart is drawn at before the page has measured it: the server's render and the first one. */
export const DEFAULT_W = 720;
/** From this width the panels stand side by side, in two equal columns with `PAIR_GAP` between them. */
export const PAIR_FROM = 1000;
export const PAIR_GAP = 48;

/** Below this width a workflow's name sits above its line instead of beside it. */
const INLINE_FROM = 560;
/** Below this width a row's long label does not fit on its line. */
const LONG_LABEL_FROM = 340;
const NAME_W = 172;
const VALUE_W = 64;
const BAR_H = 10;
export const DOT_R = 5.5;
/** A line of dots starts this far to the left of where it ends. */
export const DOT_SLIDE = 14;
const HEAD_H = 28;
const HEAD_H_NARROW = 46;
const LABEL_H = 24;
const LINE_H = 28;
const STACK_H = 42;
const ROW_GAP = 12;
const PANEL_GAP = 30;
const CHIP_H = 20;
/** The line under two columns that share their setting, with the air above it. */
const SHARED_H = 30;

/** Lines start this many seconds apart and all end together after `TOTAL`, so no two land at once and none waits for the others. */
export const STEP = 0.05;
export const TOTAL = SECONDS.grow;

export type Who = "swarm" | "rival";

export interface Spot {
  x: number;
  y: number;
}

export interface BarGeo {
  /** The bar's top left, and its length when it is whole. */
  x: number;
  y: number;
  length: number;
  height: number;
  /** The number at its end, and where it is written (its right edge, middle of the line). */
  end: number;
  unit: Unit;
  value: Spot;
  order: number;
}

export interface DotGeo {
  seed: string;
  text: string;
  cx: number;
  cy: number;
}

export interface LineGeo {
  who: Who;
  name: string;
  nameAt: Spot;
  track: { x: number; y: number; w: number; h: number };
  bar: BarGeo | null;
  dots: DotGeo[];
  order: number;
}

export interface ChipGeo {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface RowGeo {
  id: string;
  label: string;
  labelAt: Spot;
  chip: ChipGeo | null;
  /** Where the zero of a signed axis is, from the top of its first line to the bottom of its last. */
  zero: { x: number; y1: number; y2: number } | null;
  lines: LineGeo[];
}

export interface PanelGeo {
  id: ProofPanel["id"];
  kind: ProofPanel["kind"];
  /** Where the panel's own x = 0 is, and how wide it is: everything in it is placed from there. */
  x: number;
  w: number;
  rival: string;
  rivalAt: Spot;
  /** The panel's setting; empty where both panels share one that is written once under them. */
  setting: string;
  settingAt: Spot;
  /** The setting ends at the right edge when it shares the line with the rival's name; under the name it starts at the left. */
  settingEnd: boolean;
  rows: RowGeo[];
}

export interface ProofGeo {
  width: number;
  height: number;
  /** Whether a workflow's name sits beside its line, which depends on the width of a panel and not of the chart. */
  inline: boolean;
  columns: 1 | 2;
  /** The setting that both panels share, small under them; null where each panel writes its own. */
  setting: { text: string; at: Spot } | null;
  panels: PanelGeo[];
}

export const clampWidth = (width: number): number => {
  const w = Number.isFinite(width) ? width : DEFAULT_W;
  return Math.round(w >= PAIR_FROM ? Math.min(MAX_W, w) : Math.min(COLUMN_W, Math.max(MIN_W, w)));
};

/** The width of a chip that says `text`, in the chart's 12 px type. */
const chipWidth = (text: string): number => 20 + text.length * 7;

interface Cursor {
  y: number;
  order: number;
}

interface Env {
  w: number;
  inline: boolean;
  nameW: number;
  lineH: number;
  swarm: string;
}

/** The middle of the line that starts at `top`: beside its name, or under it when the name is stacked above. */
const middle = (env: Env, top: number): number => top + (env.inline ? env.lineH / 2 : env.lineH - 14);

const nameAt = (env: Env, cy: number): Spot => ({ x: 0, y: env.inline ? cy : cy - 19 });

function barRowGeo(row: BarRow, rival: string, c: Cursor, env: Env): RowGeo {
  const labelAt = { x: 0, y: c.y + LABEL_H / 2 };
  c.y += LABEL_H;
  const drawn = row.swarm >= 0 && row.rival >= 0;
  const trackW = Math.max(40, env.w - env.nameW - VALUE_W - 10);
  const lines = (["swarm", "rival"] as const).map((who): LineGeo => {
    const cy = middle(env, c.y);
    const value = who === "swarm" ? row.swarm : row.rival;
    const other = who === "swarm" ? row.rival : row.swarm;
    const track = { x: env.nameW, y: cy - BAR_H / 2, w: trackW, h: BAR_H };
    const line: LineGeo = {
      who,
      name: who === "swarm" ? env.swarm : rival,
      nameAt: nameAt(env, cy),
      track,
      bar: { x: track.x, y: track.y, length: drawn ? barShare(value, other) * trackW : 0, height: BAR_H, end: value, unit: row.unit, value: { x: env.w, y: cy }, order: c.order },
      dots: [],
      order: c.order,
    };
    c.order += 1;
    c.y += env.lineH;
    return line;
  });
  c.y += ROW_GAP;
  return { id: row.id, label: env.w < LONG_LABEL_FROM && row.short ? row.short : row.label, labelAt, chip: null, zero: null, lines };
}

function seedRowGeo(row: SeedRow, rival: string, c: Cursor, env: Env): RowGeo {
  const labelAt = { x: 0, y: c.y + LABEL_H / 2 };
  const chip = row.verdict ? { text: row.verdict, w: chipWidth(row.verdict), h: CHIP_H, x: env.w - chipWidth(row.verdict), y: labelAt.y - CHIP_H / 2 } : null;
  c.y += LABEL_H;
  const sets: Record<Who, SeedValue[]> = { swarm: row.swarm, rival: row.rival };
  const all = [...sets.swarm, ...sets.rival].map((s) => s.value);
  let lines: LineGeo[] = [];
  let zero: RowGeo["zero"] = null;
  if (all.length > 0) {
    const trackW = env.w - env.nameW;
    const lo = Math.min(0, ...all);
    const top = Math.max(...all);
    const hi = top > lo ? top : lo + 1;
    const at = (v: number): number => env.nameW + DOT_R + ((v - lo) / (hi - lo)) * (trackW - 2 * DOT_R);
    const from = c.y;
    lines = (["swarm", "rival"] as const).map((who): LineGeo => {
      const cy = middle(env, c.y);
      const line: LineGeo = {
        who,
        name: who === "swarm" ? env.swarm : rival,
        nameAt: nameAt(env, cy),
        track: { x: env.nameW, y: cy - BAR_H / 2, w: trackW, h: BAR_H },
        bar: null,
        dots: sets[who].map((s) => ({ seed: s.seed, text: proofText(s.value, row.unit), cx: at(s.value), cy })),
        order: c.order,
      };
      c.order += 1;
      c.y += env.lineH;
      return line;
    });
    if (lo < 0) zero = { x: at(0), y1: from, y2: c.y };
  }
  c.y += ROW_GAP;
  return { id: row.id, label: row.label, labelAt, chip, zero, lines };
}

export function layoutProof(panels: ProofPanel[], width: number, swarm: string): ProofGeo {
  const w = clampWidth(width);
  const pair = w >= PAIR_FROM && panels.length === 2;
  const columnW = pair ? (w - PAIR_GAP) / 2 : w;
  const inline = columnW >= INLINE_FROM;
  // two panels that took their numbers from one setting say it once, so that nothing is told twice side by side
  const first = panels[0]?.setting ?? "";
  const shared = pair && first !== "" && panels.every((p) => p.setting === first) ? first : null;
  const env: Env = { w: columnW, inline, nameW: inline ? NAME_W : 0, lineH: inline ? LINE_H : STACK_H, swarm };
  const c: Cursor = { y: 0, order: 0 };
  let bottom = 0;
  const out: PanelGeo[] = [];
  panels.forEach((panel, index) => {
    if (pair) c.y = 0;
    else if (index > 0) c.y += PANEL_GAP;
    const rivalAt = { x: 0, y: c.y + 12 };
    const settingAt = inline ? { x: columnW, y: c.y + 12 } : { x: 0, y: c.y + 32 };
    c.y += inline || shared !== null ? HEAD_H : HEAD_H_NARROW;
    const rows = panel.kind === "bars" ? panel.rows.map((row) => barRowGeo(row, panel.rival, c, env)) : panel.rows.map((row) => seedRowGeo(row, panel.rival, c, env));
    bottom = Math.max(bottom, c.y);
    out.push({
      id: panel.id,
      kind: panel.kind,
      x: pair ? index * (columnW + PAIR_GAP) : 0,
      w: columnW,
      rival: panel.rival,
      rivalAt,
      setting: shared === null ? panel.setting : "",
      settingAt,
      settingEnd: inline,
      rows,
    });
  });
  const body = Math.max(0, bottom - ROW_GAP + 4);
  return {
    width: w,
    height: shared === null ? body : body + SHARED_H,
    inline,
    columns: pair ? 2 : 1,
    setting: shared === null ? null : { text: shared, at: { x: 0, y: body + SHARED_H / 2 + 4 } },
    panels: out,
  };
}

/** The share of its growth that the line at `order` has reached `elapsed` seconds in: nothing, then one eased motion, then whole. */
export function shareAt(order: number, elapsed: number): number {
  if (elapsed >= TOTAL) return 1;
  const delay = order * STEP;
  return playhead(elapsed - delay, TOTAL - delay);
}

/** Every bar of the chart, in the order it is drawn. */
export const barsOf = (geo: ProofGeo): BarGeo[] =>
  geo.panels.flatMap((panel) => panel.rows.flatMap((row) => row.lines.flatMap((line) => (line.bar ? [line.bar] : []))));

/** Every line of dots, in the order it is drawn. */
export const dotLinesOf = (geo: ProofGeo): LineGeo[] =>
  geo.panels.flatMap((panel) => panel.rows.flatMap((row) => row.lines.filter((line) => line.dots.length > 0)));

export const barLength = (bar: BarGeo, elapsed: number): number => bar.length * shareAt(bar.order, elapsed);
export const barNumber = (bar: BarGeo, elapsed: number): string => proofText(bar.end * shareAt(bar.order, elapsed), bar.unit);
export const dotsOpacity = (order: number, elapsed: number): number => shareAt(order, elapsed);
export const dotsShift = (order: number, elapsed: number): number => -DOT_SLIDE * (1 - shareAt(order, elapsed));

export interface ProofRig {
  bars: { rect: Pen<SVGRectElement>; text: Pen<SVGTextElement>; geo: BarGeo }[];
  dots: { g: Pen<SVGGElement>; order: number }[];
}

/** The pens of one drawing of `geo`, in the order `barsOf` and `dotLinesOf` list them. */
export function collectProof(svg: Element, geo: ProofGeo): ProofRig {
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>("[data-bar]"));
  const texts = Array.from(svg.querySelectorAll<SVGTextElement>("[data-num]"));
  const groups = Array.from(svg.querySelectorAll<SVGGElement>("[data-dots]"));
  const bars = barsOf(geo).flatMap((bar, i) => {
    const rect = rects[i];
    const text = texts[i];
    return rect && text ? [{ rect: new Pen(rect), text: new Pen(text), geo: bar }] : [];
  });
  const dots = dotLinesOf(geo).flatMap((line, i) => {
    const g = groups[i];
    return g ? [{ g: new Pen(g), order: line.order }] : [];
  });
  return { bars, dots };
}

/** Paints the chart as it is `elapsed` seconds into its growth; Infinity paints it whole. */
export function paintProof(rig: ProofRig, elapsed: number): void {
  for (const { rect, text, geo } of rig.bars) {
    rect.set("width", barLength(geo, elapsed));
    text.text(barNumber(geo, elapsed));
  }
  for (const { g, order } of rig.dots) {
    g.set("opacity", dotsOpacity(order, elapsed));
    g.set("transform", `translate(${fx(dotsShift(order, elapsed))} 0)`);
  }
}
