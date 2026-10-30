import type { RunStatus } from "../../lib/controls";
import { useDocumentTitle } from "../../lib/documentTitle";
import {
  EVIDENCE_HASHES,
  EVIDENCE_TITLES,
  EVIDENCE_VIEWS,
  isEvidence,
  pageName,
  pageTitle,
  PLACES,
  placeOf,
  RUN_VIEW_TITLES,
  RUN_VIEWS,
  runViewHash,
  SITE_NAME,
  type EvidenceView,
  type RunView,
  type Where,
} from "../../lib/shell";
import { Hint, StatusBadge, ThemeToggle } from "../ui";
import "./shell.css";

export interface TopBarProps {
  where: Where;
  /** The run that is open, and the ones that can be opened. */
  runId: string | null;
  runs: readonly { id: string }[];
  runStatus: RunStatus | null;
  scenario: string | null;
  /** Quarantined emails and blocked subgoals: a count on the Security view. */
  blocked: number;
  onPickRun: (id: string) => void;
}

function RunBar({ view, runId, runs, runStatus, scenario, blocked, onPickRun }: Omit<TopBarProps, "where"> & { view: RunView }) {
  return (
    <div className="subnav">
      <div className="subnav__context">
        {runId !== null && (
          <select value={runId} onChange={(event) => onPickRun(event.target.value)} aria-label="Run">
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id}
              </option>
            ))}
          </select>
        )}
        {scenario && <span className="mono muted">{scenario.split(":").at(-1)}</span>}
        <StatusBadge status={runStatus} />
      </div>
      <nav className="tabs" aria-label="Views of this run">
        {RUN_VIEWS.map((name) => (
          <a key={name} className={name === view ? "tab tab--on" : "tab"} href={runViewHash(runId, name)} aria-current={name === view ? "page" : undefined}>
            {RUN_VIEW_TITLES[name]}
            {name === "security" && blocked > 0 && (
              <Hint label="quarantined emails and blocked subgoals">
                <span className="tab__count">{blocked}</span>
              </Hint>
            )}
          </a>
        ))}
      </nav>
    </div>
  );
}

function EvidenceBar({ current }: { current: EvidenceView }) {
  return (
    <div className="subnav">
      <nav className="tabs" aria-label="Evidence">
        {EVIDENCE_VIEWS.map((view) => (
          <a key={view} className={view === current ? "tab tab--on" : "tab"} href={EVIDENCE_HASHES[view]} aria-current={view === current ? "page" : undefined}>
            {EVIDENCE_TITLES[view]}
          </a>
        ))}
      </nav>
    </div>
  );
}

/** The top of the app. The brand is the way home; the four places follow, with the one the person is in marked; and under them, only
 * where the place has views of its own, a second row: a run's (with the run picked and its status) or the evidence's. */
export function TopBar({ where, ...run }: TopBarProps) {
  const place = placeOf(where);
  useDocumentTitle(pageTitle(where, run.runId));
  return (
    <div className="shell">
      {/* a button, not a link to #main: the address is the router's */}
      <button type="button" className="shell__skip" onClick={() => document.getElementById("main")?.focus()}>
        Skip to the page
      </button>
      <header className="topbar">
        <a className="brand" href="#/" aria-label={`${SITE_NAME}, home`}>
          <span className="brand__mark" aria-hidden>
            ◆
          </span>
          {SITE_NAME}
        </a>
        <nav className="tabs" aria-label="Main">
          {PLACES.map((link) => {
            const here = link.place === place;
            return (
              <a key={link.place} className={here ? "tab tab--on" : "tab"} href={link.href} aria-current={here ? (where.page === link.page ? "page" : "true") : undefined}>
                {link.label}
              </a>
            );
          })}
        </nav>
        <div className="topbar__right">
          <ThemeToggle />
        </div>
      </header>
      {where.page === "run" && <RunBar view={where.view} {...run} />}
      {isEvidence(where.page) && <EvidenceBar current={where.page} />}
      {/* a new page is announced: the address changes but the document does not reload */}
      <p className="sr-only" role="status">
        {pageName(where, run.runId)}
      </p>
    </div>
  );
}
