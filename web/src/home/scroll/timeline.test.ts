import { describe, expect, it } from "vitest";

import { buildTimeline, clamp01, interpolate, smoothstep, type StepSpec } from "./timeline";

const steps: StepSpec[] = [
  { id: "a", at: 0 },
  { id: "b", at: 0.5, weight: 2 },
  { id: "c", at: 1, hold: 1 },
];

describe("interpolate", () => {
  const points: [number, number][] = [
    [0, 0],
    [2, 10],
    [4, 10],
    [8, 0],
  ];
  it("is linear between points and flat beyond the ends", () => {
    expect(interpolate(points, -5)).toBe(0);
    expect(interpolate(points, 1)).toBe(5);
    expect(interpolate(points, 3)).toBe(10);
    expect(interpolate(points, 6)).toBe(5);
    expect(interpolate(points, 99)).toBe(0);
  });

  it("copes with a repeated x and with no points", () => {
    expect(interpolate([[1, 3], [1, 7]], 1)).toBe(3);
    expect(interpolate([], 4)).toBe(0);
  });
});

describe("clamp01 and smoothstep", () => {
  it("stay inside 0..1", () => {
    expect([clamp01(-1), clamp01(0.3), clamp01(4)]).toEqual([0, 0.3, 1]);
    expect(smoothstep(-2)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
  });
});

describe("a stage timeline", () => {
  const timeline = buildTimeline(steps);

  it("is as high as its blocks, and each block starts where the last one ends", () => {
    expect(timeline.height).toBe(4);
    expect(timeline.blocks.map((b) => [b.start, b.centre, b.end])).toEqual([
      [0, 0.5, 1],
      [1, 2, 3],
      [3, 3.5, 4],
    ]);
  });

  it("puts the reading line at the anchor at the top and at the end of the pinned scroll", () => {
    expect(timeline.readingLine(0)).toBe(0.5);
    expect(timeline.readingLine(1)).toBe(3.5);
    expect(timeline.readingLine(-1)).toBe(0.5);
    expect(timeline.readingLine(9)).toBe(3.5);
    const lower = buildTimeline(steps, { anchor: 0.7 });
    expect(lower.readingLine(0)).toBeCloseTo(0.7);
    expect(lower.readingLine(1)).toBeCloseTo(3.7);
  });

  it("says which block is under the reading line", () => {
    expect(timeline.stepAt(0)).toBe(0);
    expect(timeline.stepAt(0.2)).toBe(1); // the line is at 1.1 vh, in block b (1 to 3)
    expect(timeline.stepAt(0.8)).toBe(1); // 2.9 vh: still b
    expect(timeline.stepAt(0.9)).toBe(2); // 3.2 vh
    expect(timeline.stepAt(1)).toBe(2);
  });

  it("gives the visual each step's keyframe when its card is on the reading line", () => {
    timeline.blocks.forEach((block, i) => {
      expect(timeline.visualAt(timeline.progressAtStep(i))).toBeCloseTo(block.at, 10);
    });
  });

  it("holds the visual still around a card and moves it linearly in between", () => {
    const at = (line: number) => timeline.visualAt((line - 0.5) / 3);
    // block b: centre 2, weight 2, hold 0.4 -> flat from 1.6 to 2.4
    expect(at(1.7)).toBeCloseTo(0.5);
    expect(at(2.0)).toBeCloseTo(0.5);
    expect(at(2.3)).toBeCloseTo(0.5);
    // between the end of a's hold (0.7) and the start of b's (1.6): from 0 to 0.5, so halfway is 1.15
    expect(at(1.15)).toBeCloseTo(0.25, 5);
    expect(at(0.6)).toBeCloseTo(0);
  });

  it("counts the reading line in steps: whole numbers on the cards, fractions between them", () => {
    timeline.blocks.forEach((_, i) => expect(timeline.positionAt(timeline.progressAtStep(i))).toBeCloseTo(i, 10));
    expect(timeline.positionAt(0)).toBe(0);
    expect(timeline.positionAt(1)).toBe(2);
    expect(timeline.positionAt((1.25 - 0.5) / 3)).toBeCloseTo(0.5, 10); // half-way between centres 0.5 and 2 is 1.25 vh
  });

  it("never runs backwards when the keyframes rise, and stays inside the first and last keyframe", () => {
    let last = -1;
    for (let i = 0; i <= 200; i++) {
      const value = timeline.visualAt(i / 200);
      expect(value).toBeGreaterThanOrEqual(last - 1e-12);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      last = value;
    }
  });

  it("fades a card out as it leaves the reading line", () => {
    const centred = timeline.progressAtStep(1);
    expect(timeline.cardOpacity(centred, 1)).toBe(1);
    expect(timeline.cardOpacity(centred, 0)).toBe(0);
    expect(timeline.cardOpacity(centred, 2)).toBe(0);
    // 0.3 vh away: part-way, and the same on either side
    const near = (offset: number) => timeline.cardOpacity((2 + offset - 0.5) / 3, 1);
    expect(near(0.3)).toBeGreaterThan(0);
    expect(near(0.3)).toBeLessThan(1);
    expect(near(0.3)).toBeCloseTo(near(-0.3), 10);
  });

  it("clamps the progress that brings a card to the reading line", () => {
    expect(timeline.progressAtStep(0)).toBe(0);
    expect(timeline.progressAtStep(2)).toBe(1);
    expect(timeline.progressAtStep(1)).toBeCloseTo(0.5);
  });

  it("copes with a stage that is one viewport high, which never pins", () => {
    const one = buildTimeline([{ id: "only", at: 0.7 }]);
    expect(one.height).toBe(1);
    expect(one.visualAt(0)).toBeCloseTo(0.7);
    expect(one.visualAt(1)).toBeCloseTo(0.7);
    expect(one.progressAtStep(0)).toBe(0);
    expect(one.stepAt(0.5)).toBe(0);
  });

  it("refuses a stage with no steps, or a step with no height", () => {
    expect(() => buildTimeline([])).toThrow(/at least one/);
    expect(() => buildTimeline([{ id: "x", at: 0, weight: 0 }])).toThrow(/weight/);
  });
});
