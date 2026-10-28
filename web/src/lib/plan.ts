// Plan approval (spec §16 item 6, §12): the root's plan, and what became of it, as a fold.
//
//   plan.proposed   {goal_id, plan, plan_hash, fallback}          the root's plan (for T2: {feasibility,
//                   limitations, tracks: [{track_id, talk_ids, risk, priority, home_room, acceptance}]})
//   plan.approved   {goal_id, scope_token, by, envelope}          by: auto (bench mode) | human
//   plan.rejected   {goal_id, attempt, errors}                    a planner's reply failed its schema
//   plan.refined    {goal_id, owner, children, plan, fallback}    an orchestrator split its subgoal
//   plan.feasibility  the report of spec §12, written between plan.proposed and plan.approved: cost
//                   P50/P90 against the budget, a verdict (fits | tight | over | unbudgeted), the
//                   stages, the duration, bottlenecks, tools not allowed, policy flags, limitations.
//                   Its fields are shown as they come (KeyValues), so the report can grow.
//
// Today the runtime approves every plan at once (TaskSpec ``auto_approve``, bench mode), so a plan
// is "awaiting approval" only in a run that waits for a human, which the runtime does not do yet.
// Other ``feasibility.*`` and ``risk.*`` types show as generic rows.

import { claimedBy } from "./families";
import { appendCapped, asNumber, asRecord, asString, asStrings, GENERIC_CAP, genericEntry, type GenericEntry } from "./generic";
import type { RunEvent } from "./types";

export interface Proposal {
  seq: number;
  ts: number;
  actor: string;
  goalId: string;
  plan: Record<string, unknown>;
  hash: string;
  fallback: boolean;
}

export interface Approval {
  seq: number;
  ts: number;
  goalId: string;
  by: string;
  token: string;
  nodes: number;
}

export interface PlanRejection {
  seq: number;
  ts: number;
  goalId: string;
  attempt: number;
  errors: string[];
}

export interface Refinement {
  seq: number;
  ts: number;
  goalId: string;
  owner: string;
  children: string[];
  fallback: boolean;
}

export interface Feasibility {
  seq: number;
  ts: number;
  actor: string;
  payload: Record<string, unknown>;
}

export interface PlanState {
  proposals: Record<string, Proposal>;
  proposalOrder: string[];
  approvals: Record<string, Approval>;
  rejections: PlanRejection[];
  refinements: Refinement[];
  feasibility: Feasibility | null;
  other: GenericEntry[];
}

export const emptyPlan = (): PlanState => ({
  proposals: {},
  proposalOrder: [],
  approvals: {},
  rejections: [],
  refinements: [],
  feasibility: null,
  other: [],
});

const PLAN_TYPES: ReadonlySet<string> = new Set(["plan.proposed", "plan.approved", "plan.rejected", "plan.refined", "plan.feasibility"]);

export function foldPlan(state: PlanState, event: RunEvent): PlanState {
  const p = event.payload;
  const at = { seq: event.seq, ts: event.ts_virtual };
  switch (event.type) {
    case "plan.proposed": {
      const goalId = asString(p.goal_id);
      const proposal: Proposal = { ...at, actor: event.actor, goalId, plan: asRecord(p.plan), hash: asString(p.plan_hash), fallback: p.fallback === true };
      return {
        ...state,
        proposals: { ...state.proposals, [goalId]: proposal },
        proposalOrder: state.proposals[goalId] ? state.proposalOrder : [...state.proposalOrder, goalId],
      };
    }
    case "plan.approved": {
      const goalId = asString(p.goal_id);
      const nodes = asRecord(p.envelope).nodes;
      const approval: Approval = { ...at, goalId, by: asString(p.by), token: asString(p.scope_token), nodes: Array.isArray(nodes) ? nodes.length : 0 };
      return { ...state, approvals: { ...state.approvals, [goalId]: approval } };
    }
    case "plan.rejected":
      return {
        ...state,
        rejections: appendCapped(state.rejections, { ...at, goalId: asString(p.goal_id), attempt: asNumber(p.attempt) ?? 0, errors: asStrings(p.errors) }, 30),
      };
    case "plan.refined":
      return {
        ...state,
        refinements: [
          ...state.refinements,
          { ...at, goalId: asString(p.goal_id), owner: asString(p.owner, event.actor), children: asStrings(p.children), fallback: p.fallback === true },
        ],
      };
    case "plan.feasibility":
      return { ...state, feasibility: { ...at, actor: event.actor, payload: p } };
    default:
      if (claimedBy(event.type) === "plan" && !PLAN_TYPES.has(event.type)) {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}

export type PlanStatus = "none" | "awaiting" | "approved" | "rejected";

/** Where the root's plan stands. A plan that was rejected and not yet re-proposed is "rejected". */
export function planStatus(state: PlanState): PlanStatus {
  const goal = state.proposals.root ? "root" : state.proposalOrder[0];
  if (goal === undefined) return state.rejections.length > 0 ? "rejected" : "none";
  const proposal = state.proposals[goal];
  const approval = state.approvals[goal];
  if (approval) return "approved";
  return state.rejections.some((r) => r.goalId === goal && r.seq > proposal.seq) ? "rejected" : "awaiting";
}

/** The root's proposal (the first goal proposed when no goal is called ``root``). */
export const rootProposal = (state: PlanState): Proposal | null =>
  state.proposals.root ?? (state.proposalOrder[0] ? state.proposals[state.proposalOrder[0]] : null);

export interface TrackPlan {
  id: string;
  talks: string[];
  risk: number | null;
  priority: number | null;
  homeRoom: string;
  acceptance: string;
}

/** The tracks of a T2 plan; empty for a task whose plan has another shape. */
export const tracksOf = (plan: Record<string, unknown>): TrackPlan[] =>
  (Array.isArray(plan.tracks) ? plan.tracks : []).map((entry) => {
    const t = asRecord(entry);
    return {
      id: asString(t.track_id),
      talks: asStrings(t.talk_ids),
      risk: asNumber(t.risk),
      priority: asNumber(t.priority),
      homeRoom: asString(t.home_room),
      acceptance: asString(t.acceptance),
    };
  });
