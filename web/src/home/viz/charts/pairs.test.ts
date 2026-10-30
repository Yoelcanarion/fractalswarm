import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import type { VerdictsSlice } from "../../data/types";
import { textWidth } from "./chart";
import { fakePen, seen, type Log } from "./fakes";
import {
  PAIR_KEYFRAMES,
  barPath,
  pairCaptions,
  pairFrame,
  pairLayout,
  pairModel,
  pairSummary,
  paintPairs,
  valueText,
  type PairLayout,
  type PairRig,
} from "./pairs";
import { PairedBars } from "./PairedBars";

const data = story.verdicts!;
const model = pairModel(data);
const captions = pairCaptions(model);

describe("the paired bars' model", () => {
  it("holds the swarm against the ideal durable supervisor on the three measures of locality, in the order of the pre-registration", () => {
    expect(model.rows.map((r) => [r.hypothesis, r.metric])).toEqual([
      ["H4a", "cdt_s"],
      ["H4b", "blast_sessions_mean_pct"],
      ["H4c", "idle_agent_s"],
    ]);
    expect(model.rival).toBe("durable-max");
    expect(model.rivalLabel).toBe("Ideal durable supervisor");
    expect(model.rows.map((r) => r.name)).toEqual(["Coordinator-dependency time", "Blast radius", "Idle agent-seconds"]);
  });

  it("reads the figures R4 quotes: 6.94 against 22.27 s, 6.67 against 23.33%, 7.18 against 24.38, and the ratios 0.31, 0.29 and 0.29", () => {
    expect(model.rows.map((r) => [r.swarm, r.rival])).toEqual([
      [6.942, 22.273],
      [6.667, 23.333],
      [7.177, 24.381],
    ]);
    expect(model.rows.map((r) => r.fraction.toFixed(2))).toEqual(["0.31", "0.29", "0.29"]);
    expect(model.rows.map((r) => [valueText(r, r.swarm), valueText(r, r.rival)])).toEqual([
      ["6.9 s", "22.3 s"],
      ["6.7%", "23.3%"],
      ["7.2", "24.4"],
    ]);
  });

  it("takes the verdicts as the generator copied them from the pre-registered rule, and the other rival's beside them", () => {
    expect(model.rows.map((r) => [r.verdict, r.mixed])).toEqual([["win", false], ["win", false], ["win", false]]);
    expect(model.rows.map((r) => r.other?.verdict)).toEqual(["win", "win", "win"]);
    expect(model.rows.map((r) => r.other?.ratio)).toEqual([0.143, 0.171, 0.13]);
  });

  it("names its setting from the data: T2, the real model, 3 seeds, C3", () => {
    expect([model.task, model.real, model.profile, model.seeds]).toEqual(["t2_conference", true, "C3", ["1", "2", "3"]]);
    expect(captions[0]).toBe("T2 conference · failure profile C3 · real model · 3 seeds · means of the seeds; verdicts by the pre-registered per-seed rule");
    expect(captions[2]).toBe("T2 · C3 · real model · 3 seeds");
  });

  it("says nothing of the model when the data does not, and never makes it up", () => {
    const bare: VerdictsSlice = { ...data, task: undefined, model: undefined, real: undefined };
    const m = pairModel(bare);
    expect([m.task, m.real]).toEqual([null, null]);
    expect(pairCaptions(m)[2]).toBe("C3 · 3 seeds");
  });

  it("lets the axis run on when the swarm's bar is the longer, and marks a verdict whose seeds disagree", () => {
    const odd: VerdictsSlice = {
      ...data,
      comparisons: data.comparisons.map((c) => (c.rival === "durable-max" && c.hypothesis === "H4b" ? { ...c, swarm: 40, verdict: "loss", mixed: true } : c)),
    };
    const m = pairModel(odd);
    expect(m.domainMax).toBe(2);
    expect(m.rows[1]!.fraction).toBeCloseTo(40 / 23.333, 3);
    const layout = pairLayout(m, 1100, 420, pairCaptions(m));
    expect(layout.groups[1]!.swarm.w).toBeGreaterThan(layout.groups[1]!.rival.w);
    expect(layout.ticks.map((t) => t.label)).toEqual(["0%", "50%", "100%", "150%", "200%"]);
    expect(layout.groups[1]!.pill.text).toBe("loss*");
  });

  it("tells the figures in its text alternative, the verdicts as the rule gave them, and nothing the claims do not say", () => {
    const text = pairSummary(model);
    expect(text).toContain("Coordinator-dependency time: FractalSwarm 6.9 s against Ideal durable supervisor 22.3 s, 31% of it, verdict win");
    expect(text).toContain("Blast radius: FractalSwarm 6.7% against Ideal durable supervisor 23.3%, 29% of it, verdict win");
    expect(text).toContain("T2 conference on the real model, 3 seeds, failure profile C3");
    expect(text).not.toMatch(/\b(simpler|cheaper|more reliable|better|worse)\b/i);
  });
});

