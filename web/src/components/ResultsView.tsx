import { useMemo } from "react";

import { asNumber, asStrings, digest } from "../lib/generic";
import type { ViewState } from "../lib/reducer";
import { outcomeOf, placementsOf, type Outcome } from "../lib/results";
import { useRun } from "../store";
import { Card, GenericRows, money, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";

const OUTCOME: Record<Outcome, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  pending: { label: "no result yet", tone: "muted" },
  complete: { label: "complete", tone: "good" },
  partial: { label: "partial: explicit gaps", tone: "warn" },
  failed: { label: "failed", tone: "bad" },
};

const natural = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

// Report fields the headline, the schedule and the document already show.
const SHOWN = new Set(["expected", "placed", "gaps", "hard_violations", "soft_score", "schedule", "violations", "violation_counts", "markdown"]);

const clip = (text: string, max = 160): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function Schedule({ report }: { report: Record<string, unknown> }) {
  const placements = useMemo(() => placementsOf(report), [report]);
  if (placements.length === 0) return <Nothing>This report carries no schedule.</Nothing>;
  const unique = (pick: (p: (typeof placements)[number]) => string) => [...new Set(placements.map(pick))].sort(natural);
  const days = unique((p) => p.day);
  const rooms = unique((p) => p.room);
  const slots = unique((p) => p.slot);
  const at = new Map(placements.map((p) => [`${p.day}|${p.room}|${p.slot}`, p.talk]));
  return (
    <div className="rgrid">
      {days.map((day) => (
        <div key={day}>
          <div className="grid__day-title">Day {day}</div>
          <table className="grid__table">
            <thead>
              <tr>
                <th />
                {slots.map((slot) => (
                  <th key={slot}>{slot}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room}>
                  <th>{room}</th>
                  {slots.map((slot) => {
                    const talk = at.get(`${day}|${room}|${slot}`);
                    return (
                      <td key={slot} className={`cell cell--result ${talk ? "cell--filled" : ""}`} title={talk ? `${talk} · day ${day} ${room} slot ${slot}` : ""}>
                        {talk && <span className="cell__talk">{talk}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function ResultsView({ view }: { view: ViewState }) {
  const { results, economy } = view.panels;
  const seek = useRun((s) => s.seek);
  const total = useRun((s) => s.events.length);
  const live = useRun((s) => s.live);
  const outcome = outcomeOf(results);
  const task = results.task;
  const report = task?.report ?? {};
  // The root's own list, plus any goal that ended with gaps: a partial result names all of them.
  const gaps = [...new Set([...asStrings(report.gaps), ...results.goalOrder.flatMap((id) => results.goals[id].gaps)])];
  const expected = asNumber(report.expected);
  const placed = asNumber(report.placed);
  const hard = asNumber(report.hard_violations);
  const soft = asNumber(report.soft_score);
  const violations = Array.isArray(report.violations) ? report.violations : [];
  const counts = Object.entries(typeof report.violation_counts === "object" && report.violation_counts ? report.violation_counts : {});
  const extra = Object.entries(report).filter(([key]) => !SHOWN.has(key));
  // A report that is a document (the T3 web report) carries it as markdown. Shown as plain text:
  // it quotes third-party pages, so it is never rendered as markup.
  const document = typeof report.markdown === "string" ? report.markdown : null;
  const { contracts, judged } = results;

  return (
    <div className="results">
      <section className="panel results__head">
        <div className="results__title">
          <Pill tone={OUTCOME[outcome].tone}>
            <span className="results__outcome">{OUTCOME[outcome].label}</span>
          </Pill>
          <div>
            <h1>{task ? task.task : "Results"}</h1>
            <div className="muted">
              {task
                ? `reported by ${task.actor} at t = ${virtualSeconds(task.ts)} · task.result, event ${task.seq}`
                : "the root reports with task.result once every track has finished"}
            </div>
          </div>
        </div>
        <div className="pstats">
          {placed !== null && <PStat label="placed" value={expected === null ? placed : `${placed} / ${expected}`} tone={expected !== null && placed < expected ? "warn" : "good"} />}
          {hard !== null && <PStat label="hard violations" value={hard} tone={hard === 0 ? "good" : "bad"} />}
          {soft !== null && <PStat label="soft score" value={soft.toFixed(2)} />}
          <PStat label="gaps" value={gaps.length} tone={gaps.length > 0 ? "warn" : ""} />
          <PStat label="spent" value={money(economy.spentUsd)} />
          <PStat label="coordination tokens" value={view.counters.coordinationTokens} tone="good" title="LLM tokens spent on membership, ownership and takeover" />
        </div>
        {outcome === "pending" && (
          <div className="results__wait">
            {contracts.verified} of {contracts.created} contracts verified so far.
            {!live && total > 0 && (
              <button className="btn" onClick={() => seek(total)}>
                Jump to the end of the run
              </button>
            )}
          </div>
        )}
        {gaps.length > 0 && (
          <div className="pevent pevent--warn">
            <Pill tone="warn">gaps</Pill> {gaps.join(", ")}
          </div>
        )}
      </section>

      <div className="results__cols">
        <Card title="Schedule" hint={placed === null ? undefined : `${placed} talks placed`}>
          {task ? <Schedule report={report} /> : <Nothing>The schedule is part of the final report.</Nothing>}
        </Card>

        <Card title="Goals and verification" hint="spec §11">
          <div className="pstats">
            <PStat label="contracts verified" value={`${contracts.verified} / ${contracts.created}`} />
            <PStat label="rejected" value={contracts.rejected} tone={contracts.rejected > 0 ? "warn" : ""} />
            <PStat label="failed" value={contracts.failed} tone={contracts.failed > 0 ? "bad" : ""} />
            <PStat label="judged" value={judged.count} />
            <PStat label="judge pass" value={judged.count ? `${judged.passed} / ${judged.count}` : "–"} tone={judged.count > 0 && judged.passed === judged.count ? "good" : ""} />
            <PStat label="mean score" value={judged.count ? (judged.scoreSum / judged.count).toFixed(2) : "–"} />
          </div>
          {results.goalOrder.length === 0 ? (
            <Nothing>No goal has completed yet.</Nothing>
          ) : (
            <table className="ptable ptable--log">
              <thead>
                <tr>
                  <th>goal</th>
                  <th>owner</th>
                  <th>status</th>
                  <th>t</th>
                </tr>
              </thead>
              <tbody>
                {results.goalOrder.map((id) => {
                  const goal = results.goals[id];
                  return (
                    <tr key={id}>
                      <td className="mono">{goal.goalId}</td>
                      <td>{goal.owner}</td>
                      <td>
                        <Pill tone={goal.status === "ok" ? "good" : "bad"}>{goal.status}</Pill>
                        {goal.gaps.length > 0 && <span className="muted"> {goal.gaps.join(", ")}</span>}
                      </td>
                      <td className="mono">{virtualSeconds(goal.ts)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <GenericRows rows={results.other} title="Audit and result events this view does not read yet" />
        </Card>

        <Card title="Report" hint="everything task.result carries">
          {!task ? (
            <Nothing>No report yet.</Nothing>
          ) : (
            <>
              {counts.length > 0 && (
                <>
                  <Subhead>Violations by kind</Subhead>
                  <table className="ptable">
                    <tbody>
                      {counts.map(([kind, count]) => (
                        <tr key={kind}>
                          <td className="mono">{kind}</td>
                          <td>{String(count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {violations.length > 0 && (
                <>
                  <Subhead hint={`${violations.length} in all`}>Violations</Subhead>
                  <ul className="generic__list">
                    {violations.slice(0, 8).map((v, i) => (
                      <li key={i} className="mono">
                        {typeof v === "string" ? v : digest(v as Record<string, unknown>)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {counts.length === 0 && violations.length === 0 && (hard === 0 || hard === null) && <Nothing>No violation recorded in this report.</Nothing>}
              {extra.length > 0 && (
                <table className="ptable">
                  <tbody>
                    {extra.map(([key, value]) => (
                      <tr key={key}>
                        <td className="mono">{key}</td>
                        <td title={typeof value === "object" ? undefined : String(value)}>
                          {typeof value === "object" ? digest({ [key]: value }) : clip(String(value))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {document !== null && (
                <>
                  <Subhead hint={`${document.length.toLocaleString("en")} characters`}>Document</Subhead>
                  <pre className="results__doc">{document}</pre>
                </>
              )}
              <details className="results__raw">
                <summary>The raw report</summary>
                <pre className="mono">{JSON.stringify({ status: task.status, report }, null, 2)}</pre>
              </details>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
