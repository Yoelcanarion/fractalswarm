import { useMemo } from "react";

import { foldEvents } from "../lib/reducer";
import { useRunStore } from "../store";
import { describeRecovery, recoveryOf } from "./recovery";

/** The supervisor's counterpart of "Takeover OK": what its restarts did, counted from the run's log
 * once the run has finished. The label says it is the log's count, not a scored verdict. */
export function RecoveryChip() {
  const events = useRunStore((s) => s.events);
  const live = useRunStore((s) => s.live);
  const loading = useRunStore((s) => s.loading);
  const chip = useMemo(() => (live || loading || events.length === 0 ? null : describeRecovery(recoveryOf(foldEvents(events)))), [events, live, loading]);
  if (chip === null) return null;
  const tone = chip.tone === "good" ? "badge--good badge--big" : chip.tone === "warn" ? "badge--warn badge--big" : "badge--muted";
  return (
    <span className={`badge ${tone}`} title={chip.detail}>
      {chip.text}
    </span>
  );
}
