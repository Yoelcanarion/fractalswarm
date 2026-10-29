// React bindings for the clock of the nearest run store.

import { useEffect, useLayoutEffect, useRef } from "react";
import { useStore } from "zustand";

import { useRunStore } from "../store";
import type { ClockState } from "./clock";

/** The nearest store's clock state. ``playhead`` here is throttled (see lib/clock.ts), so use it
 * for things that can change ~20 times a second; use ``useClockFrame`` for anything smoother. */
export function useClock<T>(selector: (state: ClockState) => T): T {
  const clock = useRunStore((s) => s.clock);
  return useStore(clock.state, selector);
}

/** Call ``listener`` with the exact virtual time in ms after every frame, step and seek, and
 * again after every render of the calling component, so the DOM it writes never goes stale. It
 * runs outside React's render cycle: write to the DOM through a ref, never set state. */
export function useClockFrame(listener: (t: number) => void): void {
  const clock = useRunStore((s) => s.clock);
  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
    listener(clock.now());
  });
  useEffect(() => clock.onFrame((t) => latest.current(t)), [clock]);
}
