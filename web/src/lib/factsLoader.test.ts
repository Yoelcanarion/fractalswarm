import { describe, expect, it } from "vitest";

import { createFactsLoader, type FetchEventAt } from "./factsLoader";
import type { RunEvent, RunListing } from "./types";

const listing = (id: string, over: Partial<RunListing> = {}): RunListing => ({
  id,
  source: "runs",
  run_id: id,
  scenario: "fractalswarm.actors.swarm:SWARM",
  seed: "1",
  clock: "live",
  events: 500,
  duration_ms: 10_000,
  status: "completed",
  head: `head-${id}`,
  ...over,
});

const started = { type: "run.started", payload: { clock: "live", project_remaining_usd: 100, params: { spec: { task: "t2_conference" } } } } as unknown as RunEvent;
const completed = { type: "run.completed", payload: { spent_usd: 0.5 } } as unknown as RunEvent;

/** A server that answers the first event with run.started and any other with run.completed, after `delayMs`. */
function server(delayMs = 0) {
  const calls: [string, number][] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchAt: FetchEventAt = async (runId, seq) => {
    calls.push([runId, seq]);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    inFlight -= 1;
    return seq === 1 ? started : completed;
  };
  return { fetchAt, calls, peak: () => peak };
}

describe("the facts loader", () => {
  it("reads the first and the last event of a finished run", async () => {
    const { fetchAt, calls } = server();
    const facts = await createFactsLoader(fetchAt).load(listing("a", { events: 321 }));
    expect(calls).toEqual([
      ["a", 1],
      ["a", 321],
    ]);
    expect(facts).toMatchObject({ task: "t2_conference", billed: true, spentUsd: 0.5 });
  });

  it("reads a live run's first event only, and only once however long its log grows", async () => {
    const { fetchAt, calls } = server();
    const loader = createFactsLoader(fetchAt);
    await loader.load(listing("live", { status: "running", events: 30, head: "h1" }));
    await loader.load(listing("live", { status: "running", events: 90, head: "h2" }));
    expect(calls).toEqual([["live", 1]]);
  });

  it("reads a finished run once, and again if its log changed", async () => {
    const { fetchAt, calls } = server();
    const loader = createFactsLoader(fetchAt);
    await loader.load(listing("a"));
    await loader.load(listing("a"));
    expect(calls).toHaveLength(2);
    await loader.load(listing("a", { head: "other" }));
    expect(calls).toHaveLength(4);
  });

  it("asks for nothing from an empty log, and for the last event of a log with more than one", async () => {
    const { fetchAt, calls } = server();
    const loader = createFactsLoader(fetchAt);
    expect(await loader.load(listing("empty", { events: 0, status: "empty" }))).toMatchObject({ task: null, spentUsd: null });
    await loader.load(listing("one", { events: 1 }));
    expect(calls).toEqual([["one", 1]]);
  });

  it("never has more requests in flight than its limit", async () => {
    const { fetchAt, peak } = server(5);
    const loader = createFactsLoader(fetchAt, 3);
    await Promise.all(Array.from({ length: 12 }, (_, i) => loader.load(listing(`run-${i}`))));
    expect(peak()).toBeLessThanOrEqual(3);
    expect(peak()).toBeGreaterThan(1); // and it does use the room it has
  });

  it("does not remember a read that failed", async () => {
    let fail = true;
    const loader = createFactsLoader(async (_id, seq) => {
      if (fail) throw new Error("down");
      return seq === 1 ? started : completed;
    });
    await expect(loader.load(listing("a"))).rejects.toThrow("down");
    fail = false;
    await expect(loader.load(listing("a"))).resolves.toMatchObject({ task: "t2_conference" });
  });
});
