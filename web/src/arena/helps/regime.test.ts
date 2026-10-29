import { describe, expect, it } from "vitest";

import { rivalOrder } from "./honesty";
import { regimeRows } from "./regime";
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
      ["Gate · T2 conference", 3],
      ["Gate · T1 extraction", 3],
      ["Failure detection", 7],
      ["Restart or failover time", 3],
      ["Fast external restart", 2],
      ["Coordination density", 4],
      ["Width", 5],
    ]);
  });

  it("names each sweep as bench/PREREG.md §5 names the assumption it checks", () => {
    const titles = rows("durable-max").map((r) => r.title);
    for (const name of ["Failure detection", "Restart or failover time", "Fast external restart", "Coordination density", "Width"]) expect(titles).toContain(name);
  });

  it("puts each setting where it belongs, smallest first, in the words a person reads", () => {
    const settings = (title: string) => byTitle("durable-max", title).cells.map((c) => c.setting);
    expect(settings("Gate · T2 conference")).toEqual(["C1", "C2", "C3"]);
    expect(settings("Failure detection")).toEqual(["0.5 s", "1 s", "2 s", "2.5 s", "5 s", "10 s", "20 s"]);
    expect(settings("Restart or failover time")).toEqual(["0 s", "1 s", "3 s"]);
    expect(settings("Fast external restart")).toEqual(["0.5 s", "1 s"]);
    expect(settings("Coordination density")).toEqual(["0.25×", "0.5×", "1×", "2×"]);
    expect(settings("Width")).toEqual(["4 agents", "8 agents", "12 agents", "24 agents", "48 agents"]);
    expect(byTitle("durable-max", "Gate · T2 conference").cells.map((c) => c.sub)).toEqual(["1 crash", "3 crashes", "5 crashes"]);
    expect(byTitle("durable-max", "Failure detection").cells.every((c) => c.sub === null)).toBe(true);
  });

  it("marks the cells that decide the outcome: the gate's default settings and the plausible region", () => {
    const decides = (title: string) => byTitle("durable-max", title).cells.map((c) => c.decides);
    expect(decides("Gate · T2 conference")).toEqual([false, true, true]); // the gate reads C2 and C3
    expect(decides("Gate · T1 extraction")).toEqual([false, false, false]); // T2 is the deciding task
    expect(decides("Failure detection")).toEqual([false, true, true, true, true, true, false]); // 0.5 s and 20 s are only conditions
    expect(decides("Restart or failover time")).toEqual([true, true, true]);
    expect(decides("Fast external restart")).toEqual([true, true]);
    expect(decides("Coordination density")).toEqual([false, false, false, false]);
    expect(decides("Width")).toEqual([false, false, false, false, false]);
  });

  it("keeps a point's locality as the bench gave it, the losses included", () => {
    const fast = byTitle("durable-max", "Fast external restart").cells;
    expect(fast.map((c) => c.point.locality)).toEqual(["fails", "fails"]);
    expect(fast[0].point.ratios.cdt).toBeCloseTo(13.2, 1);
    expect(byTitle("durable-max", "Restart or failover time").cells.map((c) => c.point.locality)).toEqual(["ties", "holds", "holds"]);
  });

  it("draws each point with the locality the file gives it, for every rival", () => {
    const h = parsedSample();
    const drawn = (rival: string) => rows(rival).flatMap((row) => row.cells.map((c) => c.point.locality));
    const stored = (rival: string) => h.regimes.filter((r) => r.rival === rival).map((r) => r.locality);
    for (const rival of ["durable-max", "durable", "central"]) expect([...drawn(rival)].sort(), rival).toEqual([...stored(rival)].sort());
    // the sample's figures: the ideal durable supervisor holds at 7 settings, ties at 18, fails at 2
    const count = (locality: string) => drawn("durable-max").filter((l) => l === locality).length;
    expect([count("holds"), count("ties"), count("fails")]).toEqual([7, 18, 2]);
  });

  it("draws only the gate against a rival that was not swept", () => {
    expect(rows("central").map((r) => [r.title, r.cells.length])).toEqual([
      ["Gate · T2 conference", 3],
      ["Gate · T1 extraction", 3],
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
