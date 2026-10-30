// An `m` component takes motion values in `style`. The minimal `m` has no renderer: without a LazyMotion above it, it
// draws the value it had at its first render and never subscribes to it again, so a card never fades in and a layer never
// comes or goes. Nothing in a render to a string can see that (it showed first in a browser: a stage with its visual
// moving and no text beside it), so the source is held: the page's view has the provider exactly when a file draws with
// `m`. None does today (the stages write their motion values themselves and the hero draws with hooks), so there is no
// provider, and none of its bytes in the entry chunk.

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
  it("have a LazyMotion with a renderer above them, on the page's view, exactly when one is drawn", () => {
    const users = files.filter(usesM).map((path) => path.slice(HOME.length + 1));
    const view = read(`${HOME}/HomePage.tsx`);
    const provided = /<LazyMotion\s+features=\{(domMin|domAnimation|domMax)\}/.test(view);
    const why = users.length
      ? `${users.join(", ")} draw with m: HomePage.tsx needs a <LazyMotion features={domMin}> above the chapters`
      : "no file draws with m: the LazyMotion on HomePage.tsx is dead weight in the entry chunk";
    expect(provided, why).toBe(users.length > 0);
    if (provided) {
      // the provider wraps the page: it opens before the chapters and closes after them
      expect(view.indexOf("<LazyMotion")).toBeLessThan(view.indexOf("<Hero"));
      expect(view.lastIndexOf("</LazyMotion>")).toBeGreaterThan(view.indexOf("<Enter"));
    }
  });

  it("are only in the chapters, the stage and the parts that HomeView draws", () => {
    // The lab and W7's visuals sit outside the provider (the lab is a page of its own): they draw with hooks.
    for (const path of files.filter(usesM)) {
      const name = path.slice(HOME.length + 1);
      expect(name.startsWith("viz/"), `${name} uses an m component outside the provider`).toBe(false);
    }
  });
});
