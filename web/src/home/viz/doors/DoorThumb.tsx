import { useMotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../../lib/motion";
import { ease } from "../ease";
import { onFrame } from "../ticker";
import "../viz.css";
import { whileVisible } from "../visible";
import { DoorGlyph } from "./DoorGlyph";
import type { DoorId } from "./doors";

export interface DoorThumbProps {
  door: DoorId;
  /** A still page, or a person who asked for less motion: the glyph in its end state, and no loop. */
  still?: boolean;
  className?: string;
}

/** Seconds one way of the loop takes: slow enough to be a hum behind the card, not something to watch. */
const LEG = 2.4;

/**
 * The picture on a door card: the door's glyph, going there and back again by itself, softly. The loop is a triangle wave run
 * through the page's one ease, so it turns round without a jump and nothing holds at either end; it runs only while the card is
 * on screen and the tab is visible.
 */
export function DoorThumb({ door, still = false, className }: DoorThumbProps) {
  const progress = useMotionValue(0);
  const host = useRef<HTMLDivElement>(null);
  const calm = still || prefersReducedMotion();

  useEffect(() => {
    if (calm) return undefined;
    let t = 0;
    return whileVisible(host.current, () =>
      onFrame((dt) => {
        t += dt;
        const k = (t / LEG) % 2;
        progress.set(ease(k < 1 ? k : 2 - k));
      }),
    );
  }, [calm, progress]);

  return (
    <div ref={host} className={className ? `hv-thumb ${className}` : "hv-thumb"}>
      <DoorGlyph progress={progress} data={door} still={calm} />
    </div>
  );
}
