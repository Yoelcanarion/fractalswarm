// The type scale keeps its promise: --fs-label (12px) is for uppercase micro-labels and captions, and "never running text";
// --fs-body (14px) is the floor for anything a person reads. This reads the sheets of the core app, the Charts, Runs, run views,
// intake and ablation (the arena, the home page and the director mode keep their own).

import { readdirSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../lib/testing";

const SRC = REPO_ROOT + "web/src";
const OWN_SHEETS = ["styles.css", "styles/ui.css", "styles/lens.css"];
const OWN_DIRS = ["components", "pages", "intake", "ablation"];

/** Small text that is not an uppercase label, left as it is on purpose: it sits inside a drawing (a node of the tree, a cell of the
 * schedule grid, a tick of the ladder, a count on a tab) where 14px does not fit. */
const IN_A_DRAWING = new Set([
  ".react-flow__edge-text",
  ".actor__duty",
  ".actor__adopted",
  ".actor__state",
  ".grid__table th",
  ".cell",
  ".cell__tag",
  ".ladder__tick span",
  ".tab__count",
  ".stat__affix",
]);

function sheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return sheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

const files = [...OWN_SHEETS.map((name) => `${SRC}/${name}`), ...OWN_DIRS.flatMap((dir) => sheets(`${SRC}/${dir}`))];

interface Small {
  file: string;
  selector: string;
  uppercase: boolean;
}

function smallText(): Small[] {
  const found: Small[] = [];
  for (const file of files) {
    const css = readFileSync(file, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = rule[2];
      if (!/font-size:\s*(var\(--fs-label\)|\d(\.\d+)?px|1[0-3]px|0?\.\d+r?em)/.test(body)) continue;
      found.push({
        file: file.slice(SRC.length + 1),
        selector: rule[1].trim().replace(/\s+/g, " "),
        uppercase: /text-transform:\s*uppercase/.test(body),
      });
    }
  }
  return found;
}

describe("the type scale", () => {
  const small = smallText();

  it("reads the sheets it means to", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(small.length).toBeGreaterThan(20);
  });

  it("keeps 12px for uppercase labels, and for what sits inside a drawing", () => {
    const running = small.filter((rule) => !rule.uppercase && !rule.selector.split(",").every((one) => IN_A_DRAWING.has(one.trim())));
    expect(running.map((rule) => `${rule.file}: ${rule.selector}`)).toEqual([]);
  });

  it("does not keep a drawing's exception for a selector that is gone", () => {
    const selectors = new Set(small.flatMap((rule) => rule.selector.split(",").map((one) => one.trim())));
    const gone = [...IN_A_DRAWING].filter((selector) => !selectors.has(selector));
    expect(gone).toEqual([]);
  });
});
