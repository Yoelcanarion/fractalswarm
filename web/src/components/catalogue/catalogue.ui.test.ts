import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NO_FILTER, readFacts, rowOf, type RunFacts, type VerifyView } from "../../lib/catalogue";
import { DEFAULT_CAPABILITIES } from "../../lib/controls";
import { REPO_ROOT, renderCurrent } from "../../lib/testing";
import type { RunEvent, RunListing, VerifyReport } from "../../lib/types";
import { RunsPage } from "../../pages/RunsPage";
import { createRunStore, RunStoreProvider, type RunApi } from "../../store";
import { LiveNow } from "./LiveNow";
import { RunsKey } from "./RunsKey";
import { RunsTable } from "./RunsTable";
import { RunsToolbar } from "./RunsToolbar";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function ends(bundle: string): RunFacts {
  const lines = readFileSync(REPO_ROOT + `demo/${bundle}/events.jsonl`, "utf-8").split("\n").filter((line) => line.trim());
  return readFacts(JSON.parse(lines[0]) as RunEvent, JSON.parse(lines.at(-1)!) as RunEvent);
}
const backup = ends("backup"); // billed, a live clock, the kill-half plan
const toy = ends("toy"); // not billed, a simulated clock, no task

const SWARM = "fractalswarm.actors.swarm:SWARM";
const CENTRAL = "fractalswarm.actors.swarm:CENTRAL";
const listing = (id: string, status: RunListing["status"] = "completed", scenario: string | null = SWARM, over: Partial<RunListing> = {}): RunListing => ({
  id,
  source: "runs",
  run_id: id,
  scenario,
  seed: "1",
  clock: "live",
  events: 1200,
  duration_ms: 199_000,
  status,
  head: `head-${id}`,
  ...over,
});

const c3: RunFacts = { task: "t2_conference", profile: "C3", kills: null, billed: true, clock: "live", capUsd: 2, spentUsd: 0.485 };
const table = (rows: ReturnType<typeof rowOf>[], verify: Record<string, VerifyView> = {}, sort = { key: "listed", dir: "asc" } as const) =>
  html(createElement(RunsTable, { rows, sort, onSort: () => undefined, verify, onVerify: () => undefined }));

