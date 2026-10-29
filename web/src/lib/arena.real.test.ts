// The arena counters on recorded runs, against what W1's scored metrics (bench/recovery.py, `analyze`)
// report for the same logs. The runs are read, never written, and the whole file skips on a machine
// that does not have them (a CI box, a fresh clone). arena.parity.test.ts holds the full comparison; this
// file keeps the headline numbers of each run and the facts about its outages:
//   duplicated calls = the scored `dup_calls` (calls of an attempt that a later one replaced, own calls
//                      asked again, completed calls whose request was already paid for)
//   re-dispatches    = the scored `lost_redispatches`
//   crashes          = the run's kill_coordinator faults
// Both new modes of W1 (`durable`, `durable-max`) get their own fixture when W1 merges.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";

import { arenaCounters } from "./arena";
import { foldEvents } from "./reducer";
import { supervisionTotals } from "./supervision";
import type { RunEvent } from "./types";

const runPath = (run: string): string => `${homedir()}/.fractalswarm/runs/${run}/events.jsonl`;

function fold(run: string) {
  const events = readFileSync(runPath(run), "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunEvent);
  const end = events[events.length - 1].ts_virtual;
  const view = foldEvents(events);
  return { view, end, counters: arenaCounters(view, end) };
}

const recorded = (run: string) => existsSync(runPath(run));

describe.skipIf(!recorded("t2-real-c3-central-seed1"))("central baseline, 5 coordinator crashes (real run)", () => {
  const { view, counters } = fold("t2-real-c3-central-seed1");

  it("matches the scored metrics: 42 duplicated calls, 22 contracts dispatched again", () => {
    expect(counters).toMatchObject({ duplicatedCalls: 42, redispatches: 22, coordinatorCrashes: 5, hardViolations: 0 });
  });

  it("pairs every crash with its restart, and the contracts redone add up to the redispatches plus the plans", () => {
    expect(supervisionTotals(view.supervision)).toEqual({ crashes: 5, restarts: 5, redone: 27, adopted: 0 });
    expect(view.supervision.crashes.map((c) => [c.ts, c.restartedTs])).toEqual([
      [37_047, 42_062],
      [53_343, 58_375],
      [66_297, 71_312],
      [82_328, 87_359],
      [102_047, 107_062],
    ]);
  });

  it("measures the outage from crash to restart, and no agent idles in it: the crash takes them with it", () => {
    expect(counters.coordinatorDownMs).toBe(25_108);
    expect(counters.idleAgentsNow).toBe(0);
    // The agents are stopped with the supervisor and respawned by the restart, and the redone work is counted above.
    // bench/recovery.py scores this run's idle agent-seconds 0.0 too (arena.parity.test.ts).
    expect(counters.idleAgentMs).toBe(0);
    expect(Object.keys(view.actors).length).toBeGreaterThan(2);
  });
});

describe.skipIf(!recorded("t2-real-c3-swarm-seed1b"))("swarm, 5 coordinator kills (real run)", () => {
  const { view, counters } = fold("t2-real-c3-swarm-seed1b");

  it("matches the scored metrics: 13 duplicated calls, 2 contracts dispatched again", () => {
    expect(counters).toMatchObject({ duplicatedCalls: 13, redispatches: 2, coordinatorCrashes: 5, hardViolations: 0 });
  });

  it("ends each outage at the last takeover event for the victim", () => {
    expect(view.arena.windows.map((w) => [w.coordinator, w.since, w.until])).toEqual([
      ["o2.1", 39_906, 45_437],
      ["o2.2", 51_250, 57_812],
      ["o3.1", 53_000, 57_750],
      ["o3.2", 66_609, 72_875],
      ["o3.3", 91_420, 99_156],
    ]);
    expect(counters.coordinatorDownMs).toBe(30_845);
  });

  it("counts idle agents only while a really killed coordinator has them waiting", () => {
    // 13 agents, 2 under each killed orchestrator: false deaths and finished or killed agents
    // must not keep counting after a takeover.
    expect(counters.idleAgentsNow).toBe(0);
    expect(counters.idleAgentMs).toBeLessThan(counters.coordinatorDownMs * 2);
  });
});

describe.skipIf(!recorded("tmp-pipeline-c3"))("pipeline baseline, 5 coordinator crashes (real run)", () => {
  const { counters } = fold("tmp-pipeline-c3");

  it("matches the scored metrics: one call and one contract redone per crash", () => {
    expect(counters).toMatchObject({
      coordinatorCrashes: 5,
      coordinatorDownMs: 25_000,
      redispatches: 5,
      duplicatedCalls: 5,
    });
  });

  it("loses its one agent with each crash, so nothing idles (bench/recovery.py: 0.0 idle agent-seconds)", () => {
    expect(counters.idleAgentMs).toBe(0);
  });
});
