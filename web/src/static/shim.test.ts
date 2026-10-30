import { describe, expect, it } from "vitest";

import { createStaticFetch } from "./shim";
import type { LoadProgress } from "./progress";
import { ALPHA, BASE, BETA, CALLS, DETAILS, eventsOf, makeSite, METRICS, PAGE_SIZE, passthrough, reference, SUMMARY, VERIFY } from "./testing";

/** The shim over the in-memory site, and what it asked of the network. */
function setup() {
  const site = makeSite();
  const pass = passthrough();
  const progress: LoadProgress[] = [];
  const get = createStaticFetch({
    manifest: site.manifest,
    base: BASE,
    load: site.load,
    passthrough: pass.fetch,
    onProgress: (report) => progress.push(report),
  });
  return { ...site, pass, progress, get };
}

const post = (body: unknown = {}): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function answer(response: Promise<Response>) {
  const reply = await response;
  return { status: reply.status, body: (await reply.json()) as unknown };
}

describe("the routes that belong to no run", () => {
  it("lists the runs the site holds", async () => {
    const { get } = setup();
    const reply = await answer(get("api/runs"));
    expect(reply.status).toBe(200);
    expect((reply.body as { id: string }[]).map((run) => run.id)).toEqual([ALPHA, BETA]);
  });

  it("says it is the static showcase, and that nothing live is on offer", async () => {
    const { get } = setup();
    const { body } = await answer(get("api/capabilities"));
    expect(body).toEqual({ chaos: false, approve: false, tasks: false, budget: false, halt: false, real: false, static: true });
  });

  it("answers the pairs, the bench results and the honesty file from the site", async () => {
    const { get, loaded } = setup();
    expect((await answer(get("api/pairs"))).body).toEqual([]);
    expect((await answer(get("api/bench/results"))).body).toMatchObject({ source: "fixture", fixture: true });
    expect((await answer(get("api/bench/honesty"))).body).toEqual({ rows: [1, 2, 3] });
    expect(loaded).toEqual(["bench-honesty.json"]);
  });

  it("answers a request only with the verb the API accepts", async () => {
    const { get } = setup();
    expect(await answer(get("api/runs", post()))).toEqual({ status: 405, body: { error: "Method Not Allowed" } });
    expect((await answer(get("api/capabilities", post()))).status).toBe(405);
    expect((await answer(get("api/bench/results", { method: "DELETE" }))).status).toBe(405);
  });
});

describe("a run's read routes", () => {
  it("answers the summary and the small routes from the manifest, without a request for a file", async () => {
    const { get, loaded } = setup();
    expect((await answer(get(`api/runs/${ALPHA}`))).body).toEqual(SUMMARY);
    expect((await answer(get(`api/runs/${ALPHA}/feasibility`))).body).toEqual({ ok: true });
    expect((await answer(get(`api/runs/${ALPHA}/models`))).body).toEqual({ models: ["small", "big"] });
    expect(loaded).toEqual([]);
  });

  it("reads a large answer from its file, with the status the entry carries", async () => {
    const { get, loaded } = setup();
    expect(await answer(get(`api/runs/${ALPHA}/metrics`))).toEqual({ status: 200, body: METRICS });
    expect(loaded).toEqual([`run/${ALPHA}/metrics.json`]);
  });

  it("answers 404 where the API does, with its reason, so the app's own fallback runs", async () => {
    const { get } = setup();
    expect(await answer(get(`api/runs/${ALPHA}/takeover`))).toEqual({ status: 404, body: { error: "no takeover in this run" } });
  });

  it("answers a run with no entry for a route it never exported by saying it is not part of the showcase", async () => {
    const { get } = setup();
    const { status, body } = await answer(get(`api/runs/${BETA}/metrics`));
    expect(status).toBe(404);
    expect((body as { error: string }).error).toContain("static showcase");
  });

  it("reads a run id the way the browser sends it", async () => {
    const { get } = setup();
    expect((await answer(get(`api/runs/${encodeURIComponent(ALPHA)}`))).status).toBe(200);
    expect((await answer(get("api/runs/demo%2Dalpha"))).status).toBe(200);
  });

  it("names the runs it holds, and how to run the real thing, for a run it does not", async () => {
    const { get } = setup();
    const { status, body } = await answer(get("api/runs/nope/events"));
    expect(status).toBe(404);
    const { error } = body as { error: string };
    expect(error).toContain("no run 'nope'");
    expect(error).toContain(`${ALPHA}, ${BETA}`);
    expect(error).toContain("uv run fractalswarm demo --verify");
  });
});

