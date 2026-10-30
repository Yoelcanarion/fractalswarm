// The dot plot's model, layout and frames, with no DOM in them. One dot is one run, so a reader sees
// the spread of the seeds and not only their mean, which is what a tie looks like.

import type { HeadlineCell, HeadlineSlice } from "../../data/types";
import { Pen } from "../tree/paint";
import { easeOutCubic, fx, naturalCompare, smoothstep, span } from "../shared";
import { linear, niceTicks, seedsText, taskShort, taskText, textWidth, tickLabel, withSign, type Scale } from "./chart";
import { bySystemOrder, emphasisOf, labelOf, systemName, type Emphasis, type Names } from "./names";

export type DotMetric = "stall" | "extra";

export interface DotRun {
  cell: string;
  seed: string;
  stall: number;
  /** Null where the run has none: the extra cost of a run with no failures is 0 by definition, and a run may lack a baseline. */
  extra: number | null;
  valid: boolean | null;
  completed: boolean;
}

export interface DotRow {
  id: string;
  label: string;
  emphasis: Emphasis;
  runs: DotRun[];
  meanStall: number;
  meanExtra: number | null;
}

export interface DotGroup {
  profile: string;
  killed: number;
  /** A group with no failures is the reference the extra cost is measured against. */
  reference: boolean;
  rows: DotRow[];
}

export interface DotModel {
  groups: DotGroup[];
  seeds: string[];
  seedCount: number;
  task: string;
  real: boolean;
  /** The ids of the runs whose result was not valid: they are marked, and counted, never left out. */
  invalid: string[];
}

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

export function dotModel(data: HeadlineSlice): DotModel {
  const cells = data.cells;
  const byProfile = new Map<string, HeadlineCell[]>();
  for (const c of cells) byProfile.set(c.profile, [...(byProfile.get(c.profile) ?? []), c]);
  const groups: DotGroup[] = [...byProfile.entries()]
    .map(([profile, list]): DotGroup => {
      const killed = Math.max(...list.map((c) => c.coordinatorsKilled));
      const ids = bySystemOrder([...new Set(list.map((c) => c.workflow))]);
      const rows = ids.map((id): DotRow => {
        const runs = list
          .filter((c) => c.workflow === id)
          .sort((a, b) => naturalCompare(a.seed, b.seed))
          .map((c): DotRun => ({ cell: c.cell, seed: c.seed, stall: c.stallS, extra: c.extraCostPct, valid: c.valid, completed: c.completed }));
        const extras = runs.flatMap((r) => (r.extra === null ? [] : [r.extra]));
        return {
          id,
          label: labelOf(id),
          emphasis: emphasisOf(id),
          runs,
          meanStall: mean(runs.map((r) => r.stall)),
          meanExtra: extras.length ? mean(extras) : null,
        };
      });
      return { profile, killed, reference: killed === 0, rows };
    })
    // the failures first, the run with none after it as the reference
    .sort((a, b) => b.killed - a.killed || naturalCompare(a.profile, b.profile));
  return {
    groups,
    seeds: [...data.seeds].sort(naturalCompare),
    seedCount: data.seedCount,
    task: data.task,
    real: data.real,
    invalid: cells.filter((c) => c.valid === false).map((c) => c.cell).sort(naturalCompare),
  };
}

export const groupTitle = (g: DotGroup, short: boolean): string =>
  g.killed === 0
    ? short
      ? `${g.profile} · no failures`
      : `No failures (${g.profile})`
    : short
      ? `${g.profile} · ${g.killed} killed`
      : `${g.killed} ${g.killed === 1 ? "coordinator" : "coordinators"} killed (${g.profile})`;

export const dotValue = (metric: DotMetric, v: number): string => (metric === "stall" ? `${v.toFixed(1)} s` : `${withSign(v, 1)}%`);

export function dotCaptions(model: DotModel): string[] {
  const kind = model.real ? "real" : "fake";
  const seeds = seedsText(model.seedCount);
  const profiles = model.groups.map((g) => g.profile).join(" and ");
  return [
    `${taskText(model.task)} · ${kind} model · ${seeds} · failure profiles ${profiles}`,
    `${taskShort(model.task)} · ${kind} model · ${seeds} · ${profiles}`,
    `${taskShort(model.task)} · ${kind} model · ${seeds}`,
  ];
}

