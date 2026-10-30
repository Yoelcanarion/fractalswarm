import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import type { HeroSlice } from "../../data/types";
import { textWidth } from "./chart";
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
  type LineRig,
} from "./line";
import { LineDraw } from "./LineDraw";

const data = story.hero;
const model = lineModel(data);
const captions = lineCaptions(model);

describe("the hero chart's model", () => {
  it("keeps the series in the order of the slice, with the swarm the accent and the two rivals the claims name the strong ones", () => {
    expect(model.series.map((s) => s.id)).toEqual(data.order);
    const emphasis = Object.fromEntries(model.series.map((s) => [s.id, s.emphasis]));
    expect(emphasis).toEqual({ swarm: "swarm", central: "rival", "durable-max": "rival", durable: "quiet", pipeline: "quiet", single: "quiet" });
  });

  it("reads the numbers of the file as they are", () => {
    expect(model.xs).toEqual([0, 1, 3, 5]);
    expect(model.profiles).toEqual(["C0", "C1", "C2", "C3"]);
    const swarm = model.series[0]!;
    expect(swarm.stall[3]).toMatchObject({ x: 5, profile: "C3", mean: 14.578, min: 5.64, max: 23.516 });
    expect(swarm.extra[3]).toMatchObject({ mean: 6.56, min: -6.01, max: 19.12 });
    const central = model.series.find((s) => s.id === "central")!;
    expect(central.stall[3]!.mean).toBe(92.585);
    expect(central.extra[3]!.mean).toBe(75.62);
    expect(model.seedCount).toBe(2);
    expect(model.real).toBe(true);
    expect(model.task).toBe("t2_conference");
  });

  it("names its setting, in the long form when it fits and shorter when it does not", () => {
    expect(captions[0]).toBe("T2 conference · real model · 2 seeds · lines: the mean of the seeds · band: their range, FractalSwarm only");
    expect(captions[2]).toBe("T2 · real model · 2 seeds");
  });

  it("tells the numbers in its text alternative, with the rival named as the in-process supervisor", () => {
    const text = lineSummary(model);
    expect(text).toContain("FractalSwarm 14.6 s");
    expect(text).toContain("In-process supervisor 92.6 s");
    expect(text).toContain("In-process supervisor +75.6%");
    expect(text).toContain("Ideal durable supervisor −6.8%");
    expect(text).toContain("T2 conference on the real model, 2 seeds");
    expect(text).not.toMatch(/\b(simpler|cheaper|more reliable|first|better|worse)\b/i);
  });

  it("copes with a slice whose order lists a series that is not there", () => {
    const odd: HeroSlice = { ...data, order: ["swarm", "ghost", "central"] };
    // the series the order names come first, then the others by name
    expect(lineModel(odd).series.map((s) => s.id)).toEqual(["swarm", "central", "durable", "durable-max", "pipeline", "single"]);
  });
});

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
    expect(stall!.yTicks.map((t) => t.label)).toEqual(["0", "50", "100", "150", "200 s"]);
    expect(extra!.yTicks.map((t) => t.label)).toEqual(["−20", "0", "20", "40", "60", "80%"]);
    expect(extra!.zeroY).not.toBeNull();
    expect(stall!.yTicks[0]!.zero).toBe(true);
    expect(stall!.xTicks.map((t) => [t.count, t.profile])).toEqual([["0", "C0"], ["1", "C1"], ["3", "C2"], ["5", "C3"]]);
    // the x axis is a true scale: 1 to 3 killed is twice the distance of 0 to 1
    const xs = stall!.xTicks.map((t) => t.x);
    expect((xs[2]! - xs[1]!) / (xs[1]! - xs[0]!)).toBeCloseTo(2, 9);
  });

  it("labels each system at the end of its line with the value at C3 for the three the claims name", () => {
    const [stall, extra] = lineLayout(model, 1480, 520, captions).panels;
    const text = (panel: typeof stall, id: string): string[] => panel!.labels[model.series.findIndex((s) => s.id === id)]!.lines;
    expect(text(stall, "swarm")).toEqual(["FractalSwarm", "14.6 s"]);
    expect(text(stall, "central")).toEqual(["In-process supervisor", "92.6 s"]);
    expect(text(stall, "durable-max")).toEqual(["Ideal durable supervisor", "9.8 s"]);
    expect(text(extra, "swarm")).toEqual(["FractalSwarm", "+6.6%"]);
    expect(text(extra, "central")).toEqual(["In-process supervisor", "+75.6%"]);
    expect(text(extra, "durable-max")).toEqual(["Ideal durable supervisor", "−6.8%"]);
    expect(text(stall, "single")).toEqual(["Single agent"]);
    expect(text(stall, "durable")).toEqual(["Realistic durable"]);
  });

  it("holds for any numbers, not only these", () => {
    const next = lcg(3);
    for (let round = 0; round < 60; round++) {
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
      const odd = lineModel({ ...data, series });
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
    expect(html.match(/class="hv-ld-series"/g)).toHaveLength(12);
    expect(html.match(/class="hv-ld-mark"/g)).toHaveLength(48);
    expect(html.match(/<title>/g)).toHaveLength(48);
    expect(html.match(/data-wipe="/g)).toHaveLength(6);
    expect(html).toContain("FractalSwarm, 5 coordinators killed (C3): 14.6 s, range 5.6 to 23.5 over 2 seeds");
    expect(html).toContain("In-process supervisor, 5 coordinators killed (C3): +75.6%");
  });

  it("is an image with a text alternative, and the same numbers as two tables", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain("two charts, one of stall time in seconds and one of extra cost in percent");
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain("<caption>Stall time, in seconds: the mean over 2 seeds, with the lowest and highest seed</caption>");
    expect(html).toContain("92.6 s (83.4 to 101.8)");
    expect(html).toContain("0 killed (C0)");
  });

  it("names its setting under the chart, unless the page prints it itself", () => {
    expect(html).toContain("T2 conference");
    expect(html).toContain("real model");
    expect(html).toContain("2 seeds");
    const quiet = renderToStaticMarkup(createElement(LineDraw, { progress: motionValue(0), data, still: true, setting: false }));
    expect(quiet).not.toContain("hv-ch-caption");
  });

  it("has no number that is not a number and no word the claims do not allow", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
    expect(html).not.toMatch(/\b(simpler|cheaper|more reliable)\b/i);
  });
});
