import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initLite, LITE_PARTS, liteFromAddress, parseLite } from "./lite";
import { REPO_ROOT } from "./testing";

/** A stand-in for <html>: all initLite touches is its dataset. */
const page = (): HTMLElement => ({ dataset: {} }) as unknown as HTMLElement;

describe("which lite parts are asked for", () => {
  it("is none unless something is asked for", () => {
    for (const value of [null, undefined, "", "  ", "nope", "animated", "0", "off"]) expect(parseLite(value)).toEqual([]);
  });

  it("takes all, or any of the parts, always in the same order", () => {
    for (const value of ["all", "1", "true", "ALL", "anim,all", "on"]) expect(parseLite(value)).toEqual([...LITE_PARTS]);
    expect(parseLite("shadow,anim")).toEqual(["anim", "shadow"]);
    expect(parseLite("filter")).toEqual(["filter"]);
    expect(parseLite(" anim  filter ")).toEqual(["anim", "filter"]);
    expect(parseLite("anim,nonsense,anim")).toEqual(["anim"]);
  });
});

describe("where the request is read from", () => {
  it("reads the query string first, and then the query of the hash route", () => {
    expect(liteFromAddress("?lite=all", "#/run/x")).toBe("all");
    expect(liteFromAddress("", "#/run/x?speed=20&lite=anim,filter")).toBe("anim,filter");
    expect(liteFromAddress("?theme=light&lite=shadow", "#/run/x?lite=anim")).toBe("shadow");
    expect(liteFromAddress("", "#/run/x")).toBeNull();
    expect(liteFromAddress("?theme=light", "")).toBeNull();
  });

  it("puts the parts on the root element, or takes the attribute off", () => {
    const root = page();
    initLite(root, { search: "?lite=shadow,anim", hash: "" });
    expect(root.dataset.lite).toBe("anim shadow");
    initLite(root, { search: "", hash: "#/run/x?lite=all" });
    expect(root.dataset.lite).toBe("anim filter shadow");
    initLite(root, { search: "", hash: "#/run/x" });
    expect(root.dataset.lite).toBeUndefined();
  });
});

describe("styles/lite.css", () => {
  const css = readFileSync(`${REPO_ROOT}web/src/styles/lite.css`, "utf-8");
  const keyed = (): string[] => [...new Set([...css.matchAll(/data-lite~="([a-z-]+)"/g)].map((m) => m[1]))].sort();

  it("has rules for every part, and for none that parseLite does not know", () => {
    expect(keyed()).toEqual([...LITE_PARTS].sort());
  });

  it("names every rule by its part, so nothing applies without the attribute", () => {
    // Every rule's selector starts at :root[data-lite~="..."]; a bare rule would apply to everyone.
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThanOrEqual(LITE_PARTS.length);
    for (const selectors of rules) {
      for (const selector of selectors.split(",").map((s) => s.trim())) expect(selector).toMatch(/^:root\[data-lite~="[a-z-]+"\] /);
    }
  });
});
