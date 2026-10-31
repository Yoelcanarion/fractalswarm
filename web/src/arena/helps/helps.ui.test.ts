// The panel drawn on the server (react-dom/server) over the bench's own file: no browser, but every render
// path runs, and what a reader must always find (the losses, the failure model of every row) is checked in
// the markup. The look is checked on screenshots.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { systemName } from "../assumptions";
import { CLAIMS, type Claims } from "./claims";
import { HelpsView, type HelpsViewProps } from "./HelpsPage";
import { regimeRows } from "./regime";
import { occurrences, parsedSample, plainText, visibleText } from "./testing";
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
    expect(occurrences(render(), PLACEHOLDER)).toBe(shown.filter((claim) => claim.status === "pending").length);
    const pending: Claims = { ...CLAIMS, R2: { ...CLAIMS.R2, status: "pending" }, R3: { ...CLAIMS.R3, status: "allowed" } };
    expect(occurrences(render({ claims: pending }), PLACEHOLDER)).toBe(1);
    const both: Claims = { ...pending, R3: { ...CLAIMS.R3, status: "pending" } };
    expect(occurrences(render({ claims: both }), PLACEHOLDER)).toBe(2);
  });

  it("gives an allowed claim the status docs/claims.md gives it, in its words, where the evidence it rests on is told", () => {
    const text = plainText(render());
    expect(text).toContain(`Status in docs/claims.md: ${CLAIMS.R2.note}`);
    expect(text).toContain(`Status in docs/claims.md: ${CLAIMS.R3.note}`);
    const pending: Claims = { ...CLAIMS, R2: { ...CLAIMS.R2, status: "pending" } };
    expect(plainText(render({ claims: pending }))).not.toContain(`Status in docs/claims.md: ${CLAIMS.R2.note}`);
  });

  it("quotes a claim docs/claims.md does not allow nowhere, and says there is no headline instead", () => {
    const refused: Claims = { ...CLAIMS, R2: { ...CLAIMS.R2, status: "not claimed" } };
    const text = plainText(render({ claims: refused }));
    expect(text).not.toContain(CLAIMS.R2.text);
    expect(text).not.toContain(CLAIMS.R3.text);
    expect(text).toContain("No headline claim is allowed for outcome B (docs/claims.md).");
  });

  it("does not quote the claim of outcome A while docs/claims.md has it not claimed", () => {
    const h = parsedSample();
    const outcomeA = { ...h, outcome: { ...h.outcome, label: "A" } };
    const refused: Claims = { ...CLAIMS, R1: { ...CLAIMS.R1, status: "not claimed" } };
    const text = plainText(render({ honesty: outcomeA, claims: refused }));
    expect(text).toContain("Pre-registered outcome A");
    expect(text).not.toContain(CLAIMS.R1.text);
    expect(text).toContain("No headline claim is allowed for outcome A (docs/claims.md).");
    const allowed: Claims = { ...CLAIMS, R1: { ...CLAIMS.R1, status: "allowed" } };
    expect(plainText(render({ honesty: outcomeA, claims: allowed }))).toContain(`“${CLAIMS.R1.text}”`);
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
    expect(text).toContain("the swarm sees 1 + 3 + 6 times the crashes of one ideal durable supervisor");
    expect(text).not.toMatch(/= ?10\b/);
  });
});

