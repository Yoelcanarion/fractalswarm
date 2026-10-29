// What the ablation view reads and says, on the real bodies of the ablation API: the reader refuses what it does not
// understand, the headline and the split are the server's own numbers, and a reading is compared with the approved one.

import { describe, expect, it } from "vitest";

import { createAblationApi } from "./api";
import { readAblation, readStarted } from "./model";
import { ablationOf, fixture, noteOf } from "./testing";
import { ablationRuns, appliedCaveats, compare, filterNotes, headlineOf, percent, scoreParts, soFar, splitCounts, splitOf, statusLine } from "./view";
import type { RunListing } from "../lib/types";

const sample = ablationOf("ablation.sample.json");
const generator = ablationOf("ablation.generator.json");

describe("reading what the server scored", () => {
  it("reads a finished run: every note with both readings and their scores, and the result", () => {
    expect(sample.status).toBe("completed");
    expect(sample.notes.map((note) => note.note_id)).toEqual(["E90", "E91", "E92", "T90", "T91", "T92"]);
    expect(sample.result?.headline).toBe("the parser understood 3 of 6 notes, Muse 5 of 6");
    expect(sample.result?.complete).toBe(true);
    const e90 = noteOf(sample, "E90");
    expect(e90.kind).toBe("email");
    expect(e90.reference_text).toBe("day 1: 14:00-17:00; day 2: all day; prefers afternoon");
    expect(e90.parser.text).toBe("day 1: all day; day 2: all day; no time preference");
    expect(e90.muse.text).toBe(e90.reference_text);
    expect(e90.text.startsWith("Hi! I'm flying in")).toBe(true);
  });

  it("reads a run that is still going, and one that never ended, without a result", () => {
    const running = ablationOf("ablation.running.json");
    expect(running).toMatchObject({ status: "running", result: null, progress: { done: 6, of: 16 } });
    expect(running.notes).toHaveLength(6);
    const cut = ablationOf("ablation.interrupted.json");
    expect(cut).toMatchObject({ status: "interrupted", result: null, progress: { done: 3, of: 6 } });
    // the first three notes the log recorded as scored: the answers come in any order, the view keeps the cases'
    expect(cut.notes.map((note) => note.note_id)).toEqual(["T90", "T91", "T92"]);
  });

  it("reads the start of a run, and tells a new run from one that already existed", () => {
    expect(readStarted(fixture("ablation.started.json"))).toEqual({ ok: true, value: { run_id: "ablation-34a7d710", notes: 16, started: true } });
  });

  it("refuses what it does not understand, naming the field", () => {
    const body = fixture("ablation.sample.json");
    const refuse = (change: (copy: typeof body) => void) => {
      const copy = structuredClone(body);
      change(copy);
      const read = readAblation(copy);
      return read.ok ? "read" : read.reason;
    };
    expect(refuse((c) => (c.status = "paused"))).toContain("ablation.status: expected one of running, completed, halted, failed, interrupted");
    expect(refuse((c) => (c.result.headline = 7))).toContain("ablation.result.headline: expected text");
    expect(refuse((c) => (c.notes[0].muse.score.jaccard = "1"))).toContain("ablation.notes[0].muse.score.jaccard: expected a number");
    expect(refuse((c) => (c.notes[3].kind = "memo"))).toContain("ablation.notes[3].kind");
    expect(refuse((c) => (c.result.agreement.both = -1))).toContain("ablation.result.agreement.both: expected a whole number");
    expect(refuse((c) => delete c.result.caveats)).toContain("ablation.result.caveats");
    // a run that says it completed has to have its result: nothing to show a headline from otherwise
    expect(refuse((c) => (c.result = null))).toContain("a completed run without its result");
    expect(refuse(() => undefined)).toBe("read");
  });

  it("does not accept a body that is not an object", () => {
    for (const raw of [null, "x", 3, []]) expect(readAblation(raw).ok).toBe(false);
  });
});

