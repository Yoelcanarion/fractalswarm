import { describe, expect, it } from "vitest";

import { comparisonLines, EMPTY_TALLY, falseDeathSummary, ruleLines, tallyRows, tallyTotal, tallyTotals, type Which } from "./tally";
import { parsedSample } from "./testing";

const RIVALS = ["durable-max", "durable", "central"];
const WHICH: Which[] = ["win", "tie", "loss", "na"];

describe("the wins, ties and losses table", () => {
  it("has a row per hypothesis in the file's order, with stall time marked as reported", () => {
    const rows = tallyRows(parsedSample(), RIVALS);
    expect(rows.map((r) => r.id)).toEqual(["H1", "H2", "H3", "H4a", "H4b", "H4c", "H5", "H6", "S"]);
    expect(rows.filter((r) => r.reported).map((r) => r.id)).toEqual(["S"]);
    for (const row of rows) expect(row.cells.map((c) => c.rival)).toEqual(RIVALS);
  });

  it("adds H1 to H6 up to the totals the file prints, per rival and overall", () => {
    const h = parsedSample();
    const totals = tallyTotals(tallyRows(h, RIVALS), RIVALS);
    expect(totals.map((t) => [t.rival, t.tally.win, t.tally.tie, t.tally.loss, t.tally.na])).toEqual([
      ["durable-max", 42, 141, 33, 0],
      ["durable", 91, 98, 27, 0],
      ["central", 30, 10, 8, 0],
    ]);
    expect(totals.map((t) => t.total)).toEqual([216, 216, 48]);
    const overall = totals.reduce((sum, t) => ({ win: sum.win + t.tally.win, tie: sum.tie + t.tally.tie, loss: sum.loss + t.tally.loss, na: sum.na + t.tally.na }), { ...EMPTY_TALLY });
    expect(overall).toEqual(h.tally);
    expect(overall).toEqual({ win: 163, tie: 249, loss: 68, na: 0 });
  });

  it("leaves stall time out of the totals", () => {
    const h = parsedSample();
    const rows = tallyRows(h, RIVALS);
    const withStall = rows.reduce((n, row) => n + tallyTotal(row.cells[0].tally), 0);
    expect(withStall).toBe(tallyTotals(rows, RIVALS)[0].total + tallyTotal(rows.find((r) => r.id === "S")!.cells[0].tally));
    expect(tallyTotals(rows, RIVALS)[0].total).toBeLessThan(withStall);
  });

  it("counts every comparison the file has: no result goes missing from a cell", () => {
    const h = parsedSample();
    for (const row of tallyRows(h, RIVALS)) {
      for (const cell of row.cells) {
        const stored = h.comparisons.filter((c) => c.hypothesis === row.id && c.rival === cell.rival).length;
        expect(cell.total, `${row.id} against ${cell.rival}`).toBe(stored);
      }
    }
  });

  it("gives a rival the bench did not compare an empty cell, not a missing one", () => {
    const [first] = tallyRows(parsedSample(), ["nobody"]);
    expect(first.cells).toEqual([{ rival: "nobody", tally: EMPTY_TALLY, total: 0 }]);
  });
});

describe("the list behind a count", () => {
  it("has as many lines as the count it opens, for every cell of the table", () => {
    const h = parsedSample();
    for (const row of tallyRows(h, RIVALS)) {
      for (const cell of row.cells) {
        for (const which of WHICH) {
          expect(comparisonLines(h, row.id, cell.rival, which), `${row.id} ${cell.rival} ${which}`).toHaveLength(cell.tally[which]);
        }
      }
    }
  });

  it("lists the losses of H5 against the ideal durable supervisor, the gate first and then each sweep in turn", () => {
    const lines = comparisonLines(parsedSample(), "H5", "durable-max", "loss");
    expect(lines).toHaveLength(20);
    expect(lines.every((l) => l.verdict === "loss")).toBe(true);
    const titles = ["Failures", "Detection time", "Restart time", "Fast external restart", "Coordination density", "Team width"];
    const ranks = lines.map((l) => titles.findIndex((title) => l.where.startsWith(title)));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBe(0);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it("writes a line in the words of the map: the setting, the task and profile, the two values", () => {
    const lines = comparisonLines(parsedSample(), "H5", "durable-max", "loss");
    expect(lines.find((l) => l.where === "Coordination density 0.25×")).toMatchObject({ context: "T2 conference · C3", swarm: "1.67", rival: "0", mixed: false });
    const gate = lines.filter((l) => l.where.startsWith("Failures C"));
    expect(gate.length).toBeGreaterThan(0);
    for (const line of gate) {
      expect(line.where).toMatch(/^Failures C[123] \(\d crashes?\)$/);
      expect(line.context).toMatch(/^T[12] (extraction|conference) · default assumptions$/);
    }
  });

  it("says where the seeds disagree, as the file does", () => {
    const h = parsedSample();
    const ties = comparisonLines(h, "H1", "durable-max", "tie");
    const stored = h.comparisons.filter((c) => c.hypothesis === "H1" && c.rival === "durable-max" && c.verdict === "tie" && c.mixed).length;
    expect(stored).toBeGreaterThan(0);
    expect(ties.filter((l) => l.mixed)).toHaveLength(stored);
  });

  it("lists a result with no verdict apart, and in none of the three counts", () => {
    const h = parsedSample();
    const at = h.comparisons.findIndex((c) => c.hypothesis === "H1" && c.rival === "durable-max" && c.verdict === "tie");
    const changed = { ...h, comparisons: h.comparisons.map((c, i) => (i === at ? { ...c, verdict: "incomplete" as const } : c)) };
    expect(comparisonLines(changed, "H1", "durable-max", "na")).toHaveLength(1);
    expect(comparisonLines(changed, "H1", "durable-max", "tie")).toHaveLength(comparisonLines(h, "H1", "durable-max", "tie").length - 1);
  });
});

describe("the note about H5", () => {
  it("counts the swarm's false deaths and finds the worst setting", () => {
    const summary = falseDeathSummary(parsedSample());
    expect(summary).toMatchObject({ settingsWith: 25, settings: 27, worstWhere: "Detection time 0.5 s" });
    expect(summary?.worstMean).toBeCloseTo(24.667, 3);
  });

  it("is left out when the file has no swarm settings to count", () => {
    const h = parsedSample();
    expect(falseDeathSummary({ ...h, falseDeaths: [] })).toBeNull();
    expect(falseDeathSummary({ ...h, falseDeaths: h.falseDeaths.filter((f) => f.workflow !== "swarm") })).toBeNull();
  });
});

describe("how a result is decided", () => {
  it("states the rule in the file's own numbers", () => {
    expect(ruleLines(parsedSample().rules)).toEqual([
      "A result is a tie unless every seed agrees and the difference reaches the minimum effect.",
      "Minimum effects: stall time 3 s · extra cost 5 points · time to recover 1 s · duplicated spend 5 points · unnecessary reassignments 1 · preserved work 10 points.",
      "Ratio metrics: a win is at most this fraction of the rival's value, once the rival's value is at least the floor: coordinator-dependency time 0.5× (floor 1 s) · blast radius 0.5× (floor 5%) · blast radius (agents) 0.5× (floor 5%) · idle agent-seconds 0.5× (floor 1 agent·s).",
    ]);
  });

  it("keeps the first line when the file names no minimum", () => {
    expect(ruleLines({ difference: {}, ratio: {} })).toEqual(["A result is a tie unless every seed agrees and the difference reaches the minimum effect."]);
  });
});
