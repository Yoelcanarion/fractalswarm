import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Details, EmptyState, PageHeader, Skeleton, SkeletonGroup, SkeletonText, Term } from "../components/ui";
import { listRuns } from "../lib/api";
import type { RunListing } from "../lib/types";
import "./ablation.css";
import { createAblationApi, type AblationApi } from "./api";
import { AblationView } from "./AblationView";
import { defaultLauncher, launcherProblems, MAX_NOTES, requestOf, type LauncherForm } from "./launcher";
import type { AblationStatus } from "./model";
import { ablationHash, type AblationRoute } from "./route";
import { ablationRuns, type Filter } from "./view";

/** The ablations on record that a stranger sees at once: the newest. The rest are under Details. */
const RECENT = 4;

const POLL_MS = 1000;
const RETRIES = 20;
const RETRY_MS = 2000;

const go = (hash: string) => {
  window.location.hash = hash;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The head of both screens of the page: what the ablation is, whether or not anything has loaded yet. */
function AblationHead({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      title="Model vs parser"
      lead={
        <>
          Is the model really doing the work? The same messy notes go to a hand-written parser and to <Term id="muse">Muse</Term>, and each reading is scored against the one a person approved.
        </>
      }
      actions={actions}
    />
  );
}

export interface LauncherProps {
  api: AblationApi;
  /** The ablations on record: null while they are being listed. */
  runs: RunListing[] | null;
  /** Why they could not be listed. The ones on record are then unknown, which is not the same as none. */
  listError?: string | null;
  onRetryList?: () => void;
}

/** Where an ablation is started (the generator's notes, on the practice backend, at no cost) or picked from the ones on record. */
export function Launcher({ api, runs, listError = null, onRetryList }: LauncherProps) {
  const [form, setForm] = useState<LauncherForm>(defaultLauncher);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = launcherProblems(form);
  const set = (key: keyof LauncherForm, value: string) => setForm({ ...form, [key]: value });

  const start = async () => {
    setBusy(true);
    setError(null);
    const outcome = await api.start(requestOf(form));
    setBusy(false);
    if (outcome.ok) go(ablationHash(outcome.body.run_id));
    else setError(outcome.error);
  };

  return (
    <div className="abl abl--launch">
      <AblationHead />
      <section className="panel abl__start" aria-label="Start a comparison">
        <h3 className="panel__title">Run the comparison</h3>
        <p className="abl__hint">
          This starts the practice backend, which costs nothing; the result says what that does and does not show.
        </p>
        <button type="button" className="btn btn--on" disabled={busy || problems.length > 0} onClick={() => void start()}>
          {busy ? "Starting…" : "Run at no cost"}
        </button>
        <Details inline id="more" summary="Change the notes or the seed" hint="emails, abstracts, seed" open={problems.length > 0}>
          <div className="abl__fields">
            <label className="abl__field">
              <span>Emails</span>
              <input inputMode="numeric" value={form.emails} onChange={(event) => set("emails", event.target.value)} aria-describedby="abl-limits" />
            </label>
            <label className="abl__field">
              <span>Abstracts</span>
              <input inputMode="numeric" value={form.abstracts} onChange={(event) => set("abstracts", event.target.value)} aria-describedby="abl-limits" />
            </label>
            <label className="abl__field">
              <span>Seed</span>
              <input inputMode="numeric" value={form.seed} onChange={(event) => set("seed", event.target.value)} />
            </label>
          </div>
          <p id="abl-limits" className="abl__hint">
            The generator’s notes, 0 to {MAX_NOTES} of each kind.
          </p>
        </Details>
        {problems.length > 0 && (
          <ul className="abl__problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {error !== null && (
          <p className="abl__error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="panel abl__runs" aria-label="Comparisons on record">
        <h3 className="panel__title">On record</h3>
        {listError !== null ? (
          <div className="abl__error" role="alert">
            <p>Could not list the comparisons on record ({listError}).</p>
            {onRetryList && (
              <button type="button" className="btn" onClick={onRetryList}>
                Try again
              </button>
            )}
          </div>
        ) : runs === null ? (
          <SkeletonGroup label="Loading the comparisons on record">
            <SkeletonText lines={3} />
          </SkeletonGroup>
        ) : runs.length === 0 ? (
          <p className="abl__hint">No comparison has been recorded here yet.</p>
        ) : (
          <>
            <ul className="abl__list">
              {runs.slice(0, RECENT).map((run) => (
                <li key={run.id}>
                  <a href={ablationHash(run.id)}>{run.id}</a> <span className="abl__hint">{run.status}</span>
                </li>
              ))}
            </ul>
            {runs.length > RECENT && (
              <Details inline id="all" summary={`All ${runs.length} comparisons on record`}>
                <ul className="abl__list">
                  {runs.slice(RECENT).map((run) => (
                    <li key={run.id}>
                      <a href={ablationHash(run.id)}>{run.id}</a> <span className="abl__hint">{run.status}</span>
                    </li>
                  ))}
                </ul>
              </Details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** What went wrong asking the server for a run, and whether the page is going to ask again by itself. */
export interface Problem {
  message: string;
  retrying: boolean;
}

/** That the page is going to ask again by itself, on a line of its own: what the server said ends however it ends (a reason with no full stop, a
 * command to run), so the sentence is not run on to it. */
function Asking({ problem }: { problem: Problem }) {
  return problem.retrying ? <span className="abl__again">{`Asking again every ${RETRY_MS / 1000} seconds.`}</span> : null;
}

/** The ablation could not be loaded at all: what the server said, and the way out. */
export function AblationFailed({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  return (
    <EmptyState
      tone="bad"
      title="This comparison could not be loaded"
      actions={
        <>
          <button type="button" className="btn btn--on" onClick={onRetry}>
            Try again
          </button>
          <a className="btn" href={ablationHash(null)}>
            All ablations
          </a>
        </>
      }
    >
      {problem.message} <Asking problem={problem} />
    </EmptyState>
  );
}

/** A later asking failed (the server stopped while the ablation was scoring): what was loaded stays, with the reason above it. */
export function AblationBanner({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  return (
    <div className="abl__error" role="alert">
      <p>
        {problem.message} <Asking problem={problem} />
      </p>
      {!problem.retrying && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export interface AblationFlowProps {
  api: AblationApi;
  runId: string | null;
  /** The runs the server lists. */
  loadRuns: () => Promise<RunListing[]>;
}

/** `#/ablation` and `#/ablation/<run>`: asks the server for the run, and keeps asking while it is still scoring. */
export function AblationFlow({ api, runId, loadRuns }: AblationFlowProps) {
  const [run, setRun] = useState<AblationStatus | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [runs, setRuns] = useState<RunListing[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // bumped to ask again by hand, which starts the asking over
  const [attempt, setAttempt] = useState(0);
  const [listAttempt, setListAttempt] = useState(0);

  useEffect(() => {
    setRun(null);
    setProblem(null);
    setFilter("all");
    if (runId === null) return;
    let stopped = false;
    let timer: number | undefined;
    let failures = 0;
    const ask = async () => {
      const outcome = await api.status(runId);
      if (stopped) return;
      if (outcome.ok) {
        failures = 0;
        setProblem(null);
        setRun(outcome.body);
        if (outcome.body.status === "running") timer = window.setTimeout(() => void ask(), POLL_MS);
        return;
      }
      // a server that does not know the run will not learn it; one that cannot be reached may be restarting
      const again = (outcome.status === 0 || outcome.status >= 500) && ++failures < RETRIES;
      setProblem({ message: outcome.error, retrying: again });
      if (again) timer = window.setTimeout(() => void ask(), RETRY_MS);
    };
    void ask();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [api, runId, attempt]);

  useEffect(() => {
    if (runId !== null) return;
    let live = true;
    setRuns(null);
    setListError(null);
    loadRuns().then(
      (found) => live && setRuns(ablationRuns(found)),
      (error) => live && setListError(messageOf(error)),
    );
    return () => {
      live = false;
    };
  }, [runId, loadRuns, listAttempt]);

  if (runId === null) return <Launcher api={api} runs={runs} listError={listError} onRetryList={() => setListAttempt((n) => n + 1)} />;

  const head = (
    <AblationHead
      actions={
        <>
          <span className="mono abl__runid">{runId}</span>
          <a className="btn" href={ablationHash(null)}>
            All ablations
          </a>
        </>
      }
    />
  );
  const again = () => setAttempt((n) => n + 1);

  if (run === null) {
    return (
      <div className="abl">
        {head}
        {problem === null ? (
          // the shape of the result, so the page does not jump when it arrives
          <SkeletonGroup label="Loading the comparison" className="skeleton-group--stack">
            <Skeleton width={420} height={44} />
            <Skeleton height={72} />
            <Skeleton height={160} />
            <Skeleton height={320} />
          </SkeletonGroup>
        ) : (
          <AblationFailed problem={problem} onRetry={again} />
        )}
      </div>
    );
  }

  return (
    <AblationView
      run={run}
      filter={filter}
      onFilter={setFilter}
      top={
        <>
          {head}
          {problem !== null && <AblationBanner problem={problem} onRetry={again} />}
        </>
      }
    />
  );
}

/** `#/ablation[/<run>]`. */
export function AblationPage({ route }: { route: AblationRoute }) {
  const api = useMemo(() => createAblationApi(), []);
  return <AblationFlow api={api} runId={route.runId} loadRuns={listRuns} />;
}
