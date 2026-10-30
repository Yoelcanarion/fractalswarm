import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** The page's one h1: what this page is, in a few words. */
  title: ReactNode;
  /** One sentence on what the page is for. */
  lead?: ReactNode;
  /** Controls at the right of the title. */
  actions?: ReactNode;
  /** One line: the title and the sentence side by side. For a page that needs every pixel of height (a run's views). */
  compact?: boolean;
  className?: string;
}

/** The head every page starts with, so no two pages open differently. */
export function PageHeader({ title, lead, actions, compact = false, className = "" }: PageHeaderProps) {
  return (
    <header className={["pagehead", compact ? "pagehead--compact" : "", className].filter(Boolean).join(" ")}>
      <div className="pagehead__text">
        <h1 className="pagehead__title">{title}</h1>
        {lead && <p className="pagehead__lead">{lead}</p>}
      </div>
      {actions && <div className="pagehead__actions">{actions}</div>}
    </header>
  );
}
