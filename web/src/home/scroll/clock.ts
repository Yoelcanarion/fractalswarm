// The clock of a stage. The scroll says which step is current; this plays the visual to that step's targets in the step's
// own time, one animation frame loop for the whole stage that runs only while something is moving. It knows nothing of
// the DOM: the values are motion values, and time and frames come from a host, so a test can drive it by hand.

import type { MotionValue } from "motion/react";

import { clamp01, MAIN, type Plan } from "./timeline";
import { beginTween, sampleTween, type Tween } from "./tween";

export interface ClockHost {
  /** Seconds on a clock that only runs forward. */
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export const browserHost: ClockHost = {
  now: () => performance.now() / 1000,
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface StageClock {
  /** The step the visual is headed for (or at). */
  readonly step: number;
  /** Whether a move is under way. */
  readonly playing: boolean;
  /** Head for `step`: play there in the plan's time, or (`snap`) be there at once. A move in progress is retargeted from
   * where it is, with the speed it has, so the motion is one piece. */
  go(step: number, how?: "play" | "snap"): void;
  /** Stop where it is. */
  stop(): void;
}

/** Closer than this to its target, a value is simply there. */
const NEAR = 1e-4;

export function createClock(plan: Plan, values: Readonly<Record<string, MotionValue<number>>>, host: ClockHost = browserHost): StageClock {
  const names = [MAIN, ...plan.channels].filter((name) => name in values);
  const tweens = new Map<string, Tween>();
  const speed = new Map<string, number>();
  let step = 0;
  let frame = 0;

  const tick = (): void => {
    frame = 0;
    const now = host.now();
    for (const [name, tween] of tweens) {
      const sample = sampleTween(tween, now);
      values[name]!.set(clamp01(sample.value));
      speed.set(name, sample.velocity);
      if (sample.done) tweens.delete(name);
    }
    if (tweens.size > 0) frame = host.request(tick);
  };

  const halt = (): void => {
    if (frame) host.cancel(frame);
    frame = 0;
    tweens.clear();
    speed.clear();
  };

  return {
    get step() {
      return step;
    },
    get playing() {
      return tweens.size > 0;
    },
    go(next, how = "play") {
      const previous = step;
      step = Math.min(plan.steps.length - 1, Math.max(0, next));
      if (how === "snap") {
        halt();
        for (const name of names) values[name]!.set(plan.target(step, name));
        return;
      }
      if (step === previous) return;
      const seconds = plan.duration(previous, step);
      const now = host.now();
      for (const name of names) {
        const to = plan.target(step, name);
        const value = values[name]!.get();
        if (Math.abs(to - value) < NEAR) {
          tweens.delete(name);
          speed.delete(name);
          values[name]!.set(to);
        } else {
          tweens.set(name, beginTween(now, value, speed.get(name) ?? 0, to, seconds));
        }
      }
      if (tweens.size > 0 && !frame) frame = host.request(tick);
    },
    stop: halt,
  };
}
