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

function filesWith(dir: string, ending: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesWith(path, ending);
    return path.endsWith(ending) ? [path] : [];
  });
}

const stylesheets = (dir: string): string[] => filesWith(dir, ".css");

/** The class names a source file puts in its `className` attributes: a plain string, or a template with its `${}` parts left out (a
 * template is read up to the first template nested in it). */
export function classesUsed(source: string): Set<string> {
  const used = new Set<string>();
  for (const attribute of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`)/g)) {
    const text = (attribute[1] ?? attribute[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
    for (const token of text.split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(token)) used.add(token);
  }
  return used;
}

/** Where a component outside `components/lens/` puts a class that only the lens's stylesheet styles, on purpose: the run page's strip
 * and the replay chip's hash are the lens's own, and `run` and `timeline` are the base classes it adds to (`ADDS_TO`). */
const LENS_CLASSES_OUTSIDE = [
  ".run: components/RunFrame.tsx",
  ".run: pages/RunPage.tsx",
  ".runstrip: App.tsx",
  ".runstrip: components/RunStrip.tsx",
  ".runstrip__proof: components/RunStrip.tsx",
  ".timeline: components/Timeline.tsx",
  ".verify__head: components/VerifyBadge.tsx",
];

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

  it("styles no markup but its own and the places listed: a class it owns on other markup restyles it", () => {
    // `meter` was on the panels' bar wrapper too: the lens's flex row left the bar no width, and no sheet-to-sheet check could see it
    const found: string[] = [];
    for (const path of filesWith(SRC, ".tsx")) {
      const where = relative(SRC, path).replace(/\\/g, "/");
      if (where.startsWith("components/lens/")) continue;
      for (const name of classesUsed(readFileSync(path, "utf-8"))) if (lens.has(name)) found.push(`.${name}: ${where}`);
    }
    expect(found.sort()).toEqual([...LENS_CLASSES_OUTSIDE].sort());
  });
});

describe("the classes a component uses", () => {
  it("are the ones its attributes name, with a template's parts left out", () => {
    const source = '<a className="one two"/> <b className={`three ${x ? "four" : ""} five`}/> <i className={cls}/>';
    expect([...classesUsed(source)].sort()).toEqual(["five", "one", "three", "two"]);
  });
});