describe("the table of runs", () => {
  const rows = [
    rowOf(listing("t2-c3-swarm", "completed", SWARM), c3, 0),
    rowOf(listing("t2-c3-central", "completed", CENTRAL), { ...c3, spentUsd: 0.601 }, 1),
    rowOf(listing("demo-toy", "completed", "fractalswarm.actors.toy:TOY", { source: "demo", events: 56, duration_ms: 4000 }), toy, 2),
  ];

  it("captions the table for a screen reader without saying where the runs are", () => {
    const out = table([rowOf(listing("t2-c3-swarm", "completed", SWARM), c3, 0)]);
    expect(out).toContain('<caption class="sr-only">The recorded runs. Press a column title to sort by it.</caption>');
  });

  it("says in words what ran, with what task, under which failures, billed or not, and what it spent", () => {
    const out = table(rows);
    const t = text(out);
    // a recorded run opens at its end: the whole picture at once, the start one click away
    expect(out).toContain('href="#/run/t2-c3-swarm?at=end"');
    expect(t).toContain("FractalSwarm");
    expect(t).toContain("In-process supervisor");
    expect(t).toContain("Toy demo");
    expect(t).toMatch(/T2 .*conference/i);
    expect(t).toContain("seed 1");
    expect(t).toContain("C3");
    expect(t).toContain("Billed");
    expect(t).toContain("Not billed");
    expect(t).toContain("$0.485");
    expect(t).toContain("notional"); // the toy's spend is not money
    expect(t).toContain("3 min 19 s");
    expect(t).toContain("1,200 events");
    expect(t).toContain("demo bundle");
  });

  it("names the failures of a run with its own plan by the coordinators it kills", () => {
    const out = text(table([rowOf(listing("backup"), backup, 0)]));
    expect(out).toContain("kill-half");
    expect(out).toContain("5 coordinators killed");
  });

  it("has no tab stop for the words that repeat down a column", () => {
    expect(table(rows)).not.toContain("tabindex");
    expect(table(rows)).toContain("Five coordinator crashes"); // the definition is still there on hover
  });

  it("gives a state that needs a sentence a tab stop to read it, and leaves the plain ones alone", () => {
    const out = table([rowOf(listing("died", "interrupted"), c3, 0), rowOf(listing("ok", "completed"), c3, 1)]);
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain("nothing is recording it any more");
    expect(out).toContain("badge--bad");
  });

  it("marks the column it is sorted by, for a screen reader too", () => {
    const out = table(rows, {}, { key: "duration", dir: "desc" } as never);
    expect(out.match(/aria-sort="descending"/g)).toHaveLength(1);
    expect(out.match(/aria-sort="none"/g)).toHaveLength(4);
    expect(out).toMatch(/aria-sort="descending"[^>]*><button[^>]*>Length/);
  });

  it("shows a row whose log is not read yet as a name and a size, with the rest on its way", () => {
    const out = table([rowOf(listing("later"), null, 0)]);
    expect(out).toContain("later");
    expect(out).toContain("skeleton");
    expect(out).toContain("1,200 events");
    expect(out).not.toContain("Not billed");
  });

  it("offers a replay check only for a run that has ended, and shows the verdict in the same words as the run page", () => {
    const report = (over: Partial<VerifyReport> = {}): VerifyReport => ({
      ok: true,
      chain_ok: true,
      recorded_events: 56,
      replayed_events: 56,
      recorded_head: "a".repeat(64),
      replayed_head: "b".repeat(64),
      first_divergence: null,
      detail: "",
      bundle_head: null,
      bundle_head_ok: true,
      ...over,
    });
    const body = [rowOf(listing("a"), c3, 0), rowOf(listing("b"), c3, 1), rowOf(listing("c"), c3, 2), rowOf(listing("d"), c3, 3), rowOf(listing("e", "running"), null, 4)];
    const out = table(body, {
      b: { state: "pending" },
      c: { state: "done", report: report() },
      d: { state: "done", report: report({ ok: false, chain_ok: false, first_divergence: 812 }) },
    });
    expect(out).toContain("Verify the replay of a");
    expect(out).toContain("Replaying…");
    expect(out).toContain("Replay verified");
    expect(out).toContain("badge--good");
    expect(out).toContain("Replay mismatch at seq 812");
    expect(out).toContain("badge--bad");
    expect(out).not.toContain("Verify the replay of e"); // a live run has nothing to replay yet
  });

  it("lets the static showcase show its check failing, and go back to the real log", () => {
    vi.stubEnv("MODE", "static");
    const report = { ok: true, chain_ok: true, recorded_events: 9, replayed_events: 9, recorded_head: "a", replayed_head: "a", first_divergence: null, detail: "", bundle_head: null, bundle_head_ok: true };
    const here = { ok: true, events: 9, head: "a", brokenAt: null, ms: 10 };
    const verified = { state: "done", report: { ...report, here } } as const;
    const rows = [rowOf(listing("a"), c3, 0)];
    const shown = (view: VerifyView, onChangeDigit?: (id: string) => void) => html(createElement(RunsTable, { rows, sort: { key: "listed", dir: "asc" }, onSort: () => undefined, verify: { a: view }, onVerify: () => undefined, onChangeDigit }));
    expect(shown(verified, () => undefined)).toContain(">Change one digit<");
    expect(shown(verified)).not.toContain("Change one digit");
    const changed = shown({ state: "done", report: { ...report, here: { ...here, ok: false, brokenAt: 5, changed: true } } }, () => undefined);
    expect(changed).toContain("One digit changed: hash chain broken at event 5");
    expect(changed).toContain(">Back to the real log<");
    expect(changed).not.toContain(">Change one digit<");
    vi.unstubAllEnvs();
  });

  it("keeps a failed check apart from a mismatch and offers to try again", () => {
    const out = table([rowOf(listing("a"), c3, 0)], { a: { state: "error", error: "502 Bad Gateway" } });
    expect(out).toContain("Could not check");
    expect(out).toContain("Try again to verify a");
    expect(out).toContain("502 Bad Gateway");
    expect(out).not.toContain("mismatch");
  });
});

