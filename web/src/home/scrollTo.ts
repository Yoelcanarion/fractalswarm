// Jumping to a chapter. The address bar is the app's router (`#/...`), so a chapter link cannot be a plain
// `#id` anchor: it carries `#/?at=<chapter>`, which opens the page there when it is pasted, and a click on it
// scrolls smoothly and rewrites the address without leaving the page or filling the history.

import { prefersReducedMotion } from "../lib/motion";
import type { ChapterId } from "./chapters";
import { chapterHash } from "./route";

export function scrollToChapter(chapter: ChapterId, event?: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean; button?: number }): void {
  // A modified click opens the link in a new tab as usual.
  if (event && (event.metaKey || event.ctrlKey || (event.button ?? 0) !== 0)) return;
  event?.preventDefault();
  const target = document.getElementById(chapter);
  if (!target) return;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  try {
    history.replaceState(null, "", chapterHash(chapter));
  } catch {
    // an embedded or sandboxed page may not rewrite its address: the scroll has happened
  }
}

/** The brand: back to the top of the page. */
export function scrollToTop(event?: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean; button?: number }): void {
  if (event && (event.metaKey || event.ctrlKey || (event.button ?? 0) !== 0)) return;
  event?.preventDefault();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  try {
    history.replaceState(null, "", "#/");
  } catch {
    // see scrollToChapter
  }
}

/** Opening at `#/?at=<chapter>`: jump there at once, after the layout is in place. */
export function jumpToChapter(chapter: ChapterId): void {
  document.getElementById(chapter)?.scrollIntoView({ behavior: "auto", block: "start" });
}
