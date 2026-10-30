import { describe, expect, it } from "vitest";
import { loopAt, loopLength, type LoopSpec } from "./loop";

const SPEC: LoopSpec = { enter: 1, run: 8, rest: 2, leave: 1 };

describe("the loop", () => {
  it("grows the tree with the run at its start, plays the run, rests on its end, then folds the tree back", () => {
    expect(loopLength(SPEC)).toBe(12);
    expect(loopAt(0, SPEC)).toEqual({ phase: "enter", p: 0, appear: 0, round: 0 });
    expect(loopAt(0.5, SPEC)).toMatchObject({ phase: "enter", p: 0, appear: 0.5 });
    expect(loopAt(1, SPEC)).toMatchObject({ phase: "run", p: 0, appear: 1 });
    expect(loopAt(5, SPEC)).toMatchObject({ phase: "run", p: 0.5, appear: 1 });
    expect(loopAt(9, SPEC)).toMatchObject({ phase: "rest", p: 1, appear: 1 });
    expect(loopAt(10.9, SPEC)).toMatchObject({ phase: "rest", p: 1, appear: 1 });
    expect(loopAt(11, SPEC)).toMatchObject({ phase: "leave", p: 1, appear: 1 });
    expect(loopAt(11.5, SPEC)).toMatchObject({ phase: "leave", p: 1, appear: 0.5 });
  });

  it("starts the next round from the start, and counts the rounds", () => {
    expect(loopAt(12, SPEC)).toEqual({ phase: "enter", p: 0, appear: 0, round: 1 });
    expect(loopAt(12 * 5 + 5, SPEC)).toMatchObject({ phase: "run", p: 0.5, round: 5 });
  });

  it("never lets the run go past its end or the tree out of 0..1, and never goes backwards within a phase", () => {
    let last = loopAt(0, SPEC);
    for (let t = 0; t <= 60; t += 0.01) {
      const now = loopAt(t, SPEC);
      expect(now.p).toBeGreaterThanOrEqual(0);
      expect(now.p).toBeLessThanOrEqual(1);
      expect(now.appear).toBeGreaterThanOrEqual(0);
      expect(now.appear).toBeLessThanOrEqual(1);
      if (now.round === last.round && now.phase === last.phase) {
        expect(now.p).toBeGreaterThanOrEqual(last.p);
        expect(now.phase === "leave" ? -now.appear : now.appear).toBeGreaterThanOrEqual(now.phase === "leave" ? -last.appear : last.appear);
      }
      last = now;
    }
  });

  it("is the start of the loop for a time that is not a time", () => {
    for (const t of [-3, Number.NaN, Number.NEGATIVE_INFINITY]) expect(loopAt(t, SPEC)).toMatchObject({ phase: "enter", p: 0, appear: 0, round: 0 });
  });
});
