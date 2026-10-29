import { describe, expect, it } from "vitest";

import { approveBody, planStatus, rootProposal, tracksOf } from "./plan";
import { foldEvents } from "./reducer";
import { Stream } from "./testing";

const plan = {
  feasibility: "48 talks over 2 days and 4 rooms; main-hall stays shared for big talks.",
  limitations: ["availability comes from free-text emails and may be misread"],
  tracks: [
    { acceptance: "every talk placed once", home_room: "room-b", priority: 1, risk: 0.3, talk_ids: ["T02", "T04", "T05"], track_id: "track-ai" },
    { acceptance: "every talk placed once", home_room: "room-c", priority: 2, risk: 0.5, talk_ids: ["T03", "T10"], track_id: "track-data" },
  ],
};

const proposed = (s: Stream) => s.emit("plan.proposed", "o0", { goal_id: "root", plan, plan_hash: "scope-8092ff56e3db", fallback: false });
const approved = (by: string) => (s: Stream) =>
  s.emit("plan.approved", "o0", { goal_id: "root", scope_token: "scope-8092ff56e3db", by, envelope: { nodes: [{ node_id: "track:track-ai" }, { node_id: "session" }] } });

describe("plan approval", () => {
  it("is awaiting from the proposal until the plan is approved, and says by whom", () => {
    const s = new Stream();
    expect(planStatus(foldEvents(s.events).panels.plan)).toBe("none");
    proposed(s);
    expect(planStatus(foldEvents(s.events).panels.plan)).toBe("awaiting");
    approved("human")(s.at(9000));
    const { plan: state } = foldEvents(s.events).panels;
    expect(planStatus(state)).toBe("approved");
    expect(state.approvals.root).toMatchObject({ by: "human", token: "scope-8092ff56e3db", nodes: 2, ts: 9000 });
  });

  it("reads the tracks of a T2 plan", () => {
    const { plan: state } = foldEvents(proposed(new Stream()).events).panels;
    const proposal = rootProposal(state)!;
    expect(proposal).toMatchObject({ goalId: "root", actor: "o0", hash: "scope-8092ff56e3db", fallback: false });
    expect(tracksOf(proposal.plan)).toEqual([
      { id: "track-ai", talks: ["T02", "T04", "T05"], risk: 0.3, priority: 1, homeRoom: "room-b", acceptance: "every talk placed once" },
      { id: "track-data", talks: ["T03", "T10"], risk: 0.5, priority: 2, homeRoom: "room-c", acceptance: "every talk placed once" },
    ]);
    expect(tracksOf({ rows: 3 })).toEqual([]); // a plan of another shape has no tracks
  });

  it("calls a plan rejected once a planner's reply for it failed after the proposal", () => {
    const s = new Stream().emit("plan.rejected", "o0", { goal_id: "root", attempt: 0, errors: ["no tracks"] });
    expect(planStatus(foldEvents(s.events).panels.plan)).toBe("rejected"); // nothing proposed yet
    proposed(s);
    expect(planStatus(foldEvents(s.events).panels.plan)).toBe("awaiting"); // the old rejection is before the proposal
    s.emit("plan.rejected", "o0", { goal_id: "root", attempt: 1, errors: ["a talk is in two tracks"] });
    const { plan: state } = foldEvents(s.events).panels;
    expect(planStatus(state)).toBe("rejected");
    expect(state.rejections.map((r) => [r.attempt, r.errors[0]])).toEqual([[0, "no tracks"], [1, "a talk is in two tracks"]]);
  });

  it("keeps the sub-plans below the root, and shows feasibility and risk events as generic rows", () => {
    const s = proposed(new Stream())
      .emit("plan.refined", "o2", { goal_id: "track-ai", owner: "o2", children: ["track-ai/d1", "track-ai/d2"], plan: {}, fallback: false })
      .emit("plan.refined", "o2.1", { goal_id: "track-ai/d1", owner: "o2.1", children: ["a", "b", "c"], plan: {}, fallback: true })
      .emit("feasibility.reported", "o0", { cost_p50_usd: 0.3, cost_p90_usd: 0.45, budget_usd: 2 })
      .emit("risk.scored", "o0", { contract: "c1", risk: 0.7 })
      .emit("plan.weighed", "o0", { goal_id: "root" });
    // (plan.feasibility is read natively: see the next test)
    const { plan: state } = foldEvents(s.events).panels;
    expect(state.refinements.map((r) => [r.goalId, r.owner, r.children.length, r.fallback])).toEqual([
      ["track-ai", "o2", 2, false],
      ["track-ai/d1", "o2.1", 3, true],
    ]);
    expect(state.other.map((row) => row.type)).toEqual(["feasibility.reported", "risk.scored", "plan.weighed"]);
    expect(state.other[0].text).toBe("cost_p50_usd=0.3  cost_p90_usd=0.45  budget_usd=2");
  });

  it("keeps the feasibility report written between the proposal and the approval, field by field", () => {
    const report = { verdict: "fits", cost_p50_usd: 0.436, cost_p90_usd: 0.61, budget_share_p50: 0.22, duration_p50_s: 104, bottlenecks: ["track-hci is 2 talks longer"], tools_not_allowed: [] };
    const s = proposed(new Stream()).emit("plan.feasibility", "o0", report);
    approved("auto")(s);
    const { plan: state } = foldEvents(s.events).panels;
    expect(state.feasibility).toMatchObject({ actor: "o0", payload: report });
    expect(state.feasibility!.seq).toBeLessThan(state.approvals.root.seq);
    expect(state.other).toEqual([]); // read natively, not a generic row
    expect(foldEvents(proposed(new Stream()).events).panels.plan.feasibility).toBeNull();
  });

  it("takes the first proposed goal as the root's when none is called root", () => {
    const s = new Stream().emit("plan.proposed", "o0", { goal_id: "report", plan: { sections: 3 }, plan_hash: "h" });
    expect(rootProposal(foldEvents(s.events).panels.plan)?.goalId).toBe("report");
  });
});

