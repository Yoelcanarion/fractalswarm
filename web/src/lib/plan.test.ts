import { describe, expect, it } from "vitest";

import { planStatus, rootProposal, tracksOf } from "./plan";
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
    const { plan: state } = foldEvents(s.events).panels;
    expect(state.refinements.map((r) => [r.goalId, r.owner, r.children.length, r.fallback])).toEqual([
      ["track-ai", "o2", 2, false],
      ["track-ai/d1", "o2.1", 3, true],
    ]);
    expect(state.other.map((row) => row.type)).toEqual(["feasibility.reported", "risk.scored", "plan.weighed"]);
    expect(state.other[0].text).toBe("cost_p50_usd=0.3  cost_p90_usd=0.45  budget_usd=2");
  });

  it("takes the first proposed goal as the root's when none is called root", () => {
    const s = new Stream().emit("plan.proposed", "o0", { goal_id: "report", plan: { sections: 3 }, plan_hash: "h" });
    expect(rootProposal(foldEvents(s.events).panels.plan)?.goalId).toBe("report");
  });
});
