// An eased move from one value to another on a clock, pure so that it can be tested without a browser.
//
// It is a cubic Hermite curve that starts where the value is, with the speed the value has, and ends at rest on the
// target. From rest that is the smoothstep ease (slow, fast, slow); retargeted in the middle of a move, the new curve
// takes over the old one's speed, so a reader who scrolls through several steps in a second sees one continuous motion
// and not a stop at every step. It is a curve over time and has no state of its own, so, unlike a spring, it never
// overshoots the target and it ends exactly when it says it will.

export interface Tween {
  from: number;
  to: number;
  /** The curve's tangent at the start, in value per move (the speed times the duration). */
  slope: number;
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

// A cubic Hermite with a zero tangent at the end is monotone while the start tangent is at most three times the distance;
// a start tangent against the distance (the reader turned round) may carry the old motion on a little before it turns.
const SLOPE_MAX = 3;
const SLOPE_MIN = -1;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** A move from `from`, which is changing at `velocity` per second, to `to`, over `duration` seconds from `now`. */
export function beginTween(now: number, from: number, velocity: number, to: number, duration: number): Tween {
  const distance = to - from;
  const span = Math.max(duration, 1e-6);
  const slope = distance === 0 ? 0 : clamp((velocity * span) / distance, SLOPE_MIN, SLOPE_MAX) * distance;
  return { from, to, slope, start: now, duration: span };
}

export function sampleTween(tween: Tween, now: number): Sample {
  const s = clamp((now - tween.start) / tween.duration, 0, 1);
  if (s >= 1) return { value: tween.to, velocity: 0, done: true };
  const s2 = s * s;
  const s3 = s2 * s;
  const value = (2 * s3 - 3 * s2 + 1) * tween.from + (s3 - 2 * s2 + s) * tween.slope + (-2 * s3 + 3 * s2) * tween.to;
  const rate = (6 * s2 - 6 * s) * tween.from + (3 * s2 - 4 * s + 1) * tween.slope + (-6 * s2 + 6 * s) * tween.to;
  return { value, velocity: rate / tween.duration, done: false };
}
