import { ChaosPanel } from "../components/ChaosPanel";
import { Counters } from "../components/Counters";
import { EventFeed } from "../components/EventFeed";
import { RunState } from "../components/RunState";
import { ScheduleGrid, ViolationsBadge } from "../components/ScheduleGrid";
import { LensDock } from "../components/lens/LensDock";
import { RunGate } from "../components/RunFrame";
import { Timeline } from "../components/Timeline";
import { TreeGraph } from "../components/TreeGraph";
import { Card, Details, PageHeader, Skeleton, SkeletonGroup, Term } from "../components/ui";
import { useRunStore, useRunStoreApi, useRunStoreShallow } from "../store";

/** The shape of the run page while its log loads: its head, the line that says what state the run is in, the tree, the fold, the replay bar. */
function RunSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>
      <div className="run run--overview">
        <Skeleton width={260} height={28} />
        <div className="runstate">
          <Skeleton width={420} height={30} />
          <div className="counters counters--headline">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} width={i === 0 ? 190 : 118} height={64} />
            ))}
          </div>
        </div>
        <Card flush className="run__tree">
          <Skeleton height="100%" />
        </Card>
        <Skeleton height={40} />
        <Skeleton height={56} />
      </div>
    </SkeletonGroup>
  );
}

export interface RunPageProps {
  /** Every fold of the page open, as a still of the whole page needs it (the director's stage). The address can open them one by one:
   * `?details=more`. */
  unfold?: boolean;
}

export function RunPage({ unfold = false }: RunPageProps) {
  return (
    <RunGate skeleton={(label) => <RunSkeleton label={label} />}>
      <RunOverview unfold={unfold} />
    </RunGate>
  );
}

/** The one main action of a recorded run, which says what it will do now: play it from its start, pause it while it plays, carry on
 * from where it was stopped. A live run is played by the run itself. */
function PlayAction() {
  const { live, playing, cursor, total } = useRunStoreShallow((s) => ({ live: s.live, playing: s.playing, cursor: s.cursor, total: s.events.length }));
  const store = useRunStoreApi();
  if (live) return null;
  const midway = cursor > 0 && cursor < total;
  const onClick = () => {
    const { seek, setPlaying } = store.getState();
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!midway) seek(0);
    setPlaying(true);
  };
  return (
    <button type="button" className="btn btn--on" onClick={onClick}>
      {playing ? "Pause" : midway ? "Carry on" : "Play from the start"}
    </button>
  );
}

function RunOverview({ unfold }: { unfold: boolean }) {
  const { runId, events, cursor, live } = useRunStoreShallow((s) => ({ runId: s.runId, events: s.events, cursor: s.cursor, live: s.live }));
  const view = useRunStore((s) => s.view);

  const hasSchedule = view.schedule.rooms.length > 0;
  return (
    <div className="run run--overview">
      <PageHeader
        compact
        title="Run"
        lead={
          live
            ? "A live run, playing as it is written. Kill half the brains and watch the rest take over."
            : "A recorded run. Play it to watch coordinators get killed and the survivors take over."
        }
        actions={<PlayAction />}
      />
      <RunState view={view} />
      <section className="panel run__tree" aria-label="Orchestrator tree">
        <div className="run__canvas">
          <TreeGraph view={view} />
        </div>
      </section>
      <Details id="more" className="run__more" summary="Details" hint="every counter, the schedule, the chaos list and the event log" open={unfold}>
        <Counters view={view} />
        <div className={`run__main ${hasSchedule ? "run__main--split" : ""}`}>
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
      </Details>
      <LensDock />
      <Timeline />
    </div>
  );
}
