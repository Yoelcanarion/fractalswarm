// Escalations (spec §5.5): the replanning ladder as a fold over the contract events.
//
//   contract.rejected  {goal_id, contract_id, attempt, stage, reasons}   step 1 retry, step 2 reassign
//                      (stage "lost": the agent died with the contract; it is re-dispatched, not a failure)
//   contract.failed    {goal_id, contract_id, attempt, reasons}          the squad gave up
//   contract.verified  {goal_id, contract_id, attempt}                   the ladder worked
//   plan.rejected      {goal_id, attempt, errors}                        a planner's reply failed its schema
//   goal.completed     {goal_id, owner, status, gaps}                    partial or failed: explicit gaps
//
// Step 5 (a human decides) arrives as an ``escalation.*`` family, keyed by an id (the one that
// ``POST /api/runs/{id}/escalations/{eid}`` answers). Wonder's arbitration (actors/arbitration.py, W3)
// writes the real ones:
//
//   escalation.opened    {id, goal_id, question, options, default, confidence, timeout_ms}   a person may overrule
//                        the ruling that was applied at once, until ``ts_virtual + timeout_ms``
//   escalation.answered  {id, choice, by: "human", accepted, overruled, reason}              the owner's verdict on
//                        an answer. It closes the escalation only when ``accepted``: an ignored answer (not an
//                        option, a second one, too late, an unknown id) is logged with ``accepted: false`` and
//                        leaves it open
//
// ``escalation.raised`` and ``escalation.resolved`` (the shape the panel was built on) open and close one too.
// The time a person has left is ``deadlineTs - nowTs`` in the run's virtual time, never the wall clock: a fake
// run lasts seconds and a replay can be dragged. Unknown ``escalation.*`` and ``replan.*`` types show as generic rows.

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

/** One answer the log judged, in the order it was logged. */
export interface HumanAnswer {
  seq: number;
  ts: number;
  choice: string;
  accepted: boolean;
  overruled: boolean; // the choice was not the ruled label
  reason: string; // why an ignored answer was ignored
}

export interface HumanEscalation {
  id: string;
  seq: number;
  ts: number;
  actor: string;
  goalId: string;
  text: string; // the question a person is asked, else the event's reason, else a digest of its payload
  status: "open" | "resolved"; // resolved: an accepted answer, or an ``escalation.resolved``
  resolvedSeq?: number;
  resolution?: string;
  options: string[]; // the labels a person may answer with
  fallback?: string; // the label that stands when nobody answers: the ruling
  deadlineTs?: number; // the virtual time up to which a person may answer: ``ts + timeout_ms``
  answers: HumanAnswer[]; // every answer the log judged; an ignored one leaves the escalation as it was
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
const ANSWERS_KEPT = 20;
const RAISED =new Set(["raised", "opened", "open", "created", "requested", "needed"]);
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

const close = (h: HumanEscalation, event: RunEvent, resolution: string): HumanEscalation =>
  h.status === "resolved" ? h : { ...h, status: "resolved", resolvedSeq: event.seq, resolution };

function foldHuman(state: EscalationsState, event: RunEvent): EscalationsState {
  const p = event.payload;
  const suffix = event.type.slice("escalation.".length);
  const id = asString(p.eid ?? p.escalation_id ?? p.id, String(event.seq));
  if (RAISED.has(suffix)) {
    const timeout = asNumber(p.timeout_ms);
    const entry: HumanEscalation = {
      id,
      seq: event.seq,
      ts: event.ts_virtual,
      actor: event.actor,
      goalId: asString(p.goal_id),
      text: asString(p.question ?? p.reason ?? p.message ?? p.summary ?? p.detail) || genericEntry(event).text,
      status: "open",
      options: asStrings(p.options),
      fallback: asString(p.default) || undefined,
      deadlineTs: timeout === null ? undefined : event.ts_virtual + timeout,
      answers: [],
    };
    return { ...state, human: [...state.human.filter((h) => h.id !== id), entry] };
  }
  if (suffix === "answered") {
    // The owner's verdict on an answer. Only an accepted one decides; an ignored one is kept for the panel to say why.
    const answer: HumanAnswer = {
      seq: event.seq,
      ts: event.ts_virtual,
      choice: asString(p.choice),
      accepted: p.accepted !== false,
      overruled: p.overruled === true,
      reason: asString(p.reason),
    };
    return {
      ...state,
      human: state.human.map((h) => {
        if (h.id !== id) return h;
        const next = { ...h, answers: appendCapped(h.answers, answer, ANSWERS_KEPT) };
        return answer.accepted ? close(next, event, answer.choice || suffix) : next;
      }),
    };
  }
  if (DONE.has(suffix)) {
    return { ...state, human: state.human.map((h) => (h.id === id ? close(h, event, asString(p.decision ?? p.resolution ?? p.choice, suffix)) : h)) };
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

/** Where a human escalation stands (the ``escalation.state`` of GET /disputes, read from the log alone):
 * ``waiting`` while a person can still answer; ``answered`` or ``overruled`` once an answer was accepted (the
 * ruled label confirmed, or another one chosen); ``expired`` when the run's time passed the window with no
 * accepted answer; ``closed`` when the run ended inside it, or an ``escalation.resolved`` closed it. */
export type EscalationState = "waiting" | "answered" | "overruled" | "expired" | "closed";

/** ``nowTs`` is the virtual time the log has reached (``ViewState.lastTs``), ``ended`` that the run is over. */
export function escalationState(h: HumanEscalation, nowTs: number, ended: boolean): EscalationState {
  const accepted = h.answers.find((a) => a.accepted);
  if (accepted) return accepted.overruled ? "overruled" : "answered";
  if (h.status === "resolved") return "closed";
  if (h.deadlineTs !== undefined && nowTs > h.deadlineTs) return "expired";
  return ended ? "closed" : "waiting";
}

/** What a person has left to answer, in virtual ms: ``deadlineTs - nowTs``, never the wall clock. Null for an
 * escalation with no window. */
export const timeLeftMs = (h: HumanEscalation, nowTs: number): number | null =>
  h.deadlineTs === undefined ? null : Math.max(0, h.deadlineTs - nowTs);
