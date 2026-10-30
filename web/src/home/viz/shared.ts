// What every visual shares: the props contract, the small maths of motion, and the one hook that
// turns a progress value into drawing. The visuals are pure functions of ``progress``: the same
// number always draws the same picture, so a scroll position can be scrubbed both ways.

import { useLayoutEffect } from "react";
import type { MotionValue } from "motion/react";
import type { Story } from "../data/types";
import { prefersReducedMotion } from "../../lib/motion";

export interface VizProps {
  /** 0..1. Driven by time (the hero) or by the scroll position (a beat). */
  progress: MotionValue<number>;
  /** The home page's data file; every number a visual draws comes from it. */
  data: Story;
  /** Draw the final state once and never subscribe: reduced motion, a thumbnail, a print. */
  still?: boolean;
  /** The progress a still frame shows. 1 (the end state) unless a beat says otherwise. */
  stillAt?: number;
  className?: string;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Where x sits between a and b, clamped to 0..1. */
export const span = (x: number, a: number, b: number): number => (b === a ? (x >= b ? 1 : 0) : clamp01((x - a) / (b - a)));
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** A number for an SVG attribute: short, and never "-0". */
export const fx = (n: number, places = 2): string => {
  const v = n.toFixed(places);
  return v === "-0.00" || v === "-0.0" || v === "-0" ? v.slice(1) : v;
};

/**
 * Calls ``apply`` with the current progress now, and again whenever it changes. With ``still`` (or
 * when the person asked for less motion) it draws ``stillAt`` once and subscribes to nothing, so
 * a reduced-motion visitor gets the final picture and no scrubbing.
 */
export function useProgress(
  progress: MotionValue<number>,
  apply: (p: number) => void,
  still: boolean | undefined,
  stillAt = 1,
): void {
  useLayoutEffect(() => {
    if (still || prefersReducedMotion()) {
      apply(stillAt);
      return undefined;
    }
    apply(progress.get());
    return progress.on("change", apply);
  }, [progress, apply, still, stillAt]);
}

/** Natural order of actor ids: o1.1 before o1.2 before o2 before o10. */
export function naturalCompare(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (i % 2 === 1 && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}
