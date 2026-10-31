import { useEffect, type RefObject } from "react";

/** The room a page has, written to a CSS variable on its root: the height of the page's scroll area, which is the window less the bars of the app and
 * the guide band while that is open. What is capped to it (the arena's boards, the Muse lens) moves with a band that comes and goes. */
export function useRoom(page: RefObject<HTMLElement | null>, variable: string): void {
  useEffect(() => {
    const root = page.current;
    const area = root?.closest<HTMLElement>(".content") ?? null;
    if (!root || !area) return;
    const write = (): void => root.style.setProperty(variable, `${area.clientHeight}px`);
    write();
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(write) : null;
    watch?.observe(area);
    return () => {
      watch?.disconnect();
      root.style.removeProperty(variable);
    };
  }, [page, variable]);
}
