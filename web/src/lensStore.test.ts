import { afterEach, describe, expect, it, vi } from "vitest";

import { createLensStore, DETAIL_CACHE, LENS_POLL_MS, lensStoreOf, type LensApi } from "./lensStore";
import { readCallDetail, readCalls, readMeter, type CallDetail, type CallsResponse } from "./lib/lens";
import { loadFixture, Stream } from "./lib/testing";
import type { RunEvent } from "./lib/types";
import { createRunStore, type RunApi } from "./store";

interface Fixture {
  calls: unknown;
  meter: unknown;
  details: Record<string, unknown>;
}

const demo = loadFixture<Fixture>("lens-demo-backup.json");
const calls = readCalls(demo.calls);
const meter = readMeter(demo.meter);

const log = (completed: boolean): RunEvent[] => {
  const s = new Stream().at(0).emit("run.started", "@kernel", { seed: "0", scenario: "t", params: {}, clock: "sim" });
  s.at(1000).emit("test.tick", "a");
  if (completed) s.at(2000).emit("run.completed", "@kernel");
  return s.events;
};

/** A run store over a fake server that holds one finished run ("done") and one recording ("live"). */
function runStore() {
  const tails = new Map<string, (batch: RunEvent[]) => void>();
  const ended = new Map<string, () => void>();
  const api: RunApi = {
    listRuns: async () => [],
    loadAllEvents: async (id) => log(id !== "live"),
    tailEvents: (id, _from, onBatch, onEnd) => {
      tails.set(id, onBatch);
      ended.set(id, onEnd);
      return () => void tails.delete(id);
    },
    verifyRun: async () => {
      throw new Error("not used");
    },
  };
  return { run: createRunStore({ api }), tails, ended };
}

/** A fake lens server serving the demo-backup fixture; `spy` counts its calls. */
function lensApi(over: Partial<LensApi> = {}) {
  const spy = { calls: 0, meter: 0, detail: [] as string[] };
  const api: LensApi = {
    calls: async () => {
      spy.calls += 1;
      return calls;
    },
    meter: async () => {
      spy.meter += 1;
      return meter;
    },
    detail: async (_run, effectId) => {
      spy.detail.push(effectId);
      const found = readCallDetail(demo.details[effectId]);
      if (!found) throw new Error(`no call ${effectId}`);
      return found;
    },
    ...over,
  };
  return { api, spy };
}

const ready = (lens: ReturnType<typeof createLensStore>) => vi.waitFor(() => expect(lens.getState().status).toBe("ready"));

afterEach(() => {
  vi.useRealTimers();
});

describe("loading a run's calls", () => {
  it("loads the calls and the meter of the run that opens", async () => {
    const { run } = runStore();
    const { api } = lensApi();
    const lens = createLensStore(run, { api });
    expect(lens.getState().status).toBe("idle");
    await run.getState().openRun("done");
    await ready(lens);
    expect(lens.getState().runId).toBe("done");
    expect(lens.getState().calls).toHaveLength(79);
    expect(lens.getState().meter?.totals.calls).toBe(79);
  });

  it("treats a server without the routes as not offering the lens", async () => {
    const { run } = runStore();
    const lens = createLensStore(run, { api: lensApi({ calls: async () => null }).api });
    await run.getState().openRun("done");
    await vi.waitFor(() => expect(lens.getState().status).toBe("unavailable"));
    await lens.getState().refresh(); // does nothing, and does not throw
    expect(lens.getState().calls).toEqual([]);
  });

  it("says so when the server fails", async () => {
    const { run } = runStore();
    const lens = createLensStore(run, {
      api: lensApi({
        calls: async () => {
          throw new Error("500 boom");
        },
      }).api,
    });
    await run.getState().openRun("done");
    await vi.waitFor(() => expect(lens.getState().status).toBe("error"));
    expect(lens.getState().error).toBe("500 boom");
  });

  it("still shows the calls when only the meter fails", async () => {
    const { run } = runStore();
    const lens = createLensStore(run, {
      api: lensApi({
        meter: async () => {
          throw new Error("no meter");
        },
      }).api,
    });
    await run.getState().openRun("done");
    await ready(lens);
    expect(lens.getState().calls).toHaveLength(79);
    expect(lens.getState().meter).toBeNull();
  });

  it("forgets the panel when another run opens", async () => {
    const { run } = runStore();
    const lens = createLensStore(run, { api: lensApi().api });
    await run.getState().openRun("done");
    await ready(lens);
    lens.getState().openActor("o1.2.a2");
    expect(lens.getState().open).toBe(true);
    await run.getState().openRun("other");
    expect(lens.getState()).toMatchObject({ runId: "other", open: false, selected: null, details: {}, scope: { kind: "run" } });
    await ready(lens);
  });

  it("ignores a late answer for a run that is no longer open", async () => {
    const { run } = runStore();
    let release: (value: CallsResponse) => void = () => undefined;
    const slow = new Promise<CallsResponse>((resolve) => (release = resolve));
    const first = { ...calls, run_id: "first", calls: calls.calls.slice(0, 3) };
    const lens = createLensStore(run, {
      api: lensApi({ calls: (id) => (id === "first" ? slow : Promise.resolve({ ...calls, run_id: id })) }).api,
    });
    await run.getState().openRun("first");
    await run.getState().openRun("second");
    await ready(lens);
    release(first);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lens.getState().runId).toBe("second");
    expect(lens.getState().calls).toHaveLength(79);
  });
});

