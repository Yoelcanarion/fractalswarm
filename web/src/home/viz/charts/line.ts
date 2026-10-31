// The hero chart's model, layout and frames, with no DOM in them: the same slice and the same box
// always give the same picture, so every number it prints can be tested.

import type { HeroPoint, HeroSlice } from "../../data/types";
import { Pen } from "../tree/paint";
import { emphasisOf, shortName, systemName, type Emphasis, type Names } from "./names";
import { easeInOutCubic, fx, smoothstep, span } from "../shared";
import {
  dodge,
  linear,
  niceTicks,
  polyline,
  seedsText,
  taskShort,
  taskText,
  textWidth,
  tickLabel,
  withSign,
  type Scale,
  type Ticks,
} from "./chart";

export type MetricKey = "stall" | "extra";

export interface Metric {
  key: MetricKey;
  title: string;
  sub: string;
  /** The same, for a panel too narrow for the long form. */
  subShort: string;
  unit: string;
}

/** What each panel measures, in the words of bench/REPORT.md §2. */
export const METRICS: readonly Metric[] = [
  { key: "stall", title: "Stall time", sub: "seconds with no agent working", subShort: "no agent working", unit: "s" },
  { key: "extra", title: "Extra cost", sub: "pre-registered basis: against its own run with no failures", subShort: "pre-registered basis", unit: "%" },
];

export interface LinePoint {
  x: number;
  profile: string;
  mean: number;
  min: number;
  max: number;
}

export type { Emphasis, Names };

export interface LineSeries {
  id: string;
  label: string;
  short: string;
  emphasis: Emphasis;
  stall: LinePoint[];
  extra: LinePoint[];
}

export interface LineModel {
  series: LineSeries[];
  xs: number[];
  /** The failure profile of each x, in the order of xs: C0 for 0 coordinators killed. */
  profiles: string[];
  seedCount: number;
  task: string;
  real: boolean;
  set: string;
  xLabel: string;
}

export function lineModel(data: HeroSlice): LineModel {
  const known = Object.keys(data.series);
  const ids = [...data.order.filter((id) => data.series[id]), ...known.filter((id) => !data.order.includes(id)).sort()];
  const point = (p: HeroPoint, key: MetricKey): LinePoint =>
    key === "stall"
      ? { x: p.x, profile: p.profile, mean: p.stall_s, min: p.stall_s_min, max: p.stall_s_max }
      : { x: p.x, profile: p.profile, mean: p.extra_cost_pct, min: p.extra_cost_pct_min, max: p.extra_cost_pct_max };
  const series: LineSeries[] = ids.map((id) => {
    const s = data.series[id]!;
    const points = [...s.points].sort((a, b) => a.x - b.x);
    return {
      id,
      label: s.label,
      short: shortName(id, s.label),
      emphasis: emphasisOf(id),
      stall: points.map((p) => point(p, "stall")),
      extra: points.map((p) => point(p, "extra")),
    };
  });
  const xs = [...new Set(series.flatMap((s) => s.stall.map((p) => p.x)))].sort((a, b) => a - b);
  const profiles = xs.map((x) => series.flatMap((s) => s.stall).find((p) => p.x === x)?.profile ?? "");
  return { series, xs, profiles, seedCount: data.seedCount, task: data.task, real: data.model === "real", set: data.set, xLabel: data.xLabel };
}

/** A series' name at the width there is. */
export const nameOf = (s: LineSeries, names: Names): string => systemName(s.id, s.label, names);

export function valueText(key: MetricKey, v: number): string {
  return key === "stall" ? `${v.toFixed(1)} s` : `${withSign(v, 1)}%`;
}

/** The setting of the chart, longest form first: the one that fits the width is printed under it. */
export function lineCaptions(model: LineModel): string[] {
  const kind = model.real ? "real" : "fake";
  const seeds = seedsText(model.seedCount);
  return [
    `${taskText(model.task)} · ${kind} model · ${seeds} · lines: the mean of the seeds · band: their range, FractalSwarm only`,
    `${taskShort(model.task)} · ${kind} model · ${seeds} · lines: mean · band: range of the seeds`,
    `${taskShort(model.task)} · ${kind} model · ${seeds}`,
  ];
}

/** The text alternative: what the two panels show, from the numbers of the data. */
export function lineSummary(model: LineModel): string {
  const last = model.xs.length - 1;
  const at = (s: LineSeries, key: MetricKey): string => `${s.label} ${valueText(key, s[key][last]!.mean)}`;
  const kind = model.real ? "real" : "fake";
  return (
    `${taskText(model.task)} on the ${kind} model, ${seedsText(model.seedCount)}: two charts, one of stall time in seconds and one of extra cost in percent, ` +
    `each against the number of coordinators killed (${model.xs.join(", ")}). ` +
    `At ${model.xs[last]} killed (${model.profiles[last]}) the stall time is ${model.series.map((s) => at(s, "stall")).join(", ")}. ` +
    `The extra cost against each system's own run with no failures is ${model.series.map((s) => at(s, "extra")).join(", ")}.`
  );
}

