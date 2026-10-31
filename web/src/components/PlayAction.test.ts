import { describe, expect, it } from "vitest";

import { createClock, type FrameScheduler } from "../lib/clock";
import { firstCrashStart, marksOf } from "../lib/timeline";
import { loadJsonl } from "../lib/testing";
import { createRunStore, type RunApi } from "../store";
import { watchFirstCrash } from "./PlayAction";

// The committed final run: its first coordinator, o0, is killed at 53.3 s.
const events = loadJsonl("demo/final/events.jsonl");
const FIRST_KILL_MS = events.find((e) => e.type === "chaos.injected" && e.payload.fault === "kill_coordinator")!.ts_virtual;

function manualScheduler() {
  let next = 1;
  const pending = new Map<number, (frameMs: number) => void>();
  const scheduler: FrameScheduler & { frame(ms: number): void } = {
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
  };
  return scheduler;
}

async function opened() {
  const scheduler = manualScheduler();
  const clock = createClock({ scheduler });
  const api: RunApi = {
    listRuns: async () => [],
    loadAllEvents: async () => events,
    tailEvents: () => () => undefined,
    verifyRun: async () => {
      throw new Error("not used");
    },
  };
  const store = createRunStore({ api, clock });
  await store.getState().openRun("demo-final");
  const at = firstCrashStart(marksOf(store.getState().events))!;
  return { store, clock, scheduler, at };
}

describe("watching the first crash", () => {
  it("starts three seconds before the first kill", async () => {
    const { at } = await opened();
    expect(Math.round(FIRST_KILL_MS / 100) / 10).toBe(53.3);
    expect(at).toBe(FIRST_KILL_MS - 3000);
  });

  it("moves only the playhead there, plays from it at 1x and leaves the log whole", async () => {
    const { store, clock, at } = await opened();
    store.getState().setSpeed(4);
    watchFirstCrash(store, at);
    expect(clock.now()).toBe(at);
    expect(store.getState().playing).toBe(true);
    expect(store.getState().speed).toBe(1);
    expect(store.getState().events).toHaveLength(events.length);
    // it is where the run was then: the first kill has not happened yet, and the root is alive
    expect(store.getState().view.actors.o0.status).toBe("alive");
    expect(store.getState().cursor).toBeLessThan(events.length);
  });

  it("does not start the run again from the beginning when it stands at its end", async () => {
    const { store, clock, scheduler, at } = await opened();
    store.getState().seek(events.length);
    watchFirstCrash(store, at);
    expect(clock.now()).toBe(at);
    expect(store.getState().playing).toBe(true);
    scheduler.frame(0);
    scheduler.frame(16);
    expect(clock.now()).toBeGreaterThanOrEqual(at);
  });

  it("is a replay that goes on playing across a seek, as a click on a mark of the bar is", async () => {
    const { store, clock, at } = await opened();
    watchFirstCrash(store, at);
    store.getState().seekTime(70_000);
    expect(clock.now()).toBe(70_000);
    expect(store.getState().playing).toBe(true);
  });
});
