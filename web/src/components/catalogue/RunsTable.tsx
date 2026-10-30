import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

import {
  BILLING,
  chaosWords,
  formatDuration,
  STATES,
  verifyWords,
  type CatalogueRow,
  type RunState,
  type SortDir,
  type SortKey,
  type VerifyView,
} from "../../lib/catalogue";
import { openedRunHash } from "../../lib/address";
import { formatMetric, taskOf } from "../../lib/heroText";
import { Skeleton, Term, Tooltip } from "../ui";

const BADGE: Record<RunState, string> = {
  live: "badge--live",
  recorded: "",
  halted: "badge--warn",
  interrupted: "badge--bad",
  empty: "",
};

const Sub = ({ children }: { children: ReactNode }) => (children ? <span className="runcell__sub">{children}</span> : null);
const Pending = () => <Skeleton width="70%" height={14} />;

export interface Sort {
  key: SortKey;
  dir: SortDir;
}

function SortHead({ id, sort, onSort, children }: { id: SortKey; sort: Sort; onSort: (key: SortKey) => void; children: ReactNode }) {
  const active = sort.key === id;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sorthead" onClick={() => onSort(id)}>
        {children}
        <Icon size={14} aria-hidden="true" />
      </button>
    </th>
  );
}

function BillingCell({ row }: { row: CatalogueRow }) {
  if (!row.facts) return <Pending />;
  const billing = BILLING[row.facts.billed === null ? "unknown" : row.facts.billed ? "billed" : "notBilled"];
  // The words say it; the sentence behind them is for the mouse, and the key under the table has it for everyone.
  return (
    <Tooltip label={billing.says}>
      <span className="runcell__main">{billing.label}</span>
    </Tooltip>
  );
}

function StateCell({ state }: { state: RunState }) {
  const badge = <span className={`badge ${BADGE[state]}`}>{STATES[state].label}</span>;
  // "Recorded" and "Empty" explain themselves. The others get their sentence, and a tab stop to read it.
  return state === "recorded" || state === "empty" ? (
    badge
  ) : (
    <Tooltip label={STATES[state].says} focusable>
      {badge}
    </Tooltip>
  );
}

function VerifyCell({ row, view, onVerify }: { row: CatalogueRow; view: VerifyView; onVerify: (id: string) => void }) {
  if (row.state === "live" || row.state === "empty") return <span className="muted">–</span>;
  if (view.state === "idle") {
    return (
      <button type="button" className="btn btn--seg" onClick={() => onVerify(row.listing.id)} aria-label={`Verify the replay of ${row.listing.id}`}>
        Verify
      </button>
    );
  }
  const words = verifyWords(view);
  const tone = words.tone === "good" ? "badge--good" : words.tone === "bad" ? "badge--bad" : words.tone === "warn" ? "badge--warn" : "";
  // The verdict is read by a screen reader as it arrives; the detail behind it is a sentence under the words for those who can hover.
  const badge = (
    <span className={`badge ${tone}`} role="status">
      {words.label}
    </span>
  );
  return (
    <span className="runcell__verify">
      {words.detail ? <Tooltip label={words.detail}>{badge}</Tooltip> : badge}
      {view.state === "error" && (
        <button type="button" className="btn btn--seg" onClick={() => onVerify(row.listing.id)} aria-label={`Try again to verify ${row.listing.id}`}>
          Retry
        </button>
      )}
    </span>
  );
}

function RunRow({ row, view, onVerify }: { row: CatalogueRow; view: VerifyView; onVerify: (id: string) => void }) {
  const { listing, facts } = row;
  const task = facts?.task ? taskOf(facts.task) : null;
  const chaos = facts ? chaosWords(facts) : null;
  return (
    <tr>
      <th scope="row" className="runcell">
        <a className="mono runcell__id" href={openedRunHash(listing.id)}>
          {listing.id}
        </a>
        {listing.source !== "runs" && <Sub>{listing.source === "demo" ? "demo bundle" : listing.source}</Sub>}
      </th>
      <td className="runcell">
        <span className="runcell__main">{row.workflow.label}</span>
        {facts ? (
          <Sub>
            {task ? (
              <>
                {task.term ? (
                  <Term id={task.term} focusable={false}>
                    {task.short}
                  </Term>
                ) : (
                  task.short
                )}
                {task.name && ` ${task.name}`}
              </>
            ) : (
              "no task"
            )}
            {listing.seed ? ` · seed ${listing.seed}` : ""}
          </Sub>
        ) : (
          <Pending />
        )}
      </td>
      <td className="runcell">
        {!facts ? (
          <Pending />
        ) : chaos ? (
          <>
            <span className="runcell__main">
              {chaos.term ? (
                <Term id={chaos.term} focusable={false}>
                  {chaos.label}
                </Term>
              ) : (
                chaos.label
              )}
            </span>
            <Sub>{chaos.killed}</Sub>
          </>
        ) : (
          <span className="muted">None</span>
        )}
      </td>
      <td className="runcell">
        <BillingCell row={row} />
      </td>
      <td className="runcell">
        <StateCell state={row.state} />
      </td>
      <td className="runcell">
        <span className="runcell__main">{formatDuration(listing.duration_ms)}</span>
        <Sub>
          {listing.events.toLocaleString("en-US")} events
          {facts?.clock === "sim" ? " · simulated clock" : facts?.clock === "live" ? " · live clock" : ""}
        </Sub>
      </td>
      <td className="runcell">
        {!facts ? (
          <Pending />
        ) : facts.spentUsd === null ? (
          <span className="muted">–</span>
        ) : (
          <>
            <span className="runcell__main mono">{formatMetric("costUsd", facts.spentUsd)}</span>
            <Sub>{facts.billed === false ? "notional" : ""}</Sub>
          </>
        )}
      </td>
      <td className="runcell">
        <VerifyCell row={row} view={view} onVerify={onVerify} />
      </td>
    </tr>
  );
}

export interface RunsTableProps {
  rows: readonly CatalogueRow[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  verify: Readonly<Record<string, VerifyView>>;
  onVerify: (id: string) => void;
}

/** One row per run, in words. The facts that live in the log (task, failures, billing, spend) arrive as the page reads them,
 * so a row is first a name and a size and then fills in. */
export function RunsTable({ rows, sort, onSort, verify, onVerify }: RunsTableProps) {
  return (
    <div className="runstable">
      <table>
        <caption className="sr-only">Runs on this server. Press a column title to sort by it.</caption>
        <thead>
          <tr>
            <SortHead id="run" sort={sort} onSort={onSort}>
              Run
            </SortHead>
            <SortHead id="workflow" sort={sort} onSort={onSort}>
              What ran
            </SortHead>
            <th scope="col">Failures</th>
            <th scope="col">Billing</th>
            <SortHead id="state" sort={sort} onSort={onSort}>
              State
            </SortHead>
            <SortHead id="duration" sort={sort} onSort={onSort}>
              Length
            </SortHead>
            <SortHead id="spent" sort={sort} onSort={onSort}>
              Spent
            </SortHead>
            <th scope="col">Replay check</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <RunRow key={row.listing.id} row={row} view={verify[row.listing.id] ?? { state: "idle" }} onVerify={onVerify} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
