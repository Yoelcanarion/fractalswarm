// The log as a strip: real events, each carrying the hash of the one before. What is on the strip
// is a sample (windows around the kills and takeovers); a gap says how many events it skips.

import type { HashEvent, HashesSlice } from "../../data/types";
import { smoothstep, span } from "../shared";

export type StripItem =
  | { type: "event"; seq: number; tMs: number; kind: string; actor: string; hash: string; prev: string; mark: HashesSlice["marks"][string] | null; linked: boolean }
  | { type: "gap"; skipped: number };

/** Events and the gaps between them, in log order. ``linked``: the card follows the one before it directly. */
export function stripItems(hashes: HashesSlice): StripItem[] {
  const items: StripItem[] = [];
  let before: HashEvent | null = null;
  for (const e of hashes.events) {
    const [seq, tMs, kind, actor, hash, prev] = e;
    const skipped = before ? seq - before[0] - 1 : 0;
    if (skipped > 0) items.push({ type: "gap", skipped });
    items.push({ type: "event", seq, tMs, kind, actor, hash, prev, mark: hashes.marks[String(seq)] ?? null, linked: before !== null && skipped === 0 });
    before = e;
  }
  return items;
}

export const shortHash = (hash: string, digits = 10): string => `${hash.slice(0, digits)}…`;

export interface StripState {
  /** 0..1: how far the strip has travelled along its length. */
  shift: number;
  /** 0..1: the verdict is stamped. */
  stamp: number;
}

/** The strip moves along the log with the playhead it is given and no ease of its own, then rests on its end while the stamp lands. */
export function stripState(p: number): StripState {
  return { shift: span(p, 0.03, 0.8), stamp: smoothstep(span(p, 0.8, 0.93)) };
}

/**
 * The pixel offset of the track for a shift, given the widths measured when the layout changed. It crosses the last ``travel`` pixels
 * of the track, and the whole of it without one: all fifty cards in a few seconds would be a flicker, not a chain going by.
 */
export const offsetFor = (shift: number, trackWidth: number, viewWidth: number, travel = Infinity): number => {
  const whole = Math.max(0, trackWidth - viewWidth);
  const crossed = Math.min(whole, travel);
  return -(whole - crossed) - crossed * shift;
};
