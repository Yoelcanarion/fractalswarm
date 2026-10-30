// Small hooks shared by the chapters: the motion preference, the narrow layout, and the progress of a
// reveal that plays once when its element enters the view.

import { animate, useMotionValue, type MotionValue } from "motion/react";
import { createContext, useContext, useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from "react";

const hasWindow = typeof window !== "undefined" && typeof window.matchMedia === "function";

/** A layout effect where there is a browser; a plain effect where the page is rendered to a string (the tests), which would warn. */
export const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const mediaSubscriber =
  (query: string) =>
  (notify: () => void): (() => void) => {
    if (!hasWindow) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener("change", notify);
    return () => list.removeEventListener("change", notify);
  };

const mediaMatches = (query: string): boolean => hasWindow && window.matchMedia(query).matches;

const REDUCED = "(prefers-reduced-motion: reduce)";
const NARROW = "(max-width: 899px)";

const subscribeReduced = mediaSubscriber(REDUCED);
const subscribeNarrow = mediaSubscriber(NARROW);

/** True when the person asked the system for less motion. Follows the setting while the page is open. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => mediaMatches(REDUCED), () => false);
}

/** True on a phone-sized screen, where the stage sits above its steps instead of beside them. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => mediaMatches(NARROW), () => false);
}

/** "Still": nothing scrubs or moves, and every beat shows its final state. Set by the page from the
 * system's reduced-motion preference or from `?still`, so every part reads one answer. */
export const StillContext = createContext(false);
export const useStill = (): boolean => useContext(StillContext);

export interface EnterOptions {
  /** Seconds the progress takes to run from 0 to 1. */
  duration?: number;
  /** Seconds to wait after the element enters. */
  delay?: number;
  /** How much of the element must be in view, as the margin cut from the bottom of the viewport. */
  rootMargin?: string;
}

/** A progress that runs from 0 to 1, once, when the element comes into view: the draw of a chart, the
 * count of a number. A time-driven value for things that read better played than scrubbed. Already 1 when still. */
export function useEnterProgress(ref: RefObject<Element | null>, still: boolean, options: EnterOptions = {}): MotionValue<number> {
  const { duration = 1.4, delay = 0, rootMargin = "0px 0px -18% 0px" } = options;
  const progress = useMotionValue(still ? 1 : 0);
  useEffect(() => {
    if (still) {
      progress.set(1);
      return;
    }
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      progress.set(1);
      return;
    }
    let playing: { stop(): void } | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        playing = animate(progress, 1, { duration, delay, ease: [0.23, 1, 0.32, 1] });
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      playing?.stop();
    };
  }, [ref, still, progress, duration, delay, rootMargin]);
  return progress;
}
