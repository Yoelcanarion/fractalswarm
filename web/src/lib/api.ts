// The HTTP and WebSocket client for the FractalSwarm API (src/fractalswarm/api).

import { DEFAULT_CAPABILITIES, parseCapabilities, type Capabilities } from "./controls";
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

export const verifyRun = (runId: string) =>
  fetch(`api/runs/${encodeURIComponent(runId)}/verify`, { method: "POST" }).then((r) => json<VerifyReport>(r));

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
