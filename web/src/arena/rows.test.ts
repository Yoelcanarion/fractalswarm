import { describe, expect, it } from "vitest";

import { arenaCounters } from "../lib/arena";
import { foldEvents } from "../lib/reducer";
import { recoveryAt } from "../lib/recovery";
import { readOfficial, type Official } from "./official";
import { isSettled, ROW_DEFS, scoreRows, type SideNumbers } from "./rows";
import { crash, kill, ready, restart, rivalStream, sent, swarmStream, takeOver } from "./testing";

/** One side at ``nowMs``: the view folds the events that have happened by then, as the store's does. */
function side(events: ReturnType<typeof swarmStream>["events"], nowMs: number, over: Partial<SideNumbers> = {}): SideNumbers {
  const view = foldEvents(events.filter((e) => e.ts_virtual <= nowMs));
  const { idleMs, crashStopped } = recoveryAt(view.arena.recorded, nowMs);
  return { counters: arenaCounters(view, nowMs), idleMs, windows: view.arena.windows, nowMs, finished: false, official: null, crashStopped, ...over };
}

/** A swarm that lost o1 for 5 s and a supervisor that was down for 5 s, each with a contract that was ready at 9 s and
 * only went out at 15 s: it waited on the coordinator that was down for 5 s of that. */
function pair() {
  const swarm = swarmStream();
  ready(swarm, "g1", "o1", 9_000);
  kill(swarm, "o1", 10_000);
  takeOver(swarm, "o1", "o2", 14_000, 15_000);
  sent(swarm, "g1", "o2", 15_000, "o2.a1");
  const rival = rivalStream(undefined, 4);
  ready(rival, "g1", "o0", 9_000);
  crash(rival, "o0", 10_000, 5000);
  restart(rival, "o0", 15_000);
  sent(rival, "g1", "o0", 15_000, "o0.a1");
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
    expect(dependency.left).toEqual({ value: 5, source: "live" }); // the wait of 9 s to 15 s, over the 10 s to 15 s it was down
    expect(dependency.right).toEqual({ value: 5, source: "live" });
    expect(rows.every((r) => r.left.source === "live" && r.right.source === "live")).toBe(true);
  });

  it("lets an open outage grow with the playhead", () => {
    const rival = rivalStream(undefined, 4);
    crash(rival, "o0", 10_000, 5000);
    const at = (ms: number) => scoreRows(side(rival.events, ms), side(rival.events, ms)).find((r) => r.id === "recover")!.right.value;
    expect(at(10_000)).toBe(0);
    expect(at(12_500)).toBe(2.5);
    expect(at(14_000)).toBe(4);
  });

  it("counts the dependency time as the metrics score it: a wait counts once it has ended", () => {
    const { swarm, rival } = pair();
    const at = (ms: number) => {
      const row = scoreRows(side(swarm, ms), side(rival, ms)).find((r) => r.id === "dependency")!;
      return [row.left.value, row.right.value];
    };
    expect(at(12_000)).toEqual([0, 0]); // the outage is open and the contract still waits: no interval yet
    expect(at(14_999)).toEqual([0, 0]);
    expect(at(15_000)).toEqual([5, 5]); // the contract goes out: 10 s to 15 s of its wait was spent with the owner down
  });

  it("counts the idle agent-seconds as the metrics score them, so the number shown while the run plays is the one it ends on: a wait counts once it has ended", () => {
    const { swarm, rival } = pair();
    const at = (ms: number, over: Partial<SideNumbers> = {}) => {
      const row = scoreRows(side(swarm, ms, over), side(rival, ms, over)).find((r) => r.id === "idle")!;
      return [row.left.value, row.right.value];
    };
    expect(at(12_000)).toEqual([0, 0]); // the outage is open and the contract still waits: no interval yet
    expect(at(14_999)).toEqual([0, 0]);
    expect(at(15_000)).toEqual([5, 5]); // the contract goes out to an agent that was free: 10 s to 15 s of its wait was spent with the owner down
    const row = scoreRows(side(swarm, 15_000), side(rival, 15_000)).find((r) => r.id === "idle")!;
    expect(row.left.source).toBe("live");
    expect(row.definition).toBe("Agent time spent idle because the coordinator they answer to was down."); // nothing is said of a dash: there is none
    // and where the run has no scored number (a server without the recovery metrics) the row stays on the count, which is the same rule
    expect(at(16_000, { finished: true, official: official(null) })).toEqual([5, 5]);
  });

  it("does not count an agent while it holds an attempt, nor one that a crash has stopped", () => {
    const busy = rivalStream(undefined, 4);
    sent(busy, "g0", "o0", 8_000, "o0.a1", "c0"); // o0.a1 took an attempt before the crash and has not handed it in
    ready(busy, "g1", "o0", 9_000);
    crash(busy, "o0", 10_000, 5000);
    restart(busy, "o0", 15_000);
    sent(busy, "g1", "o0", 15_000, "o0.a1");
    const gone = rivalStream(undefined, 4);
    ready(gone, "g1", "o0", 9_000);
    crash(gone, "o0", 10_000, 5000, ["o0.a1"]);
    restart(gone, "o0", 15_000, ["o0.a1"]);
    sent(gone, "g1", "o0", 15_000, "o0.a1");
    const idle = (events: typeof busy.events) => scoreRows(side(events, 15_000), side(events, 15_000)).find((r) => r.id === "idle")!.right.value;
    expect(idle(busy.events)).toBe(0);
    expect(idle(gone.events)).toBe(0);
    expect(idle(pair().rival)).toBe(5); // the same wait with a free agent
  });

  it("says under a side's idle number that a worker a crash stopped is not idle, as soon as one has and only for a side whose crash stopped workers", () => {
    const { swarm } = pair();
    const rival = rivalStream(undefined, 4);
    ready(rival, "g1", "o0", 9_000);
    crash(rival, "o0", 10_000, 5000, ["o0.a1", "o0.a2"]);
    restart(rival, "o0", 15_000, ["o0.a1", "o0.a2"]);
    sent(rival, "g1", "o0", 15_000, "o0.a1");
    const note = "A worker a crash stopped is not idle: see coordinator-dependency time.";
    const idle = (ms: number) => scoreRows(side(swarm, ms), side(rival.events, ms)).find((r) => r.id === "idle")!;
    expect(idle(9_000).notes).toEqual({ left: null, right: null }); // nothing has stopped yet: there is nothing to explain
    expect(idle(12_000).notes).toEqual({ left: null, right: note }); // the number is live and so is the line
    // and on the scored number, which the line goes on explaining
    const scored = official({ idle_agent_s: 0, ttr_own_mean_s: 5.2, cdt_s: 4.8, dup_calls: 1, unnecessary_reassignments: 0 });
    const done = scoreRows(side(swarm, 16_000, { finished: true, official: scored }), side(rival.events, 16_000, { finished: true, official: scored })).find((r) => r.id === "idle")!;
    expect(done.right).toEqual({ value: 0, source: "official" });
    expect(done.notes).toEqual({ left: null, right: note });
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
    expect(live.label).toBe("Contracts sent again");
    const scored = official({ unnecessary_reassignments: 0 });
    const settled = scoreRows(side(swarm, 16_000, { finished: true, official: scored }), side(rival, 16_000, { finished: true, official: scored })).find((r) => r.id === "reassigned")!;
    expect(settled.definition).not.toContain("So far");
    expect(settled.label).toBe("Unnecessary reassignments");
  });
});

