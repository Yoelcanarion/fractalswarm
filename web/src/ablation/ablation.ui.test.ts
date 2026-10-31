// The ablation view drawn on the server (react-dom/server) over the real bodies of the ablation API: no browser, but every
// render path runs, and what a reader must always find (the headline in its form, the caveats right under it, each reading
// against the approved one, ✓ or ✗ with words) is checked in the markup. The look is checked on screenshots.

import { readdirSync, readFileSync } from "node:fs";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { occurrences, plainText, visibleText } from "../arena/helps/testing";
import type { RunListing } from "../lib/types";
import { AblationBanner, AblationFailed, AblationFlow, Launcher } from "./AblationPage";
import { AblationView, type AblationViewProps } from "./AblationView";
import { createAblationApi } from "./api";
import { ablationOf, fixture } from "./testing";
import type { Filter } from "./view";
import { ablationRuns } from "./view";

const html = <P extends object>(component: FunctionComponent<P>, props: P): string => renderToStaticMarkup(createElement(component, props));
const never = createAblationApi(() => new Promise(() => undefined));
const nothing = () => undefined;

const sample = ablationOf("ablation.sample.json");
const generator = ablationOf("ablation.generator.json");
const running = ablationOf("ablation.running.json");
const interrupted = ablationOf("ablation.interrupted.json");

const view = (run = sample, filter: Filter = "all"): string => html(AblationView, { run, filter, onFilter: nothing } satisfies AblationViewProps);
/** What React writes for a text inside markup, as the open hint holds it. */
const esc = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
/** The hint that opens on hover, as the markup holds it closed. */
const hint = (text: string): string => `role="tooltip" class="tip__bubble">${esc(text)}</span>`;
/** The markup of one note's row. */
const rowOf = (markup: string, id: string): string => new RegExp(`<tr class="abl__row[^"]*" id="note-${id}">[\\s\\S]*?</tr>`).exec(markup)?.[0] ?? "";

describe("the headline", () => {
  it("is the brief's line, from the result's tallies, with the server's sentence behind it", () => {
    const markup = view();
    expect(plainText(markup)).toContain("parser 3 of 6 · Muse 5 of 6");
    // the server's sentence is text a screen reader reads in place of the shorthand, not something to hover
    expect(markup).toContain('<span class="sr-only">the parser understood 3 of 6 notes, Muse 5 of 6</span>');
    expect(markup).toContain('class="abl__parser" aria-hidden="true"');
    expect(markup).not.toContain('title="the parser understood');
    expect(plainText(view(generator))).toContain("parser 16 of 16 · Muse 16 of 16");
  });

  it("is read as it stands while there is no sentence from the server yet", () => {
    const markup = view({ ...sample, result: null, status: "running" });
    expect(markup).not.toContain('class="abl__parser" aria-hidden');
    expect(markup).not.toContain("the parser understood");
  });

  it("says it is the notes scored so far, until the server gives its tallies, and shows the progress", () => {
    const markup = view(running);
    const text = plainText(markup);
    expect(text).toContain("So far");
    expect(text).toContain("parser 6 of 6 · Muse 6 of 6");
    expect(text).toContain("Scoring: 6 of 16 notes.");
    expect(markup).toMatch(/<progress[^>]*value="6"[^>]*max="16"/);
    expect(plainText(view())).not.toContain("So far");
  });

  it("says what is wrong with a run that did not finish, and gives no result for it", () => {
    const text = plainText(view(interrupted));
    expect(text).toContain("so there is no result");
    // three notes were scored when the log stopped: Muse understood all three, the parser two
    expect(text).toContain("parser 2 of 3 · Muse 3 of 3");
    expect(view(interrupted)).toContain('role="alert"');
    const failed = plainText(view({ ...sample, status: "failed", error: "RuntimeError: boom", result: null }));
    expect(failed).toContain("The run failed: RuntimeError: boom.");
    const cut = plainText(view({ ...sample, result: { ...sample.result!, complete: false } }));
    expect(cut).toContain("The deadline cut this run");
  });
});

describe("the caveats", () => {
  it("are the ones the result says apply, in its words, between the headline and the notes", () => {
    const markup = view();
    const text = plainText(markup);
    const fake = sample.result!.caveats.find((c) => c.id === "fake")!.text;
    const reference = sample.result!.caveats.find((c) => c.id === "reference")!.text;
    const generated = sample.result!.caveats.find((c) => c.id === "generator")!.text;
    expect(text).toContain(fake);
    expect(text).toContain(reference);
    expect(text).not.toContain(generated);
    expect(text.indexOf("parser 3 of 6")).toBeLessThan(text.indexOf(fake));
    expect(text.indexOf(fake)).toBeLessThan(text.indexOf("Approved reading"));
    expect(text).toContain("Practice backend.");
    expect(plainText(view(generator))).toContain(generator.result!.caveats.find((c) => c.id === "generator")!.text);
  });

  it("are not guessed before the result is there", () => {
    const text = plainText(view(running));
    expect(text).toContain("The caveats come with the result.");
    expect(text).not.toContain("agree by construction");
  });
});

