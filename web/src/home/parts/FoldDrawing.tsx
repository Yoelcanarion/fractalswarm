import { useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { playhead } from "../viz/ease";
import { useCalm } from "../viz/page";
import { onFrame } from "../viz/ticker";
import { whileVisible } from "../viz/visible";
import { useFoldOpenings } from "./SeeMore";

export interface FoldDrawingProps {
  /** How long it plays. */
  seconds: number;
  className: string;
  /** The drawing, from the one playhead: made when the fold first opens, so that a closed fold costs nothing. */
  children: (progress: MotionValue<number>, still: boolean) => ReactNode;
}

/** A drawing under See more: it plays each time its fold opens, as one playhead through the page's one ease, and rests on its last
 * frame. It runs only while it is on screen. Standing still, it shows that last frame at once. */
export function FoldDrawing({ seconds, className, children }: FoldDrawingProps) {
  const openings = useFoldOpenings();
  const progress = useMotionValue(0);
  const host = useRef<HTMLDivElement>(null);
  const calm = useCalm();

  useEffect(() => {
    if (openings === 0) return undefined;
    if (calm) {
      progress.set(1);
      return undefined;
    }
    progress.set(0);
    let elapsed = 0;
    let off: (() => void) | null = null;
    return whileVisible(host.current, () => {
      off = onFrame((dt) => {
        elapsed += dt;
        progress.set(playhead(elapsed, seconds));
        if (elapsed >= seconds) off?.();
      });
      return () => off?.();
    });
  }, [openings, calm, seconds, progress]);

  return (
    <div ref={host} className={className}>
      {openings > 0 && children(progress, calm)}
    </div>
  );
}
