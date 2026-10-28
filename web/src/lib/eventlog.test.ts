import { describe, expect, it } from "vitest";

import { eventGroup, matches, NOISE_GROUPS, recent, summarize, tone } from "./eventlog";
import { claimedBy } from "./families";
import { digest } from "./generic";
import { Stream } from "./testing";

const only = (build: (s: Stream) => Stream) => build(new Stream()).events.at(-1)!;

describe("which panel claims an event type", () => {
  it("routes the registered types and the families that land later by name", () => {
    expect(claimedBy("budget.settled")).toBe("market");
    expect(claimedBy("market.epoch.closed")).toBe("market");
    expect(claimedBy("budget.epoch")).toBe("market");
    expect(claimedBy("topup.requested")).toBe("market");
    expect(claimedBy("feasibility.reported")).toBe("market");
    expect(claimedBy("risk.scored")).toBe("market");
    expect(claimedBy("breaker.opened")).toBe("breakers");
    expect(claimedBy("breaker.channel.opened")).toBe("breakers");
    expect(claimedBy("quota.adjusted")).toBe("limits");
    expect(claimedBy("fact.published")).toBe("memory");
    expect(claimedBy("collision.detected")).toBe("collisions");
    expect(claimedBy("lease.booked")).toBe("collisions");
    expect(claimedBy("escalation.raised")).toBe("escalations");
    expect(claimedBy("replan.notice")).toBe("escalations");
    expect(claimedBy("audit.completed")).toBe("results");
    expect(claimedBy("task.result")).toBe("results");
  });

  it("leaves every other family to the event list", () => {
    for (const type of ["msg.sent", "actor.spawned", "member.dead", "contract.rejected", "security.scanned"]) {
      expect(claimedBy(type)).toBeNull();
    }
  });
});

describe("event groups and the filter", () => {
  const heartbeat = only((s) => s.emit("msg.sent", "o1", { to: "o2", topic: "member.heartbeat" }));
  const frame = only((s) => s.emit("msg.sent", "o1", { to: "o2", topic: "net.frame" }));
  const message = only((s) => s.emit("msg.sent", "o1", { to: "o2", topic: "contract" }));
  const timer = only((s) => s.emit("effect.started", "o1", { effect_id: "e", kind: "timer", request: {} }));
  const llm = only((s) => s.emit("effect.completed", "@env", { effect_id: "e", kind: "llm", status: "ok" }));
  const drop = only((s) => s.emit("chaos.injected", "net", { fault: "drop", detail: { from: "o1", to: "o2" } }));
  const kill = only((s) => s.emit("chaos.injected", "chaos", { fault: "kill_coordinator", target: "o3.1" }));

  it("splits the high-volume streams from the events people read", () => {
    expect(eventGroup(heartbeat)).toBe("heartbeat");
    expect(eventGroup(frame)).toBe("net");
    expect(eventGroup(message)).toBe("msg");
    expect(eventGroup(timer)).toBe("timer");
    expect(eventGroup(llm)).toBe("llm");
    expect(eventGroup(drop)).toBe("net-fault");
    expect(eventGroup(kill)).toBe("chaos");
    expect(eventGroup(only((s) => s.emit("member.dead", "o2", { member: "o1" })))).toBe("member");
    for (const noisy of [heartbeat, frame, timer, drop]) expect(NOISE_GROUPS.has(eventGroup(noisy))).toBe(true);
    for (const quiet of [message, llm, kill]) expect(NOISE_GROUPS.has(eventGroup(quiet))).toBe(false);
  });

  it("hides groups and needs every term in the type, actor or payload", () => {
    const hidden = new Set(NOISE_GROUPS);
    expect(matches(heartbeat, { text: "", hidden })).toBe(false);
    expect(matches(kill, { text: "", hidden })).toBe(true);
    expect(matches(kill, { text: "kill o3.1", hidden })).toBe(true);
    expect(matches(kill, { text: "kill o9", hidden })).toBe(false);
    expect(matches(kill, { text: "CHAOS.injected", hidden })).toBe(true);
    expect(matches(heartbeat, { text: "member.heartbeat", hidden: new Set() })).toBe(true);
  });

  it("returns the newest matches first, never past the cursor, and at most the limit", () => {
    const s = new Stream();
    for (let i = 0; i < 10; i++) s.emit(i % 2 ? "member.dead" : "member.joined", "o1", { member: `m${i}` });
    const filter = { text: "member.dead", hidden: new Set<string>() };
    expect(recent(s.events, 10, filter, 3).map((e) => e.seq)).toEqual([10, 8, 6]);
    expect(recent(s.events, 6, filter, 10).map((e) => e.seq)).toEqual([6, 4, 2]);
    expect(recent(s.events, 99, { text: "", hidden: new Set() }, 4)).toHaveLength(4);
  });
});

describe("one-line summaries", () => {
  it("reads the real shapes of the registered types", () => {
    expect(summarize(only((s) => s.emit("chaos.injected", "chaos", { fault: "kill_coordinator", target: "o3.1", progress: 0.2 })))).toBe(
      "kill_coordinator o3.1",
    );
    expect(summarize(drop())).toBe("drop o1 → o2");
    expect(
      summarize(only((s) => s.emit("ownership.remapped", "o3.2", { key: "track-hci/d1", owner: "o3.2", previous: "o3.1" }))),
    ).toBe("track-hci/d1 o3.1 → o3.2");
    expect(
      summarize(
        only((s) =>
          s.emit("contract.rejected", "o2.1", {
            goal_id: "track-ai/d1",
            contract_id: "extract",
            attempt: 0,
            stage: "lost",
            reasons: ["agent o2.1.a1 was lost"],
          }),
        ),
      ),
    ).toBe("track-ai/d1/extract #0 at lost: agent o2.1.a1 was lost");
  });

  it("shows a digest of any type it does not know", () => {
    const text = summarize(only((s) => s.emit("market.epoch.closed", "o0", { epoch: 3, pool_usd: 0.4, bids: [1, 2, 3], fence: { x: 1 } })));
    expect(text).toBe("epoch=3  pool_usd=0.4  bids[3]");
  });

  it("digests nested values by size and truncates long text", () => {
    expect(digest({ a: "x".repeat(60), b: { c: 1, d: 2 }, e: null, f: true })).toBe(`a=${"x".repeat(27)}…  b{2}  f=true`);
  });

  it("colours failures red and recoveries green", () => {
    expect(tone("contract.failed")).toBe("bad");
    expect(tone("breaker.opened")).toBe("bad");
    expect(tone("contract.verified")).toBe("good");
    expect(tone("budget.shock")).toBe("warn");
    expect(tone("msg.sent")).toBe("");
  });
});

function drop() {
  return only((s) => s.emit("chaos.injected", "net", { fault: "drop", detail: { from: "o1", to: "o2" } }));
}
