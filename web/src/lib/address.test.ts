import { describe, expect, it } from "vitest";

import { AT_END, namedRunId, openedRunHash, openingRun } from "./address";

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

  it("leaves a run that is already open alone on a bare address", () => {
    expect(state({ runId: "other", runs, runsLoaded: true })).toBeNull();
    expect(state({ runId: "other" })).toBeNull();
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
