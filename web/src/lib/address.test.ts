import { describe, expect, it } from "vitest";

import { AT_END, defaultRunId, FINAL_RUN, namedRunId, openedRunHash, openingRun, screenOf } from "./address";

describe("the screen an address shows", () => {
  it("is the same while the playhead moves on it", () => {
    expect(screenOf("#/run/demo?at=end")).toBe(screenOf("#/run/demo?at=120&speed=5&play"));
    expect(screenOf("#/arena/a/b?at=end")).toBe(screenOf("#/arena/a/b"));
  });

  it("changes with the page, with the view of a run and with the run", () => {
    const screens = ["#/arena/a/b", "#/charts", "#/helps", "#/runs", "#/run/demo", "#/run/demo/results", "#/run/other", "#/new", "#/new/reading"];
    expect(new Set(screens.map(screenOf)).size).toBe(screens.length);
  });
});

describe("the run an address names", () => {
  it.each([
    ["#/run/demo", "demo"],
    ["#/run/demo/plan", "demo"],
    ["#/run/demo/events?at=end&speed=5&play", "demo"],
    ["#/run/a%20b%2Fc/plan", "a b/c"],
    ["#run/demo", "demo"],
  ])("%s names %s", (hash, id) => {
    expect(namedRunId(hash)).toBe(id);
  });

  it.each(["", "#", "#/", "#/run", "#/run/", "#/run//plan", "#/runs", "#/arena", "#/charts?x=run/demo", "#/new"])("%j names none", (hash) => {
    expect(namedRunId(hash)).toBeNull();
  });

  it("names none for a malformed escape, where decodeURIComponent would throw", () => {
    expect(() => decodeURIComponent("%E0%A4%A")).toThrow();
    expect(namedRunId("#/run/%E0%A4%A")).toBeNull();
    expect(namedRunId("#/run/%")).toBeNull();
  });
});

describe("what a run page is about to show", () => {
  const runs = [{ id: "demo-backup" }, { id: "other" }];
  const state = (over: Partial<Parameters<typeof openingRun>[0]>) => openingRun({ runId: null, named: null, runs: [], runsLoaded: false, ...over });

  it("waits for the run the address names, until the store has opened it", () => {
    expect(state({ named: "x" })).toEqual({ kind: "run", id: "x" });
    expect(state({ named: "x", runId: "demo-backup", runs, runsLoaded: true })).toEqual({ kind: "run", id: "x" });
    expect(state({ named: "x", runId: "x" })).toBeNull();
  });

  it("waits for the list on a bare address with nothing open, and then for the first run in it", () => {
    expect(state({})).toEqual({ kind: "list" });
    expect(state({ runs, runsLoaded: true })).toEqual({ kind: "run", id: "demo-backup" });
  });

  it("has nothing to wait for with no runs at all, or when the list failed", () => {
    expect(state({ runsLoaded: true })).toBeNull();
  });

  it("leaves a run that is already open on screen until the list has answered, on a bare address", () => {
    expect(state({ runId: "other" })).toBeNull();
  });

  it("opens the final run for a bare address, whatever else is open, and is done once it is", () => {
    const listed = [{ id: "demo-backup" }, { id: FINAL_RUN }, { id: "demo-toy" }];
    expect(state({ runs: listed, runsLoaded: true })).toEqual({ kind: "run", id: FINAL_RUN });
    expect(state({ runId: "other", runs: listed, runsLoaded: true })).toEqual({ kind: "run", id: FINAL_RUN });
    expect(state({ runId: FINAL_RUN, runs: listed, runsLoaded: true })).toBeNull();
  });
});

describe("the run a bare address opens", () => {
  it("is the final run wherever it is listed, else the first listed one, else none", () => {
    expect(defaultRunId([{ id: "demo-backup" }, { id: "demo-final" }])).toBe("demo-final");
    expect(defaultRunId([{ id: "a" }, { id: "b" }])).toBe("a");
    expect(defaultRunId([])).toBeNull();
  });
});

describe("the address of a run opened from a list", () => {
  it("names the run and asks for its end", () => {
    expect(AT_END).toBe("?at=end");
    expect(openedRunHash("demo-backup")).toBe("#/run/demo-backup?at=end");
  });

  it("escapes the id, and the run is still the one named", () => {
    expect(openedRunHash("a b/c")).toBe("#/run/a%20b%2Fc?at=end");
    expect(namedRunId(openedRunHash("a b/c"))).toBe("a b/c");
  });
});
