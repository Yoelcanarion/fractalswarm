import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import type { HeroSlice } from "../../data/types";
import { textWidth, withSign } from "./chart";
import { fakePen, lcg, seen, type Log } from "./fakes";
import {
  LEAD,
  LINE_KEYFRAMES,
  lineCaptions,
  lineFrame,
  lineLayout,
  lineModel,
  lineSummary,
  paintLine,
  shapeOf,
  type Emphasis,
  type LineLayout,
  type LinePoint,
  type LineRig,
} from "./line";
import { LineDraw } from "./LineDraw";

const data = story.hero;
const model = lineModel(data);
const captions = lineCaptions(model);

// What the tests below read comes from the data and none of it is typed here: a new reading changes the data and these follow it.
const EMPHASIS: Record<string, Emphasis> = { swarm: "swarm", central: "rival", "durable-max": "rival", durable: "quiet", pipeline: "quiet", single: "quiet" };
const pointsOf = (id: string) => data.series[id]!.points.slice().sort((a, b) => a.x - b.x);
const endOf = (id: string) => pointsOf(id)[pointsOf(id).length - 1]!;
const stallText = (id: string): string => `${endOf(id).stall_s.toFixed(1)} s`;
const extraText = (id: string): string => `${withSign(endOf(id).extra_cost_pct, 1)}%`;

