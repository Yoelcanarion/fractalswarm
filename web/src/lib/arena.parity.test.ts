// The arena's display counters (lib/arena.ts, a fold a scrubber can drag) against the numbers W1's metrics score for the
// same logs (bench/recovery.py `analyze`, served as `recovery` by GET /api/runs/{id}/metrics). The scoreboard shows the
// fold while a run plays and the scored number once it has ended, so a figure that differs jumps at the last event. This
// file pins both sides: where the fold IS the scored number (the crashes, the outage windows to the millisecond, the
// contracts sent again, duplicated work, coordinator-dependency time, idle agent-seconds, and at every prefix of the log).
// The idle agent-seconds the arena shows are the scored rule run on the log so far (lib/recovery.ts, `idleMs`), so the
// card ends on the number the run is scored on, on every log the site ships. (lib/arena.ts also keeps the older display
// fold of the free agents under a coordinator that is out, `idleAgentMs`; the card no longer reads it, and the first
// block of cases below says by how much it differs.)
//
// Official numbers: lib/fixtures/recovery-official.json, taken from `analyze` on each log and on prefixes of it (`prefixes`:
// the dependency time, the waits and the duplicated calls; `idle_prefixes`: the idle agent-seconds). The logs in demo/ are
// in the repo; the three Phase 1 runs are read from ~/.fractalswarm/runs and their blocks skip on a machine without them.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";

import { arenaCounters } from "./arena";
import { Folder } from "./playback";
import { foldEvents } from "./reducer";
import { recoveryAt } from "./recovery";
import { loadFixture, loadJsonl } from "./testing";
import type { RunEvent } from "./types";

interface OfficialRun {
  events: number;
  crashes: number;
  crash_windows_s: [number, number][];
  lost_redispatches: number;
  dup_calls: number;
  idle_agent_s: number;
  idle_agent_own_s: number;
  idle_agent_wide_s: number;
  cdt_s: number;
  blocked_total_s: number;
  /** [events, ts_ms of the last of them, cdt_ms, blocked_ms, dup_calls] of `analyze` on the first `events` events. */
  prefixes: [number, number, number, number, number][];
  /** [events, idle_ms] of `analyze` on the first `events` events: round(1000 * idle_agent_s). */
  idle_prefixes: [number, number][];
}

const official = loadFixture<{ runs: Record<string, OfficialRun> }>("recovery-official.json").runs;