describe("barPath", () => {
  it("is nothing before it has length, a square end on the baseline and a round one on the value after", () => {
    expect(barPath(10, 5, 0.2, 20)).toBe("");
    expect(barPath(10, 5, 100, 20)).toBe("M10.00 5.00H106.00A4.00 4.00 0 0 1 110.00 9.00V21.00A4.00 4.00 0 0 1 106.00 25.00H10.00Z");
    // a bar shorter than its own rounding rounds to its length
    expect(barPath(0, 0, 3, 20)).toContain("A3.00 3.00");
  });
});

const SIZES: [number, number][] = [
  [1480, 460],
  [1224, 353],
  [1000, 400],
  [820, 420],
  [600, 388],
  [390, 388],
  [350, 388],
];

function checkLayout(layout: PairLayout, label: string, m = model): void {
  expect(layout.barH, label).toBeGreaterThanOrEqual(12);
  expect(layout.barH, label).toBeLessThanOrEqual(24);
  expect(layout.groups, label).toHaveLength(m.rows.length);
  layout.groups.forEach((g, i) => {
    const row = m.rows[i]!;
    // the bars are in the box, the rival's the whole length, the swarm's its part of it
    for (const bar of [g.swarm, g.rival]) {
      expect(bar.x, label).toBeCloseTo(layout.x0, 6);
      expect(bar.x + bar.w, label).toBeLessThanOrEqual(layout.x1 + 0.001);
      expect(bar.y + bar.h, label).toBeLessThanOrEqual(layout.height);
    }
    expect(g.rival.w, label).toBeCloseTo(layout.xAt(1) - layout.x0, 6);
    expect(g.swarm.w / g.rival.w, label).toBeCloseTo(row.fraction, 6);
    // the values sit at the end of their bars, inside the box
    for (const [bar, v] of [[g.swarm, row.swarm], [g.rival, row.rival]] as const) {
      expect(bar.x + bar.w + 8 + textWidth(valueText(row, v)), `${label} value`).toBeLessThanOrEqual(layout.width - 10 + 0.001);
    }
    // the title and the verdict do not meet
    const title = textWidth(row.name, 13) + 8 + textWidth(row.sub);
    expect(layout.labelX + title, `${label} title`).toBeLessThanOrEqual(g.pill.x - 6);
    expect(g.pill.x + g.pill.w, label).toBeLessThanOrEqual(layout.width - 10 + 0.001);
    // each group clears the next
    const next = layout.groups[i + 1];
    if (next) expect(g.rival.y + g.rival.h, label).toBeLessThan(next.titleY - 8);
    // the bars' names fit their column
    expect(layout.labelX + textWidth(layout.names === "full" ? "Ideal durable supervisor" : "FractalSwarm"), label).toBeLessThanOrEqual(layout.x0);
  });
  expect(layout.axisY, label).toBeGreaterThan(layout.groups[layout.groups.length - 1]!.rival.y + layout.barH);
  expect(layout.axisY + 24, label).toBeLessThanOrEqual(layout.keyY);
  expect(layout.halfX, label).toBeCloseTo((layout.xAt(0) + layout.xAt(1)) / 2, 6);
  expect(layout.x1 - layout.x0, label).toBeGreaterThanOrEqual(150);
  if (layout.caption) expect(textWidth(layout.caption), label).toBeLessThanOrEqual(layout.width - 20);
  expect(layout.x0 + 30 + textWidth(layout.key), label).toBeLessThanOrEqual(layout.width - 10);
}

describe("the paired bars' layout", () => {
  for (const [width, height] of SIZES) {
    it(`${width}x${height}: everything is inside its box and nothing sits on anything else`, () => {
      checkLayout(pairLayout(model, width, height, captions), `${width}x${height}`);
    });
  }

  it("names the bars in full where there is room and short where there is not, and draws the line the rule draws at half", () => {
    expect(pairLayout(model, 1480, 460, captions).names).toBe("full");
    expect(pairLayout(model, 350, 388, captions).names).toBe("short");
    const l = pairLayout(model, 1000, 400, captions);
    expect(l.ticks.map((t) => t.label)).toEqual(["0%", "50%", "100%"]);
    expect(l.halfX).toBeCloseTo(l.x0 + (l.x1 - l.x0) / 2, 6);
    // the swarm's bars end before the line: that is what a win is, drawn
    for (const g of l.groups) expect(g.swarm.x + g.swarm.w).toBeLessThan(l.halfX);
  });
});

