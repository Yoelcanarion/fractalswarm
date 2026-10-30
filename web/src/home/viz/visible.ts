// Runs something only while an element is on screen: the hero's loop and the tree's ambient layer start when the element
// comes into view and stop, and with them their share of every frame, when it leaves.

/**
 * Calls ``start`` while ``element`` intersects the viewport, and the function it returned when it does not. Where there is
 * no IntersectionObserver (or no element yet) it starts at once. The returned function stops it and the watching.
 */
export function whileVisible(element: Element | null, start: () => () => void): () => void {
  let stop: (() => void) | null = null;
  const set = (on: boolean): void => {
    if (on && stop === null) stop = start();
    else if (!on && stop !== null) {
      stop();
      stop = null;
    }
  };
  if (!element || typeof IntersectionObserver === "undefined") {
    set(true);
    return () => set(false);
  }
  const watcher = new IntersectionObserver((records) => {
    const latest = records[records.length - 1];
    if (latest) set(latest.isIntersecting);
  });
  watcher.observe(element);
  return () => {
    watcher.disconnect();
    set(false);
  };
}