describe("the cost row", () => {
  /** A side at the end of its run: its log spent ``spent``, its metrics scored ``scored`` and counted ``cancelled`` cancelled calls. */
  const ended = (spent: number, scored: number, cancelled: number | null, over: Partial<SideNumbers> = {}): SideNumbers => {
    const base = side(pair().swarm, 16_000, { finished: true, official: official(null, { cost_usd: scored, cancelled_llm_calls: cancelled }), ...over });
    return { ...base, counters: { ...base.counters, costUsd: spent } };
  };
  const cost = (l: SideNumbers, r: SideNumbers) => scoreRows(l, r).find((row) => row.id === "cost")!;

  it("is titled on the pre-registered basis once the metrics have scored it, and as the spend so far before", () => {
    expect(cost(ended(0.5, 0.5, 0), ended(0.5, 0.5, 0)).label).toBe("Cost, pre-registered basis");
    const playing = side(pair().swarm, 12_000);
    expect(cost(playing, playing).label).toBe("Cost so far");
    expect(cost(ended(0.5, 0.5, 0), playing).label).toBe("Cost so far"); // a number of the row is still the spend
    expect(cost(playing, playing).definition).toContain("The scored figure adds an estimate");
  });

  it("adds a line where the scored cost is more than the spend: both numbers and the cancelled calls, read from the run", () => {
    // the in-process pair: the rival's log spent $0.605, the metrics scored $0.785 for 27 cancelled calls; the swarm's two agree
    const central = cost(ended(0.50397, 0.50397, 0), ended(0.604701, 0.78461, 27));
    expect(central.right).toEqual({ value: 0.78461, source: "official" });
    expect(central.notes).toEqual({ left: null, right: "$0.605 spent, $0.180 estimated for 27 cancelled calls" });
    // the durable pair: the swarm's differ by a little
    expect(cost(ended(0.401161, 0.406323, 2), ended(0.455, 0.455, 0)).notes).toEqual({ left: "$0.401 spent, $0.005 estimated for 2 cancelled calls", right: null });
  });

  it("says one cancelled call in the singular, and leaves the count out where the metrics give none", () => {
    expect(cost(ended(0.5, 0.6, 1), ended(0.5, 0.5, 0)).notes.left).toBe("$0.500 spent, $0.100 estimated for 1 cancelled call");
    expect(cost(ended(0.5, 0.6, null), ended(0.5, 0.5, 0)).notes.left).toBe("$0.500 spent, $0.100 estimated");
  });

  it("adds no line while the run plays, where the two agree at the three decimals shown, or where the log holds no spend to split", () => {
    expect(cost(ended(0.5, 0.6, 3, { finished: false }), ended(0.5, 0.5, 0)).notes.left).toBeNull();
    expect(cost(ended(0.5, 0.6, 3, { official: null }), ended(0.5, 0.5, 0)).notes.left).toBeNull();
    expect(cost(ended(0.4551, 0.45512, 0), ended(0.5, 0.5, 0)).notes.left).toBeNull();
    expect(cost(ended(0, 0.29, 3), ended(0.5, 0.5, 0)).notes.left).toBeNull();
    expect(scoreRows(ended(0.5, 0.6, 3), ended(0.5, 0.6, 3)).filter((row) => row.id !== "cost").every((row) => row.notes.left === null && row.notes.right === null)).toBe(true);
  });
});
