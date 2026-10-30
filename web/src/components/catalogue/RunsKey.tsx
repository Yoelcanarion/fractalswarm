import { BILLING, STATE_ORDER, STATES } from "../../lib/catalogue";
import { GLOSSARY } from "../../lib/glossary";
import { Details } from "../ui";

/** What the columns mean, once and as plain text. The table's own hints open on hover; this is for everyone else, and it
 * is where the words that repeat down a column (C0 to C3) are defined. */
export function RunsKey() {
  return (
    <Details inline summary="How to read this table">
      <dl className="runskey__list">
        <dt>What ran</dt>
        <dd>The workflow that recorded the run, the task it was given and its random seed.</dd>

        <dt>Failures</dt>
        <dd>
          The failure plan the run was given.
          <ul>
            {(["c0", "c1", "c2", "c3"] as const).map((id) => (
              <li key={id}>
                <strong>{GLOSSARY[id].term}</strong> {GLOSSARY[id].says}
              </li>
            ))}
          </ul>
          A run with its own plan lists the coordinators it kills.
        </dd>

        <dt>Billing</dt>
        <dd>
          <strong>{BILLING.billed.label}</strong> {BILLING.billed.says} <strong>{BILLING.notBilled.label}</strong> {BILLING.notBilled.says}
        </dd>

        <dt>State</dt>
        <dd>
          <ul>
            {STATE_ORDER.map((state) => (
              <li key={state}>
                <strong>{STATES[state].label}</strong> {STATES[state].says}
              </li>
            ))}
          </ul>
        </dd>

        <dt>Length</dt>
        <dd>
          How long the run took on its own clock. {GLOSSARY.virtualTime.says}
        </dd>

        <dt>Spent</dt>
        <dd>What the run's last event says it spent. It is notional for a run that was not billed.</dd>

        <dt>Replay check</dt>
        <dd>
          {GLOSSARY.replay.says} Each check replays the whole run, so it happens when you ask for it.
        </dd>
      </dl>
    </Details>
  );
}
