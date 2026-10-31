import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { heroSets } from "../../lib/hero";
import { REPO_ROOT } from "../../lib/testing";
import { seriesColors } from "./colors";
import { MetricChart } from "./MetricChart";
import story from "../../home/data/story.json";
import { NOT_VALID } from "../../pages/ChartsPage";
import { ResultsTable, runName, seedsText } from "./ResultsTable";
import { MarkKey, SeriesKey } from "./SeriesKey";
import { SetCaption, SetPicker } from "./SetHeader";

const recorded = (set: string) => JSON.parse(readFileSync(REPO_ROOT + `bench/results/${set}/hero-t2_conference.json`, "utf-8"));
const sets = heroSets({
  fixture: false,
  sets: ["v1", "headline", "rivals-gate"].map((name) => ({ name, source: `bench/results/${name}/hero-t2_conference.json`, data: recorded(name) })),
});
const set = (name: string) => sets.find((s) => s.name === name)!;
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("the caption of a set", () => {
  it("states the model, the task, the seeds, the runs and the file, for the real rivals matrix", () => {
    const out = html(createElement(SetCaption, { set: set("v1") }));
    expect(out).toContain("Real model");
    expect(out).not.toContain("badge--warn");
    expect(out).toContain(">T2<");
    expect(out).toContain("conference schedule");
    expect(out).toContain("2 seeds per point");
    expect(out).toContain("48 runs");
    expect(out).toContain("bench/results/v1/hero-t2_conference.json");
  });

  it("lists the failure levels the set ran, each with its definition", () => {
    const all = html(createElement(SetCaption, { set: set("v1") }));
    for (const level of ["C0", "C1", "C2", "C3"]) expect(all).toContain(`>${level}<`);
    expect(all).toContain("Five coordinator crashes");
    const headline = html(createElement(SetCaption, { set: set("headline") }));
    expect(headline).toContain(">C0<");
    expect(headline).toContain(">C3<");
    expect(headline).not.toContain(">C1<");
    expect(headline).toContain("3 seeds per point");
  });

  it("calls the $0 gate a fake model on a simulated clock, in a warning badge, and says what that means", () => {
    const out = html(createElement(SetCaption, { set: set("rivals-gate") }));
    expect(out).toContain("badge--warn");
    expect(out).toContain("Fake model, simulated clock");
    expect(out).toContain("it does not measure the real model");
  });

  it("does not guess the setting of a file it was not told about", () => {
    const [unknown] = heroSets({ fixture: false, data: recorded("v1") });
    expect(html(createElement(SetCaption, { set: unknown }))).toContain("Setting not recorded");
  });
});

describe("the set picker", () => {
  it("is not shown for one set", () => {
    expect(html(createElement(SetPicker, { sets: [set("v1")], value: "v1", onChange: () => undefined }))).toBe("");
  });

  it("puts the setting on every button and marks the chosen one", () => {
    const out = html(createElement(SetPicker, { sets, value: "headline", onChange: () => undefined }));
    expect(out).toContain("Rivals matrix");
    expect(out).toContain("Real model · 2 seeds per point");
    expect(out).toContain("The $0 gate");
    expect(out).toContain("Fake model, simulated clock · 4 seeds per point");
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(/aria-pressed="true"[^>]*>\s*<span class="setpicker__name">Headline/.test(out)).toBe(true);
  });
});

describe("the key", () => {
  it("names every workflow with what it is, and shows a hidden one as off", () => {
    const hero = set("v1").hero;
    const out = html(createElement(SeriesKey, { series: hero.series, colors: seriesColors(hero), hidden: new Set(["central"]), onToggle: () => undefined }));
    expect(out).toContain("FractalSwarm");
    expect(out).toContain("Ideal durable supervisor");
    expect(out).toContain("In-process supervisor");
    expect(out).toContain("Its workers run inside its process, so a crash cancels their calls.");
    expect(out.match(/aria-pressed="false"/g)).toHaveLength(1);
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(5);
  });

  it("is only a legend where it is in view, with no button to press, and says which workflow is hidden", () => {
    const hero = set("v1").hero;
    const out = html(createElement(SeriesKey, { series: hero.series, colors: seriesColors(hero), hidden: new Set(["central"]) }));
    expect(out).not.toContain("<button");
    expect(out).not.toContain("aria-pressed");
    expect(out).toContain('aria-label="Workflows"');
    expect(out).toContain("FractalSwarm");
    expect(out.match(/serieskey__item--off/g)).toHaveLength(1);
    expect(out).toContain("(hidden in the charts)");
  });

  it("gives a workflow the same colour in every set", () => {
    const [v1, headline, gate] = ["v1", "headline", "rivals-gate"].map((name) => seriesColors(set(name).hero));
    expect(v1.swarm).toBe(headline.swarm);
    expect(v1["durable-max"]).toBe(headline["durable-max"]);
    expect(v1.central).toBe(gate.central);
    expect(new Set(Object.values(v1)).size).toBe(6); // and no two share one
    expect(v1.swarm).toBe("var(--own-1)");
  });
});

