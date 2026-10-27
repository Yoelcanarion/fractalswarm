import { ChaosPanel } from "../components/ChaosPanel";
import { Counters } from "../components/Counters";
import { EventFeed } from "../components/EventFeed";
import { ScheduleGrid, ViolationsBadge } from "../components/ScheduleGrid";
import { Timeline } from "../components/Timeline";
import { TreeGraph } from "../components/TreeGraph";
import { useRun } from "../store";

export function RunPage() {
  const { runId, view, events, cursor, loading, loadError, live } = useRun();
  if (!runId) return <div className="empty">No run selected. Record one with <code>fractalswarm toy</code> or open the demo bundle.</div>;
  if (loading) return <div className="empty">Loading {runId}…</div>;
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
          <ChaosPanel runId={runId} view={view} live={live} />
          <EventFeed events={events} cursor={cursor} />
        </aside>
      </div>
      <Timeline />
    </div>
  );
}
