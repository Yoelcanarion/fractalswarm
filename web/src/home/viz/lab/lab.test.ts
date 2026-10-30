import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as viz from "../index";
import { HomeLab, isHomeLabHash } from "./HomeLab";

const SECTIONS = ["tree", "lanes", "hrw", "hash", "hero", "dots", "pairs", "regime", "tokens", "doors", "count"];

describe("the lab", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const html = (): string => renderToStaticMarkup(createElement(HomeLab));

  it("has a section for every visual of the page, each with a progress slider", () => {
    const out = html();
    for (const id of SECTIONS) expect(out, id).toContain(`<section class="lab-section" id="${id}">`);
    expect(out.match(/class="lab-scrub"/g)).toHaveLength(SECTIONS.length);
    expect(out).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("draws every chart in it, in a frame whose size the person can pick", () => {
    const out = html();
    for (const name of ["hv-ld", "hv-dp", "hv-pb", "hv-rg", "hv-tk", "hv-dg", "hv-count"]) expect(out, name).toContain(name);
    expect(out.match(/class="lab-frame"/g)).toHaveLength(8);
    expect(out).toContain("1224 px (a laptop)");
    expect(out).toContain("390 px (a phone)");
  });

  it("is found at #/home-lab and nowhere else", () => {
    expect(isHomeLabHash("#/home-lab")).toBe(true);
    expect(isHomeLabHash("#/home")).toBe(false);
  });
});

describe("what the visuals export to the page", () => {
  it("is every visual under the name the page uses, and the six doors", () => {
    for (const name of ["SwarmTree", "WorkLanes", "HrwPanels", "HashStrip", "LineDraw", "DotPlot", "PairedBars", "RegimeStrip", "TokenBar", "CountUp", "DoorGlyph"]) {
      expect(typeof (viz as Record<string, unknown>)[name], name).toBe("function");
    }
    expect(viz.DOOR_IDS).toEqual(["arena", "live", "replays", "director", "numbers", "ablation"]);
  });
});
