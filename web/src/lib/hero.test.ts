import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bandKey, chartRows, heroSets, normalizeHero, rangeOf, runCount, seedCounts, shareDown, workflowLabel } from "./hero";
import { REPO_ROOT } from "./testing";

const fixture = JSON.parse(readFileSync(REPO_ROOT + "src/fractalswarm/api/fixtures/hero_chart.json", "utf-8"));
const recorded = (set: string) =>
  JSON.parse(readFileSync(REPO_ROOT + `bench/results/${set}/hero-t2_conference.json`, "utf-8"));

describe("hero chart data", () => {
  it("reads the bundled fixture, swarm first", () => {
    const hero = normalizeHero(fixture);
    expect(hero.shape).toBe("v1");
    expect(hero.x).toEqual([0, 1, 3, 5]);
    expect(hero.series.map((s) => s.id)).toEqual(["swarm", "central", "pipeline", "single", "langgraph"]);
    expect(hero.series[0].points[3]).toMatchObject({ coordinatorsKilled: 5, profile: "C3" });
  });

  it("builds one recharts row per x value", () => {
    const rows = chartRows(normalizeHero(fixture), "stallS");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ x: 0, label: "0 (C0)", swarm: 0 });
    expect(rows[3].label).toBe("5 (C3)");
    expect(typeof rows[3].central).toBe("number");
  });

  it("accepts flat rows and fills profiles from the kill count", () => {
    const hero = normalizeHero({
      rows: [
        { workflow: "central", coordinators_killed: 3, stall_s: 20, extra_cost_pct: 30 },
        { workflow: "swarm", coordinators_killed: 3, stall_s: 1, extra_cost_pct: 2 },
        { workflow: "swarm", coordinators_killed: 0, stall_s: 0, extra_cost_pct: 0 },
      ],
    });
    expect(hero.shape).toBe("rows");
    expect(hero.x).toEqual([0, 3]);
    // "In-process", not "Central": claim R5 names this rival as an in-process supervisor, the way the arena does.
    expect(hero.series.map((s) => s.label)).toEqual(["FractalSwarm", "In-process supervisor"]);
    expect(hero.series[0].points.map((p) => p.profile)).toEqual(["C0", "C2"]);
    expect(chartRows(hero, "stallS")[0]).toMatchObject({ swarm: 0, central: null });
  });

  it("survives an empty or odd file", () => {
    expect(normalizeHero(null).series).toEqual([]);
    expect(normalizeHero("nope").series).toEqual([]);
    expect(normalizeHero({ workflows: [{ id: "x" }] }).series[0].points).toEqual([]);
    expect(normalizeHero({ series: { x: { points: ["junk", 3, null] } } }).series[0].points).toEqual([]);
    expect(normalizeHero({}).shape).toBe("unknown");
  });

  it("names the workflows the way the arena does", () => {
    expect(workflowLabel("swarm")).toBe("FractalSwarm");
    expect(workflowLabel("durable-max")).toBe("Ideal durable supervisor");
    expect(workflowLabel("durable")).toBe("Durable supervisor");
    expect(workflowLabel("central")).toBe("In-process supervisor");
    expect(workflowLabel("langgraph")).toBe("LangGraph teams");
    expect(workflowLabel("pipeline")).toBe("Pipeline");
    expect(workflowLabel("single")).toBe("Single agent");
    expect(workflowLabel("something-new")).toBe("Something-new"); // an id the page has never heard of is still a label
  });
});

