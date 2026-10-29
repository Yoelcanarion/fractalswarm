import { statusBadge } from "../../lib/controls";

/** A run's status as the catalog reports it: live, replay, halted or interrupted. The hint is the
 * longer explanation, on hover. */
export function StatusBadge({ status }: { status: string | null }) {
  const { label, tone, hint } = statusBadge(status);
  return (
    <span className={`badge badge--${tone}`} title={hint || undefined}>
      {label}
    </span>
  );
}
