import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BILLING,
  chaosWords,
  featuredRows,
  filterRows,
  formatDuration,
  NO_FILTER,
  readFacts,
  rowOf,
  sortRows,
  stateOf,
  STATES,
  summarize,
  verifyWords,
  workflowOf,
  workflowsIn,
  type RunFacts,
} from "./catalogue";
import { REPO_ROOT } from "./testing";
import type { RunEvent, RunListing, VerifyReport } from "./types";

/** The first and the last event of a committed bundle, without parsing the middle of the log. */
function ends(bundle: string): { first: RunEvent; last: RunEvent } {
  const lines = readFileSync(REPO_ROOT + `demo/${bundle}/events.jsonl`, "utf-8").split("\n").filter((line) => line.trim());
  return { first: JSON.parse(lines[0]), last: JSON.parse(lines[lines.length - 1]) };
}

const listing = (id: string, scenario: string | null, status: RunListing["status"], extra: Partial<RunListing> = {}): RunListing => ({
  id,
  source: "runs",
  run_id: id,
  scenario,
  seed: "1",
  clock: "live",
  events: 100,
  duration_ms: 20_000,
  status,
  head: `head-${id}`,
  ...extra,
});

const SWARM = "fractalswarm.actors.swarm:SWARM";
const CENTRAL = "fractalswarm.actors.swarm:CENTRAL";

describe("state", () => {
  it("tells a live run from a recorded one and from one that was stopped", () => {
    expect(stateOf("running")).toBe("live");
    expect(stateOf("completed")).toBe("recorded");
    expect(stateOf("halted")).toBe("halted");
    expect(stateOf("interrupted")).toBe("interrupted");
    expect(stateOf("empty")).toBe("empty");
    expect(stateOf("something-new")).toBe("recorded"); // it still has a log to open
    expect(STATES.recorded.says).toMatch(/replay/i);
    expect(STATES.live.says).toMatch(/watch/i);
  });
});

describe("workflow", () => {
  it("names the system that recorded a run in the words of the charts and the arena", () => {
    expect(workflowOf(SWARM)).toEqual({ id: "swarm", label: "FractalSwarm" });
    expect(workflowOf(CENTRAL)).toEqual({ id: "central", label: "In-process supervisor" });
    expect(workflowOf("fractalswarm.actors.swarm:DURABLE_MAX")).toEqual({ id: "durable-max", label: "Ideal durable supervisor" });
    expect(workflowOf("fractalswarm.actors.swarm:PIPELINE")).toEqual({ id: "pipeline", label: "Pipeline" });
    expect(workflowOf("fractalswarm.actors.toy:TOY")).toEqual({ id: "toy", label: "Toy demo" });
  });

  it("shows a scenario it does not know as what it is called, tidied", () => {
    expect(workflowOf("fractalswarm.actors.chaos_toy:CHAOS_TOY")).toEqual({ id: "chaos_toy", label: "Chaos toy" });
    expect(workflowOf(null)).toEqual({ id: "unknown", label: "Unknown" });
  });
});

describe("facts from the log", () => {
  it("reads the kill-half bundle: task, plan, billed, live clock, what it spent", () => {
    const { first, last } = ends("backup");
    expect(readFacts(first, last)).toEqual({
      task: "t2_conference",
      profile: "kill-half",
      kills: 5,
      billed: true,
      clock: "live",
      capUsd: expect.any(Number),
      spentUsd: expect.closeTo(0.4948, 4),
    });
  });

  it("reads the toy: no task, no failures, not billed, a simulated clock", () => {
    const { first, last } = ends("toy");
    expect(readFacts(first, last)).toMatchObject({ task: null, profile: null, kills: null, billed: false, clock: "sim" });
    expect(readFacts(first, last).spentUsd).toBeGreaterThan(0);
  });

  it("knows nothing it was not given: a live run has no spend, an old log no billing field", () => {
    const { first } = ends("backup");
    expect(readFacts(first, null).spentUsd).toBeNull();
    const old = { ...first, payload: { ...first.payload } };
    delete old.payload.project_remaining_usd;
    expect(readFacts(old, null).billed).toBeNull();
    expect(readFacts(null, null)).toEqual({ task: null, profile: null, kills: null, billed: null, clock: null, capUsd: null, spentUsd: null });
  });

  it("does not take another event for the start of the run", () => {
    const { last } = ends("toy");
    expect(readFacts(last, last).task).toBeNull();
    expect(readFacts(last, last).clock).toBeNull();
  });
});

