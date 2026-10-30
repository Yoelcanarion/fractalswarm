// The paired bars' model, layout and frames, with no DOM in them. Each measure is a pair of bars, the
// swarm's and the rival's, and the rival's is always the whole length: what is drawn is the ratio
// of the seed means, with the line the pre-registered rule draws at half.

import type { VerdictRow, VerdictsSlice } from "../../data/types";
import { Pen } from "../tree/paint";
import { easeOutCubic, fx, smoothstep, span } from "../shared";
import { linear, seedsText, taskShort, taskText, textWidth, type Scale } from "./chart";
import { labelOf, systemName, type Names } from "./names";

/** The three measures of locality, in the order the pre-registration lists them. */
export const LOCALITY = ["H4a", "H4b", "H4c"] as const;

const MEASURES: Record<string, { name: string; sub: string; unit: string }> = {
  cdt_s: { name: "Coordinator-dependency time", sub: "seconds", unit: " s" },
  blast_sessions_mean_pct: { name: "Blast radius", sub: "% of sessions", unit: "%" },
  idle_agent_s: { name: "Idle agent-seconds", sub: "agent-seconds", unit: "" },
};

export interface PairRow {
  hypothesis: string;
  metric: string;
  name: string;
  sub: string;
  unit: string;
  swarm: number;
  rival: number;
  /** The swarm's value as a part of the rival's: the length of its bar. */
  fraction: number;
  verdict: VerdictRow["verdict"];
  /** The seeds disagree: the verdict is marked with a star, as the report marks it. */
  mixed: boolean;
  seeds: string[];
  /** The same measure against the other rival, for the table and the text alternative. */
  other: { rival: string; value: number | null; ratio: number | null; verdict: VerdictRow["verdict"] } | null;
}

export interface PairModel {
  rows: PairRow[];
  rival: string;
  rivalLabel: string;
  profile: string;
  seeds: string[];
  task: string | null;
  real: boolean | null;
  /** How far the axis runs, as a part of the rival's value: 1, or more if the swarm's bar is the longer. */
  domainMax: number;
}

export function pairModel(data: VerdictsSlice, rival = "durable-max", other = rival === "durable" ? "durable-max" : "durable"): PairModel {
  const pick = (who: string, h: string): VerdictRow | undefined => data.comparisons.find((c) => c.rival === who && c.hypothesis === h);
  const rows: PairRow[] = [];
  for (const h of LOCALITY) {
    const c = pick(rival, h);
    if (!c || c.swarm === null || c.rivalValue === null || c.rivalValue <= 0) continue;
    const m = MEASURES[c.metric] ?? { name: c.name.replace(/^Locality:\s*/, ""), sub: "", unit: "" };
    const o = pick(other, h);
    rows.push({
      hypothesis: h,
      metric: c.metric,
      name: m.name,
      sub: m.sub,
      unit: m.unit,
      swarm: c.swarm,
      rival: c.rivalValue,
      fraction: c.swarm / c.rivalValue,
      verdict: c.verdict,
      mixed: c.mixed,
      seeds: c.seeds,
      other: o ? { rival: other, value: o.rivalValue, ratio: o.ratio, verdict: o.verdict } : null,
    });
  }
  const first = rows.length ? pick(rival, rows[0]!.hypothesis) : undefined;
  return {
    rows,
    rival,
    rivalLabel: labelOf(rival),
    profile: first?.profile ?? "",
    seeds: first?.seeds ?? [],
    task: data.task ?? null,
    real: data.real ?? (data.model ? data.model === "real" : null),
    domainMax: Math.max(1, Math.ceil(Math.max(0, ...rows.map((r) => r.fraction)) * 2) / 2),
  };
}

export const valueText = (row: PairRow, v: number): string => `${v.toFixed(1)}${row.unit}`;

export const verdictText = (row: PairRow): string => `${row.verdict}${row.mixed ? "*" : ""}`;

export function pairCaptions(model: PairModel): string[] {
  const kind = model.real === null ? null : model.real ? "real model" : "fake model";
  const seeds = seedsText(model.seeds.length);
  const rule = "means of the seeds; verdicts by the pre-registered per-seed rule";
  const tail = (...parts: (string | null)[]): string => parts.filter((x): x is string => !!x).join(" · ");
  return [
    tail(model.task ? taskText(model.task) : null, model.profile ? `failure profile ${model.profile}` : null, kind, seeds, rule),
    tail(model.task ? taskShort(model.task) : null, model.profile || null, kind, seeds, "means; pre-registered verdicts"),
    tail(model.task ? taskShort(model.task) : null, model.profile || null, kind, seeds),
  ];
}

