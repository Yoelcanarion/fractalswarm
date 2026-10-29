// recharts animates a series whenever its data changes. That is right once, when a chart first
// appears (the hero chart drawing itself in is part of the video), and wrong on every later tick
// of a replay, where the chart would crawl towards each new value and never catch up.

import { useEffect, useState } from "react";

import { prefersReducedMotion } from "./motion";

export const CHART_DRAW_MS = 700;

export interface DrawProps {
  isAnimationActive: boolean;
  animationDuration: number;
  animationEasing: "ease-out";
}

export const drawProps = (drawing: boolean, durationMs = CHART_DRAW_MS): DrawProps => ({
  isAnimationActive: drawing,
  animationDuration: durationMs,
  animationEasing: "ease-out",
});

/** Animation props for the series of one chart: on while it draws in for the first time, then off
 * for good. Call it in the component that mounts the chart, so the clock starts when the chart
 * appears, and spread the result on each `<Line>`, `<Bar>` and `<Area>`. Never on under reduced
 * motion. */
export function useFirstDraw(durationMs = CHART_DRAW_MS): DrawProps {
  const [drawing, setDrawing] = useState(() => !prefersReducedMotion());
  useEffect(() => {
    if (!drawing) return;
    // A little over the animation, so it is not cut short by the switch.
    const handle = window.setTimeout(() => setDrawing(false), durationMs + 150);
    return () => window.clearTimeout(handle);
  }, [drawing, durationMs]);
  return drawProps(drawing, durationMs);
}
