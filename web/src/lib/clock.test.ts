import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createRunStore, RunStoreProvider, STATUS_POLL_MS, useRunStore, type RunApi } from "../store";
import { createClock, MAX_FRAME_MS, type FrameScheduler } from "./clock";
import { DEFAULT_CAPABILITIES, type RunStatus } from "./controls";
import { FIXED_FRAME_MS, MAX_IDLE_GAP_MS } from "./playback";
import { Stream } from "./testing";
import type { RunEvent, RunListing } from "./types";

/** A run whose events land at the given virtual times (ms). The first starts the run. */
function logAt(times: number[], completed = true): RunEvent[] {
  const s = new Stream().at(0).emit("run.started", "@kernel", { seed: "0", scenario: "t", params: {}, clock: "sim" });
  for (const t of times) s.at(t).emit("test.tick", "a");
  if (completed) s.at(times.at(-1) ?? 0).emit("run.completed", "@kernel");
  return s.events;
}

/** One event every second for ``seconds``: dense enough that the idle-gap skip never fires. */
const everySecond = (seconds: number): number[] => Array.from({ length: seconds }, (_, i) => (i + 1) * 1000);

function fakeApi(logs: Record<string, RunEvent[]>) {
  const tails = new Map<string, (batch: RunEvent[]) => void>();
  const api: RunApi = {
    listRuns: async () => [],
    loadAllEvents: async (id) => logs[id] ?? [],
    tailEvents: (id, _from, onBatch) => {
      tails.set(id, onBatch);
      return () => void tails.delete(id);
    },
    verifyRun: async () => {
      throw new Error("not used");
    },
  };
  return { api, tails };
}

/** requestAnimationFrame by hand: `frame(ms)` runs what was requested, as one frame at time `ms`. */
function manualScheduler() {
  let next = 1;
  const pending = new Map<number, (frameMs: number) => void>();
  const scheduler: FrameScheduler & { frame(ms: number): void; pending(): number } = {
    request(callback) {
      pending.set(next, callback);
      return next++;
    },
    cancel(handle) {
      pending.delete(handle);
    },
    frame(ms) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(ms));
    },
    pending: () => pending.size,
  };
  return scheduler;
}

async function opened(logs: Record<string, RunEvent[]>, id: string, clock = createClock({ scheduler: manualScheduler() })) {
  const { api, tails } = fakeApi(logs);
  const store = createRunStore({ api, clock });
  await store.getState().openRun(id);
  return { store, clock, tails };
}

describe("clock, realtime", () => {
  it("advances the playhead by frame time x speed and moves the cursor with it", async () => {
    const scheduler = manualScheduler();
    const { store, clock } = await opened({ r: logAt([500, 1000, 1500, 2000]) }, "r", createClock({ scheduler }));
    store.getState().setSpeed(2);
    store.getState().setPlaying(true);
    scheduler.frame(1000); // the first frame only sets the reference time
    expect(clock.now()).toBe(0);
    scheduler.frame(1050); // 50 ms real x 2 = 100 ms virtual
    expect(clock.now()).toBe(100);
    expect(store.getState().cursor).toBe(1); // run.started only
    for (const ms of [1100, 1150, 1200, 1250]) scheduler.frame(ms);
    expect(clock.now()).toBe(500);
    expect(store.getState().cursor).toBe(2); // run.started and the tick@500
    for (const ms of [1300, 1350, 1400, 1450, 1500]) scheduler.frame(ms);
    expect(clock.now()).toBe(1000);
    expect(store.getState().cursor).toBe(3);
  });

  it("clamps a frame after a long sleep", async () => {
    const scheduler = manualScheduler();
    const { store, clock } = await opened({ r: logAt(everySecond(10)) }, "r", createClock({ scheduler }));
    store.getState().setPlaying(true);
    scheduler.frame(0);
    scheduler.frame(60_000); // a minute asleep counts for MAX_FRAME_MS
    expect(clock.now()).toBe(MAX_FRAME_MS);
  });

  it("skips an idle gap longer than the cap, and stops at the end of the run", async () => {
    const scheduler = manualScheduler();
    const { store, clock } = await opened({ r: logAt([100_000]) }, "r", createClock({ scheduler }));
    store.getState().setPlaying(true);
    scheduler.frame(0); // the skip happens as soon as the clock runs
    expect(clock.now()).toBe(100_000 - MAX_IDLE_GAP_MS);
    for (let ms = 16; ms < 5000 && store.getState().playing; ms += 16) scheduler.frame(ms);
    expect(clock.now()).toBe(100_000);
    expect(store.getState().playing).toBe(false);
    expect(store.getState().cursor).toBe(store.getState().events.length);
    expect(scheduler.pending()).toBe(0); // the loop is not left spinning
  });

  it("restarts from the beginning when asked to play at the end", async () => {
    const scheduler = manualScheduler();
    const { store, clock } = await opened({ r: logAt([1000]) }, "r", createClock({ scheduler }));
    store.getState().seek(store.getState().events.length);
    expect(clock.now()).toBe(1000);
    store.getState().setPlaying(true);
    expect(clock.now()).toBe(0);
    expect(store.getState().cursor).toBeLessThan(store.getState().events.length);
    expect(store.getState().playing).toBe(true);
  });

  it("does not play a run that has no events", async () => {
    const scheduler = manualScheduler();
    const { store } = await opened({ r: [] }, "r", createClock({ scheduler }));
    store.getState().setPlaying(true);
    expect(store.getState().playing).toBe(false);
    expect(scheduler.pending()).toBe(0);
  });
});

