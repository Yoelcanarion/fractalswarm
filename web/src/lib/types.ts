// The event envelope as the API sends it (spec §5.1; src/fractalswarm/kernel/events.py).
import type { RunStatus } from "./controls";

export interface RunEvent {
  seq: number;
  run_id: string;
  ts_virtual: number; // virtual milliseconds
  lamport: number;
  member_epoch: number;
  market_epoch: number;
  type: string;
  actor: string;
  causation_id: number | null;
  correlation_id: string | null;
  idem_key: string;
  payload: Record<string, any>;
  prev_hash: string;
  hash: string;
}

export interface RunListing {
  id: string;
  source: "runs" | "demo" | "private";
  run_id: string | null;
  scenario: string | null;
  seed: string | null;
  clock: string | null;
  events: number;
  duration_ms: number;
  /** The catalog's status; servers that predate `halted` and `interrupted` never send them. */
  status: RunStatus;
  head: string | null;
}

export interface VerifyReport {
  ok: boolean;
  chain_ok: boolean;
  recorded_events: number;
  replayed_events: number;
  recorded_head: string;
  replayed_head: string;
  first_divergence: number | null;
  detail: string;
  bundle_head: string | null;
  bundle_head_ok: boolean;
  /** The static showcase only, when asked: what this browser found when it recomputed the log's hash chain itself. */
  here?: ChainHere;
}

export interface ChainHere {
  /** The chain holds, and it reaches the head stored with the run. */
  ok: boolean;
  events: number;
  head: string;
  brokenAt: number | null;
  ms: number;
}
