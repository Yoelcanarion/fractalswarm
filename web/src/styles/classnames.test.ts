// A class name that two stylesheets both define is one rule on top of the other: the later one wins where it names a
// property, and the earlier one still supplies the rest. The Muse lens and the Collisions panel both once called their
// rows `crow`, and the lens's grid squeezed the panel's rows into one character per line. The lens keeps its names to itself.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../lib/testing";

const SRC = join(REPO_ROOT, "web", "src");
const LENS = join(SRC, "styles", "lens.css");

/** Base classes the lens adds a property or two to on purpose: the run page (a positioning context and the timeline's height),
 * the timeline (its minimum height) and the tree's nodes (a pointer: they are buttons now). Each lens rule sets only properties
 * that styles.css's rule for the same class leaves alone. */
const ADDS_TO = ["run", "timeline", "actor"];

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

/** The class a rule starts its selector with, for every selector of every rule (`.crow:hover .x, .crow[a] {` gives `crow`). */
export function ownedClasses(css: string): Set<string> {
  const owned = new Set<string>();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of bare.matchAll(/([^{}]+)\{/g)) {
    for (const selector of rule[1].split(",")) {
      const first = /^\s*\.([A-Za-z_][\w-]*)/.exec(selector);
      if (first) owned.add(first[1]);
    }
  }
  return owned;
}

describe("the classes a stylesheet owns", () => {
  it("are the ones a rule starts with, not the ones it only reaches into", () => {
    const css = `
      /* .gone { } */
      .lens { color: red; }
      .lens .btn, .row:hover .cell { color: blue; }
      @media (min-width: 10px) { .wide[data-x="1"] { color: green; } }
      @keyframes spin { from { opacity: 0; } to { opacity: 1; } }
    `;
    expect([...ownedClasses(css)].sort()).toEqual(["lens", "row", "wide"]);
  });
});

describe("the Muse lens's stylesheet", () => {
  const lens = ownedClasses(readFileSync(LENS, "utf-8"));

  it("owns some classes (the scan reads the file)", () => {
    expect(lens.size).toBeGreaterThan(10);
    expect(lens.has("lcrow")).toBe(true);
  });

  it("owns no class another stylesheet owns too, except the base classes it adds to", () => {
    const clashes: string[] = [];
    for (const path of stylesheets(SRC)) {
      if (path === LENS) continue;
      for (const name of ownedClasses(readFileSync(path, "utf-8"))) {
        if (lens.has(name) && !ADDS_TO.includes(name)) clashes.push(`.${name} is defined in ${relative(SRC, path)} and in styles/lens.css`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("still adds to the base classes the list above names (the list does not go stale)", () => {
    for (const name of ADDS_TO) expect(lens.has(name)).toBe(true);
  });
});
