// The supporting panels against synthetic streams in the shapes the runtime emits today (copied
// from a recorded T2 run), and against the golden toy run.

import { describe, expect, it } from "vitest";

import { breakerKind, secondsUntilProbe } from "./breakers";
import { openCollisionCount } from "./collisions";
import { burnRate, committed, ladderLevel, runCap } from "./economy";
import { openEscalations, stepOf } from "./escalations";
import { remainingShare, requestsPerMinute } from "./limits";
import { emptyView, foldEvents } from "./reducer";
import { outcomeOf, placementsOf } from "./results";
import { loadJsonl, Stream } from "./testing";

function started(cap: number | null = 2): Stream {
  return new Stream().emit("run.started", "@kernel", { seed: "1", scenario: "t2", params: {}, clock: "sim", run_cap_usd: cap });
}

/** One LLM call: reserve, start, complete, settle, the way the kernel logs it. */
function call(s: Stream, id: string, squad: string, role: string, cost: number, extra: Record<string, unknown> = {}): Stream {
  return s
    .emit("budget.reserved", squad, { effect_id: id, usd: 0.3, scopes: { run: "synthetic", squad } })
    .emit("effect.started", squad, { effect_id: id, kind: "llm", request: { role } })
    .emit("effect.completed", "@env", {
      effect_id: id,
      kind: "llm",
      status: "ok",
      result: {
        model: "muse-spark-1.3",
        cost_usd: cost,
        http_status: 200,
        attempts: 1,
        latency_ms: 900,
        usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 100 },
        rate_limits: { limit_requests: 3000, limit_tokens: 4_000_000, remaining_requests: 2999, remaining_tokens: 3_990_000 },
        ...extra,
      },
    })
    .emit("budget.settled", "@kernel", { effect_id: id, reserved_usd: 0.3, actual_usd: cost });
}

