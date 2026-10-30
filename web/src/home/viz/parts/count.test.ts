import { motionValue } from "motion/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { countSpec, countText, formatCount } from "./count";
import { CountUp } from "./CountUp";

describe("formatCount", () => {
  it("groups the thousands and keeps the places it is asked for", () => {
    expect([formatCount(0, 0), formatCount(999, 0), formatCount(1234, 0), formatCount(1234567.891, 2), formatCount(1234.5, 1)]).toEqual(["0", "999", "1,234", "1,234,567.89", "1,234.5"]);
  });

  it("writes a negative number with the minus sign the charts use, and never a negative zero", () => {
    expect([formatCount(-6.6, 1), formatCount(-0.04, 1), formatCount(-1500, 0)]).toEqual(["−6.6", "0.0", "−1,500"]);
  });

  it("has a dash for what is not a number", () => {
    expect([formatCount(Number.NaN, 0), formatCount(Number.POSITIVE_INFINITY, 2)]).toEqual(["–", "–"]);
  });
});

describe("countSpec", () => {
  it("takes a bare number as a count to it from nothing, with the places it was written with", () => {
    expect(countSpec(42)).toEqual({ value: 42, decimals: 0, prefix: "", suffix: "", from: 0 });
    expect(countSpec(10.3).decimals).toBe(1);
    expect(countSpec(0.447697).decimals).toBe(3);
    expect(countSpec(1e-7).decimals).toBe(3);
  });

  it("keeps what it is told: places, a prefix and a suffix, where to start", () => {
    expect(countSpec({ value: 7.5, decimals: 2, prefix: "+", suffix: "%", from: 5 })).toEqual({ value: 7.5, decimals: 2, prefix: "+", suffix: "%", from: 5 });
  });

  it("keeps the places in a sensible range", () => {
    expect(countSpec({ value: 1, decimals: -3 }).decimals).toBe(0);
    expect(countSpec({ value: 1, decimals: 12 }).decimals).toBe(6);
    expect(countSpec({ value: Number.NaN }).decimals).toBe(0);
  });
});

describe("countText", () => {
  const count = countSpec({ value: 1234, suffix: " tokens" });

  it("starts at where it counts from and ends at exactly the number", () => {
    expect([countText(count, 0), countText(count, -1)]).toEqual(["0 tokens", "0 tokens"]);
    expect([countText(count, 1), countText(count, 2)]).toEqual(["1,234 tokens", "1,234 tokens"]);
    const odd = countSpec({ value: 0.1 + 0.2, decimals: 1 });
    expect(countText(odd, 1)).toBe("0.3");
  });

  it("only goes up, to the number and never past it, and counts fast at first", () => {
    let before = -1;
    for (let i = 0; i <= 500; i++) {
      const n = Number(countText(countSpec(1234), i / 500).replace(/,/g, ""));
      expect(n).toBeGreaterThanOrEqual(before);
      expect(n).toBeLessThanOrEqual(1234);
      before = n;
    }
    expect(Number(countText(countSpec(1000), 0.25))).toBeGreaterThan(500);
  });

  it("counts down when it is told to start above the number", () => {
    const down = countSpec({ value: 10, from: 100 });
    expect(Number(countText(down, 0.5))).toBeLessThan(100);
    expect(Number(countText(down, 0.5))).toBeGreaterThan(10);
  });

  it("is the same text for the same progress, and a dash for no number at all", () => {
    expect(countText(count, 0.37)).toBe(countText(count, 0.37));
    expect(countText(countSpec(Number.NaN), 0.5)).toBe("–");
  });

  it("never has a width wider than the end number's once the digits are tabular", () => {
    const spec = countSpec({ value: 279167, prefix: "~" });
    const end = countText(spec, 1).length;
    for (let i = 0; i <= 200; i++) expect(countText(spec, i / 200).length).toBeLessThanOrEqual(end);
  });
});

describe("CountUp markup", () => {
  it("holds the end number from the first frame, in the text a screen reader gets, and counts nothing aloud", () => {
    const html = renderToStaticMarkup(createElement(CountUp, { progress: motionValue(0), data: { value: 1234 } }));
    expect(html).toContain('<span class="hv-sr">1,234</span>');
    expect(html).toContain('<span class="hv-count__end" aria-hidden="true">1,234</span>');
    expect(html).toContain('<span class="hv-count__live" aria-hidden="true">0</span>');
  });

  it("shows the end for a visitor who asked for less motion, and the progress it is given otherwise", () => {
    const still = renderToStaticMarkup(createElement(CountUp, { progress: motionValue(0), data: 1234, still: true }));
    expect(still).toContain('<span class="hv-count__live" aria-hidden="true">1,234</span>');
    const half = renderToStaticMarkup(createElement(CountUp, { progress: motionValue(0.5), data: 1000 }));
    expect(half).toMatch(/hv-count__live" aria-hidden="true">(8\d\d|9\d\d)</);
    expect(renderToStaticMarkup(createElement(CountUp, { progress: motionValue(0), data: 5, still: true, stillAt: 0 }))).toContain('aria-hidden="true">0</span><span class="hv-sr">5');
  });

  it("takes a class of its own", () => {
    expect(renderToStaticMarkup(createElement(CountUp, { progress: motionValue(1), data: 3, className: "x" }))).toContain('class="hv hv-count x"');
  });
});
