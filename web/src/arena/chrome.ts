import { useEffect, useLayoutEffect, type RefObject } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const CLEAR = 8; // between a side and the pinned timeline

/** What the page keeps of its room around the boards, written to `--arena-chrome` on its root: all that stands over a side, a side without its board,
 * and the pinned timeline. It is measured because the lead and the picker wrap with the window, and a figure that falls short puts the teams and the
 * work meter under the timeline. None of it depends on the height of the boards, so writing it settles at once. */
export function useBoardChrome(page: RefObject<HTMLElement | null>, watching: boolean): void {
  useIsoLayoutEffect(() => {
    const root = page.current;
    const side = root?.querySelector<HTMLElement>(".side");
    const board = root?.querySelector<HTMLElement>(".side__board");
    const bar = root?.querySelector<HTMLElement>(".tl");
    if (!watching || !root || !side || !board || !bar) return;
    const write = (): void => {
      const above = side.getBoundingClientRect().top - root.getBoundingClientRect().top;
      root.style.setProperty("--arena-chrome", `${Math.ceil(above + side.offsetHeight - board.offsetHeight + bar.offsetHeight + CLEAR)}px`);
    };
    write();
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(write) : null;
    for (const part of [root, side, bar]) watch?.observe(part);
    return () => {
      watch?.disconnect();
      root.style.removeProperty("--arena-chrome");
    };
  }, [page, watching]);
}