describe("the failures of a run, in words", () => {
  const facts = (profile: string | null, kills: number | null): RunFacts => ({ task: null, profile, kills, billed: null, clock: null, capUsd: null, spentUsd: null });

  it("names C0 to C3 with the crashes each makes", () => {
    expect(chaosWords(facts("C3", null))).toEqual({ term: "c3", label: "C3", killed: "5 coordinators killed" });
    expect(chaosWords(facts("C1", null))).toEqual({ term: "c1", label: "C1", killed: "1 coordinator killed" });
    expect(chaosWords(facts("C0", null))).toEqual({ term: "c0", label: "C0", killed: "no coordinators killed" });
  });

  it("describes a plan that lists its kills, a plan that only has a name, and no plan", () => {
    expect(chaosWords(facts("kill-half", 5))).toEqual({ term: null, label: "kill-half", killed: "5 coordinators killed" });
    expect(chaosWords(facts(null, 3))).toEqual({ term: null, label: "Custom plan", killed: "3 coordinators killed" });
    expect(chaosWords(facts("K-o0", null))).toEqual({ term: null, label: "K-o0", killed: null });
    expect(chaosWords(facts(null, null))).toBeNull();
  });
});

describe("the table", () => {
  const swarm: RunFacts = { task: "t2_conference", profile: "C3", kills: null, billed: true, clock: "live", capUsd: 2, spentUsd: 0.485 };
  const central: RunFacts = { ...swarm, spentUsd: 0.601 };
  const rows = [
    rowOf(listing("t2-real-c3-swarm-seed1", SWARM, "completed", { events: 14047, duration_ms: 199_000 }), swarm),
    rowOf(listing("t2-real-c3-central-seed1", CENTRAL, "completed", { events: 9000, duration_ms: 330_000 }), central),
    rowOf(listing("scratch-live", SWARM, "running", { events: 40 })),
    rowOf(listing("v1-interrupted", SWARM, "interrupted", { events: 700 })),
    rowOf(listing("demo-toy", "fractalswarm.actors.toy:TOY", "completed", { events: 56, duration_ms: 4000, source: "demo" })),
  ];
  const ids = (list: ReturnType<typeof sortRows>) => list.map((row) => row.listing.id);

  it("filters by words, state and workflow, all at once", () => {
    expect(ids(filterRows(rows, NO_FILTER))).toHaveLength(5);
    expect(ids(filterRows(rows, { ...NO_FILTER, query: "central" }))).toEqual(["t2-real-c3-central-seed1"]);
    expect(ids(filterRows(rows, { ...NO_FILTER, query: "in-process" }))).toEqual(["t2-real-c3-central-seed1"]);
    expect(ids(filterRows(rows, { ...NO_FILTER, query: "c3 conference" })).sort()).toEqual(["t2-real-c3-central-seed1", "t2-real-c3-swarm-seed1"]);
    expect(ids(filterRows(rows, { ...NO_FILTER, state: "live" }))).toEqual(["scratch-live"]);
    expect(ids(filterRows(rows, { ...NO_FILTER, workflow: "swarm", state: "recorded" }))).toEqual(["t2-real-c3-swarm-seed1"]);
    expect(filterRows(rows, { ...NO_FILTER, query: "nothing like this" })).toEqual([]);
  });

  it("finds a run by the words of its failure plan once its facts are read", () => {
    expect(ids(filterRows(rows, { ...NO_FILTER, query: "5 coordinators" })).sort()).toEqual(["t2-real-c3-central-seed1", "t2-real-c3-swarm-seed1"]);
  });

  it("sorts by state with live first, by size, by spend with unknown last, and by name", () => {
    expect(ids(sortRows(rows, "state", "asc"))[0]).toBe("scratch-live");
    expect(ids(sortRows(rows, "state", "asc")).at(-1)).toBe("v1-interrupted");
    expect(ids(sortRows(rows, "events", "desc"))[0]).toBe("t2-real-c3-swarm-seed1");
    expect(ids(sortRows(rows, "duration", "asc"))[0]).toBe("demo-toy");
    expect(ids(sortRows(rows, "run", "asc"))[0]).toBe("demo-toy");
    const spent = ids(sortRows(rows, "spent", "asc"));
    expect(spent.slice(0, 2)).toEqual(["t2-real-c3-swarm-seed1", "t2-real-c3-central-seed1"]);
    const spentDown = ids(sortRows(rows, "spent", "desc"));
    expect(spentDown.slice(0, 2)).toEqual(["t2-real-c3-central-seed1", "t2-real-c3-swarm-seed1"]);
    expect(new Set(spentDown.slice(2)).size).toBe(3); // the runs that have not said what they spent come last, either way
  });

  it("keeps the order the server listed them in by default, and breaks ties by it", () => {
    const listed = [listing("zeta", SWARM, "completed"), listing("alpha", SWARM, "completed"), listing("mid", CENTRAL, "completed")].map((l, i) => rowOf(l, null, i));
    expect(ids(sortRows(listed, "listed", "asc"))).toEqual(["zeta", "alpha", "mid"]);
    expect(ids(sortRows(listed, "listed", "desc"))).toEqual(["mid", "alpha", "zeta"]);
    expect(ids(sortRows(listed, "state", "asc"))).toEqual(["zeta", "alpha", "mid"]); // all recorded: the server's order decides
    expect(ids(sortRows(listed, "run", "asc"))).toEqual(["alpha", "mid", "zeta"]);
  });

  it("keeps the order stable between renders", () => {
    const again = rows.map((row) => ({ ...row }));
    expect(ids(sortRows(again, "workflow", "asc"))).toEqual(ids(sortRows(rows, "workflow", "asc")));
  });

  it("summarizes which states have a run, and counts the workflows for the filter", () => {
    expect(summarize(rows)).toBe("1 live · 3 recorded · 1 interrupted");
    expect(summarize([])).toBe("");
    expect(workflowsIn(rows).map((w) => [w.id, w.count])).toEqual([
      ["swarm", 3],
      ["central", 1],
      ["toy", 1],
    ]);
  });
});

