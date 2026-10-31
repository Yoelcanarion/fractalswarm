// The app's own client code against a real export. fixtures/site is what scripts/build_static_site.py writes for demo/toy
// and tests/golden/one-call (tests/unit/test_static_site.py keeps it current), so these are the readers the pages use,
// reading the answers the live server gave, through the shim, with no server.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchOfficial, fetchPairs, fetchRecovery } from "../arena/api";
import { loadHonesty } from "../arena/helps/load";
import { createIntakeApi } from "../intake/api";
import {
  benchResults,
  fetchCallDetail,
  fetchCalls,
  fetchCapabilities,
  fetchDisputes,
  fetchMeter,
  fetchTakeover,
  listRuns,
  loadAllEvents,
  postControl,
  verifyRun,
} from "../lib/api";
import { readManifest } from "./manifest";
import { createStaticFetch } from "./shim";
import { BASE, BETA, makeSite, passthrough } from "./testing";

const SITE = fileURLToPath(new URL("./fixtures/site/", import.meta.url));
const read = (file: string): Buffer => readFileSync(`${SITE}data/${file}`);

const TOY = "demo-toy";
const ONE_CALL = "demo-one-call";

/** Put the shim in the place of fetch, as the static build does, over the fixture's files. */
function install() {
  const manifest = readManifest(JSON.parse(read("manifest.json").toString("utf-8")));
  const loaded: string[] = [];
  const pass = passthrough();
  vi.stubGlobal(
    "fetch",
    createStaticFetch({
      manifest,
      base: BASE,
      load: async (file) => {
        loaded.push(file);
        return new Response(read(file).toString("utf-8"));
      },
      passthrough: pass.fetch,
    }),
  );
  return { manifest, loaded, pass };
}

afterEach(() => vi.unstubAllGlobals());

describe("the lists the app opens with", () => {
  it("lists the runs the export holds, as the run list reads them", async () => {
    install();
    const runs = await listRuns();
    expect(runs.map((run) => run.id).sort()).toEqual([ONE_CALL, TOY]);
    const toy = runs.find((run) => run.id === TOY);
    expect(toy).toMatchObject({ status: "completed", events: 56 });
    expect(toy?.head).toMatch(/^[0-9a-f]{32}$/);
  });

  it("offers no control: not chaos, approval, a task, a budget change or a halt", async () => {
    install();
    const capabilities = await fetchCapabilities();
    expect(Object.keys(capabilities)).toEqual(expect.arrayContaining(["chaos", "approve", "tasks", "budget", "halt"]));
    const { static: onTheSite, ...controls } = capabilities;
    expect(Object.values(controls).every((on) => on === false)).toBe(true);
    // and the answer says where the app is, so that its words about starting a run and about the replay check are the site's
    expect(onTheSite).toBe(true);
  });

  it("holds the pair the arena page lists, with both runs named", async () => {
    install();
    expect(await fetchPairs()).toEqual([
      expect.objectContaining({ pairId: `${TOY}+${ONE_CALL}`, left: TOY, right: ONE_CALL, rival: "one-call", billed: false, private: false, state: "completed" }),
    ]);
  });

  it("has no hero chart measured yet, and says it is the fixture", async () => {
    install();
    expect(await benchResults()).toMatchObject({ source: "fixture", fixture: true });
  });

  it("reports the honesty file missing when the site was built without one, as the helps page shows it", async () => {
    install();
    expect((await loadHonesty()).status).toBe("missing");
  });
});

describe("opening a run", () => {
  it("loads the whole log, in the one request the client makes, from the one page file", async () => {
    const { loaded } = install();
    const events = await loadAllEvents(TOY);
    expect(events).toHaveLength(56);
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 56 }, (_, i) => i + 1));
    expect(events[0].type).toBe("run.started");
    expect(loaded).toEqual([`run/${TOY}/events-0001.json`]);
    expect(events).toEqual((JSON.parse(read(`run/${TOY}/events-0001.json`).toString("utf-8")) as { events: unknown[] }).events);
  });

  it("answers the first and the last event alone from their small file, which is how the Runs page reads a run", async () => {
    const { loaded } = install();
    const log = (JSON.parse(read(`run/${TOY}/events-0001.json`).toString("utf-8")) as { events: { seq: number }[] }).events;
    const first = (await (await fetch(`api/runs/${TOY}/events?from_seq=1&limit=1`)).json()) as { events: unknown[] };
    const last = await (await fetch(`api/runs/${TOY}/events?from_seq=56&limit=1`)).json();
    expect(first.events).toEqual([log[0]]);
    expect(last).toEqual({ events: [log[55]], next_seq: 57, last_seq: 56, done: true });
    expect(loaded).toEqual([`run/${TOY}/edges.json`]);
  });

  it("loads the log of the other run too", async () => {
    install();
    expect(await loadAllEvents(ONE_CALL)).toHaveLength(9);
  });

  it("shows the replay report the build made, with the commit and the date it was checked at", async () => {
    install();
    const report = await verifyRun(TOY);
    expect(report).toMatchObject({ ok: true, bundle_head_ok: true, recorded_events: 56, replayed_events: 56 });
    expect(report.replayed_head).toBe(report.recorded_head);
    expect((report as unknown as { static: unknown }).static).toEqual({
      where: "build",
      commit: "a".repeat(40),
      commit_short: "a".repeat(12),
      dirty: false,
      built_at: "2026-10-30T10:00:00Z",
    });
  });

  it("reads the takeover, the recovery and the official numbers the way the arena does", async () => {
    install();
    await expect(fetchTakeover(TOY)).resolves.not.toBeUndefined();
    await expect(fetchRecovery(TOY)).resolves.not.toBeUndefined();
    await expect(fetchOfficial(TOY)).resolves.not.toBeUndefined();
  });

  it("reads the escalations, or none", async () => {
    install();
    await expect(fetchDisputes(TOY)).resolves.not.toBeUndefined();
  });
});