describe("the replay report", () => {
  it("is the one the build made, as the answer to the verify request", async () => {
    const { get } = setup();
    expect(await answer(get(`api/runs/${ALPHA}/verify`, post()))).toEqual({ status: 200, body: VERIFY });
  });

  it("is a POST, as in the API", async () => {
    const { get } = setup();
    expect((await answer(get(`api/runs/${ALPHA}/verify`))).status).toBe(405);
  });
});

describe("a run's events", () => {
  const ALL = eventsOf(10);

  it("sends a whole page as the file it is, and asks for no other", async () => {
    const { get, loaded, files } = setup();
    const response = await get(`api/runs/${ALPHA}/events?from_seq=4&limit=${PAGE_SIZE}`);
    expect(await response.text()).toBe(files.get(`run/${ALPHA}/events-0002.json`));
    expect(loaded).toEqual([`run/${ALPHA}/events-0002.json`]);
  });

  it("answers every window the way the API does, from the pages it falls in", async () => {
    const { get } = setup();
    for (const [from, limit] of [[1, 5000], [2, 3], [3, 4], [5, 1], [8, 100], [10, 3], [11, 3], [1, 10], [9, 2]]) {
      const { body } = await answer(get(`api/runs/${ALPHA}/events?from_seq=${from}&limit=${limit}`));
      expect(body, `from ${from}, limit ${limit}`).toEqual(reference(ALL, from, limit));
    }
  });

  it("defaults to the whole of a short log, from the first event, as the API does", async () => {
    const { get } = setup();
    expect((await answer(get(`api/runs/${ALPHA}/events`))).body).toEqual(reference(ALL, 1, 1000));
  });

  it("walks a log page by page by next_seq, to the end, as the app loads a run", async () => {
    const { get } = setup();
    const seen: number[] = [];
    for (let next = 1, done = false; !done; ) {
      const page = (await answer(get(`api/runs/${ALPHA}/events?from_seq=${next}&limit=${PAGE_SIZE}`))).body as ReturnType<typeof reference>;
      seen.push(...page.events.map((event) => event.seq));
      ({ next_seq: next, done } = page);
    }
    expect(seen).toEqual(ALL.map((event) => event.seq));
  });

  it.each([
    ["from_seq=0", "from_seq must be in [1, ∞]"],
    ["limit=0", "limit must be in [1, 5000]"],
    ["limit=5001", "limit must be in [1, 5000]"],
    ["from_seq=abc", "from_seq must be an integer"],
  ])("refuses %s with 422 and the API's words", async (query, error) => {
    const { get } = setup();
    expect(await answer(get(`api/runs/${ALPHA}/events?${query}`))).toEqual({ status: 422, body: { error } });
  });

  it("loads a page file once for as many windows as fall in it", async () => {
    const { get, loaded } = setup();
    await get(`api/runs/${ALPHA}/events?from_seq=2&limit=2`);
    await get(`api/runs/${ALPHA}/events?from_seq=3&limit=1`);
    await get(`api/runs/${ALPHA}/events?from_seq=1&limit=2`);
    expect(loaded).toEqual([`run/${ALPHA}/events-0001.json`]);
  });

  it("is a GET, as in the API", async () => {
    const { get } = setup();
    expect((await answer(get(`api/runs/${ALPHA}/events`, post()))).status).toBe(405);
  });
});

