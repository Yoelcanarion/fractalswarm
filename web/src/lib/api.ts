// The HTTP and WebSocket client for the FractalSwarm API (src/fractalswarm/api).

import { DEFAULT_CAPABILITIES, parseCapabilities, type Capabilities } from "./controls";
import { readCallDetail, readCalls, readMeter, type CallDetail, type CallsResponse, type Meter } from "./lens";
import { readTakeover, type TakeoverSummary } from "./takeover";
import type { RunEvent, RunListing, VerifyReport } from "./types";

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { error?: string; detail?: string }).detail ?? (body as { error?: string }).error;
    throw new Error(message ?? `${response.status} ${response.statusText}`);
  }
  return body as T;
}

export const listRuns = () => fetch("api/runs").then((r) => json<RunListing[]>(r));

/** What the server can do (`GET api/capabilities`). A server without the endpoint offers the
 * controls that predate it and nothing else. */
export async function fetchCapabilities(): Promise<Capabilities> {
  const response = await fetch("api/capabilities");
  if (!response.ok) return DEFAULT_CAPABILITIES;
  return parseCapabilities(await response.json().catch(() => ({})));
}

export async function loadAllEvents(runId: string, fromSeq = 1): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  let next = fromSeq;
  for (;;) {
    const page = await fetch(`api/runs/${encodeURIComponent(runId)}/events?from_seq=${next}&limit=5000`).then(
      (r) => json<{ events: RunEvent[]; next_seq: number; done: boolean }>(r),
    );
    events.push(...page.events);
    if (page.done || page.events.length === 0) return events;
    next = page.next_seq;
  }
}

// The server refuses a POST that is not JSON (415), even one with no body, so every POST says so and sends {}.
const JSON_POST = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" } as const;

export const verifyRun = (runId: string) =>
  fetch(`api/runs/${encodeURIComponent(runId)}/verify`, JSON_POST).then((r) => json<VerifyReport>(r));

/** The takeover check of a finished run. Null when the server does not expose it (404, 405 or 501) or
 * the run has not completed (409), which the chip takes to mean "show nothing". */
export async function fetchTakeover(runId: string): Promise<TakeoverSummary | null> {
  const response = await fetch(`api/runs/${encodeURIComponent(runId)}/takeover`);
  if ([404, 405, 409, 501].includes(response.status)) return null;
  const report = readTakeover(await json<unknown>(response));
  if (!report) throw new Error("the server sent a takeover report without a verdict");
  return report;
}

// ---- the Muse lens (api/lens.py) ----
// A server without the routes answers 404 for a run it lists. The lens treats that as "not offered"
// (null), as opposed to a failure, so an older server shows no meter instead of an error.

const runUrl = (runId: string, path: string) => `api/runs/${encodeURIComponent(runId)}/${path}`;

/** Every LLM call of a run, in the order they started. */
export async function fetchCalls(runId: string): Promise<CallsResponse | null> {
  const response = await fetch(runUrl(runId, "calls"));
  if (response.status === 404) return null;
  const body = await json<unknown>(response);
  return Array.isArray((body as { calls?: unknown })?.calls) ? readCalls(body) : null;
}

/** The Muse meter of a whole run: $ and tokens by model, cache share, coordination tokens. */
export async function fetchMeter(runId: string): Promise<Meter | null> {
  const response = await fetch(runUrl(runId, "models"));
  if (response.status === 404) return null;
  return readMeter(await json<unknown>(response));
}

/** One call in full: its prompt, its answer, the facts it published next to their sources. */
export async function fetchCallDetail(runId: string, effectId: string): Promise<CallDetail> {
  const detail = readCallDetail(await fetch(runUrl(runId, `calls/${encodeURIComponent(effectId)}`)).then((r) => json<unknown>(r)));
  if (!detail) throw new Error(`the server sent no call ${effectId}`);
  return detail;
}

export const benchResults = () =>
  fetch("api/bench/results").then((r) => json<{ source: string; fixture: boolean; data: unknown }>(r));

export interface ControlResult {
  ok: boolean;
  status: number;
  detail: string;
}

/** POST a control action (chaos, halt, ...). The server answers 501 until the runtime is wired. */
export async function postControl(path: string, body: unknown): Promise<ControlResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
  return {
    ok: response.ok,
    status: response.status,
    detail: payload.detail ?? payload.error ?? response.statusText,
  };
}

/** Tail a run's events over the WebSocket (no pacing: the UI paces playback itself). */
export function tailEvents(
  runId: string,
  fromSeq: number,
  onEvents: (events: RunEvent[]) => void,
  onEnd: () => void,
): () => void {
  const url = new URL(`api/runs/${encodeURIComponent(runId)}/events`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("from_seq", String(fromSeq));
  url.searchParams.set("pace", "none");
  const socket = new WebSocket(url);
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data as string);
    if (data.kind === "events") onEvents(data.events as RunEvent[]);
    if (data.kind === "end" || data.kind === "error") onEnd();
  };
  socket.onclose = () => onEnd();
  return () => socket.close();
}
