// The HTTP and WebSocket client for the FractalSwarm API (src/fractalswarm/api).

import { DEFAULT_CAPABILITIES, parseCapabilities, type Capabilities } from "./controls";
import { readDisputes, type DisputeEscalation } from "./disputes";
import { readCallDetail, readCalls, readMeter, type CallDetail, type CallsResponse, type Meter } from "./lens";
import { readTakeover, type TakeoverSummary } from "./takeover";
import type { TaskLaunch } from "./taskspec";
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

async function postJson(path: string, body: unknown): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload: payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {} };
}

/** The server's own reason for a refusal: `{error}` (the API's `http_error`) or `{detail}`, which is a
 * string, or a list of `{loc, msg}` when FastAPI itself refused the body. */
function reasonOf(payload: Record<string, unknown>, fallback: string): string {
  const { detail, error } = payload;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const reasons = detail.flatMap((item) => {
      const { loc, msg } = (item ?? {}) as { loc?: unknown; msg?: unknown };
      if (typeof msg !== "string") return [];
      return [Array.isArray(loc) && loc.length > 0 ? `${loc.filter((part) => part !== "body").join(".")}: ${msg}` : msg];
    });
    if (reasons.length > 0) return reasons.join("; ");
  }
  return typeof error === "string" ? error : fallback;
}

/** POST a control action (chaos, approve, halt, ...). A refusal comes back as `{ok: false}` with the
 * server's own reason in `detail`: 422 for a body it cannot take (an `api_storm` on a live run, say), 409
 * for a run that cannot take controls (a recording, or one the API did not launch). */
export async function postControl(path: string, body: unknown): Promise<ControlResult> {
  const { response, payload } = await postJson(path, body);
  return { ok: response.ok, status: response.status, detail: reasonOf(payload, response.statusText) };
}

/** What a person decided for an escalation that waits for one (`POST api/runs/{id}/escalations/{eid}`). The server only
 * *requests* the answer: the goal's owner takes it or ignores it, and the verdict lands in the log (`fetchDisputes`). A refusal
 * is the server's own words: 409 for a run that was not launched to take controls, 422 for a choice or id it cannot take. */
export const answerEscalation = (runId: string, escalationId: string, choice: string) =>
  postControl(`api/runs/${encodeURIComponent(runId)}/escalations/${encodeURIComponent(escalationId)}`, { choice });

/** The escalations of a run as the server reads them from its log. Null when the server does not offer them (404). */
export async function fetchDisputes(runId: string): Promise<DisputeEscalation[] | null> {
  const response = await fetch(runUrl(runId, "disputes"));
  if (response.status === 404) return null;
  return readDisputes(await json<unknown>(response));
}

export interface LaunchResult extends ControlResult {
  /** The run the job started and the job that runs it; null when the server refused. */
  runId: string | null;
  jobId: string | null;
  /** What the server warned about at launch (a busy CPU on a live clock, say). */
  warnings: string[];
}

/** Start a fake-LLM run (`POST api/tasks`, 202). The refusals carry the server's reason: 422 for a spec or
 * an input it cannot take, 409 for a used run id or an intake with no approved input, 429 at 8 active jobs,
 * 503 where the server has no private directory. */
export async function launchTask(body: TaskLaunch): Promise<LaunchResult> {
  const { response, payload } = await postJson("api/tasks", body);
  const runId = response.ok && typeof payload.run_id === "string" ? payload.run_id : null;
  const jobId = response.ok && typeof payload.job_id === "string" ? payload.job_id : null;
  const warnings = response.ok && Array.isArray(payload.warnings) ? payload.warnings.filter((w): w is string => typeof w === "string") : [];
  return {
    ok: response.ok,
    status: response.status,
    detail: runId !== null ? `Started run ${runId}.` : reasonOf(payload, response.statusText),
    runId,
    jobId,
    warnings,
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
