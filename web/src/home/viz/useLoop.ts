import type { MotionValue } from "motion/react";
import { useEffect, type RefObject } from "react";
import { loopAt, type LoopSpec } from "./loop";
import { onFrame } from "./ticker";
import { whileVisible } from "./visible";

/** The loop moves the recorded run before the ambient layer reads the frame it painted (see ticker.ts). */
export const LOOP_ORDER = 0;

/**
 * Drives ``progress`` (the recorded run) and ``appear`` (how much of the tree is drawn) round the loop of `loop.ts`, on a clock
 * of its own, for as long as ``target`` is on screen and the tab is visible. With ``off`` (reduced motion, or a still frame)
 * it draws the end of the run once and runs nothing. It renders nothing: it only sets the two values.
 */
export function useLoop(target: RefObject<Element | null>, progress: MotionValue<number>, appear: MotionValue<number>, spec: LoopSpec, off: boolean): void {
  const { enter, run, rest, leave } = spec;
  useEffect(() => {
    if (off) {
      progress.set(1);
      appear.set(1);
      return undefined;
    }
    const clock: LoopSpec = { enter, run, rest, leave };
    let seconds = 0;
    progress.set(0);
    appear.set(0);
    return whileVisible(target.current, () =>
      onFrame((dt) => {
        seconds += dt;
        const state = loopAt(seconds, clock);
        if (state.p !== progress.get()) progress.set(state.p);
        if (state.appear !== appear.get()) appear.set(state.appear);
      }, LOOP_ORDER),
    );
  }, [target, progress, appear, enter, run, rest, leave, off]);
}
