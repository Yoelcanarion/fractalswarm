import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import type { HeadlineSlice } from "../../data/types";
import { textWidth, withSign } from "./chart";
import {
  DOT_KEYFRAMES,
  dotCaptions,
  dotFrame,
  dotLayout,
  dotModel,
  dotSummary,
  dotValue,
  groupTitle,
  paintDots,
  TIE_SYSTEMS,
  type DotLayout,
  type DotRig,
} from "./dots";
import { DotPlot } from "./DotPlot";
import { fakePen, lcg, seen, type Log } from "./fakes";
import { LABELS, systemName } from "./names";

const data = story.headline!;
const model = dotModel(data);
const captions = dotCaptions(model);

// What the tests below read comes from the data and none of it is typed here: a new reading changes the data and these follow it.
const cell = (workflow: string, profile: string, seed: string) => data.cells.find((c) => c.workflow === workflow && c.profile === profile && c.seed === seed)!;
const seedsOf = (workflow: string, profile: string) => data.cells.filter((c) => c.workflow === workflow && c.profile === profile).sort((a, b) => Number(a.seed) - Number(b.seed));
const stallText = (v: number): string => `${v.toFixed(1)} s`;
const extraText = (v: number): string => `${withSign(v, 1)}%`;

describe("the dot plot's model", () => {
  it("puts the runs with failures first and the run with none after it as the reference, the swarm's row first in each", () => {
    expect(model.groups.map((g) => [g.profile, g.killed, g.reference])).toEqual([
      ["C3", 5, false],
      ["C0", 0, true],
    ]);
    for (const g of model.groups) expect(g.rows.map((r) => r.id)).toEqual(["swarm", "durable-max", "durable"]);
    expect(model.groups[0]!.rows.map((r) => r.emphasis)).toEqual(["swarm", "rival", "quiet"]);
  });

  it("draws the swarm and the two durable supervisors the tie is about, and leaves the in-process supervisor out unless asked", () => {
    expect(TIE_SYSTEMS).toEqual(["swarm", "durable-max", "durable"]);
    expect(data.cells.some((c) => c.workflow === "central")).toBe(true);
    expect(model.groups.flatMap((g) => g.rows.map((r) => r.id))).not.toContain("central");
    const all = dotModel(data, null);
    for (const g of all.groups) expect(g.rows.map((r) => r.id)).toEqual(["swarm", "durable-max", "durable", "central"]);
    expect(dotModel(data, ["central"]).groups[0]!.rows.map((r) => r.id)).toEqual(["central"]);
  });

  it("keeps one dot for each seed, in seed order, with the numbers of the cells", () => {
    const swarm = model.groups[0]!.rows[0]!;
    const cells = seedsOf("swarm", "C3");
    expect(swarm.runs.map((r) => r.seed)).toEqual(cells.map((c) => c.seed));
    expect(swarm.runs.map((r) => r.seed)).toEqual([...data.seeds].sort((a, b) => Number(a) - Number(b)));
    expect(swarm.runs.map((r) => r.stall)).toEqual(cells.map((c) => c.stallS));
    expect(swarm.runs.map((r) => r.extra)).toEqual(cells.map((c) => c.extraCostPct));
    expect(swarm.runs).toHaveLength(data.seedCount);
    expect(model.seedCount).toBe(data.seedCount);
    expect(model.real).toBe(data.real);
  });

  it("means to the figures the claims quote, which the generator recomputes from the same rows", () => {
    const [c3] = model.groups;
    const swarm = c3!.rows.find((r) => r.id === "swarm")!;
    const ideal = c3!.rows.find((r) => r.id === "durable-max")!;
    const r2 = story.numbers.r2;
    expect(Number(swarm.meanStall.toFixed(1))).toBe(r2.swarmStallS);
    expect(Number(ideal.meanStall.toFixed(1))).toBe(r2.durableMaxStallS);
    expect(Number(swarm.meanExtra!.toFixed(1))).toBe(r2.swarmExtraPct);
    expect(Number(ideal.meanExtra!.toFixed(1))).toBe(r2.durableMaxExtraPct);
    expect([dotValue("stall", swarm.meanStall), dotValue("stall", ideal.meanStall)]).toEqual([stallText(r2.swarmStallS), stallText(r2.durableMaxStallS)]);
    expect([dotValue("extra", swarm.meanExtra!), dotValue("extra", ideal.meanExtra!)]).toEqual([extraText(r2.swarmExtraPct), extraText(r2.durableMaxExtraPct)]);
  });

  it("rings a run whose result is not valid, and counts them as the data's own count does: never fewer", () => {
    expect(model.invalid).toEqual(story.numbers.validity.headline10.invalid);
    expect(model.invalid).toEqual(data.cells.filter((c) => c.valid === false).map((c) => c.cell));
    expect(story.numbers.validity.headline10.runs - story.numbers.validity.headline10.valid).toBe(model.invalid.length);
  });

  it("names its groups, and its setting in the long form when it fits", () => {
    expect(model.groups.map((g) => groupTitle(g, false))).toEqual(["5 coordinators killed (C3)", "No failures (C0)"]);
    expect(model.groups.map((g) => groupTitle(g, true))).toEqual(["C3 · 5 killed", "C0 · no failures"]);
    expect(captions[0]).toBe(`T2 conference · real model · ${data.seedCount} seeds · failure profiles C3 and C0`);
    expect(captions[2]).toBe(`T2 · real model · ${data.seedCount} seeds`);
  });

  it("reads the names of the systems the generator gives, so the two cannot drift apart", () => {
    expect(LABELS).toEqual(story.workflows);
    expect(systemName("durable-max", LABELS["durable-max"]!, "full")).toBe("Ideal durable supervisor");
    expect(systemName("durable-max", LABELS["durable-max"]!, "short")).toBe("Ideal durable");
    expect(systemName("durable", LABELS["durable"]!, "full")).toBe("Realistic durable");
  });
});

