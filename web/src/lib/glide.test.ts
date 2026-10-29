import { describe, expect, it } from "vitest";

import { createGlide, type Point } from "./glide";
import { cubicBezier, EASE_OUT } from "./motion";

const linear = (t: number): number => t;
const targets = (entries: Record<string, Point>): Map<string, Point> => new Map(Object.entries(entries));

describe("glide", () => {
  it("draws a node that appears at its place, with nothing to travel", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 10, y: 20 } }), 0);
    expect(glide.at(0).get("a")).toEqual({ x: 10, y: 20 });
    expect(glide.moving(0)).toBe(false);
  });

  it("moves a node to a new place over the duration, and no longer", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 100, y: 40 } }), 1000);
    expect(glide.moving(1000)).toBe(true);
    expect(glide.at(1000).get("a")).toEqual({ x: 0, y: 0 });
    expect(glide.at(1100).get("a")).toEqual({ x: 25, y: 10 });
    expect(glide.at(1200).get("a")).toEqual({ x: 50, y: 20 });
    expect(glide.at(1400).get("a")).toEqual({ x: 100, y: 40 });
    expect(glide.moving(1399)).toBe(true);
    expect(glide.moving(1400)).toBe(false);
    expect(glide.at(99_999).get("a")).toEqual({ x: 100, y: 40 });
  });

  it("follows the easing it is given", () => {
    const glide = createGlide(100, EASE_OUT);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 100, y: 0 } }), 0);
    // A strong ease-out has covered most of the way after a third of the time, and arrives exactly.
    expect(glide.at(33).get("a")!.x).toBeGreaterThan(70);
    expect(glide.at(100).get("a")!.x).toBe(100);
    const xs = [0, 10, 20, 40, 60, 80, 100].map((t) => glide.at(t).get("a")!.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("starts a new aim from where the node is drawn, so a change mid-glide bends the motion", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 100, y: 0 } }), 0);
    const midway = glide.at(200).get("a")!;
    expect(midway.x).toBe(50);
    glide.aim(targets({ a: { x: 50, y: 100 } }), 200);
    expect(glide.at(200).get("a")).toEqual(midway);
    expect(glide.at(400).get("a")).toEqual({ x: 50, y: 50 });
    expect(glide.at(600).get("a")).toEqual({ x: 50, y: 100 });
  });

  it("leaves a glide alone when the layout still wants the same place", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 100, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 100, y: 0 } }), 300);
    expect(glide.at(300).get("a")!.x).toBe(75);
    expect(glide.at(400).get("a")!.x).toBe(100);
  });

  it("jumps on a snap, wherever the nodes were", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 100, y: 100 }, b: { x: 200, y: 0 } }), 10, { snap: true });
    expect(glide.moving(10)).toBe(false);
    expect(glide.at(10).get("a")).toEqual({ x: 100, y: 100 });
    expect(glide.at(10).get("b")).toEqual({ x: 200, y: 0 });
  });

  it("starts a new node on its parent and sends it to its place", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ root: { x: 100, y: 0 } }), 0);
    glide.aim(targets({ root: { x: 100, y: 0 }, kid: { x: 0, y: 150 } }), 500, {
      origin: (id) => (id === "kid" ? "root" : null),
    });
    expect(glide.at(500).get("kid")).toEqual({ x: 100, y: 0 });
    expect(glide.at(700).get("kid")).toEqual({ x: 50, y: 75 });
    expect(glide.at(900).get("kid")).toEqual({ x: 0, y: 150 });
    expect(glide.at(700).get("root")).toEqual({ x: 100, y: 0 });
  });

  it("chains origins through a parent that is new too", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ root: { x: 0, y: 0 } }), 0);
    const parents: Record<string, string> = { mid: "root", leaf: "mid" };
    glide.aim(targets({ root: { x: 0, y: 0 }, mid: { x: 0, y: 150 }, leaf: { x: 0, y: 300 } }), 0, {
      origin: (id) => parents[id],
    });
    // Both start on the root and spread out from there.
    expect(glide.at(0).get("mid")).toEqual({ x: 0, y: 0 });
    expect(glide.at(0).get("leaf")).toEqual({ x: 0, y: 0 });
    expect(glide.at(400).get("leaf")).toEqual({ x: 0, y: 300 });
  });

  it("appears in place when it has no parent to come out of", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 0, y: 0 }, orphan: { x: 70, y: 70 } }), 100, { origin: () => null });
    expect(glide.at(100).get("orphan")).toEqual({ x: 70, y: 70 });
  });

  it("forgets a node that left the layout", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 0, y: 0 }, b: { x: 9, y: 9 } }), 0);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 10);
    expect([...glide.at(10).keys()]).toEqual(["a"]);
  });

  it("does not glide at all with a zero duration (reduced motion)", () => {
    const glide = createGlide(0, linear);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 0);
    glide.aim(targets({ a: { x: 100, y: 0 } }), 5);
    expect(glide.moving(5)).toBe(false);
    expect(glide.at(5).get("a")).toEqual({ x: 100, y: 0 });
  });

  it("treats a clock that went backwards as finished, not stuck half-way", () => {
    const glide = createGlide(400, linear);
    glide.aim(targets({ a: { x: 0, y: 0 } }), 50_000);
    glide.aim(targets({ a: { x: 100, y: 0 } }), 50_000);
    expect(glide.at(120).get("a")).toEqual({ x: 100, y: 0 });
    expect(glide.moving(120)).toBe(false);
  });

  it("does not mutate the targets it is given", () => {
    const glide = createGlide(400, linear);
    const place: Point = { x: 5, y: 5 };
    glide.aim(targets({ a: place }), 0);
    glide.at(0).get("a")!.x = 999;
    expect(place).toEqual({ x: 5, y: 5 });
  });
});

describe("cubicBezier", () => {
  it("is the identity for the linear curve", () => {
    const f = cubicBezier(0, 0, 1, 1);
    for (const t of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(f(t)).toBeCloseTo(t, 5);
  });

  it("starts at 0 and ends at 1, and clamps outside", () => {
    const f = EASE_OUT;
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(1);
    expect(f(-3)).toBe(0);
    expect(f(7)).toBe(1);
  });

  it("is symmetric for a symmetric ease-in-out", () => {
    const f = cubicBezier(0.42, 0, 0.58, 1);
    expect(f(0.5)).toBeCloseTo(0.5, 5);
    expect(f(0.25) + f(0.75)).toBeCloseTo(1, 5);
  });

  it("matches the CSS ease curve at a known point", () => {
    // cubic-bezier(0.25, 0.1, 0.25, 1) is CSS `ease`; at the middle it is about 0.802.
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
  });

  it("keeps the glide's curve a strong ease-out that never goes backwards", () => {
    expect(EASE_OUT(0.1)).toBeGreaterThan(0.35);
    expect(EASE_OUT(0.5)).toBeGreaterThan(0.9);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const value = EASE_OUT(i / 100);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
});
