import { describe, expect, it, vi } from "vitest";

import { readOfficial, type Official } from "../arena/official";
import { kill, rivalStream, swarmStream, takeOver } from "../arena/testing";
import { createClock } from "../lib/clock";
import { loadFixture } from "../lib/testing";
import { readCallDetail, readCalls, readMeter } from "../lib/lens";
import type { RunEvent } from "../lib/types";
import type { LensApi, LensStoreApi } from "../lensStore";
import type { RunApi } from "../store";
import { callTimes, pickCall } from "./calls";
import type { CallPick } from "./script";
import { clockReplay, createArenaStage, createRunStage, lensHandle, noteProblems, replayNote, takeClock } from "./stages";

const swarmLog = (() => {
  const s = swarmStream();
  kill(s, "o1", 10_000);
  takeOver(s, "o1", "o2", 12_000, 15_500);
  s.at(60_000).emit("run.completed", "@kernel", {});
  return s.events;
})();

const rivalLog = (() => {
  const s = rivalStream();
  s.at(70_000).emit("run.completed", "@kernel", {});
  return s.events;
})();

function fakeApi(logs: Record<string, RunEvent[]>): RunApi {
  return {
    listRuns: async () => [],
    loadAllEvents: async (id) => {
      const log = logs[id];
      if (!log) throw new Error(`no run ${id}`);
      return log;
    },
    tailEvents: () => () => undefined,
    verifyRun: async () => {
      throw new Error("not used");
    },
  };
}

const scored = (id: string, cost: number): Official => {
  const found = readOfficial({ run_id: id, status: "completed", scenario: "x", metrics: { cost_usd: cost, completed: true } });
  if (!found) throw new Error("not an official");
  return found;
};

describe("the arena stage", () => {
  it("is loaded once both logs, the scored numbers and the replay checks are in", async () => {
    const stage = createArenaStage("s", "r", { api: fakeApi({ s: swarmLog, r: rivalLog }), official: async (id) => scored(id, id === "s" ? 1.5 : 0.25) });
    expect(stage.loaded()).toBe(false);
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    expect(stage.problem()).toBeNull();
    expect(stage.costs()).toEqual([1.5, 0.25]);
    expect(stage.session.left.getState().verify.state).toBe("error"); // the fake server cannot replay: settled, not pending
    stage.dispose();
  });

  it("runs on a fixed-step clock that no frame loop drives, and ends where the longer run ends", async () => {
    const stage = createArenaStage("s", "r", { api: fakeApi({ s: swarmLog, r: rivalLog }), official: async () => null });
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    expect(stage.session.clock.state.getState().mode).toBe("fixed-step");
    expect(stage.replay.end()).toBe(70_000);
    stage.replay.setPlaying(true);
    expect(stage.replay.playing()).toBe(true);
    const before = stage.replay.playhead();
    stage.replay.step();
    expect(stage.replay.playhead()).toBeGreaterThan(before);
    stage.replay.setPlaying(false);
    stage.replay.seek(12_000);
    expect(stage.sides.left.view().actors.o1.status).toBe("killed");
    expect(stage.sides.right.events()).toBe(rivalLog);
    stage.dispose();
  });

  it("says why a run cannot be shown", async () => {
    const stage = createArenaStage("s", "missing", { api: fakeApi({ s: swarmLog }), official: async () => null });
    await vi.waitFor(() => expect(stage.problem()).not.toBeNull());
    expect(stage.problem()).toMatch(/could not load missing/);
    stage.dispose();
  });

  it("goes on when the server has no scored numbers for a run", async () => {
    const stage = createArenaStage("s", "r", {
      api: fakeApi({ s: swarmLog, r: rivalLog }),
      official: async () => {
        throw new Error("no metrics");
      },
    });
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    expect(stage.costs()).toEqual([null, null]);
    stage.dispose();
  });
});

const demo = loadFixture<{ calls: unknown; meter: unknown; details: Record<string, unknown> }>("lens-demo-backup.json");

