import { describe, expect, it } from "vitest";

import { EVIDENCE_HASHES, EVIDENCE_VIEWS, isEvidence, pageName, pageTitle, pickedRunHash, PLACES, placeOf, RUN_VIEWS, RUN_VIEW_TITLES, runViewHash, type Where } from "./shell";

describe("the places", () => {
  it("are the four the brief names, in order, each with a link of its own", () => {
    expect(PLACES.map((p) => p.label)).toEqual(["Arena", "Runs", "New task", "Evidence"]);
    expect(new Set(PLACES.map((p) => p.href)).size).toBe(4);
    for (const place of PLACES) expect(place.href).toMatch(/^#\//);
  });

  it("put a run in Runs, and the three evidence pages in Evidence", () => {
    expect(placeOf({ page: "run", runId: "r1", view: "plan" })).toBe("runs");
    expect(placeOf({ page: "run", runId: null, view: "overview" })).toBe("runs");
    expect(placeOf({ page: "runs" })).toBe("runs");
    expect(placeOf({ page: "arena" })).toBe("arena");
    expect(placeOf({ page: "intake" })).toBe("new");
    for (const page of EVIDENCE_VIEWS) expect(placeOf({ page })).toBe("evidence");
  });

  it("send Evidence to its first page, and every evidence page has a hash", () => {
    expect(PLACES.find((p) => p.place === "evidence")?.href).toBe(EVIDENCE_HASHES.charts);
    expect(EVIDENCE_VIEWS.map((view) => EVIDENCE_HASHES[view])).toEqual(["#/charts", "#/helps", "#/ablation"]);
  });

  it("tell an evidence page from any other", () => {
    for (const view of EVIDENCE_VIEWS) expect(isEvidence(view)).toBe(true);
    for (const page of ["run", "runs", "arena", "intake", "home", ""]) expect(isEvidence(page)).toBe(false);
  });
});

describe("a run's views", () => {
  it("are six, named, and link to the run with the overview at the bare path", () => {
    expect(RUN_VIEWS.map((view) => RUN_VIEW_TITLES[view])).toEqual(["Run", "Plan", "Panels", "Security", "Results", "Events"]);
    expect(runViewHash("demo", "overview")).toBe("#/run/demo");
    expect(runViewHash("demo", "events")).toBe("#/run/demo/events");
  });

  it("escape the run's id, and leave it out when there is none yet", () => {
    expect(runViewHash("a b/c", "plan")).toBe("#/run/a%20b%2Fc/plan");
    expect(runViewHash(null, "plan")).toBe("#/run//plan");
  });

  it("keep the view when another run is picked, and open that run at its end", () => {
    expect(pickedRunHash("demo", "overview")).toBe("#/run/demo?at=end");
    expect(pickedRunHash("a b/c", "events")).toBe("#/run/a%20b%2Fc/events?at=end");
  });
});

describe("the page's name and the tab's title", () => {
  const cases: [Where, string | null, string, string][] = [
    [{ page: "arena" }, null, "Arena", "Arena · FractalSwarm"],
    [{ page: "intake" }, null, "New task", "New task · FractalSwarm"],
    [{ page: "runs" }, null, "Runs", "Runs · FractalSwarm"],
    [{ page: "charts" }, null, "Charts", "Charts · FractalSwarm"],
    [{ page: "helps" }, null, "Where it helps", "Where it helps · FractalSwarm"],
    [{ page: "ablation" }, null, "Ablation", "Ablation · FractalSwarm"],
    [{ page: "run", runId: "demo-backup", view: "plan" }, "other", "Plan · demo-backup", "Plan · demo-backup · FractalSwarm"],
  ];

  it.each(cases)("%j opens as %s", (where, open, name, title) => {
    expect(pageName(where, open)).toBe(name);
    expect(pageTitle(where, open)).toBe(title);
  });

  it("names the run that is open when the address names none, and says only the view before one is open", () => {
    const bare: Where = { page: "run", runId: null, view: "overview" };
    expect(pageName(bare, "demo-backup")).toBe("Run · demo-backup");
    expect(pageName(bare, null)).toBe("Run");
    expect(pageTitle(bare, null)).toBe("Run · FractalSwarm");
  });
});