describe("Market & budget", () => {
  it("books reservations and settlements per squad, model and role", () => {
    const s = started();
    call(s, "e1", "o0", "root_planner", 0.03);
    call(s, "e2", "o2", "agent", 0.002);
    call(s, "e3", "o2", "agent", 0.004);
    const { economy } = foldEvents(s.events).panels;
    expect(runCap(economy)).toBe(2);
    expect(economy.spentUsd).toBeCloseTo(0.036, 9);
    expect(economy.reservedUsd).toBeCloseTo(0, 9);
    expect(economy.squads.o2).toMatchObject({ calls: 2, refused: 0 });
    expect(economy.squads.o2.spent).toBeCloseTo(0.006, 9);
    expect(economy.models["muse-spark-1.3"]).toMatchObject({ calls: 3, inputTokens: 3000, outputTokens: 600, cachedTokens: 300 });
    expect(economy.roles.agent).toMatchObject({ calls: 2 });
    expect(economy.roles.root_planner.usd).toBeCloseTo(0.03, 9);
    expect(economy.burn.at(-1)).toMatchObject({ cap: 2 });
  });

  it("counts an open reservation as committed, and releases it when the call is cancelled", () => {
    const s = started();
    s.emit("budget.reserved", "o2", { effect_id: "e1", usd: 0.5, scopes: { run: "synthetic", squad: "o2" } });
    s.emit("effect.started", "o2", { effect_id: "e1", kind: "llm", request: { role: "agent" } });
    let economy = foldEvents(s.events).panels.economy;
    expect(committed(economy)).toBeCloseTo(0.5, 9);
    s.emit("effect.cancelled", "chaos", { effect_id: "e1", kind: "llm" });
    s.emit("budget.settled", "@kernel", { effect_id: "e1", reserved_usd: 0.5, actual_usd: 0 });
    economy = foldEvents(s.events).panels.economy;
    expect(committed(economy)).toBe(0);
    expect(economy.cancelled).toBe(1);
    expect(economy.callRole).toEqual({});
  });

  it("does not leave float noise in the reserved total once everything is settled", () => {
    const s = started();
    s.emit("budget.reserved", "o0", { effect_id: "a", usd: 0.1, scopes: { run: "synthetic", squad: "o0" } });
    s.emit("budget.reserved", "o0", { effect_id: "b", usd: 0.2, scopes: { run: "synthetic", squad: "o0" } });
    s.emit("budget.settled", "@kernel", { effect_id: "a", reserved_usd: 0.1, actual_usd: 0.05 });
    s.emit("budget.settled", "@kernel", { effect_id: "b", reserved_usd: 0.2, actual_usd: 0.01 });
    const { economy } = foldEvents(s.events).panels;
    expect(economy.reservedUsd).toBe(0);
    expect(economy.squads.o0.reserved).toBe(0);
  });

  it("walks the degradation ladder with the thresholds of market/ladder.py", () => {
    expect(ladderLevel(1.59, 2)).toBe("L0");
    expect(ladderLevel(1.6, 2)).toBe("L1");
    expect(ladderLevel(1.8, 2)).toBe("L2");
    expect(ladderLevel(1.9, 2)).toBe("stop");
    expect(ladderLevel(0.1, 0)).toBe("stop");
    expect(ladderLevel(5, null)).toBe("L0");
  });

  it("applies a budget shock at once, keeps the cap history, and marks it", () => {
    const s = started();
    call(s, "e1", "o0", "agent", 0.5);
    expect(ladderLevel(committed(foldEvents(s.events).panels.economy), 2)).toBe("L0");
    s.at(3000).emit("budget.shock", "@env", { level: "run", key: "synthetic", usd: 0.54, reason: "CFO says stop" });
    const { economy } = foldEvents(s.events).panels;
    expect(runCap(economy)).toBe(0.54);
    expect(ladderLevel(committed(economy), runCap(economy))).toBe("L2"); // 0.5 of 0.54 is 93%
    expect(economy.capChanges).toEqual([
      expect.objectContaining({ level: "run", key: "synthetic", usd: 0.54, shock: true, reason: "CFO says stop", ts: 3000 }),
    ]);
    expect(economy.burn.at(-1)).toMatchObject({ ts: 3000, cap: 0.54 });
  });

  it("keeps the refusals and records the kill switch", () => {
    const s = started(0.1);
    s.emit("budget.refused", "o2", { effect_id: "e9", usd: 0.4, level: "run", key: "synthetic" });
    s.at(9000).emit("run.halted", "@env", { reason: "operator pressed stop", by: "human" });
    s.emit("run.halted", "@env", { reason: "again", by: "human" });
    const { economy } = foldEvents(s.events).panels;
    expect(economy.refusedCount).toBe(1);
    expect(economy.refusals[0]).toMatchObject({ actor: "o2", usd: 0.4, level: "run" });
    expect(economy.squads.o2.refused).toBe(1);
    expect(economy.halted).toMatchObject({ reason: "operator pressed stop", by: "human", ts: 9000 });
  });

  it("measures the burn of the last minute against 20% of what is left", () => {
    const s = started(1);
    s.at(0);
    call(s, "e1", "o0", "agent", 0.1);
    s.at(50_000);
    call(s, "e2", "o0", "agent", 0.05);
    const { economy } = foldEvents(s.events).panels;
    expect(burnRate(economy, 50_000).perMinute).toBeCloseTo(0.15, 9);
    expect(burnRate(economy, 50_000).limit).toBeCloseTo(0.2 * 0.85, 9);
    expect(burnRate(economy, 70_000).perMinute).toBeCloseTo(0.05, 9); // the first settle left the window
  });

  it("shows market families it has no fields for as generic rows", () => {
    const s = started().emit("market.epoch.closed", "o0", { epoch: 2, pool_usd: 0.4 }).emit("market.bid", "o2", { q: 0.1 });
    const { other } = foldEvents(s.events).panels.economy;
    expect(other.map((row) => row.type)).toEqual(["market.epoch.closed", "market.bid"]);
    expect(other[0].text).toBe("epoch=2  pool_usd=0.4");
  });

  it("tracks the market epoch from the envelope", () => {
    const s = started();
    s.events.push({ ...s.events[0], seq: 2, market_epoch: 4, type: "market.epoch.closed", payload: {} });
    expect(foldEvents(s.events).marketEpoch).toBe(4);
  });
});

