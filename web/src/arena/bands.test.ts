import { describe, expect, it } from "vitest";

import { foldEvents } from "../lib/reducer";
import { laneOf, packRows, sharedEnd } from "./bands";
import { describeRecovery, recoveryOf } from "./recovery";
import { sideStatus } from "./status";
import { call, crash, kill, restart, rivalStream, swarmStream, takeOver } from "./testing";

describe("the lanes of the shared timeline", () => {
  it("draws a supervisor's outage from its crash to its restart, and marks both ends", () => {
    const s = rivalStream(undefined, 2);
    crash(s, "o0", 10_000, 5000);
    restart(s, "o0", 15_000);
    s.at(20_000).emit("run.completed", "@kernel");
    const lane = laneOf(s.events);
    expect(lane.end).toBe(20_000);
    expect(lane.bands).toEqual([{ coordinator: "o0", since: 10_000, until: 15_000, source: "supervisor", open: false, row: 0 }]);
    expect(lane.marks.map((m) => [m.kind, m.ts])).toEqual([
      ["coordinator-kill", 10_000],
      ["restart", 15_000],
    ]);
  });

  it("draws the swarm's outage from the kill to the last takeover event, and marks the adoption", () => {
    const s = swarmStream();
    kill(s, "o1", 10_000);
    takeOver(s, "o1", "o2", 14_000, 15_000);
    const lane = laneOf(s.events);
    expect(lane.bands).toMatchObject([{ coordinator: "o1", since: 10_000, until: 15_000, source: "chaos", open: false }]);
    expect(lane.marks.map((m) => m.kind)).toEqual(["coordinator-kill", "adopted"]);
  });

  it("runs an outage the log never ends to the end of the run, and says it is open", () => {
    const s = swarmStream();
    kill(s, "o1", 10_000);
    s.at(30_000).emit("run.completed", "@kernel");
    expect(laneOf(s.events).bands).toMatchObject([{ since: 10_000, until: 30_000, open: true }]);
  });

  it("keeps only the markers that matter at this size", () => {
    const s = swarmStream();
    s.at(1000).emit("chaos.injected", "@chaos", { fault: "kill_agent", target: "o1.a1" });
    s.at(2000).emit("member.dead", "@detector", { member: "o1.a1" });
    kill(s, "o1", 3000);
    expect(laneOf(s.events).marks.map((m) => m.kind)).toEqual(["coordinator-kill"]);
  });

  it("puts overlapping outages in rows of their own, and sequential ones in the same row", () => {
    const rows = packRows([
      { since: 0, until: 10 },
      { since: 5, until: 15 },
      { since: 10, until: 20 },
      { since: 12, until: 30 },
    ]);
    // C starts as A ends, so it takes A's row back; D overlaps C and B, so it needs a third.
    expect(rows.map((r) => r.row)).toEqual([0, 1, 0, 2]);
  });

  it("is computed once per log", () => {
    const events = swarmStream().events;
    expect(laneOf(events)).toBe(laneOf(events));
  });

  it("shares the end of the longer run", () => {
    expect(sharedEnd({ end: 70_000 }, { end: 76_000 })).toBe(76_000);
    expect(sharedEnd()).toBe(0);
  });
});