describe("the hero chart's model", () => {
  it("keeps the series in the order of the slice, with the swarm the accent and the two rivals the claims name the strong ones", () => {
    expect(model.series.map((s) => s.id)).toEqual(data.order);
    const emphasis = Object.fromEntries(model.series.map((s) => [s.id, s.emphasis]));
    expect(emphasis).toEqual(Object.fromEntries(data.order.map((id) => [id, EMPHASIS[id]])));
    expect(emphasis["central"]).toBe("rival");
    expect(emphasis["durable-max"]).toBe("rival");
  });

  it("reads the numbers of the file as they are, at the points it has", () => {
    const xs = [...new Set(Object.values(data.series).flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    expect(model.xs).toEqual(xs);
    expect(model.profiles).toEqual(xs.map((x) => Object.values(data.series)[0]!.points.find((p) => p.x === x)!.profile));
    for (const s of model.series) {
      const points = pointsOf(s.id);
      expect(s.stall.map((p) => [p.x, p.profile, p.mean, p.min, p.max])).toEqual(points.map((p) => [p.x, p.profile, p.stall_s, p.stall_s_min, p.stall_s_max]));
      expect(s.extra.map((p) => [p.mean, p.min, p.max])).toEqual(points.map((p) => [p.extra_cost_pct, p.extra_cost_pct_min, p.extra_cost_pct_max]));
    }
    expect(model.seedCount).toBe(data.seedCount);
    expect(model.real).toBe(data.model === "real");
    expect(model.task).toBe(data.task);
  });

  it("draws the figures R5 quotes: the generator recomputes them from the same file, and the two agree", () => {
    const t2 = story.numbers.r5.t2;
    const swarm = model.series.find((s) => s.id === "swarm")!;
    const central = model.series.find((s) => s.id === "central")!;
    const end = (s: typeof swarm, key: "stall" | "extra"): number => Number(s[key][s[key].length - 1]!.mean.toFixed(1));
    expect([end(swarm, "stall"), end(central, "stall")]).toEqual([t2.swarmStallS, t2.centralStallS]);
    expect([end(swarm, "extra"), end(central, "extra")]).toEqual([t2.swarmExtraPct, t2.centralExtraPct]);
    expect(data.seedCount).toBe(t2.seeds);
  });

  it("names its setting, in the long form when it fits and shorter when it does not", () => {
    expect(captions[0]).toBe(`T2 conference · real model · ${data.seedCount} seeds · lines: the mean of the seeds · band: their range, FractalSwarm only`);
    expect(captions[2]).toBe(`T2 · real model · ${data.seedCount} seeds`);
  });

  it("tells the numbers in its text alternative, with the rival named as the in-process supervisor", () => {
    const text = lineSummary(model);
    expect(text).toContain(`FractalSwarm ${stallText("swarm")}`);
    expect(text).toContain(`In-process supervisor ${stallText("central")}`);
    expect(text).toContain(`In-process supervisor ${extraText("central")}`);
    expect(text).toContain(`Ideal durable supervisor ${extraText("durable-max")}`);
    expect(text).toContain(`T2 conference on the real model, ${data.seedCount} seeds`);
    expect(text).not.toMatch(/\b(simpler|cheaper|more reliable|first|better|worse)\b/i);
  });

  it("copes with a slice whose order lists a series that is not there", () => {
    const odd: HeroSlice = { ...data, order: ["swarm", "ghost", "central"] };
    // the series the order names come first, then the others by name
    const rest = Object.keys(data.series).filter((id) => id !== "swarm" && id !== "central").sort();
    expect(lineModel(odd).series.map((s) => s.id)).toEqual(["swarm", "central", ...rest]);
  });
});

/** A slice with a point at each of the slice's x (the four failure profiles of an older reading), with numbers made up. */
function synthetic(next: () => number): HeroSlice {
  const series: HeroSlice["series"] = {};
  for (const id of data.order) {
    series[id] = {
      label: data.series[id]!.label,
      points: data.x.map((x, i) => {
        const stall = next() * 300;
        const extra = (next() - 0.35) * 150;
        return {
          x,
          profile: `C${i}`,
          stall_s: stall,
          stall_s_min: stall * 0.6,
          stall_s_max: stall * 1.4,
          extra_cost_pct: extra,
          extra_cost_pct_min: extra - 10,
          extra_cost_pct_max: extra + 10,
          cost_usd: 0.3,
          completion_rate: 100,
          seeds: ["1", "2"],
        };
      }),
    };
  }
  return { ...data, series };
}

const SIZES: [number, number][] = [
  [1480, 520],
  [1224, 415],
  [1000, 420],
  [820, 460],
  [700, 456],
  [390, 456],
  [350, 456],
];

function checkLayout(layout: LineLayout, label: string, m = model): void {
  expect(layout.panels, label).toHaveLength(2);
  for (const panel of layout.panels) {
    // the panel is inside the box, the plot inside the panel
    expect(panel.x, label).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.w, label).toBeLessThanOrEqual(layout.width + 0.001);
    expect(panel.y, label).toBeGreaterThanOrEqual(0);
    expect(panel.left, label).toBeGreaterThan(panel.x);
    expect(panel.right, label).toBeGreaterThan(panel.left + 60);
    expect(panel.bottom - panel.top, label).toBeGreaterThanOrEqual(89.999);
    // every mark is on the plot
    for (const s of m.series) {
      const shape = shapeOf(s, panel);
      for (const d of shape.dots) {
        expect(d.x, `${label} ${s.id} x`).toBeGreaterThanOrEqual(panel.left - 0.001);
        expect(d.x, `${label} ${s.id} x`).toBeLessThanOrEqual(panel.right + 0.001);
        expect(d.y, `${label} ${s.id} y`).toBeGreaterThanOrEqual(panel.top - 0.001);
        expect(d.y, `${label} ${s.id} y`).toBeLessThanOrEqual(panel.bottom + 0.001);
      }
    }
    // the labels sit apart, inside the plot's height, and inside the panel's width
    const sizes = panel.labels.map((l) => (l.lines.length === 2 ? 30 : 15));
    const order = panel.labels.map((_, i) => i).sort((a, b) => panel.labels[a]!.y - panel.labels[b]!.y);
    order.slice(1).forEach((i, k) => {
      const j = order[k]!;
      expect(panel.labels[i]!.y - panel.labels[j]!.y, `${label} labels ${j}/${i}`).toBeGreaterThanOrEqual((sizes[i]! + sizes[j]!) / 2 + 2 - 0.001);
    });
    panel.labels.forEach((l, i) => {
      expect(l.y - sizes[i]! / 2, label).toBeGreaterThanOrEqual(panel.top - 0.001);
      expect(l.y + sizes[i]! / 2, label).toBeLessThanOrEqual(panel.y + panel.h + 0.001);
      for (const line of l.lines) expect(panel.right + LEAD + textWidth(line), `${label} "${line}"`).toBeLessThanOrEqual(panel.x + panel.w + 0.001);
    });
  }
  if (layout.caption) expect(textWidth(layout.caption), label).toBeLessThanOrEqual(layout.width - 20);
}

describe("the hero chart's layout", () => {
  for (const [width, height] of SIZES) {
    it(`${width}x${height}: everything is inside its box and nothing sits on anything else`, () => {
      checkLayout(lineLayout(model, width, height, captions), `${width}x${height}`);
    });
  }

  it("puts the two panels side by side with the claims' names where there is room, and stacks them with short names where there is not", () => {
    const wide = lineLayout(model, 1480, 520, captions);
    expect([wide.stacked, wide.names]).toEqual([false, "full"]);
    expect(wide.panels[0]!.x + wide.panels[0]!.w).toBeLessThan(wide.panels[1]!.x);
    const narrow = lineLayout(model, 350, 456, captions);
    expect([narrow.stacked, narrow.names]).toEqual([true, "short"]);
    expect(narrow.panels[0]!.y + narrow.panels[0]!.h).toBeLessThanOrEqual(narrow.panels[1]!.y);
    expect(narrow.panels[1]!.y + narrow.panels[1]!.h).toBeLessThanOrEqual(456 + 0.001);
    const labels = wide.panels[0]!.labels.map((l) => l.lines[0]);
    expect(labels).toContain("In-process supervisor");
    expect(labels).toContain("Ideal durable supervisor");
    expect(narrow.panels[0]!.labels.map((l) => l.lines[0])).toContain("Ideal durable");
  });

  it("scales the axes to the data: stall from zero, extra cost across zero, both on whole steps", () => {
    const [stall, extra] = lineLayout(model, 1480, 520, captions).panels;
    // the highest and the lowest value drawn: a mean, and the swarm's range too
    const spread = (key: "stall" | "extra", pick: (p: LinePoint) => number, best: typeof Math.max): number =>
      best(...model.series.flatMap((s) => s[key].map((p) => (s.emphasis === "swarm" ? pick(p) : p.mean))));
    expect(stall!.yTicks[0]!.zero).toBe(true);
    expect(stall!.yAt(0)).toBeCloseTo(stall!.bottom, 6);
    expect(stall!.yAt(spread("stall", (p) => p.max, Math.max))).toBeGreaterThanOrEqual(stall!.top - 0.001);
    expect(extra!.zeroY).not.toBeNull();
    expect(extra!.yAt(spread("extra", (p) => p.max, Math.max))).toBeGreaterThanOrEqual(extra!.top - 0.001);
    expect(extra!.yAt(spread("extra", (p) => p.min, Math.min))).toBeLessThanOrEqual(extra!.bottom + 0.001);
    for (const panel of [stall!, extra!]) for (const t of panel.yTicks) expect(t.label, `${panel.metric.key} tick`).toMatch(/^−?\d+( s|%)?$/);
    // the x axis has a tick for each place the data has a point
    expect(stall!.xTicks.map((t) => [t.count, t.profile])).toEqual(model.xs.map((x, i) => [String(x), model.profiles[i]]));
  });

  it("is a true scale in x when the data has points between: 1 to 3 killed is twice the distance of 0 to 1", () => {
    const four = lineModel(synthetic(lcg(7)));
    expect(four.xs).toEqual(data.x);
    const xs = lineLayout(four, 1480, 520, lineCaptions(four)).panels[0]!.xTicks.map((t) => t.x);
    expect((xs[2]! - xs[1]!) / (xs[1]! - xs[0]!)).toBeCloseTo(2, 9);
  });

  it("labels each system at the end of its line with the value at C3 for the three the claims name", () => {
    const [stall, extra] = lineLayout(model, 1480, 520, captions).panels;
    const text = (panel: typeof stall, id: string): string[] => panel!.labels[model.series.findIndex((s) => s.id === id)]!.lines;
    expect(text(stall, "swarm")).toEqual(["FractalSwarm", stallText("swarm")]);
    expect(text(stall, "central")).toEqual(["In-process supervisor", stallText("central")]);
    expect(text(stall, "durable-max")).toEqual(["Ideal durable supervisor", stallText("durable-max")]);
    expect(text(extra, "swarm")).toEqual(["FractalSwarm", extraText("swarm")]);
    expect(text(extra, "central")).toEqual(["In-process supervisor", extraText("central")]);
    expect(text(extra, "durable-max")).toEqual(["Ideal durable supervisor", extraText("durable-max")]);
    expect(text(stall, "durable")).toEqual(["Realistic durable"]);
  });

  it("holds for any numbers, not only these", () => {
    const next = lcg(3);
    for (let round = 0; round < 60; round++) {
      const odd = lineModel(synthetic(next));
      const [width, height] = SIZES[round % SIZES.length]!;
      checkLayout(lineLayout(odd, width, height, lineCaptions(odd)), `random ${round} ${width}x${height}`, odd);
    }
  });
});

describe("the draw", () => {
  const stages: (keyof ReturnType<typeof lineFrame>)[] = ["axes", "quiet", "rival", "swarm", "labels"];

  it("is empty at the start and complete at the end, and never goes back while it plays", () => {
    const first = lineFrame(0);
    const final = lineFrame(1);
    for (const s of stages) {
      expect(first[s], s).toBe(0);
      expect(final[s], s).toBe(1);
    }
    let before = lineFrame(0);
    for (let i = 1; i <= 1000; i++) {
      const f = lineFrame(i / 1000);
      for (const s of stages) expect(f[s], `${s} at ${i / 1000}`).toBeGreaterThanOrEqual(before[s] - 1e-12);
      before = f;
    }
  });

  it("draws the axes first, the quiet lines, then the two rivals, then the swarm last, and the names at the end", () => {
    const k = LINE_KEYFRAMES;
    expect(lineFrame(k.axes[1]).axes).toBe(1);
    expect(lineFrame(k.quiet[0]).quiet).toBe(0);
    expect(lineFrame(k.rival[0]).rival).toBe(0);
    expect(lineFrame(k.swarm[0]).swarm).toBe(0);
    expect(lineFrame(k.swarm[0] - 0.001).swarm).toBe(0);
    expect(lineFrame(0.4).quiet).toBeGreaterThan(lineFrame(0.4).rival);
    expect(lineFrame(0.6).rival).toBeGreaterThan(lineFrame(0.6).swarm);
    expect(lineFrame(k.labels[0]).labels).toBe(0);
    expect(k.labels[0]).toBeGreaterThan(k.rival[1]);
    expect(k.swarm[1]).toBeLessThanOrEqual(k.labels[1]);
    expect(k.axes[0]).toBe(0);
    expect(k.labels[1]).toBe(1);
  });

  const layout = lineLayout(model, 1480, 520, captions);
  const log: Log = new Map();
  const rig: LineRig = {
    axes: layout.panels.map(() => fakePen<SVGGElement>(log)),
    labels: layout.panels.map(() => fakePen<SVGGElement>(log)),
    wipes: layout.panels.flatMap((_, panel) => (["quiet", "rival", "swarm"] as Emphasis[]).map((group) => ({ panel, group, pen: fakePen<SVGRectElement>(log) }))),
  };

  it("paints nothing at 0 and everything at 1, each wipe about the left edge of its own plot", () => {
    paintLine(rig, layout, 0);
    for (const pen of [...rig.axes, ...rig.labels]) expect(Number(seen(log, pen)["opacity"])).toBe(0);
    for (const w of rig.wipes) expect(seen(log, w.pen)["transform"]).toMatch(/scale\(0\.0000 1\)/);
    paintLine(rig, layout, 1);
    for (const pen of [...rig.axes, ...rig.labels]) expect(Number(seen(log, pen)["opacity"])).toBe(1);
    for (const w of rig.wipes) {
      const left = layout.panels[w.panel]!.left;
      expect(seen(log, w.pen)["transform"]).toBe(`translate(${left.toFixed(2)} 0) scale(1.0000 1) translate(${(-left).toFixed(2)} 0)`);
    }
  });

  it("writes finite numbers all the way through", () => {
    for (let i = 0; i <= 600; i++) {
      paintLine(rig, layout, i / 600);
      for (const store of log.values()) for (const [name, value] of Object.entries(store)) expect(value, name).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe("LineDraw markup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const html = renderToStaticMarkup(createElement(LineDraw, { progress: motionValue(0), data, still: true }));

  it("draws every system in both panels, a mark for each point, and a tooltip on each", () => {
    const marks = model.series.reduce((n, s) => n + s.stall.length, 0) * 2;
    expect(html.match(/class="hv-ld-series"/g)).toHaveLength(model.series.length * 2);
    expect(html.match(/class="hv-ld-mark"/g)).toHaveLength(marks);
    expect(html.match(/<title>/g)).toHaveLength(marks);
    expect(html.match(/data-wipe="/g)).toHaveLength(6);
    const swarm = endOf("swarm");
    expect(html).toContain(
      `FractalSwarm, ${swarm.x} coordinators killed (${swarm.profile}): ${stallText("swarm")}, range ${swarm.stall_s_min.toFixed(1)} to ${swarm.stall_s_max.toFixed(1)} over ${data.seedCount} seeds`,
    );
    expect(html).toContain(`In-process supervisor, ${swarm.x} coordinators killed (${swarm.profile}): ${extraText("central")}`);
  });

  it("is an image with a text alternative, and the same numbers as two tables", () => {
    const central = endOf("central");
    expect(html).toContain('role="img"');
    expect(html).toContain("two charts, one of stall time in seconds and one of extra cost in percent");
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain(`<caption>Stall time, in seconds: the mean over ${data.seedCount} seeds, with the lowest and highest seed</caption>`);
    expect(html).toContain(`${stallText("central")} (${central.stall_s_min.toFixed(1)} to ${central.stall_s_max.toFixed(1)})`);
    expect(html).toContain("0 killed (C0)");
  });

  it("names its setting under the chart, unless the page prints it itself", () => {
    expect(html).toContain("T2 conference");
    expect(html).toContain("real model");
    expect(html).toContain(`${data.seedCount} seeds`);
    const quiet = renderToStaticMarkup(createElement(LineDraw, { progress: motionValue(0), data, still: true, setting: false }));
    expect(quiet).not.toContain("hv-ch-caption");
  });

  it("has no number that is not a number and no word the claims do not allow", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
    expect(html).not.toMatch(/\b(simpler|cheaper|more reliable)\b/i);
  });
});
