// data/manifest.json: what the static showcase holds and where. scripts/build_static_site.py writes it at build
// time, the page reads it once when it starts, and every answer the shim gives comes from it or from a file it names.
//
//   global                 the routes that belong to no run: runs, capabilities, pairs, bench/results, bench/honesty
//   runs[id].routes        a run's read routes: summary, feasibility, takeover, recovery, metrics, calls, models,
//                          disputes, and the replay check (`verify`) done at build time
//   runs[id].events        the log in pages of `site.page_size`; the page files are the API's own answers
//   runs[id].calls         every call in full, in one file, keyed by effect id
//
// An entry is a status and, for a 200, a body: small ones sit in the manifest (one request less), large ones in a file.

import { asRecord } from "../lib/generic";

export const MANIFEST_FORMAT = 1;

/** A file under data/ and its size in bytes, which is what the load bar counts against. */
export interface FileRef {
  file: string;
  bytes: number;
}

export interface Entry {
  status: number;
  /** The answer itself, when it is small. */
  body?: unknown;
  /** Else the file that holds it. */
  file?: string;
  bytes?: number;
}

export interface RunData {
  events: { last_seq: number; pages: FileRef[] };
  routes: Record<string, Entry>;
  /** Absent when the run made no LLM call. */
  calls?: FileRef & { ids: string[] };
}

/** What the site was built from, and when: the replay checks in it were done then, by the build. */
export interface SiteStamp {
  commit: string;
  commit_short: string;
  dirty: boolean;
  built_at: string;
  generator: string;
  page_size: number;
}

export interface Manifest {
  format: number;
  site: SiteStamp;
  global: Record<string, Entry>;
  runs: Record<string, RunData>;
}

const fail = (path: string, why: string): never => {
  throw new Error(`data/manifest.json: ${path} ${why}`);
};

function text(value: unknown, path: string): string {
  return typeof value === "string" ? value : fail(path, "is not a string");
}

function count(value: unknown, path: string): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fail(path, "is not a whole number");
}

function readFile(raw: Record<string, unknown>, path: string): FileRef {
  return { file: text(raw.file, `${path}.file`), bytes: count(raw.bytes, `${path}.bytes`) };
}

function readEntry(value: unknown, path: string): Entry {
  const raw = asRecord(value);
  const status = count(raw.status, `${path}.status`);
  if (status < 100 || status > 599) fail(`${path}.status`, "is not an HTTP status");
  if ("body" in raw) return { status, body: raw.body };
  return { status, ...readFile(raw, path) };
}

function readEntries(value: unknown, path: string): Record<string, Entry> {
  return Object.fromEntries(Object.entries(asRecord(value)).map(([key, entry]) => [key, readEntry(entry, `${path}.${key}`)]));
}

function readRun(id: string, value: unknown): RunData {
  const path = `runs.${id}`;
  const raw = asRecord(value);
  const events = asRecord(raw.events);
  const pages = Array.isArray(events.pages) ? events.pages : fail(`${path}.events.pages`, "is not a list");
  const run: RunData = {
    events: {
      last_seq: count(events.last_seq, `${path}.events.last_seq`),
      pages: (pages as unknown[]).map((page, i) => readFile(asRecord(page), `${path}.events.pages[${i}]`)),
    },
    routes: readEntries(raw.routes, `${path}.routes`),
  };
  for (const route of ["summary", "verify"]) if (!(route in run.routes)) fail(`${path}.routes`, `has no ${route}`);
  if (raw.calls !== undefined) {
    const calls = asRecord(raw.calls);
    if (!Array.isArray(calls.ids)) fail(`${path}.calls.ids`, "is not a list");
    run.calls = { ...readFile(calls, `${path}.calls`), ids: (calls.ids as unknown[]).map((id_, i) => text(id_, `${path}.calls.ids[${i}]`)) };
  }
  return run;
}

function readSite(value: unknown): SiteStamp {
  const raw = asRecord(value);
  return {
    commit: text(raw.commit, "site.commit"),
    commit_short: text(raw.commit_short, "site.commit_short"),
    dirty: raw.dirty === true,
    built_at: text(raw.built_at, "site.built_at"),
    generator: text(raw.generator, "site.generator"),
    page_size: count(raw.page_size, "site.page_size") || fail("site.page_size", "is zero"),
  };
}

/** Read the manifest, or throw saying which field is wrong. A page built from one version of the exporter and
 * shipped with data from another would otherwise fail somewhere far from the cause. */
export function readManifest(raw: unknown): Manifest {
  const top = asRecord(raw);
  if (top.format !== MANIFEST_FORMAT) {
    fail("format", `is ${String(top.format)}, but this page reads format ${MANIFEST_FORMAT}: rebuild the site`);
  }
  const runs = Object.fromEntries(Object.entries(asRecord(top.runs)).map(([id, run]) => [id, readRun(id, run)]));
  const global = readEntries(top.global, "global");
  for (const key of ["runs", "capabilities", "pairs", "bench/results", "bench/honesty"]) {
    if (!(key in global)) fail("global", `has no ${key}`);
  }
  return { format: MANIFEST_FORMAT, site: readSite(top.site), global, runs };
}