describe("the recorded sets", () => {
  it("reads the rivals matrix of bench/results/v1: series as an object, rates in percent, a range per seed", () => {
    const hero = normalizeHero(recorded("v1"));
    expect(hero.shape).toBe("recorded");
    expect(hero.title).toBe("rivals-real");
    expect(hero.task).toBe("t2_conference");
    expect(hero.x).toEqual([0, 1, 3, 5]);
    expect(hero.xLabel).toBe("Coordinators killed");
    expect(hero.series.map((s) => s.id)).toEqual(["swarm", "durable-max", "durable", "central", "pipeline", "single"]);
    const swarm = hero.series[0];
    expect(swarm.points.map((p) => p.profile)).toEqual(["C0", "C1", "C2", "C3"]);
    const c3 = swarm.points[3];
    expect(c3.coordinatorsKilled).toBe(5);
    expect(c3.seeds).toEqual(["1", "2"]);
    expect(c3.runs).toEqual(["runs/swarm__t2_conference__C3__s1", "runs/swarm__t2_conference__C3__s2"]);
    // claim R5 quotes this value: the swarm at C3 on T2 stalled 14.6 s (the two seeds' mean)
    expect(c3.stallS).toBeCloseTo(14.578, 3);
    expect(c3.range.stallS).toEqual([5.64, 23.516]);
    expect(c3.extraCostPct).toBeCloseTo(6.56, 2);
    expect(c3.range.extraCostPct?.[0]).toBeLessThan(0);
    // rates arrive as 100.0 and leave as fractions
    expect(c3.completionRate).toBe(1);
    expect(c3.validityRate).toBe(1);
    expect(c3.coordinationTokens).toBe(0);
    expect(c3.costUsd).toBeCloseTo(0.2989, 4);
  });

  it("states the in-process supervisor's numbers of claim R5 as recorded", () => {
    const central = normalizeHero(recorded("v1")).series.find((s) => s.id === "central");
    const c3 = central?.points.find((p) => p.profile === "C3");
    expect(c3?.stallS).toBeCloseTo(92.6, 1);
    expect(c3?.extraCostPct).toBeCloseTo(75.6, 1);
  });

  it("reads the headline (3 seeds) and the $0 gate (4 seeds)", () => {
    const headline = normalizeHero(recorded("headline"));
    expect(headline.series.map((s) => s.id)).toEqual(["swarm", "durable-max", "durable"]);
    expect(headline.x).toEqual([0, 5]); // it ran C0 and C3 only; the file still lists all four
    expect(seedCounts(headline)).toEqual({ min: 3, max: 3 });
    expect(runCount(headline)).toBe(18);
    const gate = normalizeHero(recorded("rivals-gate"));
    expect(gate.series.map((s) => s.id)).toEqual(["swarm", "durable-max", "durable", "central"]);
    expect(seedCounts(gate)).toEqual({ min: 4, max: 4 });
    expect(gate.series[0].points[3].stallS).toBeCloseTo(1.2, 1);
  });

  it("carries the file's own words for each chart", () => {
    const { panels } = normalizeHero(recorded("v1"));
    expect(panels.stallS).toEqual({ label: "Stall time (s)", note: "no agent work in flight anywhere" });
    expect(panels.extraCostPct?.note).toBe("same workflow, task and seed");
    expect(panels.coordinationTokens?.note).toBe("LLM tokens spent on coordination");
  });

  it("gives the chart rows the mean and the band over the seeds", () => {
    const rows = chartRows(normalizeHero(recorded("v1")), "stallS");
    expect(rows.map((r) => r.label)).toEqual(["0 (C0)", "1 (C1)", "3 (C2)", "5 (C3)"]);
    expect(rows[3].swarm).toBeCloseTo(14.578, 3);
    expect(rows[3][bandKey("swarm")]).toEqual([5.64, 23.516]);
    // a metric the file has no range for leaves the band empty rather than inventing one
    expect(chartRows(normalizeHero(fixture), "stallS")[3][bandKey("swarm")]).toBeNull();
  });

  it("marks a workflow from its lowest seed to its highest, or at its mean where the file has no spread, and not where it has no point", () => {
    expect(rangeOf(chartRows(normalizeHero(recorded("v1")), "stallS")[3], "swarm")).toEqual([5.64, 23.516]);
    expect(rangeOf({ swarm: 7, [bandKey("swarm")]: null }, "swarm")).toEqual([7, 7]);
    expect(rangeOf({ swarm: null }, "swarm")).toBeNull();
  });

  it("puts the mean on its mark by how far it falls from the highest seed", () => {
    expect(shareDown(10, [10, 30])).toBe(1);
    expect(shareDown(30, [10, 30])).toBe(0);
    expect(shareDown(25, [10, 30])).toBe(0.25);
    expect(shareDown(5, [5, 5])).toBe(0); // a mark with no height: the dot stands where it starts
  });

  it("counts seeds and runs only where the file names them", () => {
    expect(seedCounts(normalizeHero(fixture))).toBeNull();
    expect(runCount(normalizeHero(fixture))).toBe(0);
    expect(runCount(normalizeHero(recorded("v1")))).toBe(48); // 6 workflows x 4 profiles x 2 seeds
  });
});

describe("heroSets", () => {
  const sets = ["v1", "headline", "rivals-gate"].map((name) => ({
    name,
    source: `bench/results/${name}/hero-t2_conference.json`,
    data: recorded(name),
  }));

  it("lists the measured sets in the server's order, each with its setting", () => {
    const listed = heroSets({ fixture: false, source: sets[0].source, data: sets[0].data, sets });
    expect(listed.map((s) => [s.name, s.heading, s.backend])).toEqual([
      ["v1", "Rivals matrix", "real"],
      ["headline", "Headline", "real"],
      ["rivals-gate", "The $0 gate", "fake"],
    ]);
    expect(listed[1].source).toBe("bench/results/headline/hero-t2_conference.json");
    expect(listed[0].hero.series).toHaveLength(6);
  });

  it("never offers the placeholder as a set", () => {
    expect(heroSets({ fixture: true, source: "fixture", data: fixture, sets: [] })).toEqual([]);
    expect(heroSets({ fixture: true, source: "fixture", data: recorded("v1"), sets })).toEqual([]);
  });

  it("takes the one file an older server sends, and says its setting is not recorded", () => {
    const listed = heroSets({ fixture: false, source: "C:/bench/hero_chart.json", data: recorded("v1") });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: "rivals-real", heading: "rivals-real", backend: null });
    expect(listed[0].source).toBe("C:/bench/hero_chart.json");
  });

  it("drops a file that holds nothing it can draw", () => {
    expect(heroSets({ fixture: false, data: { x: [0, 1] } })).toEqual([]);
    expect(heroSets({ fixture: false })).toEqual([]);
    expect(heroSets({ fixture: false, sets: [{ name: "odd", data: {} }, 3, null] })).toEqual([]);
  });
});
