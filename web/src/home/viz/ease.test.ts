// The shared ease of the redesign (brief, rule 3): its peak speed is at most 1.6 times its mean, and it has covered at least a tenth
// of the way at a fifth of the time. What Yoel saw was a chart that crawled and then burst; these two numbers are the test for that.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HOME } from "../testing";
import { cssEase, EASE_PLAY, ease, playhead, SECONDS } from "./ease";

describe("the shared ease", () => {
  const N = 4000;
  const speeds = Array.from({ length: N }, (_, i) => (ease((i + 1) / N) - ease(i / N)) * N);

  it("starts at nothing, ends at everything and never goes back", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-3)).toBe(0);
    expect(ease(7)).toBe(1);
    for (const s of speeds) expect(s).toBeGreaterThanOrEqual(-1e-9);
  });

  it("peaks at no more than 1.6 times its mean speed, so nothing bursts", () => {
    expect(Math.max(...speeds)).toBeLessThanOrEqual(1.6);
  });

  it("has covered at least a tenth of the way at a fifth of the time, so nothing crawls first", () => {
    expect(ease(0.2)).toBeGreaterThanOrEqual(0.1);
  });

  it("leaves rest and comes to it, at a fifth of the mean speed, and passes the middle halfway", () => {
    expect(speeds[0]!).toBeGreaterThan(0.1);
    expect(speeds[N - 1]!).toBeGreaterThan(0.1);
    expect(ease(0.5)).toBeCloseTo(0.5, 6);
  });

  it("is the string the style sheet uses, so a CSS animation and a JS one are one motion", () => {
    expect(cssEase).toBe(`cubic-bezier(${EASE_PLAY.join(", ")})`);
    const css = readFileSync(`${HOME}/viz/viz.css`, "utf-8");
    expect(css).toContain(`--ease-play: ${cssEase};`);
  });

  it("runs a playhead of the given length, and is at its end for a length of nothing", () => {
    expect(playhead(0, 2)).toBe(0);
    expect(playhead(1, 2)).toBeCloseTo(0.5, 6);
    expect(playhead(2, 2)).toBe(1);
    expect(playhead(0, 0)).toBe(1);
  });

  it("keeps the brief's durations: bars and numbers 1.2 to 2 s, the film 6 to 8 s, a hover 0.6 to 0.9 s, a takeover in the demo 1.2 to 2.6 s", () => {
    expect(SECONDS.grow).toBeGreaterThanOrEqual(1.2);
    expect(SECONDS.grow).toBeLessThanOrEqual(2);
    expect(SECONDS.film).toBeGreaterThanOrEqual(6);
    expect(SECONDS.film).toBeLessThanOrEqual(8);
    expect(SECONDS.hover).toBeGreaterThanOrEqual(0.6);
    expect(SECONDS.hover).toBeLessThanOrEqual(0.9);
    // the takeover itself (after the coordinator goes dark and its neighbours notice) lasts 1.2 to 2 s of these
    expect(SECONDS.takeover).toBeGreaterThanOrEqual(1.2);
    expect(SECONDS.takeover).toBeLessThanOrEqual(2.6);
  });
});
