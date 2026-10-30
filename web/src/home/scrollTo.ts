// Jumping to a place on the page. The address bar is the app's router (`#/...`), so such a link cannot be a plain
// `#id` anchor: it carries `#/?at=<id>`, which opens the page there when it is pasted, and a click on it
// scrolls smoothly and rewrites the address without leaving the page or filling the history.

import { prefersReducedMotion } from "../lib/motion";
import type { Target } from "./chapters";
import { targetHash } from "./route";

interface Click {
  preventDefault(): void;
  metaKey?: boolean;
  ctrlKey?: boolean;
  button?: number;
}

// A modified click opens the link in a new tab as usual.
const opensElsewhere = (event?: Click): boolean => !!event && (!!event.metaKey || !!event.ctrlKey || (event.button ?? 0) !== 0);

export function scrollToTarget(target: Target, event?: Click): void {
  if (opensElsewhere(event)) return;
  event?.preventDefault();
  const element = document.getElementById(target);
  if (!element) return;
  element.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  try {
    history.replaceState(null, "", targetHash(target));
  } catch {
    // an embedded or sandboxed page may not rewrite its address: the scroll has happened
  }
}

/** The brand: back to the top of the page. */
export function scrollToTop(event?: Click): void {
  if (opensElsewhere(event)) return;
  event?.preventDefault();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  try {
    history.replaceState(null, "", "#/");
  } catch {
    // see scrollToTarget
  }
}

/** Opening at `#/?at=<id>`: jump there at once, after the layout is in place. */
export function jumpToTarget(target: Target): void {
  document.getElementById(target)?.scrollIntoView({ behavior: "auto", block: "start" });
}
