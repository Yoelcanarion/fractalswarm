import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../../lib/motion";
import { playhead, SECONDS } from "../ease";
import { Pen } from "../tree/paint";
import { onFrame } from "../ticker";
import "../viz.css";
import { whileVisible } from "../visible";

export interface GrowNumberProps {
  value: number;
  /** How the number is written. Its end form is kept from the first frame (tabular digits), so nothing around it moves. */
  format?: (value: number) => string;
  /** 0 is not yet, and the number shows its start; each increment grows it again from there. */
  play: number;
  /** Seconds before it starts and how long it grows: a group's numbers start evenly apart and end together with its bars. */
  delay?: number;
  seconds?: number;
  /** A still page, or a person who asked for less motion: the number it is, at once. */
  still?: boolean;
  className?: string;
}

const plain = (value: number): string => String(value);

/** The number `value` makes at `elapsed` seconds into a growth of `seconds` that starts after `delay`: one playhead, eased once. */
export const grown = (value: number, elapsed: number, delay: number, seconds: number): number => value * playhead(elapsed - delay, seconds);

/**
 * A number that grows by itself to the number it is, once for each increment of `play`: one eased motion from nothing to the end,
 * written into one text node by one shared frame loop that runs only while the number is on screen. A screen reader is given the
 * end number and never the growth.
 */
export function GrowNumber({ value, format = plain, play, delay = 0, seconds = SECONDS.grow, still = false, className }: GrowNumberProps) {
  const live = useRef<HTMLSpanElement>(null);
  const end = format(value);

  useEffect(() => {
    const element = live.current;
    if (!element) return undefined;
    const pen = new Pen(element);
    if (still || prefersReducedMotion()) {
      pen.text(format(value));
      return undefined;
    }
    pen.text(format(0));
    if (play <= 0) return undefined;
    let elapsed = 0;
    let off: (() => void) | null = null;
    const stop = whileVisible(element, () => {
      off = onFrame((dt) => {
        elapsed += dt;
        pen.text(format(grown(value, elapsed, delay, seconds)));
        if (elapsed >= delay + seconds) {
          pen.text(format(value));
          off?.();
        }
      });
      return () => off?.();
    });
    return stop;
  }, [play, value, format, delay, seconds, still]);

  return (
    <span className={className ? `hv hv-count ${className}` : "hv hv-count"}>
      <span className="hv-count__end" aria-hidden>
        {end}
      </span>
      <span ref={live} className="hv-count__live" aria-hidden>
        {still ? end : format(0)}
      </span>
      <span className="hv-sr">{end}</span>
    </span>
  );
}
