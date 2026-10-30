import type { ReactNode } from "react";

import { GLOSSARY, type TermId } from "../../lib/glossary";
import { Tooltip, type TooltipProps } from "./Tooltip";

export interface TermProps {
  /** The glossary entry (lib/glossary.ts). */
  id: TermId;
  /** What to show in place of the entry's own word ("stalled" for "Stall time"). */
  children?: ReactNode;
  placement?: TooltipProps["placement"];
}

/** A word of the UI that has a definition: a dotted underline, and the definition on hover and on focus.
 * It is a tab stop, so a keyboard user can read it too. */
export function Term({ id, children, placement }: TermProps) {
  const entry = GLOSSARY[id];
  return (
    <Tooltip label={entry.says} focusable placement={placement}>
      <span className="term">{children ?? entry.term}</span>
    </Tooltip>
  );
}
