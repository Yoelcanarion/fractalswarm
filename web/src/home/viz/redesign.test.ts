// The redesigned page's visuals (redesign.md): what each draws on the server, what it takes from the home data, the words it adds to
// the page, and the words that must not be there. Their motion is tested where it is made (ease.test.ts, demo/stage.test.ts);
// here, the markup, the geometry of the chart and the data.

import { readFileSync } from "node:fs";

import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { story } from "../data/story";
import { HOME } from "../testing";
import { barShare, proofPanels, proofReading, proofText, type BarsPanel, type ProofPanel, type SeedsPanel } from "./charts/proof";
import {
  barLength,
  barNumber,
  barsOf,
  clampWidth,
  COLUMN_W,
  DOT_R,
  dotLinesOf,
  layoutProof,
  MAX_W,
  MIN_W,
  PAIR_FROM,
  PAIR_GAP,
  paintProof,
  shareAt,
  STEP,
  TOTAL,
  type PanelGeo,
  type ProofRig,
} from "./charts/proofLayout";
import { ProofBars, ProofDrawing } from "./charts/ProofBars";
import { KillDemo, crashLine } from "./demo/KillDemo";
import { createStage } from "./demo/stage";
import { DOOR_IDS } from "./doors/doors";
import { DoorThumb } from "./doors/DoorThumb";
import { FILM_MOMENTS, ProblemFilm } from "./film/ProblemFilm";
import { grown, GrowNumber, MISSING } from "./parts/GrowNumber";
import { fx } from "./shared";
import { STEP_IDS, StepDrawing } from "./steps/StepDrawing";
import { Pen, paintTree, type TreeRig } from "./tree/paint";
import { SwarmTree } from "./tree/SwarmTree";

