import { useEffect, useMemo, useState } from "react";

import { listRuns } from "../lib/api";
import type { RunListing } from "../lib/types";
import "./ablation.css";
import { createAblationApi, type AblationApi } from "./api";
import { AblationView } from "./AblationView";
import { defaultLauncher, launcherProblems, MAX_NOTES, requestOf, type LauncherForm } from "./launcher";
import type { AblationStatus } from "./model";
import { ablationHash, type AblationRoute } from "./route";
import { ablationRuns, type Filter } from "./view";

const POLL_MS = 1000;
const RETRIES = 20;
const RETRY_MS = 2000;

const go = (hash: string) => {
  window.location.hash = hash;
};

export interface LauncherProps {
  api: AblationApi;
  runs: RunListing[] | null;
}

/** Where an ablation is started (the generator's notes, on the practice backend, at no cost) or picked from the ones on record. */
export function Launcher({ api, runs }: LauncherProps) {
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
      <section className="panel abl__start" aria-label="Start an ablation">
        <h3 className="panel__title">Run the ablation</h3>
        <p className="abl__lead">The same notes through the regex parser and through Muse, each reading scored against the approved one.</p>
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
          The generator’s notes, 0 to {MAX_NOTES} of each kind. This starts the practice backend, which costs nothing; the result says what that does and does not show.
        </p>
        <button type="button" className="btn btn--on" disabled={busy || problems.length > 0} onClick={() => void start()}>
          {busy ? "Starting…" : "Run at no cost"}
        </button>
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
      <section className="panel abl__runs" aria-label="Ablations on record">
        <h3 className="panel__title">On record</h3>
        {runs === null ? (
          <p className="abl__hint">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="abl__hint">No ablation has been recorded on this server yet.</p>
        ) : (
          <ul className="abl__list">
            {runs.map((run) => (
              <li key={run.id}>
                <a href={ablationHash(run.id)}>{run.id}</a> <span className="abl__hint">{run.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
  const [problem, setProblem] = useState<{ message: string; retrying: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [runs, setRuns] = useState<RunListing[] | null>(null);

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
  }, [api, runId]);

  useEffect(() => {
    if (runId !== null) return;
    let live = true;
    setRuns(null);
    loadRuns().then(
      (found) => live && setRuns(ablationRuns(found)),
      () => live && setRuns([]),
    );
    return () => {
      live = false;
    };
  }, [runId, loadRuns]);

  if (runId === null) return <Launcher api={api} runs={runs} />;
  return (
    <div className="abl__page">
      <header className="abl__bar-head">
        <a className="abl__back" href={ablationHash(null)}>
          ← Ablations
        </a>
        <span className="mono abl__runid">{runId}</span>
      </header>
      {problem !== null && (
        <p className="abl__error" role="alert">
          {problem.message}
          {problem.retrying ? ` Asking again every ${RETRY_MS / 1000} seconds.` : ""}
        </p>
      )}
      {run === null && problem === null && <p className="abl__hint">Loading…</p>}
      {run !== null && <AblationView run={run} filter={filter} onFilter={setFilter} />}
    </div>
  );
}

/** `#/ablation[/<run>]`. */
export function AblationPage({ route }: { route: AblationRoute }) {
  const api = useMemo(() => createAblationApi(), []);
  return <AblationFlow api={api} runId={route.runId} loadRuns={listRuns} />;
}