describe("Rate limits", () => {
  it("keeps the latest quota the endpoint reported, per model", () => {
    const s = started();
    call(s, "e1", "o0", "agent", 0.01);
    call(s, "e2", "o0", "agent", 0.01, { model: "muse-wonder-1.0", rate_limits: { limit_requests: 3000, remaining_requests: 1500 } });
    const { limits } = foldEvents(s.events).panels;
    expect(limits.order).toEqual(["muse-spark-1.3", "muse-wonder-1.0"]);
    const spark = limits.models["muse-spark-1.3"];
    expect(remainingShare(spark.remainingRequests, spark.limitRequests)).toBeCloseTo(2999 / 3000, 6);
    expect(remainingShare(spark.remainingTokens, spark.limitTokens)).toBeCloseTo(0.9975, 6);
    expect(remainingShare(limits.models["muse-wonder-1.0"].remainingRequests, 3000)).toBe(0.5);
    expect(remainingShare(null, 3000)).toBeNull();
  });

  it("counts 429s, server errors and retries, and remembers the Retry-After", () => {
    const s = started();
    call(s, "e1", "o0", "agent", 0.01, { attempts: 3 });
    call(s, "e2", "o0", "agent", 0, { http_status: 429, retry_after_ms: 20_000, attempts: 2 });
    call(s, "e3", "o0", "agent", 0, { http_status: 503 });
    const row = foldEvents(s.events).panels.limits.models["muse-spark-1.3"];
    expect(row).toMatchObject({ calls: 3, throttled: 1, failed: 1, retries: 3, retryAfterMs: 20_000, latencyMs: 2700 });
  });

  it("measures requests in the last minute and the peak concurrency", () => {
    const s = started();
    for (const [i, at] of [0, 10_000, 20_000].entries()) {
      s.at(at).emit("effect.started", "o0", { effect_id: `e${i}`, kind: "llm", request: { role: "agent" } });
    }
    s.at(30_000).emit("effect.completed", "@env", { effect_id: "e0", kind: "llm", status: "ok", result: {} });
    const { limits } = foldEvents(s.events).panels;
    expect(limits).toMatchObject({ inflight: 2, peakInflight: 3, requests: 3 });
    expect(requestsPerMinute(limits, 30_000)).toBe(3);
    expect(requestsPerMinute(limits, 75_000)).toBe(1);
  });

  it("ignores timers and shows quota families as generic rows", () => {
    const s = started().emit("effect.started", "o0", { effect_id: "t", kind: "timer", request: {} }).emit("quota.adjusted", "o0", { model: "m", rpm: 900 });
    const { limits } = foldEvents(s.events).panels;
    expect(limits.requests).toBe(0);
    expect(limits.other.map((row) => row.type)).toEqual(["quota.adjusted"]);
  });
});

