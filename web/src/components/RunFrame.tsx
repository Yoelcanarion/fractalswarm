import type { ReactNode } from "react";

import { openingRun, useAddressedRun } from "../lib/address";
import { useRunStore, useRunStoreShallow } from "../store";
import { LensDock } from "./lens/LensDock";
import { Timeline } from "./Timeline";
import { EmptyState, PageHeader, Skeleton, SkeletonGroup } from "./ui";

/** The shape of a run view while its log loads: a title, the body, the timeline. The page keeps its size when the run arrives. */
function FrameSkeleton({ label }: { label: string }) {
  return (
    <SkeletonGroup label={label}>
      <div className="run">
        <Skeleton width={260} height={28} />
        <Skeleton className="run__sk-body" />
        <Skeleton height={56} />
      </div>
    </SkeletonGroup>
  );
}

export interface RunGateProps {
  /** What to show while the log loads, if not the plain frame. It is given what the wait is for: "Loading <run>". */
  skeleton?: (label: string) => ReactNode;
  children: ReactNode;
}

/** What every view of a run shows before it has a run to show: none chosen, still loading, or failed. None of them is a dead
 * end: each says what happened and offers the next step. */
export function RunGate({ skeleton, children }: RunGateProps) {
  const { runId, loading, loadError, runs, runsLoaded } = useRunStoreShallow((s) => ({
    runId: s.runId,
    loading: s.loading,
    loadError: s.loadError,
    runs: s.runs,
    runsLoaded: s.runsLoaded,
  }));
  const named = useAddressedRun();
  const openRun = useRunStore((s) => s.openRun);
  const opening = openingRun({ runId, named, runs, runsLoaded });
  const waiting = (label: string) => <>{skeleton ? skeleton(label) : <FrameSkeleton label={label} />}</>;
  // The store opens the run after the first paint: until then this is not "no run", and not the run that was open before.
  if (opening) return waiting(opening.kind === "run" ? `Loading ${opening.id}` : "Loading the runs");
  if (!runId) {
    return (
      <EmptyState
        title="No run selected"
        actions={
          <a className="btn btn--on" href="#/runs">
            Open the runs
          </a>
        }
      >
        Choose a run from the list to replay it, or record one from the command line with <code>fractalswarm run</code>.
      </EmptyState>
    );
  }
  if (loading) return waiting(`Loading ${runId}`);
  if (loadError) {
    return (
      <EmptyState
        tone="bad"
        title={`Could not load ${runId}`}
        actions={
          <>
            <button type="button" className="btn btn--on" onClick={() => void openRun(runId)}>
              Try again
            </button>
            <a className="btn" href="#/runs">
              Open the runs
            </a>
          </>
        }
      >
        {loadError}
      </EmptyState>
    );
  }
  return <>{children}</>;
}

export interface RunFrameProps {
  /** The view's name: Results, Plan, Panels, Security, Events. */
  title: string;
  /** One sentence on what the view is for. */
  lead: ReactNode;
  children: ReactNode;
}

/** What every view of a run shares: the title and its purpose, the states before there is a run, and the replay scrubber at the
 * bottom, so the same view serves a live run and any moment of a replay. */
export function RunFrame({ title, lead, children }: RunFrameProps) {
  return (
    <RunGate>
      <div className="run">
        <PageHeader compact title={title} lead={lead} />
        {children}
        <LensDock />
        <Timeline />
      </div>
    </RunGate>
  );
}
