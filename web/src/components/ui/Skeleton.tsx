import type { CSSProperties, ReactNode } from "react";

export interface SkeletonProps {
  /** CSS size of the block: a number is px. Default: the full width, one line high. */
  width?: number | string;
  height?: number | string;
  /** Round it: an avatar, a ring. */
  circle?: boolean;
  className?: string;
}

/** A placeholder for content that has not arrived: a quiet block with a slow shimmer (none under
 * reduced motion). Wrap a group of them in ``SkeletonGroup`` so a screen reader hears one message. */
export function Skeleton({ width, height, circle = false, className = "" }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  return <span className={`skeleton ${circle ? "skeleton--circle" : ""} ${className}`} style={style} aria-hidden />;
}

/** ``lines`` lines of text, the last one shorter. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="skeleton-text" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? "60%" : "100%"} height={12} />
      ))}
    </span>
  );
}

/** Announces "Loading ..." once and marks its contents busy. `skeleton-group--stack` spaces the blocks inside it. */
export function SkeletonGroup({ label = "Loading", className = "", children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={["skeleton-group", className].filter(Boolean).join(" ")} role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}
