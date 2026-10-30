// The redesigned page's visuals (redesign.md): what each draws on the server, what it takes from the home data, and the words that
// must not be there. Their motion is tested where it is made (ease.test.ts, demo/stage.test.ts); here, the markup and the data.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { story } from "../data/story";
import { barShare, proofPanels, proofText } from "./charts/proof";
import { ProofBars } from "./charts/ProofBars";
import { KillDemo } from "./demo/KillDemo";
import { DOOR_IDS } from "./doors/doors";
import { DoorThumb } from "./doors/DoorThumb";
import { ProblemFilm } from "./film/ProblemFilm";
import { grown, GrowNumber } from "./parts/GrowNumber";
import { STEP_IDS, StepDrawing } from "./steps/StepDrawing";

beforeEach(() => {
  // React warns that useLayoutEffect does nothing on the server; the markup is what is under test.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const render = <P extends object>(type: (props: P) => unknown, props: P): string => renderToStaticMarkup(createElement(type as never, props as never));

describe("the click demo's markup", () => {
  const html = render(KillDemo, {});

  it("puts a button over every one of the ten coordinators, each with a name, and none over an agent", () => {
    expect(html.match(/data-pick="/g)).toHaveLength(story.tree.counts.orchestrators);
    for (const n of story.tree.nodes.filter((x) => x.kind === "brain")) expect(html).toContain(`aria-label="Crash ${n.label} (${n.id})"`);
    expect(html).not.toContain('data-pick="o1.1.a1"');
  });

  it("has the two buttons, the live line and the sentence that says it is an illustration", () => {
    expect(html).toContain("Kill half");
    expect(html).toContain("Reset");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("An illustration in your browser, not a real run.");
    expect(html).toContain("Click a coordinator to crash it");
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
    expect(html).not.toContain(story.proof.lines[0]?.slice(0, 12) ?? "no-proof-line");
    for (const k of story.tree.kills) expect(html).not.toContain(`${(k.atMs / 1000).toFixed(1)} s`);
    expect(html).not.toContain("talks");
  });

  it("is quiet for a still page: no ambient layer", () => {
    expect(render(KillDemo, { still: true })).not.toContain("hv-amb-halo");
  });
});

describe("the Proof's bars", () => {
  const panels = proofPanels(story);

  it("read the swarm against the in-process supervisor from the data, and against the ideal durable supervisor too", () => {
    expect(panels.map((p) => p.id)).toEqual(["central", "durable-max"]);
    const [central, durable] = panels;
    expect(central?.rival).toBe(story.workflows["central"]);
    expect(durable?.rival).toBe(story.workflows["durable-max"]);
    expect(central?.rows[0]).toMatchObject({ swarm: story.numbers.r5.t2.swarmStallS, rival: story.numbers.r5.t2.centralStallS, unit: "s" });
    expect(durable?.rows[0]).toMatchObject({ swarm: story.numbers.r2.swarmStallS, rival: story.numbers.r2.durableMaxStallS, unit: "s" });
  });

  it("print the setting of each: the task and the seeds", () => {
    expect(panels[0]?.setting).toBe(`T2 conference · ${story.numbers.r5.t2.seeds} seeds`);
    expect(panels[1]?.setting).toBe(`T2 conference · ${story.numbers.r2.seeds} seeds`);
  });

  it("print the data's verdict beside the ideal durable supervisor, as it is, and never call a tie a win", () => {
    const verdicts = story.verdicts?.comparisons ?? [];
    const want = (metric: string): string | undefined => verdicts.find((c) => c.rival === "durable-max" && c.metric === metric)?.verdict;
    expect(panels[1]?.rows.map((r) => r.verdict)).toEqual([want("stall_s") ?? null, want("extra_cost_pct") ?? null]);
    expect(panels[0]?.rows.every((r) => r.verdict === null)).toBe(true);
    const html = render(ProofBars, { play: 1 });
    for (const row of panels[1]?.rows ?? []) if (row.verdict === "tie") expect(html).toContain('<span class="hv-proof-verdict">tie</span>');
    expect(html).not.toMatch(/\bwin\b|faster|cheaper|simpler|more reliable/i);
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

  it("draw a bar for every value that is above nothing, and write the rest", () => {
    const html = render(ProofBars, { play: 1 });
    const drawable = panels.flatMap((p) => p.rows).filter((r) => r.swarm >= 0 && r.rival >= 0).length * 2;
    expect(html.match(/class="hv-proof-bar"/g)).toHaveLength(drawable);
    expect(html).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("are at nothing before the page plays them, grow when it does and are whole for a still page", () => {
    expect(render(ProofBars, { play: 0 })).toContain('data-play="off"');
    expect(render(ProofBars, { play: 1 })).toContain('data-play="on"');
    expect(render(ProofBars, { play: 0, still: true })).toContain('data-play="still"');
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

  it("draw the heir's bars from the recorded round, best first, with no number", () => {
    const html = render(StepDrawing, { step: "heir", active: false });
    const first = story.hrw.rounds[0]?.scores ?? [];
    expect(first.length).toBeGreaterThan(1);
    for (const s of first) expect(html).toContain(`--w:${s.fraction.toFixed(3)}`);
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

  it("draw one glyph for each of the six doors", () => {
    for (const door of DOOR_IDS) expect(render(DoorThumb, { door })).toContain("hv-thumb");
  });
});
