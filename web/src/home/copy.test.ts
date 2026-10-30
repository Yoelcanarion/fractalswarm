import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allCopy, COPY, TAGLINE, word } from "./copy";
import { sources } from "./testing";

// The words docs/claims.md forbids ("Rules", "Not claimed") and the second half of the old tagline.
const BANNED: [RegExp, string][] = [
  [/\bsimpler\b/i, "simpler"],
  [/\bcheaper\b/i, "cheaper"],
  [/more reliable/i, "more reliable"],
  [/\bfirst\b/i, "first"],
  [/without stalling or paying twice/i, "without stalling or paying twice"],
];

describe("the page's own words", () => {
  it("say the tagline exactly, and only its first sentence", () => {
    expect(TAGLINE).toBe("Kill half the brains. It still finishes.");
    expect(COPY.description.startsWith(TAGLINE)).toBe(true);
  });

  it("never use a word the claims rules forbid", () => {
    for (const sentence of allCopy()) {
      for (const [pattern, name] of BANNED) expect(pattern.test(sentence), `"${name}" in: ${sentence}`).toBe(false);
    }
  });

  it("hold no number of their own: a sentence that needs one is written from the data", () => {
    // Only the labels of the chapters, the model names and the command may carry a digit; a measured number may not.
    const measured = /\d+(\.\d+)?\s?(s\b|%|×|x\b|tokens|runs|seeds|talks)/;
    for (const sentence of allCopy()) expect(measured.test(sentence), `a number typed into: ${sentence}`).toBe(false);
  });

  it("reach no outside address: the page is offline", () => {
    const sourceText = sources()
      .map((file) => readFileSync(file, "utf-8"))
      .join("\n");
    expect(sourceText).not.toMatch(/https?:\/\//);
    expect(allCopy().join("\n")).not.toMatch(/https?:\/\//);
  });

  it("spell small counts as words and leave a missing one as a dash", () => {
    expect(word(3)).toBe("three");
    expect(word(12)).toBe("twelve");
    expect(word(48)).toBe("48");
    expect(word(null)).toBe("—");
    expect(word(undefined)).toBe("—");
  });
});
