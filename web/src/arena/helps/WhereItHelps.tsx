import { useMemo, useState } from "react";

import { systemName } from "../assumptions";
import "./helps.css";
import { CLAIMS, headlineClaim } from "./claims";
import { rivalOrder, type Honesty } from "./honesty";
import { LOCALITY_WORD, rivalLabel, taskName } from "./labels";
import type { HonestySource } from "./load";
import { Model } from "./Model";
import { PerProcess } from "./PerProcess";
import { Mark, RegimeMap } from "./RegimeMap";
import { ruleLines } from "./tally";
import { TallyTable, type OpenList } from "./TallyTable";

/** What a claim on screen says about its wording: still to be settled at the decision gate, or settled in docs/claims.md. */
function Claim({ id, quoted = false }: { id: keyof typeof CLAIMS; quoted?: boolean }) {
  const claim = CLAIMS[id];
  return (
    <span className="claim">
      <span className="claim__text">{quoted ? `“${claim.text}”` : claim.text}</span>
      {claim.placeholder && <span className="claim__tag">Placeholder wording, pending the decision gate</span>}
    </span>
  );
}

/** The pre-registered outcome: what the decision rule read at the gate, and the headline it allows. */
function OutcomeStrip({ honesty }: { honesty: Honesty }) {
  const { outcome } = honesty;
  const headline = headlineClaim(outcome.label);
  const task = outcome.gate[0] ? ` on ${taskName(outcome.gate[0].task)}` : "";
  return (
    <section className="outcome" data-helps="outcome" aria-label="Pre-registered outcome">
      <div className="outcome__badge" aria-hidden>
        {outcome.label}
      </div>
      <div className="outcome__body">
        <p className="outcome__read">
          <b>Pre-registered outcome {outcome.label}</b>, read against the {systemName(outcome.against)}
          {task}.
          {outcome.gate.length > 0 && <span className="outcome__at"> At the default settings:</span>}
          {outcome.gate.map((point) => (
            <span key={`${point.task}:${point.profile}`} className={`outcome__gate outcome__gate--${point.locality === "n/a" ? "na" : point.locality}`}>
              <Mark locality={point.locality} />
              {point.profile} {LOCALITY_WORD[point.locality]}
            </span>
          ))}
          {outcome.gate.length > 0 && <Model kind="crash" />}
        </p>
        {headline && (
          <p className="outcome__claim">
            <Claim id={headline.id} quoted />
          </p>
        )}
        <p className="outcome__claim outcome__claim--next">
          <Claim id="R3" />
        </p>
      </div>
    </section>
  );
}

/** How a result is decided and what the decision rule named: closed by default, there for whoever wants the rules. */
function Rules({ honesty }: { honesty: Honesty }) {
  const lines = useMemo(() => ruleLines(honesty.rules), [honesty.rules]);
  const { conditions } = honesty.outcome;
  return (
    <div className="rules">
      <details>
        <summary>How a result is decided</summary>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </details>
      {conditions.length > 0 && (
        <details>
          <summary>Conditions the decision rule names ({conditions.length})</summary>
          <ul>
            {conditions.map((condition) => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export interface WhereItHelpsProps {
  honesty: Honesty;
  /** Where the file came from: a sample is marked as one. */
  source: HonestySource;
  /** The rival the map and the per-process view start on: the one the outcome is read against by default. */
  rival?: string;
  /** A cell of the table to start with open, for a director's scene. */
  open?: OpenList | null;
}

/** The "where it helps" panel: where the swarm's recovery is local, where it ties, where it loses, and under which failure model. */
export function WhereItHelps({ honesty, source, rival: start, open: startOpen = null }: WhereItHelpsProps) {
  const rivals = useMemo(() => rivalOrder(honesty), [honesty]);
  const [rival, setRival] = useState(start !== undefined && rivals.includes(start) ? start : honesty.outcome.against);
  const [open, setOpen] = useState<OpenList | null>(startOpen);
  return (
    <section className="helps" aria-label="Where it helps">
      <header className="helps__head">
        <div className="helps__titles">
          <h2 className="helps__title">Where it helps</h2>
          <p className="helps__lead">The swarm against each rival, at every setting the bench ran. Wins, ties and losses, as the bench counted them.</p>
        </div>
        <div className="helps__controls">
          {source === "sample" && (
            <span className="badge badge--warn" title="The server has no bench/results/honesty.json, so this is the copy bundled with the app.">
              Sample data
            </span>
          )}
          <label className="helps__field">
            <span className="helps__field-label">Map and per-process against</span>
            <select value={rival} onChange={(event) => setRival(event.target.value)}>
              {rivals.map((id) => (
                <option key={id} value={id}>
                  {rivalLabel(id)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <OutcomeStrip honesty={honesty} />
      <div className="helps__body">
        <RegimeMap honesty={honesty} rival={rival} />
        <TallyTable honesty={honesty} rivals={rivals} against={honesty.outcome.against} open={open} onOpen={setOpen} />
      </div>
      <PerProcess honesty={honesty} rival={rival} />
      <footer className="helps__foot">
        <Rules honesty={honesty} />
        <p className="helps__prov">
          Rules: {honesty.prereg.path}, sha {honesty.prereg.sha} · code {honesty.code.commit.slice(0, 7)}
          {honesty.code.dirty ? " (with uncommitted changes)" : ""} · regenerate with <code>fractalswarm bench verdicts &lt;results dirs&gt; --prereg</code>
        </p>
      </footer>
    </section>
  );
}
