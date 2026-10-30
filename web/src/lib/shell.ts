// The shape of the app's top: four places, and under a place the views it has of its own (a run's six, the evidence's
// three). Pure, so the bar and the tab titles are tested without a page; App.tsx parses the hash and says where it is.

import { AT_END } from "./address";

export const RUN_VIEWS = ["overview", "plan", "panels", "security", "results", "events"] as const;
export type RunView = (typeof RUN_VIEWS)[number];

export const RUN_VIEW_TITLES: Record<RunView, string> = {
  overview: "Run",
  plan: "Plan",
  panels: "Panels",
  security: "Security",
  results: "Results",
  events: "Events",
};

export const EVIDENCE_VIEWS = ["charts", "helps", "ablation"] as const;
export type EvidenceView = (typeof EVIDENCE_VIEWS)[number];

export const EVIDENCE_TITLES: Record<EvidenceView, string> = {
  charts: "Charts",
  helps: "Where it helps",
  ablation: "Ablation",
};

export const EVIDENCE_HASHES: Record<EvidenceView, string> = {
  charts: "#/charts",
  helps: "#/helps",
  ablation: "#/ablation",
};

export const isEvidence = (page: string): page is EvidenceView => (EVIDENCE_VIEWS as readonly string[]).includes(page);

export type Place = "arena" | "runs" | "new" | "evidence";

export interface PlaceLink {
  place: Place;
  label: string;
  href: string;
  /** The page the link itself opens: the current place is `aria-current="page"` there, and `"true"` on its other pages. */
  page: Where["page"];
}

export const PLACES: readonly PlaceLink[] = [
  { place: "arena", label: "Arena", href: "#/arena", page: "arena" },
  { place: "runs", label: "Runs", href: "#/runs", page: "runs" },
  { place: "new", label: "New task", href: "#/new", page: "intake" },
  { place: "evidence", label: "Evidence", href: EVIDENCE_HASHES.charts, page: "charts" },
];

/** Where the person is inside the app, as far as the top bar cares: the page and, in a run, which run and which of its views. The home
 * page is not here: home/Root.tsx tells it apart from the app before the app (and its top bar) is loaded. */
export type Where =
  | { page: "arena" }
  | { page: "intake" }
  | { page: "runs" }
  | { page: "run"; runId: string | null; view: RunView }
  | { page: EvidenceView };

/** Which of the four places the person is in. A run is in Runs. */
export function placeOf(where: Where): Place {
  switch (where.page) {
    case "arena":
      return "arena";
    case "intake":
      return "new";
    case "runs":
    case "run":
      return "runs";
    case "charts":
    case "helps":
    case "ablation":
      return "evidence";
  }
}

export const runViewHash = (runId: string | null, view: RunView): string =>
  `#/run/${runId === null ? "" : encodeURIComponent(runId)}${view === "overview" ? "" : `/${view}`}`;

/** The address of another run picked from the run's own page: the view stays, and the run opens at its end like one from the Runs list. */
export const pickedRunHash = (runId: string, view: RunView): string => `${runViewHash(runId, view)}${AT_END}`;

export const SITE_NAME = "FractalSwarm";

/** What the page is called, for a screen reader's announcement and the tab's title: a run's view says which run. The route
 * `#/run/` names none and opens the first listed one, so the open run fills in. */
export function pageName(where: Where, openRunId: string | null): string {
  switch (where.page) {
    case "arena":
      return "Arena";
    case "intake":
      return "New task";
    case "runs":
      return "Runs";
    case "run": {
      const id = where.runId ?? openRunId;
      return id === null ? RUN_VIEW_TITLES[where.view] : `${RUN_VIEW_TITLES[where.view]} · ${id}`;
    }
    case "charts":
    case "helps":
    case "ablation":
      return EVIDENCE_TITLES[where.page];
  }
}

/** The tab's title: the page first, so a row of tabs tells them apart. */
export function pageTitle(where: Where, openRunId: string | null): string {
  return `${pageName(where, openRunId)} · ${SITE_NAME}`;
}