function lensApi(): { api: LensApi; read: string[] } {
  const read: string[] = [];
  const calls = readCalls(demo.calls);
  return {
    read,
    api: {
      calls: async () => calls,
      meter: async () => readMeter(demo.meter),
      detail: async (_run, effectId) => {
        read.push(effectId);
        const found = readCallDetail(demo.details[effectId]);
        if (!found) throw new Error(`no call ${effectId}`);
        return found;
      },
    },
  };
}

const planner: CallPick = { model: "wonder", actor: null, role: "root_planner", purpose: null, tag: null, nth: 0 };

describe("the run stage", () => {
  it("is loaded when the run, its checks, its cost, its calls and the calls the scene opens are in", async () => {
    const lens = lensApi();
    const stage = createRunStage("s", { plan: planner }, { api: fakeApi({ s: swarmLog }), official: async () => scored("s", 2.25), lens: lens.api });
    expect(stage.loaded()).toBe(false);
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    expect(stage.costs()).toEqual([2.25]);
    expect(stage.lensStore.getState().status).toBe("ready");
    expect(lens.read).toEqual(["eff-408.1"]); // read in full before the take, so opening it shows it at once
    expect(stage.store.getState().takeover.state).toBe("absent");
    stage.dispose();
  });

  it("reads no call in full that the scene does not open", async () => {
    const lens = lensApi();
    const stage = createRunStage("s", {}, { api: fakeApi({ s: swarmLog }), official: async () => null, lens: lens.api });
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    expect(lens.read).toEqual([]);
    stage.dispose();
  });

  it("goes on without a lens the server does not have", async () => {
    const stage = createRunStage("s", { plan: planner }, { api: fakeApi({ s: swarmLog }), official: async () => null, lens: { calls: async () => null, meter: async () => null, detail: async () => Promise.reject(new Error("none")) } });
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    expect(stage.lensStore.getState().status).toBe("unavailable");
    expect(stage.lens.open("plan")).toBe(`call "plan" is not in the run`);
    stage.dispose();
  });

  it("says why a run cannot be shown", async () => {
    const stage = createRunStage("nope", {}, { api: fakeApi({}), official: async () => null, lens: lensApi().api });
    await vi.waitFor(() => expect(stage.problem()).not.toBeNull());
    expect(stage.problem()).toMatch(/could not load nope/);
    stage.dispose();
  });

  it("opens a call by the name the scene gave it", async () => {
    const stage = createRunStage("s", { plan: planner, nope: { ...planner, model: "llama" } }, { api: fakeApi({ s: swarmLog }), official: async () => null, lens: lensApi().api });
    await vi.waitFor(() => expect(stage.loaded()).toBe(true));
    const lens: LensStoreApi = stage.lensStore;
    expect(stage.lens.open("plan")).toBeNull();
    expect(lens.getState()).toMatchObject({ open: true, selected: "eff-408.1", scope: { kind: "actor", actor: "o0" } });
    expect(stage.lens.open("nope")).toBe(`call "nope" is not in the run`);
    expect(stage.lens.open("unnamed")).toBe(`call "unnamed" is not in the scene's calls`);
    expect(stage.lens.open(null)).toBeNull();
    expect(lens.getState().open).toBe(false);
    stage.dispose();
  });
});

