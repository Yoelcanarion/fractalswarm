// A move from one value to another on a clock, pure so that it can be tested without a browser.
//
// It is nearly linear: a short ramp up to a constant speed, the constant speed, a short ramp down to rest. The visuals ease
// each of their own elements once, over their own stretch of the progress (a row of the tree, a lane, a panel), so an ease
// on the progress as well would be an ease on an ease and squeeze every stretch into the middle of the move; the ramps are
// there for what has no ease of its own (a counter, a bar), so that it does not start and stop with a jolt.
//
// A move starts where the value is, at the speed the value has, so a reader who goes through several steps in a second sees
// one continuous motion and not a stop at every step. It is a function of time with no state of its own, so, unlike a
// spring, it never overshoots the target and it ends exactly when it says it will.

export interface Tween {
  from: number;
  to: number;
  /** The speed at the start, value per second (bounded: see `beginTween`). */
  speed: number;
  /** Seconds. */
  start: number;
  duration: number;
}

export interface Sample {
  value: number;
  /** Value per second. */
  velocity: number;
  done: boolean;
}

/** Each ramp is this long at most, in seconds, and at most this share of the move. */
export const RAMP_SECONDS = 0.2;
export const RAMP_SHARE = 0.25;

// The speed taken over from the move before is held to at most three times this move's average speed in its own direction
// and to at most one times it against: a flick that ends on a nearby step does not run past it, and a reader who turns
// round sees the old speed ease off before the value comes back.
const SPEED_MAX = 3;
const SPEED_MIN = -1;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export const rampOf = (duration: number): number => Math.min(RAMP_SECONDS, RAMP_SHARE * duration);

/** A move from `from`, which is changing at `velocity` per second, to `to`, over `duration` seconds from `now`. */
export function beginTween(now: number, from: number, velocity: number, to: number, duration: number): Tween {
  const distance = to - from;
  const span = Math.max(duration, 1e-6);
  const speed = distance === 0 ? 0 : clamp((velocity * span) / distance, SPEED_MIN, SPEED_MAX) * (distance / span);
  return { from, to, speed, start: now, duration: span };
}

/** The speed goes from the one taken over to a constant one over the first ramp, stays, and goes to nothing over the last
 * ramp; the constant speed is the one that covers the distance in the time. */
export function sampleTween(tween: Tween, now: number): Sample {
  const { from, to, speed: carried, duration } = tween;
  const t = now - tween.start;
  if (t >= duration) return { value: to, velocity: 0, done: true };
  if (t <= 0) return { value: from, velocity: carried, done: false };
  const ramp = rampOf(duration);
  const cruise = (to - from - (ramp * carried) / 2) / (duration - ramp);
  if (t < ramp) {
    return {
      value: from + carried * t + ((cruise - carried) * t * t) / (2 * ramp),
      velocity: carried + ((cruise - carried) * t) / ramp,
      done: false,
    };
  }
  if (t <= duration - ramp) {
    return { value: from + (ramp * (carried + cruise)) / 2 + cruise * (t - ramp), velocity: cruise, done: false };
  }
  const left = duration - t;
  return { value: to - (cruise * left * left) / (2 * ramp), velocity: (cruise * left) / ramp, done: false };
}
