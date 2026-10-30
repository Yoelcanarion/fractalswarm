// The log as a strip: real events, each carrying the hash of the one before. What is on the strip
// is a sample (windows around the kills and takeovers); a gap says how many events it skips.

import type { HashEvent, HashesSlice } from "../../data/types";
import { easeInOutCubic, smoothstep, span } from "../shared";

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

/** The strip moves along the log, then rests on its end while the stamp lands. */
export function stripState(p: number): StripState {
  return { shift: easeInOutCubic(span(p, 0.03, 0.8)), stamp: smoothstep(span(p, 0.8, 0.93)) };
}

/** The pixel offset of the track for a shift, given the widths measured when the layout changed. */
export const offsetFor = (shift: number, trackWidth: number, viewWidth: number): number => -Math.max(0, trackWidth - viewWidth) * shift;