export function dotSummary(model: DotModel): string {
  const kind = model.real ? "real" : "fake";
  const parts = model.groups.map((g) => {
    const rows = g.rows.map((r) => `${r.label} ${dotValue("stall", r.meanStall)}${r.meanExtra === null || g.reference ? "" : ` and ${dotValue("extra", r.meanExtra)} extra cost`}`);
    return `${groupTitle(g, false)}: the mean over the seeds is ${rows.join("; ")}`;
  });
  const bad = model.invalid.length ? ` ${model.invalid.length} of the runs ${model.invalid.length === 1 ? "has" : "have"} a result that is not valid and ${model.invalid.length === 1 ? "is" : "are"} ringed.` : "";
  return `${taskText(model.task)} on the ${kind} model, ${seedsText(model.seedCount)}: one dot for each run, for stall time in seconds and for extra cost in percent. ${parts.join(". ")}.${bad}`;
}

// -- layout -------------------------------------------------------------------------------------

const PAD = 10;
const HEAD_H = 28;
const GROUP_H = 24;
const GROUP_GAP = 8;
const AXIS_H = 34;
const KEY_H = 20;
const CAP_H = 20;
const MEAN_W = 64;
const GAP_X = 28;
const GAP_Y = 14;
const MIN_ROW = 22;
const MAX_ROW = 52;
const LABEL_GAP = 8;

export interface DotPlace {
  runIndex: number;
  x: number;
  y: number;
}

export interface RowPlace {
  group: number;
  row: number;
  /** The centre of the row. */
  y: number;
  dots: DotPlace[];
  /** The ends of the range of the seeds and the mean, in x. Null where the row has no value here. */
  min: number | null;
  max: number | null;
  mean: number | null;
}

export interface DotPanel {
  metric: DotMetric;
  title: string;
  sub: string;
  /** The panel's own row labels (the stacked layout repeats them). */
  labels: boolean;
  labelX: number;
  left: number;
  right: number;
  meanX: number;
  headY: number;
  axisY: number;
  gridTop: number;
  gridBottom: number;
  ticks: { x: number; label: string; zero: boolean }[];
  xAt: Scale;
  groups: { group: number; y: number; title: string; rule: number }[];
  rows: RowPlace[];
  /** Where the reference group says the extra cost is 0 by definition. */
  notes: { group: number; x: number; y: number; text: string }[];
}

export interface DotLayout {
  width: number;
  height: number;
  stacked: boolean;
  names: Names;
  short: boolean;
  radius: number;
  panels: DotPanel[];
  /** The groups shown: the stacked layout on a narrow screen shows the first only. */
  shown: number;
  keyY: number;
  captionY: number;
  caption: string;
  key: { kind: "dot" | "mean" | "range" | "ring"; x: number; label: string }[];
}

const METRIC_INFO: Record<DotMetric, { title: string; sub: string; subShort: string }> = {
  stall: { title: "Stall time", sub: "seconds with no agent working", subShort: "seconds" },
  extra: { title: "Extra cost", sub: "% against the run with no failures", subShort: "% extra" },
};

