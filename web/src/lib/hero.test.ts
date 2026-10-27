import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { chartRows, normalizeHero } from "./hero";
import { REPO_ROOT } from "./testing";

const fixture = JSON.parse(readFileSync(REPO_ROOT + "src/fractalswarm/api/fixtures/hero_chart.json", "utf-8"));

describe("hero chart data", () => {
  it("reads the bundled fixture, swarm first", () => {
    const hero = normalizeHero(fixture);
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
    expect(hero.x).toEqual([0, 3]);
    expect(hero.series.map((s) => s.label)).toEqual(["FractalSwarm", "Central supervisor"]);
    expect(hero.series[0].points.map((p) => p.profile)).toEqual(["C0", "C2"]);
    expect(chartRows(hero, "stallS")[0]).toMatchObject({ swarm: 0, central: null });
  });

  it("survives an empty or odd file", () => {
    expect(normalizeHero(null).series).toEqual([]);
    expect(normalizeHero({ workflows: [{ id: "x" }] }).series[0].points).toEqual([]);
  });
});