const recordedPath = (run: string): string => `${homedir()}/.fractalswarm/runs/${run}/events.jsonl`;
const recorded = (run: string): RunEvent[] =>
  readFileSync(recordedPath(run), "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunEvent);

interface Case {
  name: string;
  what: string;
  present: boolean;
  load: () => RunEvent[];
  /** The older display fold's idle agent-seconds (`counters.idleAgentMs`), and how it stands to the scored figure (`idle_agent_s`). */
  idle?: { fold: number; against: "equal" | "above" };
}

const CASES: Case[] = [
  {
    name: "demo-backup",
    what: "swarm, 5 coordinator kills (the committed demo log)",
    present: true,
    load: () => loadJsonl("demo/backup/events.jsonl"),
    idle: { fold: 14.078, against: "above" },
  },
  {
    name: "central",
    what: "central baseline, 5 crashes",
    present: existsSync(recordedPath("t2-real-c3-central-seed1")),
    load: () => recorded("t2-real-c3-central-seed1"),
    idle: { fold: 0, against: "equal" },
  },
  {
    name: "swarm-c3",
    what: "swarm, 5 coordinator kills (Phase 1 real run)",
    present: existsSync(recordedPath("t2-real-c3-swarm-seed1b")),
    load: () => recorded("t2-real-c3-swarm-seed1b"),
    idle: { fold: 26.564, against: "equal" },
  },
  {
    name: "pipeline-c3",
    what: "pipeline baseline, 5 crashes",
    present: existsSync(recordedPath("tmp-pipeline-c3")),
    load: () => recorded("tmp-pipeline-c3"),
    idle: { fold: 0, against: "equal" },
  },
  // The five logs the site ships (all in the repo): the run the arena opens on, and the two pairs of real runs.
  { name: "final", what: "swarm, 5 coordinator kills (the run the site opens on)", present: true, load: () => loadJsonl("demo/final/events.jsonl") },
  { name: "pair-durable-max-swarm", what: "swarm of the pair against the durable supervisor", present: true, load: () => loadJsonl("demo/pair-durable-max-swarm/events.jsonl") },
  { name: "pair-durable-max-rival", what: "durable supervisor of that pair", present: true, load: () => loadJsonl("demo/pair-durable-max-rival/events.jsonl") },
  { name: "pair-central-swarm", what: "swarm of the pair against the in-process supervisor", present: true, load: () => loadJsonl("demo/pair-central-swarm/events.jsonl") },
  { name: "pair-central-rival", what: "in-process supervisor of that pair (a crash stops its workers)", present: true, load: () => loadJsonl("demo/pair-central-rival/events.jsonl") },
];

for (const item of CASES) {
  describe.skipIf(!item.present)(`${item.name}: ${item.what}`, () => {
    const events = item.load();
    const view = foldEvents(events);
    const end = events[events.length - 1].ts_virtual;
    const counters = arenaCounters(view, end);
    const scored = official[item.name];
    const windowsMs = scored.crash_windows_s.map(([from, to]) => [Math.round(from * 1000), Math.round(to * 1000)]);

    it("is the log the official numbers were taken from", () => {
      expect(events).toHaveLength(scored.events);
    });

    it("counts the crashes the official metric counts", () => {
      expect(counters.coordinatorCrashes).toBe(scored.crashes);
    });

    it("opens and ends every outage where the official metric does, to the millisecond", () => {
      expect(view.arena.windows.map((w) => [w.since, w.until])).toEqual(windowsMs);
      expect(counters.coordinatorDownMs).toBe(windowsMs.reduce((sum, [from, to]) => sum + (to - from), 0));
    });

    it("counts the contracts sent again after they were lost, as the official re-dispatches", () => {
      expect(counters.redispatches).toBe(scored.lost_redispatches);
    });

    it("idle agent-seconds, as the card counts them, are the scored figure at the last event, to the millisecond", () => {
      expect(recoveryAt(view.arena.recorded, end).idleMs).toBe(Math.round(scored.idle_agent_s * 1000));
    });

    const old = item.idle;
    if (old) {
      it(`the older display fold of the idle agents (no longer on the card) is ${old.against === "equal" ? "the scored figure" : "above the scored figure, which also needs the session to have work waiting on the coordinator"}`, () => {
        expect(counters.idleAgentMs / 1000).toBeCloseTo(old.fold, 3);
        if (old.against === "equal") expect(counters.idleAgentMs / 1000).toBeCloseTo(scored.idle_agent_s, 3);
        else expect(counters.idleAgentMs / 1000).toBeGreaterThan(scored.idle_agent_s);
      });
    }

    it("duplicated work is the scored count", () => {
      expect(counters.duplicatedCalls).toBe(scored.dup_calls);
    });

    it("coordinator-dependency time is the scored figure, to the millisecond", () => {
      expect(counters.dependencyMs).toBe(Math.round(scored.cdt_s * 1000));
    });

    it("the waits it is made of add up to the scored blocked time", () => {
      expect(recoveryAt(view.arena.recorded, end).blockedMs).toBe(Math.round(scored.blocked_total_s * 1000));
    });

    it("the outage window is not the dependency time: a row for one must not carry the name of the other", () => {
      expect(Math.abs(counters.coordinatorDownMs - counters.dependencyMs)).toBeGreaterThan(1000);
    });

    it("every prefix of the log is the official analysis of that prefix", () => {
      const folder = new Folder(events);
      const rows = scored.prefixes.map(([count, ts]) => {
        const at = folder.seek(count);
        const figures = recoveryAt(at.arena.recorded, ts);
        return [count, ts, figures.dependencyMs, figures.blockedMs, figures.duplicatedCalls];
      });
      expect(rows).toEqual(scored.prefixes);
    });

    it("every prefix of the log has the idle agent-seconds the official analysis of that prefix scores, and the figure only counts up", () => {
      const folder = new Folder(events);
      const rows = scored.idle_prefixes.map(([count]) => [count, recoveryAt(folder.seek(count).arena.recorded, events[count - 1].ts_virtual).idleMs]);
      expect(rows).toEqual(scored.idle_prefixes);
      // not a property of the definition (a wait that ends late can add to an outage that is over, never take from one) but a check that the card never steps back
      const figures = rows.map(([, idle]) => idle);
      expect(figures).toEqual([...figures].sort((a, b) => a - b));
    });
  });
}