const SIZES: [number, number][] = [
  [1480, 460],
  [1224, 353],
  [1000, 400],
  [820, 420],
  [700, 420],
  [600, 388],
  [390, 388],
  [350, 388],
];

function checkLayout(layout: DotLayout, label: string, m = model): void {
  const radius = layout.radius;
  expect(layout.panels, label).toHaveLength(2);
  layout.panels.forEach((panel, pi) => {
    expect(panel.left, label).toBeGreaterThan(40);
    expect(panel.right - panel.left, label).toBeGreaterThanOrEqual(150);
    expect(panel.meanX, label).toBeLessThanOrEqual(layout.width + 0.001);
    // the rows keep apart, in order
    panel.rows.slice(1).forEach((row, i) => expect(row.y - panel.rows[i]!.y, `${label} rows`).toBeGreaterThanOrEqual(15.999));
    // every dot is on the plot, and on the row it belongs to
    for (const row of panel.rows) {
      for (const d of row.dots) {
        expect(d.x, `${label} dot`).toBeGreaterThanOrEqual(panel.left - 0.001);
        expect(d.x, `${label} dot`).toBeLessThanOrEqual(panel.right + 0.001);
        expect(d.y, label).toBe(row.y);
      }
      if (row.mean !== null) {
        expect(row.mean, label).toBeGreaterThanOrEqual(panel.left - 0.001);
        expect(row.mean, label).toBeLessThanOrEqual(panel.right + 0.001);
      }
    }
    // the labels fit their column, the mean values theirs
    if (panel.labels) {
      m.groups.slice(0, layout.shown).forEach((g) => {
        for (const r of g.rows) expect(panel.labelX + textWidth(systemName(r.id, r.label, layout.names)), `${label} label`).toBeLessThanOrEqual(panel.left - 4);
      });
    }
    expect(textWidth("−13.9%"), label).toBeLessThanOrEqual(panel.meanX - panel.right);
    // the header of a panel stops short of the "mean" over its column, which ends at the column's edge
    expect(panel.left + textWidth(panel.title, 13) + 8 + textWidth(panel.sub) + 8, `${label} head vs mean`).toBeLessThanOrEqual(panel.meanX - textWidth("mean"));
    // the grid is drawn through the rows of each group and not through the band with its title
    expect(panel.spans, `${label} grid`).toHaveLength(layout.shown);
    panel.spans.forEach((s, gi) => {
      const rows = panel.rows.filter((r) => r.group === gi);
      expect(s.top, `${label} grid ${gi}`).toBeLessThan(rows[0]!.y);
      expect(s.bottom, `${label} grid ${gi}`).toBeGreaterThan(rows[rows.length - 1]!.y);
      for (const g of panel.groups) {
        expect(s.top >= g.y + 7 || s.bottom <= g.y - 7, `${label} the grid of group ${gi} crosses the title of group ${g.group}`).toBe(true);
      }
    });
    // a title ends before the mean column
    if (panel.labels) for (const g of panel.groups) expect(panel.labelX + textWidth(g.title), `${label} title`).toBeLessThanOrEqual(panel.meanX - 8);
    // the axis is under the last row, the key under the axis
    const lastRow = panel.rows[panel.rows.length - 1]!;
    expect(panel.axisY, label).toBeGreaterThan(lastRow.y);
    expect(panel.axisY + 24, `${label} axis vs key`).toBeLessThanOrEqual(layout.keyY - 4 + (layout.stacked && pi === 0 ? 1000 : 0));
    expect(radius, label).toBeGreaterThan(2);
  });
  if (layout.stacked) {
    const [a, b] = layout.panels;
    expect(a!.axisY + 24, label).toBeLessThanOrEqual(b!.headY - 4);
  }
  const lastKey = layout.key[layout.key.length - 1]!;
  expect(lastKey.x + 16 + textWidth(lastKey.label), label).toBeLessThanOrEqual(layout.width - 10 + 0.001);
  if (layout.caption) expect(textWidth(layout.caption), label).toBeLessThanOrEqual(layout.width - 20);
}