describe("Breakers", () => {
  it("follows a model breaker through open, half-open and closed", () => {
    const s = started();
    s.at(5000).emit("breaker.opened", "o0", { breaker: "model:muse-spark-1.3", until_ms: 15_000, trips: 1, reason: "5 failures in 30 s" });
    let { breakers } = foldEvents(s.events).panels;
    const open = breakers.rows["model:muse-spark-1.3"];
    expect(open).toMatchObject({ state: "open", kind: "model", trips: 1, untilMs: 15_000, reason: "5 failures in 30 s" });
    expect(secondsUntilProbe(open, 9000)).toBe(6);
    expect(secondsUntilProbe(open, 20_000)).toBe(0);
    s.at(15_000).emit("breaker.half_open", "o0", { breaker: "model:muse-spark-1.3" });
    s.at(16_000).emit("breaker.closed", "o0", { breaker: "model:muse-spark-1.3" });
    breakers = foldEvents(s.events).panels.breakers;
    const closed = breakers.rows["model:muse-spark-1.3"];
    expect(closed).toMatchObject({ state: "closed", trips: 1, untilMs: null });
    expect(closed.history.map((h) => h.event)).toEqual(["opened", "half_open", "closed"]);
    expect(breakers.transitions).toBe(3);
  });

  it("reads the state words of a one-segment suffix too: half_open is not open", () => {
    const s = started()
      .emit("breaker.channel_opened", "o1", { breaker: "channel:a>b", until_ms: 9000, trips: 1, reason: "storm" })
      .emit("breaker.channel_half_open", "o1", { breaker: "channel:a>b" })
      .emit("breaker.topic_opened", "o1", { breaker: "topic:t", until_ms: 9000, trips: 1, reason: "storm" })
      .emit("breaker.topic_closed", "o1", { breaker: "topic:t" });
    const { breakers } = foldEvents(s.events).panels;
    expect(breakers.rows["channel:a>b"]).toMatchObject({ state: "half_open", trips: 1 });
    expect(breakers.rows["topic:t"]).toMatchObject({ state: "closed", trips: 1 });
    expect(breakers.other).toEqual([]);
  });

  it("reads breaker types that land later by their suffix, and keeps unknown ones as transitions", () => {
    const s = started()
      .emit("breaker.channel.opened", "o1", { breaker: "channel:o1>o2", until_ms: 9000, trips: 1, reason: "ping-pong" })
      .emit("breaker.coalesced", "o1", { breaker: "topic:contract", messages: 40 });
    const { breakers } = foldEvents(s.events).panels;
    expect(breakers.rows["channel:o1>o2"]).toMatchObject({ kind: "channel", state: "open", trips: 1, reason: "ping-pong" });
    expect(breakers.rows["topic:contract"]).toMatchObject({ kind: "topic", state: "closed" });
    expect(breakers.rows["topic:contract"].history[0].event).toBe("coalesced");
    expect(breakers.other.map((row) => row.type)).toEqual(["breaker.coalesced"]);
    expect(breakerKind("global_spend")).toBe("global");
  });
});

describe("Memory", () => {
  const fact = (key: string, squad: string, version = 1) => ({
    key,
    subject: key.split(":")[1],
    status: "draft",
    squad,
    agent: `${squad}.a1`,
    contract: "c1",
    version,
  });

  it("publishes facts as drafts, promotes them, and counts versions", () => {
    const s = started()
      .emit("fact.published", "board", fact("speaker:S01:availability", "o3.1"))
      .emit("fact.published", "board", fact("speaker:S01:availability", "o3.1", 2))
      .emit("fact.published", "board", fact("speaker:S02:availability", "o2.2"))
      .emit("fact.promoted", "board", { key: "speaker:S01:availability", by: "o3.2" })
      .emit("fact.promoted", "board", { key: "speaker:S01:availability", by: "o3.2" })
      .emit("artifact.written", "board", { path: "sessions/a/blurb.md", version: 1, author: "o3.1.a2", size: 178 });
    const { memory } = foldEvents(s.events).panels;
    expect(memory.order).toEqual(["speaker:S01:availability", "speaker:S02:availability"]);
    expect(memory).toMatchObject({ published: 3, promoted: 1 });
    expect(memory.facts["speaker:S01:availability"]).toMatchObject({ version: 2, promoted: true, promotedBy: "o3.2" });
    expect(memory.squads["o3.1"]).toMatchObject({ published: 2, promoted: 1 });
    expect(memory.artifacts["sessions/a/blurb.md"]).toMatchObject({ size: 178, author: "o3.1.a2" });
  });

  it("measures how many searched facts came from another squad", () => {
    const search = (id: string, squad: string) =>
      ["msg.sent", squad, { to: "board", topic: "tool", body: { name: "memory.search", call_id: id, squad, args: {} } }] as const;
    const reply = (id: string, owners: string[]) =>
      ["msg.sent", "board", { to: "o1.a1", topic: "tool.result", body: { call_id: id, output: { results: owners.map((squad, i) => ({ key: `k${i}`, squad })) } } }] as const;
    const s = started();
    s.emit(...search("c1", "o3.2"));
    s.emit(...reply("c1", ["o2.2", "o3.1", "o3.2"]));
    s.emit(...search("c2", "o1.1"));
    s.emit(...reply("c2", []));
    s.emit("msg.sent", "o1", { to: "board", topic: "tool", body: { name: "workspace.write", call_id: "c3", squad: "o1" } });
    const { memory } = foldEvents(s.events).panels;
    expect(memory).toMatchObject({ searches: 2, hits: 3, crossSquadHits: 2, pending: {} });
    expect(memory.squads["o2.2"].reused).toBe(1);
    expect(memory.squads["o3.1"].reused).toBe(1);
    expect(memory.squads["o3.2"]?.reused ?? 0).toBe(0);
  });
});

