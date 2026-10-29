// What is drawn over the stage: captions and the rings of highlights. Their opacity is a function of the take's time,
// computed here and written as a style, never a CSS transition: a take repeats frame for frame, and a frame stepped by
// a recorder shows the same caption at the same strength however long the machine took to draw the one before.

import type { Rect } from "./camera";
import type { Target } from "./targets";

export const FADE_MS = 250;
export const RING_FADE_MS = 160;
export const PULSE_MS = 1400;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 0 before ``from``, rising to 1 over ``fade`` ms, 1 until ``fade`` ms before ``to``, then falling to 0 at ``to``. */
export function envelope(t: number, from: number, to: number, fade: number): number {
  if (t < from || t >= to) return 0;
  const half = Math.max(0, Math.min(fade, (to - from) / 2));
  if (half === 0) return 1;
  return Math.min(clamp01((t - from) / half), clamp01((to - t) / half));
}

export interface Caption {
  id: number;
  text: string;
  kicker: string | null;
  style: "lower" | "overlay";
  from: number;
  to: number;
}

export const captionOpacity = (caption: Caption, t: number): number => envelope(t, caption.from, caption.to, FADE_MS);

/** Add a caption. One of each style is on screen at a time: it takes the place of the one before, which fades out
 * over the time the new one fades in. */
export function addCaption(captions: readonly Caption[], next: Caption): Caption[] {
  const kept = captions.map((caption) => (caption.style === next.style && caption.to > next.from + FADE_MS ? { ...caption, to: next.from + FADE_MS } : caption));
  return [...kept, next];
}

/** The captions that have something to show at ``t``, and drops the ones that are over. */
export function liveCaptions(captions: readonly Caption[], t: number): Caption[] {
  return captions.filter((caption) => t < caption.to);
}

export interface Ring {
  id: number;
  target: Target;
  from: number;
  to: number;
}

/** A ring fades in and out and breathes a little in between, so it reads as attention and not as a border. */
export function ringOpacity(ring: Ring, t: number): number {
  const base = envelope(t, ring.from, ring.to, RING_FADE_MS);
  if (base === 0) return 0;
  const breath = 0.85 + 0.15 * Math.sin(((t - ring.from) / PULSE_MS) * 2 * Math.PI);
  return base * breath;
}

export const liveRings = (rings: readonly Ring[], t: number): Ring[] => rings.filter((ring) => t < ring.to);

/** A tooltip is asked for like a ring: a target and a time. Its words are read off the page each frame. */
export type Tip = Ring;

export const tipOpacity = (tip: Tip, t: number): number => envelope(t, tip.from, tip.to, FADE_MS);

export interface Placed {
  ring: Ring;
  rect: Rect;
  opacity: number;
}

export interface PlacedTip {
  tip: Tip;
  /** The target, where it is on screen now. */
  rect: Rect;
  /** The target's hover text, as the page words it. */
  text: string;
  opacity: number;
}