describe("the calls a scene names", () => {
  const rows = readCalls(demo.calls).calls;

  it("picks the nth of the calls that match every field the pick gives", () => {
    expect(pickCall(rows, planner)?.effect_id).toBe("eff-408.1");
    expect(pickCall(rows, { ...planner, model: "spark", role: "sub_planner", nth: 1 })?.effect_id).toBe("eff-1652.0");
    expect(pickCall(rows, { model: null, actor: "o2", role: null, purpose: "planning", tag: "plan|track", nth: 0 })?.effect_id).toBe("eff-1651.0");
    expect(pickCall(rows, { ...planner, nth: 1 })).toBeNull();
    expect(pickCall(rows, { ...planner, model: "llama" })).toBeNull();
  });

  it("matches a model by a part of its name, in any case", () => {
    expect(pickCall(rows, { ...planner, model: "WONDER-1" })?.model).toBe("muse-wonder-1.0");
  });

  it("gives the start and the end of each call the run has, and leaves out the others", () => {
    const times = callTimes(rows, { plan: planner, gone: { ...planner, model: "llama" } });
    expect([...times.keys()]).toEqual(["plan"]);
    expect(times.get("plan")).toEqual({ start: 3390, end: 18_031 });
  });

  it("opens through a lens store over the real call rows", () => {
    const opened: string[] = [];
    const lens = { getState: () => ({ calls: rows, openCall: (id: string) => void opened.push(id), close: () => void opened.push("close") }) } as unknown as LensStoreApi;
    const handle = lensHandle(lens, { plan: planner });
    expect(handle.open("plan")).toBeNull();
    expect(handle.open(null)).toBeNull();
    expect(opened).toEqual(["eff-408.1", "close"]);
  });
});

describe("the clock a take steps", () => {
  it("is moved by the take one fixed step at a time, playing or not, and starts and stops on request", async () => {
    const clock = createClock(takeClock());
    const replay = clockReplay(clock);
    expect(replay.playing()).toBe(false);
    replay.seek(5000);
    expect(replay.playhead()).toBe(5000);
    replay.setSpeed(4);
    expect(replay.speed()).toBe(4);
    expect(clock.state.getState().mode).toBe("fixed-step");
  });
});

describe("the note on a replay", () => {
  it("says real only for runs declared real, with the cost the server gave", () => {
    expect(replayNote([1.2345], true)).toBe("Replay of a real recorded run · real cost $1.23");
    expect(replayNote([0.4948], true)).toBe("Replay of a real recorded run · real cost $0.4948");
  });

  it("never calls a run real that is not declared real, whatever its cost: a practice run prices its tokens too", () => {
    expect(replayNote([0.2948], false)).toBe("Replay of a recorded run · practice model, no cost");
    expect(replayNote([0], false)).toBe("Replay of a recorded run · practice model, no cost");
    expect(replayNote([null], false)).toBe("Replay of a recorded run · practice model, no cost");
    expect(replayNote([0.2948, 0.3222], false)).toBe("Replay of two recorded runs · practice model, no cost");
    expect(replayNote([12.3, 8.5], false)).not.toMatch(/real/);
  });

  it("gives both costs of a real pair", () => {
    expect(replayNote([12.3, 8.5], true)).toBe("Replay of two real recorded runs · real cost $12.30 and $8.50");
  });

  it("says when a real take has no cost on record, instead of a cost it does not have", () => {
    expect(replayNote([0], true)).toBe("Replay of a real recorded run · real cost not on record");
    expect(replayNote([null], true)).toBe("Replay of a real recorded run · real cost not on record");
    expect(replayNote([12.3, 0], true)).toBe("Replay of two real recorded runs · real cost $12.30 (swarm), not on record (rival)");
    expect(replayNote([null, 8.5], true)).toBe("Replay of two real recorded runs · real cost not on record (swarm), $8.50 (rival)");
    expect(replayNote([0, null], true)).toBe("Replay of two real recorded runs · real cost not on record");
  });

  it("flags a real take that has a cost missing, and nothing else", () => {
    expect(noteProblems([1.2], true)).toEqual([]);
    expect(noteProblems([12.3, 8.5], true)).toEqual([]);
    expect(noteProblems([null], true)).toEqual(["declared real, but the server has no cost for the run"]);
    expect(noteProblems([12.3, 0], true)).toEqual(["declared real, but the server has no cost for the rival run"]);
    expect(noteProblems([null, null], true)).toHaveLength(2);
    expect(noteProblems([null, 0], false)).toEqual([]);
  });
});