export function pairSummary(model: PairModel): string {
  const kind = model.real === null ? "" : model.real ? " on the real model" : " on the fake model";
  const where = model.task ? `${taskText(model.task)}${kind}, ` : "";
  const rows = model.rows.map((r) => {
    const other = r.other && r.other.value !== null ? `; against the ${labelOf(r.other.rival).toLowerCase()} the rival's value is ${valueText(r, r.other.value)}, verdict ${r.other.verdict}` : "";
    return `${r.name}: ${labelOf("swarm")} ${valueText(r, r.swarm)} against ${model.rivalLabel} ${valueText(r, r.rival)}, ${Math.round(r.fraction * 100)}% of it, verdict ${verdictText(r)}${other}`;
  });
  return `${where}${seedsText(model.seeds.length)}, failure profile ${model.profile}: locality, as paired bars, the swarm's mean against the mean of the ${model.rivalLabel.toLowerCase()}. ${rows.join(". ")}.`;
}

// -- layout -------------------------------------------------------------------------------------

const PAD = 10;
const TITLE_H = 26;
const ROW_GAP = 4;
const AXIS_H = 52;
const KEY_H = 20;
const CAP_H = 20;
const VALUE_W = 58;
const MIN_BAR = 12;
const MAX_BAR = 24;
const PILL_H = 20;

export interface BarBox {
  x: number;
  y: number;
  /** The whole length of the bar: what it is at the end of the draw. */
  w: number;
  h: number;
}

export interface PairGroup {
  index: number;
  titleY: number;
  swarm: BarBox;
  rival: BarBox;
  pill: { x: number; y: number; w: number; text: string };
}

export interface PairLayout {
  width: number;
  height: number;
  names: Names;
  labelX: number;
  x0: number;
  x1: number;
  xAt: Scale;
  barH: number;
  groups: PairGroup[];
  axisY: number;
  ticks: { x: number; label: string }[];
  /** What 100% is, under the axis. */
  axisTitle: { x: number; y: number; text: string };
  halfX: number;
  guideTop: number;
  keyY: number;
  captionY: number;
  caption: string;
  key: string;
}

/** A bar with a square end on the baseline and a round one on its value, as long as it has drawn. */
export function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w < 0.5) return "";
  const rr = Math.min(r, w, h / 2);
  const f = (n: number): string => fx(n);
  return `M${f(x)} ${f(y)}H${f(x + w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)}V${f(y + h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + h)}H${f(x)}Z`;
}

export function pairLayout(model: PairModel, width: number, height: number, captions: readonly string[] = []): PairLayout {
  const caption = captions.find((c) => textWidth(c) <= width - 2 * PAD) ?? captions[captions.length - 1] ?? "";
  const foot = KEY_H + (caption ? CAP_H : 0);

  const labelWidth = (names: Names): number =>
    Math.ceil(Math.max(textWidth(systemName("swarm", labelOf("swarm"), names)), textWidth(systemName(model.rival, model.rivalLabel, names)))) + 10;
  const names: Names = width - 2 * PAD - labelWidth("full") - VALUE_W >= 260 ? "full" : "short";
  const labelW = labelWidth(names);

  const n = Math.max(1, model.rows.length);
  const room = height - 2 * PAD - foot;
  const available = room - AXIS_H;
  const barH = Math.min(MAX_BAR, Math.max(MIN_BAR, (available - n * (TITLE_H + ROW_GAP + 10)) / (2 * n)));
  const block = TITLE_H + 2 * barH + ROW_GAP;
  const gap = Math.min(44, Math.max(10, (available - n * block) / Math.max(1, n - 1)));
  // What the groups do not use is shared above and below them, so the chart sits in the frame instead of hugging its top.
  const spare = Math.max(0, (room - (n * block + (n - 1) * gap + AXIS_H)) / 2);

  const x0 = PAD + labelW;
  const x1 = width - PAD - VALUE_W;
  const longKey = `half of the ${model.rivalLabel.toLowerCase()}'s value`;
  const axisTitles = [`% of the ${model.rivalLabel.toLowerCase()}'s value`, "% of the rival's value"];
  const axisTitle = axisTitles.find((t) => textWidth(t) <= x1 - x0 + VALUE_W) ?? axisTitles[1]!;
  const xAt = linear(0, model.domainMax, x0, x1);

  let top = PAD + spare;
  const groups: PairGroup[] = model.rows.map((row, index) => {
    const swarmY = top + TITLE_H;
    const rivalY = swarmY + barH + ROW_GAP;
    const text = verdictText(row);
    const w = textWidth(text) + 18;
    const g: PairGroup = {
      index,
      titleY: top + TITLE_H / 2 - 2,
      swarm: { x: x0, y: swarmY, w: xAt(row.fraction) - x0, h: barH },
      rival: { x: x0, y: rivalY, w: xAt(1) - x0, h: barH },
      pill: { x: width - PAD - w, y: top + TITLE_H / 2 - 2 - PILL_H / 2, w, text },
    };
    top += block + gap;
    return g;
  });
  const lastBottom = top - gap;
  const ticks: { x: number; label: string }[] = [];
  for (let f = 0; f <= model.domainMax + 1e-9; f += 0.5) ticks.push({ x: xAt(f), label: `${Math.round(f * 100)}%` });

  return {
    width,
    height,
    names,
    labelX: PAD,
    x0,
    x1,
    xAt,
    barH,
    groups,
    axisY: lastBottom + 8,
    ticks,
    axisTitle: { x: x0, y: lastBottom + 8 + 34, text: axisTitle },
    halfX: xAt(0.5),
    guideTop: PAD + TITLE_H,
    keyY: height - PAD - (caption ? CAP_H : 0) - 2,
    captionY: height - PAD - 2,
    caption,
    key: x0 + 30 + textWidth(longKey) <= width - PAD ? longKey : "half",
  };
}

