// The official numbers of a run: what the Python metrics scored from its log (`GET api/runs/{id}/metrics`,
// bench/scoring.py `score_run`, plus bench/recovery.py's `recovery` once W1's metrics are in). The
// arena's counters run on the UI's own fold while a run plays and end on these, so the figures a claim
// quotes are always the scored ones.
//
// Every reader here is tolerant: a server that predates the recovery metrics sends `recovery: null`,
// and a field it does not know is just absent. A missing number is `null`, never a zero.

import { asNumber, asRecord, asString } from "../lib/generic";

export interface OfficialRecovery {
  crashes: number | null;
  /** Idle agent-seconds: agents idle while ready work waited for a down coordinator. */
  idleAgentS: number | null;
  /** Mean time to the first decision on the affected work, per crash. */
  ttrOwnMeanS: number | null;
  /** Coordinator-dependency time: ready work that could not go on because its coordinator was down. */
  cdtS: number | null;
  dupCalls: number | null;
  dupUsd: number | null;
  /** Re-dispatches while the assignee was alive, or its result was already in the log. */
  unnecessaryReassignments: number | null;
  blastAgentsMeanPct: number | null;
}

export interface Official {
  runId: string;
  status: string | null;
  scenario: string | null;
  completed: boolean;
  /** The task checker's verdict; null where the run has none. */
  valid: boolean | null;
  detail: string;
  costUsd: number | null;
  makespanS: number | null;
  stallS: number | null;
  llmCalls: number | null;
  cancelledCalls: number | null;
  /** Null on a server (or a run) without the recovery metrics. */
  recovery: OfficialRecovery | null;
}

const num = (record: Record<string, unknown>, key: string): number | null => asNumber(record[key]);

function readRecovery(value: unknown): OfficialRecovery | null {
  const r = asRecord(value);
  if (Object.keys(r).length === 0) return null;
  return {
    crashes: num(r, "crashes"),
    idleAgentS: num(r, "idle_agent_s"),
    ttrOwnMeanS: num(r, "ttr_own_mean_s"),
    cdtS: num(r, "cdt_s"),
    dupCalls: num(r, "dup_calls"),
    dupUsd: num(r, "dup_usd"),
    unnecessaryReassignments: num(r, "unnecessary_reassignments"),
    blastAgentsMeanPct: num(r, "blast_agents_mean_pct"),
  };
}

/** Read the body of `GET api/runs/{id}/metrics`. The recovery numbers are the reserved top-level
 * `recovery` key (null until W1's metrics are in); `metrics.recovery` is read too in case `score_run`
 * ends up carrying them. */
export function readOfficial(body: unknown): Official | null {
  const root = asRecord(body);
  const metrics = asRecord(root.metrics);
  if (Object.keys(metrics).length === 0) return null;
  return {
    runId: asString(root.run_id, asString(metrics.run_id)),
    status: typeof root.status === "string" ? root.status : null,
    scenario: typeof root.scenario === "string" ? root.scenario : null,
    completed: metrics.completed === true,
    valid: typeof metrics.valid === "boolean" ? metrics.valid : null,
    detail: asString(metrics.detail),
    costUsd: num(metrics, "cost_usd"),
    makespanS: num(metrics, "makespan_s"),
    stallS: num(metrics, "stall_s"),
    llmCalls: num(metrics, "llm_calls"),
    cancelledCalls: num(metrics, "cancelled_llm_calls"),
    recovery: readRecovery(root.recovery) ?? readRecovery(metrics.recovery),
  };
}
