import type { ReactNode } from "react";

import { Tooltip, type TooltipProps } from "./Tooltip";

export interface HintProps {
  /** What it means, in a sentence. With nothing to say the children are drawn as they are. */
  label?: string | null;
  /** A tab stop, so the keyboard can open it. Off by default: a hint on what repeats down a panel (a chip, a row) would turn the
   * page into a page of tab stops. Turn it on for a hint that stands alone, one or two to a page. */
  focusable?: boolean;
  placement?: TooltipProps["placement"];
  children: ReactNode;
}

/** A hint in place of a native `title`, which a keyboard, a touch screen and most screen readers never reach: a bubble for the pointer
 * (and for focus when `focusable`), and the same words as text for a screen reader. */
export function Hint({ label, focusable = false, placement, children }: HintProps) {
  if (!label) return <>{children}</>;
  return (
    <Tooltip label={label} focusable={focusable} placement={placement}>
      {children}
      {/* a focusable one is read as the description of what has focus; the others have no focus to read it from */}
      {!focusable && <span className="sr-only"> {label}</span>}
    </Tooltip>
  );
}
