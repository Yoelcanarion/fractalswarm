// The lens components drawn on the server (react-dom/server) over the recorded fixtures: no browser,
// but every render path runs, with real data. The look is checked on screenshots.

import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createLensStore, registerLensStore, type LensApi } from "../../lensStore";
import { readCallDetail, readCalls, readMeter, type CallDetail } from "../../lib/lens";
import { loadFixture, renderCurrent, Stream } from "../../lib/testing";
import type { RunEvent } from "../../lib/types";
import { createRunStore, RunStoreProvider, type RunApi, type RunStoreApi } from "../../store";
import { RunStrip } from "../RunStrip";
import { TakeoverChip } from "../TakeoverChip";
import { CallView } from "./CallView";
import { LensDock } from "./LensDock";
import { MuseMeter } from "./MuseMeter";

interface Fixture {
  calls: unknown;
  meter: unknown;
  details: Record<string, unknown>;
}

const demo = loadFixture<Fixture>("lens-demo-backup.json");
const central = loadFixture<Fixture>("lens-central-c3.json");

const log = (): RunEvent[] => {
  const s = new Stream().at(0).emit("run.started", "@kernel", { seed: "0", scenario: "t", params: {}, clock: "sim" });
  s.at(1000).emit("test.tick", "a").at(2000).emit("run.completed", "@kernel");
  return s.events;
};

