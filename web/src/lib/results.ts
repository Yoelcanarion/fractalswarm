// Results (spec §11, §16): what the run produced and how well it was checked, as a fold.
//
//   task.result        {task, status, report}      the root's final report; for T2 the report holds
//                                                   {expected, placed, gaps, hard_violations,
//                                                    soft_score, violation_counts, violations,
//                                                    schedule: [{day, room, slot, talk_id}]}
//   goal.completed     {goal_id, owner, status, gaps}
//   contract.*         created, dispatched, completed, verified, rejected, failed
//   verify.judged      {goal_id, contract_id, attempt, verdict, score, reused}
//
// The cross-squad audit (spec §11.3) is a family of its own (audit.*): it shows as generic rows.

import { claimedBy } from "./families";
import {
  appendCapped,
  asNumber,
  asRecord,
  asString,
  asStrings,
  GENERIC_CAP,
  genericEntry,
  type GenericEntry,
} from "./generic";
import type { RunEvent } from "./types";

export interface TaskResult {
  seq: number;
  ts: number;
  actor: string;
  task: string;
  status: string;
  report: Record<string, unknown>;
}

export interface GoalOutcome {
  goalId: string;
  owner: string;
  status: string;
  gaps: string[];
  seq: number;
  ts: number;
}

export interface ResultsState {
  task: TaskResult | null;
  goals: Record<string, GoalOutcome>;
  goalOrder: string[];
  contracts: { created: number; dispatched: number; completed: number; verified: number; rejected: number; failed: number };
  judged: { count: number; passed: number; scoreSum: number; reused: number };
  other: GenericEntry[];
}

export const emptyResults = (): ResultsState => ({
  task: null,
  goals: {},
  goalOrder: [],
  contracts: { created: 0, dispatched: 0, completed: 0, verified: 0, rejected: 0, failed: 0 },
  judged: { count: 0, passed: 0, scoreSum: 0, reused: 0 },
  other: [],
});

const RESULT_TYPES: ReadonlySet<string> = new Set([
  "task.result",
  "goal.completed",
  "contract.created",
  "contract.dispatched",
  "contract.completed",
  "contract.verified",
  "contract.rejected",
  "contract.failed",
  "verify.judged",
]);

const CONTRACT_COUNTERS: Record<string, keyof ResultsState["contracts"]> = {
  "contract.created": "created",
  "contract.dispatched": "dispatched",
  "contract.completed": "completed",
  "contract.verified": "verified",
  "contract.rejected": "rejected",
  "contract.failed": "failed",
};

export function foldResults(state: ResultsState, event: RunEvent): ResultsState {
  const p = event.payload;
  const counter = CONTRACT_COUNTERS[event.type];
  if (counter) return { ...state, contracts: { ...state.contracts, [counter]: state.contracts[counter] + 1 } };
  switch (event.type) {
    case "task.result":
      return {
        ...state,
        task: {
          seq: event.seq,
          ts: event.ts_virtual,
          actor: event.actor,
          task: asString(p.task),
          status: asString(p.status),
          report: asRecord(p.report),
        },
      };
    case "goal.completed": {
      const goalId = asString(p.goal_id);
      const outcome: GoalOutcome = {
        goalId,
        owner: asString(p.owner, event.actor),
        status: asString(p.status),
        gaps: asStrings(p.gaps),
        seq: event.seq,
        ts: event.ts_virtual,
      };
      return {
        ...state,
        goals: { ...state.goals, [goalId]: outcome },
        goalOrder: state.goals[goalId] ? state.goalOrder : [...state.goalOrder, goalId],
      };
    }
    case "verify.judged": {
      const judged = state.judged;
      return {
        ...state,
        judged: {
          count: judged.count + 1,
          passed: judged.passed + (asString(p.verdict) === "pass" ? 1 : 0),
          scoreSum: judged.scoreSum + (asNumber(p.score) ?? 0),
          reused: judged.reused + (p.reused === true ? 1 : 0),
        },
      };
    }
    default:
      if (claimedBy(event.type) === "results" && !RESULT_TYPES.has(event.type)) {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}

export type Outcome = "pending" | "complete" | "partial" | "failed";

/** A result with gaps is partial, never silently complete (spec §7.4: explicit gaps). */
export function outcomeOf(state: ResultsState): Outcome {
  const task = state.task;
  if (!task) return "pending";
  if (task.status === "failed") return "failed";
  const incomplete = asStrings(task.report.gaps).length > 0 || state.goalOrder.some((id) => state.goals[id].status !== "ok");
  return task.status === "ok" && !incomplete ? "complete" : "partial";
}

export interface Placement {
  day: string;
  room: string;
  slot: string;
  talk: string;
}

/** The schedule a T2 report carries, as grid cells. */
export function placementsOf(report: Record<string, unknown>): Placement[] {
  const rows = Array.isArray(report.schedule) ? report.schedule : [];
  return rows.map((row) => {
    const r = asRecord(row);
    return { day: asString(r.day), room: asString(r.room), slot: asString(r.slot), talk: asString(r.talk_id ?? r.talk) };
  });
}
