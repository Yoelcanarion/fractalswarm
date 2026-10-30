import { describe, expect, it } from "vitest";

import type { RunListing } from "./lib/types";
import { createRunStore, type RunApi } from "./store";

const listing = (id: string): RunListing => ({
  id,
  source: "runs",
  run_id: id,
  scenario: "fractalswarm.actors.swarm:SWARM",
  seed: "1",
  clock: "live",
  events: 10,
  duration_ms: 1000,
  status: "completed",
  head: "h",
});

const apiOf = (listRuns: RunApi["listRuns"]): RunApi => ({
  listRuns,
  loadAllEvents: async () => [],
  tailEvents: () => () => undefined,
  verifyRun: async () => {
    throw new Error("unused");
  },
});

describe("the catalogue the store holds", () => {
  it("is not asked until it is, and then says so even when the server holds no runs", async () => {
    const store = createRunStore({ api: apiOf(async () => []) });
    expect(store.getState()).toMatchObject({ runs: [], runsError: null, runsLoaded: false });
    await store.getState().loadRuns();
    expect(store.getState()).toMatchObject({ runs: [], runsError: null, runsLoaded: true });
  });

  it("says it was asked when the server failed too, with the reason", async () => {
    const store = createRunStore({
      api: apiOf(async () => {
        throw new Error("502 Bad Gateway");
      }),
    });
    await store.getState().loadRuns();
    expect(store.getState()).toMatchObject({ runs: [], runsError: "502 Bad Gateway", runsLoaded: true });
  });

  it("keeps the runs it had when a later ask fails, and drops the error when one succeeds", async () => {
    let fail = false;
    const store = createRunStore({
      api: apiOf(async () => {
        if (fail) throw new Error("timeout");
        return [listing("a"), listing("b")];
      }),
    });
    await store.getState().loadRuns();
    fail = true;
    await store.getState().loadRuns();
    expect(store.getState().runs.map((run) => run.id)).toEqual(["a", "b"]);
    expect(store.getState().runsError).toBe("timeout");
    fail = false;
    await store.getState().loadRuns();
    expect(store.getState().runsError).toBeNull();
  });

  it("counts as asked when opening a run brings the catalogue with it", async () => {
    const store = createRunStore({ api: { ...apiOf(async () => [listing("a")]), loadAllEvents: async () => [] } });
    await store.getState().openRun("a");
    expect(store.getState().runsLoaded).toBe(true);
  });
});
