import { describe, expect, it } from "vitest";

import { segmentEmail, spanOf } from "./emailSegments";

const email = "Hi. I land at noon on day two. Please keep me out of the first slot.";

describe("where a constraint's source sits", () => {
  it("takes a character range as it is, and finds a quoted sentence", () => {
    expect(spanOf(email, [4, 31])).toEqual([4, 31]);
    expect(spanOf(email, "I land at noon on day two.")).toEqual([4, 30]);
  });

  it("gives up on a range or a quote that is not in the message", () => {
    expect(spanOf(email, [40, 900])).toBeNull();
    expect(spanOf(email, [5, 5])).toBeNull();
    expect(spanOf(email, "never said")).toBeNull();
    expect(spanOf(email, undefined)).toBeNull();
    expect(spanOf(email, "")).toBeNull();
  });
});

describe("a message cut at its sources", () => {
  it("keeps every character, in order, and marks the stretches that were read", () => {
    const parts = segmentEmail(email, [spanOf(email, "I land at noon on day two."), spanOf(email, "keep me out of the first slot")]);
    expect(parts.map((part) => part.text).join("")).toBe(email);
    expect(parts.filter((part) => part.constraint !== null).map((part) => [part.constraint, part.text])).toEqual([
      [0, "I land at noon on day two."],
      [1, "keep me out of the first slot"],
    ]);
  });

  it("numbers a constraint by its place in the list, whatever the order in the message", () => {
    const parts = segmentEmail(email, [spanOf(email, "Please keep me"), spanOf(email, "Hi.")]);
    expect(parts.filter((part) => part.constraint !== null).map((part) => part.constraint)).toEqual([1, 0]);
  });

  it("skips a source that cannot be placed or that overlaps an earlier one", () => {
    const parts = segmentEmail(email, [[4, 30], [10, 20], null]);
    expect(parts.filter((part) => part.constraint !== null)).toEqual([{ text: email.slice(4, 30), constraint: 0 }]);
    expect(parts.map((part) => part.text).join("")).toBe(email);
  });

  it("returns the message whole when nothing was read from it", () => {
    expect(segmentEmail(email, [])).toEqual([{ text: email, constraint: null }]);
    expect(segmentEmail("", [])).toEqual([]);
  });
});
