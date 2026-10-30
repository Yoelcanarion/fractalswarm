// What no visual may say, whatever the data: the page's own guard (a run is never "valid" except through
// a claim, in its words; nothing "always finishes"), and the words docs/claims.md does not allow.

import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { story } from "../data/story";
import { DOOR_IDS, DoorGlyph, DotPlot, HashStrip, HrwPanels, LineDraw, PairedBars, RegimeStrip, SwarmTree, TokenBar, WorkLanes } from "./index";

const BANNED: [RegExp, string][] = [
  [/(?<!\b(?:not|never) )\bvalid\b/i, "valid, which only a claim may say, in its words"],
  [/\b(every|each|all)\b[^.]{0,40}\bruns?\b[^.]{0,40}\b(finish|complet|succe|surviv)/i, "every run finished"],
  [/\balways (finish|complete|succeed)/i, "always finishes"],
  [/\b(simpler|cheaper|more reliable)\b/i, "a comparison the claims do not make"],
  [/\bfirst\b/i, "first"],
  [/without stalling or paying twice/i, "the wording that is still pending"],
];

type Render = () => string;
const still = { progress: motionValue(1), still: true } as const;
const html = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as never, { ...still, ...props } as never));

const visuals: [string, Render][] = [
  ["SwarmTree", () => html(SwarmTree, { data: story.tree })],
  ["WorkLanes (benchmark run)", () => html(WorkLanes, { data: story.lanes.central })],
  ["WorkLanes (demo)", () => html(WorkLanes, { data: story.lanes.swarm })],
  ["HrwPanels", () => html(HrwPanels, { data: story.hrw })],
  ["HashStrip", () => html(HashStrip, { data: story.hashes })],
  ["LineDraw", () => html(LineDraw, { data: story.hero })],
  ["DotPlot", () => html(DotPlot, { data: story.headline })],
  ["PairedBars (ideal durable)", () => html(PairedBars, { data: story.verdicts })],
  ["PairedBars (realistic durable)", () => html(PairedBars, { data: story.verdicts, rival: "durable" })],
  ["RegimeStrip", () => html(RegimeStrip, { data: story.regime })],
  ["TokenBar", () => html(TokenBar, { data: story.tokensByModel })],
  ...DOOR_IDS.map((id): [string, Render] => [`DoorGlyph ${id}`, () => html(DoorGlyph, { data: id })]),
];

describe("what the visuals say", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [name, render] of visuals) {
    it(`${name} says nothing the page may not say, and no number that is not a number`, () => {
      const out = render();
      expect(out.length).toBeGreaterThan(100);
      for (const [pattern, what] of BANNED) expect(out, `${name}: ${what}`).not.toMatch(pattern);
      expect(out, name).not.toMatch(/NaN|undefined|Infinity|\[object/);
    });
  }

  it("lets a run whose result is not valid be said, and nothing else about validity", () => {
    expect(BANNED[0]![0].test("a result that is not valid")).toBe(false);
    expect(BANNED[0]![0].test("every result is valid")).toBe(true);
    expect(BANNED[0]![0].test("never valid")).toBe(false);
  });
});
