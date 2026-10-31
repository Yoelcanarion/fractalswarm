// The arena's calls to the API: the pairs on record (`GET api/pairs`, api/arena.py) and the official
// numbers of a run (`GET api/runs/{id}/metrics`). Both answer "not offered" with null rather than
// throwing, so an older server shows an arena without them instead of an error.

import { asNumber, asRecord, asString } from "../lib/generic";
import { readOfficial, type Official } from "./official";
import { readRecoveryReport, type ServerRecovery } from "./recovery";

export interface PairListing {
  pairId: string;
  label: string;
  /** Run ids: the swarm on the left, its rival on the right. */
  left: string;
  right: string;
  rival: string;
  /** The failure plan's name and how many actions it holds. */
  chaos: string;
  actions: number | null;
  seed: string | null;
  state: string;
  /** Built on live input: private, and never bundled. */
  private: boolean;
  billed: boolean;
  createdAt: string | null;
}

/** Read the body of `GET api/pairs`: the pairs it can use (both runs named), newest first as sent. */
export function readPairs(body: unknown): PairListing[] {
  if (!Array.isArray(body)) return [];
  const pairs: PairListing[] = [];
  for (const item of body) {
    const p = asRecord(item);
    const left = asString(asRecord(p.left).run_id);
    const right = asString(asRecord(p.right).run_id);
    if (!left || !right) continue;
    const chaos = asRecord(p.chaos);
    pairs.push({
      pairId: asString(p.pair_id, `${left}+${right}`),
      label: asString(p.label, `${left} vs ${right}`),
      left,
      right,
      rival: asString(p.rival, asString(asRecord(p.right).scenario)),
      chaos: asString(chaos.name),
      actions: asNumber(chaos.actions),
      seed: p.seed === undefined || p.seed === null ? null : String(p.seed),
      state: asString(p.state, "completed"),
      private: p.private === true,
      billed: p.billed === true,
      createdAt: typeof p.created_at === "string" ? p.created_at : null,
    });
  }
  return pairs;
}

export async function fetchPairs(): Promise<PairListing[]> {
  const response = await fetch("api/pairs");
  if (!response.ok) return [];
  return readPairs(await response.json().catch(() => []));
}

/** The scored numbers of a run, or null when the server has none to give (an unknown run, an older
 * server). The server scores the log it has, so this waits for a run still recording to end (`whenSettled`). */
export async function fetchOfficial(runId: string): Promise<Official | null> {
  const response = await fetch(`api/runs/${encodeURIComponent(runId)}/metrics`);
  if (!response.ok) return null;
  return readOfficial(await response.json().catch(() => null));
}

/** The server's scored recovery report of a finished run (verify/recovery.py), or null when it has none to
 * give: an older server (404, 405, 501), a run that has not completed (409) or a body that is not a report. */
export async function fetchRecovery(runId: string): Promise<ServerRecovery | null> {
  const response = await fetch(`api/runs/${encodeURIComponent(runId)}/recovery`);
  if (!response.ok) return null;
  return readRecoveryReport(await response.json().catch(() => null));
}