beforeEach(() => {
  // React warns that useLayoutEffect does nothing on the server; the markup is what is under test.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const render = <P extends object>(type: (props: P) => unknown, props: P): string => renderToStaticMarkup(createElement(type as never, props as never));

/** The words a person reads in a piece of markup, as the page's own counter takes them: what is drawn inside an svg is not one. */
const words = (html: string): string[] =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .filter((piece) => /[\p{L}\p{N}]/u.test(piece));

describe("the click demo's markup", () => {
  const html = render(KillDemo, {});

  it("puts a button over every one of the ten coordinators, each with a name, and none over an agent", () => {
    expect(html.match(/data-pick="/g)).toHaveLength(story.tree.counts.orchestrators);
    for (const n of story.tree.nodes.filter((x) => x.kind === "brain")) expect(html).toContain(`aria-label="Crash ${n.label} (${n.id})"`);
    expect(html).not.toContain('data-pick="o1.1.a1"');
  });

  it("has the two buttons and the live line, and adds nine words to the page", () => {
    expect(html).toContain("Kill half");
    expect(html).toContain("Reset");
    expect(html).toContain('aria-live="polite"');
    expect(words(html).join(" ")).toBe("Click a coordinator to crash it. Kill half Reset");
    expect(words(html)).toHaveLength(9);
  });

  it("leaves the sentence that says it is an illustration to the page, and prints it when asked", () => {
    expect(html).not.toContain("An illustration in your browser");
    expect(render(KillDemo, { note: true })).toContain("An illustration in your browser, not a real run.");
  });

  it("draws the hero's tree: its nodes, an edge slot for each, the ambient layer", () => {
    expect(html.match(/data-node="/g)).toHaveLength(story.tree.counts.orchestrators + story.tree.counts.agents);
    expect(html.match(/data-edge="/g)).toHaveLength(story.tree.nodes.length);
    expect(html).toContain("hv-amb-halo");
  });

  it("carries no number, time or hash from the recorded run", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
    expect(html).not.toContain("†");
    expect(html).not.toContain("hv-score-text");
    for (const k of story.tree.kills) expect(html).not.toContain(`${(k.atMs / 1000).toFixed(1)} s`);
    expect(html).not.toContain("talks");
  });

  it("is quiet for a still page: no ambient layer", () => {
    expect(render(KillDemo, { still: true })).not.toContain("hv-amb-halo");
  });

  it("puts the line and the two buttons right over the tree, Kill half as the main action, and sizes the stage to the window", () => {
    expect(html.indexOf("hv-demo-line")).toBeLessThan(html.indexOf("hv-demo-stage"));
    expect(html.indexOf("hv-demo-bar")).toBeLessThan(html.indexOf("hv-demo-stage"));
    expect(html).toMatch(/class="hv-demo-btn hv-demo-btn--main"[^>]*>Kill half</);
    expect(html).toMatch(/class="hv-demo-btn"[^>]*disabled=""[^>]*>Reset</);
    expect(html).not.toContain('class="btn');
    expect(html).toMatch(/--demo-aspect:\d\.\d{3}/);
  });

  it("says that one heir takes over and two or more take over, with the names of the heirs", () => {
    expect(crashLine("Data (o1)", ["AI (o2)"])).toBe("Data (o1) crashed. AI (o2) takes over, picked by the same rule on every survivor, so there is no election.");
    expect(crashLine("Root (o0)", ["AI (o2)", "HCI (o3)"])).toContain("AI (o2) and HCI (o3) take over,");
    expect(crashLine("Root (o0)", ["a", "b", "c"])).toContain("a, b and c take over,");
    expect(crashLine("Root (o0)", ["a", "b"])).not.toContain("takes");
  });

  it("draws the shelf of the dead from the start, faintly, and the hero's tree does not", () => {
    const rig = (log: Record<string, string>): TreeRig =>
      ({
        nodes: {},
        edges: {},
        dashes: [],
        clock: null,
        memorial: new Pen({ setAttribute: (name: string, value: string) => void (log[name] = value) } as unknown as SVGGElement),
      }) as TreeRig;
    const stage = createStage(story.tree);
    const demo: Record<string, string> = {};
    paintTree(rig(demo), stage.at(0));
    expect(Number(demo.opacity)).toBeCloseTo(0.5, 2);
    const hero: Record<string, string> = {};
    paintTree(rig(hero), { ...stage.at(0), shelf: undefined });
    expect(Number(hero.opacity)).toBe(0);
  });

  it("writes KILLED above the rule, where a full row of the dead cannot cover it; the hero's tree keeps it beside its row", () => {
    const at = (markup: string, part: string, attr: string): number => Number(new RegExp(`class="hv-memorial-${part}"[^>]*\\s${attr}="(-?[\\d.]+)"`).exec(markup)?.[1]);
    expect(at(html, "label", "y")).toBeLessThan(at(html, "rule", "y1"));
    const hero = render(SwarmTree, { progress: motionValue(0), data: story.tree, still: true });
    expect(at(hero, "label", "y")).toBeGreaterThan(at(hero, "rule", "y1"));
  });
});

describe("the Proof's data", () => {
  const panels = proofPanels(story);
  const [central, durable] = panels as [BarsPanel, SeedsPanel];

  it("are the swarm against the in-process supervisor in bars and against the ideal durable supervisor in seeds, named by the data", () => {
    expect(panels.map((p) => `${p.id}:${p.kind}`)).toEqual(["central:bars", "durable-max:seeds"]);
    expect(central.rival).toBe(story.workflows["central"]);
    expect(durable.rival).toBe(story.workflows["durable-max"]);
    expect(central.rows[0]).toMatchObject({ swarm: story.numbers.r5.t2.swarmStallS, rival: story.numbers.r5.t2.centralStallS, unit: "s" });
    expect(central.rows[1]).toMatchObject({ swarm: story.numbers.r5.t2.swarmExtraPct, rival: story.numbers.r5.t2.centralExtraPct, unit: "pct" });
  });

  it("print the setting of each: the model, the task, the failure profile and the seeds", () => {
    expect(central.setting).toBe(`Real model · T2 conference · C3 · ${story.numbers.r5.t2.seeds} seeds`);
    expect(durable.setting).toBe(`Real model · T2 conference · C3 · ${story.numbers.r2.seeds} seeds`);
  });

  it("draw every seed of both workflows, and their means are the numbers the page quotes", () => {
    const [stall, cost] = durable.rows;
    expect(stall?.swarm).toHaveLength(story.numbers.r2.seeds);
    expect(stall?.rival).toHaveLength(story.numbers.r2.seeds);
    const mean = (list: { value: number }[] | undefined): number => (list ?? []).reduce((sum, s) => sum + s.value, 0) / Math.max(1, list?.length ?? 1);
    expect(mean(stall?.swarm)).toBeCloseTo(story.numbers.r2.swarmStallS, 1);
    expect(mean(stall?.rival)).toBeCloseTo(story.numbers.r2.durableMaxStallS, 1);
    expect(mean(cost?.swarm)).toBeCloseTo(story.numbers.r2.swarmExtraPct, 1);
    expect(mean(cost?.rival)).toBeCloseTo(story.numbers.r2.durableMaxExtraPct, 1);
  });

  it("print the data's verdict beside the ideal durable supervisor, as it is", () => {
    const rows = story.verdicts?.comparisons ?? [];
    const want = (metric: string): string | null => rows.find((c) => c.rival === "durable-max" && c.metric === metric)?.verdict ?? null;
    expect(durable.rows.map((r) => r.verdict)).toEqual([want("stall_s"), want("extra_cost_pct")]);
  });

  it("write a number as the page writes it: one decimal, a real minus, a plus on a cost", () => {
    expect(proofText(14.6, "s")).toBe("14.6 s");
    expect(proofText(6.6, "pct")).toBe("+6.6%");
    expect(proofText(-6.6, "pct")).toBe("−6.6%");
  });

  it("make a bar as long as the value is of the longest in its row, and none for a value below nothing", () => {
    expect(barShare(14.6, 92.6)).toBeCloseTo(0.1577, 3);
    expect(barShare(92.6, 14.6)).toBe(1);
    expect(barShare(-6.6, 7.5)).toBe(0);
    expect(barShare(0, 0)).toBe(0);
  });

  it("read in words with every number, the rivals by name and the verdict, and no word of a win", () => {
    const reading = proofReading(panels, "FractalSwarm");
    const t2 = story.numbers.r5.t2;
    expect(reading).toContain(`FractalSwarm ${proofText(t2.swarmStallS, "s")}, In-process supervisor ${proofText(t2.centralStallS, "s")}`);
    expect(reading).toContain(`FractalSwarm ${proofText(t2.swarmExtraPct, "pct")}, In-process supervisor ${proofText(t2.centralExtraPct, "pct")}`);
    for (const row of durable.rows) expect(reading).toContain(`the data's verdict is a ${row.verdict}`);
    // the extra cost names its basis, because the claims give it on two
    expect(reading).toContain("extra cost, pre-registered basis: FractalSwarm");
    expect(reading).not.toMatch(/\bwin\b|faster|cheaper|simpler|more reliable|NaN|undefined/i);
  });
});

describe("the Proof's geometry", () => {
  const panels = proofPanels(story);
  const widths = [260, 300, 375, 420, 559, 560, 640, 720, 840, 999, 1000, 1200, 1700];

  it("keeps the width between what a phone gives it and what reads well: one column up to 840, two columns from a thousand", () => {
    expect(clampWidth(0)).toBe(MIN_W);
    expect(clampWidth(100000)).toBe(MAX_W);
    expect(clampWidth(Number.NaN)).toBeGreaterThanOrEqual(MIN_W);
    expect(layoutProof(panels, 100000, "FractalSwarm").width).toBe(MAX_W);
    expect(clampWidth(900)).toBe(COLUMN_W);
    expect(clampWidth(PAIR_FROM - 1)).toBe(COLUMN_W);
    expect(clampWidth(PAIR_FROM)).toBe(PAIR_FROM);
    expect(clampWidth(1224)).toBe(1224);
  });

  it("puts every part inside the box it is drawn in, at every width, and inside its own panel", () => {
    for (const width of widths) {
      const geo = layoutProof(panels, width, "FractalSwarm");
      for (const panel of geo.panels) {
        expect(panel.x, `panel at ${width}`).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.w, `panel at ${width}`).toBeLessThanOrEqual(geo.width + 0.001);
        const inside = (x: number, what: string): void => {
          expect(x, `${what} at ${width}`).toBeGreaterThanOrEqual(-0.001);
          expect(x, `${what} at ${width}`).toBeLessThanOrEqual(panel.w + 0.001);
        };
        for (const row of panel.rows) {
          if (row.chip) {
            inside(row.chip.x, "chip start");
            inside(row.chip.x + row.chip.w, "chip end");
          }
          for (const line of row.lines) {
            inside(line.track.x, "track start");
            inside(line.track.x + line.track.w, "track end");
            if (line.bar) {
              expect(line.bar.length).toBeLessThanOrEqual(line.track.w + 0.001);
              inside(line.bar.value.x, "number");
              // the number is right of the track and does not run into it
              expect(line.bar.value.x - 64).toBeGreaterThanOrEqual(line.track.x + line.track.w - 0.001);
            }
            for (const dot of line.dots) {
              expect(dot.cx).toBeGreaterThanOrEqual(line.track.x + DOT_R - 0.001);
              expect(dot.cx).toBeLessThanOrEqual(line.track.x + line.track.w - DOT_R + 0.001);
            }
          }
        }
      }
    }
  });

  it("stacks the names above the lines on a phone and puts them beside the lines on a screen", () => {
    const narrow = layoutProof(panels, 375, "FractalSwarm");
    const wide = layoutProof(panels, 1200, "FractalSwarm");
    const line = (geo: typeof narrow): (typeof narrow.panels)[number]["rows"][number]["lines"][number] => geo.panels[0]!.rows[0]!.lines[0]!;
    expect(narrow.inline).toBe(false);
    expect(line(narrow).nameAt.y).toBeLessThan(line(narrow).track.y);
    expect(line(narrow).track.x).toBe(0);
    expect(wide.inline).toBe(true);
    expect(line(wide).nameAt.y).toBeCloseTo(line(wide).track.y + line(wide).track.h / 2, 5);
    expect(line(wide).track.x).toBeGreaterThan(100);
    expect(wide.height).toBeLessThan(narrow.height);
  });

  it("keeps the lines apart: in a column no two share a place and each is below the last, and the two columns stand side by side", () => {
    for (const width of widths) {
      const geo = layoutProof(panels, width, "FractalSwarm");
      const columns = geo.columns === 2 ? geo.panels.map((p) => [p]) : [geo.panels];
      for (const column of columns) {
        const ys = column.flatMap((p) => p.rows.flatMap((r) => r.lines.map((l) => l.track.y)));
        for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!, `line ${i} at ${width}`).toBeGreaterThanOrEqual(24);
        expect(geo.height, `height at ${width}`).toBeGreaterThan(Math.max(...ys));
      }
    }
  });

  it("stands the two panels side by side from a thousand pixels, in equal columns with 48 between them, and one above the other below", () => {
    const below = layoutProof(panels, PAIR_FROM - 1, "FractalSwarm");
    expect([below.columns, below.width]).toEqual([1, COLUMN_W]);
    expect(below.panels.map((p) => p.x)).toEqual([0, 0]);
    const top = (geo: typeof below, i: number): number => geo.panels[i]!.rows[0]!.lines[0]!.track.y;
    expect(top(below, 1)).toBeGreaterThan(top(below, 0));
    for (const width of [PAIR_FROM, 1100, 1224, MAX_W, 1700]) {
      const geo = layoutProof(panels, width, "FractalSwarm");
      const whole = Math.min(MAX_W, width);
      expect([geo.columns, geo.width], `${width}`).toEqual([2, whole]);
      const [left, right] = geo.panels as [PanelGeo, PanelGeo];
      expect(left.x).toBe(0);
      expect(left.w).toBeCloseTo((whole - PAIR_GAP) / 2, 9);
      expect(right.w).toBe(left.w);
      expect(right.x - (left.x + left.w)).toBeCloseTo(PAIR_GAP, 9);
      expect(right.x + right.w).toBeCloseTo(whole, 9);
      // the rows of the two panels are level with each other, and as tall as each other
      left.rows.forEach((row, i) => row.lines.forEach((line, j) => expect(right.rows[i]!.lines[j]!.track.y, `${width} row ${i} line ${j}`).toBe(line.track.y)));
      // one drawing grows from left to right: every line of the first panel starts before every line of the second
      expect(Math.max(...left.rows.flatMap((r) => r.lines.map((l) => l.order)))).toBeLessThan(Math.min(...right.rows.flatMap((r) => r.lines.map((l) => l.order))));
    }
  });

  it("puts the names beside the lines when a panel is wide enough for it, which a column of a thousand pixels is not and one of twelve hundred is", () => {
    expect(layoutProof(panels, PAIR_FROM, "FractalSwarm").inline).toBe(false);
    expect(layoutProof(panels, 1200, "FractalSwarm").inline).toBe(true);
    expect(layoutProof(panels, MAX_W, "FractalSwarm").inline).toBe(true);
  });

  it("says a setting that the two panels share once, small, under them, and each panel's own where they differ or where they are stacked", () => {
    const [a, b] = panels as [BarsPanel, SeedsPanel];
    const same: ProofPanel[] = [
      { ...a, setting: "One setting" },
      { ...b, setting: "One setting" },
    ];
    const differ: ProofPanel[] = [
      { ...a, setting: "One setting" },
      { ...b, setting: "Another" },
    ];
    const together = layoutProof(same, 1200, "FractalSwarm");
    expect(together.setting?.text).toBe("One setting");
    expect(together.panels.map((p) => p.setting)).toEqual(["", ""]);
    const lowest = Math.max(...together.panels.flatMap((p) => p.rows.flatMap((r) => r.lines.map((l) => l.track.y + l.track.h))));
    expect(together.setting!.at.y).toBeGreaterThan(lowest);
    expect(together.height).toBeGreaterThan(together.setting!.at.y);
    expect(together.height).toBeGreaterThan(layoutProof(differ, 1200, "FractalSwarm").height);
    const apart = layoutProof(differ, 1200, "FractalSwarm");
    expect(apart.setting).toBeNull();
    expect(apart.panels.map((p) => p.setting)).toEqual(["One setting", "Another"]);
    const stacked = layoutProof(same, 720, "FractalSwarm");
    expect(stacked.setting).toBeNull();
    expect(stacked.panels.map((p) => p.setting)).toEqual(["One setting", "One setting"]);
  });

  it("has a dot for every seed on a line of ten, inside its track, at a thousand pixels and at a phone's width", () => {
    for (const width of [390, PAIR_FROM, 1200, MAX_W]) {
      const geo = layoutProof(panels, width, "FractalSwarm");
      const lines = dotLinesOf(geo);
      expect(lines, `${width}`).toHaveLength(4);
      for (const line of lines) {
        expect(line.dots, `${width} ${line.who}`).toHaveLength(story.numbers.r2.seeds);
        for (const dot of line.dots) {
          expect(dot.cx).toBeGreaterThanOrEqual(line.track.x + DOT_R - 0.001);
          expect(dot.cx).toBeLessThanOrEqual(line.track.x + line.track.w - DOT_R + 0.001);
        }
      }
    }
  });

  it("draws the tie as dots and never as bars of the means", () => {
    const geo = layoutProof(panels, 720, "FractalSwarm");
    const against = geo.panels.find((p) => p.id === "durable-max");
    expect(against?.kind).toBe("seeds");
    for (const row of against?.rows ?? []) {
      expect(row.lines).toHaveLength(2);
      for (const line of row.lines) {
        expect(line.bar).toBeNull();
        expect(line.dots.length).toBeGreaterThan(0);
      }
    }
    expect(barsOf(geo)).toHaveLength(4);
    expect(dotLinesOf(geo)).toHaveLength(4);
  });

  it("puts both workflows' dots on one axis, with a zero line where the axis is signed", () => {
    const geo = layoutProof(panels, 720, "FractalSwarm");
    const [stall, cost] = geo.panels.find((p) => p.id === "durable-max")!.rows;
    expect(stall!.zero).toBeNull();
    expect(cost!.zero).not.toBeNull();
    const sorted = (row: typeof stall, who: "swarm" | "rival"): number[] => row!.lines.find((l) => l.who === who)!.dots.map((d) => d.cx);
    // the same value sits at the same place on both lines: the smallest of all is the left-most of its line
    const costValues = geo.panels.find((p) => p.id === "durable-max")!.rows[1]!;
    const all = [...sorted(costValues, "swarm"), ...sorted(costValues, "rival")];
    expect(Math.min(...all)).toBeCloseTo(costValues.lines[0]!.track.x + DOT_R, 5);
    expect(Math.max(...all)).toBeCloseTo(costValues.lines[0]!.track.x + costValues.lines[0]!.track.w - DOT_R, 5);
  });
});

describe("the Proof's growth", () => {
  it("is nothing at the start and whole at the end, for every line, and they end together", () => {
    for (const order of [0, 1, 3, 7]) {
      expect(shareAt(order, 0)).toBe(0);
      expect(shareAt(order, TOTAL)).toBe(1);
      expect(shareAt(order, TOTAL + 5)).toBe(1);
      expect(shareAt(order, TOTAL - 0.02)).toBeLessThan(1);
    }
  });

  it("only grows, and a later line never gets ahead of an earlier one", () => {
    for (let order = 0; order < 8; order++) {
      let last = 0;
      for (let t = 0; t <= TOTAL; t += 0.01) {
        const share = shareAt(order, t);
        if (share < last) expect.fail(`line ${order} went back at ${t}`);
        if (order > 0 && shareAt(order - 1, t) < share - 1e-9) expect.fail(`line ${order} is ahead of ${order - 1} at ${t}`);
        last = share;
      }
    }
    expect(shareAt(7, 7 * STEP)).toBe(0);
  });

  it("keeps a bar and its number in time: the number is the same share of its end as the bar is of its length", () => {
    const geo = layoutProof(proofPanels(story), 720, "FractalSwarm");
    for (const bar of barsOf(geo)) {
      for (const t of [0.2, 0.5, 0.9, 1.3]) {
        const share = barLength(bar, t) / bar.length;
        expect(share).toBeCloseTo(shareAt(bar.order, t), 9);
        const written = barNumber(bar, t);
        expect(written).toBe(proofText(bar.end * shareAt(bar.order, t), bar.unit));
      }
      expect(barNumber(bar, TOTAL)).toBe(proofText(bar.end, bar.unit));
    }
  });

  it("paints what it is told into the bars, the numbers and the dots, and leaves them whole at the end", () => {
    const geo = layoutProof(proofPanels(story), 720, "FractalSwarm");
    const log: Record<string, string>[] = [];
    const pen = <E extends Element>(): Pen<E> => {
      const store: Record<string, string> = {};
      log.push(store);
      const el = {
        setAttribute: (name: string, value: string) => {
          store[name] = value;
        },
        firstChild: null,
        set textContent(value: string) {
          store["#text"] = value;
        },
      };
      return new Pen(el as unknown as E);
    };
    const rig: ProofRig = {
      bars: barsOf(geo).map((bar) => ({ rect: pen<SVGRectElement>(), text: pen<SVGTextElement>(), geo: bar })),
      dots: dotLinesOf(geo).map((line) => ({ g: pen<SVGGElement>(), order: line.order })),
    };
    paintProof(rig, 0);
    rig.bars.forEach((bar, i) => {
      expect(log[i * 2]?.["width"]).toBe("0.00");
      expect(log[i * 2 + 1]?.["#text"]).toBe(proofText(0, bar.geo.unit));
    });
    paintProof(rig, Infinity);
    rig.bars.forEach(({ geo: bar }, i) => {
      expect(log[i * 2]?.["width"]).toBe(fx(bar.length));
      expect(log[i * 2 + 1]?.["#text"]).toBe(proofText(bar.end, bar.unit));
    });
    const dots = log.slice(rig.bars.length * 2);
    for (const entry of dots) {
      expect(entry["opacity"]).toBe("1.00");
      expect(entry["transform"]).toBe("translate(0.00 0)");
    }
  });
});

describe("the Proof's markup", () => {
  const html = render(ProofBars, { play: 0 });

  it("is one drawing with a text alternative and no word outside the svg", () => {
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain('role="img"');
    expect(html).toMatch(/<title id="[^"]+">The swarm against two rivals<\/title>/);
    expect(words(html)).toEqual([]);
  });

  it("carries the rivals' names and the settings in the drawing", () => {
    for (const panel of proofPanels(story)) {
      expect(html).toContain(`>${panel.rival}</text>`);
      expect(html).toContain(`>${panel.setting}</text>`);
    }
  });

  it("draws four bars with four numbers against the in-process supervisor, and none against the ideal durable supervisor", () => {
    expect(html.match(/data-bar=""/g)).toHaveLength(4);
    expect(html.match(/data-num=""/g)).toHaveLength(4);
    const durable = /<g data-panel="durable-max">[\s\S]*$/.exec(html)?.[0] ?? "";
    expect(durable).not.toContain("data-bar");
    expect(durable.match(/class="hv-proof-dot"/g)).toHaveLength(2 * 2 * story.numbers.r2.seeds);
    expect(durable).toContain('class="hv-proof-chip"');
    expect(durable).toContain(">tie</text>");
  });

  it("never words the tie as a win", () => {
    expect(html).not.toMatch(/\bwin\b|faster|cheaper|simpler|more reliable|NaN|undefined|Infinity/i);
  });

  it("is at nothing before the page plays it, and whole for a still page", () => {
    expect(html).toContain('data-play="off"');
    expect(html.match(/class="hv-proof-bar"[^>]*width="0.00"/g)).toHaveLength(4);
    const still = render(ProofBars, { play: 0, still: true });
    expect(still).toContain('data-play="still"');
    expect(still).not.toMatch(/class="hv-proof-bar"[^>]*width="0.00"/);
    expect(still).toContain(`>${proofText(story.numbers.r5.t2.centralStallS, "s")}</text>`);
    expect(render(ProofBars, { play: 1 })).toContain('data-play="on"');
  });

  it("draws nothing of its own where the page has no data", () => {
    expect(render(ProofBars, { play: 1, data: null })).not.toContain("<svg");
  });
});

describe("the Proof's drawing in two columns", () => {
  const panels = proofPanels(story);
  const reading = proofReading(panels, "FractalSwarm");
  const draw = (list: ProofPanel[], width: number): string => render(ProofDrawing, { geo: layoutProof(list, width, "FractalSwarm"), reading, at: Infinity, id: "p" });

  it("moves the second panel over by a column and its gap, and leaves the first where it is", () => {
    const html = draw(panels, 1200);
    const right = layoutProof(panels, 1200, "FractalSwarm").panels[1]!;
    expect(html).toContain(`<g data-panel="${right.id}" transform="translate(${fx(right.x)} 0)">`);
    expect(html).toContain(`<g data-panel="${panels[0]!.id}">`);
    expect(draw(panels, 720)).not.toMatch(/<g data-panel="[^"]+" transform=/);
  });

  it("keeps every bar, number and dot of the stacked drawing, and a rival's name for each panel", () => {
    const html = draw(panels, 1200);
    expect(html.match(/data-bar=""/g)).toHaveLength(4);
    expect(html.match(/data-num=""/g)).toHaveLength(4);
    expect(html.match(/class="hv-proof-dot"/g)).toHaveLength(2 * 2 * story.numbers.r2.seeds);
    for (const panel of panels) expect(html).toContain(`>${panel.rival}</text>`);
    expect(html).toContain(">tie</text>");
  });

  it("writes a shared setting once, and each panel's own where they differ", () => {
    const [a, b] = panels as [BarsPanel, SeedsPanel];
    const once = draw([{ ...a, setting: "One setting" }, { ...b, setting: "One setting" }], 1200);
    expect(once.match(/>One setting<\/text>/g)).toHaveLength(1);
    const each = draw([{ ...a, setting: "One setting" }, { ...b, setting: "Another" }], 1200);
    expect(each.match(/>One setting<\/text>/g)).toHaveLength(1);
    expect(each.match(/>Another<\/text>/g)).toHaveLength(1);
    expect(draw([{ ...a, setting: "One setting" }, { ...b, setting: "One setting" }], 720).match(/>One setting<\/text>/g)).toHaveLength(2);
    expect(words(once)).toEqual([]);
  });
});

describe("a number that grows", () => {
  it("is nothing at the start, the number at the end, and never past it or back", () => {
    expect(grown(92.6, 0, 0, 1.6)).toBe(0);
    expect(grown(92.6, 1.6, 0, 1.6)).toBeCloseTo(92.6, 9);
    expect(grown(92.6, 9, 0, 1.6)).toBeCloseTo(92.6, 9);
    let last = -1;
    for (let t = 0; t <= 2; t += 0.02) {
      const v = grown(92.6, t, 0, 1.6);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(92.6 + 1e-9);
      last = v;
    }
  });

  it("waits out its delay, then grows as long as it is told, so that it ends with its bar", () => {
    expect(grown(10, 0.1, 0.3, 1)).toBe(0);
    expect(grown(10, 1.3, 0.3, 1)).toBeCloseTo(10, 9);
  });

  it("keeps the end number's width from the first frame and gives a screen reader the end number", () => {
    const html = render(GrowNumber, { value: 14.6, format: (v: number) => `${v.toFixed(1)} s`, play: 0 });
    expect(html).toContain('<span class="hv-count__end" aria-hidden="true">14.6 s</span>');
    expect(html).toContain('<span class="hv-count__live" aria-hidden="true">0.0 s</span>');
    expect(html).toContain('<span class="hv-sr">14.6 s</span>');
    expect(render(GrowNumber, { value: 14.6, format: (v: number) => `${v.toFixed(1)} s`, play: 0, still: true })).toContain('aria-hidden="true">14.6 s</span><span class="hv-sr"');
  });

  it("writes a dash where the data has no number, and does not grow", () => {
    for (const value of [null, undefined, Number.NaN]) {
      const html = render(GrowNumber, { value, format: (v: number) => `${v.toFixed(1)} s`, play: 1 });
      expect(html).toContain(`<span class="hv-count__end" aria-hidden="true">${MISSING}</span>`);
      expect(html).toContain(`<span class="hv-count__live" aria-hidden="true">${MISSING}</span>`);
      expect(html).not.toMatch(/NaN|undefined/);
    }
  });
});

describe("the Solution's drawings", () => {
  it("are three, each with its words for a screen reader", () => {
    expect(STEP_IDS).toEqual(["log", "heir", "adopt"]);
    for (const step of STEP_IDS) expect(render(StepDrawing, { step, active: false })).toMatch(/aria-label="[^"]{20,}"/);
  });

  it("rest when the card is, play when it is hovered, and are in their end state for a still page", () => {
    for (const step of STEP_IDS) {
      expect(render(StepDrawing, { step, active: false })).toContain('data-on="false"');
      expect(render(StepDrawing, { step, active: true })).toContain('data-on="true"');
      expect(render(StepDrawing, { step, active: false, still: true })).toContain('data-on="true"');
    }
  });

  it("draw their lines on with a dash as long as the path, which a stroke that does not scale would measure in pixels instead", () => {
    const css = readFileSync(`${HOME}/viz/viz.css`, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.hv-step \.hv-st-draw,\s*\.hv-step \.hv-st-new\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/stroke-dasharray:\s*1;/);
    expect(rule).toMatch(/stroke-dashoffset:\s*1;/);
    expect(rule).not.toContain("non-scaling-stroke");
    // and each of those paths counts its length as 1, which is what the dash is
    const markup = [render(StepDrawing, { step: "log", active: false }), render(StepDrawing, { step: "adopt", active: false })].join("");
    for (const name of ["hv-st-draw", "hv-st-new"]) expect(markup).toMatch(new RegExp(`class="${name}"[^>]*pathLength="1"`));
  });

  it("draw the heir's bars from the recorded round, best first, with no number", () => {
    const html = render(StepDrawing, { step: "heir", active: false });
    const first = story.hrw.rounds[0]?.scores ?? [];
    expect(first.length).toBeGreaterThan(1);
    for (const s of first.slice(0, 3)) expect(html).toContain(`--w:${s.fraction.toFixed(3)}`);
    expect(html).not.toContain("<text");
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe("the film and the doors' thumbnails", () => {
  it("draw the in-process supervisor's lanes", () => {
    const html = render(ProblemFilm, { play: 0 });
    expect(html).toContain("hv-film");
    expect(html).toContain("work lanes");
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("say what happens in three captions, in the svg, and in the lanes' plain form: no lane names, a key of two, no setting", () => {
    const html = render(ProblemFilm, { play: 0 });
    expect(FILM_MOMENTS).toEqual(["It crashes.", "The work waits.", "The work is paid for again."]);
    for (const text of FILM_MOMENTS) expect(html).toContain(`>${text}</text>`);
    expect(html.match(/data-moment="/g)).toHaveLength(3);
    expect(html).not.toContain("hv-ln-label");
    expect(html).not.toContain("hv-ln-caption");
    expect(html.match(/hv-ln-swatch/g)).toHaveLength(2);
    expect(html).toContain('data-swatch="cut"');
    expect(html).toContain('data-swatch="again"');
    expect(html).not.toContain('data-swatch="counted"');
    expect(html).not.toContain("no agent working");
  });

  it("draw one glyph for each of the six doors, named by a string as the page names them", () => {
    for (const door of DOOR_IDS) expect(render(DoorThumb, { door })).toContain("hv-thumb");
  });

  it("add no counted word to the page", () => {
    expect(words(render(ProblemFilm, { play: 1 }))).toEqual([]);
    for (const step of STEP_IDS) expect(words(render(StepDrawing, { step, active: true }))).toEqual([]);
    for (const door of DOOR_IDS) expect(words(render(DoorThumb, { door }))).toEqual([]);
  });
});
