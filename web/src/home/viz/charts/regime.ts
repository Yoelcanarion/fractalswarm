// The regime strip's model, layout and frames, with no DOM in them. One strip for each assumption the
// rival was granted, the settings that were run laid out in order, and on each setting what the
// pre-registered rule says of locality: it holds, it ties or it fails. The settings are not to scale
// (they are the ones that were run), and the ones outside the plausible region are shown and marked,
// because the report shows them and says they decide nothing.

import type { Locality, RegimeSlice } from "../../data/types";
import { Pen } from "../tree/paint";
import { easeOutCubic, fx, smoothstep, span } from "../shared";
import { seedsText, taskShort, taskText, textWidth, wrapText } from "./chart";
import { labelOf } from "./names";

/** What the rule says, in the words of the pre-registration (§4). */
export const WORD: Record<Locality, string> = { holds: "holds", ties: "ties", fails: "fails", "n/a": "has no result" };

export const secondsText = (ms: number): string => `${+(ms / 1000).toFixed(2)} s`;

/** A ratio of seed means as the report prints it: two decimals below ten, one above. */
export const ratioNum = (x: number): string => (x >= 10 ? x.toFixed(1) : x.toFixed(2));

export interface RegimeCell {
  valueMs: number;
  value: string;
  locality: Locality;
  /** Inside the region the pre-registration fixed before any result: the outside is reported and decides nothing. */
  plausible: boolean;
  isDefault: boolean;
  cdt: number | null;
  blast: number | null;
  idle: number | null;
}

export interface RegimeRowModel {
  axis: string;
  /** As the data words it. */
  label: string;
  cells: RegimeCell[];
}

export interface RegimeModel {
  rows: RegimeRowModel[];
  against: string;
  againstLabel: string;
  task: string;
  model: "real" | "fake";
  profile: string;
  seeds: string[];
  threshold: number;
  /** How the settings inside the plausible region read. */
  tally: Record<Locality, number>;
  plausibleCount: number;
  maxCells: number;
  has: { na: boolean; implausible: boolean; default: boolean };
}

export function regimeModel(data: RegimeSlice): RegimeModel {
  const rows: RegimeRowModel[] = data.rows
    .filter((row) => row.points.length > 0)
    .map((row) => {
      const preset = data.defaults[row.axis] ?? null;
      return {
        axis: row.axis,
        label: row.label,
        cells: [...row.points]
          .sort((a, b) => a.valueMs - b.valueMs)
          .map((p) => ({
            valueMs: p.valueMs,
            value: secondsText(p.valueMs),
            locality: p.locality,
            plausible: p.plausible,
            isDefault: preset !== null && p.valueMs === preset,
            cdt: p.cdtRatio,
            blast: p.blastRatio,
            idle: p.idleRatio,
          })),
      };
    });
  const cells = rows.flatMap((row) => row.cells);
  const tally: Record<Locality, number> = { holds: 0, ties: 0, fails: 0, "n/a": 0 };
  for (const c of cells) if (c.plausible) tally[c.locality] += 1;
  return {
    rows,
    against: data.against,
    againstLabel: labelOf(data.against),
    task: data.task,
    model: data.model,
    profile: data.profile,
    seeds: data.seeds ?? [],
    threshold: data.threshold,
    tally,
    plausibleCount: cells.filter((c) => c.plausible).length,
    maxCells: Math.max(1, ...rows.map((row) => row.cells.length)),
    has: {
      na: cells.some((c) => c.locality === "n/a"),
      implausible: cells.some((c) => !c.plausible),
      default: cells.some((c) => c.isDefault),
    },
  };
}

const kindOf = (m: RegimeModel): string => (m.model === "real" ? "real model" : "fake model");
const joined = (...parts: (string | null)[]): string => parts.filter((x): x is string => !!x).join(" · ");

/** The setting, from the longest wording to the shortest. A result always names its model, task, profile and rival. */
export function regimeCaptions(m: RegimeModel): string[] {
  const seeds = m.seeds.length ? seedsText(m.seeds.length) : null;
  const against = m.againstLabel.toLowerCase();
  return [
    joined(kindOf(m), taskText(m.task), `failure profile ${m.profile}`, seeds, `the swarm against the ${against}`, "verdicts by the pre-registered rule"),
    joined(kindOf(m), taskText(m.task), `failure profile ${m.profile}`, seeds, `against the ${against}`),
    joined(kindOf(m), taskShort(m.task), m.profile, seeds, `against the ${against}`),
  ];
}

