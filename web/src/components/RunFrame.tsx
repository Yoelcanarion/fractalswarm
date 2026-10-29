import type { ReactNode } from "react";

import { useRunStoreShallow } from "../store";
import { Timeline } from "./Timeline";

/** What every view of a run shares: the empty and error states, and the replay scrubber at the
 * bottom, so the same view serves a live run and any moment of a replay. */
export function RunFrame({ children }: { children: ReactNode }) {
  const { runId, loading, loadError } = useRunStoreShallow((s) => ({ runId: s.runId, loading: s.loading, loadError: s.loadError }));
  if (!runId) return <div className="empty">No run selected. Record one with <code>fractalswarm run</code> or open the demo bundle.</div>;
  if (loading) return <div className="empty">Loading {runId}…</div>;
  if (loadError) return <div className="empty empty--bad">Could not load {runId}: {loadError}</div>;
  return (
    <div className="run">
      {children}
      <Timeline />
    </div>
  );
}