describe("the table of every number", () => {
  const hero = set("v1").hero;
  const table = (known: string[]) => html(createElement(ResultsTable, { hero, knownRuns: new Set(known) }));

  it("has a row per workflow and level, with the mean and the spread of the seeds", () => {
    const out = table([]);
    expect(out.match(/<tr>/g)).toHaveLength(1 + 6 * 4); // the header and 24 points
    expect(out).toContain("14.6 s (5.6 s to 23.5 s)");
    expect(out).toContain("+6.6% (");
    expect(out).toContain("100%");
  });

  it("links a run only when this server lists it", () => {
    expect(runName("runs/swarm__t2_conference__C3__s1")).toBe("swarm__t2_conference__C3__s1");
    const none = table([]);
    expect(none).toContain("swarm__t2_conference__C3__s1");
    expect(none).not.toContain("#/run/");
    const some = table(["swarm__t2_conference__C3__s1"]);
    expect(some).toContain('href="#/run/swarm__t2_conference__C3__s1?at=end"');
    expect(some.match(/#\/run\//g)).toHaveLength(1);
  });

  it("gives seeds and runs in the order of their numbers, and a run of seeds as its two ends", () => {
    expect(seedsText([1, 10, 2, 3, 4, 5, 6, 7, 8, 9])).toBe("1 to 10");
    expect(seedsText(["1", "2", "3"])).toBe("1 to 3");
    expect(seedsText([3, 1])).toBe("1, 3");
    expect(seedsText([1, 10, 2])).toBe("1, 2, 10");
    expect(seedsText([])).toBe("–");
    const out = html(createElement(ResultsTable, { hero: { ...hero, series: [{ ...hero.series[0], points: [{ ...hero.series[0].points[0], runs: ["runs/a__s10", "runs/a__s2"] }] }] }, knownRuns: new Set<string>() }));
    expect(out.indexOf("a__s2")).toBeLessThan(out.indexOf("a__s10"));
  });

  it("keeps a row low: several runs are a count that opens on their names, and one run is its name", () => {
    const several = html(createElement(ResultsTable, { hero: { ...hero, series: [{ ...hero.series[0], points: [{ ...hero.series[0].points[0], runs: ["runs/a", "runs/b"] }] }] }, knownRuns: new Set<string>() }));
    expect(several).toMatch(/<details class="resultstable__runs"><summary>2 runs<\/summary>/);
    expect(several).toContain(">a</span>");
    const one = html(createElement(ResultsTable, { hero: { ...hero, series: [{ ...hero.series[0], points: [{ ...hero.series[0].points[0], runs: ["runs/a"] }] }] }, knownRuns: new Set<string>() }));
    expect(one).not.toContain("<details");
    expect(one).toContain(">a</span>");
  });

  it("says why validity is below 100% in the one set where it is, for the run the report and the story name", () => {
    expect(Object.keys(NOT_VALID)).toEqual(["headline-10"]);
    expect(story.numbers.validity.headline10.invalid).toEqual(["swarm__t2_conference__C0__s5"]);
    expect(NOT_VALID["headline-10"]).toContain("the swarm with no failures, on seed 5");
    expect(NOT_VALID["headline-10"]).toContain("40 of 48");
    expect(NOT_VALID["headline-10"]).toContain("no crash and no API error");
  });
});

describe("a chart", () => {
  it("is a card titled with its metric's definition and the file's own words for the axis", () => {
    const hero = set("v1").hero;
    const out = html(
      createElement(MetricChart, { hero, metric: "stallS", colors: seriesColors(hero), hidden: new Set<string>(), height: 300 }),
    );
    expect(out).toContain("Stall time");
    expect(out).toContain("no agent LLM call is in flight anywhere"); // the glossary bubble
    expect(out).toContain("no agent work in flight anywhere"); // the file's note
  });

  it("is read from a key drawn beside the workflows: a dot for the mean and a bar for the seeds", () => {
    const out = html(createElement(MarkKey));
    expect(out).toContain("Dot: mean.");
    expect(out).toContain("Bar: lowest to highest seed.");
    expect(out).toContain('aria-hidden="true"'); // the words carry it, so the drawing is not read out
  });
});