describe("by kind and by who understood", () => {
  it("gives the server's tallies for emails and abstracts, with the definitions behind the terms", () => {
    const markup = view();
    const text = visibleText(markup);
    expect(text).toContain("Emails understood 1 of 3 2 of 3");
    expect(text).toContain("cells exact 1 of 3 3 of 3");
    expect(text).toContain("preference right 2 of 3 2 of 3");
    expect(text).toContain("mean Jaccard 0.76 1.00");
    expect(text).toContain("Abstracts understood 2 of 3 3 of 3");
    expect(text).toContain("mean error 21.1 % 0.0 %");
    // the definitions open from the keyboard: the terms are tab stops, and the words are in the markup, not in a title
    expect(markup).toContain(hint(sample.result!.definitions.jaccard));
    expect(markup).toContain(hint(sample.result!.definitions.understood));
    expect(markup).not.toMatch(/<th[^>]* title=/);
  });

  it("splits the notes between both, only Muse, only the parser and neither, as the server counts them", () => {
    const markup = view();
    expect(plainText(markup)).toContain("Both understood 3 Only Muse 2 Only the parser 0 Neither 1");
    // only the splits that have a note get a segment of the bar
    expect(occurrences(markup, 'class="abl__seg abl__seg--')).toBe(3);
    expect(markup).toContain('aria-label="Both understood 3, Only Muse 2, Only the parser 0, Neither 1"');
  });
});

