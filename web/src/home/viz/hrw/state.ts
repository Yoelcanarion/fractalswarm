// The moment of the takeover, as a function of progress: every surviving brain computes the same
// scores from the same log and finds the same heir. Nothing is sent between them, so every panel
// is on the same step at the same progress.

import type { HrwRound } from "../../data/types";
import { easeOutCubic, smoothstep, span } from "../shared";

/** Where in 0..1 each step happens. These are the viz's keyframes for the page to line text up with. */
export const HRW_KEYFRAMES = {
  appear: [0, 0.08],
  compute: [0.1, 0.62],
  decide: [0.62, 0.74],
  agree: [0.78, 0.9],
} as const;

export interface HrwState {
  /** 0..1: the panels fade in. */
  appear: number;
  /** 0..1: how much of each score has been computed. */
  compute: number;
  /** 0..1: the highest score is picked out. */
  decide: number;
  /** 0..1: every panel states its answer. */
  agree: number;
}

export function hrwState(p: number): HrwState {
  return {
    appear: smoothstep(span(p, ...HRW_KEYFRAMES.appear)),
    compute: easeOutCubic(span(p, ...HRW_KEYFRAMES.compute)),
    decide: smoothstep(span(p, ...HRW_KEYFRAMES.decide)),
    agree: smoothstep(span(p, ...HRW_KEYFRAMES.agree)),
  };
}

/** The 16-digit score in groups of four, as the panels show it. */
export const groupHex = (hex: string): string => hex.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * How much of a score's grouped width is still hidden on the right, in percent, for each count of digits shown (0 to all). The
 * panels draw the whole score once and clip it, so a step of the reveal is one style write, not a text node rebuilt in each of
 * the rows (the score is in a mono face: the width of a prefix is its share of the characters).
 */
export function hiddenAt(hex: string): number[] {
  const whole = groupHex(hex).length;
  return Array.from({ length: hex.length + 1 }, (_, n) => Number(((1 - groupHex(hex.slice(0, n)).length / whole) * 100).toFixed(2)));
}

/** How many of the 16 hex digits are on screen when ``compute`` of the work is done. */
export const digitsShown = (compute: number, digits = 16): number => Math.min(digits, Math.floor(compute * (digits + 0.999)));

/** The scores of a round in the order of its pool (not best first), so the winner is not obvious. */
export function rowsOf(round: HrwRound): { member: string; score: string; fraction: number; win: boolean }[] {
  const byMember = new Map(round.scores.map((s) => [s.member, s]));
  return round.pool.flatMap((member) => {
    const s = byMember.get(member);
    return s ? [{ member, score: s.score, fraction: s.fraction, win: member === round.heir }] : [];
  });
}
