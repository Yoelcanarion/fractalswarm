// Small hooks shared by the sections: the motion preference, the pointer, and what starts an animation: a section coming
// into view (`useArrival`). Nothing here reads where the page is scrolled to: scrolling only starts things.

import { animate, useMotionValue, type MotionValue } from "motion/react";
import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

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
const HOVER = "(hover: hover) and (pointer: fine)";

const subscribeReduced = mediaSubscriber(REDUCED);
const subscribeHover = mediaSubscriber(HOVER);

/** True when the person asked the system for less motion. Follows the setting while the page is open. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => mediaMatches(REDUCED), () => false);
}

/** True where a pointer can rest on a card: a mouse or a trackpad. On a touch screen a hover is a tap, so the cards play on arrival instead. */
export function useCanHover(): boolean {
  return useSyncExternalStore(subscribeHover, () => mediaMatches(HOVER), () => true);
}

/** "Still": nothing scrubs or moves, and every beat shows its final state. Set by the page from the
 * system's reduced-motion preference or from `?still`, so every part reads one answer. */
export const StillContext = createContext(false);
export const useStill = (): boolean => useContext(StillContext);

/** About how much of a section must be on screen before its animation starts. */
export const ARRIVAL_SHARE = 0.4;

// Often enough for the observer to call back while a tall section slides in, whatever the screen.
const ARRIVAL_THRESHOLDS = [0, 0.02, 0.05, 0.08, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** Whether enough of an element is on screen: `share` of its height, or `share` of the screen's when it is taller than the
 * screen (a phone shows a third of a tall section, never 40% of it). The numbers come from the observer's own entry. */
export function arrivalReached(visible: number, height: number, screen: number, share: number = ARRIVAL_SHARE): boolean {
  if (!(height > 0) || !(visible > 0)) return false;
  return visible >= Math.min(height, screen) * share - 1;
}

/** True from the moment about 40% of the element is on screen, and true for good after that: scrolling starts an animation,
 * and the animation then runs on its own clock. It is true at once where the page stands still or has no observer. */
export function useArrival(ref: RefObject<Element | null>, share: number = ARRIVAL_SHARE): boolean {
  const still = useStill();
  const [arrived, setArrived] = useState(still);
  useEffect(() => {
    if (still || typeof IntersectionObserver === "undefined") {
      setArrived(true);
      return undefined;
    }
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const screen = entry.rootBounds?.height ?? window.innerHeight;
          if (arrivalReached(entry.intersectionRect.height, entry.boundingClientRect.height, screen, share)) {
            setArrived(true);
            observer.disconnect();
            return;
          }
        }
      },
      { threshold: ARRIVAL_THRESHOLDS },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, still, share]);
  return arrived;
}

/** Writes `data-onscreen="true|false"` on the element as it enters and leaves the view, with no React render: the loops of CSS
 * inside it pause while it is false (`animation-play-state`), so nothing runs off screen. */
export function useOnScreenAttribute(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (latest) element.dataset.onscreen = String(latest.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      delete element.dataset.onscreen;
    };
  }, [ref]);
}

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
        // linear: the visuals ease each of their own elements once, over their own stretch of this progress; a driver that
        // eased as well would squeeze every stretch into the first fifth of the time
        playing = animate(progress, 1, { duration, delay, ease: "linear" });
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