describe("a run's length", () => {
  it("writes seconds, minutes and hours the way a person reads them", () => {
    expect(formatDuration(4000)).toBe("4.0 s");
    expect(formatDuration(59_960)).toBe("1 min 0 s"); // never "60.0 s"
    expect(formatDuration(199_400)).toBe("3 min 19 s");
    expect(formatDuration(3_720_000)).toBe("1 h 02 min");
    expect(formatDuration(Number.NaN)).toBe("–");
    expect(formatDuration(-1)).toBe("–");
  });
});

describe("the replay check in words", () => {
  const report = (over: Partial<VerifyReport> = {}): VerifyReport => ({
    ok: true,
    chain_ok: true,
    recorded_events: 56,
    replayed_events: 56,
    recorded_head: "a".repeat(64),
    replayed_head: "b".repeat(64),
    first_divergence: null,
    detail: "",
    bundle_head: null,
    bundle_head_ok: true,
    ...over,
  });

  it("says a run was not checked until it was, and says so while it replays", () => {
    expect(verifyWords({ state: "idle" })).toEqual({ label: "Not checked", tone: "plain", detail: "" });
    expect(verifyWords({ state: "pending" }).label).toBe("Replaying…");
  });

  it("calls a run verified only when the replay and the bundle's head both match", () => {
    const verified = verifyWords({ state: "done", report: report() });
    expect(verified).toMatchObject({ label: "Replay verified", tone: "good" });
    expect(verified.detail).toContain("56 events re-run");
    expect(verified.detail).toContain("bbbbbbbbbbbb");
    expect(verifyWords({ state: "done", report: report({ bundle_head_ok: false, detail: "head differs" }) })).toMatchObject({ tone: "bad", detail: "head differs" });
  });

  it("says an intact log that this code does not reproduce is just that, in amber, and keeps red for a broken chain", () => {
    const words = verifyWords({ state: "done", report: report({ ok: false, chain_ok: true, first_divergence: 9, detail: "effect.started differs in payload" }) });
    expect(words).toEqual({ label: "Log intact. This code does not reproduce this recording: first difference at seq 9.", tone: "warn", detail: "effect.started differs in payload" });
    expect(verifyWords({ state: "done", report: report({ ok: false, chain_ok: true, first_divergence: null }) }).label).toBe("Log intact. This code does not reproduce this recording.");
    expect(verifyWords({ state: "done", report: report({ ok: false, chain_ok: false, first_divergence: 9 }) }).tone).toBe("bad");
    // never a guess about where the recording came from
    expect(words.label).not.toMatch(/older|version|outdated|stale/i);
  });

  it("names the event where a replay diverged, and keeps a failed check apart from a failed run", () => {
    expect(verifyWords({ state: "done", report: report({ ok: false, chain_ok: false, first_divergence: 812 }) }).label).toBe("Replay mismatch at seq 812");
    expect(verifyWords({ state: "done", report: report({ ok: false, chain_ok: false, first_divergence: null }) }).label).toBe("Replay mismatch at seq ?");
    expect(verifyWords({ state: "error", error: "502 Bad Gateway" })).toEqual({ label: "Could not check", tone: "warn", detail: "502 Bad Gateway" });
  });
});

