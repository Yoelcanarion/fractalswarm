import { describe, expect, it } from "vitest";

import { rivalOrder } from "./honesty";
import { localityCounts, regimeRows } from "./regime";
import { parsedSample } from "./testing";

const rows = (rival: string) => regimeRows(parsedSample(), rival);
const byTitle = (rival: string, title: string) => {
  const row = rows(rival).find((r) => r.title === title);
  if (!row) throw new Error(`no row ${title}`);
  return row;
};

describe("the regime map", () => {
  it("draws the gate for each task, then each sweep, in the order the bench describes them", () => {
    expect(rows("durable-max").map((r) => [r.title, r.cells.length])).toEqual([
      ["Failures · T2 conference", 3],
      ["Failures · T1 extraction", 3],
      ["Detection time", 7],
      ["Restart time", 3],
      ["Fast external restart", 2],
      ["Coordination density", 4],
      ["Team width", 5],
    ]);
  });

  it("puts each setting where it belongs, smallest first, in the words a person reads", () => {
    const settings = (title: string) => byTitle("durable-max", title).cells.map((c) => c.setting);
    expect(settings("Failures · T2 conference")).toEqual(["C1", "C2", "C3"]);
    expect(settings("Detection time")).toEqual(["0.5 s", "1 s", "2 s", "2.5 s", "5 s", "10 s", "20 s"]);
    expect(settings("Restart time")).toEqual(["0 s", "1 s", "3 s"]);
    expect(settings("Fast external restart")).toEqual(["0.5 s", "1 s"]);
    expect(settings("Coordination density")).toEqual(["0.25×", "0.5×", "1×", "2×"]);
    expect(settings("Team width")).toEqual(["4 agents", "8 agents", "12 agents", "24 agents", "48 agents"]);
    expect(byTitle("durable-max", "Failures · T2 conference").cells.map((c) => c.sub)).toEqual(["1 crash", "3 crashes", "5 crashes"]);
    expect(byTitle("durable-max", "Detection time").cells.every((c) => c.sub === null)).toBe(true);
  });

  it("marks the cells that decide the outcome: the gate's default settings and the plausible region", () => {
    const decides = (title: string) => byTitle("durable-max", title).cells.map((c) => c.decides);
    expect(decides("Failures · T2 conference")).toEqual([false, true, true]); // the gate reads C2 and C3
    expect(decides("Failures · T1 extraction")).toEqual([false, false, false]); // T2 is the deciding task
    expect(decides("Detection time")).toEqual([false, true, true, true, true, true, false]); // 0.5 s and 20 s are only conditions
    expect(decides("Restart time")).toEqual([true, true, true]);
    expect(decides("Fast external restart")).toEqual([true, true]);
    expect(decides("Coordination density")).toEqual([false, false, false, false]);
    expect(decides("Team width")).toEqual([false, false, false, false, false]);
  });

  it("keeps a point's locality as the bench gave it, the losses included", () => {
    const fast = byTitle("durable-max", "Fast external restart").cells;
    expect(fast.map((c) => c.point.locality)).toEqual(["fails", "fails"]);
    expect(fast[0].point.ratios.cdt).toBeCloseTo(13.2, 1);
    expect(byTitle("durable-max", "Restart time").cells.map((c) => c.point.locality)).toEqual(["ties", "holds", "holds"]);
  });

  it("counts the localities of the points it draws", () => {
    expect(localityCounts(rows("durable-max"))).toEqual({ holds: 7, ties: 18, fails: 2, "n/a": 0 });
    expect(localityCounts(rows("durable"))).toEqual({ holds: 18, ties: 8, fails: 1, "n/a": 0 });
    expect(localityCounts(rows("central"))).toEqual({ holds: 2, ties: 4, fails: 0, "n/a": 0 });
  });

  it("draws only the gate against a rival that was not swept", () => {
    expect(rows("central").map((r) => [r.title, r.cells.length])).toEqual([
      ["Failures · T2 conference", 3],
      ["Failures · T1 extraction", 3],
    ]);
    expect(rows("nobody")).toEqual([]);
  });

  it("gives every row and cell its own key, and draws every point of every rival once", () => {
    const h = parsedSample();
    let drawn = 0;
    for (const rival of rivalOrder(h)) {
      const r = regimeRows(h, rival);
      expect(new Set(r.map((row) => row.id)).size).toBe(r.length);
      const keys = r.flatMap((row) => row.cells.map((c) => c.key));
      expect(new Set(keys).size).toBe(keys.length);
      drawn += keys.length;
    }
    expect(drawn).toBe(h.regimes.length);
  });
});
