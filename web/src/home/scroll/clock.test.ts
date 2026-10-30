import { motionValue } from "motion/react";
import { describe, expect, it } from "vitest";

import { createClock, type ClockHost } from "./clock";
import { buildPlan, MAIN } from "./timeline";

/** Frames and a clock by hand: `run(seconds)` plays 60 frames a second for that long and returns what was seen. */
function manual() {
  let time = 100;
  let next = 1;
  const queue = new Map<number, () => void>();
  const host: ClockHost = {
    now: () => time,
    request: (callback) => {
      const handle = next++;
      queue.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      queue.delete(handle);
    },
  };
  return {
    host,
    get pending() {
      return queue.size;
    },
    run(seconds: number, each?: () => void): void {
      const end = time + seconds;
      while (time < end - 1e-9) {
        time = Math.min(end, time + 1 / 60);
        const frames = [...queue.values()];
        queue.clear();
        frames.forEach((frame) => frame());
        each?.();
      }
    },
  };
}

const plan = buildPlan([
  { id: "a", at: 0, layers: { x: 1 } },
  { id: "b", at: 0.2, play: 1 },
  { id: "c", at: 0.5, play: 2, to: { hrw: 1 } },
  { id: "d", at: 1, play: 1.5 },
]);

function setup() {
  const frames = manual();
  const progress = motionValue(0);
  const hrw = motionValue(0);
  const clock = createClock(plan, { [MAIN]: progress, hrw }, frames.host);
  return { frames, progress, hrw, clock };
}