describe("what a side says about itself", () => {
  const at = (stream: ReturnType<typeof swarmStream>, system: "swarm" | "durable-max", nowMs: number) => {
    const view = foldEvents(stream.events.filter((e) => e.ts_virtual <= nowMs));
    return sideStatus(system, view, view.arena.windows, nowMs);
  };

  it("says a swarm has no coordinator down before anything happens", () => {
    expect(at(swarmStream(), "swarm", 0)).toEqual({ tone: "ok", text: "No coordinator down · 4 agents", restart: null });
  });

  it("follows the swarm's outage from the kill to the takeover, then clears", () => {
    const s = swarmStream();
    kill(s, "o1", 10_000);
    expect(at(s, "swarm", 12_000)).toMatchObject({ tone: "danger", text: "o1 down for 2.0 s · not noticed yet" });
    s.at(12_500).emit("member.suspected", "@detector", { member: "o1" });
    expect(at(s, "swarm", 13_000).text).toBe("o1 down for 3.0 s · suspected, confirming");
    takeOver(s, "o1", "o2", 14_000, 15_000);
    expect(at(s, "swarm", 15_500)).toMatchObject({ tone: "warn", text: "o1 down 5.0 s · o2 took over" });
    expect(at(s, "swarm", 25_000).tone).toBe("ok");
  });

  it("says what a down supervisor costs: the agents waiting for it, and a restart under way", () => {
    const s = rivalStream(undefined, 4);
    call(s, "o0.a1", "e1");
    crash(s, "o0", 10_000, 5000);
    expect(at(s, "durable-max", 12_500)).toEqual({ tone: "danger", text: "o0 down for 2.5 s · 3 agents waiting for it", restart: 0.5 });
  });

  it("says the workers an in-process supervisor took down with it", () => {
    const s = rivalStream(undefined, 3);
    crash(s, "o0", 10_000, 5000, ["o0.a1", "o0.a2", "o0.a3"]);
    expect(at(s, "durable-max", 11_000).text).toBe("o0 down for 1.0 s · 3 workers stopped with it");
  });

  it("reports the restart for a few seconds, with what a durable supervisor read back", () => {
    const s = rivalStream(undefined, 2);
    crash(s, "o0", 10_000, 5000);
    s.at(15_000).emit("supervisor.adopted", "o0", { results: 7, verdicts: 0, plans: 1, bookings: 0, waiting: 0 });
    restart(s, "o0", 15_000);
    expect(at(s, "durable-max", 16_000)).toMatchObject({ tone: "warn", text: "o0 restarted after 5.0 s · 7 results read back from the log" });
    expect(at(s, "durable-max", 30_000).text).toBe("Supervisor up · 2 agents");
  });

  describe("once the run has played out", () => {
    const ended = (stream: ReturnType<typeof swarmStream>, system: "swarm" | "durable-max", nowMs = 100_000) => {
      const view = foldEvents(stream.events);
      return sideStatus(system, view, view.arena.windows, nowMs, true);
    };

    it("says how many coordinators the swarm lost, in place of 'no coordinator down' over the crosses on its board", () => {
      const s = swarmStream();
      kill(s, "o1", 10_000);
      takeOver(s, "o1", "o2", 14_000, 15_000);
      kill(s, "o2", 30_000);
      takeOver(s, "o2", "o0", 34_000, 35_000);
      s.at(60_000).emit("run.completed", "@kernel");
      expect(ended(s, "swarm")).toEqual({ tone: "ok", text: "Finished, lost 2 coordinators", restart: null });
      // right after the last takeover it is still the end that is said, not who took over
      expect(ended(s, "swarm", 36_000).text).toBe("Finished, lost 2 coordinators");
    });

    it("says how many times the supervisor crashed, in place of 'supervisor up'", () => {
      const s = rivalStream(undefined, 2);
      crash(s, "o0", 10_000, 5000);
      restart(s, "o0", 15_000);
      s.at(60_000).emit("run.completed", "@kernel");
      expect(ended(s, "durable-max")).toEqual({ tone: "ok", text: "Finished, supervisor crashed 1 time", restart: null });
      const twice = rivalStream(undefined, 2);
      crash(twice, "o0", 10_000, 5000);
      restart(twice, "o0", 15_000);
      crash(twice, "o0", 30_000, 5000);
      restart(twice, "o0", 35_000);
      twice.at(60_000).emit("run.completed", "@kernel");
      expect(ended(twice, "durable-max").text).toBe("Finished, supervisor crashed 2 times");
    });

    it("says so when nothing crashed", () => {
      const swarm = swarmStream();
      swarm.at(60_000).emit("run.completed", "@kernel");
      expect(ended(swarm, "swarm").text).toBe("Finished, no coordinator lost");
      const rival = rivalStream(undefined, 2);
      rival.at(60_000).emit("run.completed", "@kernel");
      expect(ended(rival, "durable-max").text).toBe("Finished, the supervisor never crashed");
    });

    it("does not call a run that was halted finished", () => {
      const s = swarmStream();
      kill(s, "o1", 10_000);
      takeOver(s, "o1", "o2", 14_000, 15_000);
      s.at(60_000).emit("run.halted", "@kernel", { reason: "budget" });
      expect(ended(s, "swarm")).toEqual({ tone: "danger", text: "Did not finish, lost 1 coordinator", restart: null });
    });

    it("still says an outage that the log never closed", () => {
      const s = swarmStream();
      kill(s, "o1", 10_000);
      s.at(30_000).emit("run.completed", "@kernel");
      expect(ended(s, "swarm", 30_000)).toMatchObject({ tone: "danger", text: "o1 down for 20.0 s · not noticed yet" });
    });
  });

  it("waits for a run that has not started", () => {
    const view = foldEvents([]);
    expect(sideStatus("swarm", view, [], 0)).toMatchObject({ tone: "muted", text: "Waiting for the run" });
  });
});

describe("the supervisor's recovery report", () => {
  it("counts what the log shows, and labels the numbers as the log's", () => {
    const s = rivalStream(undefined, 2);
    crash(s, "o0", 10_000, 5000);
    s.at(15_000).emit("supervisor.adopted", "o0", { results: 7, verdicts: 0, plans: 1, bookings: 0, waiting: 0 });
    restart(s, "o0", 15_000);
    crash(s, "o0", 30_000, 5000);
    restart(s, "o0", 36_000);
    const report = recoveryOf(foldEvents(s.events))!;
    expect(report).toEqual({ crashes: 2, restarts: 2, redone: 0, readBack: 7, restartMs: 5500, unfinished: 0 });
    const chip = describeRecovery(report);
    expect(chip.tone).toBe("good");
    expect(chip.text).toBe("Recovery: 2 crashes, 2 restarted · 7 results read back from the log");
    expect(chip.detail).toContain("Counted from this run's log");
    expect(chip.detail).toContain("5.5 s");
  });

  it("is quiet for a run with no supervisor crash, and warns about a crash that never restarted", () => {
    expect(recoveryOf(foldEvents(swarmStream().events))).toBeNull();
    expect(describeRecovery(null).tone).toBe("muted");
    const s = rivalStream(undefined, 1);
    crash(s, "o0", 10_000, 5000);
    const open = describeRecovery(recoveryOf(foldEvents(s.events)));
    expect(open.tone).toBe("warn");
    expect(open.detail).toContain("1 crash not restarted");
  });
});
