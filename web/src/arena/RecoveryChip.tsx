import { useEffect, useMemo, useState } from "react";

import { foldEvents } from "../lib/reducer";
import { useRunStore } from "../store";
import { fetchRecovery } from "./api";
import { recoveryChipOf, type RecoveryChipText, type ServerRecovery } from "./recovery";

const TONES = { good: "badge--good badge--big", bad: "badge--bad badge--big", warn: "badge--warn badge--big", muted: "badge--muted" } as const;

/** The chip as drawn: what it says, or "checking" while the server has not answered. */
export function RecoveryBadge({ chip }: { chip: RecoveryChipText | "checking" }) {
  if (chip === "checking") return <span className="badge badge--muted">Checking recovery…</span>;
  return (
    <span className={`badge ${TONES[chip.tone]}`} title={chip.detail}>
      {chip.text}
    </span>
  );
}

/** The supervisor's counterpart of "Takeover OK": "Recovery OK ✓" once the server has read the finished log
 * against the rules a supervisor that keeps its workers must hold to. On a server that has no such check it
 * says what the log itself shows, and says that is the log's own count. Nothing while the run is recording. */
export function RecoveryChip() {
  const runId = useRunStore((s) => s.runId);
  const events = useRunStore((s) => s.events);
  const live = useRunStore((s) => s.live);
  const loading = useRunStore((s) => s.loading);
  const finished = !live && !loading && runId !== null && events.length > 0;

  // The report for a run: undefined while asking, null when the server has none.
  const [answer, setAnswer] = useState<{ runId: string; report: ServerRecovery | null }>();
  useEffect(() => {
    if (!finished || runId === null) return;
    let current = true;
    fetchRecovery(runId)
      .catch(() => null)
      .then((report) => current && setAnswer({ runId, report }));
    return () => {
      current = false;
    };
  }, [finished, runId]);

  const asked = answer !== undefined && answer.runId === runId ? answer.report : undefined;
  const chip = useMemo(() => (finished ? recoveryChipOf(asked, foldEvents(events)) : null), [finished, asked, events]);
  return chip === null ? null : <RecoveryBadge chip={chip} />;
}