/** The text a person reads: tags gone, entities decoded, runs of white space made one space. */
// What a person sees: a hint sits in the markup closed, with a copy of its words for a screen reader, and neither is on the page.
const text = (html: string): string =>
  html
    .replace(/<span[^>]*role="tooltip"[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function lensApi(fixture: Fixture, over: Partial<LensApi> = {}): LensApi {
  return {
    calls: async () => readCalls(fixture.calls),
    meter: async () => readMeter(fixture.meter),
    detail: async (_run, id) => {
      const found = readCallDetail(fixture.details[id]);
      if (!found) throw new Error(`no call ${id}`);
      return found;
    },
    ...over,
  };
}

/** A finished run opened in a run store whose lens has read `fixture`. */
async function opened(fixture: Fixture, api: Partial<LensApi> = {}, runApi: Partial<RunApi> = {}) {
  const run: RunStoreApi = renderCurrent(
    createRunStore({
      api: {
        listRuns: async () => [],
        loadAllEvents: async () => log(),
        tailEvents: () => () => undefined,
        verifyRun: async () => {
          throw new Error("unused");
        },
        ...runApi,
      },
    }),
  );
  const lens = renderCurrent(createLensStore(run, { api: lensApi(fixture, api) }));
  registerLensStore(run, lens);
  await run.getState().openRun("done");
  await vi.waitFor(() => expect(lens.getState().status).not.toBe("loading"));
  return { run, lens };
}

const render = (run: RunStoreApi, Component: FunctionComponent): string =>
  renderToStaticMarkup(createElement(RunStoreProvider, { store: run }, createElement(Component)));

describe("the Muse meter", () => {
  it("shows $ and tokens by model, the cache share and the zero claim at the end of the run", async () => {
    const { run } = await opened(demo);
    run.getState().seek(3); // the end of the 3-event log
    const html = render(run, MuseMeter);
    const t = text(html);
    expect(t).toContain("Muse meter");
    expect(t).toContain("Wonder $0.0471");
    expect(t).toContain("Spark $0.4477");
    expect(t).toMatch(/Spark \$0\.4477 \d+k tok/);
    expect(t).toContain("61% of input tokens served from cache");
    expect(t).toContain("coordination tokens 0 · recovery tokens 0");
    expect(html).toContain("meter__claim--zero");
    expect(html).not.toContain("calls lost");
  });

  it("starts at zero and fills in with the playhead", async () => {
    const { run } = await opened(demo);
    const start = text(render(run, MuseMeter));
    expect(start).toContain("Wonder $0 0 tok");
    expect(start).toContain("Spark $0 0 tok");
    run.setState({ playhead: 20_000, cursor: 1 });
    const early = text(render(run, MuseMeter));
    expect(early).toContain("Wonder $0.0471"); // the root plan ended at 18 s
    expect(early).toContain("Spark $0 0 tok"); // the first Spark call starts at 36.8 s
    run.setState({ playhead: 60_000, cursor: 1 });
    const later = text(render(run, MuseMeter));
    expect(later).not.toContain("Spark $0 0 tok");
    expect(later).toMatch(/Spark \$0\.\d{4} \S+ tok/);
  });

  it("says how many calls a baseline lost to crashes, and what they cost", async () => {
    const { run } = await opened(central);
    run.getState().seek(3);
    const t = text(render(run, MuseMeter));
    expect(t).toContain("27 calls lost · $0.1458");
    expect(t).toContain("coordination tokens 0 · recovery tokens 0");
  });

  it("says one call lost in the singular", async () => {
    const calls = readCalls(central.calls);
    // every call settles but one that was lost, and the playhead is past them all
    const lost = calls.calls.find((call) => call.status === "cancelled" && call.ended_ts !== null)!;
    calls.calls = calls.calls.map((call) => (call === lost ? call : { ...call, status: "ok" as const }));
    const { run } = await opened(central, { calls: async () => calls, meter: async () => null });
    run.getState().seek(3);
    run.setState({ playhead: Number.MAX_SAFE_INTEGER });
    const t = text(render(run, MuseMeter));
    expect(t).toMatch(/ 1 call lost · \$/);
    expect(t).not.toContain("1 calls lost");
  });

  it("is a fold in the run strip, under words a first view can read, so the strip is one row of the two proofs", async () => {
    const { run } = await opened(demo);
    run.getState().seek(3);
    const html = render(run, RunStrip);
    expect(html).toMatch(/<details id="meter" class="disclosure disclosure--menu meter-fold">/);
    expect(text(html)).toContain("What the models cost");
    expect(html).toContain("runstrip__proof");
    // inside it the meter is what it was
    expect(text(html)).toContain("Muse meter");
  });

  it("warns when a run spent tokens on coordination", async () => {
    const calls = readCalls(demo.calls);
    calls.calls[3] = { ...calls.calls[3], role: "supervisor" };
    const { run } = await opened(demo, { calls: async () => calls, meter: async () => null });
    run.getState().seek(3);
    run.setState({ playhead: 1e9, cursor: 1 }); // before the end of the log, so the fold is used
    const html = render(run, MuseMeter);
    expect(html).toContain("meter__claim--some");
    expect(text(html)).toMatch(/coordination tokens [1-9][\d,]* · recovery tokens 0/);
  });

  it("stays out of the way on a server without the lens, and says so on a failure", async () => {
    const off = await opened(demo, { calls: async () => null });
    expect(render(off.run, MuseMeter)).toBe("");
    const broken = await opened(demo, {
      calls: async () => {
        throw new Error("boom");
      },
    });
    expect(text(render(broken.run, MuseMeter))).toBe("Muse meter unavailable");
  });

  it("says so when a run made no model calls", async () => {
    const { run } = await opened(demo, { calls: async () => ({ run_id: "x", calls: [], refused: [] }) });
    expect(text(render(run, MuseMeter))).toContain("this run made no model calls");
  });
});

describe("the lens drawer", () => {
  it("draws nothing while closed", async () => {
    const { run } = await opened(demo);
    expect(render(run, LensDock)).toBe("");
  });

  it("opens an actor on the call it had reached, which is still waiting for the model", async () => {
    const { run, lens } = await opened(demo);
    // o1.2.a2 makes four calls back to back; eff-3895.0 is the second, running from 42.8 s to 49.7 s.
    run.setState({ playhead: 45_000 });
    lens.getState().openActor("o1.2.a2");
    expect(lens.getState().selected).toBe("eff-3895.0");
    await vi.waitFor(() => expect(lens.getState().details["eff-3895.0"]?.state).toBe("ready"));
    const html = render(run, LensDock);
    const t = text(html);
    expect(html).toContain('aria-label="Muse lens"');
    const started = readCalls(demo.calls).calls.filter((c) => c.started_ts <= 45_000).length;
    expect(t).toContain(`o1.2.a2 2 Every call ${started}`); // two of its four calls had started
    expect(t).toContain("running");
    expect(t).toContain("Waiting for the model");
    expect(html).not.toContain("<mark"); // the answer has not happened yet
  });

  it("shows a call opened from the event log in full, with its figures and its facts", async () => {
    const { run, lens } = await opened(demo);
    run.setState({ playhead: 1e9 });
    lens.getState().openCall("eff-3895.0");
    await vi.waitFor(() => expect(lens.getState().details["eff-3895.0"]?.state).toBe("ready"));
    const html = render(run, LensDock);
    const t = text(html);
    expect(t).toContain(`o1.2.a2 4 Every call ${readCalls(demo.calls).calls.length}`);
    expect(t).toContain("Input tokens 3,300");
    expect(t).toContain("Cost $0.0088");
    expect(t).toContain("Latency 6.9 s");
    expect(t).toContain("Facts, next to the sentence they came from 8");
    expect(html).toContain('<mark class="evidence"');
    expect(t).not.toContain("Waiting for the model");
  });

  it("names the kind of an actor the replay has spawned", async () => {
    const s = new Stream().at(0).emit("run.started", "@kernel", { seed: "0", scenario: "t", params: {}, clock: "sim" });
    s.at(500).spawn("o1.2.a2", "agent", "root").at(2000).emit("run.completed", "@kernel");
    const { run, lens } = await opened(demo, {}, { loadAllEvents: async () => s.events });
    run.getState().seek(s.events.length);
    run.setState({ playhead: 45_000 });
    lens.getState().openActor("o1.2.a2");
    expect(text(render(run, LensDock))).toContain("o1.2.a2 agent 2");
  });

  it("ignores a call the lens does not know when the log names one", async () => {
    const { lens } = await opened(demo);
    lens.getState().openCall("eff-nope");
    expect(lens.getState().scope).toEqual({ kind: "run" });
    expect(lens.getState().selected).toBeNull();
  });

  it("says why an actor with no calls has none", async () => {
    const { run, lens } = await opened(demo);
    lens.getState().openActor("root");
    expect(text(render(run, LensDock))).toContain("root makes no LLM calls");
  });

  it("lists every call of the run with its filters", async () => {
    const { run, lens } = await opened(central);
    run.setState({ playhead: 1e9 });
    lens.getState().openRun();
    const html = render(run, LensDock);
    const t = text(html);
    expect(t).toContain("Every call 103");
    expect(t).toMatch(/All 103 Wonder 1 Spark 102 Cancelled 27/);
    expect(t).toContain("cancelled");
  });

  it("explains a server without the lens", async () => {
    const { run, lens } = await opened(demo, { calls: async () => null });
    lens.getState().openRun();
    expect(text(render(run, LensDock))).toContain("This server does not offer the Muse lens.");
  });
});

describe("one call", () => {
  const detailOf = (fixture: Fixture, id: string): CallDetail => readCallDetail(fixture.details[id]) as CallDetail;
  const view = (fixture: Fixture, id: string, playhead: number, entry?: "ready") => {
    const detail = detailOf(fixture, id);
    return renderToStaticMarkup(
      createElement(CallView, { row: detail, entry: entry === undefined ? { state: "ready", detail } : undefined, playhead, onRetry: () => undefined }),
    );
  };

  it("puts a fact next to the source sentence it came from, highlighted", () => {
    const html = view(demo, "eff-3895.0", 1e9);
    expect(html).toContain("speaker:S04:availability");
    expect(html).toContain("day 1: all day; day 2: all day; prefers afternoon");
    expect(html).toContain('<mark class="evidence"');
    expect(text(html)).toContain("available Any slot on either day works for me.");
    expect(text(html)).toContain("preference An afternoon slot would suit me best.");
    expect(text(html)).toContain("E04 email Olga Sato <olga.sato@example.org>");
  });

  it("shows the model, effort, tokens, cost and latency of a call", () => {
    const t = text(view(demo, "eff-3895.0", 1e9));
    expect(t).toContain("Spark 1.3");
    expect(t).toContain("effort low");
    expect(t).toContain("3,300");
    expect(t).toContain("3,057 cached · 93%");
    expect(t).toContain("660");
    expect(t).toContain("1,902");
    expect(t).toContain("$0.0088");
    expect(t).toContain("6.9 s");
  });

  it("shows Wonder's plan, a judge's verdict and a blurb in their own forms", () => {
    const plan = text(view(demo, "eff-408.1", 1e9));
    expect(plan).toContain("Wonder 1.0");
    expect(plan).toContain("Root plan");
    expect(plan).toContain("Plan: tracks 3");
    expect(plan).toContain("track-ai");
    expect(plan).toContain("In the model's own words");
    expect(plan).toContain("feasibility Balanced and prima facie feasible");
    const judge = text(view(demo, "eff-6463.1", 1e9));
    expect(judge).toContain("pass");
    expect(judge).toContain("reason 1 All 8 session talks placed exactly once");
    const blurb = text(view(demo, "eff-6190.0", 1e9));
    expect(blurb).toContain("Wrote sessions/track-data/d1/blurb.md");
    expect(blurb).toContain("Join us in Room C");
    const place = text(view(demo, "eff-7433.0", 1e9));
    expect(place).toContain("Placements 8");
  });

  it("says plainly that a cancelled call never completed and was billed an estimate", () => {
    const t = text(view(central, "eff-463.0", 1e9));
    expect(t).toContain("o0.a4 was killed by chaos (kill_agent). It never completed, so it is billed the benchmark's estimate ($0.0075).");
    expect(t).toContain("estimated");
    // Tokens it never measured are not shown as zero: the cached and reasoning shares are not known.
    expect(t).toContain("Reasoning tokens — not known");
    expect(t).not.toContain("0 cached");
  });

  it("reads a small flat answer as text, with a blurb in a quotation", () => {
    const base = detailOf(demo, "eff-6463.1");
    const blurb = "Spend day two in Room B with AI Systems in practice.";
    const answered: CallDetail = {
      ...base,
      facts: null,
      output: { ...base.output, parsed: { blurb }, text: JSON.stringify({ blurb }) },
      decision: { ...base.decision, sentences: [] },
    };
    const html = renderToStaticMarkup(createElement(CallView, { row: answered, entry: { state: "ready", detail: answered }, playhead: 1e9, onRetry: () => undefined }));
    expect(html).toContain('aria-label="Answer"');
    expect(html).toContain('<blockquote class="lens-quote">');
    expect(text(html)).toContain(`blurb ${blurb}`);
    // The raw JSON stays one fold away, as the model wrote it.
    expect(text(html)).toContain("The answer, as the model wrote it");
  });

  it("shows an unfinished call as waiting, without its answer, and a future call as not started", () => {
    const detail = detailOf(demo, "eff-3895.0");
    const during = (detail.started_ts + (detail.ended_ts as number)) / 2;
    const wait = view(demo, "eff-3895.0", during);
    expect(text(wait)).toContain("Waiting for the model");
    expect(wait).not.toContain("<mark");
    expect(wait).not.toContain("Input tokens");
    expect(text(wait)).toContain("What the model was given"); // the prompt is known the moment it starts
    const before = view(demo, "eff-3895.0", detail.started_ts - 1);
    expect(text(before)).toContain("This call starts at");
    expect(before).not.toContain("What the model was given");
  });

  it("draws source text as text, never as markup", () => {
    const detail = detailOf(demo, "eff-3895.0");
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script> Any slot on either day works for me.';
    const first = (detail.facts ?? [])[0];
    const sourceId = first.sources[0];
    const start = hostile.indexOf("Any slot");
    const poisoned: CallDetail = {
      ...detail,
      sources: { ...detail.sources, [sourceId]: { ...(detail.sources ?? {})[sourceId], text: hostile } },
      facts: [{ ...first, evidence: [{ ...first.evidence[0], start, end: start + "Any slot on either day works for me.".length, text: "Any slot on either day works for me." }] }],
    };
    const html = renderToStaticMarkup(createElement(CallView, { row: poisoned, entry: { state: "ready", detail: poisoned }, playhead: 1e9, onRetry: () => undefined }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<mark class="evidence"');
  });

  it("offers a retry when reading the call failed", () => {
    const detail = detailOf(demo, "eff-3895.0");
    const html = renderToStaticMarkup(createElement(CallView, { row: detail, entry: { state: "error", error: "500 boom" }, playhead: 1e9, onRetry: () => undefined }));
    expect(text(html)).toContain("Could not read this call: 500 boom");
    expect(text(html)).toContain("Try again");
  });
});

describe("the takeover chip", () => {
  /** The chip on a finished run whose server answers `takeover`, over `events` (a quiet log by default). */
  const chip = async (takeover: RunApi["takeover"], events: RunEvent[] = log()) => {
    const { run } = await opened(demo, {}, { takeover, loadAllEvents: async () => events });
    await run.getState().runTakeover();
    return text(render(run, TakeoverChip));
  };
  const counted = { ok: true, violations: [], heirs: 0, reclaims: 0, adoptions: 0, kills: 0 };
  const uncounted = { ok: true, violations: [], heirs: null, reclaims: null, adoptions: null, kills: null };
  /** A log in which a goal changed hands. */
  const handedOver = (): RunEvent[] => {
    const s = new Stream().at(0).emit("run.started", "@kernel", { seed: "0", scenario: "t", params: {}, clock: "sim" });
    s.at(900).emit("ownership.remapped", "@kernel", { key: "track-ai", owner: "o2", previous: "o1" }).at(2000).emit("run.completed", "@kernel");
    return s.events;
  };

  it("says Takeover OK when every heir checks out", async () => {
    expect(await chip(async () => ({ ...counted, heirs: 6, adoptions: 5, kills: 5 }))).toBe("Takeover OK ✓ 6 hand-overs");
  });

  it("does not claim a takeover that never happened", async () => {
    expect(await chip(async () => counted)).toBe("No takeover to check");
  });

  it("asks the log when the server does not count: a hand-over earns the claim, a quiet log does not", async () => {
    expect(await chip(async () => uncounted, handedOver())).toBe("Takeover OK ✓");
    expect(await chip(async () => uncounted)).toBe("No takeover to check");
  });

  it("fails loudly", async () => {
    expect(await chip(async () => ({ ...counted, ok: false, violations: [{ check: "succession", kind: "wrong-heir", seq: 7, detail: "x" }], heirs: 1, kills: 1 }))).toBe(
      "Takeover check failed: 1 violation",
    );
  });

  it("shows nothing on a server that does not offer the check", async () => {
    expect(await chip(async () => null)).toBe("");
    expect(await chip(undefined)).toBe("");
  });

  it("says the server's words in its hint, as a hover and as text for a screen reader, and is not a tab stop", async () => {
    const { run } = await opened(demo, {}, { takeover: async () => ({ ...counted, heirs: 6, adoptions: 5, kills: 5 }), loadAllEvents: async () => log() });
    await run.getState().runTakeover();
    const html = render(run, TakeoverChip);
    expect(html).toMatch(/<span class="tip"[^>]*><span class="badge badge--good badge--big">Takeover OK/);
    expect(html).not.toContain("tabindex");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('class="sr-only"');
    expect(html).not.toContain("title=");
  });

  it("says it could not check when the request failed", async () => {
    expect(
      await chip(async () => {
        throw new Error("boom");
      }),
    ).toBe("Takeover check unavailable");
  });
});
