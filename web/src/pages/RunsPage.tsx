import { useEffect } from "react";

import { NewTaskForm } from "../components/NewTaskForm";
import { useRunStore, useRunStoreShallow } from "../store";

export function RunsPage() {
  const { runs, runsError } = useRunStoreShallow((s) => ({ runs: s.runs, runsError: s.runsError }));
  const loadRuns = useRunStore((s) => s.loadRuns);
  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  return (
    <div className="runs">
      <section className="panel">
        <header className="panel__title">Runs</header>
        {runsError && <div className="empty empty--bad">{runsError}</div>}
        <table className="runs__table">
          <thead>
            <tr>
              <th>run</th>
              <th>source</th>
              <th>scenario</th>
              <th>status</th>
              <th>events</th>
              <th>virtual time</th>
              <th>head</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <a href={`#/run/${encodeURIComponent(run.id)}`}>{run.id}</a>
                </td>
                <td>{run.source}</td>
                <td className="mono">{run.scenario}</td>
                <td>{run.status === "running" ? <span className="badge badge--live">● live</span> : run.status}</td>
                <td>{run.events}</td>
                <td>{(run.duration_ms / 1000).toFixed(2)} s</td>
                <td className="mono">{run.head?.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <NewTaskForm />
    </div>
  );
}
