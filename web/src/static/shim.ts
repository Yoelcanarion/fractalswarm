// The fetch shim of the static showcase. The app calls relative `api/...` URLs from several modules (lib/api.ts,
// arena/api.ts, intake/api.ts, arena/helps/load.ts); on a static site there is no server behind them. This answers
// those calls from the files scripts/build_static_site.py exported, which are what the real API answered, and
// passes every other URL (fonts, assets) to the browser's own fetch. No component changes.
//
// A route it cannot answer returns what the local server returns for a feature that is off (see answers.ts), so the
// fallbacks the app already has do the rest.

import type { VerifyReport } from "../lib/types";
import {
  JSON_HEADERS,
  jsonResponse,
  methodNotAllowed,
  missingFile,
  needsServer,
  notFound,
  notLive,
  refusal,
  unknownCall,
  unknownRun,
} from "./answers";
import { checkChain, withOneDigitChanged } from "./chain";
import { composeAnswer, isWholePage, pagesFor, readPaging } from "./events";
import type { Entry, Manifest, RunData } from "./manifest";
import type { LoadProgress } from "./progress";

export interface ShimOptions {
  manifest: Manifest;
  /** The document's URL (`document.baseURI`): the page's relative `api/...` calls resolve against it, wherever the site is hosted. */
  base: string | URL;
  /** One file under data/. A Response, so that a large log can be read as it arrives. */
  load: (file: string, signal?: AbortSignal | null) => Promise<Response>;
  /** The browser's own fetch, for every URL that is not an `api/` call. */
  passthrough: typeof fetch;
  onProgress?: (progress: LoadProgress) => void;
}

/** The query of `GET api/runs/{id}/calls` that picks rows (api/lens.py `calls`). */
const CALL_FILTERS = ["role", "status", "actor", "model", "purpose"] as const;
/** Read routes of a run that are one entry of the manifest. */
const READ_ROUTES = new Set(["feasibility", "takeover", "recovery", "metrics", "models", "disputes"]);
/** POST routes that act on a live run. */
const CONTROLS = new Set(["chaos", "approve", "budget", "halt"]);
/** Feature families that need a server to run anything; the value says what is not offered. */
const SERVER_ONLY: Readonly<Record<string, string>> = {
  tasks: "Starting a run",
  arena: "Starting a pair",
  intake: "Reading pasted text",
  jobs: "The job list",
  ablation: "An ablation",
};

interface Call {
  method: string;
  /** The path after `api/`, decoded, one item per segment. */
  segments: string[];
  query: URLSearchParams;
  signal: AbortSignal | null;
}

const has = (record: object, key: string): boolean => Object.hasOwn(record, key);

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** Read a body, telling `onBytes` how much has arrived so far. */
async function readText(response: Response, onBytes?: (bytes: number) => void): Promise<string> {
  if (onBytes === undefined || response.body === null) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    onBytes(bytes);
  }
}

/** Keep what `make` resolves to, but not a failure: a Response can be read only once, and a file that failed to load
 * should be tried again. */
function memo<T>(cache: Map<string, Promise<T | Response>>, key: string, make: () => Promise<T | Response>): Promise<T | Response> {
  const kept = cache.get(key);
  if (kept !== undefined) return kept;
  const made = make();
  cache.set(key, made);
  made.then(
    (result) => result instanceof Response && cache.delete(key),
    () => cache.delete(key),
  );
  return made;
}

