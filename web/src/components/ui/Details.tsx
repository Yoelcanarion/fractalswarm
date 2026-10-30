import { useEffect, useRef, useState, type ReactNode } from "react";

import { opensDetails } from "../../lib/details";

export interface DetailsProps {
  /** What is inside, as the closed fold says it: "Details" unless a few words say more ("All 22 runs, with filters"). */
  summary?: ReactNode;
  /** Quieter words after the summary ("3 more"). */
  hint?: ReactNode;
  /** Lets the address open it (`?details=<id>`) and gives a part of a page a name the director can point at. */
  id?: string;
  /** Open from the start, or opened by the page when the thing inside is wanted (a prop, like the address). */
  open?: boolean;
  /** Without the bar around it: for a fold inside a card. */
  inline?: boolean;
  /** A short list that floats under its summary instead of pushing the page down: for the bars. It closes on Escape, on a click
   * elsewhere and when the address changes. */
  menu?: boolean;
  className?: string;
  children: ReactNode;
}

/** The one fold of the app: what a page shows at first is the essentials and one main action, and everything else sits in one of
 * these, one click away. A native `details`, so it works from the keyboard and is announced as a fold. It opens when `open` says so or
 * when the address asks for its id, and stays as the person left it. */
export function Details({ summary = "Details", hint, id, open = false, inline = false, menu = false, className = "", children }: DetailsProps) {
  const [isOpen, setOpen] = useState(() => open || (typeof window !== "undefined" && opensDetails(window.location.hash, id)));
  const root = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (open) setOpen(true);
  }, [open]);

  // an address that arrives later (the director's, a link on the same page) opens it too; a menu closes, as the page it led to opens
  useEffect(() => {
    const onHash = () => {
      if (opensDetails(window.location.hash, id)) setOpen(true);
      else if (menu) setOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [id, menu]);

  useEffect(() => {
    if (!menu || !isOpen) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, [menu, isOpen]);

  return (
    <details
      ref={root}
      id={id}
      className={["disclosure", inline ? "disclosure--inline" : "", menu ? "disclosure--menu" : "", className].filter(Boolean).join(" ")}
      open={isOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (menu && event.key === "Escape" && isOpen) {
          setOpen(false);
          root.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="disclosure__summary">
        <span className="disclosure__label">{summary}</span>
        {hint && <span className="disclosure__hint">{hint}</span>}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
