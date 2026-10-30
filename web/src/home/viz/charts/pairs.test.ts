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
  verdictWords,
  type PairLayout,
  type PairRig,
} from "./pairs";
import { PairedBars } from "./PairedBars";

const data = story.verdicts!;
const model = pairModel(data);
const captions = pairCaptions(model);

// What the tests below read comes from the data and none of it is typed here: a new reading changes the data and these follow it.
const verdictOf = (rival: string, hypothesis: string) => data.comparisons.find((c) => c.rival === rival && c.hypothesis === hypothesis)!;
const rule = data.rules["tie"] as string;
const WORDS = "the seeds disagree";

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

  it("reads the figures of the data as they are: the swarm's mean and the rival's, and the swarm's as a part of the rival's", () => {
    expect(model.rows.map((r) => [r.swarm, r.rival])).toEqual(model.rows.map((r) => [verdictOf("durable-max", r.hypothesis).swarm, verdictOf("durable-max", r.hypothesis).rivalValue]));
    for (const r of model.rows) expect(r.fraction, r.hypothesis).toBeCloseTo(r.swarm / r.rival, 12);
    // and written the way the page writes them: one decimal, the unit of the measure
    expect(model.rows.map((r) => [valueText(r, r.swarm), valueText(r, r.rival)])).toEqual(
      model.rows.map((r) => [`${r.swarm.toFixed(1)}${r.unit}`, `${r.rival.toFixed(1)}${r.unit}`]),
    );
    expect(valueText({ unit: " s" } as (typeof model.rows)[number], 6.94)).toBe("6.9 s");
    expect(valueText({ unit: "%" } as (typeof model.rows)[number], 23.33)).toBe("23.3%");
    expect(valueText({ unit: "" } as (typeof model.rows)[number], 24.381)).toBe("24.4");
  });

  it("takes the verdicts as the generator copied them from the pre-registered rule, and the other rival's beside them", () => {
    expect(model.rows.map((r) => [r.verdict, r.mixed])).toEqual(model.rows.map((r) => [verdictOf("durable-max", r.hypothesis).verdict, verdictOf("durable-max", r.hypothesis).mixed]));
    expect(model.rows.map((r) => r.other?.verdict)).toEqual(model.rows.map((r) => verdictOf("durable", r.hypothesis).verdict));
    expect(model.rows.map((r) => r.other?.mixed)).toEqual(model.rows.map((r) => verdictOf("durable", r.hypothesis).mixed));
    expect(model.rows.map((r) => r.other?.ratio)).toEqual(model.rows.map((r) => verdictOf("durable", r.hypothesis).ratio));
    expect(model.rule).toBe(rule);
  });

  it("says that the seeds disagree where they do, in the words of the rule: a verdict is never a tie without its reason", () => {
    expect(verdictWords("tie", true)).toBe(`tie, ${WORDS}`);
    expect(verdictWords("win", false)).toBe("win");
    expect(rule).toContain("every seed agrees");
    // the strictest rival's rows are ties on locality, and the seeds disagree on them: that is what R4 says, so the chart must too
    const mixed = model.rows.filter((r) => r.mixed);
    expect(mixed.length).toBeGreaterThan(0);
    for (const r of mixed) expect(r.verdict, r.hypothesis).toBe("tie");
  });

  it("names its setting from the data: the task, the real model, the seeds and the failure profile", () => {
    const first = verdictOf("durable-max", "H4a");
    expect([model.task, model.real, model.profile, model.seeds]).toEqual([data.task, true, first.profile, first.seeds]);
    expect(captions[0]).toBe(`T2 conference · failure profile ${first.profile} · real model · ${first.seeds.length} seeds · means of the seeds; verdicts by the pre-registered per-seed rule`);
    expect(captions[2]).toBe(`T2 · ${first.profile} · real model · ${first.seeds.length} seeds`);
  });

  it("says nothing of the model when the data does not, and never makes it up", () => {
    const bare: VerdictsSlice = { ...data, task: undefined, model: undefined, real: undefined };
    const m = pairModel(bare);
    expect([m.task, m.real]).toEqual([null, null]);
    expect(pairCaptions(m)[2]).toBe(`${m.profile} · ${m.seeds.length} seeds`);
  });

  it("lets the axis run on when the swarm's bar is the longer, and says that the seeds disagree on a verdict that does", () => {
    const h4b = verdictOf("durable-max", "H4b");
    const odd: VerdictsSlice = {
      ...data,
      comparisons: data.comparisons.map((c) => (c.rival === "durable-max" && c.hypothesis === "H4b" ? { ...c, swarm: 2 * h4b.rivalValue!, verdict: "loss", mixed: true } : c)),
    };
    const m = pairModel(odd);
    expect(m.domainMax).toBe(2);
    expect(m.rows[1]!.fraction).toBeCloseTo(2, 9);
    const layout = pairLayout(m, 1100, 420, pairCaptions(m));
    expect(layout.groups[1]!.swarm.w).toBeGreaterThan(layout.groups[1]!.rival.w);
    expect(layout.ticks.map((t) => t.label)).toEqual(["0%", "50%", "100%", "150%", "200%"]);
    expect(layout.groups[1]!.pill.text).toBe(`loss · ${WORDS}`);
  });

  it("tells the figures in its text alternative, the verdicts as the rule gave them with the seeds that disagree, and nothing the claims do not say", () => {
    const text = pairSummary(model);
    for (const r of model.rows) {
      expect(text).toContain(`${r.name}: FractalSwarm ${valueText(r, r.swarm)} against Ideal durable supervisor ${valueText(r, r.rival)}, ${Math.round(r.fraction * 100)}% of it, verdict ${verdictWords(r.verdict, r.mixed)}`);
    }
    expect(text).toContain(`T2 conference on the real model, ${model.seeds.length} seeds, failure profile ${model.profile}`);
    expect(text).toContain(`The rule: ${rule}`);
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
  [326, 388],
  [292, 388],
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
    // the title and the verdict do not meet: the unit goes where there is no room for it, and the name is written smaller
    const title = textWidth(row.name, layout.titleSize === null ? 13 : (layout.titleSize * 13) / 13.5) + (g.sub ? 8 + textWidth(row.sub) : 0);
    expect(layout.labelX + title, `${label} title`).toBeLessThanOrEqual(g.pill.x - 6);
    expect(g.pill.x + g.pill.w, label).toBeLessThanOrEqual(layout.width - 10 + 0.001);
    // each group clears the next
    const next = layout.groups[i + 1];
    if (next) expect(g.rival.y + g.rival.h, label).toBeLessThan(next.titleY - 8);
    // the bars' names fit their column
    expect(layout.labelX + textWidth(layout.names === "full" ? "Ideal durable supervisor" : "FractalSwarm"), label).toBeLessThanOrEqual(layout.x0);
  });
  expect(layout.axisY, label).toBeGreaterThan(layout.groups[layout.groups.length - 1]!.rival.y + layout.barH);
  expect(layout.axisTitle.y + 10, label).toBeLessThanOrEqual(layout.keyY);
  // what the verdicts whose seeds disagree mean: one row under the key, inside the box, and the caption under it
  if (layout.note) {
    expect(layout.noteY, label).toBeGreaterThan(layout.keyY);
    expect(layout.noteX, `${label} note`).toBeGreaterThanOrEqual(10);
    expect(layout.noteX + textWidth(layout.note), `${label} note`).toBeLessThanOrEqual(layout.width - 10 + 0.001);
    if (layout.caption) expect(layout.noteY, label).toBeLessThan(layout.captionY);
  }
  // a star is never left without its meaning
  if (layout.groups.some((g) => g.pill.text.endsWith("*"))) expect(layout.note, `${label} says what the star means`).toMatch(/^\* the seeds disagree/);
  expect(layout.axisTitle.y, label).toBeGreaterThan(layout.axisY + 24);
  expect(layout.axisTitle.x + textWidth(layout.axisTitle.text), label).toBeLessThanOrEqual(layout.width - 10);
  expect(layout.halfX, label).toBeCloseTo((layout.xAt(0) + layout.xAt(1)) / 2, 6);
  expect(layout.x1 - layout.x0, label).toBeGreaterThanOrEqual(100);
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
    // a bar ends before the line when the swarm's value is under half the rival's: whether that is a win is the rule's to say, not the bar's
    l.groups.forEach((g, i) => expect(g.swarm.x + g.swarm.w < l.halfX, model.rows[i]!.hypothesis).toBe(model.rows[i]!.fraction < 0.5));
  });

  it("puts the words in each pill where they fit, and a star with its meaning under the chart where they do not", () => {
    const wide = pairLayout(model, 1100, 420, captions);
    expect(wide.groups.map((g) => g.pill.text)).toEqual(model.rows.map((r) => (r.mixed ? `${r.verdict} · ${WORDS}` : r.verdict)));
    expect(wide.note).toBe(`The rule: ${rule}`);
    const narrow = pairLayout(model, 350, 388, captions);
    expect(narrow.groups.map((g) => g.pill.text)).toEqual(model.rows.map((r) => (r.mixed ? `${r.verdict}*` : r.verdict)));
    expect(narrow.note.startsWith(`* ${WORDS}`)).toBe(true);
    // between the two, one pill's words do not fit and so none of them is in words: the pills are alike
    for (let width = 300; width <= 1700; width += 4) {
      const l = pairLayout(model, width, 420, captions);
      const stars = l.groups.filter((g) => g.pill.text.endsWith("*")).length;
      const words = l.groups.filter((g) => g.pill.text.includes(WORDS)).length;
      expect(stars === 0 || words === 0, `${width}: stars and words side by side`).toBe(true);
    }
  });

  it("keeps the verdict off the measure's name at every width a phone gives the chart, dropping the unit where it must", () => {
    for (let width = 280; width <= 700; width += 2) {
      const layout = pairLayout(model, width, 388, captions);
      layout.groups.forEach((g, i) => {
        const row = model.rows[i]!;
        const size = layout.titleSize === null ? 13 : (layout.titleSize * 13) / 13.5;
        expect(size, `${width} size`).toBeGreaterThanOrEqual(10.5);
        expect(layout.labelX + textWidth(row.name, size) + 6, `${width} ${row.name}`).toBeLessThanOrEqual(g.pill.x);
      });
    }
    // on the narrowest the unit is dropped and the name is smaller, and on a wide screen neither
    expect(pairLayout(model, 292, 388, captions).groups.some((g) => !g.sub)).toBe(true);
    expect(pairLayout(model, 280, 388, captions).titleSize).not.toBeNull();
    const wide = pairLayout(model, 1100, 420, captions);
    expect(wide.groups.every((g) => g.sub)).toBe(true);
    expect(wide.titleSize).toBeNull();
  });

  it("prints no note when no seeds disagree", () => {
    const calm: VerdictsSlice = { ...data, comparisons: data.comparisons.map((c) => ({ ...c, mixed: false })) };
    const m = pairModel(calm);
    expect(pairLayout(m, 1100, 420, pairCaptions(m)).note).toBe("");
    expect(pairLayout(m, 350, 388, pairCaptions(m)).note).toBe("");
    expect(pairSummary(m)).not.toContain("The rule");
  });

  it("says what 100% is under the axis, by the rival's name where it fits, and spreads the spare height around the bars", () => {
    expect(pairLayout(model, 1100, 420, captions).axisTitle.text).toBe("% of the ideal durable supervisor's value");
    expect(pairLayout(model, 350, 388, captions).axisTitle.text).toBe("% of the rival's value");
    const tall = pairLayout(model, 1100, 700, captions);
    const top = tall.groups[0]!.titleY;
    expect(top).toBeGreaterThan(40);
    const bottom = tall.height - tall.axisTitle.y;
    expect(Math.abs(top - bottom)).toBeLessThan(120);
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

  it("draws a pair of bars for each measure, with the values and the verdict of each, and says that the seeds disagree where they do", () => {
    expect(html.match(/data-bar="rival"/g)).toHaveLength(3);
    expect(html.match(/data-bar="swarm"/g)).toHaveLength(3);
    expect(html.match(/class="hv-pb-pill"/g)).toHaveLength(3);
    for (const r of model.rows) {
      expect(html).toContain(`>${valueText(r, r.swarm)}<`);
      expect(html).toContain(`>${valueText(r, r.rival)}<`);
      expect(html).toContain(`>${r.mixed ? `${r.verdict} · ${WORDS}` : r.verdict}<`);
    }
    const first = model.rows[0]!;
    expect(html).toContain(`FractalSwarm, ${first.name}: ${valueText(first, first.swarm)}, ${Math.round(first.fraction * 100)}% of the ideal durable supervisor&#x27;s ${valueText(first, first.rival)}`);
    // the rule, in the data's words, under the key
    expect(html).toContain(`The rule: ${rule}`);
    expect(html).not.toContain("*");
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
    expect(html).toContain(`${model.seeds.length} seeds`);
    expect(html).toContain("half of the ideal durable supervisor&#x27;s value");
    const quiet = renderToStaticMarkup(createElement(PairedBars, { progress: motionValue(0), data, still: true, setting: false }));
    expect(quiet).not.toContain("hv-ch-caption");
    // what the verdicts mean is not part of the setting: a page that prints the setting itself still gets it
    expect(quiet).toContain(`The rule: ${rule}`);
  });

  it("can be held against the other rival", () => {
    const out = renderToStaticMarkup(createElement(PairedBars, { progress: motionValue(0), data, still: true, rival: "durable" }));
    expect(out).toContain("Realistic durable supervisor");
    const h4a = verdictOf("durable", "H4a");
    expect(out).toContain(`>${h4a.rivalValue!.toFixed(1)} s<`);
    expect(out).toContain(`>${h4a.verdict}<`);
  });

  it("keeps its table's verdicts in words, with the seeds that disagree, and no star the table does not explain", () => {
    for (const r of model.rows) expect(html).toContain(`<td>${verdictWords(r.verdict, r.mixed)}</td>`);
    expect(html).not.toMatch(/<td>[a-z]+\*<\/td>/);
  });

  it("has no number that is not a number", () => {
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });
});
