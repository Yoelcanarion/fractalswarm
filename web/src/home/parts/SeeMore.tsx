import { ChevronDown } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { COPY } from "../copy";

const Openings = createContext(0);

/** How many times the fold around this has been opened: 0 while it never has been. */
export const useFoldOpenings = (): number => useContext(Openings);

/** The nuance of a section, folded. A native `details`: it opens with the keyboard, the browser's own search finds the text
 * inside it, and it needs no script. Closed, its contents are not on the screen and not in the count of the words. */
export function SeeMore({ children, label = COPY.seeMore }: { children: ReactNode; label?: string }) {
  const [openings, setOpenings] = useState(0);
  return (
    <details className="home-fold" onToggle={(event) => event.currentTarget.open && setOpenings((n) => n + 1)}>
      <summary className="home-fold__summary">
        <span>{label}</span>
        <ChevronDown className="home-fold__chevron" size={16} aria-hidden />
      </summary>
      <div className="home-fold__body">
        <Openings.Provider value={openings}>{children}</Openings.Provider>
      </div>
    </details>
  );
}

export interface FoldRowProps {
  /** The words the row opens with. */
  children: ReactNode;
  /** What they are about. */
  side: ReactNode;
  /** The words that follow `side`, where the two columns are one. */
  after?: ReactNode;
  /** Sets the words at the middle of the height of `side`: for a few words beside a tall drawing. */
  middle?: boolean;
}

/** A row of a fold: the words, and beside them what they are about, so that a wide screen has no empty half. Where the two columns
 * do not fit it is one column in the order of the markup. */
export function FoldRow({ children, side, after, middle = false }: FoldRowProps) {
  return (
    <div className={middle ? "home-fold__row home-fold__row--middle" : "home-fold__row"}>
      <div className="home-fold__words">{children}</div>
      <div className="home-fold__side">{side}</div>
      {after && <div className="home-fold__words">{after}</div>}
    </div>
  );
}
