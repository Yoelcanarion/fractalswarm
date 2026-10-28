import type { ReactNode } from "react";

import type { GenericEntry } from "../lib/generic";

export const money = (value: number, digits = 4): string => `$${value.toFixed(digits)}`;
export const virtualSeconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
export const percent = (share: number): string => `${Math.round(share * 100)}%`;

type Tone = "good" | "bad" | "warn" | "";

export function PStat({ label, value, tone = "", title }: { label: string; value: ReactNode; tone?: Tone; title?: string }) {
  return (
    <div className={`pstat ${tone ? `pstat--${tone}` : ""}`} title={title}>
      <div className="pstat__value">{value}</div>
      <div className="pstat__label">{label}</div>
    </div>
  );
}

/** A horizontal bar: ``share`` of the track is filled, 0..1. */
export function Meter({ share, label, detail, tone = "" }: { share: number | null; label: string; detail?: string; tone?: Tone }) {
  return (
    <div className="meter">
      <div className="meter__head">
        <span>{label}</span>
        <span className="muted mono">{detail ?? (share === null ? "not reported" : percent(share))}</span>
      </div>
      <div className="meter__track">
        <i className={`meter__fill ${tone ? `meter__fill--${tone}` : ""}`} style={{ width: `${Math.max(0, Math.min(share ?? 0, 1)) * 100}%` }} />
      </div>
    </div>
  );
}

export function Pill({ tone = "", children, title }: { tone?: Tone | "muted"; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ? `badge--${tone}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function Subhead({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="subhead">
      {children}
      {hint !== undefined && <span className="muted">{hint}</span>}
    </div>
  );
}

export function Nothing({ children }: { children: ReactNode }) {
  return <div className="nothing">{children}</div>;
}

/** Events of a family this panel has no fields for yet: the type and a digest of the payload. */
export function GenericRows({ rows, title = "Events this panel does not read yet" }: { rows: GenericEntry[]; title?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="generic">
      <Subhead hint={`${rows.length} newest`}>{title}</Subhead>
      <ol className="generic__list">
        {rows.slice(-8).reverse().map((row) => (
          <li key={row.seq}>
            <span className="mono muted">{row.seq}</span> <b>{row.type}</b> <span className="muted">{row.actor}</span>
            <div className="generic__text mono">{row.text}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One card of the panels page. */
export function Card({
  title,
  hint,
  wide,
  children,
}: {
  title: string;
  hint?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`panel pcard ${wide ? "pcard--wide" : ""}`}>
      <header className="panel__title">
        {title}
        {hint !== undefined && <span className="panel__hint">{hint}</span>}
      </header>
      <div className="pcard__body">{children}</div>
    </section>
  );
}