describe("clock, throttled commits", () => {
  it("writes the store when the cursor moves, and otherwise at most every 50 ms", async () => {
    const scheduler = manualScheduler();
    const { store, clock } = await opened({ r: logAt([1000]) }, "r", createClock({ scheduler }));
    store.getState().setSpeed(1);
    store.getState().setPlaying(true);
    let writes = 0;
    store.subscribe(() => (writes += 1));
    scheduler.frame(0);
    // 62 frames of 16 ms = 992 ms with the next event at 1000 ms: no cursor change, only the throttle.
    for (let i = 1; i <= 62; i++) scheduler.frame(i * 16);
    expect(clock.now()).toBeCloseTo(62 * 16, 5);
    // A commit once 50 ms have passed since the last: every fourth 16 ms frame, 16 writes, not 63.
    expect(writes).toBeGreaterThanOrEqual(14);
    expect(writes).toBeLessThanOrEqual(18);
    // The exact value is always available between commits.
    expect(Math.abs(store.getState().playhead - clock.now())).toBeLessThan(50);
  });

  it("commits at once on pause, so a paused store holds the exact playhead", async () => {
    const scheduler = manualScheduler();
    const { store, clock } = await opened({ r: logAt(everySecond(10)) }, "r", createClock({ scheduler }));
    store.getState().setPlaying(true);
    scheduler.frame(0);
    scheduler.frame(16);
    scheduler.frame(32);
    store.getState().setPlaying(false);
    expect(store.getState().playhead).toBe(clock.now());
    expect(clock.state.getState().playhead).toBe(clock.now());
  });

  it("tells frame listeners the exact time on every frame", async () => {
    const scheduler = manualScheduler();
    const { store, clock } = await opened({ r: logAt(everySecond(10)) }, "r", createClock({ scheduler }));
    const seen: number[] = [];
    clock.onFrame((t) => seen.push(t));
    store.getState().setPlaying(true);
    scheduler.frame(0);
    scheduler.frame(16);
    scheduler.frame(32);
    expect(seen).toEqual([0, 16, 32]);
  });
});

describe("clock, fixed-step", () => {
  it("advances speed x 1/60 s per frame whatever the real frame time was", async () => {
    const run = async (frames: number[]) => {
      const scheduler = manualScheduler();
      const clock = createClock({ scheduler, mode: "fixed-step", speed: 5 });
      const { store } = await opened({ r: logAt(everySecond(30)) }, "r", clock);
      store.getState().setPlaying(true);
      frames.forEach((ms) => scheduler.frame(ms));
      return clock.now();
    };
    const smooth = await run([0, 16, 33, 50, 66, 83]);
    const stuttery = await run([5, 400, 401, 900, 1500, 1501]);
    expect(smooth).toBeCloseTo(6 * FIXED_FRAME_MS * 5, 6);
    expect(stuttery).toBe(smooth); // identical takes
  });

  it("steps by hand", async () => {
    const clock = createClock({ scheduler: manualScheduler(), mode: "fixed-step", speed: 2 });
    const { store } = await opened({ r: logAt(everySecond(30)) }, "r", clock);
    clock.step(30);
    expect(clock.now()).toBeCloseTo(30 * FIXED_FRAME_MS * 2, 6);
    expect(store.getState().playhead).toBe(clock.now()); // fixed-step commits every frame
  });
});

