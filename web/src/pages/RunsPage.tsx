import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LiveNow } from "../components/catalogue/LiveNow";
import "../components/catalogue/catalogue.css";
import { RunsKey } from "../components/catalogue/RunsKey";
import { RunsTable, type Sort } from "../components/catalogue/RunsTable";
import { RunsToolbar } from "../components/catalogue/RunsToolbar";
import { NewTaskForm } from "../components/NewTaskForm";
import { EmptyState, PageHeader, Skeleton, SkeletonGroup, Term } from "../components/ui";
import { fetchEventAt, verifyRun } from "../lib/api";
import {
  filterRows,
  NO_FILTER,
  rowOf,
  sortRows,
  STATE_ORDER,
  summarize,
  workflowsIn,
  type Filter,
  type RunFacts,
  type SortKey,
  type VerifyView,
} from "../lib/catalogue";
import { createFactsLoader } from "../lib/factsLoader";
import { prefersReducedMotion } from "../lib/motion";
import { useDocumentTitle } from "../lib/title";
import { useRunStore, useRunStoreShallow } from "../store";

// One loader for as long as the app is open: a finished run is read once, however often the page is visited.
const loader = createFactsLoader(fetchEventAt);

// While a run is live the list is asked again, so it moves from "live" to "recorded" without a reload.
const LIVE_POLL_MS = 5000;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function RunsSkeleton() {
  return (
    <div className="runs">
      <SkeletonGroup label="Loading the runs">
        <Skeleton width={160} height={26} />
        <div className="runs__sk-gap" />
        <Skeleton height={44} />
        <div className="runs__sk-gap" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={52} className="runs__sk-row" />
        ))}
      </SkeletonGroup>
    </div>
  );
}

export function RunsPage() {
  useDocumentTitle("Runs");
  const { runs, runsError, runsLoaded } = useRunStoreShallow((s) => ({ runs: s.runs, runsError: s.runsError, runsLoaded: s.runsLoaded }));
  const loadRuns = useRunStore((s) => s.loadRuns);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [sort, setSort] = useState<Sort>({ key: "listed", dir: "asc" });
  const [facts, setFacts] = useState<Record<string, RunFacts>>({});
  const [verify, setVerify] = useState<Record<string, VerifyView>>({});
  const [verifying, setVerifying] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const startRef = useRef<HTMLDetailsElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => void loadRuns(), [loadRuns]);
  useEffect(refresh, [refresh]);

  const anyLive = runs.some((run) => run.status === "running");
  useEffect(() => {
    if (!anyLive) return;
    const handle = window.setInterval(() => void loadRuns(), LIVE_POLL_MS);
    return () => window.clearInterval(handle);
  }, [anyLive, loadRuns]);

  // The facts that live in each log, read a few runs at a time as they appear.
  useEffect(() => {
    let current = true;
    for (const listing of runs) {
      loader.load(listing).then(
        (found) => current && setFacts((known) => (known[listing.id] === found ? known : { ...known, [listing.id]: found })),
        () => undefined, // a run whose log cannot be read keeps its name and size
      );
    }
    return () => {
      current = false;
    };
  }, [runs]);

  const rows = useMemo(() => runs.map((listing, index) => rowOf(listing, facts[listing.id] ?? null, index)), [runs, facts]);
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const liveRows = shown.filter((row) => row.state === "live");
  const tableRows = useMemo(() => sortRows(shown.filter((row) => row.state !== "live"), sort.key, sort.dir), [shown, sort]);
  const states = STATE_ORDER.filter((state) => rows.some((row) => row.state === state));
  const filtered = filter.query !== "" || filter.state !== "all" || filter.workflow !== "all";

  const onSort = useCallback(
    (key: SortKey) => setSort((now) => (now.key === key ? { key, dir: now.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })),
    [],
  );

  const verifyOne = useCallback(async (id: string) => {
    setVerify((now) => ({ ...now, [id]: { state: "pending" } }));
    try {
      const report = await verifyRun(id);
      if (mounted.current) setVerify((now) => ({ ...now, [id]: { state: "done", report } }));
    } catch (error) {
      if (mounted.current) setVerify((now) => ({ ...now, [id]: { state: "error", error: messageOf(error) } }));
    }
  }, []);

  // Not yet checked: a run that is recorded, halted or interrupted and has no verdict, or whose last try failed.
  const unchecked = tableRows.filter((row) => row.state !== "empty" && ["idle", "error"].includes(verify[row.listing.id]?.state ?? "idle"));
  const verifyAll = useCallback(async () => {
    setVerifying(true);
    for (const row of unchecked) {
      if (!mounted.current) return;
      await verifyOne(row.listing.id); // one at a time: each replay runs the whole run
    }
    if (mounted.current) setVerifying(false);
  }, [unchecked, verifyOne]);

  const openStart = () => {
    setStartOpen(true);
    startRef.current?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  if (!runsLoaded) return <RunsSkeleton />;
  const failed = runsError !== null;
  const clear = () => setFilter(NO_FILTER);

  return (
    <div className="runs">
      <PageHeader
        title="Runs"
        lead={
          <>
            Every run this server holds. A recorded run replays from its log and has a <Term id="replay">replay check</Term>; a live run streams while it is written.
          </>
        }
        actions={
          <button type="button" className="btn btn--on" onClick={openStart}>
            Start a run
          </button>
        }
      />

      {failed && runs.length === 0 ? (
        <EmptyState
          tone="bad"
          title="Could not load the runs"
          actions={
            <button type="button" className="btn" onClick={refresh}>
              Try again
            </button>
          }
        >
          {runsError}
        </EmptyState>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          actions={
            <button type="button" className="btn btn--on" onClick={openStart}>
              Start a run
            </button>
          }
        >
          Nothing has been recorded on this server. Start a run below, or record one from the command line with <code>fractalswarm run</code>.
        </EmptyState>
      ) : (
        <>
          {failed && (
            <p className="runs__error" role="alert">
              Could not refresh the list: {runsError}{" "}
              <button type="button" className="btn btn--seg" onClick={refresh}>
                Try again
              </button>
            </p>
          )}
          <RunsToolbar
            filter={filter}
            onFilter={setFilter}
            states={states}
            workflows={workflowsIn(rows)}
            summary={filtered ? `${shown.length} of ${rows.length} runs shown` : summarize(rows)}
            onRefresh={refresh}
            sorted={sort.key !== "listed"}
            onResetSort={() => setSort({ key: "listed", dir: "asc" })}
            onVerifyAll={() => void verifyAll()}
            verifiable={unchecked.length}
            verifying={verifying}
          />
          <LiveNow rows={liveRows} />
          {tableRows.length > 0 ? (
            <>
              <RunsTable rows={tableRows} sort={sort} onSort={onSort} verify={verify} onVerify={(id) => void verifyOne(id)} />
              <RunsKey />
            </>
          ) : (
            liveRows.length === 0 && (
              <EmptyState
                title="No run matches"
                actions={
                  <button type="button" className="btn" onClick={clear}>
                    Clear the filter
                  </button>
                }
              >
                Nothing listed has all of these words, in this state, from this workflow.
              </EmptyState>
            )
          )}
        </>
      )}

      <details
        ref={startRef}
        className="panel runs__start"
        open={startOpen}
        onToggle={(event) => setStartOpen(event.currentTarget.open)}
      >
        <summary>
          Start a run <span className="muted">on the fake model, so it costs nothing</span>
        </summary>
        <NewTaskForm />
      </details>
    </div>
  );
}
