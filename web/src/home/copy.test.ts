import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allCopy, COPY, TAGLINE, word } from "./copy";
import { bundledStory } from "./story";
import { sources, UNIVERSAL } from "./testing";

// The words docs/claims.md forbids ("Rules", "Not claimed") and the second half of the old tagline.
const BANNED: [RegExp, string][] = [
  [/\bsimpler\b/i, "simpler"],
  [/\bcheaper\b/i, "cheaper"],
  [/more reliable/i, "more reliable"],
  [/\bfirst\b/i, "first"],
  [/without stalling or paying twice/i, "without stalling or paying twice"],
  // Claims about the world or absolutes that nothing on the page backs (the coordinator's copy notes, Oct 30).
  [/\busual(ly)?\b/i, "usual"],
  [/\bevery advantage\b/i, "every advantage"],
  // Words that went beyond a claim (the coordinator's review, Oct 30, night). S1 says the survivors compute the same heir by one rule
  // and there is no election: it does not say that no message passes. The swarm stalls too (11.2 s), so it is not the one that need not stop.
  [/no message passes/i, "no message passes"],
  [/has to stop to recover/i, "has to stop to recover"],
  [/something to watch them/i, "something to watch them"],
  // R4 at ten seeds is a tie, not a help, and its three-seed wording is withdrawn.
  [/where it helps/i, "where it helps"],
  [/below half/i, "below half"],
  [/on every seed/i, "on every seed"],
  // The way into the rest of the product is the app (the coordinator, Oct 31): "Enter the simulation" sat oddly beside recordings of the real model.
  [/\bthe simulation\b/i, "the simulation"],
];

describe("the page's own words", () => {
  it("call the way into the rest of the product the app", () => {
    expect(COPY.bar.enter).toBe("Enter the app");
    expect(COPY.bar.enterShort).toBe("App");
  });

  it("say the tagline exactly, and only its first sentence", () => {
    expect(TAGLINE).toBe("Kill half the brains. It still finishes.");
    expect(COPY.description.startsWith(TAGLINE)).toBe(true);
  });

  it("never use a word the claims rules forbid", () => {
    for (const sentence of allCopy()) {
      for (const [pattern, name] of BANNED) expect(pattern.test(sentence), `"${name}" in: ${sentence}`).toBe(false);
    }
  });

  it("never say that every run was valid: only a claim of docs/claims.md may, in its words and with its setting", () => {
    for (const sentence of allCopy()) {
      for (const [pattern, name] of UNIVERSAL) expect(pattern.test(sentence), `"${name}" in: ${sentence}`).toBe(false);
    }
  });

  it("are guarded by patterns that catch a universal claim and let the honest side of it through", () => {
    const flagged = (text: string) => UNIVERSAL.some(([pattern]) => pattern.test(text));
    for (const text of [
      "Every run finished with a valid result.",
      "all the results are valid",
      "Valid.",
      "each of the runs completed",
      "it always finishes",
    ]) {
      expect(flagged(text), text).toBe(true);
    }
    // W7's dot plot rings a run whose result is not valid, and says so: that is the opposite claim.
    for (const text of ["result not valid", "1 of the runs has a result that is not valid and is ringed.", "the result is not valid", "an invalid result"]) {
      expect(flagged(text), text).toBe(false);
    }
  });

  it("say of the heir's drawing what S1 says, in its words, and no more", () => {
    const row = bundledStory.claims["S1"]?.text.toLowerCase() ?? "";
    const drawing = COPY.solution.cards.heir.drawing.toLowerCase().replace(/\.$/, "");
    expect(row).toContain(drawing);
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