export function createStaticFetch(options: ShimOptions): typeof fetch {
  const { manifest, load, passthrough, onProgress } = options;
  const base = new URL(options.base);
  const apiBase = new URL("api/", base);
  const known = Object.keys(manifest.runs);
  const pageEvents = new Map<string, Promise<readonly unknown[] | Response>>();
  const callDetails = new Map<string, Promise<Record<string, unknown> | Response>>();
  const edgeAnswers = new Map<string, Promise<Record<string, unknown> | Response>>();

  /** The text of a file under data/, or the Response that says it is missing. */
  async function fileText(file: string, signal: AbortSignal | null, onBytes?: (bytes: number) => void): Promise<string | Response> {
    const loaded = await load(file, signal);
    return loaded.ok ? readText(loaded, onBytes) : missingFile(file, loaded.status);
  }

  /** One entry of the manifest as the response it stands for. */
  async function respond(entry: Entry | undefined, signal: AbortSignal | null): Promise<Response> {
    if (entry === undefined) return notFound("this route");
    if (entry.body !== undefined) return jsonResponse(entry.status, entry.body);
    const text = await fileText(entry.file ?? "", signal);
    return typeof text === "string" ? new Response(text, { status: entry.status, headers: JSON_HEADERS }) : text;
  }

  /** The report the build stored, with what this browser finds when it recomputes the log's hashes from the page files themselves. */
  async function recompute(run: RunData, changed: boolean, signal: AbortSignal | null): Promise<Response> {
    const stored = await respond(run.routes.verify, signal);
    if (!stored.ok) return stored;
    const report = (await stored.json()) as VerifyReport;
    const pages: string[] = [];
    for (const { file } of run.events.pages) {
      const text = await fileText(file, signal);
      if (typeof text !== "string") return text;
      pages.push(text);
    }
    const started = performance.now();
    const chain = await checkChain(changed ? withOneDigitChanged(pages) : pages);
    const ms = performance.now() - started;
    return jsonResponse(200, { ...report, here: { ...chain, ok: chain.ok && chain.head === report.recorded_head && chain.events === report.recorded_events, ms, changed } });
  }

  /** A request for exactly page file `index`: the file, as it is, while telling the load bar how far it has come. */
  async function wholePage(runId: string, run: RunData, index: number, signal: AbortSignal | null): Promise<Response> {
    const { pages } = run.events;
    const before = pages.slice(0, index).reduce((sum, page) => sum + page.bytes, 0);
    const total = pages.reduce((sum, page) => sum + page.bytes, 0);
    const report = (bytes: number): void => onProgress?.({ runId, loaded: before + bytes, total });
    report(0);
    try {
      const text = await fileText(pages[index].file, signal, report);
      if (typeof text !== "string") return text;
      return new Response(text, { status: 200, headers: JSON_HEADERS });
    } finally {
      report(pages[index].bytes); // done, or given up: the bar does not wait for a page that will not come
    }
  }

  function eventsOfPage(runId: string, run: RunData, index: number, signal: AbortSignal | null): Promise<readonly unknown[] | Response> {
    return memo(pageEvents, `${runId}#${index}`, async () => {
      const text = await fileText(run.events.pages[index].file, signal);
      return typeof text === "string" ? (JSON.parse(text) as { events: unknown[] }).events : text;
    });
  }

  /** The answer for the first or the last event alone, from the run's small file of them: undefined when the file does
   * not hold it (or did not load), and the request is then answered from the pages, which gives the same answer. */
  async function edgeAnswer(runId: string, run: RunData, from: number, signal: AbortSignal | null): Promise<unknown> {
    const { edges } = run.events;
    if (edges === undefined || !edges.seqs.includes(from)) return undefined;
    const all = await memo(edgeAnswers, runId, async () => {
      const text = await fileText(edges.file, signal);
      return typeof text === "string" ? (JSON.parse(text) as Record<string, unknown>) : text;
    });
    return all instanceof Response ? undefined : all[String(from)];
  }

  async function eventsRoute(runId: string, run: RunData, query: URLSearchParams, signal: AbortSignal | null): Promise<Response> {
    const paging = readPaging(query);
    if ("error" in paging) return refusal(422, paging.error);
    if (paging.limit === 1) {
      const edge = await edgeAnswer(runId, run, paging.from, signal);
      if (edge !== undefined) return jsonResponse(200, edge);
    }
    const size = manifest.site.page_size;
    const whole = (paging.from - 1) / size;
    if (isWholePage(paging, size) && run.events.pages[whole] !== undefined) return wholePage(runId, run, whole, signal);
    const pages = new Map<number, readonly unknown[]>();
    for (const index of pagesFor(paging, size, run.events.last_seq)) {
      const events = await eventsOfPage(runId, run, index, signal);
      if (events instanceof Response) return events;
      pages.set(index, events);
    }
    return jsonResponse(200, composeAnswer(paging, size, run.events.last_seq, pages));
  }

  async function callsRoute(run: RunData, query: URLSearchParams, signal: AbortSignal | null): Promise<Response> {
    const answer = await respond(run.routes.calls, signal);
    // Starlette keeps the last of a repeated parameter; so does this.
    const wanted = CALL_FILTERS.flatMap((name) => (query.has(name) ? [[name, query.getAll(name).at(-1)] as const] : []));
    if (wanted.length === 0 || !answer.ok) return answer;
    const body = (await answer.json()) as { calls: Record<string, unknown>[] };
    const calls = body.calls.filter((row) => wanted.every(([name, value]) => row[name] === value));
    return jsonResponse(200, { ...body, count: calls.length, calls });
  }

  async function callRoute(runId: string, run: RunData, effectId: string, signal: AbortSignal | null): Promise<Response> {
    const { calls } = run;
    if (calls === undefined || !calls.ids.includes(effectId)) return unknownCall(effectId, runId);
    const all = await memo(callDetails, runId, async () => {
      const text = await fileText(calls.file, signal);
      return typeof text === "string" ? (JSON.parse(text) as Record<string, unknown>) : text;
    });
    return all instanceof Response ? all : jsonResponse(200, all[effectId]);
  }

  function runsRoute({ method, segments, query, signal }: Call): Promise<Response> | Response {
    const [, runId, name, extra, ...more] = segments;
    if (runId === undefined) return method === "GET" ? respond(manifest.global.runs, signal) : methodNotAllowed();
    if (!has(manifest.runs, runId)) return unknownRun(runId, known);
    const run = manifest.runs[runId];
    const only = (verb: string, answer: () => Promise<Response> | Response) => (method === verb ? answer() : methodNotAllowed());
    if (name === undefined) return only("GET", () => respond(run.routes.summary, signal));
    if (extra === undefined) {
      if (name === "events") return only("GET", () => eventsRoute(runId, run, query, signal));
      if (name === "verify") return only("POST", () => (query.has("here") ? recompute(run, query.get("here") === "changed", signal) : respond(run.routes.verify, signal)));
      if (name === "calls") return only("GET", () => callsRoute(run, query, signal));
      if (READ_ROUTES.has(name)) return only("GET", () => respond(run.routes[name], signal));
      if (CONTROLS.has(name)) return only("POST", () => notLive("run", runId));
    } else if (more.length === 0) {
      if (name === "calls") return only("GET", () => callRoute(runId, run, extra, signal));
      if (name === "escalations") return only("POST", () => notLive("run", runId));
    }
    return notFound(segments.join("/"));
  }

  function answer(call: Call): Promise<Response> | Response {
    const { method, segments, signal } = call;
    const [head, second] = segments;
    if (head === "runs") return runsRoute(call);
    if (segments.length === 1 && (head === "capabilities" || head === "pairs")) {
      return method === "GET" ? respond(manifest.global[head], signal) : methodNotAllowed();
    }
    if (head === "bench" && segments.length === 2 && (second === "results" || second === "honesty")) {
      return method === "GET" ? respond(manifest.global[`bench/${second}`], signal) : methodNotAllowed();
    }
    if (head !== undefined && has(SERVER_ONLY, head)) return needsServer(SERVER_ONLY[head]);
    return notFound(segments.join("/"));
  }

  /** The call behind a fetch, or null when the URL is not an `api/` call of this site. */
  function describe(input: RequestInfo | URL, init?: RequestInit): Call | null {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const url = new URL(request === null ? String(input) : request.url, base);
    if (url.origin !== apiBase.origin || !url.pathname.startsWith(apiBase.pathname)) return null;
    const rest = url.pathname.slice(apiBase.pathname.length);
    return {
      method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
      segments: rest === "" ? [] : rest.split("/").filter((part) => part !== "").map(decode),
      query: url.searchParams,
      signal: init?.signal ?? request?.signal ?? null,
    };
  }

  return async function staticFetch(input, init) {
    const call = describe(input, init);
    if (call === null) return passthrough(input, init);
    if (call.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    return answer(call);
  };
}
