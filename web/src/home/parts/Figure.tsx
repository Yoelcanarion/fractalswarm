import { animate } from "motion/react";
import { useRef } from "react";

import { MISSING } from "../format";
import { useIsoLayoutEffect, useStill } from "../hooks";

export type Tone = "swarm" | "rival" | "loss" | "paid-twice" | "ok" | "plain";

export interface FigureProps {
  /** The number; null while the data is missing. */
  value: number | null | undefined;
  /** How it is written, e.g. `(n) => seconds(n, 1)`. */
  format: (n: number) => string;
  label?: string;
  tone?: Tone;
  /** Counts up from zero once, when it comes into view. Default true; never when still. */
  count?: boolean;
  size?: "figure" | "stat";
}

/** A number set large, in tabular figures, with its label. The markup always holds the final number; in the
 * browser it is taken back to zero before the first paint and counted up once, when it enters the view. */
export function Figure({ value, format, label, tone = "plain", count = true, size = "figure" }: FigureProps) {
  const still = useStill();
  const number = useRef<HTMLSpanElement>(null);
  const write = useRef(format);
  write.current = format;
  const known = typeof value === "number" && Number.isFinite(value);

  useIsoLayoutEffect(() => {
    const element = number.current;
    if (!element || !known || !count || still || typeof IntersectionObserver === "undefined") return;
    const target = value as number;
    element.textContent = write.current(0);
    let playing: { stop(): void } | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        playing = animate(0, target, {
          duration: 1.2,
          ease: [0.23, 1, 0.32, 1],
          onUpdate: (v) => {
            element.textContent = write.current(v);
          },
        });
      },
      { rootMargin: "0px 0px -18% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      playing?.stop();
      element.textContent = write.current(target);
    };
  }, [value, known, count, still]);

  return (
    <div className={`home-figure home-figure--${size} home-figure--${tone}`}>
      <span ref={number} className="home-figure__number">
        {known ? format(value as number) : MISSING}
      </span>
      {label && <span className="home-figure__label">{label}</span>}
    </div>
  );
}
