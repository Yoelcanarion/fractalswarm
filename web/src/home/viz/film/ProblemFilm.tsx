import { useMotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../../../lib/motion";
import { story } from "../../data/story";
import type { LanesSlice } from "../../data/types";
import { playhead, SECONDS } from "../ease";
import { WorkLanes } from "../lanes/WorkLanes";
import { onFrame } from "../ticker";
import "../viz.css";
import { whileVisible } from "../visible";

export interface ProblemFilmProps {
  /** 0 is not yet (the lanes at rest); each increment plays the film again from its start. */
  play: number;
  /** The lanes to play: the recorded run of an in-process supervisor when absent. */
  data?: LanesSlice;
  /** A still page, or a person who asked for less motion: the last frame, and no film. */
  still?: boolean;
  className?: string;
}

/**
 * The Problem section's film: one recorded run with an in-process supervisor, drawn as work lanes, that crashes and stalls. It plays
 * by itself, once for each increment of `play`, as one playhead of about seven seconds run through the page's one ease, from the
 * first call to the end. It runs only while it is on screen and the tab is visible, and picks up where it left off.
 */
export function ProblemFilm({ play, data, still = false, className }: ProblemFilmProps) {
  const progress = useMotionValue(0);
  const host = useRef<HTMLDivElement>(null);
  const calm = still || prefersReducedMotion();

  useEffect(() => {
    if (calm) {
      progress.set(1);
      return undefined;
    }
    progress.set(0);
    if (play <= 0) return undefined;
    let elapsed = 0;
    let off: (() => void) | null = null;
    return whileVisible(host.current, () => {
      off = onFrame((dt) => {
        elapsed += dt;
        progress.set(playhead(elapsed, SECONDS.film));
        if (elapsed >= SECONDS.film) off?.();
      });
      return () => off?.();
    });
  }, [play, calm, progress]);

  return (
    <div ref={host} className={className ? `hv-film ${className}` : "hv-film"}>
      <WorkLanes progress={progress} data={data ?? story.lanes.central} still={calm} />
    </div>
  );
}
