import { describe, expect, it } from "vitest";

import { emptyView, foldEvents } from "./reducer";
import { crashedCoordinators, stateLine, talksOf, type StateFacts } from "./runstate";
import { depthTwoTree, loadJsonl } from "./testing";

// The committed final run: 48 talks, five coordinators killed, the root among them, and the run still finishes.
const events = loadJsonl("demo/final/events.jsonl");
const end = foldEvents(events);
const MIDWAY = 5300;
const mid = foldEvents(events.slice(0, MIDWAY));

const facts = (over: Partial<StateFacts> = {}): StateFacts => ({
  live: false,
  playing: false,
  cursor: events.length,
  total: events.length,
  status: "completed",
  endMs: events.at(-1)!.ts_virtual,
  verified: true,
  ...over,
});

describe("the line a run page opens with", () => {
  it("says a finished run is finished, with its talks, its crashes and the replay check", () => {
    expect(stateLine(end, facts())).toEqual({ headline: "Finished:", tone: "good", rest: "48 of 48 talks placed, 5 coordinators crashed, replay verified" });
  });

  it("leaves the replay check out until it has run, and out of a replay that has not reached the end", () => {
    expect(stateLine(end, facts({ verified: false })).rest).toBe("48 of 48 talks placed, 5 coordinators crashed");
    expect(stateLine(mid, facts({ cursor: MIDWAY })).rest).not.toContain("verified");
  });

  it("says where a replay is, and that what it counts can still change", () => {
    expect(stateLine(mid, facts({ cursor: MIDWAY, playing: true }))).toEqual({
      headline: "Replaying:",
      tone: "live",
      rest: "at 59.0 s of 121.2 s, 0 of 48 talks placed, 1 coordinator crashed so far",
    });
  });

  it("says Paused, not Replaying, when a recording is stopped midway", () => {
    const line = stateLine(mid, facts({ cursor: MIDWAY }));
    expect(line.headline).toBe("Paused:");
    expect(line.tone).toBe("muted");
  });

  it("says nothing has happened at the start of a recording", () => {
    expect(stateLine(emptyView(), facts({ cursor: 0 }))).toEqual({ headline: "At the start:", tone: "muted", rest: "nothing has happened yet" });
  });

  it("says a run still being written is running: no end to its count, no replay check, and a wait for its first actor", () => {
    const live = stateLine(mid, facts({ live: true, cursor: MIDWAY, total: MIDWAY }));
    expect(live.headline).toBe("Running:");
    expect(live.tone).toBe("live");
    expect(live.rest).toBe("0 of 48 talks placed, 1 coordinator crashed so far");
    expect(stateLine(emptyView(), facts({ live: true, cursor: 0, total: 0 })).rest).toBe("waiting for the first actor");
  });

  it("is not green on a result that is short or broken: talks unplaced, or hard violations in the final check", () => {
    const short = { ...end, schedule: { ...end.schedule, cells: Object.fromEntries(Object.entries(end.schedule.cells).slice(0, 32)) } };
    expect(stateLine(short, facts())).toEqual({
      headline: "Finished:",
      tone: "warn",
      rest: "32 of 48 talks placed, 16 unplaced, 5 coordinators crashed, replay verified",
    });
    const broken = (hardViolations: number | null) => ({ ...end, schedule: { ...end.schedule, hardViolations } });
    expect(stateLine(broken(2), facts())).toEqual({
      headline: "Finished:",
      tone: "warn",
      rest: "48 of 48 talks placed, 2 hard violations, 5 coordinators crashed, replay verified",
    });
    expect(stateLine(broken(1), facts()).rest).toContain("1 hard violation,");
    // a clean check, or none yet, stays green
    expect(stateLine(broken(0), facts()).tone).toBe("good");
    expect(stateLine(broken(null), facts()).tone).toBe("good");
    // a count that can still change is not a result: nothing is said of a replay on its way, a run being written, or one that did not finish
    expect(stateLine(short, facts({ cursor: MIDWAY })).rest).not.toContain("unplaced");
    expect(stateLine(short, facts({ live: true })).rest).not.toContain("unplaced");
    expect(stateLine(short, facts({ status: "halted" }))).toMatchObject({ headline: "Halted:", tone: "warn" });
  });

  it("says a run that did not finish, and why the log ends", () => {
    expect(stateLine(end, facts({ status: "halted" }))).toMatchObject({ headline: "Halted:", tone: "warn" });
    expect(stateLine(end, facts({ status: "interrupted" }))).toMatchObject({ headline: "Interrupted:", tone: "warn" });
    expect(stateLine(mid, facts({ cursor: MIDWAY, total: MIDWAY, status: null }))).toMatchObject({ headline: "Ended without finishing:", tone: "warn" });
  });

  it("says no coordinator crashed when none did, and never counts the leaves", () => {
    const quiet = foldEvents(depthTwoTree().events);
    expect(stateLine(quiet, facts({ status: null, verified: false })).rest).toBe("no coordinator crashed");
    const leaf = foldEvents(depthTwoTree().emit("chaos.injected", "@env", { kind: "kill_coordinator", target: "t1-d1-a" }).events);
    expect(leaf.actors["t1-d1-a"].status).toBe("killed");
    expect(crashedCoordinators(leaf)).toBe(0);
  });

  it("says a rival's supervisor crashed as often as it did, though it is up again after each crash", () => {
    // the committed rival of the final run's pair: its supervisor is killed five times and restarts each time
    const rival = loadJsonl("demo/pair-central-rival/events.jsonl");
    const rivalEnd = foldEvents(rival);
    expect(Object.values(rivalEnd.actors).some((actor) => actor.status === "killed" || actor.status === "dead")).toBe(false); // nobody is down at the end
    expect(crashedCoordinators(rivalEnd)).toBe(5);
    const line = stateLine(rivalEnd, facts({ cursor: rival.length, total: rival.length, endMs: rival.at(-1)!.ts_virtual }));
    expect(line.headline).toBe("Finished:");
    expect(line.rest).toBe("48 of 48 talks placed, its supervisor crashed 5 times, replay verified");
    expect(line.rest).not.toContain("no coordinator crashed");
  });

  it("does not let a rival's count fall back between its crashes, and says it can still change on the way", () => {
    const rival = loadJsonl("demo/pair-central-rival/events.jsonl");
    let last = 0;
    for (let n = 0; n <= rival.length; n += 50) {
      const count = crashedCoordinators(foldEvents(rival.slice(0, n)));
      expect(count, `at event ${n}`).toBeGreaterThanOrEqual(last);
      last = count;
    }
    expect(last).toBeGreaterThanOrEqual(4);
    // after the second crash, whether or not it is up again
    const second = rival.filter((e) => e.type === "baseline.crashed")[1];
    const mid = foldEvents(rival.slice(0, rival.indexOf(second) + 1));
    expect(crashedCoordinators(mid)).toBe(2);
    expect(stateLine(mid, facts({ cursor: rival.indexOf(second) + 1, total: rival.length, endMs: rival.at(-1)!.ts_virtual })).rest).toContain("its supervisor crashed 2 times so far");
  });

  it("keeps a swarm's coordinators crashed, and its false deaths, as before", () => {
    expect(stateLine(end, facts()).rest).toContain("5 coordinators crashed");
    expect(stateLine(end, facts()).rest).not.toContain("supervisor");
  });

  it("counts the coordinators killed by the playhead, in the singular too", () => {
    expect(crashedCoordinators(end)).toBe(5);
    expect(crashedCoordinators(mid)).toBe(1);
    expect(talksOf(end)).toEqual({ placed: 48, expected: 48 });
    expect(talksOf(emptyView())).toEqual({ placed: 0, expected: null });
  });
});
