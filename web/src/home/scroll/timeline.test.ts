import { describe, expect, it } from "vitest";

import { buildPlan, clamp01, defaultPlay, MAIN, MAX_SECONDS, MIN_SECONDS, stepAtLine, type Block, type StepSpec } from "./timeline";

describe("clamp01", () => {
  it("stays inside 0..1", () => {
    expect([clamp01(-1), clamp01(0.3), clamp01(4)]).toEqual([0, 0.3, 1]);
  });
});

describe("a plan", () => {
  const specs: StepSpec[] = [
    { id: "a", at: 0, layers: { strip: 0, tree: 1 } },
    { id: "b", at: 0.25, play: 1.2 },
    { id: "c", at: 0.5, play: 2, to: { hrw: 1 }, layers: { tree: 0.12, hrw: 1 } },
    { id: "d", at: 1, play: 1.5, layers: { tree: 1, strip: 1 } },
  ];
  const plan = buildPlan(specs);

  it("knows its channels and layers from what the steps name", () => {
    expect(plan.channels).toEqual(["hrw"]);
    expect(plan.layerNames).toEqual(["strip", "tree", "hrw"]);
    expect(plan.steps.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("targets the main channel with `at`", () => {
    expect(plan.steps.map((_, i) => plan.target(i, MAIN))).toEqual([0, 0.25, 0.5, 1]);
  });

  it("keeps a channel's last target until a step names it again, and starts it at 0", () => {
    expect([0, 1, 2, 3].map((i) => plan.target(i, "hrw"))).toEqual([0, 0, 1, 1]);
  });

  it("keeps a layer's last value until a step names it again, and starts it at 1", () => {
    expect([0, 1, 2, 3].map((i) => plan.layer(i, "tree"))).toEqual([1, 1, 0.12, 1]);
    expect([0, 1, 2, 3].map((i) => plan.layer(i, "strip"))).toEqual([0, 0, 0, 1]);
    // `hrw` is first named by step c: before it the layer is at its starting value
    expect([0, 1, 2, 3].map((i) => plan.layer(i, "hrw"))).toEqual([1, 1, 1, 1]);
  });

  it("answers for a step outside the plan with the nearest one", () => {
    expect(plan.target(-3, MAIN)).toBe(0);
    expect(plan.target(99, MAIN)).toBe(1);
    expect(plan.layer(99, "tree")).toBe(1);
  });

  it("gives every step the least height of half a screen unless it says more", () => {
    expect(plan.steps.map((s) => s.weight)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(buildPlan([{ id: "x", at: 0, weight: 1 }]).steps[0].weight).toBe(1);
  });

  it("plays a step that does not say in between 0.8 and 1.4 seconds, longer for a longer way", () => {
    expect(defaultPlay(0)).toBe(0.8);
    expect(defaultPlay(0.1)).toBeCloseTo(1.04);
    expect(defaultPlay(0.9)).toBe(1.4);
    expect(defaultPlay(-0.1)).toBeCloseTo(1.04);
    const tour = buildPlan([
      { id: "a", at: 0 },
      { id: "b", at: 0.1 },
      { id: "c", at: 1 },
    ]);
    expect(tour.steps.map((s) => s.play)).toEqual([0.8, 1.04, 1.4]);
  });

  it("rejects what cannot be played", () => {
    expect(() => buildPlan([])).toThrow();
    expect(() => buildPlan([{ id: "a", at: 0 }, { id: "a", at: 1 }])).toThrow(/twice/);
    expect(() => buildPlan([{ id: "a", at: 0, weight: 0 }])).toThrow(/weight/);
    expect(() => buildPlan([{ id: "a", at: 0, play: 0 }])).toThrow(/play/);
    expect(() => buildPlan([{ id: "a", at: Number.NaN }])).toThrow(/at/);
    expect(() => buildPlan([{ id: "a", at: 0, to: { [MAIN]: 1 } }])).toThrow(/main channel/);
  });

  it("keeps every target inside 0..1", () => {
    const wild = buildPlan([{ id: "a", at: 4, to: { x: -2 }, layers: { y: 7 } }]);
    expect([wild.target(0, MAIN), wild.target(0, "x"), wild.layer(0, "y")]).toEqual([1, 0, 1]);
  });
});

describe("how long a move takes", () => {
  const plan = buildPlan([
    { id: "a", at: 0 },
    { id: "b", at: 0.1, play: 1 },
    { id: "c", at: 0.2, play: 1.4 },
    { id: "d", at: 0.9, play: 2.5 },
    { id: "e", at: 1, play: 1 },
  ]);

  it("is the step's own play for one step, either way", () => {
    expect(plan.duration(0, 1)).toBe(1);
    expect(plan.duration(1, 2)).toBe(1.4);
    expect(plan.duration(3, 2)).toBe(2.5);
    expect(plan.duration(2, 1)).toBe(1.4);
  });

  it("is nothing for no move", () => {
    expect(plan.duration(2, 2)).toBe(0);
  });

  it("plays a jump over several steps faster than the steps one after the other, within bounds", () => {
    expect(plan.duration(0, 2)).toBeCloseTo((1 + 1.4) * 0.55);
    expect(plan.duration(0, 3)).toBeCloseTo((1 + 1.4 + 2.5) * 0.55);
    for (let from = 0; from < 5; from++) {
      for (let to = 0; to < 5; to++) {
        if (from === to) continue;
        const seconds = plan.duration(from, to);
        expect(seconds).toBeGreaterThanOrEqual(MIN_SECONDS);
        expect(seconds).toBeLessThanOrEqual(MAX_SECONDS);
      }
    }
  });

  it("takes as long to go back as to come", () => {
    expect(plan.duration(4, 1)).toBe(plan.duration(1, 4));
  });
});

describe("the step under the reading line", () => {
  // three blocks one after the other, 600 px each
  const blocks: Block[] = [
    { start: 0, end: 600 },
    { start: 600, end: 1200 },
    { start: 1200, end: 1800 },
  ];

  it("is the block that holds the line", () => {
    expect(stepAtLine(blocks, 100, 0, 0)).toBe(0);
    expect(stepAtLine(blocks, 700, 0, 0)).toBe(1);
    expect(stepAtLine(blocks, 1700, 0, 0)).toBe(2);
  });

  it("clamps above the first block and below the last", () => {
    expect(stepAtLine(blocks, -500, 1, 0)).toBe(0);
    expect(stepAtLine(blocks, 9000, 0, 0)).toBe(2);
  });

  it("crosses several blocks at once when the line does", () => {
    expect(stepAtLine(blocks, 1500, 0, 40)).toBe(2);
    expect(stepAtLine(blocks, 50, 2, 40)).toBe(0);
  });

  it("holds the step until the line is a margin past the boundary, from either side", () => {
    // going down through the boundary at 600
    expect(stepAtLine(blocks, 620, 0, 40)).toBe(0);
    expect(stepAtLine(blocks, 641, 0, 40)).toBe(1);
    // coming back up through it
    expect(stepAtLine(blocks, 580, 1, 40)).toBe(1);
    expect(stepAtLine(blocks, 559, 1, 40)).toBe(0);
  });

  it("does not flicker when the line shakes about a boundary", () => {
    let step = 0;
    const seen = new Set<number>();
    for (const line of [590, 610, 595, 612, 605, 598, 615, 600]) {
      step = stepAtLine(blocks, line, step, 40);
      seen.add(step);
    }
    expect([...seen]).toEqual([0]);
  });

  it("copes with a stage that has no blocks yet and with a current step outside the blocks", () => {
    expect(stepAtLine([], 300, 0, 40)).toBe(0);
    expect(stepAtLine(blocks, 700, 9, 0)).toBe(1);
    expect(stepAtLine(blocks, 700, -4, 0)).toBe(1);
  });
});