function domainOf(model: DotModel, metric: DotMetric, groups: number): { min: number; max: number; step: number; values: number[] } {
  let lo = 0;
  let hi = 0;
  model.groups.slice(0, groups).forEach((g) => {
    for (const row of g.rows) {
      for (const run of row.runs) {
        const v = metric === "stall" ? run.stall : run.extra;
        if (v === null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  });
  return niceTicks(lo, hi, 4);
}

function keyFor(model: DotModel, short: boolean): DotLayout["key"] {
  const items: { kind: DotLayout["key"][number]["kind"]; label: string }[] = short
    ? [
        { kind: "dot", label: "run" },
        { kind: "mean", label: "mean" },
        { kind: "range", label: "range" },
      ]
    : [
        { kind: "dot", label: "one run (one seed)" },
        { kind: "mean", label: "mean of the seeds" },
        { kind: "range", label: "range of the seeds" },
      ];
  if (model.invalid.length) items.push({ kind: "ring", label: short ? "not valid" : "result not valid" });
  const out: DotLayout["key"] = [];
  let x = PAD;
  for (const item of items) {
    out.push({ ...item, x });
    x += 16 + textWidth(item.label) + 22;
  }
  return out;
}

export function dotLayout(model: DotModel, width: number, height: number, captions: readonly string[] = []): DotLayout {
  const caption = captions.find((c) => textWidth(c) <= width - 2 * PAD) ?? captions[captions.length - 1] ?? "";
  const foot = KEY_H + (caption ? CAP_H : 0);

  const labelWidth = (names: Names): number =>
    Math.ceil(Math.max(0, ...model.groups.flatMap((g) => g.rows.map((r) => textWidth(systemName(r.id, r.label, names))))));
  const wideTiers: { names: Names; min: number }[] = [
    { names: "full", min: 300 },
    { names: "short", min: 200 },
  ];
  const plotFor = (names: Names): number => (width - 2 * PAD - labelWidth(names) - LABEL_GAP - GAP_X - 2 * MEAN_W) / 2;
  const wide = wideTiers.find((t) => plotFor(t.names) >= t.min);
  const stacked = !wide;
  const names: Names = wide ? wide.names : "short";
  const short = stacked || width < 520;

  const rowCountOf = (groups: number): number => model.groups.slice(0, groups).reduce((n, g) => n + g.rows.length, 0);
  const total = model.groups.length;
  const area = height - 2 * PAD - foot;
  const blockFixed = (groups: number): number => HEAD_H + groups * GROUP_H + Math.max(0, groups - 1) * GROUP_GAP + AXIS_H;
  const rowFor = (groups: number): number => ((stacked ? (area - GAP_Y) / 2 : area) - blockFixed(groups)) / Math.max(1, rowCountOf(groups));
  let shown = total;
  while (shown > 1 && rowFor(shown) < MIN_ROW) shown -= 1;
  const rowH = Math.min(MAX_ROW, Math.max(16, rowFor(shown)));
  const radius = rowH >= 30 && model.seedCount <= 5 ? 5.5 : model.seedCount > 8 ? 3.5 : 4.5;

  const labelW = labelWidth(names);
  const metrics: DotMetric[] = ["stall", "extra"];
  const panels = metrics.map((metric, index): DotPanel => {
    const blockH = blockFixed(shown) + rowCountOf(shown) * rowH;
    const top = stacked ? PAD + index * (blockH + GAP_Y) : PAD;

    let left: number;
    let right: number;
    if (stacked) {
      left = PAD + labelW + LABEL_GAP;
      right = width - PAD - MEAN_W;
    } else {
      const plotW = plotFor(names);
      left = index === 0 ? PAD + labelW + LABEL_GAP : PAD + labelW + LABEL_GAP + plotW + MEAN_W + GAP_X;
      right = left + plotW;
    }
    const domain = domainOf(model, metric, shown);
    const xAt = linear(domain.min, domain.max, left, right);
    const info = METRIC_INFO[metric];

    // the groups and their rows, from the top
    let y = top + HEAD_H;
    const rows: RowPlace[] = [];
    const groups: DotPanel["groups"] = [];
    const notes: DotPanel["notes"] = [];
    model.groups.slice(0, shown).forEach((g, gi) => {
      if (gi > 0) y += GROUP_GAP;
      groups.push({ group: gi, y: y + GROUP_H / 2 + 2, title: groupTitle(g, short), rule: y });
      y += GROUP_H;
      const first = y;
      g.rows.forEach((row, ri) => {
        const cy = y + rowH / 2;
        const values = row.runs.map((r) => (metric === "stall" ? r.stall : r.extra));
        const hasAny = values.some((v) => v !== null) && !(metric === "extra" && g.reference);
        const dots = hasAny
          ? row.runs.flatMap((_, runIndex) => {
              const v = values[runIndex];
              return v === null || v === undefined ? [] : [{ runIndex, x: xAt(v), y: cy }];
            })
          : [];
        const xs = dots.map((d) => d.x);
        const m = metric === "stall" ? row.meanStall : row.meanExtra;
        rows.push({
          group: gi,
          row: ri,
          y: cy,
          dots,
          min: xs.length ? Math.min(...xs) : null,
          max: xs.length ? Math.max(...xs) : null,
          mean: hasAny && m !== null ? xAt(m) : null,
        });
        y += rowH;
      });
      if (metric === "extra" && g.reference) notes.push({ group: gi, x: (left + right) / 2, y: first + (g.rows.length * rowH) / 2, text: "0 by definition: the reference" });
    });

    const gridTop = top + HEAD_H;
    const gridBottom = y;
    return {
      metric,
      title: info.title,
      sub: textWidth(info.title, 13) + 8 + textWidth(info.sub) <= right - left + MEAN_W ? info.sub : info.subShort,
      labels: stacked || index === 0,
      labelX: PAD,
      left,
      right,
      meanX: right + MEAN_W,
      headY: top + 14,
      axisY: y + 2,
      gridTop,
      gridBottom,
      ticks: domain.values.map((v) => ({ x: xAt(v), label: tickLabel(v, domain.step), zero: v === 0 })),
      xAt,
      groups,
      rows,
      notes,
    };
  });

  return {
    width,
    height,
    stacked,
    names,
    short,
    radius,
    panels,
    shown,
    keyY: height - PAD - (caption ? CAP_H : 0) - 2,
    captionY: height - PAD - 2,
    caption,
    key: keyFor(model, short),
  };
}

/** The text of a run's tooltip: the run, and what it measured. */
export function runTip(model: DotModel, group: DotGroup, row: DotRow, run: DotRun, metric: DotMetric): string {
  const v = metric === "stall" ? run.stall : run.extra;
  const what = metric === "stall" ? "stall" : "extra cost";
  const invalid = run.valid === false ? "; the result is not valid" : "";
  return `${row.label}, ${groupTitle(group, false)}, seed ${run.seed}: ${what} ${v === null ? "none" : dotValue(metric, v)}${invalid} (${seedsText(model.seedCount)} in all)`;
}

// -- the draw ----------------------------------------------------------------------------------

export const DOT_KEYFRAMES = { axes: [0, 0.18], rows: [0.12, 0.86], means: [0.8, 1] } as const;
const ROW_SPAN = 0.22;

export interface DotFrame {
  axes: number;
  means: number;
  /** How far row i of n has come in: 0 not yet, 1 there. */
  row(i: number, n: number): number;
}

export function dotFrame(p: number): DotFrame {
  const k = DOT_KEYFRAMES;
  return {
    axes: smoothstep(span(p, k.axes[0], k.axes[1])),
    means: smoothstep(span(p, k.means[0], k.means[1])),
    row(i, n) {
      const start = n <= 1 ? k.rows[0] : k.rows[0] + ((k.rows[1] - k.rows[0] - ROW_SPAN) * i) / (n - 1);
      return span(p, start, start + ROW_SPAN);
    },
  };
}

export interface DotRig {
  axes: Pen<SVGGElement>[];
  means: Pen<SVGGElement>[];
  rows: { index: number; pen: Pen<SVGGElement> }[];
  dots: { row: number; pen: Pen<SVGGElement>; x: number; y: number }[];
  rowCount: number;
}

/** The pens of the parts that move; the rows are numbered in the order they come in, the groups of a panel after one another. */
export function collectDots(svg: SVGSVGElement, layout: DotLayout): DotRig {
  const all = <E extends Element>(selector: string): E[] => Array.from(svg.querySelectorAll<E>(selector));
  const rows = all<SVGGElement>("[data-row]").map((el) => ({ index: Number(el.getAttribute("data-row")), pen: new Pen(el) }));
  const dots = all<SVGGElement>("[data-dot]").map((el) => {
    // data-dot is "panel:row:dot", the row counted across the groups of the panel
    const [pi, flat, di] = (el.getAttribute("data-dot") ?? "0:0:0").split(":").map(Number) as [number, number, number];
    const place = layout.panels[pi]?.rows[flat]?.dots[di];
    return { row: flat, pen: new Pen(el), x: place?.x ?? 0, y: place?.y ?? 0 };
  });
  return {
    axes: all<SVGGElement>('[data-part="axes"]').map((el) => new Pen(el)),
    means: all<SVGGElement>('[data-part="means"]').map((el) => new Pen(el)),
    rows,
    dots,
    rowCount: layout.panels[0]?.rows.length ?? 0,
  };
}

export function paintDots(rig: DotRig, p: number): void {
  const f = dotFrame(p);
  for (const pen of rig.axes) pen.set("opacity", f.axes);
  for (const pen of rig.means) pen.set("opacity", f.means);
  for (const row of rig.rows) row.pen.set("opacity", f.row(row.index, rig.rowCount));
  for (const dot of rig.dots) {
    const t = easeOutCubic(f.row(dot.row, rig.rowCount));
    const scale = 0.4 + 0.6 * t;
    dot.pen.set("transform", `translate(${fx(dot.x)} ${fx(dot.y)}) scale(${fx(scale, 3)})`);
  }
}
