import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { heroSets, normalizeHero } from "./hero";
import {
  captionOf,
  drawsInProcess,
  formatMetric,
  formatPoint,
  formatRange,
  IN_PROCESS_REASON,
  isFlat,
  settingNote,
  taskOf,
  WORKFLOW_HELP,
} from "./heroText";
import { REPO_ROOT } from "./testing";

const recorded = (set: string) =>
  JSON.parse(readFileSync(REPO_ROOT + `bench/results/${set}/hero-t2_conference.json`, "utf-8"));
const sets = heroSets({
  fixture: false,
  sets: ["v1", "headline", "rivals-gate"].map((name) => ({ name, source: `bench/results/${name}`, data: recorded(name) })),
});
const byName = (name: string) => sets.find((s) => s.name === name)!;

describe("number formats", () => {
  it("writes each metric in its unit, with the signs the report uses", () => {
    expect(formatMetric("stallS", 14.578)).toBe("14.6 s");
    expect(formatMetric("stallS", 0)).toBe("0.0 s");
    expect(formatMetric("extraCostPct", 6.558)).toBe("+6.6%");
    expect(formatMetric("extraCostPct", -6.599)).toBe("−6.6%");
    expect(formatMetric("extraCostPct", -0.01)).toBe("0.0%");
    expect(formatMetric("completionRate", 1)).toBe("100%");
    expect(formatMetric("validityRate", 0.875)).toBe("88%");
    expect(formatMetric("coordinationTokens", 0)).toBe("0");
    expect(formatMetric("coordinationTokens", 123456)).toBe("123,456");
    expect(formatMetric("costUsd", 0.298893)).toBe("$0.299");
    expect(formatMetric("stallS", null)).toBe("–");
    expect(formatMetric("stallS", Number.NaN)).toBe("–");
  });

  it("gives the mean and, when the file records it, the spread over the seeds", () => {
    const c3 = byName("v1").hero.series[0].points[3];
    expect(formatPoint("stallS", c3)).toBe("14.6 s (5.6 s to 23.5 s)");
    expect(formatRange("extraCostPct", [-6, 19.1])).toBe("−6.0% to +19.1%");
    const fixture = normalizeHero({ rows: [{ workflow: "swarm", coordinators_killed: 5, stall_s: 1.8 }] });
    expect(formatPoint("stallS", fixture.series[0].points[0])).toBe("1.8 s");
  });

  it("knows when a metric is the same everywhere, so a chart of it would say nothing", () => {
    const v1 = byName("v1").hero;
    expect(isFlat(v1, "coordinationTokens", 0)).toBe(true);
    expect(isFlat(v1, "completionRate", 1)).toBe(true);
    expect(isFlat(v1, "validityRate", 1)).toBe(true);
    expect(isFlat(v1, "stallS", 0)).toBe(false);
    expect(isFlat(normalizeHero({}), "stallS", 0)).toBe(false); // no values is not "all zero"
  });
});

describe("the setting of a set", () => {
  it("states backend, seeds and runs from the data and the claims", () => {
    expect(captionOf(byName("v1"))).toEqual({
      backend: { label: "Real model", tone: "plain" },
      seeds: "2 seeds per point",
      runs: "48 runs",
    });
    expect(captionOf(byName("headline"))).toMatchObject({ seeds: "3 seeds per point", runs: "18 runs" });
    expect(captionOf(byName("rivals-gate"))).toMatchObject({
      backend: { label: "Fake model, simulated clock", tone: "warn" },
      seeds: "4 seeds per point",
    });
  });

  it("never guesses a setting it was not told", () => {
    const [old] = heroSets({ fixture: false, data: recorded("v1") });
    expect(captionOf(old).backend).toEqual({ label: "Setting not recorded", tone: "warn" });
    const fixtureLike = heroSets({ fixture: false, data: { workflows: [{ id: "swarm", points: [{ coordinators_killed: 0, stall_s: 0 }] }] } })[0];
    expect(captionOf(fixtureLike)).toMatchObject({ seeds: "seeds not recorded", runs: null });
  });

  it("says what the fake set is, and nothing about the real ones", () => {
    expect(settingNote(byName("rivals-gate"))).toMatch(/fake LLM.*simulated clock.*no spend/);
    expect(settingNote(byName("v1"))).toBeNull();
  });

  it("names the task the way the glossary does", () => {
    expect(taskOf("t2_conference")).toEqual({ term: "t2", short: "T2", name: "conference schedule" });
    expect(taskOf("t1_extraction").term).toBe("t1");
    expect(taskOf("mystery")).toEqual({ term: null, short: "mystery", name: "" });
  });

  it("knows every task the example specs name, by the id they write", () => {
    const dir = REPO_ROOT + "tasks/examples/";
    const ids = readdirSync(dir)
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => /^task:\s*(\S+)/m.exec(readFileSync(dir + name, "utf-8"))?.[1]);
    expect(ids).not.toContain(undefined);
    expect(new Set(ids)).toEqual(new Set(["t1_extraction", "t2_conference", "t3_report"]));
    for (const id of ids) expect(taskOf(id!).term, id).not.toBeNull();
  });
});

describe("the in-process supervisor", () => {
  it("carries its reason wherever the rows are drawn (claim R5)", () => {
    expect(drawsInProcess(byName("v1").hero)).toBe(true);
    expect(drawsInProcess(byName("rivals-gate").hero)).toBe(true);
    expect(drawsInProcess(byName("headline").hero)).toBe(false);
    expect(IN_PROCESS_REASON).toContain("no evidence against a well-built supervisor");
    expect(IN_PROCESS_REASON).toContain("workers run inside its process");
  });

  it("describes every workflow the committed sets draw, without comparing", () => {
    const drawn = new Set(sets.flatMap((s) => s.hero.series.map((x) => x.id)));
    for (const id of drawn) expect(WORKFLOW_HELP[id], id).toBeTruthy();
    const claims = /simpler|cheaper|more reliable|faster|better|\bbest\b|worse|outperform/i;
    for (const [id, text] of Object.entries(WORKFLOW_HELP)) expect(text, id).not.toMatch(claims);
  });
});