// -- layout -------------------------------------------------------------------------------------

const PAD = 10;
const TITLE_H = 26;
const AXIS_H = 48;
const AXIS_H_STACKED = 34;
const FOOT_H = 24;
const GAP_X = 36;
const GAP_Y = 14;
const LEFT = 50;
const INSET = 12;
const LABEL_LINE = 15;
export const LEAD = 14;
const RIGHT_PAD = 8;
const MIN_PLOT_H = 90;

export interface LabelPlace {
  series: number;
  emphasis: Emphasis;
  lines: string[];
  /** The centre of the label, after the labels were set apart. */
  y: number;
  /** Where its line ends. */
  endY: number;
}

export interface PanelLayout {
  metric: Metric;
  x: number;
  y: number;
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  gutter: number;
  yTicks: { y: number; label: string; zero: boolean }[];
  xTicks: { x: number; count: string; profile: string }[];
  titleY: number;
  /** The words after the title: the long form when it fits the panel. */
  sub: string;
  axisTitle: { x: number; y: number };
  /** Where the x axis labels sit: one line (the count) when stacked, two (count, profile) when side by side. */
  tickY: number;
  tickY2: number | null;
  labels: LabelPlace[];
  xAt: Scale;
  yAt: Scale;
  zeroY: number | null;
}

export interface LineLayout {
  width: number;
  height: number;
  stacked: boolean;
  names: Names;
  panels: PanelLayout[];
  caption: string;
  captionY: number;
}

function domainFor(model: LineModel, key: MetricKey): Ticks {
  let lo = 0;
  let hi = 0;
  for (const s of model.series) {
    for (const p of s[key]) {
      lo = Math.min(lo, p.mean, s.emphasis === "swarm" ? p.min : p.mean);
      hi = Math.max(hi, p.mean, s.emphasis === "swarm" ? p.max : p.mean);
    }
  }
  return niceTicks(lo, hi, key === "stall" ? 4 : 5);
}

/** The room the end labels need on the right of a plot. */
function gutterFor(model: LineModel, names: Names): number {
  let widest = 0;
  for (const s of model.series) {
    widest = Math.max(widest, textWidth(nameOf(s, names)));
    for (const m of METRICS) {
      const last = s[m.key][s[m.key].length - 1];
      if (last && s.emphasis !== "quiet") widest = Math.max(widest, textWidth(valueText(m.key, last.mean)));
    }
  }
  return Math.ceil(widest) + LEAD + RIGHT_PAD;
}

export function lineLayout(model: LineModel, width: number, height: number, captions: readonly string[] = []): LineLayout {
  const caption = captions.find((c) => textWidth(c) <= width - 2 * PAD) ?? captions[captions.length - 1] ?? "";
  const foot = caption ? FOOT_H : 0;

  const plotWidth = (stacked: boolean, names: Names): number => {
    const panelW = stacked ? width - 2 * PAD : (width - 2 * PAD - GAP_X) / 2;
    return panelW - LEFT - INSET - gutterFor(model, names);
  };
  const tiers: { stacked: boolean; names: Names; min: number }[] = [
    { stacked: false, names: "full", min: 330 },
    { stacked: false, names: "short", min: 250 },
    { stacked: true, names: "full", min: 330 },
    { stacked: true, names: "short", min: 0 },
  ];
  const tier = tiers.find((t) => plotWidth(t.stacked, t.names) >= t.min) ?? tiers[tiers.length - 1]!;
  const { stacked, names } = tier;
  const gutter = gutterFor(model, names);

  const area = height - 2 * PAD - foot;
  const panelW = stacked ? width - 2 * PAD : (width - 2 * PAD - GAP_X) / 2;
  const panelH = stacked ? (area - GAP_Y) / 2 : area;
  const axisH = stacked ? AXIS_H_STACKED : AXIS_H;

  const panels = METRICS.map((metric, index): PanelLayout => {
    const x = stacked ? PAD : PAD + index * (panelW + GAP_X);
    const y = stacked ? PAD + index * (panelH + GAP_Y) : PAD;
    const top = y + TITLE_H;
    const bottom = Math.max(top + MIN_PLOT_H, y + panelH - axisH);
    const left = x + LEFT;
    const right = x + panelW - gutter;
    const domain = domainFor(model, metric.key);
    const yAt = linear(domain.min, domain.max, bottom, top);
    const x0 = model.xs[0] ?? 0;
    const x1 = model.xs[model.xs.length - 1] ?? 1;
    const xAt = linear(x0, x1, left + INSET, right);

    const ends = model.series.map((s) => s[metric.key][s[metric.key].length - 1]!);
    const two = model.series.map((s) => s.emphasis !== "quiet");
    const sizes = two.map((t) => (t ? 2 * LABEL_LINE : LABEL_LINE));
    // The names may run on below the plot, beside the end of the axis: six of them can need more height than
    // a stacked plot has. They never go above it, where the panel's title is.
    const centres = dodge(
      ends.map((p) => yAt(p.mean)),
      sizes,
      top,
      Math.max(bottom, y + panelH - 2),
      2,
    );
    const labels: LabelPlace[] = model.series.map((s, i) => ({
      series: i,
      emphasis: s.emphasis,
      lines: two[i] ? [nameOf(s, names), valueText(metric.key, ends[i]!.mean)] : [nameOf(s, names)],
      y: centres[i]!,
      endY: yAt(ends[i]!.mean),
    }));

    return {
      metric,
      x,
      y,
      w: panelW,
      h: panelH,
      left,
      right,
      top,
      bottom,
      gutter,
      yTicks: domain.values.map((v, i, all) => ({
        y: yAt(v),
        label: tickLabel(v, domain.step) + (i === all.length - 1 ? (metric.unit === "%" ? "%" : ` ${metric.unit}`) : ""),
        zero: v === 0,
      })),
      xTicks: model.xs.map((v, i) => ({ x: xAt(v), count: String(v), profile: model.profiles[i] ?? "" })),
      titleY: y + 14,
      sub: textWidth(metric.title, 13) + 8 + textWidth(metric.sub) <= panelW ? metric.sub : metric.subShort,
      axisTitle: { x: right, y: bottom + (stacked ? 30 : 44) },
      tickY: bottom + 16,
      tickY2: stacked ? null : bottom + 30,
      labels,
      xAt,
      yAt,
      zeroY: domain.min <= 0 && domain.max >= 0 ? yAt(0) : null,
    };
  });

  return { width, height, stacked, names, panels, caption, captionY: height - PAD - 2 };
}

