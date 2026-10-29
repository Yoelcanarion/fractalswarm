// What the server says about the escalations of a run (GET api/runs/{id}/disputes, api/lens.py `disputes_view`), reduced to
// what the Escalations panel reads back after a person answers: where each escalation stands and the answers it got, each
// with the owner's verdict (accepted, overruled, or ignored with a reason).

import type { ControlResult } from "./api";
import { asNumber, asRecord, asString } from "./generic";

export interface DisputeAnswer {
  seq: number;
  choice: string;
  by: string;
  accepted: boolean;
  overruled: boolean;
  reason: string;
}

export interface DisputeEscalation {
  id: string;
  state: string; // waiting | answered | overruled | expired | closed
  ruled: string | null; // the arbiter's ruling the escalation is about: what a person overrules
  answers: DisputeAnswer[];
}

/** The escalations in a disputes answer, by the id they were opened with; a dispute with no escalation has none. */
export function readDisputes(raw: unknown): DisputeEscalation[] {
  const disputes = asRecord(raw).disputes;
  if (!Array.isArray(disputes)) return [];
  const found: DisputeEscalation[] = [];
  for (const dispute of disputes) {
    const row = asRecord(dispute);
    const escalation = asRecord(row.escalation);
    const id = asString(escalation.id);
    if (!id) continue;
    const winner = asRecord(row.ruling).winner;
    found.push({
      id,
      state: asString(escalation.state, "waiting"),
      ruled: typeof winner === "string" ? winner : null,
      answers: (Array.isArray(escalation.answers) ? escalation.answers : []).map((item) => {
        const answer = asRecord(item);
        return {
          seq: asNumber(answer.seq) ?? 0,
          choice: asString(answer.choice),
          by: asString(answer.by, "human"),
          accepted: answer.accepted === true,
          overruled: answer.overruled === true,
          reason: asString(answer.reason),
        };
      }),
    });
  }
  return found;
}

export interface Verdict {
  kind: "confirmed" | "overruled" | "ignored";
  text: string;
}

/** The verdict on the newest answer to ``escalation`` after ``afterSeq`` (the last answer the panel had seen when the
 * person clicked), in the server's terms; null while the log shows none. */
export function verdictAfter(escalation: DisputeEscalation | undefined, afterSeq: number): Verdict | null {
  const answer = escalation?.answers.filter((a) => a.seq > afterSeq).at(-1);
  if (!escalation || !answer) return null;
  if (!answer.accepted) return { kind: "ignored", text: `not accepted: ${answer.reason || "the owner did not take it"}` };
  if (answer.overruled) return { kind: "overruled", text: `accepted: ${answer.choice} overrules ${escalation.ruled ?? "the ruling"}` };
  return { kind: "confirmed", text: `accepted: ${answer.choice} confirms ${escalation.ruled ?? "the ruling"}` };
}

// ---- answering ----

/** When to ask the server how the owner took an answer, in ms after the last look: the owner decides on its next turn, so
 * the verdict is in the log a moment after the request is. */
export const READ_BACK_MS = [400, 1000, 2000, 4000];

export interface Sent {
  choice: string;
  request: ControlResult;
  /** "pending" while the server is asked; null once it has shown nothing. */
  verdict: Verdict | "pending" | null;
}

export interface Answering {
  post(choice: string): Promise<ControlResult>;
  read(): Promise<DisputeEscalation[] | null>;
  wait(ms: number): Promise<void>;
  /** False once whoever asked is gone: nothing more is reported. */
  alive(): boolean;
}

export const failed = (error: unknown): ControlResult => ({
  ok: false,
  status: 0,
  detail: error instanceof Error ? error.message : String(error),
});

/** Send ``choice`` for escalation ``id`` and report how it went: the server's own words for the request, then (when it was
 * taken) the owner's verdict on it, read back from the disputes. ``seen`` is the last answer the caller had already seen. */
export async function sendAnswer(how: Answering, id: string, choice: string, seen: number, report: (sent: Sent) => void): Promise<void> {
  const request = await how.post(choice).catch(failed);
  if (!how.alive()) return;
  report({ choice, request, verdict: request.ok ? "pending" : null });
  if (!request.ok) return;
  for (const delay of READ_BACK_MS) {
    await how.wait(delay);
    if (!how.alive()) return;
    const found = await how.read().catch(() => null);
    if (found === null) break; // a server that does not offer the view, or does not answer
    const verdict = verdictAfter(found.find((escalation) => escalation.id === id), seen);
    if (verdict) {
      report({ choice, request, verdict });
      return;
    }
  }
  report({ choice, request, verdict: null });
}
