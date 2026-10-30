import type { ReactNode } from "react";

import { GLOSSARY, type TermId } from "../../lib/glossary";
import { Tooltip, type TooltipProps } from "./Tooltip";

export interface TermProps {
  /** The glossary entry (lib/glossary.ts). */
  id: TermId;
  /** What to show in place of the entry's own word ("stalled" for "Stall time"). */
  children?: ReactNode;
  placement?: TooltipProps["placement"];
  /** A tab stop (default). Turn it off for a word that repeats down a table, where a tab stop on every row would
   * make the keyboard crawl: the definition then opens on hover only, so the page must define it once in text too. */
  focusable?: boolean;
}

/** A word of the UI that has a definition: a dotted underline, and the definition on hover and on focus.
 * It is a tab stop by default, so a keyboard user can read it too. */
export function Term({ id, children, placement, focusable = true }: TermProps) {
  const entry = GLOSSARY[id];
  return (
    <Tooltip label={entry.says} focusable={focusable} placement={placement}>
      <span className="term">{children ?? entry.term}</span>
    </Tooltip>
  );
}
