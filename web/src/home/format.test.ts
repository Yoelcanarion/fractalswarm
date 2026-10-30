import { describe, expect, it } from "vitest";

import { count, figure, MINUS, MISSING, percent, seconds, times, usd } from "./format";

describe("how the page writes a number", () => {
  it("writes seconds, percentages and dollars with fixed decimals", () => {
    expect(seconds(14.6)).toBe("14.6 s");
    expect(seconds(92.64, 1)).toBe("92.6 s");
    expect(percent(6.6)).toBe("+6.6%");
    expect(percent(75.55, 1)).toBe("+75.6%");
    expect(usd(0.5011)).toBe("$0.50");
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(count(12)).toBe("12");
    expect(times(13.2)).toBe("13.2 times");
  });

  it("uses a true minus sign, and no sign at all for zero or for a share", () => {
    expect(percent(-6.6)).toBe(`${MINUS}6.6%`);
    expect(percent(0)).toBe("0.0%");
    expect(percent(41.5, 0, false)).toBe("42%");
    expect(percent(-3, 0, false)).toBe("3%");
  });

  it("shows a dash for what it does not have, never a made-up number", () => {
    for (const written of [seconds(null), seconds(undefined), seconds(Number.NaN), percent(null), usd(undefined), count(null), times(Number.POSITIVE_INFINITY)]) {
      expect(written).toBe(MISSING);
    }
  });

  it("writes a figure as its source does", () => {
    expect(figure(13.2)).toBe("13.2");
    expect(figure(5.7)).toBe("5.7");
    expect(figure(1.25)).toBe("1.25");
    expect(figure(2)).toBe("2");
    expect(figure(0.9)).toBe("0.9");
    expect(figure(0.9, 2)).toBe("0.90");
    expect(figure(0.123456)).toBe("0.12");
  });
});