export interface SeriesShape {
  line: string;
  band: string | null;
  dots: { x: number; y: number; point: LinePoint }[];
}

/** The line, the band between the seeds (the swarm's only) and the marks of one series in one panel. */
export function shapeOf(series: LineSeries, panel: PanelLayout): SeriesShape {
  const key = panel.metric.key;
  const pts = series[key];
  const dots = pts.map((p) => ({ x: panel.xAt(p.x), y: panel.yAt(p.mean), point: p }));
  const band =
    series.emphasis === "swarm" && pts.length > 1
      ? polyline(
          [...pts.map((p) => [panel.xAt(p.x), panel.yAt(p.max)] as const), ...[...pts].reverse().map((p) => [panel.xAt(p.x), panel.yAt(p.min)] as const)],
          true,
        )
      : null;
  return { line: polyline(dots.map((d) => [d.x, d.y] as const)), band, dots };
}

// -- the draw ----------------------------------------------------------------------------------

/** Where each stage of the draw sits in the progress, so that a page can line its words up with it. */
export const LINE_KEYFRAMES = {
  axes: [0, 0.2],
  quiet: [0.12, 0.55],
  rival: [0.28, 0.72],
  swarm: [0.46, 0.92],
  labels: [0.84, 1],
} as const;

export interface LineFrame {
  axes: number;
  quiet: number;
  rival: number;
  swarm: number;
  labels: number;
}

/** How far each stage is: the axes first, then the quiet lines, the two rivals, the swarm last, then the names. */
export function lineFrame(p: number): LineFrame {
  const k = LINE_KEYFRAMES;
  return {
    axes: smoothstep(span(p, k.axes[0], k.axes[1])),
    quiet: easeInOutCubic(span(p, k.quiet[0], k.quiet[1])),
    rival: easeInOutCubic(span(p, k.rival[0], k.rival[1])),
    swarm: easeInOutCubic(span(p, k.swarm[0], k.swarm[1])),
    labels: smoothstep(span(p, k.labels[0], k.labels[1])),
  };
}

export interface LineRig {
  axes: Pen<SVGGElement>[];
  wipes: { panel: number; group: Emphasis; pen: Pen<SVGRectElement> }[];
  labels: Pen<SVGGElement>[];
}

export function collectLine(svg: SVGSVGElement): LineRig {
  const all = <E extends Element>(selector: string): E[] => Array.from(svg.querySelectorAll<E>(selector));
  return {
    axes: all<SVGGElement>('[data-part="axes"]').map((el) => new Pen(el)),
    wipes: all<SVGRectElement>("[data-wipe]").map((el) => ({
      panel: Number(el.getAttribute("data-panel")),
      group: el.getAttribute("data-wipe") as Emphasis,
      pen: new Pen(el),
    })),
    labels: all<SVGGElement>('[data-part="labels"]').map((el) => new Pen(el)),
  };
}

export function paintLine(rig: LineRig, layout: LineLayout, p: number): void {
  const f = lineFrame(p);
  for (const pen of rig.axes) pen.set("opacity", f.axes);
  for (const pen of rig.labels) pen.set("opacity", f.labels);
  for (const w of rig.wipes) {
    const panel = layout.panels[w.panel];
    if (!panel) continue;
    // the rectangle spans the panel's plot, and is scaled about its left edge
    const left = panel.left;
    w.pen.set("transform", `translate(${fx(left)} 0) scale(${fx(f[w.group], 4)} 1) translate(${fx(-left)} 0)`);
  }
}
