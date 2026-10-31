import { describe, expect, it } from "vitest";

import type { FrameScheduler } from "../lib/clock";
import type { RunEvent } from "../lib/types";
import type { RunApi } from "../store";
import { clockReadout, firstCrashOfPair, playFromStart, watchFirstCrash } from "./play";
import { createPairSession } from "./session";
import { crash, kill, restart, rivalStream, swarmStream, takeOver } from "./testing";

const idle: FrameScheduler = { request: () => 1, cancel: () => undefined };

const api = (logs: Record<string, RunEvent[]>): RunApi => ({
  listRuns: async () => [],
  loadAllEvents: async (id) => logs[id] ?? [],
  tailEvents: () => () => undefined,
  verifyRun: async () => {
    throw new Error("unused");
  },
});

const swarmKilledAt = (ms: number): RunEvent[] => kill(swarmStream(), "o1", ms).events;
const rivalCrashedAt = (ms: number): RunEvent[] => crash(rivalStream(undefined, 2), "o0", ms, 5000).events;

describe("where the first crash of a pair is", () => {
  it("is three seconds before the earlier of the two first kills, whichever side it falls on", () => {
    expect(firstCrashOfPair(swarmKilledAt(40_700), rivalCrashedAt(52_000))).toBe(37_700);
    expect(firstCrashOfPair(swarmKilledAt(52_000), rivalCrashedAt(40_700))).toBe(37_700);
  });

  it("is the one side's where only one run kills a coordinator", () => {
    expect(firstCrashOfPair(swarmStream().events, rivalCrashedAt(10_000))).toBe(7_000);
    expect(firstCrashOfPair(swarmKilledAt(10_000), rivalStream().events)).toBe(7_000);
  });

  it("is nowhere where neither run kills one", () => {
    expect(firstCrashOfPair(swarmStream().events, rivalStream().events)).toBeNull();
    expect(firstCrashOfPair([], [])).toBeNull();
  });

  it("never starts before the beginning", () => {
    expect(firstCrashOfPair(swarmKilledAt(2_000), rivalCrashedAt(2_500))).toBe(0);
  });
});

describe("what the main action does to the clock", () => {
  async function pair(atMs: number) {
    const swarm = swarmStream();
    kill(swarm, "o1", 10_000);
    takeOver(swarm, "o1", "o2", 14_000, 15_000);
    swarm.at(60_000).emit("run.completed", "@kernel");
    const rival = rivalStream(undefined, 4);
    crash(rival, "o0", 10_000, 5000);
    restart(rival, "o0", 15_000);
    rival.at(70_000).emit("run.completed", "@kernel");
    const session = createPairSession({ api: api({ s: swarm.events, r: rival.events }), clock: { scheduler: idle } });
    await session.open("s", "r", { atMs, speed: 5, play: false });
    return session;
  }

  it("watches the first crash by moving the playhead to just before it and playing at 1×, without cutting the logs", async () => {
    const session = await pair(0);
    const events = session.left.getState().events.length;
    watchFirstCrash(session.clock, 7_000);
    expect(session.clock.now()).toBe(7_000);
    expect(session.clock.state.getState()).toMatchObject({ playing: true, speed: 1 });
    expect(session.left.getState().events.length).toBe(events);
  });

  it("starts there, and not from the beginning, when the pair has played out", async () => {
    // playing a clock that stands at its end starts it again from 0: the seek has to come first
    const session = await pair(75_000);
    watchFirstCrash(session.clock, 7_000);
    expect(session.clock.now()).toBe(7_000);
    expect(session.clock.state.getState().playing).toBe(true);
  });

  it("plays both from the start", async () => {
    const session = await pair(30_000);
    playFromStart(session.clock);
    expect(session.clock.now()).toBe(0);
    expect(session.clock.state.getState().playing).toBe(true);
  });

  it("goes on playing when the playhead is moved to a moment on the timeline", async () => {
    const session = await pair(0);
    session.clock.setPlaying(true);
    session.clock.seekTime(30_000);
    expect(session.clock.now()).toBe(30_000);
    expect(session.clock.state.getState().playing).toBe(true);
  });
});

describe("the clock beside the main action", () => {
  it("reads where the shared clock is, of the longer run, with the timeline's own formatting", () => {
    expect(clockReadout(12_345, 76_400)).toBe("t = 12.3 s / 76.4 s");
    expect(clockReadout(7_000, 76_400)).toBe("t = 7.00 s / 76.4 s");
    expect(clockReadout(80_000, 76_400)).toBe("t = 76.4 s / 76.4 s"); // it does not run past the end
  });
});