describe("a supervisor's run", () => {
  it("keeps the 501 the API gives for its takeover, which the takeover chip reads as not offered", async () => {
    const site = makeSite();
    const refusal = { error: "supervisor log: use `fractalswarm recovery`" };
    site.manifest.runs[BETA].routes.takeover = { status: 501, body: refusal };
    vi.stubGlobal("fetch", createStaticFetch({ manifest: site.manifest, base: BASE, load: site.load, passthrough: passthrough().fetch }));
    const reply = await fetch(`api/runs/${BETA}/takeover`);
    expect(reply.status).toBe(501);
    expect(await reply.json()).toEqual(refusal);
    await expect(fetchTakeover(BETA)).resolves.toBeNull();
  });
});

describe("the Muse lens", () => {
  it("lists every call of a run and its meter", async () => {
    install();
    const calls = await fetchCalls(TOY);
    expect(calls?.calls).toHaveLength(5);
    expect(calls?.run_id).toBe(TOY);
    await expect(fetchMeter(TOY)).resolves.not.toBeNull();
  });

  it("opens each call in full, from the run's one file of them", async () => {
    const { loaded } = install();
    const calls = await fetchCalls(TOY);
    for (const row of calls?.calls ?? []) {
      const detail = await fetchCallDetail(TOY, row.effect_id);
      expect(detail.effect_id).toBe(row.effect_id);
      expect(detail.prompt.text.length).toBeGreaterThan(0);
    }
    expect(loaded.filter((file) => file.endsWith("call-details.json"))).toEqual([`run/${TOY}/call-details.json`]);
  });

  it("answers a call that was never made with the refusal the lens shows", async () => {
    install();
    await expect(fetchCallDetail(TOY, "nope")).rejects.toThrow(/no LLM call 'nope'/);
  });
});

describe("what a recording cannot do", () => {
  it("refuses a control on it with 409 and the words 'a recording, not a live run'", async () => {
    install();
    expect(await postControl(`api/runs/${TOY}/chaos`, { kind: "kill_half" })).toMatchObject({
      ok: false,
      status: 409,
      detail: expect.stringContaining("is a recording, not a live run"),
    });
  });

  it("refuses to start a run, with 503 and the way to run the real thing", async () => {
    install();
    expect(await postControl("api/tasks", {})).toMatchObject({
      ok: false,
      status: 503,
      detail: expect.stringContaining("uv run fractalswarm demo --verify"),
    });
  });

  it("tells the intake pages the local server is needed, and does not throw", async () => {
    install();
    const api = createIntakeApi();
    for (const outcome of [await api.sample(), await api.startReading({}), await api.launchTask({}), await api.launchArena({})]) {
      expect(outcome).toMatchObject({ ok: false, status: 503 });
      expect((outcome as { error: string }).error).toContain("needs the local server");
    }
  });

  it("answers a run that is not here with the runs that are", async () => {
    install();
    await expect(loadAllEvents("nope")).rejects.toThrow(/no run 'nope'.*demo-one-call, demo-toy/);
  });
});

describe("nothing leaves the site", () => {
  it("asks the network for nothing but files of its own data folder", async () => {
    const { loaded, pass } = install();
    await listRuns();
    await fetchCapabilities();
    await loadAllEvents(TOY);
    await verifyRun(TOY);
    await fetchPairs();
    await fetchCalls(TOY);
    expect(pass.seen).toEqual([]);
    expect(loaded.every((file) => file.startsWith("run/"))).toBe(true);
  });
});
