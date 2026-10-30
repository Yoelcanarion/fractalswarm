// "Nothing is pinned, and nothing reads the scroll" (redesign brief, motion rule 1). Scrolling only starts things, through
// `useArrival`; no value is computed from where the page is scrolled to, and nothing but the top bar stays on the screen.
// Held for every source and stylesheet under the home folder, W7's included.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOME } from "./testing";

const walk = (dir: string, keep: (name: string) => boolean): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return name === "data" ? [] : walk(path, keep);
    return keep(name) ? [path] : [];
  });

const code = walk(HOME, (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "testing.ts");
const styles = walk(HOME, (name) => name.endsWith(".css"));
const read = (path: string): string => readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const name = (path: string): string => path.slice(HOME.length + 1);

const SCROLL_READS: [RegExp, string][] = [
  [/\buseScroll\b/, "useScroll"],
  [/\bscrollYProgress\b|\bscrollXProgress\b/, "a scroll progress"],
  [/\bscrollY\b|\bpageYOffset\b|\bscrollTop\b/, "the scroll position"],
  [/addEventListener\(\s*["'`]scroll["'`]/, "a scroll listener"],
  [/\bonScroll\b/, "onScroll"],
  [/\bonscroll\b/, "onscroll"],
  [/\bScrollTimeline\b|\bViewTimeline\b/, "a scroll timeline"],
];

describe("the sources of the home page", () => {
  it("are found", () => {
    expect(code.length).toBeGreaterThan(20);
  });

  for (const [pattern, what] of SCROLL_READS) {
    it(`do not use ${what}`, () => {
      const found = code.filter((path) => pattern.test(read(path))).map(name);
      expect(found, `${what} in ${found.join(", ")}`).toEqual([]);
    });
  }

  it("have no scroll stage, no rail and no clock of a pinned step left", () => {
    const folders = readdirSync(HOME, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(folders).not.toContain("scroll");
    expect(code.map(name)).not.toContain("bar/ChapterRail.tsx");
  });
});

describe("the stylesheets of the home page", () => {
  it("are found", () => {
    expect(styles.length).toBeGreaterThanOrEqual(1);
  });

  it("pin nothing: no position: sticky (the top bar is fixed and is the one thing that stays)", () => {
    const found = styles.filter((path) => /position:\s*sticky/.test(read(path))).map(name);
    expect(found, `position: sticky in ${found.join(", ")}`).toEqual([]);
  });

  it("let nothing follow the scroll: no scroll-driven animation timeline", () => {
    const found = styles.filter((path) => /animation-timeline|scroll-timeline|view-timeline|scroll\(\)|view\(\)/.test(read(path))).map(name);
    expect(found, `a scroll timeline in ${found.join(", ")}`).toEqual([]);
  });

  it("keep the one fixed element the top bar", () => {
    const css = readFileSync(`${HOME}/home.css`, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    const fixed = [...css.matchAll(/([^{}]+)\{[^{}]*position:\s*fixed[^{}]*\}/g)].map((m) => m[1].trim());
    expect(fixed.sort()).toEqual([".home-bar", ".home-skip"]);
  });
});