export function cellText(m: RegimeModel, row: RegimeRowModel, c: RegimeCell): string {
  const ratios =
    c.cdt === null || c.blast === null || c.idle === null
      ? "no ratios"
      : `ratios to the ${m.againstLabel.toLowerCase()}'s, mean of the seeds: coordinator-dependency time ${ratioNum(c.cdt)}, blast radius ${ratioNum(c.blast)}, idle agent-seconds ${ratioNum(c.idle)}`;
  const notes = [c.isDefault ? "the default" : null, c.plausible ? null : "outside the plausible region, shown and deciding nothing"].filter((x): x is string => !!x);
  return `${row.label} ${c.value}: locality ${WORD[c.locality]}${notes.length ? ` (${notes.join("; ")})` : ""}. ${ratios}`;
}

export function regimeSummary(m: RegimeModel): string {
  const seeds = m.seeds.length ? `${seedsText(m.seeds.length)}, ` : "";
  const where = `${kindOf(m)}, ${taskText(m.task)} at failure profile ${m.profile}, ${seeds}the swarm against the ${m.againstLabel.toLowerCase()}`;
  const rows = m.rows.map(
    (row) =>
      `${row.label}: ${row.cells.map((c) => `${c.value} ${WORD[c.locality]}${c.isDefault ? " (the default)" : ""}${c.plausible ? "" : " (outside the plausible region)"}`).join(", ")}`,
  );
  const t = m.tally;
  return `The swarm's locality as one assumption of the supervisor is moved at a time, ${where}. ${rows.join(". ")}. Within the plausible region, ${m.plausibleCount} settings, locality holds in ${t.holds}, ties in ${t.ties} and fails in ${t.fails}.`;
}

// -- layout -------------------------------------------------------------------------------------

const PAD = 10;
const HEAD_LINE = 16;
const LABEL_LINE = 16;
const KEY_LINE = 22;
const CAP_LINE = 16;
const PITCH_MAX = 116;
const PITCH_MIN = 40;
const SIDE_WIDTH = 760;

export type GlyphKind = "holds" | "ties" | "fails" | "na" | "implausible" | "default";

const KEY_LABELS: Record<GlyphKind, [string, string]> = {
  holds: ["holds", "holds"],
  ties: ["ties", "ties"],
  fails: ["fails", "fails"],
  na: ["no result", "no result"],
  implausible: ["outside the plausible region", "not plausible"],
  default: ["the default", "default"],
};

const RATIO_NOTES = [
  "number under a mark: the swarm's coordinator-dependency time as a multiple of the supervisor's, mean of the seeds",
  "number: the swarm's coordinator-dependency time as a multiple of the supervisor's",
];

interface Tier {
  /** The height kept around a mark: the caret above it, the ring, the room to breathe. */
  lane: number;
  ratios: boolean;
  rowGap: number;
  keyGap: number;
  capGap: number;
}

/** From the roomiest to the tightest: the first that fits the frame is the one drawn. */
const TIERS: Tier[] = [
  { lane: 50, ratios: true, rowGap: 22, keyGap: 22, capGap: 6 },
  { lane: 44, ratios: false, rowGap: 18, keyGap: 18, capGap: 6 },
  { lane: 36, ratios: false, rowGap: 12, keyGap: 12, capGap: 4 },
  { lane: 28, ratios: false, rowGap: 6, keyGap: 6, capGap: 2 },
];

export interface RegimePointLayout {
  cx: number;
  cy: number;
  /** The column behind a setting where locality fails: the strip says where the supervisor wins before it says anything else. */
  band: { x: number; y: number; w: number; h: number } | null;
  valueY: number;
  ratioY: number | null;
  value: string;
  ratio: string | null;
}

export interface RegimeRowLayout {
  head: { x: number; y: number; lines: string[] };
  rail: { x1: number; x2: number; y: number };
  points: RegimePointLayout[];
  top: number;
  bottom: number;
}

export interface KeyItem {
  kind: GlyphKind;
  label: string;
  x: number;
  y: number;
  /** The width of the glyph and its words. */
  w: number;
  row: number;
}

export interface RegimeLayout {
  width: number;
  height: number;
  side: boolean;
  ratios: boolean;
  lane: number;
  markR: number;
  pitch: number;
  x0: number;
  rows: RegimeRowLayout[];
  key: KeyItem[];
  keyTop: number;
  ratioNote: { x: number; y: number; text: string } | null;
  caption: { x: number; y: number; lines: string[] };
  /** What the roomiest tier that could be drawn would need, and whether even that did not fit the frame. */
  needed: number;
  overflow: boolean;
}

const rowsOf = (items: KeyItem[]): number => (items.length ? items[items.length - 1]!.row + 1 : 0);

