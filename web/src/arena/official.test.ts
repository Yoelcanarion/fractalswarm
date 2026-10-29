import { describe, expect, it } from "vitest";

import { readPairs } from "./api";
import { readOfficial } from "./official";

// The body of GET api/runs/{id}/metrics as W2 serves it (arena-intake.md, "Run numbers").
const body = (over: Record<string, unknown> = {}, recovery: unknown = null) => ({
  run_id: "pair1-swarm",
  status: "completed",
  scenario: "swarm",
  task: "t2_conference",
  input: null,
  metrics: {
    run_id: "pair1-swarm",
    events: 5565,
    completed: true,
    valid: true,
    score: 1,
    detail: "placed 48/48, hard violations 0, soft 0",
    makespan_s: 70.7,
    stall_s: 0,
    cost_usd: 0.291885,
    llm_calls: 410,
    cancelled_llm_calls: 6,
    ...over,
  },
  recovery,
});

describe("the official numbers", () => {
  it("reads the scored metrics", () => {
    expect(readOfficial(body())).toMatchObject({
      runId: "pair1-swarm",
      status: "completed",
      scenario: "swarm",
      completed: true,
      valid: true,
      costUsd: 0.291885,
      makespanS: 70.7,
      llmCalls: 410,
      cancelledCalls: 6,
      recovery: null,
    });
  });

  it("treats a recovery that is null as not yet, never as zeros", () => {
    expect(readOfficial(body())?.recovery).toBeNull();
  });

  it("reads the recovery metrics once W1's follow-up fills them", () => {
    const official = readOfficial(
      body({}, { crashes: 5, idle_agent_s: 61.2, ttr_own_mean_s: 5.1, cdt_s: 25.4, dup_calls: 3, dup_usd: 0.002, unnecessary_reassignments: 2, blast_agents_mean_pct: 41 }),
    );
    expect(official?.recovery).toEqual({
      crashes: 5,
      idleAgentS: 61.2,
      ttrOwnMeanS: 5.1,
      cdtS: 25.4,
      dupCalls: 3,
      dupUsd: 0.002,
      unnecessaryReassignments: 2,
      blastAgentsMeanPct: 41,
    });
  });

  it("also finds them inside the scored metrics, and keeps a missing field null", () => {
    const official = readOfficial(body({ recovery: { cdt_s: 7 } }));
    expect(official?.recovery?.cdtS).toBe(7);
    expect(official?.recovery?.idleAgentS).toBeNull();
  });

  it("gives nothing for a body without metrics", () => {
    expect(readOfficial(null)).toBeNull();
    expect(readOfficial({ run_id: "x" })).toBeNull();
    expect(readOfficial("nope")).toBeNull();
  });

  it("reads a verdict the checker did not give as unknown", () => {
    expect(readOfficial(body({ valid: undefined, completed: false }))).toMatchObject({ valid: null, completed: false });
  });
});

describe("the pairs on record", () => {
  const pair = (over: Record<string, unknown> = {}) => ({
    pair_id: "demo-1",
    created_at: "2026-10-29T00:12:28+00:00",
    label: "swarm vs durable-max, half-the-brains, seed 1",
    seed: 1,
    rival: "durable-max",
    private: false,
    billed: false,
    chaos: { name: "half-the-brains", actions: 5 },
    left: { run_id: "demo-1-swarm", scenario: "swarm", status: "completed" },
    right: { run_id: "demo-1-durable-max", scenario: "durable-max", status: "completed" },
    state: "completed",
    ...over,
  });

  it("reads each pair's two runs, its rival and its plan", () => {
    expect(readPairs([pair()])).toEqual([
      {
        pairId: "demo-1",
        label: "swarm vs durable-max, half-the-brains, seed 1",
        left: "demo-1-swarm",
        right: "demo-1-durable-max",
        rival: "durable-max",
        chaos: "half-the-brains",
        actions: 5,
        seed: "1",
        state: "completed",
        private: false,
        billed: false,
        createdAt: "2026-10-29T00:12:28+00:00",
      },
    ]);
  });

  it("skips a pair that does not name both runs, and answers an empty list for a body that is not one", () => {
    expect(readPairs([pair({ right: {} }), pair({ left: null })])).toEqual([]);
    expect(readPairs({ error: "nope" })).toEqual([]);
  });

  it("keeps a private pair marked, so the picker never offers it as bundled", () => {
    expect(readPairs([pair({ private: true })])[0].private).toBe(true);
  });
});
