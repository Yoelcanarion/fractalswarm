import { useEffect, type RefObject } from "react";

/** The room the arena has: the height of the page's scroll area, which is the window less the bars of the app and the guide band while that is open.
 * The boards are capped to what is left of it above the pinned timeline (arena.css, --arena-room), so a band that comes and goes moves the cap with it. */
export function useRoom(arena: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = arena.current;
    const area = root?.closest<HTMLElement>(".content") ?? null;
    if (!root || !area) return;
    const write = (): void => root.style.setProperty("--arena-room", `${area.clientHeight}px`);
    write();
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(write) : null;
    watch?.observe(area);
    return () => {
      watch?.disconnect();
      root.style.removeProperty("--arena-room");
    };
  }, [arena]);
}