describe("loading a log, as the load bar sees it", () => {
  it("reports the bytes read of a run's pages against their total, and ends at the total", async () => {
    const { get, progress, manifest } = setup();
    await get(`api/runs/${ALPHA}/events?from_seq=1&limit=${PAGE_SIZE}`);
    await get(`api/runs/${ALPHA}/events?from_seq=4&limit=${PAGE_SIZE}`);
    const total = manifest.runs[ALPHA].events.pages.reduce((sum, page) => sum + page.bytes, 0);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((report) => report.runId === ALPHA && report.total === total)).toBe(true);
    const first = manifest.runs[ALPHA].events.pages[0].bytes;
    const second = manifest.runs[ALPHA].events.pages[1].bytes;
    expect(progress.at(-1)?.loaded).toBe(first + second);
    expect(progress.map((report) => report.loaded)).toEqual([...progress.map((report) => report.loaded)].sort((a, b) => a - b));
  });

  it("still ends the report when the page does not come", async () => {
    const { get, progress, files, manifest } = setup();
    files.delete(`run/${ALPHA}/events-0001.json`);
    const reply = await answer(get(`api/runs/${ALPHA}/events?from_seq=1&limit=${PAGE_SIZE}`));
    expect(reply.status).toBe(502);
    expect(progress.at(-1)?.loaded).toBe(manifest.runs[ALPHA].events.pages[0].bytes);
  });
});

describe("the calls of a run", () => {
  it("lists them", async () => {
    const { get } = setup();
    expect((await answer(get(`api/runs/${ALPHA}/calls`))).body).toEqual({ count: 3, calls: CALLS });
  });

  it.each([
    ["role=worker", ["e1", "e3"]],
    ["status=failed", ["e3"]],
    ["actor=o0", ["e2"]],
    ["model=small", ["e1", "e3"]],
    ["purpose=plan", ["e2"]],
    ["role=worker&status=ok", ["e1"]],
    ["role=orchestrator&role=worker", ["e1", "e3"]],
    ["role=nobody", []],
  ])("keeps the rows that match %s, and counts them", async (query, ids) => {
    const { get } = setup();
    const { body } = await answer(get(`api/runs/${ALPHA}/calls?${query}`));
    const { count, calls } = body as { count: number; calls: { effect_id: string }[] };
    expect(calls.map((call) => call.effect_id)).toEqual(ids);
    expect(count).toBe(ids.length);
  });

  it("reads one call in full from the run's one file of them", async () => {
    const { get, loaded } = setup();
    expect((await answer(get(`api/runs/${ALPHA}/calls/e2`))).body).toEqual(DETAILS.e2);
    expect((await answer(get(`api/runs/${ALPHA}/calls/e3`))).body).toEqual(DETAILS.e3);
    expect(loaded).toEqual([`run/${ALPHA}/call-details.json`]);
  });

  it("says no such call, in the API's words, for one the run never made", async () => {
    const { get, loaded } = setup();
    expect(await answer(get(`api/runs/${ALPHA}/calls/zz`))).toEqual({ status: 404, body: { error: `no LLM call 'zz' in run '${ALPHA}'` } });
    expect((await answer(get(`api/runs/${BETA}/calls/e1`))).status).toBe(404);
    expect(loaded).toEqual([]);
  });
});

describe("what needs a live run", () => {
  it.each(["chaos", "approve", "budget", "halt"])("refuses %s on a recording with 409, as the local server does", async (control) => {
    const { get } = setup();
    const { status, body } = await answer(get(`api/runs/${ALPHA}/${control}`, post({ kind: "kill_half" })));
    expect(status).toBe(409);
    expect((body as { error: string }).error).toContain(`run '${ALPHA}' is a recording, not a live run`);
  });

  it("refuses an answer to an escalation the same way", async () => {
    const { get } = setup();
    expect((await answer(get(`api/runs/${ALPHA}/escalations/x%3Ay`, post({ choice: "a" })))).status).toBe(409);
  });
});