describe("a stage clock", () => {
  it("does nothing, and asks for no frames, until a step changes", () => {
    const { frames, clock } = setup();
    expect(clock.playing).toBe(false);
    expect(frames.pending).toBe(0);
    frames.run(1);
    expect(frames.pending).toBe(0);
  });

  it("plays to the next step's target in the step's own time", () => {
    const { frames, progress, clock } = setup();
    clock.go(1);
    expect(clock.step).toBe(1);
    expect(clock.playing).toBe(true);
    frames.run(0.5);
    expect(progress.get()).toBeGreaterThan(0.05);
    expect(progress.get()).toBeLessThan(0.15);
    frames.run(0.51);
    expect(progress.get()).toBeCloseTo(0.2, 10);
    expect(clock.playing).toBe(false);
  });

  it("runs one loop while it plays and none once it has arrived", () => {
    const { frames, clock } = setup();
    clock.go(2);
    let most = 0;
    frames.run(3, () => {
      most = Math.max(most, frames.pending);
    });
    expect(most).toBe(1);
    expect(frames.pending).toBe(0);
  });

  it("plays the other channels with it, to their own targets", () => {
    const { frames, progress, hrw, clock } = setup();
    clock.go(2);
    frames.run(1);
    expect(hrw.get()).toBeGreaterThan(0.1);
    expect(hrw.get()).toBeLessThan(0.9);
    frames.run(2);
    expect(progress.get()).toBeCloseTo(0.5, 10);
    expect(hrw.get()).toBeCloseTo(1, 10);
  });

  it("only goes forward on the way there and back on the way back", () => {
    const { frames, progress, clock } = setup();
    clock.go(3);
    let last = 0;
    frames.run(5, () => {
      expect(progress.get()).toBeGreaterThanOrEqual(last - 1e-12);
      last = progress.get();
    });
    expect(progress.get()).toBe(1);
    clock.go(1);
    frames.run(5, () => {
      expect(progress.get()).toBeLessThanOrEqual(last + 1e-12);
      last = progress.get();
    });
    expect(progress.get()).toBeCloseTo(0.2, 10);
  });

  it("plays back when the reader scrolls back", () => {
    const { frames, progress, hrw, clock } = setup();
    clock.go(2);
    frames.run(4);
    expect([progress.get(), hrw.get()]).toEqual([0.5, 1]);
    clock.go(1);
    frames.run(4);
    expect(progress.get()).toBeCloseTo(0.2, 10);
    expect(hrw.get()).toBeCloseTo(0, 10);
  });

  it("retargets in the middle of a move from where it is: no jump, and no second loop", () => {
    const { frames, progress, clock } = setup();
    clock.go(1);
    frames.run(0.4);
    const before = progress.get();
    clock.go(2);
    // the very next frame is within a frame's travel of where the value was
    frames.run(1 / 60);
    expect(Math.abs(progress.get() - before)).toBeLessThan(0.02);
    expect(frames.pending).toBe(1);
    frames.run(3);
    expect(progress.get()).toBeCloseTo(0.5, 10);
    expect(frames.pending).toBe(0);
  });

  it("keeps its speed across a retarget towards the same side", () => {
    const { frames, progress, clock } = setup();
    clock.go(3);
    frames.run(0.75);
    const a = progress.get();
    frames.run(1 / 60);
    const b = progress.get();
    const speed = (b - a) * 60;
    expect(speed).toBeGreaterThan(0);
    clock.go(3 - 0); // no move
    clock.go(2);
    frames.run(1 / 60);
    const c = progress.get();
    // the new curve starts with the speed the old one had, so the next frame moves about as far as the last one did
    expect(Math.abs((c - b) * 60 - speed)).toBeLessThan(speed * 0.35);
  });

  it("ends a nest of retargets on the last step's target, whatever order they came in", () => {
    const { frames, progress, hrw, clock } = setup();
    for (const step of [1, 3, 0, 2, 1, 3, 2]) {
      clock.go(step);
      frames.run(0.13);
    }
    frames.run(6);
    expect(progress.get()).toBeCloseTo(0.5, 10);
    expect(hrw.get()).toBeCloseTo(1, 10);
    expect(frames.pending).toBe(0);
  });

  it("stays inside 0..1 however it is retargeted", () => {
    const { frames, progress, hrw, clock } = setup();
    for (const step of [3, 0, 3, 0, 3, 0, 2, 3]) {
      clock.go(step);
      frames.run(0.09, () => {
        expect(progress.get()).toBeGreaterThanOrEqual(0);
        expect(progress.get()).toBeLessThanOrEqual(1);
        expect(hrw.get()).toBeGreaterThanOrEqual(0);
        expect(hrw.get()).toBeLessThanOrEqual(1);
      });
    }
  });

  it("snaps without playing, and drops a move in progress", () => {
    const { frames, progress, hrw, clock } = setup();
    clock.go(1);
    frames.run(0.3);
    clock.go(2, "snap");
    expect([progress.get(), hrw.get()]).toEqual([0.5, 1]);
    expect(clock.playing).toBe(false);
    expect(frames.pending).toBe(0);
    frames.run(2);
    expect(progress.get()).toBe(0.5);
  });

  it("does not move for a step it is already on", () => {
    const { frames, clock } = setup();
    clock.go(2, "snap");
    clock.go(2);
    expect(clock.playing).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it("answers for a step outside the plan with the nearest one", () => {
    const { progress, clock } = setup();
    clock.go(99, "snap");
    expect(clock.step).toBe(3);
    expect(progress.get()).toBe(1);
    clock.go(-4, "snap");
    expect(clock.step).toBe(0);
    expect(progress.get()).toBe(0);
  });

  it("stops where it is, and takes its frame back", () => {
    const { frames, progress, clock } = setup();
    clock.go(3);
    frames.run(0.5);
    const there = progress.get();
    clock.stop();
    expect(frames.pending).toBe(0);
    frames.run(3);
    expect(progress.get()).toBe(there);
    expect(clock.playing).toBe(false);
  });

  it("starts again after a stop with no speed left over from before it", () => {
    const { frames, progress, clock } = setup();
    clock.go(3);
    frames.run(0.8);
    clock.stop();
    const there = progress.get();
    clock.go(3, "snap");
    clock.go(0, "snap");
    clock.go(1);
    frames.run(1 / 60);
    // from rest: the first frame of a smoothstep barely moves
    expect(progress.get()).toBeLessThan(0.002);
    expect(there).toBeGreaterThan(0);
  });

  it("copes with a channel that has no motion value: the visual does not use it", () => {
    const frames = manual();
    const progress = motionValue(0);
    const clock = createClock(plan, { [MAIN]: progress }, frames.host);
    clock.go(2);
    frames.run(3);
    expect(progress.get()).toBeCloseTo(0.5, 10);
  });
});