describe("clock, animation time", () => {
  it("is the real clock normally, and only goes forward", async () => {
    const clock = createClock({ scheduler: manualScheduler() });
    const a = clock.motion();
    const b = clock.motion();
    expect(b).toBeGreaterThanOrEqual(a);
    expect(Math.abs(a - performance.now())).toBeLessThan(1000);
  });

  it("counts frames in fixed-step mode, so a take repeats whatever the real time was", async () => {
    const measure = async (frameTimes: number[]) => {
      const scheduler = manualScheduler();
      const clock = createClock({ scheduler, mode: "fixed-step", speed: 3 });
      const { store } = await opened({ r: logAt(everySecond(30)) }, "r", clock);
      expect(clock.motion()).toBe(0);
      store.getState().setPlaying(true);
      frameTimes.forEach((ms) => scheduler.frame(ms));
      return clock.motion();
    };
    const smooth = await measure([0, 16, 33, 50, 66]);
    const stuttery = await measure([7, 900, 901, 5000, 5001]);
    expect(smooth).toBeCloseTo(5 * FIXED_FRAME_MS, 9);
    expect(stuttery).toBe(smooth);
  });

  it("moves with step() and stands still while paused", async () => {
    const clock = createClock({ scheduler: manualScheduler(), mode: "fixed-step" });
    await opened({ r: logAt(everySecond(30)) }, "r", clock);
    clock.step(6);
    expect(clock.motion()).toBeCloseTo(6 * FIXED_FRAME_MS, 9);
    expect(clock.motion()).toBe(clock.motion());
  });
});

describe("clock, shared by several stores", () => {
  it("plays two runs at the same virtual time and speed", async () => {
    const scheduler = manualScheduler();
    const clock = createClock({ scheduler, speed: 4 });
    const { api } = fakeApi({ a: logAt([400, 800, 1200, 1600]), b: logAt([800, 1600, 2400]) });
    const a = createRunStore({ api, clock });
    const b = createRunStore({ api, clock });
    await a.getState().openRun("a");
    await b.getState().openRun("b");
    a.getState().setPlaying(true);
    expect(b.getState().playing).toBe(true); // one control plays both
    scheduler.frame(0);
    scheduler.frame(100); // 100 ms real x 4 = 400 ms virtual
    expect(a.getState().playhead).toBe(400);
    expect(b.getState().playhead).toBe(400);
    expect(a.getState().cursor).toBe(2); // start + tick@400
    expect(b.getState().cursor).toBe(1); // start only
    scheduler.frame(200);
    scheduler.frame(300); // 1200 ms virtual
    expect(a.getState().cursor).toBe(4);
    expect(b.getState().cursor).toBe(2);
  });

  it("seeks every store from one scrubber and stops when the longest run ends", async () => {
    const scheduler = manualScheduler();
    const clock = createClock({ scheduler });
    const { api } = fakeApi({ a: logAt([400, 800]), b: logAt([800, 1600, 2400]) });
    const a = createRunStore({ api, clock });
    const b = createRunStore({ api, clock });
    await a.getState().openRun("a");
    await b.getState().openRun("b");
    a.getState().seekTime(1000);
    expect(a.getState().cursor).toBe(a.getState().events.length); // a is over by t = 1 s
    expect(b.getState().cursor).toBe(2); // start + tick@800
    expect(clock.end()).toBe(2400);
    b.getState().setPlaying(true);
    for (let ms = 0; ms < 20_000 && b.getState().playing; ms += 16) scheduler.frame(ms);
    expect(b.getState().playing).toBe(false);
    expect(clock.now()).toBe(2400);
    expect(b.getState().cursor).toBe(b.getState().events.length);
  });

  it("skips an idle gap only when no attached run has an event inside it", async () => {
    const scheduler = manualScheduler();
    const clock = createClock({ scheduler });
    const { api } = fakeApi({ a: logAt([100_000]), b: logAt([5_000]) });
    const a = createRunStore({ api, clock });
    const b = createRunStore({ api, clock });
    await a.getState().openRun("a");
    await b.getState().openRun("b");
    a.getState().seekTime(0);
    a.getState().setPlaying(true);
    scheduler.frame(0);
    // b's event at 5 s is next, not a's at 100 s: skip to 1.5 s before it.
    expect(clock.now()).toBe(5_000 - MAX_IDLE_GAP_MS);
  });

  it("moves a store from its private clock to a shared one", async () => {
    const { api } = fakeApi({ a: logAt([1000]) });
    const store = createRunStore({ api });
    const privateClock = store.getState().clock;
    const shared = createClock({ scheduler: manualScheduler() });
    shared.setSpeed(10);
    shared.attach(store);
    expect(store.getState().clock).toBe(shared);
    expect(store.getState().speed).toBe(10);
    store.getState().setSpeed(2);
    expect(shared.state.getState().speed).toBe(2);
    expect(privateClock.state.getState().speed).toBe(1); // the old clock is no longer driving it
  });
});

