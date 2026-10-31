import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { COPY } from "../copy";

/** The nuance of a section, folded. A native `details`: it opens with the keyboard, the browser's own search finds the text
 * inside it, and it needs no script. Closed, its contents are not on the screen and not in the count of the words. */
export function SeeMore({ children, label = COPY.seeMore }: { children: ReactNode; label?: string }) {
  return (
    <details className="home-fold">
      <summary className="home-fold__summary">
        <span>{label}</span>
        <ChevronDown className="home-fold__chevron" size={16} aria-hidden />
      </summary>
      <div className="home-fold__body">{children}</div>
    </details>
  );
}
