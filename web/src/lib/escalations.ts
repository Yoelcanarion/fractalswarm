// Escalations (spec §5.5): the replanning ladder as a fold over the contract events.
//
//   contract.rejected  {goal_id, contract_id, attempt, stage, reasons}   step 1 retry, step 2 reassign
//                      (stage "lost": the agent died with the contract; it is re-dispatched, not a failure)
//   contract.failed    {goal_id, contract_id, attempt, reasons}          the squad gave up
//   contract.verified  {goal_id, contract_id, attempt}                   the ladder worked
//   plan.rejected      {goal_id, attempt, errors}                        a planner's reply failed its schema
//   goal.completed     {goal_id, owner, status, gaps}                    partial or failed: explicit gaps
//
// Step 5 (a human decides) arrives as an ``escalation.*`` family: ``escalation.raised`` opens one,
// ``escalation.resolved`` closes it, and each is keyed by its ``eid`` (the id that
// ``POST /runs/{id}/escalations/{eid}`` answers). Unknown ``escalation.*`` and ``replan.*`` types
// show as generic rows.

import { claimedBy } from "./families";
import {
  appendCapped,
  asNumber,
  asString,
  asStrings,
  GENERIC_CAP,
  genericEntry,
  type GenericEntry,
} from "./generic";
import type { RunEvent } from "./types";

export type Step = "retry" | "reassign" | "lost";
export type TrailStatus = "retrying" | "recovered" | "failed";

export interface Rejection {
  seq: number;
  ts: number;
  attempt: number;
  stage: string;
  step: Step;
  reasons: string[];
}

export interface Trail {
  key: string; // goal/contract
  goalId: string;
  contractId: string;
  rejections: Rejection[];
  status: TrailStatus;
  lastSeq: number;
  lastTs: number;
}

export interface PlanRejection {
  seq: number;
  ts: number;
  goalId: string;
  attempt: number;
  errors: string[];
}

export interface GoalGap {
  goalId: string;
  owner: string;
  status: string;
  gaps: string[];
  seq: number;
  ts: number;
}

export interface HumanEscalation {
  id: string;
  seq: number;
  ts: number;
  actor: string;
  text: string;
  status: "open" | "resolved";
  resolvedSeq?: number;
  resolution?: string;
}

export interface EscalationsState {
  trails: Record<string, Trail>;
  order: string[];
  planRejections: PlanRejection[];
  goalGaps: GoalGap[];
  human: HumanEscalation[];
  steps: { retry: number; reassign: number; lost: number; failed: number; recovered: number };
  other: GenericEntry[];
}

export const emptyEscalations = (): EscalationsState => ({
  trails: {},
  order: [],
  planRejections: [],
  goalGaps: [],
  human: [],
  steps: { retry: 0, reassign: 0, lost: 0, failed: 0, recovered: 0 },
  other: [],
});

const REJECTIONS_KEPT = 50;
const RAISED = new Set(["raised", "opened", "open", "created", "requested", "needed"]);
const DONE = new Set(["resolved", "closed", "answered", "decided", "dismissed"]);
const ESCALATION_TYPES: ReadonlySet<string> = new Set([
  "contract.rejected",
  "contract.failed",
  "contract.verified",
  "plan.rejected",
  "goal.completed",
]);

/** The ladder step a rejection moves its contract to (orchestrator._retry): the first retry
 * keeps the agent, a second one hands the contract to a different agent. A booking conflict
 * is always retried in place. */
export const stepOf = (attempt: number, stage: string): Step =>
  stage === "lost" ? "lost" : attempt + 1 >= 2 && stage !== "booking" ? "reassign" : "retry";

const workKey = (p: Record<string, unknown>): string => `${asString(p.goal_id)}/${asString(p.contract_id)}`;

function foldTrail(state: EscalationsState, event: RunEvent): EscalationsState {
  const p = event.payload;
  const key = workKey(p);
  const known = state.trails[key];
  const base: Trail = known ?? {
    key,
    goalId: asString(p.goal_id),
    contractId: asString(p.contract_id),
    rejections: [],
    status: "retrying",
    lastSeq: event.seq,
    lastTs: event.ts_virtual,
  };
  const order = known ? state.order : [...state.order, key];
  const seen = { lastSeq: event.seq, lastTs: event.ts_virtual };
  if (event.type === "contract.rejected") {
    const attempt = asNumber(p.attempt) ?? 0;
    const stage = asString(p.stage);
    const step = stepOf(attempt, stage);
    const rejection: Rejection = { seq: event.seq, ts: event.ts_virtual, attempt, stage, step, reasons: asStrings(p.reasons) };
    return {
      ...state,
      trails: { ...state.trails, [key]: { ...base, ...seen, status: "retrying", rejections: appendCapped(base.rejections, rejection, REJECTIONS_KEPT) } },
      order,
      steps: { ...state.steps, [step]: state.steps[step] + 1 },
    };
  }
  if (event.type === "contract.failed") {
    return {
      ...state,
      trails: { ...state.trails, [key]: { ...base, ...seen, status: "failed" } },
      order,
      steps: { ...state.steps, failed: state.steps.failed + 1 },
    };
  }
  // contract.verified: only a contract that was in trouble matters here.
  if (!known || known.status !== "retrying") return state;
  return {
    ...state,
    trails: { ...state.trails, [key]: { ...known, ...seen, status: "recovered" } },
    steps: { ...state.steps, recovered: state.steps.recovered + 1 },
  };
}

function foldHuman(state: EscalationsState, event: RunEvent): EscalationsState {
  const p = event.payload;
  const suffix = event.type.slice("escalation.".length);
  const id = asString(p.eid ?? p.escalation_id ?? p.id, String(event.seq));
  if (RAISED.has(suffix)) {
    const entry: HumanEscalation = {
      id,
      seq: event.seq,
      ts: event.ts_virtual,
      actor: event.actor,
      text: genericEntry(event).text,
      status: "open",
    };
    return { ...state, human: [...state.human.filter((h) => h.id !== id), entry] };
  }
  if (DONE.has(suffix)) {
    return {
      ...state,
      human: state.human.map((h) =>
        h.id === id ? { ...h, status: "resolved" as const, resolvedSeq: event.seq, resolution: asString(p.decision ?? p.resolution ?? p.choice, suffix) } : h,
      ),
    };
  }
  return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
}

export function foldEscalations(state: EscalationsState, event: RunEvent): EscalationsState {
  const p = event.payload;
  switch (event.type) {
    case "contract.rejected":
    case "contract.failed":
    case "contract.verified":
      return foldTrail(state, event);
    case "plan.rejected":
      return {
        ...state,
        planRejections: appendCapped(
          state.planRejections,
          { seq: event.seq, ts: event.ts_virtual, goalId: asString(p.goal_id), attempt: asNumber(p.attempt) ?? 0, errors: asStrings(p.errors) },
          REJECTIONS_KEPT,
        ),
      };
    case "goal.completed": {
      if (asString(p.status) === "ok") return state;
      const gap: GoalGap = {
        goalId: asString(p.goal_id),
        owner: asString(p.owner),
        status: asString(p.status),
        gaps: asStrings(p.gaps),
        seq: event.seq,
        ts: event.ts_virtual,
      };
      return { ...state, goalGaps: [...state.goalGaps, gap] };
    }
    default:
      if (event.type.startsWith("escalation.")) return foldHuman(state, event);
      if (claimedBy(event.type) === "escalations" && !ESCALATION_TYPES.has(event.type)) {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}

export const openEscalations = (state: EscalationsState): HumanEscalation[] => state.human.filter((h) => h.status === "open");