describe("run store", () => {
  it("opens a finished run at its start and a live one at its head", async () => {
    const live = logAt([100, 200, 300], false);
    const { store } = await opened({ done: logAt([100, 200]), live }, "done");
    expect(store.getState().cursor).toBe(0);
    expect(store.getState().live).toBe(false);
    await store.getState().openRun("live");
    expect(store.getState().live).toBe(true);
    expect(store.getState().following).toBe(true);
    expect(store.getState().cursor).toBe(live.length);
    expect(store.getState().playhead).toBe(300);
    expect(store.getState().clock.now()).toBe(300);
  });

  it("keeps the replay state of two stores apart", async () => {
    const { api } = fakeApi({ a: logAt([100, 200, 300]), b: logAt([100]) });
    const a = createRunStore({ api });
    const b = createRunStore({ api });
    await a.getState().openRun("a");
    await b.getState().openRun("b");
    a.getState().seek(3);
    b.getState().seek(1);
    expect(a.getState().view.counters.events).toBe(3);
    expect(b.getState().view.counters.events).toBe(1);
    a.getState().seek(0);
    expect(a.getState().view.counters.events).toBe(0);
    expect(b.getState().view.counters.events).toBe(1);
  });

  it("counts jumps of the view, and not playback", async () => {
    const scheduler = manualScheduler();
    const clock = createClock({ scheduler, mode: "fixed-step" });
    const { store } = await opened({ r: logAt(everySecond(30)) }, "r", clock);
    const opened1 = store.getState().epoch;
    expect(opened1).toBeGreaterThan(0); // opening a run is a jump

    store.getState().setPlaying(true);
    scheduler.frame(0);
    scheduler.frame(16);
    clock.step(5);
    expect(store.getState().epoch).toBe(opened1); // frames and steps advance the view

    store.getState().seek(10);
    expect(store.getState().epoch).toBe(opened1 + 1);
    store.getState().seekTime(5000);
    expect(store.getState().epoch).toBe(opened1 + 2);
    store.getState().seek(0);
    expect(store.getState().epoch).toBe(opened1 + 3);
  });

  it("does not count a live run's new events as a jump", async () => {
    const live = logAt([100, 200], false);
    const { store, tails } = await opened({ live }, "live");
    const before = store.getState().epoch;
    tails.get("live")!(logAt([100, 200, 300], false).slice(live.length));
    expect(store.getState().view.counters.events).toBeGreaterThan(live.length - 1);
    expect(store.getState().epoch).toBe(before);
  });

  it("jumps every store on a shared clock when one of them is scrubbed", async () => {
    const clock = createClock({ scheduler: manualScheduler() });
    const { api } = fakeApi({ a: logAt(everySecond(10)), b: logAt(everySecond(10)) });
    const a = createRunStore({ api, clock });
    const b = createRunStore({ api, clock });
    await a.getState().openRun("a");
    await b.getState().openRun("b");
    const before = b.getState().epoch;
    a.getState().seek(4);
    expect(b.getState().epoch).toBe(before + 1);
  });

  it("seeks to an exact event count and reports whether it is following", async () => {
    const { store } = await opened({ r: logAt([100, 100, 100, 200]) }, "r");
    store.getState().seek(2);
    expect(store.getState().cursor).toBe(2); // not pushed on to the other events at the same time
    expect(store.getState().following).toBe(false);
    store.getState().seek(999);
    expect(store.getState().cursor).toBe(store.getState().events.length);
    expect(store.getState().following).toBe(true);
  });

  it("follows the head of a live run as batches arrive, and stays put when scrubbed back", async () => {
    const full = logAt([100, 200, 300, 400, 500], false);
    const { store, tails } = await opened({ r: full.slice(0, 3) }, "r");
    // `run.completed` is absent, so this run is live.
    expect(store.getState().live).toBe(true);
    tails.get("r")!(full.slice(3, 4));
    expect(store.getState().cursor).toBe(4);
    expect(store.getState().clock.now()).toBe(300);
    store.getState().seek(2);
    tails.get("r")!(full.slice(4));
    expect(store.getState().events.length).toBe(full.length);
    expect(store.getState().cursor).toBe(2);
    expect(store.getState().following).toBe(false);
  });

  it("ignores a late answer for a run that is no longer open", async () => {
    const slow: Record<string, RunEvent[]> = { a: logAt([100]), b: logAt([100, 200]) };
    const resolvers: Record<string, () => void> = {};
    const api: RunApi = {
      ...fakeApi(slow).api,
      loadAllEvents: (id) => new Promise((resolve) => (resolvers[id] = () => resolve(slow[id]))),
    };
    const store = createRunStore({ api, clock: createClock({ scheduler: manualScheduler() }) });
    const first = store.getState().openRun("a");
    const second = store.getState().openRun("b");
    resolvers.b();
    await second;
    resolvers.a();
    await first;
    expect(store.getState().runId).toBe("b");
    expect(store.getState().events).toBe(slow.b);
  });
});

