// What starts an animation: a section about 40% on screen, once (redesign brief, motion rule 2). The observer itself needs a
// browser; the rule it applies to each entry is pure and is held here.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ARRIVAL_SHARE, arrivalReached } from "./hooks";
import { FoldDrawing } from "./parts/FoldDrawing";
import { FoldRow, SeeMore } from "./parts/SeeMore";

describe("the arrival of a section", () => {
  it("is 40% of it", () => {
    expect(ARRIVAL_SHARE).toBe(0.4);
  });

  it("is reached at 40% of an element that fits the screen, and not before", () => {
    expect(arrivalReached(400, 1000, 1080)).toBe(true);
    expect(arrivalReached(401, 1000, 1080)).toBe(true);
    expect(arrivalReached(398, 1000, 1080)).toBe(false);
    expect(arrivalReached(300, 1000, 1080)).toBe(false);
    expect(arrivalReached(1000, 1000, 1080)).toBe(true);
  });

  it("is reached at 40% of the screen for an element taller than the screen, which can never show 40% of itself", () => {
    // a phone, 844 px high, and a section of 3000 px: a third of the screen is enough
    expect(arrivalReached(338, 3000, 844)).toBe(true);
    expect(arrivalReached(300, 3000, 844)).toBe(false);
    // 40% of 3000 px is 1200 px, which no screen shows
    expect(arrivalReached(844, 3000, 844)).toBe(true);
  });

  it("is never reached by an element with nothing on screen or no height", () => {
    expect(arrivalReached(0, 1000, 1080)).toBe(false);
    expect(arrivalReached(10, 0, 1080)).toBe(false);
    expect(arrivalReached(Number.NaN, 1000, 1080)).toBe(false);
  });

  it("takes another share when asked", () => {
    expect(arrivalReached(500, 1000, 1080, 0.5)).toBe(true);
    expect(arrivalReached(450, 1000, 1080, 0.5)).toBe(false);
  });
});

describe("See more", () => {
  const markup = renderToStaticMarkup(createElement(SeeMore, null, createElement("p", null, "the nuance")));

  it("is a native details: closed until it is opened, with the nuance inside it", () => {
    expect(markup).toMatch(/^<details class="home-fold"><summary class="home-fold__summary"><span>See more<\/span>/);
    expect(markup).not.toContain(" open");
    expect(markup).toContain('<div class="home-fold__body"><p>the nuance</p></div>');
  });

  it("names its label when it is given one", () => {
    expect(renderToStaticMarkup(createElement(SeeMore, { label: "More", children: "x" }))).toContain("<span>More</span>");
  });

  it("makes no drawing until it has been opened, so that a closed fold costs nothing", () => {
    const drawn = vi.fn(() => createElement("i", null, "drawing"));
    const closed = renderToStaticMarkup(createElement(SeeMore, null, createElement(FoldDrawing, { seconds: 1, className: "held", children: drawn })));
    expect(closed).toContain('<div class="held"></div>');
    expect(drawn).not.toHaveBeenCalled();
  });

  it("reads in the order of the markup, the words, then what they are about, then the words that follow it", () => {
    const words = (text: string) => createElement("p", null, text);
    const row = renderToStaticMarkup(createElement(FoldRow, { side: words("side"), after: words("after"), children: words("words") }));
    expect(row.indexOf("words")).toBeLessThan(row.indexOf("side"));
    expect(row.indexOf(">side<")).toBeLessThan(row.indexOf(">after<"));
    expect(row).toMatch(/^<div class="home-fold__row">/);
    expect(renderToStaticMarkup(createElement(FoldRow, { side: "s", middle: true, children: "w" }))).toMatch(/^<div class="home-fold__row home-fold__row--middle">/);
  });
});