describe("the toolbar", () => {
  const props = {
    filter: NO_FILTER,
    onFilter: () => undefined,
    states: ["live", "recorded"] as const,
    workflows: [
      { id: "swarm", label: "FractalSwarm", count: 3 },
      { id: "central", label: "In-process supervisor", count: 1 },
    ],
    summary: "1 live · 3 recorded",
    onRefresh: () => undefined,
    sorted: false,
    onResetSort: () => undefined,
    onVerifyAll: () => undefined,
    verifiable: 3,
    verifying: false,
  };

  it("offers only the states and workflows the list has, with how many each", () => {
    const out = html(createElement(RunsToolbar, props));
    expect(out).toContain(">Live<");
    expect(out).toContain(">Recorded<");
    expect(out).not.toContain(">Halted<");
    expect(out).toContain("FractalSwarm (3)");
    expect(out).toContain("In-process supervisor (1)");
    expect(out).toContain("1 live · 3 recorded");
    expect(out).toContain("Search runs");
    expect(out).toContain("Verify 3 listed runs");
  });

  it("offers the server's order back only once the list is sorted, and stops the replays it cannot start", () => {
    expect(html(createElement(RunsToolbar, props))).not.toContain("Newest first");
    expect(html(createElement(RunsToolbar, { ...props, sorted: true }))).toContain("Newest first");
    const none = html(createElement(RunsToolbar, { ...props, verifiable: 0 }));
    expect(none).toContain("Nothing to verify");
    expect(none).toMatch(/<button[^>]*disabled[^>]*>Nothing to verify/);
    expect(html(createElement(RunsToolbar, { ...props, verifying: true }))).toContain("Replaying…");
    expect(html(createElement(RunsToolbar, { ...props, verifiable: 1 }))).toContain("Verify 1 listed run<");
  });
});

describe("live now", () => {
  it("is nothing when no run is live", () => {
    expect(html(createElement(LiveNow, { rows: [] }))).toBe("");
  });

  it("lists a live run apart, with a way to watch it", () => {
    const out = html(createElement(LiveNow, { rows: [rowOf(listing("now", "running", SWARM, { events: 300, duration_ms: 12_000 }), null, 0)] }));
    const t = text(out);
    expect(t).toContain("Live now");
    expect(t).toContain("300 events so far");
    expect(out).toContain('href="#/run/now"');
    expect(t).toContain("Watch");
  });
});

describe("the key", () => {
  it("defines the failure plans, billing, states, length and the replay check as text", () => {
    const t = text(html(createElement(RunsKey)));
    for (const word of ["C0", "C1", "C2", "C3"]) expect(t).toContain(word);
    expect(t).toContain("Five coordinator crashes");
    expect(t).toContain("Not billed");
    expect(t).toContain("notional");
    expect(t).toContain("kill switch");
    expect(t).toContain("simulated clock");
    expect(t).toContain("this code reproduces the recorded run from the recorded model outputs");
  });
});