describe("the panel", () => {
  async function opened() {
    const { run } = runStore();
    const { api, spy } = lensApi();
    const lens = createLensStore(run, { api });
    await run.getState().openRun("done");
    await ready(lens);
    return { run, lens, spy };
  }
  const own = calls.calls.filter((c) => c.actor === "o1.2.a2");

  it("opens on an actor at the call it had reached on the playhead, and reads it in full", async () => {
    const { run, lens } = await opened();
    expect(own.length).toBeGreaterThan(2);
    run.setState({ playhead: own[1].started_ts + 1 });
    lens.getState().openActor("o1.2.a2");
    expect(lens.getState()).toMatchObject({ open: true, scope: { kind: "actor", actor: "o1.2.a2" }, selected: own[1].effect_id });
    await vi.waitFor(() => expect(lens.getState().details[own[1].effect_id]?.state).toBe("ready"));
  });

  it("opens on the actor's first call when the playhead is before all of them", async () => {
    const { run, lens } = await opened();
    run.setState({ playhead: 0 });
    lens.getState().openActor("o1.2.a2");
    expect(lens.getState().selected).toBe(own[0].effect_id);
  });

  it("opens an actor with no calls on an empty list", async () => {
    const { lens } = await opened();
    lens.getState().openActor("nobody");
    expect(lens.getState()).toMatchObject({ open: true, scope: { kind: "actor", actor: "nobody" }, selected: null });
  });

  it("opens on one call through its actor, and on every call of the run", async () => {
    const { lens } = await opened();
    const target = calls.calls[30];
    lens.getState().openCall(target.effect_id);
    expect(lens.getState()).toMatchObject({ open: true, scope: { kind: "actor", actor: target.actor }, selected: target.effect_id });
    lens.getState().openCall("eff-unknown");
    expect(lens.getState()).toMatchObject({ scope: { kind: "run" }, selected: null });
    lens.getState().select(target.effect_id);
    lens.getState().openRun();
    expect(lens.getState()).toMatchObject({ scope: { kind: "run" }, selected: target.effect_id }); // the open call stays open
    lens.getState().close();
    expect(lens.getState().open).toBe(false);
  });

  it("reads a call in full once, and again after it failed", async () => {
    const { lens, spy } = await opened();
    const id = "eff-3895.0";
    lens.getState().select(id);
    lens.getState().select(id);
    await vi.waitFor(() => expect(lens.getState().details[id]?.state).toBe("ready"));
    lens.getState().select(id);
    expect(spy.detail).toEqual([id]);
    lens.getState().select("eff-missing");
    await vi.waitFor(() => expect(lens.getState().details["eff-missing"]?.state).toBe("error"));
    lens.getState().select("eff-missing");
    await vi.waitFor(() => expect(spy.detail.filter((d) => d === "eff-missing")).toHaveLength(2));
  });

  it("keeps only the latest details, and always the one on screen", async () => {
    const { run } = runStore();
    const template = readCallDetail(demo.details["eff-3895.0"]) as CallDetail;
    const lens = createLensStore(run, {
      api: lensApi({ detail: async (_run, effectId) => ({ ...template, effect_id: effectId }) }).api,
    });
    await run.getState().openRun("done");
    await ready(lens);
    lens.getState().select("first");
    await vi.waitFor(() => expect(lens.getState().details.first?.state).toBe("ready"));
    for (let i = 0; i < DETAIL_CACHE + 5; i++) {
      lens.getState().select(`e${i}`);
      await vi.waitFor(() => expect(lens.getState().details[`e${i}`]?.state).toBe("ready"));
    }
    expect(Object.keys(lens.getState().details).length).toBeLessThanOrEqual(DETAIL_CACHE);
    expect(lens.getState().details[`e${DETAIL_CACHE + 4}`]?.state).toBe("ready");
    expect(lens.getState().details.first).toBeUndefined();
  });
});

describe("a run that is still recording", () => {
  it("reads the calls again every few seconds, and once more when the run ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { run, ended } = runStore();
    const { api, spy } = lensApi();
    const lens = createLensStore(run, { api });
    await run.getState().openRun("live");
    expect(run.getState().live).toBe(true);
    await ready(lens);
    expect(spy.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(LENS_POLL_MS);
    expect(spy.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(LENS_POLL_MS);
    expect(spy.calls).toBe(3);
    ended.get("live")?.(); // the tail ends: the run stopped recording
    await vi.waitFor(() => expect(run.getState().live).toBe(false));
    await vi.waitFor(() => expect(spy.calls).toBe(4)); // its last calls
    await vi.advanceTimersByTimeAsync(LENS_POLL_MS * 3);
    expect(spy.calls).toBe(4); // and no more polling
  });

  it("does not poll a finished run", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { run } = runStore();
    const { api, spy } = lensApi();
    const lens = createLensStore(run, { api });
    await run.getState().openRun("done");
    await ready(lens);
    await vi.advanceTimersByTimeAsync(LENS_POLL_MS * 4);
    expect(spy.calls).toBe(1);
  });
});

describe("one lens per run store", () => {
  it("gives the same lens back, and a different one to another store", () => {
    const a = runStore().run;
    const b = runStore().run;
    expect(lensStoreOf(a)).toBe(lensStoreOf(a));
    expect(lensStoreOf(a)).not.toBe(lensStoreOf(b));
  });
});