describe("the rival the map and the per-process view are read against", () => {
  it("starts on the one the outcome is read against", () => {
    expect(visibleText(render())).toContain("Against the ideal durable supervisor: locality holds at 7 settings, ties at 18 and fails at 2.");
  });

  it("says no count when the file gives none", () => {
    const h = { ...parsedSample(), localityByRival: {} };
    expect(plainText(render({ honesty: h }))).toContain("Against the ideal durable supervisor: at each setting the swarm's recovery stays local (holds), ties or fails.");
  });

  it("starts on the one asked for, and ignores one the file does not have", () => {
    expect(visibleText(render({ rival: "central" }))).toContain(`Against the ${systemName("central")}: locality holds at 2 settings, ties at 4 and fails at 0.`);
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

describe("the setting of the counts", () => {
  const html = render();
  const line = /<p class="helps__setting"[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "";

  it("is one line near the top, before the outcome and every count, that names the model and the clock", () => {
    expect(line).not.toBe("");
    expect(html.indexOf(line)).toBeLessThan(html.indexOf('data-helps="outcome"'));
    const text = plainText(line);
    expect(text).toContain("Fake model, simulated clock");
    expect(text).toContain("$0 runs");
    expect(text).toContain("do not measure the real model");
  });

  it("is in view, not in a fold", () => {
    const before = html.slice(0, html.indexOf(line));
    expect(occurrences(before, "<details")).toBe(occurrences(before, "</details>"));
  });

  it("says where the real-model reading is, with a link to it", () => {
    expect(line).toContain('<a href="#/evidence">their own page</a>');
    expect(plainText(line)).toContain("The real-model results are on their own page.");
  });

  it("is on the panel only: where there are no counts, there is no setting to state", () => {
    for (const state of [{ status: "loading" }, { status: "missing" }] as HelpsViewProps["state"][]) {
      expect(renderToStaticMarkup(createElement(HelpsView, { state })), state.status).not.toContain("helps__setting");
    }
  });
});

describe("the full count", () => {
  it("is under Details, closed, with the outcome and the map in view above it", () => {
    const html = render();
    expect(html).toContain('<details id="table" class="disclosure">');
    expect(html.indexOf('data-helps="map"')).toBeLessThan(html.indexOf('<details id="table"'));
    expect(html.indexOf('<details id="table"')).toBeLessThan(html.indexOf('data-helps="table"'));
  });

  it("is open when a list of it is asked for, or when the frame asks for it (a director's scene has no address to ask with)", () => {
    expect(render({ open: { hypothesis: "H5", rival: "durable-max", which: "loss" } })).toContain('<details id="table" class="disclosure" open="">');
    expect(render({ unfold: true })).toContain('<details id="table" class="disclosure" open="">');
    const page = renderToStaticMarkup(createElement(HelpsView, { state: { status: "ready", honesty: parsedSample() }, unfold: true }));
    expect(page).toContain('<details id="table" class="disclosure" open="">');
  });

  it("keeps the rules of the decision as inline folds, not boxes of their own", () => {
    const html = render();
    expect(html).toContain('<details id="rules" class="disclosure disclosure--inline">');
    expect(plainText(html)).toContain("How a result is decided");
  });
});

describe("the page", () => {
  const view = (state: HelpsViewProps["state"], onRetry?: () => void): string => renderToStaticMarkup(createElement(HelpsView, { state, onRetry }));
  const retry = () => undefined;
  const every: HelpsViewProps["state"][] = [
    { status: "loading" },
    { status: "missing" },
    { status: "unreachable", reason: "the server answered 500" },
    { status: "invalid", reason: 'comparisons[3].verdict: unexpected "maybe"' },
    { status: "ready", honesty: parsedSample() },
  ];

  it("opens with the same head in every state, so a stranger knows where they are before anything has loaded", () => {
    for (const state of every) {
      const markup = view(state, retry);
      expect(markup.match(/<h1/g), state.status).toHaveLength(1);
      expect(markup, state.status).toContain('<h1 class="pagehead__title">Trade-offs</h1>');
      expect(plainText(markup), state.status).toContain("Where the swarm wins, ties and loses against each rival, as the bench counted it.");
    }
  });

  it("holds a place while the file loads, and says what it waits for", () => {
    const markup = view({ status: "loading" });
    expect(plainText(markup)).toContain("Loading the verdicts");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("skeleton-group--stack");
  });

  it("says plainly that there are no verdicts when the server has no file, shows nothing in their place, and offers the next step", () => {
    const markup = view({ status: "missing" }, retry);
    const text = plainText(markup);
    expect(text).toContain("No verdicts yet");
    expect(text).toContain("The server has no bench/results/honesty.json (GET /api/bench/honesty answered 404).");
    expect(text).toContain("fractalswarm bench verdicts <results dirs> --prereg");
    expect(text).not.toContain("Where it holds");
    expect(text).toContain("Check again");
    expect(markup).toContain('href="#/charts"');
  });

  it("says why the file could not be loaded or read, shows none of it, and offers to ask again", () => {
    const unreachable = view({ status: "unreachable", reason: "the server answered 500" }, retry);
    expect(plainText(unreachable)).toContain("The verdicts could not be loaded");
    expect(plainText(unreachable)).toContain("the server answered 500.");
    expect(plainText(unreachable)).toContain("Try again");
    const invalid = view({ status: "invalid", reason: 'comparisons[3].verdict: unexpected "maybe"' }, retry);
    expect(plainText(invalid)).toContain("The verdicts could not be read");
    expect(plainText(invalid)).toContain('comparisons[3].verdict: unexpected "maybe".');
    expect(plainText(invalid)).toContain("The panel shows nothing rather than part of the numbers.");
    for (const markup of [unreachable, invalid]) {
      expect(markup).toContain('role="alert"');
      expect(plainText(markup)).not.toContain("Where it holds");
    }
  });

  it("offers no button to ask again when nothing is there to ask with", () => {
    for (const state of every.slice(1, 4)) expect(view(state), state.status).not.toContain("<button");
  });

  it("puts the rival choice in the head once the verdicts are there", () => {
    const markup = view({ status: "ready", honesty: parsedSample() });
    expect(markup).toMatch(/pagehead__actions[^]*<select/);
  });

  it("draws the panel for a file it could read", () => {
    const text = plainText(view({ status: "ready", honesty: parsedSample() }));
    expect(text).toContain("Where it holds");
    expect(text).toContain("Wins, ties and losses");
    expect(text).toContain("Per process");
  });
});
