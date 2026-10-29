// The panel drawn on the server (react-dom/server) over the bench's own file: no browser, but every render
// path runs, and what a reader must always find (the losses, the failure model of every row) is checked in
// the markup. The look is checked on screenshots.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { systemName } from "../assumptions";
import { CLAIMS } from "./claims";
import { HelpsView } from "./HelpsPage";
import { regimeRows } from "./regime";
import { occurrences, parsedSample, plainText } from "./testing";
import { WhereItHelps, type WhereItHelpsProps } from "./WhereItHelps";

const render = (props: Partial<WhereItHelpsProps> = {}): string => renderToStaticMarkup(createElement(WhereItHelps, { honesty: parsedSample(), source: "api", ...props }));

const PLACEHOLDER = "Placeholder wording, pending the decision gate";

describe("the outcome strip", () => {
  it("says which outcome the decision rule read, against whom, and what it read at the default settings", () => {
    const text = plainText(render());
    expect(text).toContain("Pre-registered outcome B, read against the ideal durable supervisor on T2 conference.");
    expect(text).toContain("At the default settings:");
    expect(text).toContain("C2 ties");
    expect(text).toContain("C3 ties");
  });

  it("quotes the headline the outcome allows and the conditions next to it, in the words of docs/claims.md", () => {
    const text = plainText(render());
    expect(text).toContain(`“${CLAIMS.R2.text}”`);
    expect(text).toContain(CLAIMS.R3.text);
    expect(text).not.toContain(CLAIMS.R1.text);
  });

  it("marks a claim that docs/claims.md still has pending as placeholder wording, and only those", () => {
    const shown = [CLAIMS.R2, CLAIMS.R3];
    expect(occurrences(render(), PLACEHOLDER)).toBe(shown.filter((claim) => claim.placeholder).length);
  });

  it("marks the bundled copy as a sample, and the server's as none", () => {
    expect(plainText(render({ source: "sample" }))).toContain("Sample data");
    expect(plainText(render({ source: "api" }))).not.toContain("Sample data");
  });
});

describe("the losses", () => {
  it("are in the totals of every rival", () => {
    const html = render();
    for (const losses of [33, 27, 8]) expect(occurrences(html, `aria-label="${losses} losses"`), `${losses} losses`).toBe(1);
  });

  it("are one click from their list, per hypothesis and rival", () => {
    const html = render();
    expect(html).toContain("H1 Preserved work against the ideal durable supervisor: 4 losses, list them");
    expect(html).toContain("H5 Unnecessary reassignments against the ideal durable supervisor: 20 losses, list them");
  });

  it("are drawn on the map as a cross, with the verdict in words in the hint, not by colour alone", () => {
    const html = render();
    expect(occurrences(html, "rcell--fails")).toBe(2);
    expect(occurrences(plainText(html), "locality fails against the ideal durable supervisor")).toBe(2);
  });

  it("include the per-process loss on time to recover, in the section that names that model", () => {
    const text = plainText(render());
    expect(occurrences(text, "Supervisor lower")).toBe(1);
    expect(text).toContain("47.3 s");
    expect(text).toContain("9.45×");
  });

  it("open as a list as long as the count they came from, one row each, with the button that opened it pressed", () => {
    const html = render({ open: { hypothesis: "H5", rival: "durable-max", which: "loss" } });
    expect(plainText(html)).toContain("Where the swarm lost: H5 Unnecessary reassignments against the ideal durable supervisor (20)");
    expect(occurrences(html, '<th scope="row">')).toBe(20);
    expect(occurrences(html, 'aria-pressed="true"')).toBe(1);
  });
});

describe("the failure model", () => {
  it("is named on every row of the map, every row of the table, the outcome and the per-process section", () => {
    const h = parsedSample();
    const html = render();
    const mapRows = regimeRows(h, h.outcome.against).length;
    // the outcome, the map's head and the table's head, then a tag on each map row, each hypothesis and the total
    expect(occurrences(html, 'data-model="crash"')).toBe(3 + mapRows + h.hypotheses.length + 1);
    expect(occurrences(html, 'data-model="process"')).toBe(1);
  });

  it("says how many crashes a sweep ran", () => {
    expect(occurrences(plainText(render()), "Per crash · 5 crashes (C3)")).toBe(5);
  });
});

describe("the rival the map and the per-process view are read against", () => {
  it("starts on the one the outcome is read against", () => {
    expect(plainText(render())).toContain("Against the ideal durable supervisor: locality holds at 7 of 27 settings, ties at 18 and fails at 2.");
  });

  it("starts on the one asked for, and ignores one the file does not have", () => {
    expect(plainText(render({ rival: "central" }))).toContain(`Against the ${systemName("central")}: locality holds at 2 of 6 settings, ties at 4 and fails at 0.`);
    expect(plainText(render({ rival: "nobody" }))).toBe(plainText(render()));
  });

  it("lists every rival of the file to switch to", () => {
    const html = render();
    expect(occurrences(html, "<option")).toBe(3);
    for (const name of ["Ideal durable supervisor", "Durable supervisor", "In-process supervisor"]) expect(html).toContain(`>${name}<`);
  });
});

describe("what the panel does not say", () => {
  it("claims nothing docs/claims.md lists under 'Not claimed'", () => {
    expect(plainText(render({ open: { hypothesis: "H2", rival: "durable-max", which: "tie" } }))).not.toMatch(/\b(simpler|cheaper|more reliable)\b/i);
  });
});

describe("the page", () => {
  const view = (state: Parameters<typeof HelpsView>[0]["state"]): string => renderToStaticMarkup(createElement(HelpsView, { state }));

  it("holds a place while the file loads", () => {
    expect(plainText(view({ status: "loading" }))).toContain("Loading the verdicts");
  });

  it("says why a file cannot be read, and shows none of it", () => {
    const text = plainText(view({ status: "invalid", reason: 'comparisons[3].verdict: unexpected "maybe"', source: "api" }));
    expect(text).toContain("The verdicts could not be read (the server's honesty.json)");
    expect(text).toContain('comparisons[3].verdict: unexpected "maybe"');
    expect(text).not.toContain("Regime map");
    expect(plainText(view({ status: "invalid", reason: "x", source: "sample" }))).toContain("(the bundled sample)");
  });

  it("draws the panel for a file it could read", () => {
    const text = plainText(view({ status: "ready", honesty: parsedSample(), source: "sample" }));
    expect(text).toContain("Regime map");
    expect(text).toContain("Wins, ties and losses");
    expect(text).toContain("Per process");
    expect(text).toContain("Sample data");
  });
});
