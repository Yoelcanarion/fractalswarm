import { Sparkles } from "lucide-react";

import { callIndex } from "../../lib/lens";
import { useLens, useLensStoreApi } from "../../lensStore";

/** A small button for a row of the event log: opens the LLM call the row is about in the Muse lens.
 * It draws nothing for an event that is not about a call the lens knows. */
export function LensButton({ effectId }: { effectId: unknown }) {
  const lens = useLensStoreApi();
  const calls = useLens((s) => s.calls);
  if (typeof effectId !== "string" || !callIndex(calls).has(effectId)) return null;
  return (
    <button
      type="button"
      className="lens-button"
      aria-label="Open this call in the Muse lens"
      title="Open in the Muse lens"
      onClick={(event) => {
        event.stopPropagation();
        lens.getState().openCall(effectId);
      }}
    >
      <Sparkles size={14} aria-hidden />
    </button>
  );
}