describe("the dot plot's layout", () => {
  for (const [width, height] of SIZES) {
    it(`${width}x${height}: everything is inside its box and nothing sits on anything else`, () => {
      checkLayout(dotLayout(model, width, height, captions), `${width}x${height}`);
    });
  }

  it("keeps its header off the mean column and its grid off the groups' titles at every width from a phone's to a wide screen's, below a thousand pixels as above", () => {
    for (const height of [340, 388, 420, 460, 560]) {
      for (let width = 350; width <= 1700; width += 10) checkLayout(dotLayout(model, width, height, captions), `${width}x${height}`);
    }
    // the widths a tablet and a small laptop give the chart, one by one
    for (const width of [944, 960, 980, 1000, 1040]) {
      const layout = dotLayout(model, width, 420, captions);
      expect(layout.stacked, `${width}`).toBe(false);
      checkLayout(layout, `${width}x420`);
    }
  });

  it("gives a panel the long form of its subtitle only where the whole header fits before the mean column", () => {
    const wide = dotLayout(model, 1480, 460, captions);
    expect(wide.panels.map((p) => p.sub)).toEqual(["seconds with no agent working", "% against the run with no failures, pre-registered basis"]);
    const tablet = dotLayout(model, 820, 420, captions);
    expect(tablet.panels.map((p) => p.sub)).toEqual(["seconds", "pre-registered basis"]);
  });

  it("names the basis of the extra cost in its header wherever the header has room for the words, and says that it is a percentage where it has none", () => {
    const names: string[] = [];
    for (let width = 350; width <= 1700; width += 10) {
      const extra = dotLayout(model, width, 420, captions).panels[1]!;
      names.push(extra.sub);
      expect(["% against the run with no failures, pre-registered basis", "pre-registered basis", "% extra"], `${width}`).toContain(extra.sub);
    }
    expect(new Set(names)).toEqual(new Set(["% against the run with no failures, pre-registered basis", "pre-registered basis", "% extra"]));
    // the long form is the one on a wide screen and the shortest the one that always fits
    expect(names[names.length - 1]).toContain("pre-registered basis");
  });

  it("sets the two panels side by side with the claims' names where there is room, and stacks them, with the failures only, where there is not", () => {
    const wide = dotLayout(model, 1480, 460, captions);
    expect([wide.stacked, wide.names, wide.shown]).toEqual([false, "full", 2]);
    expect(wide.panels[0]!.right).toBeLessThan(wide.panels[1]!.left);
    expect(wide.panels[0]!.rows).toHaveLength(6);
    const narrow = dotLayout(model, 350, 388, captions);
    expect([narrow.stacked, narrow.names, narrow.shown]).toEqual([true, "short", 1]);
    expect(narrow.panels[0]!.rows).toHaveLength(3);
  });

  it("scales stall from zero and extra cost across zero, and draws the extra cost of the run with no failures as the reference it is", () => {
    const [stall, extra] = dotLayout(model, 1480, 460, captions).panels;
    expect(stall!.ticks[0]!.label).toBe("0");
    expect(extra!.ticks.some((t) => t.zero)).toBe(true);
    expect(extra!.ticks.some((t) => t.label.startsWith("−"))).toBe(true);
    const reference = extra!.rows.filter((r) => r.group === 1);
    expect(reference).toHaveLength(3);
    for (const r of reference) expect([r.dots.length, r.mean]).toEqual([0, null]);
    expect(extra!.notes).toHaveLength(1);
    expect(extra!.notes[0]!.text).toContain("0 by definition");
    // while its stall time is drawn
    expect(stall!.rows.filter((r) => r.group === 1).every((r) => r.dots.length === data.seedCount)).toBe(true);
  });

  it("names the ticks of an axis only where the names do not touch, at every width a phone gives the chart", () => {
    for (let width = 280; width <= 700; width += 4) {
      for (const panel of dotLayout(model, width, 388, captions).panels) {
        const named = panel.ticks.filter((t) => t.label !== "");
        expect(named.length, `${width} ${panel.metric}`).toBeGreaterThan(1);
        named.slice(1).forEach((t, i) => {
          const gap = t.x - named[i]!.x - (textWidth(t.label) + textWidth(named[i]!.label)) / 2;
          expect(gap, `${width} ${panel.metric}: ${named[i]!.label} and ${t.label}`).toBeGreaterThanOrEqual(4 - 0.001);
        });
        // the zero is always named, and every tick keeps its line
        expect(panel.ticks.find((t) => t.zero)?.label, `${width} ${panel.metric} zero`).toBe("0");
      }
    }
    // on a wide screen every tick has its name
    expect(dotLayout(model, 1480, 460, captions).panels.every((p) => p.ticks.every((t) => t.label !== ""))).toBe(true);
  });

  it("puts the swarm's dots where its numbers are", () => {
    const [stall] = dotLayout(model, 1480, 460, captions).panels;
    const swarm = stall!.rows[0]!;
    const values = seedsOf("swarm", "C3").map((c) => c.stallS);
    expect(swarm.dots.map((d) => d.x)).toEqual(values.map((v) => stall!.xAt(v)));
    expect(swarm.min).toBe(stall!.xAt(Math.min(...values)));
    expect(swarm.max).toBe(stall!.xAt(Math.max(...values)));
    expect(swarm.mean).toBeCloseTo(stall!.xAt(values.reduce((a, b) => a + b, 0) / values.length), 9);
  });

  it("draws the in-process supervisor too when asked, in a fourth row of each group, and keeps its dots on the plot", () => {
    const four = dotModel(data, null);
    for (const [width, height] of [[1480, 560], [1224, 520], [1000, 520], [820, 520]] as [number, number][]) {
      const layout = dotLayout(four, width, height, dotCaptions(four));
      expect(layout.panels[0]!.rows, `${width}x${height}`).toHaveLength(8);
      checkLayout(layout, `${width}x${height} with the in-process supervisor`, four);
    }
  });

  it("holds for any numbers and any count of seeds", () => {
    const next = lcg(5);
    for (let round = 0; round < 40; round++) {
      const seeds = Array.from({ length: 1 + Math.floor(next() * 10) }, (_, i) => String(i + 1));
      const cells: HeadlineSlice["cells"] = [];
      for (const profile of ["C0", "C3"]) {
        for (const workflow of ["swarm", "durable-max", "durable"]) {
          for (const seed of seeds) {
            cells.push({
              cell: `${workflow}__t2_conference__${profile}__s${seed}`,
              workflow,
              task: "t2_conference",
              profile,
              seed,
              crashes: profile === "C0" ? 0 : 5,
              coordinatorsKilled: profile === "C0" ? 0 : 5,
              completed: true,
              valid: next() < 0.9,
              stallS: next() * 150,
              extraCostPct: profile === "C0" ? 0 : (next() - 0.4) * 80,
              costUsd: 0.3,
              makespanS: 300,
              coordinationTokens: 0,
              cdtS: null,
              blastSessionsPct: null,
              blastAgentsPct: null,
              idleAgentS: null,
              falseDeathRemaps: null,
              dupCalls: null,
              preservedPct: null,
            });
          }
        }
      }
      const odd = dotModel({ ...data, seeds, seedCount: seeds.length, cells });
      const [width, height] = SIZES[round % SIZES.length]!;
      checkLayout(dotLayout(odd, width, height, dotCaptions(odd)), `random ${round} ${width}x${height} ${seeds.length} seeds`, odd);
    }
  });
});

