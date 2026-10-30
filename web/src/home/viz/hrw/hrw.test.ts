import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../../data/story";
import { HRW_TIERS, fitHrw } from "./fit";
import { HrwPanels } from "./HrwPanels";
import { digitsShown, groupHex, hiddenAt, hrwState, rowsOf } from "./state";

describe("the reveal of a score", () => {
  it("clips the whole score to the digits shown: all of it hidden at none, none of it at all, and a prefix's share of the width between", () => {
    const hex = "e5ec11ec2d057b7e";
    const hidden = hiddenAt(hex);
    expect(hidden).toHaveLength(hex.length + 1);
    expect(hidden[0]).toBe(100);
    expect(hidden[hex.length]).toBe(0);
    // four digits are "e5ec" (4 of the 19 characters), five are "e5ec 1" (6 of them: the space comes in with the digit after it)
    expect(hidden[4]).toBeCloseTo((1 - 4 / 19) * 100, 2);
    expect(hidden[5]).toBeCloseTo((1 - 6 / 19) * 100, 2);
    for (let n = 1; n < hidden.length; n++) expect(hidden[n]!, `at ${n} digits`).toBeLessThan(hidden[n - 1]!);
    // every count of digits the computation can show has an entry
    for (let i = 0; i <= 100; i++) expect(hidden[digitsShown(i / 100)]).toBeDefined();
  });

  it("is a style write per row and no text written: the markup has the whole score, clipped to none of it at the start", () => {
    const round = story.hrw.rounds[0]!;
    const html = renderToStaticMarkup(createElement(HrwPanels, { progress: motionValue(0), data: story.hrw, round: 0 }));
    expect(html.match(/class="hv-hrw-digits" style="clip-path:inset\(0 100% 0 0\)"/g)).toHaveLength(round.survivors.length * round.pool.length);
    for (const s of round.scores) expect(html).toContain(groupHex(s.score));
  });
});

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

describe("the panels in the box the page gives them", () => {
  const heightOf = (fit: ReturnType<typeof fitHrw>, candidates: number): number => {
    const spec = HRW_TIERS.find((t) => t.tier === fit.tier)!;
    return spec.head + fit.rows * spec.panel(candidates) + (fit.rows - 1) * 12 + spec.verdict;
  };

  it("draws everything in the page's stage at a desktop height, and drops the bars and the answers at a laptop's", () => {
    expect(fitHrw(9, 3, 690, 640)).toEqual({ tier: "full", cols: 3, rows: 3 });
    expect(fitHrw(9, 3, 690, 479).tier).toBe("compact");
    expect(fitHrw(9, 3, 358, 304)).toEqual({ tier: "tiny", cols: 3, rows: 3 });
  });

  it("always chooses a layout that fits when one exists, with the richest tier, and never more panels than survivors", () => {
    for (const width of [300, 358, 480, 690, 820, 1224, 1600]) {
      for (const height of [200, 260, 304, 371, 479, 584, 640, 780]) {
        for (const count of [1, 2, 4, 7, 9]) {
          const fit = fitHrw(count, 3, width, height);
          expect(fit.cols).toBeGreaterThanOrEqual(1);
          expect(fit.cols).toBeLessThanOrEqual(count);
          expect(fit.rows).toBe(Math.ceil(count / fit.cols));
          const spec = HRW_TIERS.find((t) => t.tier === fit.tier)!;
          expect((width + 12) / fit.cols - 12, `${width}x${height} ${count}`).toBeGreaterThanOrEqual(spec.minW - 0.001);
          // a richer tier that fits would have been chosen
          const richer = HRW_TIERS.slice(0, HRW_TIERS.indexOf(spec));
          for (const t of richer) {
            const most = Math.max(1, Math.min(count, Math.floor((width + 12) / (t.minW + 12))));
            for (let cols = 1; cols <= most; cols++) {
              const rows = Math.ceil(count / cols);
              expect(t.head + rows * t.panel(3) + (rows - 1) * 12 + t.verdict, `${width}x${height} ${count} ${t.tier}`).toBeGreaterThan(height);
            }
          }
          if (fit.tier !== "tiny" || heightOf(fit, 3) <= height) expect(heightOf(fit, 3), `${width}x${height} ${count}`).toBeLessThanOrEqual(height);
        }
      }
    }
  });

  it("marks the tier on the markup the box asked for, and sets its columns", () => {
    const html = renderToStaticMarkup(createElement(HrwPanels, { progress: motionValue(1), data: story.hrw, still: true }));
    expect(html).toContain('data-tier="full"');
    expect(html).toContain("grid-template-columns:repeat(3, minmax(0, 1fr))");
  });
});
