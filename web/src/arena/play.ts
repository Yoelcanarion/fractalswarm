// What the arena's main action does to the one clock of the pair, as the run page's does to its run (components/PlayAction.tsx): watch the
// first crash, or play the whole pair from its start. Only the playhead moves; the logs are not cut.

import type { Clock } from "../lib/clock";
import { prefersReducedMotion } from "../lib/motion";
import { PHONE_QUERY } from "../lib/phone";
import { firstCrashStart, marksOf } from "../lib/timeline";
import type { RunEvent } from "../lib/types";

/** Where "Watch the first crash" starts for a pair: a few seconds before the earlier of the two runs' first coordinator kills, so that both
 * sides are in view when the first one falls. Null where neither run kills a coordinator. */
export function firstCrashOfPair(left: RunEvent[], right: RunEvent[]): number | null {
  const starts = [firstCrashStart(marksOf(left)), firstCrashStart(marksOf(right))].filter((at): at is number => at !== null);
  return starts.length === 0 ? null : Math.min(...starts);
}

/** Both runs to ``at``, played from there at 1×, the speed the recordings read at. The seek comes first, because playing a clock that stands at
 * its end starts it again from the beginning. */
export function watchFirstCrash(clock: Clock, at: number): void {
  clock.seekTime(at);
  clock.setSpeed(1);
  clock.setPlaying(true);
}

/** Both runs from their start, at the speed they were at. */
export function playFromStart(clock: Clock): void {
  clock.seekTime(0);
  clock.setPlaying(true);
}

/** On a phone the boards come one under the other, under the lead, the pair's picker and what the rival is granted: a press on a play action scrolls the
 * first board to the top of the window, so that what plays, its tree and the line over it that says a coordinator is down, is in view, and the first
 * crash does not happen under the fold. A wider window shows the boards on its first screen, and nothing moves. As on the run page
 * (components/PlayAction.tsx), it waits for the page to be drawn for what the press did. */
export function bringBoardIntoView(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function" || !window.matchMedia(PHONE_QUERY).matches) return;
  requestAnimationFrame(() => {
    document.querySelector(".arena .side")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  });
}

/** "12.3 s": two decimals under ten seconds, one above. */
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

/** "t = 12.3 s / 76.4 s": where the shared clock is, of the length of the longer run. */
export const clockReadout = (t: number, end: number): string => `t = ${seconds(Math.min(t, end))} / ${seconds(end)}`;
