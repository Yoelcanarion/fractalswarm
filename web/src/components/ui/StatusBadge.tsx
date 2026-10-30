import { statusBadge } from "../../lib/controls";
import { Hint } from "./Hint";

/** A run's status as the catalog reports it: live, replay, halted or interrupted. The hint is the
 * longer explanation, on hover. */
export function StatusBadge({ status }: { status: string | null }) {
  const { label, tone, hint } = statusBadge(status);
  return (
    <Hint label={hint}>
      <span className={`badge badge--${tone}`}>{label}</span>
    </Hint>
  );
}