describe("the notes", () => {
  it("shows every note with the approved reading and both readers' readings, as text", () => {
    const markup = view();
    for (const id of ["E90", "E91", "E92", "T90", "T91", "T92"]) expect(rowOf(markup, id), id).not.toBe("");
    const text = plainText(rowOf(markup, "E90"));
    expect(text).toContain("Hi! I'm flying in on the red-eye");
    expect(text).toContain("day 1: 14:00-17:00; day 2: all day; prefers afternoon".split("; ")[0]);
  });

  it("marks each reading ✓ or ✗ in words, and the notes where the two readings differ", () => {
    const markup = view();
    const e90 = rowOf(markup, "E90");
    // each cell's mark is the one its own score gives: the parser missed E90, Muse got it
    const cell = (kind: "yes" | "no") => new RegExp(`<td class="abl__cell abl__cell--${kind}">[\\s\\S]*?</td>`).exec(e90)?.[0] ?? "";
    expect(cell("no")).toContain('aria-label="not understood"');
    expect(cell("no")).toContain("✗");
    expect(cell("yes")).toContain('aria-label="understood"');
    expect(cell("yes")).toContain("✓");
    expect(cell("yes")).not.toContain("not understood");
    expect(occurrences(e90, 'aria-label="understood"') + occurrences(e90, 'aria-label="not understood"')).toBe(2);
    expect(occurrences(markup, "abl__row--differs")).toBe(4);
    expect(occurrences(markup, "readings differ")).toBe(4);
    expect(rowOf(markup, "E91")).not.toContain("abl__row--differs");
    // said on the filter that finds them (the hint, and its copy for a screen reader), not again on each of the four rows
    expect(markup).toContain(hint(sample.result!.definitions.differences));
    expect(occurrences(markup, esc(sample.result!.definitions.differences))).toBe(2);
    expect(e90).not.toContain("title=");
  });

  it("highlights what a reading has wrong against the approved one, and lists what it lacks", () => {
    const e90 = rowOf(view(), "E90");
    // the parser's cell: the parts the approved reading does not have are marked, the part it has is not
    const parser = /<td class="abl__cell abl__cell--no">[\s\S]*?<\/td>/.exec(e90)?.[0] ?? "";
    expect(parser).toContain('<li class="abl__off">day 1: all day</li>');
    expect(parser).toContain('<li class="abl__off">no time preference</li>');
    expect(parser).toContain("<li>day 2: all day</li>");
    expect(plainText(parser)).toContain("Missing: day 1: 14:00-17:00; prefers afternoon");
    expect(plainText(parser)).toContain("cells not exact (Jaccard 0.72) · preference wrong");
    // Muse's cell says the same as the approved reading: nothing marked, nothing missing
    const muse = /<td class="abl__cell abl__cell--yes">[\s\S]*?<\/td>/.exec(e90)?.[0] ?? "";
    expect(muse).not.toContain("abl__off");
    expect(muse).not.toContain("Missing");
  });

  it("scores an abstract by how far off it is", () => {
    const t92 = plainText(rowOf(view(), "T92"));
    expect(t92).toContain("5.0 % off · within 10 %");
    expect(plainText(rowOf(view(), "T90"))).toContain("exact");
  });

  it("says why Muse has no reading when it has none", () => {
    const run = structuredClone(sample);
    const note = run.notes.find((n) => n.note_id === "E91")!;
    note.muse.text = null;
    note.muse.error = "the budget refused the call";
    note.muse.score = { understood: false, cells_exact: false, jaccard: 0, preference: false };
    const row = plainText(rowOf(view(run), "E91"));
    expect(row).toContain("No reading: the budget refused the call");
    expect(row).toContain("no reading");
  });

  it("never reads a note as markup: a tag in a note is text", () => {
    const run = structuredClone(sample);
    run.notes[0].text = "Hi <script>alert(1)</script> <img src=x onerror=alert(2)>";
    const markup = view(run);
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("filters by who understood, or where the readings differ, and counts each", () => {
    expect(occurrences(view(sample, "differ"), 'id="note-')).toBe(4);
    expect(occurrences(view(sample, "only_muse"), 'id="note-')).toBe(2);
    expect(occurrences(view(sample, "neither"), 'id="note-')).toBe(1);
    expect(view(sample, "only_parser")).toContain("No note matches.");
    const text = plainText(view());
    expect(text).toContain("All notes (6)");
    expect(text).toContain("Where they differ (4)");
    expect(text).toContain("Only Muse (2)");
    expect(text).toContain("Neither (1)");
    expect(occurrences(view(), "<select")).toBe(1);
    expect(view(sample, "differ")).toMatch(/<option(?=[^>]*value="differ")(?=[^>]*selected="")/);
  });

  it("cannot filter on a difference before the server has said which notes differ", () => {
    expect(view(running)).toMatch(/<option(?=[^>]*value="differ")(?=[^>]*disabled="")[^>]*>Where they differ/);
    expect(view({ ...sample, notes: [], result: null, status: "running" })).toContain("No note has been scored yet.");
  });
});

describe("starting and picking an ablation", () => {
  const launcher = (runs: RunListing[] | null): string => html(Launcher, { api: never, runs });

  it("starts at no cost with the defaults the server uses, and says the practice backend is what runs", () => {
    const markup = launcher([]);
    const text = plainText(markup);
    expect(markup).toContain('value="8"');
    expect(text).toContain("Run at no cost");
    expect(text).toContain("practice backend, which costs nothing");
    expect(text).toContain("0 to 200 of each kind");
    expect(/<button[^>]*>Run at no cost<\/button>/.exec(markup)?.[0]).not.toContain("disabled");
  });

  it("has one button in view, and the notes, the seed and the long list of runs under Details", () => {
    const markup = launcher(ablationRuns(fixture("runs.json") as RunListing[]));
    expect(markup).toContain('<details id="more" class="disclosure disclosure--inline">');
    expect(markup.indexOf("Run at no cost")).toBeLessThan(markup.indexOf('<details id="more"'));
    expect(markup.indexOf('<details id="more"')).toBeLessThan(markup.indexOf('value="8"'));
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `ablation-${i}`, status: "completed" }) as RunListing);
    const long = launcher(many);
    expect(long).toContain('<details id="all" class="disclosure disclosure--inline">');
    expect(long).toContain("All 6 comparisons on record");
    expect(long.indexOf("ablation-3")).toBeLessThan(long.indexOf('<details id="all"'));
    expect(long.indexOf("ablation-4")).toBeGreaterThan(long.indexOf('<details id="all"'));
    expect(launcher(ablationRuns(fixture("runs.json") as RunListing[]))).not.toContain('<details id="all"');
  });

  it("lists the ablations on record, from the runs the server lists", () => {
    const markup = launcher(ablationRuns(fixture("runs.json") as RunListing[]));
    expect(markup).toContain('<a href="#/ablation/ablation-34a7d710">ablation-34a7d710</a>');
    expect(markup).toContain('<a href="#/ablation/ablation-sample">ablation-sample</a>');
    expect(markup).not.toContain("demo-toy");
    expect(plainText(launcher([]))).toContain("No comparison has been recorded here yet.");
    expect(plainText(launcher(null))).toContain("Loading the comparisons on record…");
  });

  it("says when the runs could not be listed, instead of saying none were recorded, and offers to ask again", () => {
    const markup = html(Launcher, { api: never, runs: null, listError: "502 Bad Gateway", onRetryList: nothing });
    const text = plainText(markup);
    expect(text).toContain("Could not list the comparisons on record (502 Bad Gateway).");
    expect(text).toContain("Try again");
    expect(text).not.toContain("No comparison has been recorded");
    expect(markup).toContain('role="alert"');
    expect(plainText(html(Launcher, { api: never, runs: null, listError: "502 Bad Gateway" }))).not.toContain("Try again");
  });

  it("opens with the page's head: what the comparison is for, with Muse defined where it is named", () => {
    const markup = launcher([]);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('<h1 class="pagehead__title">Model vs parser</h1>');
    expect(plainText(markup)).toContain("Is the model really doing the work? The same messy notes go to a hand-written parser and to Muse");
    expect(plainText(markup)).toContain("each reading is scored against the one a person approved.");
    expect(markup).toContain('<span class="term">Muse</span>');
    expect(markup).toContain("Meta&#x27;s model family");
  });
});

