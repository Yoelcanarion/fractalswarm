import { useMemo } from "react";

import { systemName } from "../assumptions";
import type { Honesty } from "./honesty";
import { taskName } from "./labels";
import { Model } from "./Model";
import { processView, readingText, type ProcessView } from "./process";

export interface PerProcessProps {
  honesty: Honesty;
  rival: string;
}

function lead(view: ProcessView | null, noun: string): string {
  if (!view) return `The bench has no per-process view against the ${noun}.`;
  const total = view.coordinators.reduce((sum, n) => sum + n, 0);
  return (
    `If every coordinator process fails at the same rate, the swarm (${view.coordinators.join(" + ")} = ${total} coordinators) ` +
    `sees about ${total} times the crashes of one ${noun}. Expected impact for each unit of failure rate, ${taskName(view.task)}.`
  );
}

/** The failure model that favours the rival: every coordinator process fails at the same rate. */
export function PerProcess({ honesty, rival }: PerProcessProps) {
  const view = useMemo(() => processView(honesty, rival), [honesty, rival]);
  const noun = systemName(rival);
  return (
    <section className="proc" data-helps="process" aria-label="Per process">
      <header className="helps__section-head">
        <div className="helps__h-row">
          <h3 className="helps__h">Per process</h3>
          <Model kind="process" />
        </div>
        <p className="helps__sub">{lead(view, noun)}</p>
      </header>
      {view && (
        <ul className="proc__lines">
          {view.lines.map((line) => (
            <li key={line.key} className={`proc__line proc__line--${line.tone}`}>
              <span className="proc__label">{line.label}</span>
              <span className="proc__pair">
                <span className="proc__value" aria-label={`swarm ${line.swarm}`}>
                  {line.swarm}
                  <small>swarm</small>
                </span>
                <span className="proc__value" aria-label={`${noun} ${line.rival}`}>
                  {line.rival}
                  <small>{noun}</small>
                </span>
              </span>
              <span className="proc__foot">
                <span className="proc__ratio">{line.ratio}</span>
                <span className="proc__reading">{readingText(line.reading, "Supervisor")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
