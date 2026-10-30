import { describe, expect, it } from "vitest";

import { beginTween, sampleTween } from "./tween";

const smoothstep = (s: number): number => s * s * (3 - 2 * s);

describe("a tween from rest", () => {
  const tween = beginTween(10, 0.2, 0, 0.8, 2);

  it("starts where it is and ends exactly on the target, at rest", () => {
    expect(sampleTween(tween, 10)).toMatchObject({ value: 0.2, done: false });
    expect(sampleTween(tween, 10).velocity).toBeCloseTo(0);
    expect(sampleTween(tween, 12)).toEqual({ value: 0.8, velocity: 0, done: true });
    expect(sampleTween(tween, 99)).toEqual({ value: 0.8, velocity: 0, done: true });
  });

  it("is the smoothstep ease: slow, fast, slow", () => {
    for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(sampleTween(tween, 10 + 2 * s).value).toBeCloseTo(0.2 + 0.6 * smoothstep(s), 10);
    }
  });

  it("only goes forward, and is quickest in the middle", () => {
    let last = -Infinity;
    let fastest = 0;
    let at = 0;
    for (let i = 0; i <= 200; i++) {
      const sample = sampleTween(tween, 10 + (2 * i) / 200);
      expect(sample.value).toBeGreaterThanOrEqual(last);
      last = sample.value;
      if (sample.velocity > fastest) {
        fastest = sample.velocity;
        at = i;
      }
    }
    expect(at).toBeGreaterThan(90);
    expect(at).toBeLessThan(110);
    // the peak of a smoothstep is 1.5 times the average speed
    expect(fastest).toBeCloseTo(1.5 * (0.6 / 2), 2);
  });

  it("is where it began before it begins", () => {
    expect(sampleTween(tween, 3).value).toBeCloseTo(0.2);
  });

  it("goes down as well as up", () => {
    const down = beginTween(0, 0.9, 0, 0.1, 1);
    expect(sampleTween(down, 0.5).value).toBeCloseTo(0.5);
    expect(sampleTween(down, 0.5).velocity).toBeLessThan(0);
    expect(sampleTween(down, 1)).toEqual({ value: 0.1, velocity: 0, done: true });
  });
});

describe("a tween retargeted in the middle of a move", () => {
  it("starts from the value and the speed the last one had, so the motion is one piece", () => {
    const first = beginTween(0, 0, 0, 1, 2);
    const mid = sampleTween(first, 0.8);
    const second = beginTween(0.8, mid.value, mid.velocity, 1, 1.5);
    const start = sampleTween(second, 0.8);
    expect(start.value).toBeCloseTo(mid.value, 10);
    expect(start.velocity).toBeCloseTo(mid.velocity, 10);
  });

  it("is monotone when the speed it carries is in the direction of the move", () => {
    const first = beginTween(0, 0, 0, 1, 2);
    const mid = sampleTween(first, 0.8);
    const second = beginTween(0.8, mid.value, mid.velocity, 1, 1.5);
    let last = mid.value;
    for (let i = 1; i <= 150; i++) {
      const value = sampleTween(second, 0.8 + (1.5 * i) / 150).value;
      expect(value).toBeGreaterThanOrEqual(last - 1e-12);
      last = value;
    }
    expect(last).toBeCloseTo(1, 10);
  });

  it("has no jump in value at any retarget along the way", () => {
    // retarget every frame towards a target that moves: the value never steps by more than the speed allows
    let tween = beginTween(0, 0, 0, 0.25, 1);
    let value = 0;
    let velocity = 0;
    const dt = 1 / 60;
    let biggest = 0;
    for (let frame = 1; frame <= 300; frame++) {
      const now = frame * dt;
      // the target steps up a quarter every 20 frames for a while (a reader going through the steps), then stays
      const target = Math.min(1, 0.25 * Math.ceil(Math.min(frame, 80) / 20));
      if (frame <= 80 && frame % 20 === 1) tween = beginTween(now - dt, value, velocity, target, 1.1);
      const sample = sampleTween(tween, now);
      biggest = Math.max(biggest, Math.abs(sample.value - value));
      value = sample.value;
      velocity = sample.velocity;
    }
    expect(biggest).toBeLessThan(0.03);
    expect(value).toBe(1);
  });

  it("does not overshoot a target the speed was already carrying it towards", () => {
    const fast = beginTween(0, 0, 0, 1, 0.5);
    const mid = sampleTween(fast, 0.25);
    const retarget = beginTween(0.25, mid.value, mid.velocity, mid.value + 0.01, 1);
    for (let i = 0; i <= 100; i++) {
      expect(sampleTween(retarget, 0.25 + i / 100).value).toBeLessThanOrEqual(mid.value + 0.01 + 1e-9);
    }
  });

  it("when the reader turns round, lets the old speed ease off first and then comes back", () => {
    const up = beginTween(0, 0, 0, 1, 1);
    const mid = sampleTween(up, 0.5);
    const back = beginTween(0.5, mid.value, mid.velocity, 0.2, 1);
    const values = Array.from({ length: 101 }, (_, i) => sampleTween(back, 0.5 + i / 100).value);
    // it ends on the new target, and at no time goes past the old one by more than a sliver of the distance
    expect(values[100]).toBeCloseTo(0.2);
    expect(Math.max(...values)).toBeLessThan(mid.value + 0.12);
  });

  it("takes only a bounded share of the old speed", () => {
    const quick = beginTween(0, 0.5, 100, 0.6, 1);
    // an enormous speed towards a nearby target is held to three times the distance in the first instant
    expect(sampleTween(quick, 0.001).velocity).toBeLessThanOrEqual(3 * 0.1 * 1.01);
  });

  it("treats a retarget to where it already is as no move", () => {
    const still = beginTween(0, 0.4, 0.3, 0.4, 1);
    expect(sampleTween(still, 0.5).value).toBe(0.4);
  });

  it("copes with a duration of nothing", () => {
    const instant = beginTween(0, 0, 0, 1, 0);
    expect(sampleTween(instant, 0.001)).toEqual({ value: 1, velocity: 0, done: true });
  });
});