describe("what needs the local server", () => {
  it.each([
    ["POST", "api/tasks"],
    ["POST", "api/tasks/preflight"],
    ["POST", "api/arena"],
    ["POST", "api/arena/preflight"],
    ["POST", "api/intake"],
    ["POST", "api/intake/preflight"],
    ["POST", "api/intake/i1/approve"],
    ["GET", "api/intake/sample?seed=3"],
    ["GET", "api/jobs"],
    ["POST", "api/ablation"],
    ["GET", "api/ablation/a1"],
  ])("answers %s %s with 503 and a reason a person can read", async (method, url) => {
    const { get, pass } = setup();
    const { status, body } = await answer(get(url, method === "POST" ? post({}) : undefined));
    expect(status).toBe(503);
    const { error } = body as { error: string };
    expect(error).toContain("needs the local server");
    expect(error).toContain("uv run fractalswarm demo --verify");
    expect(pass.seen).toEqual([]);
  });

  it("answers a route that does not exist with 404", async () => {
    const { get } = setup();
    expect((await answer(get("api/nothing/here"))).status).toBe(404);
    expect((await answer(get(`api/runs/${ALPHA}/nothing`))).status).toBe(404);
    expect((await answer(get("api/"))).status).toBe(404);
  });
});

describe("what is not an API call", () => {
  it("goes to the browser's own fetch: assets, fonts and other sites", async () => {
    const { get, pass } = setup();
    await get("assets/index.js");
    await get("https://fonts.example/font.woff2");
    await get("https://example.github.io/elsewhere/api/runs");
    await get("https://other.example/fractalswarm/api/runs");
    expect(pass.seen).toEqual([
      "assets/index.js",
      "https://fonts.example/font.woff2",
      "https://example.github.io/elsewhere/api/runs",
      "https://other.example/fractalswarm/api/runs",
    ]);
  });

  it("answers an API call made with a Request, or a URL, or an absolute URL under the site", async () => {
    const { get } = setup();
    expect((await get(new Request("https://example.github.io/fractalswarm/api/capabilities"))).status).toBe(200);
    expect((await get(new URL("https://example.github.io/fractalswarm/api/capabilities"))).status).toBe(200);
    expect((await get("https://example.github.io/fractalswarm/api/capabilities")).status).toBe(200);
  });

  it("finds its routes wherever the site is hosted, at the root as well as under a sub-path", async () => {
    const site = makeSite();
    const pass = passthrough();
    for (const base of ["http://127.0.0.1:8000/", "http://127.0.0.1:8000/index.html", "https://example.github.io/a/b/c/"]) {
      const get = createStaticFetch({ manifest: site.manifest, base, load: site.load, passthrough: pass.fetch });
      expect((await get("api/capabilities")).status, base).toBe(200);
    }
    expect(pass.seen).toEqual([]);
  });
});

describe("a request that is given up, or a file that is missing", () => {
  it("rejects as the browser's own fetch does when the request was aborted", async () => {
    const { get } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(get("api/runs", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("says the site was published incompletely when a data file is missing, rather than inventing an answer", async () => {
    const { get, files } = setup();
    files.delete(`run/${ALPHA}/metrics.json`);
    const { status, body } = await answer(get(`api/runs/${ALPHA}/metrics`));
    expect(status).toBe(502);
    expect((body as { error: string }).error).toContain(`run/${ALPHA}/metrics.json`);
  });

  it("asks again for a file that was missing the first time", async () => {
    const { get, files } = setup();
    const text = files.get(`run/${ALPHA}/events-0001.json`) ?? "";
    files.delete(`run/${ALPHA}/events-0001.json`);
    expect((await answer(get(`api/runs/${ALPHA}/events?from_seq=2&limit=2`))).status).toBe(502);
    files.set(`run/${ALPHA}/events-0001.json`, text);
    expect((await answer(get(`api/runs/${ALPHA}/events?from_seq=2&limit=2`))).body).toEqual(reference(eventsOf(10), 2, 2));
  });
});
