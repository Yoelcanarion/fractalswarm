// Rate limits (spec §6.1, §7.1): what the model endpoint said about its quota, as a fold over the
// LLM effects.
//
//   effect.started   (kind llm)   a request left; counted against the last minute of virtual time
//   effect.completed (kind llm)   result {model, http_status, attempts, retry_after_ms, latency_ms,
//                                 rate_limits: {limit_requests, limit_tokens,
//                                               remaining_requests, remaining_tokens}}
//
//   market.quota     {goal_id, epoch, model, change, fraction, limit_rpm, limit_tpm, rpm, tpm, pressure}
//                    the run's AIMD share of a model's limit, once per epoch (spec §6.1; market/quotas.py):
//                    change is init | decrease (x0.7 after a 429) | increase (+5 points) | hold
//
// Other quota families that land later (quota.*, aimd.*, ...) show as generic rows.

import { claimedBy } from "./families";
import {
  appendCapped,
  asNumber,
  asRecord,
  asString,
  GENERIC_CAP,
  genericEntry,
  type GenericEntry,
} from "./generic";
import type { RunEvent } from "./types";

export const RPM_WINDOW_MS = 60_000;
const HISTORY_POINTS = 400;

export interface ModelLimits {
  model: string;
  calls: number;
  limitRequests: number | null;
  remainingRequests: number | null;
  limitTokens: number | null;
  remainingTokens: number | null;
  throttled: number; // calls whose final answer was a 429
  failed: number; // final answer 5xx or a transport error (status 0)
  retries: number; // attempts beyond the first, summed
  retryAfterMs: number | null;
  latencyMs: number; // summed, for the mean
  lastSeq: number;
}

export interface RateSample {
  ts: number;
  rpm: number;
}

/** The run's AIMD share of one model's provider limit, as of the latest epoch. */
export interface Quota {
  model: string;
  epoch: number;
  change: string;
  fraction: number | null; // 0..1 of the provider limit
  limitRpm: number | null;
  limitTpm: number | null;
  rpm: number | null; // the slice granted
  tpm: number | null;
  pressure: boolean;
  decreases: number;
  increases: number;
  ts: number;
}

export interface LimitsState {
  models: Record<string, ModelLimits>;
  order: string[];
  quotas: Record<string, Quota>;
  quotaOrder: string[];
  starts: number[]; // virtual ms of LLM requests inside the window
  inflight: number;
  peakInflight: number;
  requests: number;
  history: RateSample[];
  other: GenericEntry[];
}

export const emptyLimits = (): LimitsState => ({
  models: {},
  order: [],
  quotas: {},
  quotaOrder: [],
  starts: [],
  inflight: 0,
  peakInflight: 0,
  requests: 0,
  history: [],
  other: [],
});

const blank = (model: string, seq: number): ModelLimits => ({
  model,
  calls: 0,
  limitRequests: null,
  remainingRequests: null,
  limitTokens: null,
  remainingTokens: null,
  throttled: 0,
  failed: 0,
  retries: 0,
  retryAfterMs: null,
  latencyMs: 0,
  lastSeq: seq,
});

export function foldLimits(state: LimitsState, event: RunEvent): LimitsState {
  const p = event.payload;
  switch (event.type) {
    case "market.quota": {
      const model = asString(p.model);
      if (!model) return state;
      const known = state.quotas[model];
      const change = asString(p.change);
      const quota: Quota = {
        model,
        epoch: asNumber(p.epoch) ?? 0,
        change,
        fraction: asNumber(p.fraction),
        limitRpm: asNumber(p.limit_rpm),
        limitTpm: asNumber(p.limit_tpm),
        rpm: asNumber(p.rpm),
        tpm: asNumber(p.tpm),
        pressure: Boolean(p.pressure),
        decreases: (known?.decreases ?? 0) + (change === "decrease" ? 1 : 0),
        increases: (known?.increases ?? 0) + (change === "increase" ? 1 : 0),
        ts: event.ts_virtual,
      };
      return { ...state, quotas: { ...state.quotas, [model]: quota }, quotaOrder: known ? state.quotaOrder : [...state.quotaOrder, model] };
    }
    case "effect.started": {
      if (p.kind !== "llm") return state;
      const cutoff = event.ts_virtual - RPM_WINDOW_MS;
      const starts = [...state.starts.filter((at) => at > cutoff), event.ts_virtual];
      const inflight = state.inflight + 1;
      const history = appendCapped(state.history, { ts: event.ts_virtual, rpm: starts.length }, HISTORY_POINTS);
      return {
        ...state,
        starts,
        inflight,
        peakInflight: Math.max(state.peakInflight, inflight),
        requests: state.requests + 1,
        history,
      };
    }
    case "effect.cancelled":
      return p.kind === "llm" ? { ...state, inflight: Math.max(state.inflight - 1, 0) } : state;
    case "effect.completed": {
      if (p.kind !== "llm") return state;
      const settled = { ...state, inflight: Math.max(state.inflight - 1, 0) };
      const result = asRecord(p.result);
      const model = asString(result.model);
      if (!model) return settled; // refused before it left: the endpoint said nothing
      const row = state.models[model] ?? blank(model, event.seq);
      const limits = asRecord(result.rate_limits);
      const status = asNumber(result.http_status) ?? 0;
      const attempts = asNumber(result.attempts) ?? 1;
      const next: ModelLimits = {
        ...row,
        calls: row.calls + 1,
        limitRequests: asNumber(limits.limit_requests) ?? row.limitRequests,
        remainingRequests: asNumber(limits.remaining_requests) ?? row.remainingRequests,
        limitTokens: asNumber(limits.limit_tokens) ?? row.limitTokens,
        remainingTokens: asNumber(limits.remaining_tokens) ?? row.remainingTokens,
        throttled: row.throttled + (status === 429 ? 1 : 0),
        failed: row.failed + (status === 0 || status >= 500 ? 1 : 0),
        retries: row.retries + Math.max(attempts - 1, 0),
        retryAfterMs: asNumber(result.retry_after_ms) ?? row.retryAfterMs,
        latencyMs: row.latencyMs + (asNumber(result.latency_ms) ?? 0),
        lastSeq: event.seq,
      };
      return {
        ...settled,
        models: { ...state.models, [model]: next },
        order: state.order.includes(model) ? state.order : [...state.order, model],
      };
    }
    default:
      if (claimedBy(event.type) === "limits") {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}

/** Requests that left in the last minute of virtual time at ``now``. */
export const requestsPerMinute = (state: LimitsState, now: number): number =>
  state.starts.reduce((count, at) => (now - at < RPM_WINDOW_MS ? count + 1 : count), 0);

/** Share of a quota that is left, 0..1, or null when the endpoint did not report it. */
export const remainingShare = (remaining: number | null, limit: number | null): number | null =>
  remaining === null || limit === null || limit <= 0 ? null : Math.min(Math.max(remaining / limit, 0), 1);
