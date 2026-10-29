// The intake page's calls to the API (api/jobs.py, api/spend.py, intake/service.py). Every POST says it is JSON,
// even one with no body: the server answers 415 before the route runs otherwise. A call never throws: it gives
// the answer, or why there is none, and an answer the page cannot read is refused with the field it stumbled on.

import type { Texts } from "./highlight";
import { readProposal, type Proposal } from "./proposal";
import { readPreflight, type Kind, type Preflight } from "./spend";
import { bad, count, flag, list, oneOf, reading, record, text, textOrEmpty, type Read } from "./strict";

export type Outcome<T> = { ok: true; status: number; body: T } | { ok: false; status: number; error: string };

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** What a failed call says: the server's `error`, FastAPI's `detail`, or at least the status. */
export function errorOf(status: number, body: unknown): string {
  const b = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof b.error === "string" && b.error !== "") return b.error;
  if (typeof b.detail === "string" && b.detail !== "") return b.detail;
  if (Array.isArray(b.detail)) {
    const reasons = b.detail.map((item) => (item !== null && typeof item === "object" && typeof (item as { msg?: unknown }).msg === "string" ? (item as { msg: string }).msg : "")).filter(Boolean);
    if (reasons.length > 0) return reasons.join("; ");
  }
  return `the server answered ${status}`;
}

// ---- what the server sends ----

export interface Sample {
  conference: string;
  talks: string;
  notes: string;
  rooms: { name: string; capacity: number }[];
}

export interface Started {
  intake_id: string;
  job_id: string;
  billed: boolean;
  warnings: string[];
}

export const INTAKE_STATES = ["reading", "proposed", "approved", "refused", "failed", "interrupted"] as const;
export type IntakeStateName = (typeof INTAKE_STATES)[number];

export interface Scan {
  source_id: string;
  decision: string;
  reasons: string[];
  /** What the scan found in the box: "email" means addresses were replaced by placeholders. */
  findings: string[];
}

export interface ApprovedSummary {
  sha256: string;
  approved_at: string;
  edits: string[];
  truth_mode: string;
  names_pseudonymized: boolean;
}

export interface IntakeState {
  intake_id: string;
  state: IntakeStateName;
  /** The text as the server keeps it: addresses already replaced. */
  texts: Texts;
  proposal: Proposal | null;
  scans: Scan[];
  refused: { segments: string[]; reason: string } | null;
  failed: { errors: string[] } | null;
  approved: ApprovedSummary | null;
}

export interface Approval {
  intake_id: string;
  sha256: string;
  edits: string[];
  warnings: string[];
}

export interface TaskLaunch {
  job_id: string;
  run_id: string;
  warnings: string[];
}

export interface ArenaLaunch {
  pair_id: string;
  job_id: string;
  /** The run ids: the swarm on the left, its rival on the right. */
  left: string;
  right: string;
  warnings: string[];
}

const strings = (raw: unknown, where: string): string[] => list(raw ?? [], where).map((item, i) => text(item, `${where}[${i}]`));

export function readSample(raw: unknown): Read<Sample> {
  return reading(() => {
    const r = record(raw, "sample");
    return {
      conference: textOrEmpty(r.conference, "sample.conference"),
      talks: text(r.talks, "sample.talks"),
      notes: textOrEmpty(r.notes, "sample.notes"),
      rooms: list(r.rooms ?? [], "sample.rooms").map((room, i) => {
        const s = record(room, `sample.rooms[${i}]`);
        return { name: text(s.name, `sample.rooms[${i}].name`), capacity: count(s.capacity, `sample.rooms[${i}].capacity`) };
      }),
    };
  });
}

export function readStarted(raw: unknown): Read<Started> {
  return reading(() => {
    const r = record(raw, "intake");
    return { intake_id: text(r.intake_id, "intake.intake_id"), job_id: text(r.job_id, "intake.job_id"), billed: flag(r.billed ?? false, "intake.billed"), warnings: strings(r.warnings, "intake.warnings") };
  });
}

const readTexts = (raw: unknown): Texts => {
  if (raw === null || raw === undefined) return {};
  const r = record(raw, "intake.texts");
  const texts: Texts = {};
  for (const box of ["conference", "talks", "notes"] as const) if (r[box] !== undefined && r[box] !== null) texts[box] = text(r[box], `intake.texts.${box}`);
  return texts;
};