function flowKey(kinds: GlyphKind[], variant: 0 | 1, width: number): KeyItem[] {
  let x = PAD;
  let row = 0;
  return kinds.map((kind) => {
    const label = KEY_LABELS[kind][variant];
    const w = 24 + textWidth(label);
    if (x > PAD && x + w > width - PAD) {
      row += 1;
      x = PAD;
    }
    const item: KeyItem = { kind, label, x, y: 0, w, row };
    x += w + 18;
    return item;
  });
}

export function regimeLayout(model: RegimeModel, width: number, height: number, captions: readonly string[] = []): RegimeLayout {
  const n = model.rows.length;
  const side = width >= SIDE_WIDTH;
  const headW = side ? Math.min(300, Math.round(width * 0.26)) : 0;
  const x0 = side ? PAD + headW + 16 : PAD;
  const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, (width - PAD - x0) / model.maxCells));
  const heads = model.rows.map((row) => wrapText(row.label, side ? headW - 12 : width - 2 * PAD));

  const avail = width - 2 * PAD;
  const oneLine = captions.find((c) => textWidth(c) <= avail);
  const capLines = !captions.length ? [] : oneLine ? [oneLine] : wrapText(captions[captions.length - 1]!, avail);

  const kinds: GlyphKind[] = ["holds", "ties", "fails"];
  if (model.has.na) kinds.push("na");
  if (model.has.implausible) kinds.push("implausible");
  if (model.has.default) kinds.push("default");
  const full = flowKey(kinds, 0, width);
  const key = rowsOf(full) <= 2 ? full : flowKey(kinds, 1, width);
  const keyRows = rowsOf(key);
  const note = RATIO_NOTES.find((t) => textWidth(t) <= avail) ?? null;

  const measure = (tier: Tier) => {
    const ratios = tier.ratios && note !== null;
    const tail = 2 + LABEL_LINE + (ratios ? LABEL_LINE : 0);
    const blocks = heads.map((h) => (side ? Math.max(tier.lane + tail, h.length * HEAD_LINE) : h.length * HEAD_LINE + 6 + tier.lane + tail));
    const foot = tier.keyGap + keyRows * KEY_LINE + (ratios ? KEY_LINE : 0) + (capLines.length ? tier.capGap + capLines.length * CAP_LINE : 0);
    const needed = 2 * PAD + blocks.reduce((a, b) => a + b, 0) + Math.max(0, n - 1) * tier.rowGap + foot;
    return { tier, ratios, tail, blocks, needed };
  };
  const fits = TIERS.map(measure).find((m) => m.needed <= height);
  const picked = fits ?? measure(TIERS[TIERS.length - 1]!);
  const { tier, ratios, tail, blocks, needed } = picked;

  // Whatever the frame has over goes between the rows, and the rest above them.
  const extra = Math.max(0, height - needed);
  const grow = n > 1 ? Math.min(14, extra / (n - 1)) : 0;
  let y = PAD + Math.min(24, (extra - grow * Math.max(0, n - 1)) / 2);
  const lane = tier.lane;
  const markR = Math.min(9, (lane - 14) / 2);

  const rows: RegimeRowLayout[] = model.rows.map((row, r) => {
    const top = y;
    const lines = heads[r]!;
    const laneTop = side ? top + (blocks[r]! - (lane + tail)) / 2 : top + lines.length * HEAD_LINE + 6;
    const cy = laneTop + lane / 2;
    const headY = side ? cy - ((lines.length - 1) * HEAD_LINE) / 2 : top + HEAD_LINE / 2;
    const points: RegimePointLayout[] = row.cells.map((c, k) => {
      const cx = x0 + (k + 0.5) * pitch;
      const valueY = laneTop + lane + 2 + LABEL_LINE / 2;
      return {
        cx,
        cy,
        band: c.locality === "fails" ? { x: cx - pitch / 2 + 3, y: laneTop, w: pitch - 6, h: lane + tail - 2 } : null,
        valueY,
        ratioY: ratios ? valueY + LABEL_LINE : null,
        value: c.value,
        ratio: ratios && c.cdt !== null ? `${ratioNum(c.cdt)}×` : ratios ? "–" : null,
      };
    });
    const out: RegimeRowLayout = {
      head: { x: PAD, y: headY, lines },
      rail: { x1: x0, x2: x0 + row.cells.length * pitch, y: cy },
      points,
      top,
      bottom: top + blocks[r]!,
    };
    y = top + blocks[r]! + tier.rowGap + grow;
    return out;
  });

  // The key and the setting sit at the foot of the frame.
  const capTop = height - PAD - capLines.length * CAP_LINE;
  const footTop = (capLines.length ? capTop - tier.capGap : height - PAD) - (keyRows * KEY_LINE + (ratios ? KEY_LINE : 0));
  const keyTop = Math.max(footTop, rows.length ? rows[rows.length - 1]!.bottom + tier.keyGap : footTop);
  for (const item of key) item.y = keyTop + item.row * KEY_LINE + KEY_LINE / 2;

  return {
    width,
    height,
    side,
    ratios,
    lane,
    markR,
    pitch,
    x0,
    rows,
    key,
    keyTop,
    ratioNote: ratios && note ? { x: PAD, y: keyTop + keyRows * KEY_LINE + KEY_LINE / 2, text: note } : null,
    caption: { x: PAD, y: capTop + CAP_LINE / 2, lines: capLines },
    needed,
    overflow: !fits,
  };
}

