import { describe, expect, it } from "vitest";

import { MANIFEST_FORMAT, readManifest } from "./manifest";
import { ALPHA, BETA, makeSite } from "./testing";

/** The manifest of the in-memory site as the JSON the exporter writes, to damage a copy of. */
const written = () => JSON.parse(JSON.stringify(makeSite().manifest)) as Record<string, any>;

describe("reading the manifest", () => {
  it("reads what the exporter writes", () => {
    const { manifest } = makeSite();
    expect(Object.keys(manifest.runs)).toEqual([ALPHA, BETA]);
    expect(manifest.runs[ALPHA].events.pages).toHaveLength(4);
    expect(manifest.runs[ALPHA].calls?.ids).toEqual(["e1", "e2", "e3"]);
    expect(manifest.runs[BETA].calls).toBeUndefined();
    expect(manifest.global.runs.body).toBeDefined();
    expect(manifest.global["bench/honesty"].file).toBe("bench-honesty.json");
  });

  it("keeps a file entry's status, which says what the file holds", () => {
    expect(makeSite().manifest.runs[ALPHA].routes.takeover).toEqual({ status: 404, body: { error: "no takeover in this run" } });
  });

  it("refuses data of another format, and says to rebuild", () => {
    const damaged = { ...written(), format: MANIFEST_FORMAT + 1 };
    expect(() => readManifest(damaged)).toThrow(/format.*rebuild the site/);
  });

  it.each([
    ["a run without its summary", (m: Record<string, any>) => delete m.runs[ALPHA].routes.summary, "has no summary"],
    ["a run without its replay report", (m: Record<string, any>) => delete m.runs[ALPHA].routes.verify, "has no verify"],
    ["a page with no size", (m: Record<string, any>) => delete m.runs[ALPHA].events.pages[0].bytes, "pages[0].bytes"],
    ["an entry with a status that is no HTTP status", (m: Record<string, any>) => (m.runs[ALPHA].routes.metrics.status = 7), "status"],
    ["a missing page size", (m: Record<string, any>) => delete m.site.page_size, "page_size"],
    ["a page size of zero", (m: Record<string, any>) => (m.site.page_size = 0), "page_size"],
    ["no list of runs", (m: Record<string, any>) => delete m.global.runs, "has no runs"],
    ["no capabilities", (m: Record<string, any>) => delete m.global.capabilities, "has no capabilities"],
    ["call ids that are no list", (m: Record<string, any>) => (m.runs[ALPHA].calls.ids = "e1"), "calls.ids"],
  ])("names the field when there is %s", (_what, damage, field) => {
    const manifest = written();
    damage(manifest);
    expect(() => readManifest(manifest)).toThrow(field);
  });

  it("refuses what is not a manifest at all", () => {
    expect(() => readManifest(null)).toThrow();
    expect(() => readManifest("<html>")).toThrow();
  });
});