describe("the words of the page", () => {
  // The same words the glossary may not use: a sentence that compares one system with another is a claim, and claims
  // come from docs/claims.md only.
  const CLAIM = /simpler|cheaper|more reliable|reliab|faster|better|best|worse|first|outperform|without stalling|paying twice/i;

  it("says what a log records about billing and no more", () => {
    expect(BILLING.billed.label).toBe("Billed");
    expect(BILLING.notBilled.label).toBe("Not billed");
    expect(BILLING.notBilled.says).toMatch(/notional/);
    expect(BILLING.unknown.says).toMatch(/does not say/);
  });

  it("makes no claim in the states or the billing", () => {
    const sentences = [...Object.values(STATES).map((state) => state.says), ...Object.values(BILLING).map((entry) => entry.says)];
    for (const sentence of sentences) expect(sentence).not.toMatch(CLAIM);
  });
});

describe("the runs a short list opens with", () => {
  const rows = [
    rowOf(listing("new-run", SWARM, "completed")),
    rowOf(listing("live-now", SWARM, "running")),
    rowOf(listing("demo-final", SWARM, "completed")),
    rowOf(listing("nothing-yet", SWARM, "empty")),
    rowOf(listing("stopped", CENTRAL, "halted")),
    rowOf(listing("cut", CENTRAL, "interrupted")),
    rowOf(listing("one-more", CENTRAL, "completed")),
  ];

  it("lead with the final run, wherever it is listed, then the finished runs in the server's order", () => {
    expect(featuredRows(rows).map((row) => row.listing.id)).toEqual(["demo-final", "new-run", "stopped", "cut"]);
  });

  it("leave out a live run (it has its own strip) and an empty one (there is nothing to open), and stop at the limit", () => {
    const ids = featuredRows(rows, 10).map((row) => row.listing.id);
    expect(ids).not.toContain("live-now");
    expect(ids).not.toContain("nothing-yet");
    expect(ids).toHaveLength(5);
    expect(featuredRows(rows, 2)).toHaveLength(2);
  });

  it("are the finished runs in order when there is no final run, and none when nothing has finished", () => {
    expect(featuredRows([rowOf(listing("a", SWARM, "completed")), rowOf(listing("b", SWARM, "completed"))]).map((row) => row.listing.id)).toEqual(["a", "b"]);
    expect(featuredRows([rowOf(listing("a", SWARM, "running"))])).toEqual([]);
  });
});