describe("Collisions log", () => {
  const conflict = { key: "cell:d1:s0:room-b", reason: "leased", holder: "o2.2", version: 1, value: null };

  it("logs a booking conflict and closes it when the owner re-places", () => {
    const s = started()
      .emit("lease.booked", "board", { holder: "o3.3", goal_id: "track-hci/d1", keys: ["cell:d1:s0:room-b", "cell:d1:s1:room-d", "speaker:S01:d1:s0"] })
      .at(2000)
      .emit("collision.detected", "board", { kind: "temporal", goal_id: "track-ai/d1", holder: "o2.1", conflicts: [conflict] });
    let { collisions } = foldEvents(s.events).panels;
    expect(collisions).toMatchObject({ leases: 1, leasedCells: 2, leasedSpeakers: 1 });
    expect(openCollisionCount(collisions)).toBe(1);
    expect(collisions.rows[0]).toMatchObject({
      id: "track-ai/d1#1",
      kind: "temporal",
      holder: "o2.1",
      status: "open",
      conflicts: [{ key: "cell:d1:s0:room-b", reason: "leased", holder: "o2.2" }],
    });
    s.at(4000).emit("collision.resolved", "o2.1", { kind: "temporal", goal_id: "track-ai/d1", resolution: "re-placed after 1 booking conflict(s)" });
    collisions = foldEvents(s.events).panels.collisions;
    expect(openCollisionCount(collisions)).toBe(0);
    expect(collisions.rows[0]).toMatchObject({ status: "resolved", arbiter: "o2.1", resolvedTs: 4000, resolution: "re-placed after 1 booking conflict(s)" });
  });

  it("resolves only the goal that was re-placed, and still reads the Day 7 shape", () => {
    const s = started()
      .emit("collision.detected", "board", { kind: "temporal", goal_id: "g1", holder: "o1", conflicts: [] })
      .emit("collision.detected", "board", { kind: "temporal", goal_id: "g2", holder: "o2", conflicts: [] })
      .emit("collision.detected", "arbiter", { collision_id: "c-7", kind: "goal", cells: [{ day: 1, room: "room-b", slot: 3 }], squads: ["a", "b"] })
      .emit("collision.resolved", "o1", { kind: "temporal", goal_id: "g1", resolution: "x" })
      .emit("collision.resolved", "root", { collision_id: "c-7", arbiter: "root", rule: "older lamport" });
    const { collisions } = foldEvents(s.events).panels;
    expect(collisions.rows.map((r) => [r.goalId || r.id, r.status])).toEqual([
      ["g1", "resolved"],
      ["g2", "open"],
      ["c-7", "resolved"],
    ]);
    expect(collisions.rows[2]).toMatchObject({ arbiter: "root", resolution: "older lamport" });
    expect(collisions.rows[2].conflicts[0]).toMatchObject({ key: "cell:1:3:room-b", holder: "a vs b" });
  });
});

