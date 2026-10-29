import type { ReactNode } from "react";

export interface CardProps {
  /** The heading: small, upper-case. */
  title?: ReactNode;
  /** Quiet text beside the title. */
  hint?: ReactNode;
  /** Controls at the right of the header. */
  actions?: ReactNode;
  /** Tints the border and background: a verdict ("good"), a problem ("bad") or a caution. */
  tone?: "neutral" | "good" | "bad" | "warn";
  /** No padding: the body brings its own (a table that runs edge to edge, a canvas). */
  flush?: boolean;
  /** Reacts to hover and focus, for a card that is itself clickable (put the link or button inside). */
  interactive?: boolean;
  /** The element. Default "section". */
  as?: "section" | "div" | "article" | "aside";
  className?: string;
  children?: ReactNode;
}

/** The surface every panel sits on: border, radius, an optional header. */
export function Card({ title, hint, actions, tone = "neutral", flush = false, interactive = false, as: Element = "section", className = "", children }: CardProps) {
  const classes = ["panel", "card", `card--${tone}`, flush ? "card--flush" : "", interactive ? "card--interactive" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <Element className={classes}>
      {(title || hint || actions) && (
        <header className="panel__title">
          <span className="card__heading">
            {title}
            {hint && <span className="panel__hint">{hint}</span>}
          </span>
          {actions && <span className="card__actions">{actions}</span>}
        </header>
      )}
      {children}
    </Element>
  );
}