describe("the flow", () => {
  const flow = (runId: string | null): string => html(AblationFlow, { api: never, runId, loadRuns: async () => [] });

  it("opens the launcher with no run, and waits on the server with one", () => {
    expect(plainText(flow(null))).toContain("Run the comparison");
    const waiting = flow("ablation-sample");
    expect(plainText(waiting)).toContain("Loading the comparison…");
    expect(waiting).toContain('href="#/ablation"');
    expect(plainText(waiting)).toContain("ablation-sample");
  });

  it("keeps the head while it waits, and holds the result's place with a skeleton so the page does not jump", () => {
    const waiting = flow("ablation-sample");
    expect(waiting).toContain('<h1 class="pagehead__title">Model vs parser</h1>');
    expect(waiting).toContain("skeleton-group--stack");
    expect(waiting).toContain('role="status"');
    expect(waiting).toContain("All comparisons");
  });

  it("says when an ablation could not be loaded, and says how to go on", () => {
    const markup = html(AblationFailed, { problem: { message: "no such run", retrying: false }, onRetry: nothing });
    expect(plainText(markup)).toContain("This comparison could not be loaded");
    expect(plainText(markup)).toContain("no such run");
    expect(plainText(markup)).not.toContain("Asking again");
    expect(plainText(markup)).toContain("Try again");
    expect(markup).toContain('href="#/ablation"');
    expect(markup).toContain('role="alert"');
    const restarting = html(AblationFailed, { problem: { message: "the server is not reachable", retrying: true }, onRetry: nothing });
    expect(plainText(restarting)).toContain("Asking again every 2 seconds.");
  });

  it("puts that it asks again on a line of its own, whatever the server's words end in: a reason with no full stop, or a command", () => {
    for (const message of ["could not reach the server: Failed to fetch", "An ablation needs the local server. Run it yourself: uv run fractalswarm demo --verify"]) {
      const failed = html(AblationFailed, { problem: { message, retrying: true }, onRetry: nothing });
      expect(failed).toContain(`${message} <span class="abl__again">Asking again every 2 seconds.</span>`);
      const banner = html(AblationBanner, { problem: { message, retrying: true }, onRetry: nothing });
      expect(banner).toContain(`${message} <span class="abl__again">Asking again every 2 seconds.</span>`);
    }
    expect(html(AblationFailed, { problem: { message: "no such run", retrying: false }, onRetry: nothing })).not.toContain("abl__again");
    const css = readFileSync(new URL("ablation.css", import.meta.url), "utf-8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/\.abl__again \{\s*display: block;/);
  });

  it("keeps what was loaded when asking again fails, with the reason above it", () => {
    const stopped = html(AblationBanner, { problem: { message: "the server stopped", retrying: false }, onRetry: nothing });
    expect(plainText(stopped)).toContain("the server stopped");
    expect(plainText(stopped)).toContain("Try again");
    const going = html(AblationBanner, { problem: { message: "the server stopped", retrying: true }, onRetry: nothing });
    expect(plainText(going)).toContain("Asking again every 2 seconds.");
    expect(plainText(going)).not.toContain("Try again");
    const top = view({ ...sample }, "all");
    expect(top).not.toContain("pagehead");
    const withTop = html(AblationView, { run: sample, filter: "all", onFilter: nothing, top: createElement("p", { className: "marker" }, "above") });
    expect(withTop.indexOf("above")).toBeLessThan(withTop.indexOf('aria-label="Headline"'));
  });
});

describe("what the page never does", () => {
  const codeOf = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const sources = readdirSync(new URL(".", import.meta.url))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name))
    .map((name) => ({ name, code: codeOf(readFileSync(new URL(name, import.meta.url), "utf-8")) }));

  it("looks at every source file of the view", () => {
    expect(sources.length).toBeGreaterThanOrEqual(8);
  });

  it("does not render a note as markup, keep one in the browser's storage, or call the server on its own", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
      expect(code, name).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(code, name).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon/);
    }
  });

  it("starts only the practice backend: the real one is started from the CLI, with the cost check there", () => {
    const api = sources.find((source) => source.name === "api.ts")!.code;
    expect(api).toContain('backend: "fake"');
    expect(api).not.toMatch(/backend:\s*"real"|"real"/);
  });
});
