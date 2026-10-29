import { useId, useState, type ReactNode } from "react";

export interface TooltipProps {
  /** What to say, in a sentence. It is also the accessible description of the wrapper. */
  label: ReactNode;
  /** Which side of the trigger it opens on. Default "top". The "-end" ones line the bubble's right
   * edge up with the trigger's, for a trigger at the right edge of the screen. */
  placement?: "top" | "bottom" | "left" | "right" | "top-end" | "bottom-end";
  /** Make the wrapper a tab stop. Use it for a disabled control, which cannot take focus itself,
   * so a keyboard user can still read why it is disabled. */
  focusable?: boolean;
  children: ReactNode;
}

/** A hint that opens on hover and on focus, stays open while the pointer is over it, and closes
 * with Escape (WCAG 1.4.13). The bubble is always in the DOM, so `aria-describedby` works. */
export function Tooltip({ label, placement = "top", focusable = false, children }: TooltipProps) {
  const id = useId();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hover || focus) && !dismissed;
  return (
    <span
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
      <span id={id} role="tooltip" className="tip__bubble">
        {label}
      </span>
    </span>
  );
}