const listing = (id: string, status: RunStatus): RunListing => ({
  id,
  source: "runs",
  run_id: id,
  scenario: "t",
  seed: "0",
  clock: "sim",
  events: 0,
  duration_ms: 0,
  status,
  head: null,
});

/** A store whose catalog answers with ``listings``, which a test may change between calls. */
function catalogStore(logs: Record<string, RunEvent[]>, listings: { current: RunListing[] }, capabilities?: RunApi["capabilities"]) {
  const { api, tails } = fakeApi(logs);
  const store = createRunStore({ api: { ...api, listRuns: async () => listings.current, capabilities }, clock: createClock({ scheduler: manualScheduler() }) });
  return { store, tails };
}

describe("run store, the catalog's word on a run", () => {
  it("opens a run the catalog calls interrupted as a recording, even though its log never completed", async () => {
    const log = logAt([100, 200, 300], false);
    const { store, tails } = catalogStore({ r: log }, { current: [listing("r", "interrupted")] });
    await store.getState().openRun("r");
    const s = store.getState();
    expect(s.runStatus).toBe("interrupted");
    expect(s.live).toBe(false);
    expect(s.following).toBe(false);
    expect(s.cursor).toBe(0); // ready to replay from the start
    expect(tails.size).toBe(0); // and no tail on a process that is gone
  });

  it("tails a run the catalog calls running, from its head", async () => {
    const log = logAt([100, 200, 300], false);
    const { store, tails } = catalogStore({ r: log }, { current: [listing("r", "running")] });
    await store.getState().openRun("r");
    const s = store.getState();
    expect(s.runStatus).toBe("running");
    expect(s.live).toBe(true);
    expect(s.cursor).toBe(log.length);
    expect(tails.has("r")).toBe(true);
  });

  it("reads a halted run as a recording", async () => {
    const { store } = catalogStore({ r: logAt([100, 200]) }, { current: [listing("r", "halted")] });
    await store.getState().openRun("r");
    expect(store.getState().runStatus).toBe("halted");
    expect(store.getState().live).toBe(false);
  });

  it("goes by the log where the catalog does not list the run", async () => {
    const done = catalogStore({ r: logAt([100, 200]) }, { current: [] });
    await done.store.getState().openRun("r");
    expect(done.store.getState()).toMatchObject({ live: false, runStatus: "completed" });

    const open = catalogStore({ r: logAt([100, 200], false) }, { current: [] });
    await open.store.getState().openRun("r");
    expect(open.store.getState()).toMatchObject({ live: true, runStatus: "running" });
  });

  it("never calls a completed log live, whatever a stale catalog says", async () => {
    const { store } = catalogStore({ r: logAt([100, 200]) }, { current: [listing("r", "running")] });
    await store.getState().openRun("r");
    expect(store.getState().live).toBe(false);
  });

  it("stops tailing when the catalog later says the process died", async () => {
    const listings = { current: [listing("r", "running")] };
    const { store, tails } = catalogStore({ r: logAt([100, 200], false) }, listings);
    await store.getState().openRun("r");
    expect(store.getState().live).toBe(true);

    listings.current = [listing("r", "interrupted")];
    await store.getState().loadRuns();
    expect(store.getState()).toMatchObject({ live: false, following: false, runStatus: "interrupted" });
    expect(tails.size).toBe(0);
  });

  it("asks the catalog again on a timer while the run is live, and not otherwise", async () => {
    const listings = { current: [listing("r", "running")] };
    let calls = 0;
    const { api } = fakeApi({ r: logAt([100, 200], false), done: logAt([100, 200]) });
    const store = createRunStore({
      api: {
        ...api,
        listRuns: async () => {
          calls += 1;
          return listings.current;
        },
      },
      clock: createClock({ scheduler: manualScheduler() }),
    });
    const timers: { fn: () => void; ms: number }[] = [];
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      timers.push({ fn, ms });
      return timers.length as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = ((handle: number) => void timers.splice(handle - 1, 1, { fn: () => {}, ms: -1 })) as typeof clearInterval;
    try {
      await store.getState().openRun("r");
      const live = timers.filter((t) => t.ms === STATUS_POLL_MS);
      expect(live).toHaveLength(1);
      const before = calls;
      live[0].fn();
      await Promise.resolve();
      expect(calls).toBeGreaterThan(before);

      await store.getState().openRun("done");
      expect(timers.filter((t) => t.ms === STATUS_POLL_MS)).toHaveLength(0); // the old one was cleared
    } finally {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    }
  });
});

