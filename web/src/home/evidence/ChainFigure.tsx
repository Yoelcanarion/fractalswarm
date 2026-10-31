import { useMotionValue } from "motion/react";
import { useRef } from "react";

import { prefersReducedMotion } from "../../lib/motion";
import { COPY } from "../copy";
import { slice, useStory } from "../story";
import { Viz } from "../visuals";
import type { LoopSpec } from "../viz/loop";
import { useLoop } from "../viz/useLoop";

/** Once through the log, the replay's stamp, a rest. The strip has no entrance of its own, so `enter` and `leave` are short. */
export const CHAIN_LOOP: LoopSpec = { enter: 0.1, run: 7, rest: 2.4, leave: 0.1 };

/** The one thing on this page that moves: the recorded run's log going by, and the stamp of its replay. It is the same log the
 * page proves at its end. Whoever asked for less motion sees the end of it, standing still. */
export function ChainFigure() {
  const story = useStory();
  const figure = useRef<HTMLElement>(null);
  const off = prefersReducedMotion();
  const play = useMotionValue(off ? 1 : 0);
  const appear = useMotionValue(1);
  useLoop(figure, play, appear, CHAIN_LOOP, off);
  const hashes = slice(story, "hashes");
  if (hashes === undefined || hashes === null) return null;
  return (
    <figure ref={figure} className="home-evidence__figure" aria-label={COPY.evidencePage.figure}>
      <Viz name="HashStrip" data={hashes} progress={play} still={off} />
    </figure>
  );
}
