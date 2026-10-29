// Lite motion: opt-in switches that drop the effects costing the most style work on every frame at a high
// playback speed, for a slow machine or a recording. Off by default; nothing is dropped unless it is asked for.
//
//   ?lite=all                    every part
//   ?lite=anim,filter,shadow     any of the parts (also in the hash query: #/run/x?speed=20&lite=anim)
//
// styles/lite.css keys on <html data-lite="anim filter shadow">, so a page can also flip the parts while it runs by
// setting that attribute, which is what the frame-time harness does to compare them in one build.
//
//   anim     the dashed-line animation of the lit edges (React Flow moves stroke-dashoffset on the main thread)
//   filter   the drop-shadow glow of a talking edge
//   shadow   the box-shadow rings of the nodes, and their colour transitions
//
// A part changes how something is dressed, not what is shown: a talking edge keeps its colour and its width, and
// a node keeps its border.

export const LITE_PARTS = ["anim", "filter", "shadow"] as const;
export type LitePart = (typeof LITE_PARTS)[number];

const EVERY = new Set(["all", "1", "true", "on"]);

/** The parts a `lite` value asks for, in a fixed order: "all" is every part, a list picks some, anything else none. */
export function parseLite(value: string | null | undefined): LitePart[] {
  const asked = (value ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (asked.some((word) => EVERY.has(word))) return [...LITE_PARTS];
  return LITE_PARTS.filter((part) => asked.includes(part));
}

/** The `lite` value of a page address: the query string, else the query of the hash route. */
export function liteFromAddress(search: string, hash: string): string | null {
  const fromSearch = new URLSearchParams(search).get("lite");
  if (fromSearch !== null) return fromSearch;
  const at = hash.indexOf("?");
  return at < 0 ? null : new URLSearchParams(hash.slice(at + 1)).get("lite");
}

/** Put the requested parts on <html data-lite>, or take the attribute off. Called once, before the first render. */
export function initLite(root: HTMLElement = document.documentElement, address: { search: string; hash: string } = window.location): void {
  const parts = parseLite(liteFromAddress(address.search, address.hash));
  if (parts.length > 0) root.dataset.lite = parts.join(" ");
  else delete root.dataset.lite;
}