describe("run store, what the server offers", () => {
  it("starts with the controls that predate the capabilities list", () => {
    const { store } = catalogStore({}, { current: [] });
    expect(store.getState().capabilities).toEqual(DEFAULT_CAPABILITIES);
  });

  it("takes the capabilities the server reports", async () => {
    const { store } = catalogStore({}, { current: [] }, async () => ({ chaos: true, approve: true, tasks: true, budget: true, halt: true }));
    await store.getState().loadCapabilities();
    expect(store.getState().capabilities.chaos).toBe(true);
  });

  it("keeps its defaults when asking fails", async () => {
    const { store } = catalogStore({}, { current: [] }, async () => {
      throw new Error("offline");
    });
    await store.getState().loadCapabilities();
    expect(store.getState().capabilities).toEqual(DEFAULT_CAPABILITIES);
  });
});

describe("run store, React bindings", () => {
  // Server rendering reads a store's initial state, so tell the stores apart by their initial speed.
  function SpeedLabel() {
    return createElement("span", null, useRunStore((s) => s.speed));
  }

  it("reads the store of the nearest provider", () => {
    const store = createRunStore({ clock: createClock({ scheduler: manualScheduler(), speed: 7 }) });
    const html = renderToString(createElement(RunStoreProvider, { store }, createElement(SpeedLabel)));
    expect(html).toContain(">7<");
  });

  it("falls back to the default store outside a provider", () => {
    expect(renderToString(createElement(SpeedLabel))).toContain(">1<");
  });
});
