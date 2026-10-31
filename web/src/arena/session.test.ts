import { describe, expect, it } from "vitest";

import type { FrameScheduler } from "../lib/clock";
import type { RunEvent } from "../lib/types";
import type { RunApi } from "../store";
import { createPairSession, whenSettled } from "./session";
import { call, crash, kill, restart, rivalStream, swarmStream, takeOver } from "./testing";

function pair(): { swarm: RunEvent[]; rival: RunEvent[] } {
  const swarm = swarmStream();
  kill(swarm, "o1", 10_000);
  takeOver(swarm, "o1", "o2", 14_000, 15_000);
  swarm.at(60_000).emit("run.completed", "@kernel");

  const rival = rivalStream(undefined, 2);
  call(rival, "o0.a1", "e1");
  crash(rival, "o0", 10_000, 5000);
  restart(rival, "o0", 15_000);
  rival.at(70_000).emit("run.completed", "@kernel");
  return { swarm: swarm.events, rival: rival.events };
}

function fakeApi(logs: Record<string, RunEvent[]>): RunApi {
  return {
    listRuns: async () => [],
    loadAllEvents: async (id) => logs[id] ?? [],
    tailEvents: () => () => undefined,
    verifyRun: async () => {
      throw new Error("not used");
    },
  };
}

// A scheduler that never runs a frame: the tests move the clock by seeking.
const idle: FrameScheduler = { request: () => 1, cancel: () => undefined };

async function opened(playback?: Parameters<ReturnType<typeof createPairSession>["open"]>[2]) {
  const { swarm, rival } = pair();
  const session = createPairSession({ api: fakeApi({ s: swarm, r: rival }), clock: { scheduler: idle } });
  await session.open("s", "r", playback);
  return session;
}

describe("a run still recording", () => {
  // One side has not ended: its log is cut before run.completed, and its tail is ended by hand.
  async function recording() {
    const { swarm, rival } = pair();
    const ends = new Map<string, () => void>();
    const api: RunApi = {
      ...fakeApi({ s: swarm.slice(0, -1), r: rival }),
      tailEvents: (id, _from, _onBatch, onEnd) => {
        ends.set(id, onEnd);
        return () => undefined;
      },
    };
    const session = createPairSession({ api, clock: { scheduler: idle } });
    await session.open("s", "r");
    return { session, ends };
  }

  it("is settled when it ends, and a run that has ended is settled at once: nothing is scored on part of a log", async () => {
    const { session, ends } = await recording();
    expect(session.left.getState().live).toBe(true);
    const settled: string[] = [];
    whenSettled(session.left, () => settled.push("swarm"));
    whenSettled(session.right, () => settled.push("rival"));
    expect(settled).toEqual(["rival"]);
    ends.get("s")?.();
    expect(settled).toEqual(["rival", "swarm"]);
  });

  it("stops waiting when the page has moved on", async () => {
    const { session, ends } = await recording();
    const settled: string[] = [];
    const stop = whenSettled(session.left, () => settled.push("swarm"));
    stop();
    ends.get("s")?.();
    expect(settled).toEqual([]);
  });
});

describe("a pair on one clock", () => {
  it("opens both runs at their start", async () => {
    const { clock, left, right } = await opened();
    expect(left.getState().runId).toBe("s");
    expect(right.getState().runId).toBe("r");
    expect(clock.now()).toBe(0);
    expect(left.getState().cursor).toBeGreaterThan(0); // the events at time 0: the run, its actors
    expect(right.getState().cursor).toBeGreaterThan(0);
    expect(left.getState().playing).toBe(false);
  });

  it("ends the clock at the end of the longer run", async () => {
    const { clock } = await opened();
    expect(clock.end()).toBe(70_000);
  });

  it("moves both views to the same virtual time with one seek", async () => {
    const { clock, left, right } = await opened();
    clock.seekTime(12_000);
    expect(left.getState().playhead).toBe(12_000);
    expect(right.getState().playhead).toBe(12_000);
    // 12 s: the swarm's o1 is down and not yet taken over, the supervisor is down too.
    expect(left.getState().view.actors.o1.status).toBe("killed");
    expect(right.getState().view.actors.o0.status).toBe("restarting");
    clock.seekTime(0);
    expect(left.getState().view.actors.o1.status).toBe("alive");
    expect(right.getState().view.actors.o0.status).toBe("alive");
  });

  it("shows the shorter run at its end while the longer one plays on", async () => {
    const { clock, left, right } = await opened();
    clock.seekTime(65_000);
    expect(left.getState().cursor).toBe(left.getState().events.length);
    expect(right.getState().cursor).toBeLessThan(right.getState().events.length);
    expect(left.getState().view.completed).toBe(true);
    expect(right.getState().view.completed).toBe(false);
  });

  it("applies the address's playback: a time, a speed, and play", async () => {
    const { clock, left } = await opened({ atMs: 31_500, speed: 5, play: true });
    expect(clock.now()).toBe(31_500);
    expect(clock.state.getState()).toMatchObject({ speed: 5, playing: true });
    expect(left.getState().speed).toBe(5);
    expect(left.getState().playing).toBe(true);
    clock.dispose();
  });

  it("can open at the end of the longer run", async () => {
    const { clock, left, right } = await opened({ atMs: "end", speed: null, play: false });
    expect(clock.now()).toBe(70_000);
    expect(left.getState().cursor).toBe(left.getState().events.length);
    expect(right.getState().cursor).toBe(right.getState().events.length);
  });

  it("starts the next pair from the start, and forgets the last one's place", async () => {
    const { swarm, rival } = pair();
    const session = createPairSession({ api: fakeApi({ s: swarm, r: rival, s2: swarm, r2: rival }), clock: { scheduler: idle } });
    await session.open("s", "r", { atMs: 40_000, speed: 10, play: false });
    await session.open("s2", "r2");
    expect(session.clock.now()).toBe(0);
    expect(session.left.getState().runId).toBe("s2");
    expect(session.right.getState().runId).toBe("r2");
  });

  it("keeps the verdict of each side apart", async () => {
    const { left, right } = await opened();
    expect(left.getState().verify).toEqual({ state: "idle" });
    expect(right.getState().verify).toEqual({ state: "idle" });
    expect(left.getState().clock).toBe(right.getState().clock);
  });
});
