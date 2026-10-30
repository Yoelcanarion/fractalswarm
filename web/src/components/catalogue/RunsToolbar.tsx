import { RefreshCw, Search } from "lucide-react";

import { STATES, type Filter, type RunState } from "../../lib/catalogue";

export interface RunsToolbarProps {
  filter: Filter;
  onFilter: (next: Filter) => void;
  /** The states that have a run, so the filter offers only what exists. */
  states: readonly RunState[];
  workflows: readonly { id: string; label: string; count: number }[];
  /** "1 live · 12 recorded". */
  summary: string;
  onRefresh: () => void;
  /** True when the list is sorted by a column; the button then offers the server's order (newest first) back. */
  sorted: boolean;
  onResetSort: () => void;
  onVerifyAll: () => void;
  /** How many of the listed runs "verify" would replay (the ones not checked yet); the button is off at 0 and while it runs. */
  verifiable: number;
  verifying: boolean;
}

/** Search and filter, what is listed, and the two actions on the whole list. */
export function RunsToolbar({ filter, onFilter, states, workflows, summary, onRefresh, sorted, onResetSort, onVerifyAll, verifiable, verifying }: RunsToolbarProps) {
  return (
    <div className="runstool" role="search">
      <label className="runstool__search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search runs</span>
        <input
          type="search"
          value={filter.query}
          onChange={(event) => onFilter({ ...filter, query: event.target.value })}
          placeholder="Search id, workflow, task or failures"
        />
      </label>
      <label className="runstool__field">
        State
        <select value={filter.state} onChange={(event) => onFilter({ ...filter, state: event.target.value as Filter["state"] })}>
          <option value="all">All</option>
          {states.map((state) => (
            <option key={state} value={state}>
              {STATES[state].label}
            </option>
          ))}
        </select>
      </label>
      <label className="runstool__field">
        Workflow
        <select value={filter.workflow} onChange={(event) => onFilter({ ...filter, workflow: event.target.value })}>
          <option value="all">All</option>
          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.label} ({workflow.count})
            </option>
          ))}
        </select>
      </label>
      <span className="runstool__summary" aria-live="polite">
        {summary}
      </span>
      <div className="runstool__actions">
        {sorted && (
          <button type="button" className="btn" onClick={onResetSort}>
            Newest first
          </button>
        )}
        <button type="button" className="btn" onClick={onVerifyAll} disabled={verifying || verifiable === 0}>
          {verifying ? "Replaying…" : verifiable === 0 ? "Nothing to verify" : `Verify ${verifiable} listed run${verifiable === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label="Refresh the list">
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
