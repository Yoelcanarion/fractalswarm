// The sample the helps tests read: honesty.json as W1's bench wrote it (code 3e723a8, bench/PREREG.md sha 25d4a75919b3).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseHonesty, type Honesty } from "./honesty";

let raw: unknown;

/** The file's JSON, parsed once. A test that changes it clones it first. */
export function honestySample(): unknown {
  raw ??= JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/honesty.sample.json", import.meta.url)), "utf-8"));
  return raw;
}

export function parsedSample(): Honesty {
  const parsed = parseHonesty(honestySample());
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.honesty;
}

/** The text a reader sees in rendered markup. */
export const plainText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .replace(/ ([,.:;)])/g, "$1") // a tag that ends a word leaves a space the reader never sees before punctuation
    .trim();

/** How many times ``needle`` occurs in ``html``. */
export const occurrences = (html: string, needle: string): number => html.split(needle).length - 1;
