// The one ease of the page's animations (redesign brief, rule 3): each animation is a single playhead run through this curve, and its
// parts take stretches of the playhead, with no ease of their own and no holds, so nothing crawls and then bursts.
//
// A cubic bezier, so that a CSS animation and a JS one are the same motion: `cssEase` is the string the style sheet uses
// (`--ease-play` in viz.css), `ease` the same curve as a function. It is a gentle S: it leaves rest at a fifth of the mean speed
// instead of at none, so a motion that starts on arrival shows itself at once, and its fastest moment is 1.36 times the mean.
// ease.test.ts holds the two limits of the brief: a peak of at most 1.6 times the mean speed, and at least a tenth of the way done
// at a fifth of the time.

import { cubicBezier } from "../../lib/motion";

export const EASE_PLAY = [0.3, 0.05, 0.7, 0.95] as const;

export const cssEase = `cubic-bezier(${EASE_PLAY.join(", ")})`;

export const ease: (t: number) => number = cubicBezier(...EASE_PLAY);

/** How long each kind of animation takes, in seconds (the brief's ranges). */
export const SECONDS = {
  /** Bars and numbers growing. */
  grow: 1.6,
  /** The Problem film. */
  film: 7,
  /** A step's drawing playing on hover, focus or tap. */
  hover: 0.8,
  /** A takeover in the click demo, from the coordinator going dark to the work hanging from the heir. */
  takeover: 2.6,
} as const;

/** The playhead of an animation `seconds` long, `elapsed` seconds after it started: 0..1, eased once. */
export const playhead = (elapsed: number, seconds: number): number => ease(seconds <= 0 ? 1 : elapsed / seconds);