describe("the headline and the split", () => {
  it("is the brief's line, from the result's tallies", () => {
    expect(headlineOf(sample.result!)).toBe("parser 3 of 6 · Muse 5 of 6");
    expect(headlineOf(generator.result!)).toBe("parser 16 of 16 · Muse 16 of 16");
  });

  it("counts the notes by who understood them, as the server's agreement says", () => {
    expect(splitCounts(sample.notes)).toEqual(sample.result?.agreement);
    expect(splitCounts(generator.notes)).toEqual(generator.result?.agreement);
    expect(sample.result?.agreement).toEqual({ both: 3, only_muse: 2, only_parser: 0, neither: 1 });
  });

  it("counts what each reader understood so far, and it ends where the server's tallies do", () => {
    for (const run of [sample, generator]) {
      const now = soFar(run.notes);
      expect({ parser: now.parser, muse: now.muse, scored: now.scored }).toEqual({ parser: run.result!.parser.understood, muse: run.result!.muse.understood, scored: run.result!.muse.of });
    }
    expect(soFar(ablationOf("ablation.running.json").notes).scored).toBe(6);
  });

  it("says which note each reader got right: Muse alone on E90 and T91, both on E91, T90 and T92, neither on E92", () => {
    expect(["E90", "E91", "E92", "T90", "T91", "T92"].map((id) => splitOf(noteOf(sample, id)))).toEqual(["only_muse", "both", "neither", "both", "only_muse", "both"]);
  });
});

describe("the notes to show", () => {
  const differing = new Set(sample.result!.differences);

  it("is every note, or the ones the server lists as different, or by who understood them", () => {
    expect(filterNotes(sample.notes, "all", differing)).toHaveLength(6);
    expect(filterNotes(sample.notes, "differ", differing).map((n) => n.note_id)).toEqual(["E90", "E92", "T91", "T92"]);
    expect(filterNotes(sample.notes, "only_muse", differing).map((n) => n.note_id)).toEqual(["E90", "T91"]);
    expect(filterNotes(sample.notes, "both", differing).map((n) => n.note_id)).toEqual(["E91", "T90", "T92"]);
    expect(filterNotes(sample.notes, "neither", differing).map((n) => n.note_id)).toEqual(["E92"]);
    expect(filterNotes(sample.notes, "only_parser", differing)).toEqual([]);
    expect(filterNotes(generator.notes, "differ", new Set(generator.result!.differences))).toEqual([]);
  });

  it("does not change the notes it was given", () => {
    const before = sample.notes.map((n) => n.note_id);
    filterNotes(sample.notes, "differ", differing);
    expect(sample.notes.map((n) => n.note_id)).toEqual(before);
  });
});

describe("a reading against the approved one", () => {
  it("marks the parts the approved reading does not have, and lists the parts the reading lacks", () => {
    const e90 = noteOf(sample, "E90");
    const parser = compare(e90.parser.text, e90.reference_text);
    expect(parser.parts).toEqual([
      { text: "day 1: all day", same: false },
      { text: "day 2: all day", same: true },
      { text: "no time preference", same: false },
    ]);
    expect(parser.missing).toEqual(["day 1: 14:00-17:00", "prefers afternoon"]);
    expect(compare(e90.muse.text, e90.reference_text)).toEqual({ parts: e90.reference_text!.split("; ").map((text) => ({ text, same: true })), missing: [] });
  });

  it("has nothing to say when there is no reading or nothing to compare with", () => {
    expect(compare(null, "day 1: all day")).toEqual({ parts: [], missing: [] });
    expect(compare("day 1: all day", null)).toEqual({ parts: [{ text: "day 1: all day", same: true }], missing: [] });
  });

  it("scores in words: an email by its cells and preference, an abstract by how far off it is", () => {
    expect(scoreParts(noteOf(sample, "E90"), "parser")).toEqual(["cells not exact (Jaccard 0.72)", "preference wrong"]);
    expect(scoreParts(noteOf(sample, "E90"), "muse")).toEqual(["cells exact", "preference right"]);
    expect(scoreParts(noteOf(sample, "T90"), "parser")).toEqual(["exact"]);
    expect(scoreParts(noteOf(sample, "T92"), "parser")).toEqual(["5.0 % off", "within 10 %"]);
    expect(scoreParts(noteOf(sample, "T91"), "parser")[0]).toMatch(/% off|no reading/);
    expect(percent(21.1111)).toBe("21.1 %");
  });

  it("says there is no reading when a reader gave none", () => {
    const note = structuredClone(noteOf(sample, "E92"));
    note.muse.text = null;
    expect(scoreParts(note, "muse")).toEqual(["no reading"]);
    expect(scoreParts(note, "parser")).not.toEqual(["no reading"]);
  });
});

