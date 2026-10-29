import { describe, expect, it } from "vitest";

import type { Tally } from "./honesty";
import { comparisonLines, EMPTY_TALLY, falseDeathNote, ruleLines, tallyRows, type Which } from "./tally";
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

  it("shows the counts of the file as they are, and adds nothing up", () => {
    const h = parsedSample();
    const rows = tallyRows(h, RIVALS);
    expect(rows.find((r) => r.id === "H1")?.cells.map((c) => c.tally)).toEqual([
      { win: 0, tie: 23, loss: 4, na: 0 },
      { win: 11, tie: 16, loss: 0, na: 0 },
      { win: 6, tie: 0, loss: 0, na: 0 },
    ]);
    expect(rows.find((r) => r.id === "S")?.cells[0].tally).toEqual({ win: 2, tie: 25, loss: 0, na: 0 });
    // every cell is the very object the file gave: no sum, no copy with a changed number
    for (const row of rows) for (const cell of row.cells) expect(cell.tally).toBe(h.hypotheses.find((x) => x.id === row.id)?.tally[cell.rival]);
  });

  it("reads a sample that is the bench's own: the hypotheses add up to the overall tally the file prints", () => {
    // a check on the data, not on the panel: the panel shows no total
    const h = parsedSample();
    const sum = (rival?: string): Tally => {
      const t = { ...EMPTY_TALLY };
      for (const hypothesis of h.hypotheses.filter((x) => x.id.startsWith("H"))) {
        for (const [name, tally] of Object.entries(hypothesis.tally)) {
          if (rival !== undefined && name !== rival) continue;
          t.win += tally.win;
          t.tie += tally.tie;
          t.loss += tally.loss;
          t.na += tally.na;
        }
      }
      return t;
    };
    expect(sum()).toEqual(h.tally);
    expect(sum("durable-max")).toEqual({ win: 42, tie: 141, loss: 33, na: 0 });
    expect(sum("durable")).toEqual({ win: 91, tie: 98, loss: 27, na: 0 });
    expect(sum("central")).toEqual({ win: 30, tie: 10, loss: 8, na: 0 });
  });

  it("counts every comparison the file has: no result goes missing from a cell", () => {
    const h = parsedSample();
    for (const row of tallyRows(h, RIVALS)) {
      for (const cell of row.cells) {
        const stored = h.comparisons.filter((c) => c.hypothesis === row.id && c.rival === cell.rival).length;
        expect(cell.tally.win + cell.tally.tie + cell.tally.loss + cell.tally.na, `${row.id} against ${cell.rival}`).toBe(stored);
      }
    }
  });

  it("gives a rival the bench did not compare an empty cell, not a missing one", () => {
    const [first] = tallyRows(parsedSample(), ["nobody"]);
    expect(first.cells).toEqual([{ rival: "nobody", tally: EMPTY_TALLY }]);
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
    const titles = ["Gate", "Failure detection", "Restart or failover time", "Fast external restart", "Coordination density", "Width"];
    const ranks = lines.map((l) => titles.findIndex((title) => l.where.startsWith(title)));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBe(0);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });

  it("writes a line in the words of the map: the setting, the task and profile, the two values", () => {
    const lines = comparisonLines(parsedSample(), "H5", "durable-max", "loss");
    expect(lines.find((l) => l.where === "Coordination density 0.25×")).toMatchObject({ context: "T2 conference · C3", swarm: "1.67", rival: "0", mixed: false });
    const gate = lines.filter((l) => l.where.startsWith("Gate C"));
    expect(gate.length).toBeGreaterThan(0);
    for (const line of gate) {
      expect(line.where).toMatch(/^Gate C[123] \(\d crashes?\)$/);
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
  it("gives the file's false deaths at the last point of the gate, the swarm's and the rival's", () => {
    expect(falseDeathNote(parsedSample())).toEqual({
      task: "t2_conference",
      profile: "C3",
      swarm: { mean: 2.25, max: 4 },
      rival: { id: "durable-max", mean: 0, max: 0 },
    });
  });

  it("leaves out the rival when the file has no row for it, and the note when it has none for the swarm", () => {
    const h = parsedSample();
    expect(falseDeathNote({ ...h, falseDeaths: h.falseDeaths.filter((f) => f.workflow !== "durable-max") })?.rival).toBeNull();
    expect(falseDeathNote({ ...h, falseDeaths: h.falseDeaths.filter((f) => f.workflow !== "swarm") })).toBeNull();
    expect(falseDeathNote({ ...h, falseDeaths: [] })).toBeNull();
    expect(falseDeathNote({ ...h, outcome: { ...h.outcome, gate: [] } })).toBeNull();
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