describe("the page", () => {
  const apiOf = (runs: RunListing[]): RunApi => ({
    listRuns: async () => runs,
    loadAllEvents: async () => [],
    tailEvents: () => () => undefined,
    verifyRun: async () => {
      throw new Error("unused");
    },
  });
  const page = (state: Partial<ReturnType<ReturnType<typeof createRunStore>["getState"]>>) => {
    const store = renderCurrent(createRunStore({ api: apiOf([]) }));
    store.setState(state);
    return html(createElement(RunStoreProvider, { store }, createElement(RunsPage)));
  };

  it("shows a skeleton, not an empty list, until the server has answered", () => {
    const out = page({ runsLoaded: false });
    expect(out).toContain("Loading the runs");
    expect(out).toContain("skeleton");
    expect(out).not.toContain("No runs yet");
  });

  it("says so, and how to start one, when the server holds none", () => {
    const out = page({ runsLoaded: true, runs: [] });
    expect(text(out)).toContain("No runs yet");
    expect(text(out)).toContain("fractalswarm run");
    expect(out).toContain("Start a run");
  });

  it("says on the static site that it shows recorded runs only, with no button that starts one", () => {
    const out = page({ runsLoaded: true, runs: [], capabilities: { ...DEFAULT_CAPABILITIES, static: true } });
    const t = text(out);
    expect(t).toContain("No runs yet");
    expect(t).toContain("This site shows recorded runs only, and it holds none.");
    expect(t).toContain("uv run fractalswarm serve");
    expect(t).toContain("fractalswarm run");
    expect(t).not.toContain("this server");
    expect(out).not.toContain(">Start a run</a>");
  });

  it("says why the list did not load, and offers to try again", () => {
    const out = page({ runsLoaded: true, runs: [], runsError: "502 Bad Gateway" });
    expect(text(out)).toContain("Could not load the runs");
    expect(out).toContain("502 Bad Gateway");
    expect(out).toContain("Try again");
    expect(out).toContain("emptystate--bad");
  });

  it("keeps the list it had and says the refresh failed", () => {
    const out = page({ runsLoaded: true, runs: [listing("kept")], runsError: "timeout" });
    expect(out).toContain('href="#/run/kept?at=end"');
    expect(text(out)).toContain("Could not refresh the list: timeout");
  });

  it("lists live runs apart from the recorded ones, with the key and the form to start one, each folded", () => {
    const out = page({ runsLoaded: true, runs: [listing("now", "running"), listing("old-1"), listing("old-2", "interrupted")] });
    const t = text(out);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(t).toContain("Runs");
    // the page a "Replays" door opens says what it promises: a replay check, defined where it is named
    expect(out).toMatch(/<span class="term">replay check<\/span>/);
    expect(out).toContain("Rebuilds the run from its recorded log and compares every event");
    expect(t).toContain("Live now");
    expect(t).toContain("1 live · 1 recorded · 1 interrupted");
    expect(out).toContain('href="#/run/old-1?at=end"');
    expect(t).toContain("How to read this table");
    expect(t).toContain("Start a run of your own");
    expect(t).toContain("on the practice model, so it costs nothing");
    expect(t).toContain("Describe the job and start it");
    // The live run is in its own strip, not in the table of recorded ones.
    expect(out.split("runstable")[1]).not.toContain("#/run/now");
  });

  it("lists every run the static site holds and offers no form that starts one, where a server lists four and offers it", () => {
    // the five the site is built with: the exporter lists the final run, then the others by name, so the durable swarm comes last
    const ids = ["demo-final", "demo-pair-central-rival", "demo-pair-central-swarm", "demo-pair-durable-max-rival", "demo-pair-durable-max-swarm"];
    const runs = ids.map((id) => listing(id, "completed", SWARM, { source: "demo" }));
    const featuredIds = (out: string): string[] =>
      [...(/<ul class="featured"[\s\S]*?<\/ul>/.exec(out)?.[0] ?? "").matchAll(/class="mono featured__id" href="#\/run\/([^?"]+)/g)].map((m) => m[1]);
    const site = page({ runsLoaded: true, runs, capabilities: { ...DEFAULT_CAPABILITIES, static: true } });
    expect(featuredIds(site)).toEqual(ids);
    expect(site).not.toContain('<details id="start"');
    expect(text(site)).not.toContain("Start a run of your own");
    expect(text(site)).toContain("All 5 runs");
    const server = page({ runsLoaded: true, runs });
    expect(featuredIds(server)).toEqual(ids.slice(0, 4));
    expect(server).toContain('<details id="start"');
  });

  it("puts a person's own runs first, each with the way to what it produced, and keeps them out of the runs to start with", () => {
    const demo = listing("demo-final", "completed", SWARM, { source: "demo" });
    const mine = listing("pair-1-swarm", "completed", SWARM, { source: "private" });
    const reading = listing("intake-1", "completed", "fractalswarm.intake.actor:INTAKE", { source: "private" });
    const out = page({ runsLoaded: true, runs: [mine, reading, demo] });
    const yours = /<section class="yourruns"[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
    expect(text(yours)).toContain("Your runs");
    expect(yours).toContain('href="#/run/pair-1-swarm?at=end"');
    expect(yours).not.toContain("intake-1"); // a reading places no talk
    expect(out.indexOf("yourruns")).toBeLessThan(out.indexOf('aria-label="Runs to start with"'));
    const toStart = /<ul class="featured" aria-label="Runs to start with"[\s\S]*?<\/ul>/.exec(out)?.[0] ?? "";
    expect(toStart).not.toContain("pair-1-swarm");
    expect(toStart).toContain("demo-final");
    // the static site holds nobody's runs
    expect(page({ runsLoaded: true, runs: [mine, demo], capabilities: { ...DEFAULT_CAPABILITIES, static: true } })).not.toContain("yourruns");
  });

  it("opens with one main action and the runs to start from, with the whole list and the form under Details", () => {
    const demo = { source: "demo" } as const;
    const out = page({ runsLoaded: true, runs: [listing("old-1", "completed", SWARM, demo), listing("demo-final", "completed", SWARM, demo), listing("old-2", "interrupted", SWARM, demo)] });
    // the main action is the final run, wherever the server lists it
    expect(out).toContain('<a class="btn btn--on" href="#/run/demo-final?at=end">Open the final run</a>');
    // the short list leads with it
    const featured = /<ul class="featured"[\s\S]*?<\/ul>/.exec(out)?.[0] ?? "";
    expect([...featured.matchAll(/class="mono featured__id" href="([^"]+)"/g)].map((m) => m[1])).toEqual(["#/run/demo-final?at=end", "#/run/old-1?at=end", "#/run/old-2?at=end"]);
    // the search, the filters and the table are in the fold with the id the address opens
    const fold = /<details id="all"[\s\S]*?<\/details>\s*<details id="start"/.exec(out)?.[0] ?? "";
    expect(fold).toContain("All 3 runs");
    expect(fold).toContain("runstool");
    expect(fold).toContain("runstable");
    expect(featured).not.toContain("runstable");
    expect(out).toContain('<details id="start"');
  });
});
