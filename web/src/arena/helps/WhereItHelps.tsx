import { useMemo, useState, type ReactNode } from "react";

import { PageHeader } from "../../components/ui";
import { systemName } from "../assumptions";
import "./helps.css";
import { CLAIMS, claimsToShow, type Claim, type Claims } from "./claims";
import { rivalOrder, type Honesty } from "./honesty";
import { LOCALITY_WORD, rivalLabel, taskName } from "./labels";
import { Model } from "./Model";
import { PerProcess } from "./PerProcess";
import { Mark, RegimeMap } from "./RegimeMap";
import { ruleLines } from "./tally";
import { TallyTable, type OpenList } from "./TallyTable";

/** A claim on screen, in the words of docs/claims.md, with the status that file gives it: wording still to be settled
 * at the decision gate, or allowed, with whatever the file adds to "allowed" (the evidence it rests on). */
function ClaimLine({ claim, quoted = false }: { claim: Claim; quoted?: boolean }) {
  return (
    <span className="claim">
      <span className="claim__text">{quoted ? `“${claim.text}”` : claim.text}</span>
      {claim.status === "pending" ? (
        <span className="claim__tag">Placeholder wording, pending the decision gate</span>
      ) : (
        <span className="claim__status">Status in docs/claims.md: {claim.note}</span>
      )}
    </span>
  );
}

/** The pre-registered outcome: what the decision rule read at the gate, and the headline it allows. */
function OutcomeStrip({ honesty, claims }: { honesty: Honesty; claims: Claims }) {
  const { outcome } = honesty;
  const { headline, conditions } = claimsToShow(outcome.label, claims);
  const task = outcome.gate[0] ? ` on ${taskName(outcome.gate[0].task)}` : "";
  return (
    <section className="outcome" data-helps="outcome" aria-label="Pre-registered outcome">
      <div className="outcome__badge" aria-hidden>
        {outcome.label}
      </div>
      <div className="outcome__body">
        <p className="outcome__read">
          {/* one item of the row, not three: the row's gap would otherwise open a space before the comma */}
          <span>
            <b>Pre-registered outcome {outcome.label}</b>, read against the {systemName(outcome.against)}
            {task}.
          </span>
          {outcome.gate.length > 0 && <span className="outcome__at"> At the default settings:</span>}
          {outcome.gate.map((point) => (
            <span key={`${point.task}:${point.profile}`} className={`outcome__gate outcome__gate--${point.locality === "n/a" ? "na" : point.locality}`}>
              <Mark locality={point.locality} />
              {point.profile} {LOCALITY_WORD[point.locality]}
            </span>
          ))}
          {outcome.gate.length > 0 && <Model kind="crash" />}
        </p>
        {headline ? (
          <p className="outcome__claim">
            <ClaimLine claim={headline} quoted />
          </p>
        ) : (
          <p className="outcome__claim outcome__claim--none">No headline claim is allowed for outcome {outcome.label} (docs/claims.md).</p>
        )}
        {conditions && (
          <p className="outcome__claim outcome__claim--next">
            <ClaimLine claim={conditions} />
          </p>
        )}
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
          <summary>Conditions the decision rule names</summary>
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

/** The head of the page: the same whether the verdicts are there or not, so a stranger knows where they are before anything loads. */
export function HelpsHead({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      className="helps__head"
      title="Where it helps"
      lead="The swarm against each rival, at every setting the bench ran. Wins, ties and losses, as the bench counted them."
      actions={actions}
    />
  );
}

export interface WhereItHelpsProps {
  honesty: Honesty;
  /** The rival the map and the per-process view start on: the one the outcome is read against by default. */
  rival?: string;
  /** A cell of the table to start with open, for a director's scene. */
  open?: OpenList | null;
  /** The claims it may quote: docs/claims.md as the build has it. A test passes others. */
  claims?: Claims;
}

/** The "where it helps" panel: where the swarm's recovery is local, where it ties, where it loses, and under which failure model. */
export function WhereItHelps({ honesty, rival: start, open: startOpen = null, claims = CLAIMS }: WhereItHelpsProps) {
  const rivals = useMemo(() => rivalOrder(honesty), [honesty]);
  const [rival, setRival] = useState(start !== undefined && rivals.includes(start) ? start : honesty.outcome.against);
  const [open, setOpen] = useState<OpenList | null>(startOpen);
  return (
    <section className="helps" aria-label="Where it helps">
      <HelpsHead
        actions={
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
        }
      />
      <OutcomeStrip honesty={honesty} claims={claims} />
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
