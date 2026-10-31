import { useMotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import type { LanesSlice } from "../../data/types";
import { useStory } from "../../story";
import { ease, playhead, SECONDS } from "../ease";
import { WorkLanes } from "../lanes/WorkLanes";
import { useCalm } from "../page";
import { onFrame } from "../ticker";
import "../viz.css";
import { whileVisible } from "../visible";

/** Seconds each way of the cut a repeat makes. */
const CUT = 0.2;

/** What the film says as the playhead reaches each moment: the crash, the wait, the work paid for again. Drawn in the film's svg. */
export const FILM_MOMENTS = ["It crashes.", "The work waits.", "The work is paid for again."] as const;

export interface ProblemFilmProps {
  /** 0 is not yet (the lanes at rest); each increment plays the film again from its start. */
  play: number;
  /** The lanes to play: the recorded run of an in-process supervisor when absent. */
  data?: LanesSlice;
  /** The three captions, one for each moment: the film's own when absent. */
  moments?: readonly string[];
  /** Standing still, which the page says through its own context when this is absent: the last frame, and no film. */
  still?: boolean | undefined;
  className?: string;
}

/**
 * The Problem section's film: one recorded run with an in-process supervisor, drawn as work lanes, that crashes and stalls. It plays
 * by itself, once for each increment of `play`, as one playhead of about seven seconds run through the page's one ease, from the
 * first call to the end. Three large captions say what happened as it happens (the crash, the wait, the work paid for again) and
 * stay; the lanes have no names and the key has two items. It runs only while it is on screen and the tab is visible, and picks up where it left off. A repeat
 * fades the old picture out and the new one in (0.2 s each way) instead of jumping to the start.
 */
export function ProblemFilm({ play, data, moments = FILM_MOMENTS, still, className }: ProblemFilmProps) {
  const progress = useMotionValue(0);
  const host = useRef<HTMLDivElement>(null);
  const calm = useCalm(still);
  const story = useStory();
  const lanes = data ?? story?.lanes.central;

  useEffect(() => {
    if (calm) {
      progress.set(1);
      return undefined;
    }
    const element = host.current;
    if (play <= 0) {
      progress.set(0);
      return undefined;
    }
    // A repeat does not jump the lanes back to their start: the old picture fades out, the new one fades in, and the film begins.
    const repeat = progress.get() > 0;
    if (!repeat) progress.set(0);
    let cut = repeat ? 0 : 2 * CUT;
    let elapsed = 0;
    let off: (() => void) | null = null;
    const stop = whileVisible(element, () => {
      off = onFrame((dt) => {
        if (cut < 2 * CUT) {
          const before = cut;
          cut += dt;
          if (before < CUT && cut >= CUT) progress.set(0);
          if (element) element.style.opacity = cut >= 2 * CUT ? "" : String(cut < CUT ? 1 - ease(cut / CUT) : ease((cut - CUT) / CUT));
          return;
        }
        elapsed += dt;
        progress.set(playhead(elapsed, SECONDS.film));
        if (elapsed >= SECONDS.film) off?.();
      });
      return () => off?.();
    });
    return () => {
      stop();
      if (element) element.style.opacity = "";
    };
  }, [play, calm, progress]);

  return (
    <div ref={host} className={className ? `hv-film ${className}` : "hv-film"}>
      {lanes && <WorkLanes progress={progress} data={lanes} still={calm} moments={moments} />}
    </div>
  );
}