describe("the draw", () => {
  it("shows the axes first, then each row in turn, then the means, and is complete at the end", () => {
    const k = DOT_KEYFRAMES;
    const start = dotFrame(0);
    const end = dotFrame(1);
    expect([start.axes, start.means, start.row(0, 6), start.row(5, 6)]).toEqual([0, 0, 0, 0]);
    expect([end.axes, end.means, end.row(0, 6), end.row(5, 6)]).toEqual([1, 1, 1, 1]);
    expect(dotFrame(k.axes[1]).axes).toBe(1);
    // the rows come in one after another: the first is done before the last has begun
    expect(dotFrame(0.4).row(0, 6)).toBeGreaterThan(dotFrame(0.4).row(5, 6));
    expect(dotFrame(k.rows[0] + 0.05).row(5, 6)).toBe(0);
    expect(dotFrame(k.rows[1]).row(5, 6)).toBe(1);
    expect(k.means[0]).toBeLessThan(k.rows[1]);
    let before = dotFrame(0);
    for (let i = 1; i <= 800; i++) {
      const f = dotFrame(i / 800);
      expect(f.axes).toBeGreaterThanOrEqual(before.axes - 1e-12);
      expect(f.means).toBeGreaterThanOrEqual(before.means - 1e-12);
      for (let r = 0; r < 6; r++) expect(f.row(r, 6)).toBeGreaterThanOrEqual(before.row(r, 6) - 1e-12);
      before = f;
    }
  });

  const layout = dotLayout(model, 1480, 460, captions);
  const log: Log = new Map();
  const rig: DotRig = {
    axes: [fakePen<SVGGElement>(log), fakePen<SVGGElement>(log), fakePen<SVGGElement>(log)],
    means: [fakePen<SVGGElement>(log), fakePen<SVGGElement>(log)],
    rows: Array.from({ length: 6 }, (_, index) => ({ index, pen: fakePen<SVGGElement>(log) })),
    dots: Array.from({ length: 6 }, (_, row) => ({ row, pen: fakePen<SVGGElement>(log), x: 100 + row, y: 50 + row })),
    rowCount: 6,
  };

  it("grows each dot from a little smaller to its size where it is, and the whole at the end", () => {
    paintDots(rig, 0);
    for (const row of rig.rows) expect(Number(seen(log, row.pen)["opacity"])).toBe(0);
    for (const d of rig.dots) expect(seen(log, d.pen)["transform"]).toBe(`translate(${(100 + d.row).toFixed(2)} ${(50 + d.row).toFixed(2)}) scale(0.400)`);
    paintDots(rig, 1);
    for (const row of rig.rows) expect(Number(seen(log, row.pen)["opacity"])).toBe(1);
    for (const d of rig.dots) expect(seen(log, d.pen)["transform"]).toBe(`translate(${(100 + d.row).toFixed(2)} ${(50 + d.row).toFixed(2)}) scale(1.000)`);
    expect(layout.panels).toHaveLength(2);
  });

  it("writes finite numbers all the way through", () => {
    for (let i = 0; i <= 400; i++) {
      paintDots(rig, i / 400);
      for (const store of log.values()) for (const [name, value] of Object.entries(store)) expect(value, name).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe("DotPlot markup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const html = renderToStaticMarkup(createElement(DotPlot, { progress: motionValue(0), data, still: true }));

  const rings = (markup: string): number => markup.match(/class="hv-dp-ring"/g)?.length ?? 0;

  it("draws a dot for each run, with the run's numbers in its tooltip, and the mean beside each row", () => {
    // stall: both groups; extra cost: the failures only
    const runs = (groups: typeof model.groups): number => groups.flatMap((g) => g.rows).reduce((n, r) => n + r.runs.length, 0);
    expect(html.match(/data-dot="/g)).toHaveLength(runs(model.groups) + runs(model.groups.filter((g) => !g.reference)));
    expect(runs(model.groups)).toBe(2 * 3 * data.seedCount);
    const swarm = cell("swarm", "C3", "2");
    const ideal = cell("durable-max", "C3", "3");
    expect(html).toContain(`FractalSwarm, 5 coordinators killed (C3), seed 2: stall ${stallText(swarm.stallS)} (${data.seedCount} seeds in all)`);
    expect(html).toContain(`Ideal durable supervisor, 5 coordinators killed (C3), seed 3: extra cost ${extraText(ideal.extraCostPct!)} (${data.seedCount} seeds in all)`);
    const r2 = story.numbers.r2;
    for (const text of [stallText(r2.swarmStallS), stallText(r2.durableMaxStallS), extraText(r2.swarmExtraPct), extraText(r2.durableMaxExtraPct)]) expect(html).toContain(`>${text}<`);
    expect(html).toContain("0 by definition: the reference");
    expect(html).not.toContain("In-process supervisor");
  });

  it("is an image with a text alternative, and the same numbers as two tables", () => {
    const r2 = story.numbers.r2;
    expect(html).toContain('role="img"');
    expect(html).toContain("one dot for each run, for stall time in seconds and for extra cost in percent");
    expect(html).toContain(
      `5 coordinators killed (C3): the mean over the seeds is FractalSwarm ${stallText(r2.swarmStallS)} and ${extraText(r2.swarmExtraPct)} extra cost; Ideal durable supervisor ${stallText(r2.durableMaxStallS)} and ${extraText(r2.durableMaxExtraPct)} extra cost`,
    );
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain(`<th scope="col">Seed ${data.seedCount}</th>`);
  });

  it("names its setting, and a page that prints it itself can turn it off", () => {
    expect(html).toContain("T2 conference");
    expect(html).toContain(`${data.seedCount} seeds`);
    expect(html).toContain("real model");
    expect(renderToStaticMarkup(createElement(DotPlot, { progress: motionValue(0), data, still: true, setting: false }))).not.toContain("hv-ch-caption");
  });

  it("rings a run that is not valid, says so in its key and its text, and does not hide it", () => {
    const real = model.invalid.length;
    expect(real).toBeGreaterThan(0);
    // the data's own invalid run is drawn in the stall panel (it is at C0, where the extra cost is the reference) and named in the key
    expect(rings(html)).toBe(real + 1);
    expect(html).toContain("result not valid");
    expect(html).toContain(`${real} of the runs ${real === 1 ? "has" : "have"} a result that is not valid and ${real === 1 ? "is" : "are"} ringed`);
    // one more, at the failures: it is drawn in both panels
    const bad: HeadlineSlice = {
      ...data,
      cells: data.cells.map((c) => (c.workflow === "swarm" && c.profile === "C3" && c.seed === "2" ? { ...c, valid: false } : c)),
    };
    const out = renderToStaticMarkup(createElement(DotPlot, { progress: motionValue(0), data: bad, still: true }));
    expect(rings(out)).toBe(real + 2 + 1);
    expect(out).toContain("the result is not valid");
    expect(out).toContain(`${real + 1} of the runs have a result that is not valid and are ringed`);
  });

  it("says nothing of a result that is not valid when every one is", () => {
    const clean: HeadlineSlice = { ...data, cells: data.cells.map((c) => ({ ...c, valid: true })) };
    const out = renderToStaticMarkup(createElement(DotPlot, { progress: motionValue(0), data: clean, still: true }));
    expect(out).not.toContain("not valid");
    expect(rings(out)).toBe(0);
  });

  it("draws the systems it is asked for, and a page that passes a new array each render gets the same picture", () => {
    const all = renderToStaticMarkup(createElement(DotPlot, { progress: motionValue(0), data, still: true, systems: null }));
    expect(all).toContain("In-process supervisor");
    expect(all.match(/data-dot="/g)!.length).toBeGreaterThan(html.match(/data-dot="/g)!.length);
    const same = renderToStaticMarkup(createElement(DotPlot, { progress: motionValue(0), data, still: true, systems: ["swarm", "durable-max", "durable"] }));
    expect(same).toBe(html);
  });

  it("has no number that is not a number and no word the claims do not allow", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
    expect(html).not.toMatch(/\b(simpler|cheaper|more reliable)\b/i);
    expect(dotSummary(model)).not.toMatch(/\b(better|worse|wins?|loses?)\b/i);
  });
});
