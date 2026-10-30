import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { HrwPanels } from "./HrwPanels";
import { digitsShown, groupHex, hrwState, rowsOf } from "./state";

describe("the heir computation", () => {
  it("groups a score in fours and reveals it digit by digit, never beyond 16", () => {
    expect(groupHex("e5ec11ec2d057b7e")).toBe("e5ec 11ec 2d05 7b7e");
    expect(groupHex("e5ec")).toBe("e5ec");
    expect(digitsShown(0)).toBe(0);
    expect(digitsShown(1)).toBe(16);
    expect(digitsShown(0.5)).toBeGreaterThan(5);
    let last = 0;
    for (let i = 0; i <= 100; i++) {
      const n = digitsShown(i / 100);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it("runs its steps in order: appear, compute, decide, agree", () => {
    expect(hrwState(0)).toEqual({ appear: 0, compute: 0, decide: 0, agree: 0 });
    expect(hrwState(1)).toEqual({ appear: 1, compute: 1, decide: 1, agree: 1 });
    const mid = hrwState(0.4);
    expect(mid.appear).toBe(1);
    expect(mid.compute).toBeGreaterThan(0);
    expect(mid.decide).toBe(0);
  });

  it("lists the pool in its own order and marks the log's heir as the winner", () => {
    for (const round of story.hrw.rounds) {
      const rows = rowsOf(round);
      expect(rows.map((r) => r.member)).toEqual(round.pool);
      expect(rows.filter((r) => r.win).map((r) => r.member)).toEqual([round.heir]);
      const best = rows.reduce((a, b) => (a.score > b.score ? a : b));
      expect(best.member).toBe(round.heir);
    }
  });
});

describe("HrwPanels markup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("draws one panel per survivor of the round, each with every candidate's real score", () => {
    for (const [i, round] of story.hrw.rounds.entries()) {
      const html = renderToStaticMarkup(createElement(HrwPanels, { progress: motionValue(0), data: story.hrw, still: true, round: i }));
      expect(html.match(/data-panel="/g)).toHaveLength(round.survivors.length);
      expect(html.match(/data-row="/g)).toHaveLength(round.survivors.length * round.pool.length);
      for (const s of round.scores) expect(html).toContain(groupHex(s.score));
      expect(html).toContain(`${round.survivors.length} of ${round.survivors.length} pick`);
      expect(html).not.toMatch(/NaN|undefined/);
    }
  });
});
