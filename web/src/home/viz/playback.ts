// Time-driven progress, for a visual that plays on its own (the hero, the lab). A scroll-driven
// beat does not need it: the page feeds the visual a motion value of its own.

import type { MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Playback {
  playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Back to the start, paused or playing as it was. */
  restart(): void;
}

/**
 * Runs ``progress`` from where it is to 1 in ``seconds`` at constant speed; with ``loop`` it starts
 * over after a ``rest`` of seconds on the last frame. Stops itself on unmount.
 */
export function usePlayback(progress: MotionValue<number>, seconds: number, options: { loop?: boolean; rest?: number; autoplay?: boolean } = {}): Playback {
  const { loop = false, rest = 1.6, autoplay = false } = options;
  const [playing, setPlaying] = useState(autoplay);
  const resting = useRef(0);

  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (resting.current > 0) {
        resting.current -= dt;
        if (resting.current <= 0) progress.set(0);
      } else {
        const next = progress.get() + dt / seconds;
        if (next >= 1) {
          progress.set(1);
          if (loop) resting.current = rest;
          else setPlaying(false);
        } else {
          progress.set(next);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, progress, seconds, loop, rest]);

  const play = useCallback(() => {
    if (progress.get() >= 1) progress.set(0);
    resting.current = 0;
    setPlaying(true);
  }, [progress]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const restart = useCallback(() => {
    resting.current = 0;
    progress.set(0);
  }, [progress]);
  return { playing, play, pause, toggle, restart };
}
