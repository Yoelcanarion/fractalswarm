// A small static site in memory, for the tests of the shim: the manifest the exporter would write, and the files under
// data/ it names. A log of ten events in pages of three, so that a request can fall inside a page, across pages and past
// the end; a second run with no calls. Used by the tests only.

import { MANIFEST_FORMAT, readManifest, type Entry, type Manifest } from "./manifest";
import type { ShimOptions } from "./shim";

/** The document of a site hosted under a sub-path, which is where GitHub Pages puts a project. */
export const BASE = "https://example.github.io/fractalswarm/index.html";
export const PAGE_SIZE = 3;
export const ALPHA = "demo-alpha";
export const BETA = "demo-beta";

export interface Ev {
  seq: number;
  type: string;
}

export const eventsOf = (count: number): Ev[] => Array.from({ length: count }, (_, i) => ({ seq: i + 1, type: `t${i + 1}` }));

/** What `GET api/runs/{id}/events?from_seq=&limit=` answers for a log, worked out independently of the shim. */
export function reference(all: readonly Ev[], from: number, limit: number) {
  const events = all.slice(from - 1, from - 1 + limit);
  const next = events.length === 0 ? from : events[events.length - 1].seq + 1;
  const last = all.length === 0 ? 0 : all[all.length - 1].seq;
  return { events, next_seq: next, last_seq: last, done: next > last };
}

export const CALLS = [
  { effect_id: "e1", role: "worker", status: "ok", actor: "o1", model: "small", purpose: "extract" },
  { effect_id: "e2", role: "orchestrator", status: "ok", actor: "o0", model: "big", purpose: "plan" },
  { effect_id: "e3", role: "worker", status: "failed", actor: "o1", model: "small", purpose: "extract" },
];
export const DETAILS = Object.fromEntries(CALLS.map((call) => [call.effect_id, { ...call, request: `ask ${call.effect_id}` }]));
export const VERIFY = {
  ok: true,
  chain_ok: true,
  recorded_events: 10,
  replayed_events: 10,
  recorded_head: "aaaa",
  replayed_head: "aaaa",
  first_divergence: null,
  detail: "",
  bundle_head: "aaaa",
  bundle_head_ok: true,
  static: { where: "build", commit: "c".repeat(40), commit_short: "c".repeat(12), dirty: false, built_at: "2026-10-30T10:00:00Z" },
};
export const SUMMARY = { id: ALPHA, source: "demo", status: "completed", events: 10 };
export const METRICS = { tokens: 1234, padding: "x".repeat(5000) };

export interface Site {
  manifest: Manifest;
  /** Every file under data/, by name. Delete one to see the shim without it. */
  files: Map<string, string>;
  /** The files asked for, in order. */
  loaded: string[];
  load: ShimOptions["load"];
}

const sizeOf = (text: string): number => new TextEncoder().encode(text).byteLength;

export function makeSite(): Site {
  const files = new Map<string, string>();
  const loaded: string[] = [];
  const put = (file: string, body: unknown): { file: string; bytes: number } => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    files.set(file, text);
    return { file, bytes: sizeOf(text) };
  };
  const inline = (body: unknown, status = 200): Entry => ({ status, body });
  const pagesOf = (id: string, all: readonly Ev[]) =>
    Array.from({ length: Math.ceil(all.length / PAGE_SIZE) }, (_, i) =>
      put(`run/${id}/events-${String(i + 1).padStart(4, "0")}.json`, reference(all, i * PAGE_SIZE + 1, PAGE_SIZE)),
    );
  const alpha = eventsOf(10);
  const beta = eventsOf(2);
  const raw = {
    format: MANIFEST_FORMAT,
    site: {
      commit: "c".repeat(40),
      commit_short: "c".repeat(12),
      dirty: false,
      built_at: "2026-10-30T10:00:00Z",
      generator: "scripts/build_static_site.py",
      page_size: PAGE_SIZE,
    },
    global: {
      runs: inline([SUMMARY, { ...SUMMARY, id: BETA, events: 2 }]),
      capabilities: inline({ chaos: false, approve: false, tasks: false, budget: false, halt: false, real: false, static: true }),
      pairs: inline([]),
      "bench/results": inline({ source: "fixture", fixture: true, data: [] }),
      "bench/honesty": { status: 200, ...put("bench-honesty.json", { rows: [1, 2, 3] }) },
    },
    runs: {
      [ALPHA]: {
        events: { last_seq: 10, pages: pagesOf(ALPHA, alpha) },
        routes: {
          summary: inline(SUMMARY),
          feasibility: inline({ ok: true }),
          takeover: inline({ error: "no takeover in this run" }, 404),
          recovery: inline({ goals: [] }),
          metrics: { status: 200, ...put(`run/${ALPHA}/metrics.json`, METRICS) },
          calls: inline({ count: CALLS.length, calls: CALLS }),
          models: inline({ models: ["small", "big"] }),
          disputes: inline({ escalations: [] }),
          verify: inline(VERIFY),
        },
        calls: { ...put(`run/${ALPHA}/call-details.json`, DETAILS), ids: CALLS.map((call) => call.effect_id) },
      },
      [BETA]: {
        events: { last_seq: 2, pages: pagesOf(BETA, beta) },
        routes: {
          summary: inline({ ...SUMMARY, id: BETA, events: 2 }),
          verify: inline({ ...VERIFY, recorded_events: 2, replayed_events: 2 }),
          takeover: inline({ error: "no takeover in this run" }, 404),
          calls: inline({ count: 0, calls: [] }),
        },
      },
    },
  };
  const load: ShimOptions["load"] = async (file) => {
    loaded.push(file);
    const text = files.get(file);
    return text === undefined ? new Response("not here", { status: 404 }) : new Response(text, { status: 200 });
  };
  return { manifest: readManifest(raw), files, loaded, load };
}

export const passthrough = (): { fetch: typeof fetch; seen: string[] } => {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (input) => {
      seen.push(String(input));
      return new Response("passed through", { status: 200 });
    },
  };
};