describe("the draw", () => {
  it("brings the rival's bars first, the swarm's after, the numbers last, each measure a little after the one before", () => {
    const k = PAIR_KEYFRAMES;
    const start = pairFrame(0);
    const end = pairFrame(1);
    for (const g of [0, 1, 2]) {
      expect([start.rival(g, 3), start.swarm(g, 3)]).toEqual([0, 0]);
      expect([end.rival(g, 3), end.swarm(g, 3)]).toEqual([1, 1]);
    }
    expect([start.axes, start.labels, end.axes, end.labels]).toEqual([0, 0, 1, 1]);
    const mid = pairFrame(0.4);
    expect(mid.rival(0, 3)).toBeGreaterThan(mid.swarm(0, 3));
    expect(mid.rival(0, 3)).toBeGreaterThan(mid.rival(2, 3));
    expect(k.labels[0]).toBeGreaterThanOrEqual(k.swarm[1] - 0.05);
    let before = pairFrame(0);
    for (let i = 1; i <= 800; i++) {
      const f = pairFrame(i / 800);
      for (const g of [0, 1, 2]) {
        expect(f.rival(g, 3)).toBeGreaterThanOrEqual(before.rival(g, 3) - 1e-12);
        expect(f.swarm(g, 3)).toBeGreaterThanOrEqual(before.swarm(g, 3) - 1e-12);
      }
      before = f;
    }
  });

  const layout = pairLayout(model, 1100, 420, captions);
  const log: Log = new Map();
  const rig: PairRig = {
    axes: [fakePen<SVGGElement>(log)],
    labels: [fakePen<SVGGElement>(log)],
    rival: layout.groups.map(() => fakePen<SVGPathElement>(log)),
    swarm: layout.groups.map(() => fakePen<SVGPathElement>(log)),
  };

  it("draws no bar at the start and the whole bars at the end", () => {
    paintPairs(rig, layout, 0);
    for (const pen of [...rig.rival, ...rig.swarm]) expect(seen(log, pen)["d"]).toBe("");
    expect(Number(seen(log, rig.labels[0])["opacity"])).toBe(0);
    paintPairs(rig, layout, 1);
    layout.groups.forEach((g, i) => {
      expect(seen(log, rig.rival[i])["d"]).toBe(barPath(g.rival.x, g.rival.y, g.rival.w, g.rival.h));
      expect(seen(log, rig.swarm[i])["d"]).toBe(barPath(g.swarm.x, g.swarm.y, g.swarm.w, g.swarm.h));
    });
    expect(Number(seen(log, rig.labels[0])["opacity"])).toBe(1);
  });

  it("writes finite numbers all the way through", () => {
    for (let i = 0; i <= 400; i++) {
      paintPairs(rig, layout, i / 400);
      for (const store of log.values()) for (const [name, value] of Object.entries(store)) expect(value, name).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe("PairedBars markup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const html = renderToStaticMarkup(createElement(PairedBars, { progress: motionValue(0), data, still: true }));

  it("draws a pair of bars for each measure, with the values and the verdict of each", () => {
    expect(html.match(/data-bar="rival"/g)).toHaveLength(3);
    expect(html.match(/data-bar="swarm"/g)).toHaveLength(3);
    expect(html.match(/class="hv-pb-pill"/g)).toHaveLength(3);
    expect(html).toContain(">6.9 s<");
    expect(html).toContain(">22.3 s<");
    expect(html).toContain(">win<");
    expect(html).toContain("FractalSwarm, Coordinator-dependency time: 6.9 s, 31% of the ideal durable supervisor&#x27;s 22.3 s");
  });

  it("is an image with a text alternative, and the same figures as a table with both rivals", () => {
    expect(html).toContain('role="img"');
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain("<th scope=\"col\">Realistic durable supervisor</th>");
    expect(html).toContain("Coordinator-dependency time (H4a, seconds)");
  });

  it("names its setting, the half line in its key, and lets a page that prints the setting itself turn it off", () => {
    expect(html).toContain("T2 conference");
    expect(html).toContain("real model");
    expect(html).toContain("3 seeds");
    expect(html).toContain("half of the ideal durable supervisor&#x27;s value");
    expect(renderToStaticMarkup(createElement(PairedBars, { progress: motionValue(0), data, still: true, setting: false }))).not.toContain("hv-ch-caption");
  });

  it("can be held against the other rival", () => {
    const out = renderToStaticMarkup(createElement(PairedBars, { progress: motionValue(0), data, still: true, rival: "durable" }));
    expect(out).toContain("Realistic durable supervisor");
    expect(out).toContain(">48.6 s<");
  });

  it("has no number that is not a number", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});
