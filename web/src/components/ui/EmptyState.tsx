import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** What is missing, or what went wrong, in a few words. */
  title: ReactNode;
  /** Why, and what it means. */
  children?: ReactNode;
  /** The way out: links or buttons ("Open the recorded run", "Try again"). A state with no way out is a dead end. */
  actions?: ReactNode;
  /** "bad" is an error and is announced at once; the others are announced politely. */
  tone?: "neutral" | "warn" | "bad";
  className?: string;
}

/** Nothing to show yet, nothing found, or something failed. Always says what and offers a next step. */
export function EmptyState({ title, children, actions, tone = "neutral", className = "" }: EmptyStateProps) {
  return (
    <div
      className={["emptystate", `emptystate--${tone}`, className].filter(Boolean).join(" ")}
      role={tone === "bad" ? "alert" : "status"}
    >
      <div className="emptystate__title">{title}</div>
      {children && <p className="emptystate__body">{children}</p>}
      {actions && <div className="emptystate__actions">{actions}</div>}
    </div>
  );
}