// -- the draw ----------------------------------------------------------------------------------

export const PAIR_KEYFRAMES = { axes: [0, 0.15], rival: [0.1, 0.52], swarm: [0.4, 0.88], labels: [0.84, 1] } as const;

export interface PairFrame {
  axes: number;
  labels: number;
  /** How much of its length the rival's bar of group g of n has drawn. */
  rival(g: number, n: number): number;
  swarm(g: number, n: number): number;
}

/** Each group takes six tenths of the window and the groups start one after another across the other four. */
function staged(p: number, window: readonly [number, number], g: number, n: number): number {
  const [a, b] = window;
  const len = (b - a) * 0.6;
  const start = n <= 1 ? a : a + (b - a) * 0.4 * (g / (n - 1));
  return easeOutCubic(span(p, start, start + len));
}

export function pairFrame(p: number): PairFrame {
  const k = PAIR_KEYFRAMES;
  return {
    axes: smoothstep(span(p, k.axes[0], k.axes[1])),
    labels: smoothstep(span(p, k.labels[0], k.labels[1])),
    rival: (g, n) => staged(p, k.rival, g, n),
    swarm: (g, n) => staged(p, k.swarm, g, n),
  };
}

export interface PairRig {
  axes: Pen<SVGGElement>[];
  labels: Pen<SVGGElement>[];
  rival: Pen<SVGPathElement>[];
  swarm: Pen<SVGPathElement>[];
}

export function collectPairs(svg: SVGSVGElement): PairRig {
  const all = <E extends Element>(selector: string): E[] => Array.from(svg.querySelectorAll<E>(selector));
  const bars = (who: string): Pen<SVGPathElement>[] =>
    all<SVGPathElement>(`[data-bar="${who}"]`)
      .sort((a, b) => Number(a.getAttribute("data-g")) - Number(b.getAttribute("data-g")))
      .map((el) => new Pen(el));
  return {
    axes: all<SVGGElement>('[data-part="axes"]').map((el) => new Pen(el)),
    labels: all<SVGGElement>('[data-part="labels"]').map((el) => new Pen(el)),
    rival: bars("rival"),
    swarm: bars("swarm"),
  };
}

export function paintPairs(rig: PairRig, layout: PairLayout, p: number): void {
  const f = pairFrame(p);
  const n = layout.groups.length;
  for (const pen of rig.axes) pen.set("opacity", f.axes);
  for (const pen of rig.labels) pen.set("opacity", f.labels);
  layout.groups.forEach((g, i) => {
    const r = g.rival;
    const s = g.swarm;
    rig.rival[i]?.set("d", barPath(r.x, r.y, r.w * f.rival(i, n), r.h));
    rig.swarm[i]?.set("d", barPath(s.x, s.y, s.w * f.swarm(i, n), s.h));
  });
}
