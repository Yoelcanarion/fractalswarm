// tokens.test.ts checks every text colour against every surface in the abstract. This test reads the sheets: wherever one rule
// gives a text a token colour and a token background (and wherever a :hover, :focus-visible or [aria-…] variant swaps one of the
// two), the pair it makes keeps AA, 4.5:1, in the dark theme and in the light one. What a rule inherits from its parent is not
// known here, so a rule that sets only one of the two is not read: the button modifiers, which would inherit the base button's text,
// are held to set both.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contrast } from "../lib/color";
import { REPO_ROOT } from "../lib/testing";

const SRC = REPO_ROOT + "web/src";
const TOKENS = `${SRC}/styles/tokens.css`;

type Tokens = Record<string, string>;

const declarations = (body: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const match of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) out.set(match[1].toLowerCase(), match[2].trim());
  return out;
};

interface Rule {
  selector: string;
  decls: Map<string, string>;
}

/** Every rule of a sheet in source order, the ones inside @media included; keyframes and font faces are not rules about colour. */
function readRules(css: string): Rule[] {
  const out: Rule[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    while (depth > 0 && close < css.length) {
      if (css[close] === "{") depth++;
      else if (css[close] === "}") depth--;
      close++;
    }
    const head = css.slice(at, open).trim();
    const body = css.slice(open + 1, close - 1);
    if (head.startsWith("@media") || head.startsWith("@supports")) out.push(...readRules(body));
    else if (!head.startsWith("@")) out.push({ selector: head, decls: declarations(body) });
    at = close;
  }
  return out;
}

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The two themes: the dark one is the whole of `:root`, the light one overrides part of it. */
function themes(): Record<"dark" | "light", Tokens> {
  const dark: Tokens = {};
  const light: Tokens = {};
  for (const rule of readRules(withoutComments(readFileSync(TOKENS, "utf-8")))) {
    const target = rule.selector === ":root" ? dark : rule.selector === ':root[data-theme="light"]' ? light : null;
    if (target) rule.decls.forEach((value, name) => (target[name] = value));
  }
  return { dark, light: { ...dark, ...light } };
}

const STATE = /(:not\(:disabled\)|:hover|:focus-visible|:focus|:active|:disabled|:checked|\[disabled\]|\[aria-[\w-]+(?:="[^"]*")?\]|\[data-[\w-]+(?:="[^"]*")?\])$/;

/** `.btn:hover` is the rule `.btn` in the state `:hover`; a pseudo-element is not read: it sits on its own background. */
function split(selector: string): { key: string; state: string } | null {
  if (selector.includes("::") || /:(before|after)\b/.test(selector)) return null;
  let key = selector.trim();
  let state = "";
  for (let match = STATE.exec(key); match; match = STATE.exec(key)) {
    state = match[1] + state;
    key = key.slice(0, match.index);
  }
  return { key, state };
}

/** Commas inside :is(), :not() and [attr] do not separate selectors. */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  [...list].forEach((char, i) => {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      out.push(list.slice(from, i));
      from = i + 1;
    }
  });
  out.push(list.slice(from));
  return out.map((s) => s.trim()).filter(Boolean);
}

const token = (value: string | undefined): string | undefined => /^var\((--[\w-]+)\)$/.exec(value ?? "")?.[1];

interface Paint {
  color?: string;
  background?: string;
}

interface Pair {
  where: string;
  color: string;
  background: string;
}

/** The text and background tokens each selector sets, and the pair each of its states ends up with. */
function pairsOf(css: string, file: string): Pair[] {
  const base = new Map<string, Paint>();
  const states = new Map<string, Map<string, Paint>>();
  for (const rule of readRules(withoutComments(css))) {
    const color = token(rule.decls.get("color"));
    const background = token(rule.decls.get("background") ?? rule.decls.get("background-color"));
    if (!color && !background) continue;
    for (const raw of selectors(rule.selector)) {
      const parts = split(raw);
      if (!parts) continue;
      const slot = parts.state === "" ? base : (states.get(parts.state) ?? states.set(parts.state, new Map()).get(parts.state)!);
      const paint = slot.get(parts.key) ?? {};
      if (color) paint.color = color;
      if (background) paint.background = background;
      slot.set(parts.key, paint);
    }
  }
  const pairs: Pair[] = [];
  const add = (key: string, state: string, paint: Paint) => {
    if (paint.color && paint.background) pairs.push({ where: `${file}  ${key}${state}`, color: paint.color, background: paint.background });
  };
  base.forEach((paint, key) => add(key, "", paint));
  states.forEach((slot, state) =>
    slot.forEach((paint, key) => {
      const own = base.get(key) ?? {};
      add(key, state, { color: paint.color ?? own.color, background: paint.background ?? own.background });
    }),
  );
  return pairs;
}

function sheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return sheets(path);
    return path.endsWith(".css") && path !== TOKENS ? [path] : [];
  });
}

/** Findings in files that are not this worker's to change, reported to their owner through the coordinator. Each is listed under the
 * name the first test prints for it; remove it once it is fixed (the second test fails until then). */
const REPORTED: Record<string, string> = {
  "home/home.css  .home-extract__mark[data-lit]: --text-inverse on --accent (light)": "W6, Oct 30: 4.30:1, the lit word of the extract visual",
};

const all = sheets(SRC).flatMap((path) => pairsOf(readFileSync(path, "utf-8"), path.slice(SRC.length + 1)));

describe("the button modifiers", () => {
  it("give their text colour with their background: the base button's would be read on a fill it was not chosen for", () => {
    const bare = readRules(withoutComments(readFileSync(`${SRC}/styles.css`, "utf-8")))
      .filter((rule) => /^\.btn--[\w-]+$/.test(rule.selector) && rule.decls.has("background") && !rule.decls.has("color"))
      .map((rule) => rule.selector);
    expect(bare).toEqual([]);
  });
});

describe("the text on a dead, a restarting and a finished tree card", () => {
  // These cards were once faded by `opacity`, which composites the text over the tint: the meta on a dead card read at 2:1 and its id at
  // 4:1 (3:1 in the light theme). Now their text has colours of its own, and they are what is checked here.
  const CARDS: [string, string][] = [
    ["actor--down", "--danger-bg"],
    ["actor--restarting", "--warn-bg"],
    ["actor--stopped", "--surface-2"],
  ];
  const rules = readRules(withoutComments(readFileSync(`${SRC}/styles.css`, "utf-8")));
  const colourOf = (selector: string): string | undefined => {
    const own = rules.filter((rule) => rule.selector.split(",").some((one) => one.trim() === selector)).map((rule) => token(rule.decls.get("color")));
    return own.filter(Boolean).at(-1);
  };

  it.each(CARDS)("%s: nothing on it is faded by opacity", (card) => {
    const faded = rules.filter((rule) => rule.selector.includes(card) && rule.decls.has("opacity")).map((rule) => rule.selector);
    expect(faded).toEqual([]);
  });

  describe.each(Object.entries(themes()))("%s theme", (theme, tokens) => {
    it.each(CARDS)("%s: its id and its meta are at AA on the card", (card, background) => {
      const id = colourOf(`.${card} .actor__id`) ?? colourOf(".actor__id") ?? "--text-primary";
      const meta = colourOf(`.${card} .actor__meta`) ?? colourOf(".actor__meta");
      expect(meta, `${card}'s meta has a colour`).toBeDefined();
      for (const text of [id, meta!]) expect(contrast(tokens[text], tokens[background]), `${text} on ${background} (${theme})`).toBeGreaterThanOrEqual(4.5);
    });
  });
});

describe("the colours the sheets pair", () => {
  it("finds pairs to check", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  describe.each(Object.entries(themes()))("%s theme", (theme, tokens) => {
    /** The pairs under 4.5:1, each named without its ratio, so that a finding can be reported by name. */
    const failing = (): { key: string; line: string }[] => {
      const out: { key: string; line: string }[] = [];
      for (const pair of all) {
        const [text, background] = [tokens[pair.color], tokens[pair.background]];
        // an alpha wash or a scrim has no single colour to measure
        if (!text?.startsWith("#") || !background?.startsWith("#")) continue;
        const ratio = contrast(text, background);
        const key = `${pair.where}: ${pair.color} on ${pair.background} (${theme})`;
        if (ratio < 4.5) out.push({ key, line: `${key} = ${ratio.toFixed(2)}` });
      }
      return out;
    };

    it("keeps every text on its background at AA, 4.5:1, bar the findings reported to the file's owner", () => {
      expect(failing().filter(({ key }) => !(key in REPORTED)).map(({ line }) => line)).toEqual([]);
    });

    it("lists a reported finding only while it still fails, so the list cannot go stale", () => {
      const still = new Set(failing().map(({ key }) => key));
      const gone = Object.keys(REPORTED).filter((key) => key.endsWith(`(${theme})`) && !still.has(key));
      expect(gone).toEqual([]);
    });
  });
});
