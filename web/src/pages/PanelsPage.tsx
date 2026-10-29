import { BreakersPanel } from "../components/BreakersPanel";
import { CollisionsPanel } from "../components/CollisionsPanel";
import { EscalationsPanel } from "../components/EscalationsPanel";
import { LimitsPanel } from "../components/LimitsPanel";
import { MarketPanel } from "../components/MarketPanel";
import { MemoryPanel } from "../components/MemoryPanel";
import { RunControls } from "../components/RunControls";
import { RunFrame } from "../components/RunFrame";
import { useRunStore, useRunStoreShallow } from "../store";

/** The supporting panels (spec §16, Day 9): each is a projection of the events up to the playhead. */
export function PanelsPage() {
  const { runId, live } = useRunStoreShallow((s) => ({ runId: s.runId, live: s.live }));
  const view = useRunStore((s) => s.view);
  return (
    <RunFrame>
      <RunControls runId={runId!} view={view} live={live} />
      <div className="pgrid">
        <MarketPanel view={view} />
        <LimitsPanel view={view} />
        <BreakersPanel view={view} />
        <MemoryPanel view={view} />
        <CollisionsPanel view={view} />
        <EscalationsPanel view={view} />
      </div>
    </RunFrame>
  );
}
