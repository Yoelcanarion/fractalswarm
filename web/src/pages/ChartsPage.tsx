import { useCallback, useEffect, useMemo, useState } from "react";

import "../components/charts/charts.css";
import { seriesColors } from "../components/charts/colors";
import { MetricChart } from "../components/charts/MetricChart";
import { ResultsTable } from "../components/charts/ResultsTable";
import { SeriesKey } from "../components/charts/SeriesKey";
import { SetCaption, SetPicker } from "../components/charts/SetHeader";
import { Card, Details, EmptyState, PageHeader, Skeleton, SkeletonGroup } from "../components/ui";
import { benchResults, listRuns } from "../lib/api";
import { heroSets, runCount, type HeroSet } from "../lib/hero";
import { drawsInProcess, IN_PROCESS_REASON, isFlat } from "../lib/heroText";
import { useDocumentTitle } from "../lib/title";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sets: HeroSet[]; runs: ReadonlySet<string> };

/** The recorded sets, and the ids of the runs this server lists (so a run in the table links only if it can be opened). */
function useBenchSets(): [Load, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setLoad({ status: "loading" });
    const known = listRuns().then(
      (runs) => new Set(runs.map((run) => run.id)),
      () => new Set<string>(),
    );
    Promise.all([benchResults(), known]).then(
      ([body, runs]) => live && setLoad({ status: "ready", sets: heroSets(body), runs }),
      (error: unknown) => live && setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [load, reload];
}

function ChartsSkeleton() {
  return (
    <div className="charts">
      <SkeletonGroup label="Loading the bench results">
        <Skeleton width={420} height={26} />
        <div className="charts__sk-gap" />
        <Skeleton width="70%" height={14} />
        <div className="charts__sk-gap" />
        <div className="charts__hero">
          <Skeleton height={420} />
          <Skeleton height={420} />
        </div>
      </SkeletonGroup>
    </div>
  );
}

function FlatCard({ title, children }: { title: string; children: string }) {
  return (
    <Card title={title} className="chartcard chartcard--flat">
      <p className="flatnote">{children}</p>
    </Card>
  );
}

function ChartsBody({ sets, runs }: { sets: HeroSet[]; runs: ReadonlySet<string> }) {
  const [chosen, setChosen] = useState(sets[0].name);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [showBand, setShowBand] = useState(true);
  const set = sets.find((s) => s.name === chosen) ?? sets[0];
  const { hero } = set;
  const colors = useMemo(() => seriesColors(hero), [hero]);
  const toggle = useCallback(
    (id: string) =>
      setHidden((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        // Hiding every workflow would leave empty charts; the last one stays.
        return next.size >= hero.series.length ? current : next;
      }),
    [hero.series.length],
  );
  const finished = isFlat(hero, "completionRate", 1) && isFlat(hero, "validityRate", 1);
  const total = runCount(hero);
  const chart = { hero, colors, hidden, showBand };
  return (
    <div className="charts">
      <PageHeader
        title="Stall time and extra cost when coordinators die"
        lead="The same failures hit every workflow. Each point is the mean over the seeds that were run, and the band behind a line runs from the lowest to the highest seed."
      />
      <SetPicker
        sets={sets}
        value={set.name}
        onChange={(name) => {
          setChosen(name);
          setHidden(new Set());
        }}
      />
      <SetCaption set={set} />
      <SeriesKey series={hero.series} colors={colors} hidden={hidden} />
      <div className="charts__hero">
        <MetricChart {...chart} metric="stallS" height={340} />
        <MetricChart {...chart} metric="extraCostPct" height={340} />
      </div>
      {drawsInProcess(hero) && <p className="charts__reason">{IN_PROCESS_REASON}</p>}
      <div className="charts__secondary">
        <MetricChart {...chart} metric="costUsd" height={220} />
        {finished ? (
          <FlatCard title="Completion and validity">
            {total > 0 ? `All ${total} runs of this set completed, and all were valid.` : "Every run of this set completed, and every one was valid."}
          </FlatCard>
        ) : (
          <>
            {isFlat(hero, "completionRate", 1) ? (
              <FlatCard title="Completion">Every run of this set completed.</FlatCard>
            ) : (
              <MetricChart {...chart} metric="completionRate" height={220} />
            )}
            {isFlat(hero, "validityRate", 1) ? (
              <FlatCard title="Validity">Every run of this set was valid.</FlatCard>
            ) : (
              <MetricChart {...chart} metric="validityRate" height={220} />
            )}
          </>
        )}
        {isFlat(hero, "coordinationTokens", 0) ? (
          <FlatCard title="Coordination tokens per run">No workflow spent LLM tokens on coordination in this set.</FlatCard>
        ) : (
          <MetricChart {...chart} metric="coordinationTokens" height={220} />
        )}
      </div>
      <Details id="more" summary="Hide a workflow, show the band of seeds, or read every number" hint="the table of the charts is here">
        <div className="charts__controls">
          <SeriesKey series={hero.series} colors={colors} hidden={hidden} onToggle={toggle} />
          <label className="checkline">
            <input type="checkbox" checked={showBand} onChange={(event) => setShowBand(event.target.checked)} />
            Show the lowest to highest seed
          </label>
        </div>
        <ResultsTable hero={hero} knownRuns={runs} />
        <p className="muted charts__tablenote">A run is a link when it can be opened here; open it to replay and verify it.</p>
      </Details>
      {hero.note && <p className="muted">{hero.note}</p>}
    </div>
  );
}

export function ChartsPage() {
  useDocumentTitle("Charts");
  const [load, reload] = useBenchSets();
  if (load.status === "loading") return <ChartsSkeleton />;
  if (load.status === "error") {
    return (
      <EmptyState
        tone="bad"
        title="Could not load the bench results"
        actions={
          <>
            <button type="button" className="btn" onClick={reload}>
              Try again
            </button>
            <a className="btn" href="#/runs">
              Open the runs
            </a>
          </>
        }
      >
        {load.message}
      </EmptyState>
    );
  }
  if (load.sets.length === 0) {
    return (
      <EmptyState
        tone="warn"
        title="No measured results on this server"
        actions={
          <a className="btn" href="#/runs">
            Open the runs
          </a>
        }
      >
        The server found no recorded bench results to draw, and it will not draw its development placeholder as if it were measured. The results are
        committed under bench/results; a server started from a checkout has them.
      </EmptyState>
    );
  }
  return <ChartsBody sets={load.sets} runs={load.runs} />;
}
