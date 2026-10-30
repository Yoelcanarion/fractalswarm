import { ChaosPanel } from "../components/ChaosPanel";
import { Counters } from "../components/Counters";
import { EventFeed } from "../components/EventFeed";
import { ScheduleGrid, ViolationsBadge } from "../components/ScheduleGrid";
import { LensDock } from "../components/lens/LensDock";
import { RunGate } from "../components/RunFrame";
import { Timeline } from "../components/Timeline";
import { TreeGraph } from "../components/TreeGraph";
import { Card, PageHeader, Skeleton, SkeletonGroup, SkeletonText, Term } from "../components/ui";
import { useRunStore, useRunStoreApi, useRunStoreShallow } from "../store";

/** The shape of the run page while its log loads: counters, tree, grid, side column, timeline. */
function RunSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>
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
  return (
    <RunGate skeleton={(label) => <RunSkeleton label={label} />}>
      <RunOverview />
    </RunGate>
  );
}

function RunOverview() {
  const { runId, events, cursor, live } = useRunStoreShallow((s) => ({ runId: s.runId, events: s.events, cursor: s.cursor, live: s.live }));
  const view = useRunStore((s) => s.view);
  const store = useRunStoreApi();
  const playFromStart = () => {
    const { seek, setPlaying } = store.getState();
    seek(0);
    setPlaying(true);
  };

  const hasSchedule = view.schedule.rooms.length > 0;
  return (
    <div className="run">
      <PageHeader
        compact
        title="Run"
        lead={
          live
            ? "A live run, playing as it is written. Kill half the brains and watch the rest take over."
            : "A recorded run, shown at its end. Play it from the start to watch the coordinators that were killed and the ones that took over."
        }
        actions={
          live ? undefined : (
            <button type="button" className="btn btn--on" onClick={playFromStart}>
              Play from the start
            </button>
          )
        }
      />
      <div className="run__top">
        <Counters view={view} />
      </div>
      <div className={`run__main ${hasSchedule ? "run__main--split" : ""}`}>
        <section className="panel run__tree">
          <header className="panel__title">
            Orchestrator tree
            <span className="panel__hint">colour = track · ✕ killed · moving line = message</span>
          </header>
          <div className="run__canvas">
            <TreeGraph view={view} />
          </div>
        </section>
        <section className="panel run__grid">
          <header className="panel__title">
            <span>
              <Term id="t2">T2</Term> schedule
            </span>
            <ViolationsBadge view={view} />
          </header>
          <ScheduleGrid view={view} />
        </section>
        <aside className="run__side">
          <ChaosPanel runId={runId!} view={view} />
          <EventFeed events={events} cursor={cursor} />
        </aside>
      </div>
      <LensDock />
      <Timeline />
    </div>
  );
}