describe("what the page says about the run", () => {
  it("shows the caveats the result says apply, as it wrote them, and not the others", () => {
    expect(appliedCaveats(sample.result!).map((c) => c.id)).toEqual(["reference", "fake"]);
    expect(appliedCaveats(generator.result!).map((c) => c.id)).toEqual(["generator", "fake"]);
    for (const caveat of appliedCaveats(generator.result!)) expect(generator.result!.caveats.find((c) => c.id === caveat.id)?.text).toBe(caveat.text);
    // the practice backend's Muse is the parser: whoever reads the headline is told so
    expect(appliedCaveats(generator.result!).find((c) => c.id === "fake")?.text).toContain("agree by construction");
  });

  it("is silent about a clean finished run, and says what is wrong with any other", () => {
    expect(statusLine(sample)).toBeNull();
    expect(statusLine(ablationOf("ablation.running.json"))).toBe("Scoring: 6 of 16 notes.");
    expect(statusLine(ablationOf("ablation.interrupted.json"))).toContain("so there is no result");
    expect(statusLine({ ...sample, status: "failed", error: "RuntimeError: boom", result: null })).toBe("The run failed: RuntimeError: boom. These are the notes scored so far.");
    expect(statusLine({ ...sample, status: "halted", result: null })).toContain("halted");
    expect(statusLine({ ...sample, result: { ...sample.result!, complete: false } })).toContain("The deadline cut this run");
  });

  it("finds the ablation runs among the runs the server lists", () => {
    const listing = fixture("runs.json") as RunListing[];
    expect(ablationRuns(listing).map((run) => run.id)).toEqual(["ablation-34a7d710", "ablation-sample"]);
    expect(ablationRuns([])).toEqual([]);
  });
});

describe("the calls", () => {
  const answer = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("reads a run by its id, and says what the server said when it has none", async () => {
    const seen: string[] = [];
    const api = createAblationApi(async (input, init) => {
      seen.push(`${init?.method ?? "GET"} ${input}`);
      return input.endsWith("nope") ? new Response(JSON.stringify(fixture("error.unknown-run.json").body), { status: 404 }) : new Response(JSON.stringify(fixture("ablation.sample.json")));
    });
    const found = await api.status("ablation-sample");
    expect(found.ok && found.body.result?.headline).toBe("the parser understood 3 of 6 notes, Muse 5 of 6");
    expect(await api.status("nope")).toEqual({ ok: false, status: 404, error: "no ablation 'ablation-nope'" });
    expect(seen).toEqual(["GET api/ablation/ablation-sample", "GET api/ablation/nope"]);
  });

  it("starts the generator's notes on the practice backend, as JSON, and nothing else", async () => {
    let sent: RequestInit | undefined;
    const api = createAblationApi(async (_input, init) => {
      sent = init;
      return answer(fixture("ablation.started.json"), 202)();
    });
    const started = await api.start({ emails: 4, abstracts: 4, seed: 2 });
    expect(started).toMatchObject({ ok: true, body: { run_id: "ablation-34a7d710", started: true } });
    expect(sent?.method).toBe("POST");
    expect(sent?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(sent?.body))).toEqual({ source: "generator", backend: "fake", emails: 4, abstracts: 4, seed: 2 });
  });

  it("says what the server said when it refuses", async () => {
    const real = fixture("error.real-backend.json");
    const refused = await createAblationApi(answer(real.body, real.status)).start({});
    expect(refused).toMatchObject({ ok: false, status: 501 });
    const none = fixture("error.no-notes.json");
    expect(await createAblationApi(answer(none.body, none.status)).start({ emails: 0, abstracts: 0 })).toEqual({ ok: false, status: 422, error: none.body.error });
  });

  it("never sends the real backend: that is started from the CLI, with the cost check there", async () => {
    let body = "";
    const api = createAblationApi(async (_input, init) => {
      body = String(init?.body);
      return answer(fixture("ablation.started.json"), 202)();
    });
    await api.start({ emails: 1 });
    expect(JSON.parse(body).backend).toBe("fake");
  });
});
