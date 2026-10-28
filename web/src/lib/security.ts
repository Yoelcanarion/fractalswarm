// The Security view (spec §13, §16): the task-splitting attack as a fold over the audit events.
//
//   run.started.params.corpus.emails   [{id, speaker_id, from, subject, body}]   what the planners were given
//   security.scanned     {surface, source_id, decision, score, backend, reasons, findings}   a firewall verdict
//   security.quarantined {source_id, surface, score, reason, stub}     the text a planner saw instead
//   security.policy      {task_id, decision, categories, explanation, constraints}   the intake classifier
//   security.routed      {request_id, contributor, reason, findings}   a Contributor routing decision
//   tool.denied          {tool, reason, contract?, target?}
//   plan.approved        {goal_id, by, scope_token, envelope: {nodes: [{node_id, objective, data_categories,
//                         tools, writes}]}}                                 what the plan was approved to do
//   scope.approval       {subgoal_id, subgoal_digest, approver, scope_token, reason}
//   scope.violation      {subgoal_id, scope_token, node_id, codes, reasons, data_categories,
//                         evidence: {source_id, firewall_decision, score, backend, branch, proposed_by, objective}}
//
// An email is poisoned when the firewall quarantined it, or when a blocked subgoal names it as its
// source. The wording that passes the firewall ("polite", "authority") is caught here by the scope
// check instead: the subgoal it caused is not a node of the approved plan.

import { appendCapped, asNumber, asRecord, asString, asStrings, GENERIC_CAP, genericEntry, type GenericEntry } from "./generic";
import type { RunEvent } from "./types";

const SCANS_KEPT = 400;

export interface Email {
  id: string;
  speakerId: string;
  from: string;
  subject: string;
  body: string;
}

export interface Scan {
  seq: number;
  ts: number;
  actor: string;
  surface: string;
  sourceId: string;
  decision: string; // allow | quarantine | block
  score: number;
  backend: string;
  reasons: string[];
  findings: string[];
}

export interface Quarantine {
  seq: number;
  ts: number;
  actor: string;
  sourceId: string;
  surface: string;
  score: number;
  reason: string;
  stub: string;
}

export interface PolicyDecision {
  seq: number;
  ts: number;
  taskId: string;
  decision: string; // allow | constrain | refuse
  categories: string[];
  explanation: string;
  constraints: string[];
}

export interface Routing {
  seq: number;
  ts: number;
  requestId: string;
  contributor: boolean;
  reason: string;
  findings: string[];
}

export interface Denied {
  seq: number;
  ts: number;
  actor: string;
  tool: string;
  reason: string;
  contract: string;
  target: string;
}

export interface ScopeApproval {
  seq: number;
  ts: number;
  subgoalId: string;
  approver: string;
  reason: string;
}

export interface Violation {
  seq: number;
  ts: number;
  actor: string;
  subgoalId: string;
  nodeId: string;
  codes: string[];
  reasons: string[];
  dataCategories: string[];
  scopeToken: string;
  sourceId: string;
  firewallDecision: string;
  score: number | null;
  backend: string;
  branch: string;
  proposedBy: string;
  objective: string;
}

export interface ScopeNode {
  nodeId: string;
  objective: string;
  dataCategories: string[];
  tools: string[];
  writes: string[];
}

export interface PlanScope {
  seq: number;
  ts: number;
  goalId: string;
  by: string;
  token: string;
  nodes: ScopeNode[];
}

export interface SecurityState {
  emails: Record<string, Email>;
  emailOrder: string[];
  scans: Scan[];
  scanned: number; // verdicts seen, including the ones no longer kept
  quarantines: Quarantine[];
  policies: PolicyDecision[];
  routings: Routing[];
  denied: Denied[];
  approvals: ScopeApproval[];
  violations: Violation[];
  scope: PlanScope | null;
  other: GenericEntry[];
}

export const emptySecurity = (): SecurityState => ({
  emails: {},
  emailOrder: [],
  scans: [],
  scanned: 0,
  quarantines: [],
  policies: [],
  routings: [],
  denied: [],
  approvals: [],
  violations: [],
  scope: null,
  other: [],
});

const SECURITY_TYPES: ReadonlySet<string> = new Set([
  "security.scanned",
  "security.quarantined",
  "security.policy",
  "security.routed",
  "tool.denied",
  "scope.approval",
  "scope.violation",
]);

