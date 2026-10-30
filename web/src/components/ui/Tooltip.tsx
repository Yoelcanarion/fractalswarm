import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { tooltipPosition, type Placement } from "../../lib/tooltipPlacement";

export interface TooltipProps {
  /** What to say, in a sentence. It is also the accessible description of the wrapper. */
  label: ReactNode;
  /** Which side of the trigger it opens on. Default "top"; it opens on the other side when there is no
   * room. The "-end" ones line the bubble's right edge up with the trigger's, for a trigger at the right
   * edge of the screen. */
  placement?: Placement;
  /** Make the wrapper a tab stop. Use it for a disabled control, which cannot take focus itself,
   * so a keyboard user can still read why it is disabled, and for a term in running text. */
  focusable?: boolean;
  children: ReactNode;
}

// On the server there is no layout to measure (and nothing to place: the bubble starts closed).
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A hint that opens on hover and on focus, stays open while the pointer is over it, and closes
 * with Escape (WCAG 1.4.13). The bubble is always in the DOM, so `aria-describedby` works. It is
 * `position: fixed` and placed when it opens, so no card or table around the trigger clips it. */
export function Tooltip({ label, placement = "top", focusable = false, children }: TooltipProps) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hover || focus) && !dismissed;

  const place = useCallback(() => {
    const trigger = root.current;
    const node = bubble.current;
    if (!trigger || !node) return;
    // Where the bubble lands with left and top at 0 tells where its containing block starts: the window,
    // unless a transformed or contained ancestor has taken over, so the spot below is right in both cases.
    node.style.left = "0px";
    node.style.top = "0px";
    const origin = node.getBoundingClientRect();
    const spot = tooltipPosition(
      trigger.getBoundingClientRect(),
      { width: origin.width, height: origin.height },
      placement,
      { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    );
    node.style.left = `${spot.left - origin.left}px`;
    node.style.top = `${spot.top - origin.top}px`;
    node.dataset.side = spot.side;
  }, [placement]);

  useMeasure(() => {
    if (!open) return;
    place();
    // Scrolling any container under it moves the trigger; capture catches those scrolls too.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <span
      ref={root}
      className="tip"
      data-open={open}
      data-placement={placement}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={id}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => {
        setHover(false);
        setDismissed(false);
      }}
      onFocus={() => setFocus(true)}
      onBlur={() => {
        setFocus(false);
        setDismissed(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setDismissed(true);
          event.stopPropagation();
        }
      }}
    >
      {children}
      <span ref={bubble} id={id} role="tooltip" className="tip__bubble">
        {label}
      </span>
    </span>
  );
}
