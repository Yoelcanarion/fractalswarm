import { useState, type KeyboardEvent } from "react";

/** One tab stop for a row of small buttons (the marks of a bar, the cards of a tree): Tab lands on one of them, the arrow keys, Home and
 * End move along the row, and the one last focused is where Tab lands next time. `selector` finds the buttons inside the row. */
export function useRoving(selector: string) {
  const [at, setAt] = useState(0);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)];
    const here = all.indexOf(event.target as HTMLElement);
    const towards: Record<string, number> = { ArrowRight: here + 1, ArrowLeft: here - 1, Home: 0, End: all.length - 1 };
    const to = towards[event.key];
    if (here < 0 || to === undefined || to < 0 || to >= all.length) return;
    event.preventDefault();
    all[to].focus();
  };
  /** What the button at `index` of `count` takes: the one tab stop, and the way it remembers it was focused. */
  const stop = (index: number, count: number) => ({ tabIndex: index === Math.min(at, count - 1) ? 0 : -1, onFocus: () => setAt(index) });
  return { onKeyDown, stop };
}
