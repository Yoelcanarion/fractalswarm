import { openedRunHash } from "../../lib/address";
import { profileTerm } from "../../lib/glossary";
import type { HeroData, MetricKey } from "../../lib/hero";
import { formatPoint, METRICS } from "../../lib/heroText";
import { Term } from "../ui";

const COLUMNS: MetricKey[] = ["stallS", "extraCostPct", "costUsd", "completionRate", "validityRate", "coordinationTokens"];

/** The last part of a run path in the bench files ("runs/swarm__t2_conference__C3__s1"): the id a run has when it is listed. */
export const runName = (path: string): string => path.split("/").filter(Boolean).at(-1) ?? path;

export interface ResultsTableProps {
  hero: HeroData;
  /** Ids of the runs this server lists. A run in the table links to its page only if it is one of them. */
  knownRuns: ReadonlySet<string>;
}

/** Every number of the charts, as text: the mean at each failure level and the lowest to highest seed. */
export function ResultsTable({ hero, knownRuns }: ResultsTableProps) {
  return (
    <div className="resultstable">
      <table>
        <caption className="sr-only">Every point of the charts: the mean over the seeds and, in brackets, the lowest to highest seed</caption>
        <thead>
          <tr>
            <th scope="col">Workflow</th>
            <th scope="col">Level</th>
            <th scope="col">Seeds</th>
            {COLUMNS.map((metric) => (
              <th key={metric} scope="col">
                {METRICS[metric].term ? <Term id={METRICS[metric].term}>{METRICS[metric].title}</Term> : METRICS[metric].title}
              </th>
            ))}
            <th scope="col">Runs</th>
          </tr>
        </thead>
        <tbody>
          {hero.series.flatMap((s) =>
            s.points.map((p) => {
              const level = profileTerm(p.profile);
              return (
                <tr key={`${s.id}-${p.coordinatorsKilled}`}>
                  <th scope="row">{s.label}</th>
                  <td>
                    {level ? <Term id={level} /> : (p.profile ?? "–")} <span className="muted">({p.coordinatorsKilled} killed)</span>
                  </td>
                  <td>{p.seeds.length > 0 ? p.seeds.join(", ") : "–"}</td>
                  {COLUMNS.map((metric) => (
                    <td key={metric} className="mono">
                      {formatPoint(metric, p)}
                    </td>
                  ))}
                  <td>
                    {p.runs.length === 0
                      ? "–"
                      : p.runs.map((path) => {
                          const name = runName(path);
                          return knownRuns.has(name) ? (
                            <a key={path} className="mono resultstable__run" href={openedRunHash(name)}>
                              {name}
                            </a>
                          ) : (
                            <span key={path} className="mono resultstable__run">
                              {name}
                            </span>
                          );
                        })}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}
