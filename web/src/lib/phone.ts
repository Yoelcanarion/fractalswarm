// Whether the window is as narrow as a phone's. The same width as the style sheets' `@media (max-width: 760px)`, so what the code lays out
// differently (the tree on its side, components/TreeGraph.tsx) and what the sheets restyle change at one and the same window.

import { useSyncExternalStore } from "react";

export const PHONE_QUERY = "(max-width: 760px)";

const list = (): MediaQueryList | null => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : null);

function subscribe(notify: () => void): () => void {
  const media = list();
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
}

/** True while the window is a phone's width. False where there is no window (a server render), so the layout of a desktop is the one a test sees. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => list()?.matches ?? false,
    () => false,
  );
}
