import { useEffect, useMemo } from "react";

import { describeTakeover, logHasTakeover } from "../lib/takeover";
import { useRunStore } from "../store";

/** "Takeover OK ✓" once the server has re-derived every heir from the log and found none different
 * from the one the run used. It sits next to the replay badge: that one proves the run replays, this
 * one proves who took over was not arbitrary. It says "No takeover to check" for a run in which no
 * goal changed hands, shows nothing on a server that does not offer the check, and nothing while a
 * run is still recording (the check needs the finished log). */
export function TakeoverChip() {
  const takeover = useRunStore((s) => s.takeover);
  const runId = useRunStore((s) => s.runId);
  const live = useRunStore((s) => s.live);
  const loading = useRunStore((s) => s.loading);
  const events = useRunStore((s) => s.events);
  const runTakeover = useRunStore((s) => s.runTakeover);

  const idle = takeover.state === "idle";
  useEffect(() => {
    if (idle && runId && !live && !loading) void runTakeover();
  }, [idle, runId, live, loading, runTakeover]);

  // What the log itself holds: decides the claim when the server's report does not count.
  const inLog = useMemo(() => !live && logHasTakeover(events), [live, events]);

  if (!runId || live || takeover.state === "absent") return null;
  switch (takeover.state) {
    case "idle":
    case "pending":
      return <span className="badge badge--muted">Checking takeover…</span>;
    case "error":
      return (
        <span className="badge badge--muted" title={takeover.error}>
          Takeover check unavailable
        </span>
      );
    case "done": {
      const chip = describeTakeover(takeover.report, inLog);
      const tone = chip.tone === "good" ? "badge--good badge--big" : chip.tone === "bad" ? "badge--bad badge--big" : "badge--muted";
      return (
        <span className={`badge ${tone}`} title={chip.detail}>
          {chip.text}
        </span>
      );
    }
  }
}
