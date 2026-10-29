import { ChaosPanel } from "../components/ChaosPanel";
import { Counters } from "../components/Counters";
import { EventFeed } from "../components/EventFeed";
import { ScheduleGrid, ViolationsBadge } from "../components/ScheduleGrid";
import { Timeline } from "../components/Timeline";
import { TreeGraph } from "../components/TreeGraph";
import { Card, Skeleton, SkeletonGroup, SkeletonText } from "../components/ui";
import { useRunStore, useRunStoreShallow } from "../store";

/** The shape of the run page while its log loads: counters, tree, grid, side column, timeline. */
function RunSkeleton({ runId }: { runId: string }) {
  return (
    <SkeletonGroup label={`Loading ${runId}`}>
      <div className="run">
        <div className="counters">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} width={i === 0 ? 190 : 118} height={64} />
          ))}
        </div>
        <div className="run__main run__main--split">
          <Card flush className="run__tree">
            <Skeleton height="100%" />
          </Card>
          <Card className="run__grid">
            <SkeletonText lines={8} />
          </Card>
          <aside className="run__side">
            <Card>
              <SkeletonText lines={4} />
            </Card>
            <Card>
              <SkeletonText lines={6} />
            </Card>
          </aside>
        </div>
        <Skeleton height={56} />
      </div>
    </SkeletonGroup>
  );
}

export function RunPage() {
  const { runId, events, cursor, loading, loadError } = useRunStoreShallow((s) => ({
    runId: s.runId,
    events: s.events,
    cursor: s.cursor,
    loading: s.loading,
    loadError: s.loadError,
  }));
  const view = useRunStore((s) => s.view);
  if (!runId) return <div className="empty">No run selected. Record one with <code>fractalswarm toy</code> or open the demo bundle.</div>;
  if (loading) return <RunSkeleton runId={runId} />;
  if (loadError) return <div className="empty empty--bad">Could not load {runId}: {loadError}</div>;

  const hasSchedule = view.schedule.rooms.length > 0;
  return (
    <div className="run">
      <Counters view={view} />
      <div className={`run__main ${hasSchedule ? "run__main--split" : ""}`}>
        <section className="panel run__tree">
          <header className="panel__title">
            Orchestrator tree
            <span className="panel__hint">ownership colours · ✕ killed · animated edges = messages</span>
          </header>
          <div className="run__canvas">
            <TreeGraph view={view} />
          </div>
        </section>
        <section className="panel run__grid">
          <header className="panel__title">
            T2 schedule
            <ViolationsBadge view={view} />
          </header>
          <ScheduleGrid view={view} />
        </section>
        <aside className="run__side">
          <ChaosPanel runId={runId} view={view} />
          <EventFeed events={events} cursor={cursor} />
        </aside>
      </div>
      <Timeline />
    </div>
  );
}
