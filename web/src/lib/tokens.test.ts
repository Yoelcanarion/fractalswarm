import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { chroma, contrast, cvdDeltaE, deltaE, lightness } from "./color";
import { REPO_ROOT } from "./testing";

const SRC = REPO_ROOT + "web/src";
const TOKENS = `${SRC}/styles/tokens.css`;

type Tokens = Record<string, string>;

function declarations(body: string): Tokens {
  const out: Tokens = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim();
  return out;
}

/** The dark theme is the whole of `:root`; the light theme overrides part of it. */
function themes(): { dark: Tokens; light: Tokens; lightOnly: Tokens } {
  const css = readFileSync(TOKENS, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
  let dark: Tokens = {};
  let lightOnly: Tokens = {};
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (selector === ":root") dark = { ...dark, ...declarations(rule[2]) };
    else if (selector === ':root[data-theme="light"]') lightOnly = declarations(rule[2]);
    else throw new Error(`unexpected selector in tokens.css: ${selector}`);
  }
  return { dark, light: { ...dark, ...lightOnly }, lightOnly };
}

const { dark, light, lightOnly } = themes();
const THEMES: [string, Tokens][] = [
  ["dark", dark],
  ["light", light],
];
const SURFACES = ["--bg", "--surface-1", "--surface-2"];
const OWN = Array.from({ length: 10 }, (_, i) => `--own-${i + 1}`);
const MODELS = ["--model-wonder", "--model-spark", "--model-contributor", "--model-guard"];
const BAND: Record<string, [number, number]> = { dark: [0.48, 0.67], light: [0.43, 0.77] };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(css|tsx?)$/.test(name) && !name.endsWith(".test.ts") && path !== TOKENS ? [path] : [];
  });
}

describe("design tokens", () => {
  it("are the only place a colour is spelled as a hex literal", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("define every colour of the dark theme in the light theme as well", () => {
    const isColour = (value: string) => /^#[0-9a-f]{6}$/i.test(value) || value.startsWith("oklch(");
    const colours = Object.entries(dark).filter(([name, value]) => isColour(value) && !name.startsWith("--shadow"));
    const missing = colours.map(([name]) => name).filter((name) => !(name in lightOnly));
    expect(missing).toEqual([]);
  });

  describe.each(THEMES)("%s theme", (theme, tokens) => {
    const hex = (name: string): string => {
      const value = tokens[name];
      if (!value || !value.startsWith("#")) throw new Error(`${name} is not a hex colour in ${theme}: ${value}`);
      return value;
    };
    const pairs = (names: string[]): [string, string][] =>
      names.flatMap((a, i) => names.slice(i + 1).map((b): [string, string] => [a, b]));

    it("keeps text readable (AA, 4.5:1) on every surface", () => {
      const failures: string[] = [];
      for (const text of ["--text-primary", "--text-secondary", "--text-muted", "--accent-text", "--ok-text", "--warn-text", "--danger-text"]) {
        for (const surface of [...SURFACES, "--surface-3"]) {
          // Muted text and the status texts are never set on the raised hover surface.
          if (surface === "--surface-3" && text !== "--text-primary" && text !== "--text-secondary") continue;
          const ratio = contrast(hex(text), hex(surface));
          if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it("keeps tinted status chips and solid buttons readable", () => {
      const combos: [string, string][] = [
        ["--ok-ink", "--ok-bg-strong"],
        ["--ok-text", "--ok-bg"],
        ["--warn-ink", "--warn-bg-strong"],
        ["--warn-text", "--warn-bg"],
        ["--danger-ink", "--danger-bg-strong"],
        ["--danger-text", "--danger-bg"],
        ["--danger-solid-ink", "--danger-solid"],
        ["--danger-solid-ink", "--danger-solid-hover"],
        ["--text-inverse", "--text-primary"],
      ];
      const failures = combos
        .map(([text, bg]) => [text, bg, contrast(hex(text), hex(bg))] as const)
        .filter(([, , ratio]) => ratio < 4.5)
        .map(([text, bg, ratio]) => `${text} on ${bg}: ${ratio.toFixed(2)}`);
      expect(failures).toEqual([]);
    });

    it("draws status and accent marks at 3:1 or better against the surfaces", () => {
      const failures: string[] = [];
      for (const mark of ["--ok", "--warn", "--danger", "--accent"]) {
        for (const surface of ["--surface-1", "--surface-2"]) {
          const ratio = contrast(hex(mark), hex(surface));
          if (ratio < 3) failures.push(`${mark} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it("has ten ownership hues inside the lightness band, above the chroma floor, at 3:1 on every surface", () => {
      const [lo, hi] = BAND[theme];
      const failures: string[] = [];
      for (const name of OWN) {
        const colour = hex(name);
        const l = lightness(colour);
        if (l < lo || l > hi) failures.push(`${name} lightness ${l.toFixed(3)} outside ${lo}-${hi}`);
        if (chroma(colour) < 0.1) failures.push(`${name} chroma ${chroma(colour).toFixed(3)} < 0.1`);
        for (const surface of SURFACES) {
          const ratio = contrast(colour, hex(surface));
          if (ratio < 3) failures.push(`${name} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it("keeps neighbouring ownership hues apart for colour-blind readers, and the first four apart for any pair", () => {
      const failures: string[] = [];
      const check = (a: string, b: string) => {
        const cvd = cvdDeltaE(hex(a), hex(b));
        const normal = deltaE(hex(a), hex(b));
        if (cvd < 8) failures.push(`${a} / ${b}: colour-blind ΔE ${cvd.toFixed(1)} < 8`);
        if (normal < 15) failures.push(`${a} / ${b}: normal-vision ΔE ${normal.toFixed(1)} < 15`);
      };
      OWN.slice(1).forEach((name, i) => check(OWN[i], name));
      pairs(OWN.slice(0, 4)).forEach(([a, b]) => check(a, b));
      expect(failures).toEqual([]);
    });

    it("keeps the four model badge hues apart for any pair, and visible on every surface", () => {
      const [lo, hi] = BAND[theme];
      const failures: string[] = [];
      for (const name of MODELS) {
        const l = lightness(hex(name));
        if (l < lo || l > hi) failures.push(`${name} lightness ${l.toFixed(3)} outside ${lo}-${hi}`);
        for (const surface of SURFACES) {
          const ratio = contrast(hex(name), hex(surface));
          if (ratio < 3) failures.push(`${name} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      for (const [a, b] of pairs(MODELS)) {
        const cvd = cvdDeltaE(hex(a), hex(b));
        const normal = deltaE(hex(a), hex(b));
        if (cvd < 8) failures.push(`${a} / ${b}: colour-blind ΔE ${cvd.toFixed(1)} < 8`);
        if (normal < 15) failures.push(`${a} / ${b}: normal-vision ΔE ${normal.toFixed(1)} < 15`);
      }
      expect(failures).toEqual([]);
    });
  });
});