export function foldSecurity(state: SecurityState, event: RunEvent): SecurityState {
  const p = event.payload;
  const at = { seq: event.seq, ts: event.ts_virtual };
  switch (event.type) {
    case "run.started": {
      const emails = asRecord(asRecord(p.params).corpus).emails;
      if (!Array.isArray(emails)) return state;
      const byId: Record<string, Email> = {};
      const order: string[] = [];
      for (const entry of emails) {
        const e = asRecord(entry);
        const id = asString(e.id);
        if (!id) continue;
        byId[id] = { id, speakerId: asString(e.speaker_id), from: asString(e.from), subject: asString(e.subject), body: asString(e.body) };
        order.push(id);
      }
      return { ...state, emails: byId, emailOrder: order };
    }
    case "plan.approved": {
      const nodes = asRecord(p.envelope).nodes;
      if (!Array.isArray(nodes)) return state;
      const scope: PlanScope = {
        ...at,
        goalId: asString(p.goal_id),
        by: asString(p.by),
        token: asString(p.scope_token),
        nodes: nodes.map((n) => {
          const node = asRecord(n);
          return {
            nodeId: asString(node.node_id),
            objective: asString(node.objective),
            dataCategories: asStrings(node.data_categories),
            tools: asStrings(node.tools),
            writes: asStrings(node.writes),
          };
        }),
      };
      return { ...state, scope };
    }
    case "security.scanned": {
      const scan: Scan = {
        ...at,
        actor: event.actor,
        surface: asString(p.surface),
        sourceId: asString(p.source_id),
        decision: asString(p.decision),
        score: asNumber(p.score) ?? 0,
        backend: asString(p.backend),
        reasons: asStrings(p.reasons),
        findings: asStrings(p.findings),
      };
      return { ...state, scans: appendCapped(state.scans, scan, SCANS_KEPT), scanned: state.scanned + 1 };
    }
    case "security.quarantined":
      return {
        ...state,
        quarantines: [
          ...state.quarantines,
          { ...at, actor: event.actor, sourceId: asString(p.source_id), surface: asString(p.surface), score: asNumber(p.score) ?? 0, reason: asString(p.reason), stub: asString(p.stub) },
        ],
      };
    case "security.policy":
      return {
        ...state,
        policies: [
          ...state.policies,
          {
            ...at,
            taskId: asString(p.task_id),
            decision: asString(p.decision),
            categories: asStrings(p.categories),
            explanation: asString(p.explanation),
            constraints: asStrings(p.constraints),
          },
        ],
      };
    case "security.routed":
      return {
        ...state,
        routings: [...state.routings, { ...at, requestId: asString(p.request_id), contributor: p.contributor === true, reason: asString(p.reason), findings: asStrings(p.findings) }],
      };
    case "tool.denied":
      return {
        ...state,
        denied: [
          ...state.denied,
          { ...at, actor: event.actor, tool: asString(p.tool), reason: asString(p.reason), contract: asString(p.contract), target: asString(p.target) },
        ],
      };
    case "scope.approval":
      return {
        ...state,
        approvals: [...state.approvals, { ...at, subgoalId: asString(p.subgoal_id), approver: asString(p.approver), reason: asString(p.reason) }],
      };
    case "scope.violation": {
      const evidence = asRecord(p.evidence);
      const violation: Violation = {
        ...at,
        actor: event.actor,
        subgoalId: asString(p.subgoal_id),
        nodeId: asString(p.node_id),
        codes: asStrings(p.codes),
        reasons: asStrings(p.reasons),
        dataCategories: asStrings(p.data_categories),
        scopeToken: asString(p.scope_token),
        sourceId: asString(evidence.source_id),
        firewallDecision: asString(evidence.firewall_decision),
        score: asNumber(evidence.score),
        backend: asString(evidence.backend),
        branch: asString(evidence.branch),
        proposedBy: asString(evidence.proposed_by),
        objective: asString(evidence.objective),
      };
      return { ...state, violations: [...state.violations, violation] };
    }
    default:
      if ((event.type.startsWith("security.") || event.type.startsWith("scope.")) && !SECURITY_TYPES.has(event.type)) {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}

// -- selectors --------------------------------------------------------------------------

export type EmailVerdict = "clean" | "quarantined" | "blocked";

export interface EmailStatus {
  email: Email;
  scan: Scan | null; // the latest firewall verdict
  verdict: EmailVerdict;
  violations: Violation[]; // the subgoals this email caused that the scope check blocked
}

/** Every email with what became of it. An email the firewall let through can still be the source
 * of a blocked subgoal; a quarantined one never reaches a planner. */
export function emailStatuses(state: SecurityState): EmailStatus[] {
  return state.emailOrder.map((id) => {
    const scan = [...state.scans].reverse().find((s) => s.sourceId === id) ?? null;
    const violations = state.violations.filter((v) => v.sourceId === id);
    const quarantined = state.quarantines.some((q) => q.sourceId === id) || (scan !== null && scan.decision !== "allow");
    return { email: state.emails[id], scan, verdict: quarantined ? "quarantined" : violations.length > 0 ? "blocked" : "clean", violations };
  });
}

/** Sources the audit knows about but the corpus does not carry (an email that was not recorded). */
export const unknownSources = (state: SecurityState): string[] =>
  [...new Set([...state.quarantines.map((q) => q.sourceId), ...state.violations.map((v) => v.sourceId)])].filter((id) => id && !state.emails[id]);

/** The body of an email split around the sentence a blocked subgoal quotes, so it can be highlighted.
 * ``null`` when the subgoal's text is not a verbatim part of the body. */
export function highlight(body: string, quoted: string): [string, string, string] | null {
  const needle = quoted.trim();
  if (needle.length < 12) return null;
  const at = body.indexOf(needle);
  return at < 0 ? null : [body.slice(0, at), body.slice(at, at + needle.length), body.slice(at + needle.length)];
}

export const attackSeen = (state: SecurityState): boolean => state.violations.length > 0 || state.quarantines.length > 0 || state.denied.length > 0;
