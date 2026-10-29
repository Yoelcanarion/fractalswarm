import { describe, expect, it } from "vitest";

import { arenaCounters } from "../lib/arena";
import { foldEvents } from "../lib/reducer";
import { readOfficial, type Official } from "./official";
import { isSettled, ROW_DEFS, scoreRows, type SideNumbers } from "./rows";
import { call, crash, kill, restart, rivalStream, swarmStream, takeOver } from "./testing";

/** One side at ``nowMs``: the view folds the events that have happened by then, as the store's does. */
function side(events: ReturnType<typeof swarmStream>["events"], nowMs: number, over: Partial<SideNumbers> = {}): SideNumbers {
  const view = foldEvents(events.filter((e) => e.ts_virtual <= nowMs));
  return { counters: arenaCounters(view, nowMs), windows: view.arena.windows, nowMs, finished: false, official: null, ...over };
}

/** A swarm that lost o1 for 5 s and a supervisor that was down for 5 s. */
function pair() {
  const swarm = swarmStream();
  kill(swarm, "o1", 10_000);
  takeOver(swarm, "o1", "o2", 14_000, 15_000);
  const rival = rivalStream(undefined, 4);
  crash(rival, "o0", 10_000, 5000);
  restart(rival, "o0", 15_000);
  return { swarm: swarm.events, rival: rival.events };
}

const official = (recovery: unknown, over: Record<string, unknown> = {}): Official =>
  readOfficial({
    run_id: "x",
    status: "completed",
    metrics: { completed: true, valid: true, detail: "placed 48/48, hard violations 0, soft 0", cost_usd: 0.29, ...over },
    recovery,
  })!;

describe("the scoreboard rows", () => {
  it("has the seven counters of the brief, in order", () => {
    expect(ROW_DEFS.map((r) => r.id)).toEqual(["idle", "recover", "dependency", "cost", "duplicated", "reassigned", "violations"]);
  });

  it("runs on the fold while the run plays, and says so", () => {
    const { swarm, rival } = pair();
    const rows = scoreRows(side(swarm, 15_000), side(rival, 15_000));
    const dependency = rows.find((r) => r.id === "dependency")!;
    expect(dependency.left).toEqual({ value: 5, source: "live" }); // 10 s to 15 s: kill to the last takeover event
    expect(dependency.right).toEqual({ value: 5, source: "live" });
    expect(rows.every((r) => r.left.source === "live" && r.right.source === "live")).toBe(true);
  });

  it("lets an open outage grow with the playhead", () => {
    const rival = rivalStream(undefined, 4);
    crash(rival, "o0", 10_000, 5000);
    const at = (ms: number) => scoreRows(side(rival.events, ms), side(rival.events, ms)).find((r) => r.id === "dependency")!.right.value;
    expect(at(10_000)).toBe(0);
    expect(at(12_500)).toBe(2.5);
    expect(at(14_000)).toBe(4);
  });

  it("counts idle agent-seconds from the agents that wait on a coordinator that is out", () => {
    const rival = rivalStream(undefined, 4);
    call(rival, "o0.a1", "e1");
    crash(rival, "o0", 10_000, 5000);
    restart(rival, "o0", 15_000);
    const idle = scoreRows(side(rival.events, 15_000), side(rival.events, 15_000)).find((r) => r.id === "idle")!;
    expect(idle.right.value).toBeCloseTo(15, 6); // 3 idle agents for 5 s
  });

  it("measures the time to recover as the mean outage so far", () => {
    const rival = rivalStream(undefined, 2);
    crash(rival, "o0", 10_000, 5000);
    restart(rival, "o0", 15_000);
    crash(rival, "o0", 30_000, 5000);
    restart(rival, "o0", 38_000);
    const row = scoreRows(side(rival.events, 38_000), side(rival.events, 38_000)).find((r) => r.id === "recover")!;
    expect(row.right.value).toBeCloseTo(6.5, 6); // (5 s + 8 s) / 2
    expect(scoreRows(side(rival.events, 5_000), side(rival.events, 5_000)).find((r) => r.id === "recover")!.right.value).toBeNull();
  });

  it("ends on the official numbers once the run has played out, and keeps the live ones for what it does not have", () => {
    const { swarm, rival } = pair();
    const scored = official({ idle_agent_s: 22.5, ttr_own_mean_s: 5.2, cdt_s: 4.8, dup_calls: 1, unnecessary_reassignments: 0 }, { cost_usd: 0.3 });
    const rows = scoreRows(side(swarm, 16_000, { finished: true, official: scored }), side(rival, 16_000, { finished: true, official: scored }));
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.idle.left).toEqual({ value: 22.5, source: "official" });
    expect(by.cost.left).toEqual({ value: 0.3, source: "official" });
    expect(by.violations.left).toEqual({ value: 0, source: "official" });
    expect(isSettled(by.dependency)).toBe(true);
  });

  it("stays on the live numbers where the server has no recovery metrics yet, without showing zeros for them", () => {
    const { swarm, rival } = pair();
    const scored = official(null);
    const rows = scoreRows(side(swarm, 16_000, { finished: true, official: scored }), side(rival, 16_000, { finished: true, official: scored }));
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.cost.left.source).toBe("official");
    expect(by.dependency.left.source).toBe("live");
    expect(isSettled(by.dependency)).toBe(false);
    expect(isSettled(by.cost)).toBe(true);
  });

  it("ignores the official numbers while the run is still playing", () => {
    const { swarm, rival } = pair();
    const scored = official({ cdt_s: 99 });
    const rows = scoreRows(side(swarm, 12_000, { official: scored }), side(rival, 12_000, { official: scored }));
    expect(rows.find((r) => r.id === "dependency")!.left.source).toBe("live");
  });

  it("draws each bar against the larger number of the row, with no winner", () => {
    const { swarm, rival } = pair();
    const rows = scoreRows(side(swarm, 15_000, { counters: { ...arenaCounters(foldEvents(swarm), 15_000), costUsd: 0.1 } }), side(rival, 15_000, { counters: { ...arenaCounters(foldEvents(rival), 15_000), costUsd: 0.4 } }));
    const cost = rows.find((r) => r.id === "cost")!;
    expect(cost.leftShare).toBeCloseTo(0.25, 6);
    expect(cost.rightShare).toBe(1);
    expect(Object.keys(cost)).not.toContain("winner");
  });

  it("draws empty bars, not NaN, when both numbers of a row are zero or missing", () => {
    const rows = scoreRows(side(swarmStream().events, 0), side(rivalStream().events, 0));
    for (const row of rows) {
      expect(Number.isFinite(row.leftShare)).toBe(true);
      expect(Number.isFinite(row.rightShare)).toBe(true);
      expect(row.leftShare).toBe(0);
    }
  });

  it("explains that the live reassignment count is wider than the scored one", () => {
    const { swarm, rival } = pair();
    const live = scoreRows(side(swarm, 15_000), side(rival, 15_000)).find((r) => r.id === "reassigned")!;
    expect(live.definition).toContain("unnecessary");
    const scored = official({ unnecessary_reassignments: 0 });
    const settled = scoreRows(side(swarm, 16_000, { finished: true, official: scored }), side(rival, 16_000, { finished: true, official: scored })).find((r) => r.id === "reassigned")!;
    expect(settled.definition).not.toContain("So far");
  });
});
