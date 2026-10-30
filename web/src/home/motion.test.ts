// The page's `m` components take motion values in `style` (the cards of a stage, the layers over a visual, the hero). The
// minimal `m` has no renderer: without a LazyMotion above it, it draws the value it had at its first render and never
// subscribes to it again, so a card never fades in and a layer never comes or goes. Nothing in a render to a string can
// see that (it showed first in a browser: a stage with its visual moving and no text beside it), so the source is held.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOME } from "./testing";

const sources = (dir: string = HOME): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

const read = (path: string): string => readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const usesM = (path: string): boolean => /<m\.\w+/.test(read(path));
const files = sources();

describe("the m components of the home page", () => {
  it("have a LazyMotion with a renderer above them, on the page's view", () => {
    const users = files.filter(usesM);
    expect(users.length, "a stage draws its cards with m").toBeGreaterThan(0);
    const view = read(`${HOME}/HomePage.tsx`);
    expect(view).toMatch(/<LazyMotion\s+features=\{(domMin|domAnimation|domMax)\}/);
    // the provider wraps the page: it opens before the chapters and closes after them
    expect(view.indexOf("<LazyMotion")).toBeLessThan(view.indexOf("<Hero"));
    expect(view.lastIndexOf("</LazyMotion>")).toBeGreaterThan(view.indexOf("<Enter"));
  });

  it("are only in the chapters, the stage and the parts that HomeView draws", () => {
    // The lab and W7's visuals sit outside the provider (the lab is a page of its own): they draw with hooks.
    for (const path of files.filter(usesM)) {
      const name = path.slice(HOME.length + 1);
      expect(name.startsWith("viz/"), `${name} uses an m component outside the provider`).toBe(false);
    }
  });
});