export function readIntakeState(raw: unknown): Read<IntakeState> {
  return reading(() => {
    const r = record(raw, "intake");
    const state = oneOf(r.state, INTAKE_STATES, "intake.state");
    let proposal: Proposal | null = null;
    if (r.proposal !== null && r.proposal !== undefined) {
      const read = readProposal(r.proposal, "intake.proposal");
      if (!read.ok) return bad("intake", read.reason);
      proposal = read.value;
    }
    const refused = r.refused === null || r.refused === undefined ? null : record(r.refused, "intake.refused");
    const failed = r.failed === null || r.failed === undefined ? null : record(r.failed, "intake.failed");
    const approved = r.approved === null || r.approved === undefined ? null : record(r.approved, "intake.approved");
    return {
      intake_id: text(r.intake_id, "intake.intake_id"),
      state,
      texts: readTexts(r.texts),
      proposal,
      scans: list(r.scans ?? [], "intake.scans").map((scan, i) => {
        const s = record(scan, `intake.scans[${i}]`);
        return { source_id: text(s.source_id, `intake.scans[${i}].source_id`), decision: text(s.decision, `intake.scans[${i}].decision`), reasons: strings(s.reasons, `intake.scans[${i}].reasons`), findings: strings(s.findings, `intake.scans[${i}].findings`) };
      }),
      refused: refused === null ? null : { segments: strings(refused.segments, "intake.refused.segments"), reason: text(refused.reason, "intake.refused.reason") },
      // the errors are whatever the schema check said: show them as they came
      failed: failed === null ? null : { errors: list(failed.errors ?? [], "intake.failed.errors").map((error) => (typeof error === "string" ? error : JSON.stringify(error))) },
      approved:
        approved === null
          ? null
          : {
              sha256: text(approved.sha256, "intake.approved.sha256"),
              approved_at: text(approved.approved_at, "intake.approved.approved_at"),
              edits: strings(approved.edits, "intake.approved.edits"),
              truth_mode: text(approved.truth_mode, "intake.approved.truth_mode"),
              names_pseudonymized: flag(approved.names_pseudonymized ?? false, "intake.approved.names_pseudonymized"),
            },
    };
  });
}

export function readApproval(raw: unknown): Read<Approval> {
  return reading(() => {
    const r = record(raw, "approval");
    return { intake_id: text(r.intake_id, "approval.intake_id"), sha256: text(r.sha256, "approval.sha256"), edits: strings(r.edits, "approval.edits"), warnings: strings(r.warnings, "approval.warnings") };
  });
}

export function readTaskLaunch(raw: unknown): Read<TaskLaunch> {
  return reading(() => {
    const r = record(raw, "launch");
    return { job_id: text(r.job_id, "launch.job_id"), run_id: text(r.run_id, "launch.run_id"), warnings: strings(r.warnings, "launch.warnings") };
  });
}

export function readArenaLaunch(raw: unknown): Read<ArenaLaunch> {
  return reading(() => {
    const r = record(raw, "arena");
    return { pair_id: text(r.pair_id, "arena.pair_id"), job_id: text(r.job_id, "arena.job_id"), left: text(r.left, "arena.left"), right: text(r.right, "arena.right"), warnings: strings(r.warnings, "arena.warnings") };
  });
}

// ---- the calls ----

const PREFLIGHT_PATHS: Record<Kind, string> = { intake: "api/intake/preflight", task: "api/tasks/preflight", arena: "api/arena/preflight" };

/** One call of the API, for any page that reads it the same way: the method and path, the body (always sent as JSON, even
 * when empty), and the reader of the answer. It never throws. */
export function caller(fetcher: Fetcher = (input, init) => fetch(input, init)) {
  return async function call<T>(method: "GET" | "POST", path: string, body: unknown, read: (raw: unknown) => Read<T>): Promise<Outcome<T>> {
    let response: Response;
    try {
      response = await fetcher(path, method === "GET" ? undefined : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    } catch (error) {
      return { ok: false, status: 0, error: `could not reach the server: ${error instanceof Error ? error.message : String(error)}` };
    }
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: errorOf(response.status, raw) };
    const read_ = read(raw);
    return read_.ok ? { ok: true, status: response.status, body: read_.value } : { ok: false, status: response.status, error: `the server's answer could not be read: ${read_.reason}` };
  };
}

export function createIntakeApi(fetcher?: Fetcher) {
  const call = caller(fetcher);
  const id = encodeURIComponent;
  return {
    sample: (seed = 1) => call("GET", `api/intake/sample?seed=${seed}`, undefined, readSample),
    startReading: (body: Record<string, unknown>) => call("POST", "api/intake", body, readStarted),
    intake: (intakeId: string) => call("GET", `api/intake/${id(intakeId)}`, undefined, readIntakeState),
    /** Approve the reading as it stands: the proposal as the person left it, or none for "as read". */
    approve: (intakeId: string, proposal: Proposal | null) => call("POST", `api/intake/${id(intakeId)}/approve`, proposal === null ? {} : { proposal }, readApproval),
    preflight: (kind: Kind, body: Record<string, unknown>): Promise<Outcome<Preflight>> => call("POST", PREFLIGHT_PATHS[kind], body, readPreflight),
    launchTask: (body: Record<string, unknown>) => call("POST", "api/tasks", body, readTaskLaunch),
    launchArena: (body: Record<string, unknown>) => call("POST", "api/arena", body, readArenaLaunch),
  };
}

export type IntakeApi = ReturnType<typeof createIntakeApi>;