// -- the draw ----------------------------------------------------------------------------------

/** The strips come one after another, the last (where the supervisor wins) after the rest; the key follows. */
export const REGIME_KEYFRAMES = { rows: [0.06, 0.9], key: [0.84, 1] } as const;

export interface RegimeFrame {
  head(r: number, n: number): number;
  /** How much of a strip's rail is drawn, from its left end. */
  rail(r: number, n: number): number;
  /** How far point k of m on strip r of n has come in. */
  point(r: number, n: number, k: number, m: number): number;
  key: number;
}

export function regimeFrame(p: number): RegimeFrame {
  const [a, b] = REGIME_KEYFRAMES.rows;
  const len = (b - a) * 0.55;
  const start = (r: number, n: number): number => a + (b - a - len) * (n > 1 ? r / (n - 1) : 0);
  return {
    head: (r, n) => smoothstep(span(p, start(r, n), start(r, n) + len * 0.2)),
    rail: (r, n) => easeOutCubic(span(p, start(r, n), start(r, n) + len * 0.7)),
    point: (r, n, k, m) => {
      const s = start(r, n) + len * 0.1 + len * 0.45 * (m > 1 ? k / (m - 1) : 0);
      return easeOutCubic(span(p, s, s + len * 0.35));
    },
    key: smoothstep(span(p, REGIME_KEYFRAMES.key[0], REGIME_KEYFRAMES.key[1])),
  };
}

export interface RegimeRig {
  heads: Pen<SVGGElement>[];
  rails: Pen<SVGLineElement>[];
  marks: Pen<SVGGElement>[][];
  labels: Pen<SVGGElement>[][];
  key: Pen<SVGGElement>[];
}

export function collectRegime(svg: SVGSVGElement): RegimeRig {
  const all = <E extends Element>(selector: string): E[] => Array.from(svg.querySelectorAll<E>(selector));
  const at = (el: Element, name: string): number => Number(el.getAttribute(name));
  const byRow = (selector: string): Pen<SVGGElement>[][] => {
    const rows: Pen<SVGGElement>[][] = [];
    for (const el of all<SVGGElement>(selector)) {
      const r = at(el, "data-r");
      (rows[r] ??= [])[at(el, "data-k")] = new Pen(el);
    }
    return rows;
  };
  const rails: Pen<SVGLineElement>[] = [];
  for (const el of all<SVGLineElement>("[data-rail]")) rails[at(el, "data-r")] = new Pen(el);
  const heads: Pen<SVGGElement>[] = [];
  for (const el of all<SVGGElement>("[data-head]")) heads[at(el, "data-r")] = new Pen(el);
  return {
    heads,
    rails,
    marks: byRow("[data-mark]"),
    labels: byRow("[data-pl]"),
    key: all<SVGGElement>('[data-part="key"]').map((el) => new Pen(el)),
  };
}

/** A transform that scales about (x, y), written so that a scale of nothing is still a transform a browser draws. */
export const scaleAbout = (x: number, y: number, sx: number, sy: number): string =>
  `translate(${fx(x)} ${fx(y)}) scale(${Math.max(sx, 0.001).toFixed(3)} ${Math.max(sy, 0.001).toFixed(3)}) translate(${fx(-x)} ${fx(-y)})`;

export function paintRegime(rig: RegimeRig, layout: RegimeLayout, p: number): void {
  const f = regimeFrame(p);
  const n = layout.rows.length;
  layout.rows.forEach((row, r) => {
    rig.heads[r]?.set("opacity", f.head(r, n));
    rig.rails[r]?.set("transform", scaleAbout(row.rail.x1, row.rail.y, f.rail(r, n), 1));
    row.points.forEach((pt, k) => {
      const v = f.point(r, n, k, row.points.length);
      rig.marks[r]?.[k]?.set("transform", `translate(${fx(pt.cx)} ${fx(pt.cy)}) scale(${(0.4 + 0.6 * v).toFixed(3)})`);
      rig.marks[r]?.[k]?.set("opacity", v);
      rig.labels[r]?.[k]?.set("opacity", v);
    });
  });
  for (const pen of rig.key) pen.set("opacity", f.key);
}
