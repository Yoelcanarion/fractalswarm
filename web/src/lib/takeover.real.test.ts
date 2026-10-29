// The takeover chip's reading of the log, on recorded runs. They are read, never written, and the
// whole file skips on a machine that does not have them (a CI box, a fresh clone).
//
// The counts are what `grep` finds in the logs: the swarm run with chaos handed 12 goals over and
// adopted 12 subtrees; the central baseline, which restarts a supervisor instead, handed nothing over.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";

import { describeTakeover, logHasTakeover, readTakeover } from "./takeover";
import type { RunEvent } from "./types";

const runPath = (run: string): string => `${homedir()}/.fractalswarm/runs/${run}/events.jsonl`;
const recorded = (run: string): boolean => existsSync(runPath(run));

function events(run: string): RunEvent[] {
  return readFileSync(runPath(run), "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunEvent);
}

const count = (log: RunEvent[], type: string): number => log.filter((event) => event.type === type).length;

describe.skipIf(!recorded("t2-real-c3-swarm-seed1b"))("swarm run with chaos (real run)", () => {
  const log = events("t2-real-c3-swarm-seed1b");

  it("has goals that changed hands, so the chip has something to claim", () => {
    expect(count(log, "ownership.remapped")).toBe(12);
    expect(count(log, "tree.adopted")).toBe(12);
    expect(logHasTakeover(log)).toBe(true);
    // A server that answers only {ok, violations} still gets the claim, because the log earns it.
    expect(describeTakeover(readTakeover({ ok: true, violations: [] })!, logHasTakeover(log))).toMatchObject({ tone: "good", text: "Takeover OK ✓" });
  });
});

describe.skipIf(!recorded("t2-real-c3-central-seed1"))("central baseline with coordinator crashes (real run)", () => {
  const log = events("t2-real-c3-central-seed1");

  it("handed nothing over, so the chip claims nothing", () => {
    expect(count(log, "ownership.remapped")).toBe(0);
    expect(count(log, "tree.adopted")).toBe(0);
    expect(logHasTakeover(log)).toBe(false);
    expect(describeTakeover(readTakeover({ ok: true, violations: [] })!, logHasTakeover(log))).toMatchObject({ tone: "muted", text: "No takeover to check" });
  });
});