describe("Escalations", () => {
  const rejected = (attempt: number, stage: string, reasons: string[] = ["why"]) => ({
    goal_id: "track-ai/d1",
    contract_id: "place",
    attempt,
    stage,
    reasons,
  });

  it("maps a rejection to its ladder step the way the orchestrator retries", () => {
    expect(stepOf(0, "checks")).toBe("retry");
    expect(stepOf(1, "judge")).toBe("reassign");
    expect(stepOf(1, "booking")).toBe("retry");
    expect(stepOf(0, "lost")).toBe("lost");
  });

  it("follows a contract through retry and reassignment until it is verified", () => {
    const s = started()
      .emit("contract.rejected", "o2.1", rejected(0, "checks", ["room too small"]))
      .emit("contract.rejected", "o2.1", rejected(1, "judge"))
      .emit("contract.rejected", "o2.1", rejected(2, "lost"))
      .emit("contract.verified", "o2.1", { goal_id: "track-ai/d1", contract_id: "place", attempt: 3 })
      .emit("contract.verified", "o2.1", { goal_id: "track-ai/d1", contract_id: "extract", attempt: 0 });
    const { escalations } = foldEvents(s.events).panels;
    expect(escalations.order).toEqual(["track-ai/d1/place"]);
    const trail = escalations.trails["track-ai/d1/place"];
    expect(trail.status).toBe("recovered");
    expect(trail.rejections.map((r) => r.step)).toEqual(["retry", "reassign", "lost"]);
    expect(trail.rejections[0].reasons).toEqual(["room too small"]);
    expect(escalations.steps).toEqual({ retry: 1, reassign: 1, lost: 1, failed: 0, recovered: 1 });
  });

  it("marks a contract the squad gave up on, and a goal that ended with gaps", () => {
    const s = started()
      .emit("contract.rejected", "o2.1", rejected(2, "checks"))
      .emit("contract.failed", "o2.1", { goal_id: "track-ai/d1", contract_id: "place", attempt: 2, reasons: ["why"] })
      .emit("goal.completed", "o2.1", { goal_id: "track-ai/d1", owner: "o2.1", status: "partial", gaps: ["T04", "T05"] })
      .emit("goal.completed", "o2.2", { goal_id: "track-ai/d2", owner: "o2.2", status: "ok", gaps: [] })
      .emit("plan.rejected", "o0", { goal_id: "root", attempt: 0, errors: ["no tracks"] });
    const { escalations } = foldEvents(s.events).panels;
    expect(escalations.trails["track-ai/d1/place"].status).toBe("failed");
    expect(escalations.steps.failed).toBe(1);
    expect(escalations.goalGaps).toEqual([expect.objectContaining({ goalId: "track-ai/d1", status: "partial", gaps: ["T04", "T05"] })]);
    expect(escalations.planRejections).toEqual([expect.objectContaining({ goalId: "root", errors: ["no tracks"] })]);
  });

  it("keeps human escalations open until they are resolved, keyed by their eid", () => {
    const s = started()
      .emit("escalation.raised", "o0", { eid: "esc-1", goal_id: "track-ai/d1", reason: "parent failed" })
      .emit("escalation.raised", "o0", { eid: "esc-2", goal_id: "track-ai/d2", reason: "parent failed" })
      .emit("escalation.resolved", "@env", { eid: "esc-1", decision: "skip" })
      .emit("replan.notice", "o2", { goal_id: "track-ai/d2" });
    const { escalations } = foldEvents(s.events).panels;
    expect(escalations.human.map((h) => [h.id, h.status])).toEqual([
      ["esc-1", "resolved"],
      ["esc-2", "open"],
    ]);
    expect(escalations.human[0].resolution).toBe("skip");
    expect(escalations.human[1]).toMatchObject({ goalId: "track-ai/d2", text: "parent failed", actor: "o0" });
    expect(openEscalations(escalations).map((h) => h.id)).toEqual(["esc-2"]);
    expect(escalations.other.map((row) => row.type)).toEqual(["replan.notice"]);
  });
});