describe("the answer to a plan held for a person (POST api/runs/{id}/approve)", () => {
  const shown = (s: Stream) => rootProposal(foldEvents(s.events).panels.plan)!;

  it("approves the plan on screen, naming it by its hash", () => {
    expect(approveBody(shown(proposed(new Stream())), true, "")).toEqual({ goal_id: "root", approve: true, plan_hash: "scope-8092ff56e3db" });
  });

  it("sends a rejection back to the planner with the reason, and only a rejection carries one", () => {
    const plan = shown(proposed(new Stream()));
    expect(approveBody(plan, false, "  split track-ai in two  ")).toEqual({
      goal_id: "root",
      approve: false,
      plan_hash: "scope-8092ff56e3db",
      reason: "split track-ai in two",
    });
    expect(approveBody(plan, false, "   ")).not.toHaveProperty("reason"); // the server then words the feedback itself
    expect(approveBody(plan, true, "looks fine")).not.toHaveProperty("reason");
  });

  it("leaves the hash out for a plan that has none (an older log), rather than sending an empty one", () => {
    const s = new Stream().emit("plan.proposed", "o0", { goal_id: "root", plan, fallback: false });
    expect(approveBody(shown(s), true, "")).toEqual({ goal_id: "root", approve: true });
  });

  it("follows the plan that replaced it: the root dies holding the plan and its heir proposes another", () => {
    const s = proposed(new Stream()).at(8000).emit("plan.proposed", "o1", { goal_id: "root", plan, plan_hash: "scope-91bc0d17a2e4", fallback: false });
    expect(shown(s).actor).toBe("o1");
    expect(approveBody(shown(s), true, "").plan_hash).toBe("scope-91bc0d17a2e4");
    expect(planStatus(foldEvents(s.events).panels.plan)).toBe("awaiting"); // a new plan needs its own answer
  });
});
