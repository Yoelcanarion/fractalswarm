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
  runViewHash,
  runViewsShown,
  SITE_NAME,
  type EvidenceView,
  type RunView,
  type Where,
} from "../../lib/shell";
import { Details, Hint, StatusBadge, ThemeToggle } from "../ui";
import { GuideButton, type GuideState } from "./Guide";
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
  /** A run is about to open: the status badge holds its place until the status is known. With no run to open, and for a run that failed
   * to load, there is no status to wait for and no badge. */
  opening?: boolean;
  onPickRun: (id: string) => void;
  /** The guide, when the page has one: its button is at the end of the bar, on every page. */
  guide?: GuideState;
}

function RunTab({ name, view, runId, blocked }: { name: RunView; view: RunView; runId: string | null; blocked: number }) {
  return (
    <a className={name === view ? "tab tab--on" : "tab"} href={runViewHash(runId, name)} aria-current={name === view ? "page" : undefined}>
      {RUN_VIEW_TITLES[name]}
      {name === "security" && blocked > 0 && (
        <Hint label="quarantined emails and blocked subgoals">
          <span className="tab__count">{blocked}</span>
        </Hint>
      )}
    </a>
  );
}

function RunBar({ view, runId, runs, runStatus, scenario, blocked, opening = false, onPickRun }: Omit<TopBarProps, "where"> & { view: RunView }) {
  // the run that is open is an option from the first paint, before the list of runs has arrived
  const options = runId === null || runs.some((run) => run.id === runId) ? runs : [{ id: runId }, ...runs];
  const { shown, more } = runViewsShown(view);
  return (
    <div className="subnav">
      {runId !== null && (
        <select value={runId} onChange={(event) => onPickRun(event.target.value)} aria-label="Run">
          {options.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id}
            </option>
          ))}
        </select>
      )}
      <nav className="tabs" aria-label="Views of this run">
        {shown.map((name) => (
          <RunTab key={name} name={name} view={view} runId={runId} blocked={blocked} />
        ))}
        {more.length > 0 && (
          <Details menu id="views" summary="More views" hint={blocked > 0 && more.includes("security") ? <span className="tab__count">{blocked}</span> : undefined}>
            {more.map((name) => (
              <RunTab key={name} name={name} view={view} runId={runId} blocked={blocked} />
            ))}
          </Details>
        )}
      </nav>
      <div className="subnav__context">
        {scenario && <span className="mono muted">{scenario.split(":").at(-1)}</span>}
        {(runStatus !== null || opening) && <StatusBadge status={runStatus} />}
      </div>
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
export function TopBar({ where, guide, ...run }: TopBarProps) {
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
          {guide && <GuideButton guide={guide} />}
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
