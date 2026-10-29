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

const render = (props: Partial<WhereItHelpsProps> = {}): string => renderToStaticMarkup(createElement(WhereItHelps, { honesty: parsedSample(), ...props }));

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

  it("never calls the file a sample: it is the committed results, or nothing is shown", () => {
    expect(plainText(render())).not.toMatch(/sample/i);
  });
});

describe("the losses", () => {
  it("are one click from their list, per hypothesis and rival, with the file's own count", () => {
    const html = render();
    expect(html).toContain("H1 Preserved work against the ideal durable supervisor: 4 losses, list them");
    expect(html).toContain("H4a Locality: coordinator-dependency time against the ideal durable supervisor: 2 losses, list them");
    expect(html).toContain("H4a Locality: coordinator-dependency time against the durable supervisor: 1 loss, list them");
    expect(html).toContain("H5 Unnecessary reassignments against the ideal durable supervisor: 20 losses, list them");
  });

  it("are in the file's own total for each rival, which the table shows as the file gives it", () => {
    const html = render();
    expect(plainText(html)).toContain("All H1 to H6");
    for (const total of [33, 27, 8]) expect(occurrences(html, `aria-label="${total} losses"`), `${total} losses`).toBe(1);
  });

  it("are not added up by the panel: a file without totals gets none, whatever its rows would sum to", () => {
    const h = { ...parsedSample(), tallyByRival: {}, localityByRival: {} };
    const html = render({ honesty: h });
    const text = plainText(html);
    expect(text).not.toContain("All H1 to H6");
    for (const total of [33, 27, 8]) expect(html).not.toContain(`aria-label="${total} losses"`);
    expect(text).not.toMatch(/locality holds at \d/);
    expect(text).not.toMatch(/\d+ of \d+ swarm settings/);
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

describe("the names", () => {
  it("call each row of the map as bench/PREREG.md §5 calls the assumption it checks", () => {
    const text = plainText(render());
    for (const name of ["Gate", "Failure detection", "Restart or failover time", "Fast external restart", "Coordination density", "Width"]) expect(text, name).toContain(name);
  });
});

describe("the note about H5", () => {
  it("gives the file's false deaths at the gate, the swarm's next to the rival's", () => {
    expect(plainText(render())).toContain(
      "At the gate on T2 conference (C3) it did so 2.25 times per run on average, 4 at most; the ideal durable supervisor, which has no detector, did so 0 times.",
    );
  });
});

describe("the per-process section", () => {
  it("counts the swarm's coordinators by level and does not sum them", () => {
    const text = plainText(render());
    expect(text).toContain("the swarm, with 1 + 3 + 6 coordinators by level of its tree, sees 1 + 3 + 6 times the crashes of one ideal durable supervisor");
    expect(text).not.toMatch(/= ?10\b/);
  });
});

describe("the rival the map and the per-process view are read against", () => {
  it("starts on the one the outcome is read against", () => {
    expect(plainText(render())).toContain("Against the ideal durable supervisor: locality holds at 7 settings, ties at 18 and fails at 2.");
  });

  it("says no count when the file gives none", () => {
    const h = { ...parsedSample(), localityByRival: {} };
    expect(plainText(render({ honesty: h }))).toContain("Against the ideal durable supervisor: at each setting the swarm's recovery stays local (holds), ties or fails.");
  });

  it("starts on the one asked for, and ignores one the file does not have", () => {
    expect(plainText(render({ rival: "central" }))).toContain(`Against the ${systemName("central")}: locality holds at 2 settings, ties at 4 and fails at 0.`);
    expect(occurrences(render({ rival: "central" }), 'class="map__row"')).toBe(2);
    expect(plainText(render({ rival: "nobody" }))).toBe(plainText(render()));
  });

  it("lists every rival of the file to switch to", () => {
    const html = render();
    expect(occurrences(html, "<option")).toBe(3);
    for (const name of ["Ideal durable supervisor", "Durable supervisor", "In-process supervisor"]) expect(html).toContain(`>${name}<`);
  });

  it("gives the legend the rule's own number, not one of its own", () => {
    expect(plainText(render())).toContain("A win needs every seed to reach 0.5× or lower, so a mean under 0.5× can still tie.");
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

  it("says plainly that there are no verdicts when the server has no file, and shows nothing in their place", () => {
    const text = plainText(view({ status: "missing" }));
    expect(text).toContain("No verdicts yet: the server has no bench/results/honesty.json (GET /api/bench/honesty answered 404).");
    expect(text).toContain("fractalswarm bench verdicts <results dirs> --prereg");
    expect(text).not.toContain("Regime map");
  });

  it("says why the file could not be loaded or read, and shows none of it", () => {
    const unreachable = plainText(view({ status: "unreachable", reason: "the server answered 500" }));
    expect(unreachable).toContain("The verdicts could not be loaded: the server answered 500.");
    const invalid = plainText(view({ status: "invalid", reason: 'comparisons[3].verdict: unexpected "maybe"' }));
    expect(invalid).toContain('The verdicts could not be read: comparisons[3].verdict: unexpected "maybe".');
    for (const text of [unreachable, invalid]) expect(text).not.toContain("Regime map");
  });

  it("draws the panel for a file it could read", () => {
    const text = plainText(view({ status: "ready", honesty: parsedSample() }));
    expect(text).toContain("Regime map");
    expect(text).toContain("Wins, ties and losses");
    expect(text).toContain("Per process");
  });
});