describe("Results", () => {
  const report = {
    expected: 48,
    placed: 48,
    gaps: [],
    hard_violations: 0,
    soft_score: 0.8333,
    schedule: [
      { day: 2, room: "room-d", slot: 7, talk_id: "T01" },
      { day: 1, room: "main-hall", slot: 3, talk_id: "T03" },
    ],
  };

  it("is pending until the root reports, then complete", () => {
    const s = started().emit("contract.created", "o2", { contract: {}, work: "g/c" });
    expect(outcomeOf(foldEvents(s.events).panels.results)).toBe("pending");
    s.emit("task.result", "o0", { task: "t2_conference", status: "ok", report });
    const { results } = foldEvents(s.events).panels;
    expect(outcomeOf(results)).toBe("complete");
    expect(results.task).toMatchObject({ task: "t2_conference", status: "ok", actor: "o0" });
    expect(placementsOf(results.task!.report)).toEqual([
      { day: "2", room: "room-d", slot: "7", talk: "T01" },
      { day: "1", room: "main-hall", slot: "3", talk: "T03" },
    ]);
  });

  it("calls a result with gaps partial, and a failed task failed", () => {
    const partial = foldEvents(started().emit("task.result", "o0", { task: "t2", status: "ok", report: { ...report, gaps: ["T07"] } }).events);
    expect(outcomeOf(partial.panels.results)).toBe("partial");
    const goalGap = foldEvents(
      started()
        .emit("goal.completed", "o2", { goal_id: "g", owner: "o2", status: "partial", gaps: ["T07"] })
        .emit("task.result", "o0", { task: "t2", status: "ok", report }).events,
    );
    expect(outcomeOf(goalGap.panels.results)).toBe("partial");
    const failed = foldEvents(started().emit("task.result", "o0", { task: "t2", status: "failed", report: {} }).events);
    expect(outcomeOf(failed.panels.results)).toBe("failed");
  });

  it("counts contracts, judge verdicts and goals, and shows audits as generic rows", () => {
    const work = { goal_id: "g", contract_id: "c", attempt: 0 };
    const s = started()
      .emit("contract.created", "o2", { contract: {}, work: "g/c" })
      .emit("contract.dispatched", "o2", { ...work, assignee: "a1", idem_key: "k" })
      .emit("contract.completed", "o2", { ...work, agent: "a1", status: "ok", steps: 2 })
      .emit("verify.judged", "o2", { ...work, verdict: "pass", score: 0.9, reasons: [] })
      .emit("verify.judged", "o2", { ...work, verdict: "fail", score: 0.3, reasons: [], reused: true })
      .emit("contract.verified", "o2", work)
      .emit("goal.completed", "o2", { goal_id: "g", owner: "o2", status: "ok", gaps: [] })
      .emit("audit.completed", "o3", { target: "g/c", verdict: "pass" });
    const { results } = foldEvents(s.events).panels;
    expect(results.contracts).toEqual({ created: 1, dispatched: 1, completed: 1, verified: 1, rejected: 0, failed: 0 });
    expect(results.judged).toEqual({ count: 2, passed: 1, scoreSum: 1.2, reused: 1 });
    expect(results.goalOrder).toEqual(["g"]);
    expect(results.other.map((row) => row.type)).toEqual(["audit.completed"]);
  });
});

describe("the panels on the golden toy run", () => {
  const events = loadJsonl("tests/golden/toy/events.jsonl");
  const view = foldEvents(events);

  it("agrees with the core counters on calls and spend", () => {
    const { economy, limits } = view.panels;
    expect(economy.spentUsd).toBeCloseTo(view.counters.spentUsd, 9);
    expect(committed(economy)).toBeCloseTo(economy.spentUsd, 9); // every reservation was settled
    const calls = Object.values(economy.models).reduce((sum, m) => sum + m.calls, 0);
    expect(calls).toBe(view.counters.llmCalls);
    expect(limits.requests).toBe(view.counters.llmCalls);
    expect(limits.inflight).toBe(0);
    expect(runCap(economy)).not.toBeNull();
  });

  it("counts every event once in the groups", () => {
    expect(Object.values(view.groups).reduce((a, b) => a + b, 0)).toBe(events.length);
  });

  it("is a pure fold: the same events give equal panels, and the input is never mutated", () => {
    const before = JSON.stringify(emptyView().panels);
    const start = emptyView();
    expect(foldEvents(events, start).panels).toEqual(view.panels);
    expect(JSON.stringify(start.panels)).toBe(before);
  });
});
