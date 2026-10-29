import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import { formatNumber, prefersReducedMotion, tween } from "../../lib/motion";
import { Tooltip } from "./Tooltip";

export type Tone = "neutral" | "good" | "bad" | "warn" | "accent";

export interface StatProps {
  /** What the number is. Shown small and upper-case under the value. */
  label: string;
  /** A number counts to a new value when it changes; a string is shown as it is. */
  value: number | string;
  /** Digits after the decimal point of a number. Default 0. */
  decimals?: number;
  /** Text before the value ("$") and after it ("s", "tokens"). */
  prefix?: string;
  unit?: string;
  /** Colours the value. Default "neutral". */
  tone?: Tone;
  /** A change shown next to the value, with an arrow: `{ text: "12%", direction: "down", tone: "good" }`. */
  delta?: { text: string; direction?: "up" | "down"; tone?: Tone };
  /** The larger, highlighted tile for the headline number. */
  hero?: boolean;
  /** Count up (or down) to a changed number over `durationMs`. Default true. Pass false for a
   * live readout that changes many times a second, and in director takes that must repeat exactly. */
  animate?: boolean;
  /** Default 600. */
  durationMs?: number;
  /** Explains the number on hover. */
  hint?: string;
}

// The layout effect keeps the first paint on the right number; on the server there is no layout.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Writes the number into ``ref`` and moves it from what it shows to ``target``, frame by frame,
 * straight in the DOM, so a count-up costs no React render. */
function useCountUp(ref: RefObject<HTMLElement | null>, target: number | null, decimals: number, animate: boolean, durationMs: number) {
  const shown = useRef(target ?? 0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || target === null) return;
    const from = shown.current;
    if (!animate || from === target || !Number.isFinite(from) || prefersReducedMotion()) {
      shown.current = target;
      el.textContent = formatNumber(target, decimals);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const value = tween(from, target, t - t0, durationMs);
      shown.current = value;
      el.textContent = formatNumber(value, decimals);
      if (t - t0 < durationMs) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [ref, target, decimals, animate, durationMs]);
}

/** A figure with its label: the shared tile for counters. */
export function Stat({
  label,
  value,
  decimals = 0,
  prefix,
  unit,
  tone = "neutral",
  delta,
  hero = false,
  animate = true,
  durationMs = 600,
  hint,
}: StatProps) {
  const number = useRef<HTMLSpanElement>(null);
  const numeric = typeof value === "number" ? value : null;
  useCountUp(number, numeric, decimals, animate, durationMs);
  const tile = (
    <div className={`stat ${hero ? "stat--hero" : ""} stat--${tone}`}>
      <div className="stat__value">
        {prefix && <span className="stat__affix">{prefix}</span>}
        <span ref={number} className="stat__num">
          {numeric === null ? value : formatNumber(numeric, decimals)}
        </span>
        {unit && <span className="stat__affix">{unit}</span>}
        {delta && (
          <span className={`stat__delta stat__delta--${delta.tone ?? "neutral"}`}>
            {delta.direction === "up" && <ArrowUp size={14} strokeWidth={2.25} aria-hidden />}
            {delta.direction === "down" && <ArrowDown size={14} strokeWidth={2.25} aria-hidden />}
            {delta.text}
          </span>
        )}
      </div>
      <div className="stat__label">{label}</div>
    </div>
  );
  return hint ? <Tooltip label={hint}>{tile}</Tooltip> : tile;
}
