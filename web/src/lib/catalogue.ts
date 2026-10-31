// The run catalogue in words. The listing the server sends (`GET api/runs`) has an id, a scenario, a status and counts;
// everything else a person wants to know (what task, which failures, billed or not, what it cost) is in the first and the
// last event of the log, which the page reads lazily. Pure, so it is tested without a browser.

import { systemKind } from "../arena/assumptions";
import { verifiedAtBuild } from "../static/BuildVerified";
import { FINAL_RUN } from "./address";
import { asRunStatus, type RunStatus } from "./controls";
import { profileTerm, type TermId } from "./glossary";
import { workflowLabel } from "./hero";
import type { RunEvent, RunListing, VerifyReport } from "./types";

// ---- state: live, recorded and stopped runs are different things ----

export type RunState = "live" | "recorded" | "halted" | "interrupted" | "empty";

const STATE_OF: Record<RunStatus, RunState> = {
  running: "live",
  completed: "recorded",
  halted: "halted",
  interrupted: "interrupted",
  empty: "empty",
};

/** The words for each state. "Recorded" is a finished run you replay; "Live" is one that is still being written. */
export const STATES: Record<RunState, { label: string; says: string }> = {
  live: { label: "Live", says: "Recording now. Open it to watch the run as it happens." },
  recorded: { label: "Recorded", says: "A finished run. Open it to replay its log." },
  halted: { label: "Halted", says: "Stopped by the kill switch. The run recorded its halt and ended." },
  interrupted: { label: "Interrupted", says: "The log stops before the run completed, and nothing is recording it any more." },
  empty: { label: "Empty", says: "The run has no events yet." },
};

export const STATE_ORDER: readonly RunState[] = ["live", "recorded", "halted", "interrupted", "empty"];

/** A status the server sent that this page does not know is shown as a recorded run: it has a log to open. */
export const stateOf = (status: string | null): RunState => STATE_OF[asRunStatus(status) ?? "completed"];

// ---- workflow: which system recorded it ----

const pretty = (attr: string) => {
  const words = attr.toLowerCase().replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
};

/** The workflow of a run from its scenario ("fractalswarm.actors.swarm:CENTRAL"), in the words of the charts and the arena. */
export function workflowOf(scenario: string | null): { id: string; label: string } {
  const attr = (scenario ?? "").split(":").at(-1) ?? "";
  if (attr === "TOY") return { id: "toy", label: "Toy demo" };
  const kind = systemKind(scenario);
  if (kind === "other") return { id: attr.toLowerCase() || "unknown", label: pretty(attr) };
  return { id: kind, label: workflowLabel(kind) };
}

// ---- facts from the log ----

export interface RunFacts {
  /** "t2_conference"; null for a run with no task (the toy). */
  task: string | null;
  /** The chaos plan's name: "C3", "half-the-brains". */
  profile: string | null;
  /** Coordinator kills the plan lists, when it lists its actions. */
  kills: number | null;
  /** True: the run made billed calls (it reserved against the project ledger). False: a fake model. Null: not recorded. */
  billed: boolean | null;
  clock: "live" | "sim" | null;
  capUsd: number | null;
  /** What the run spent, from its `run.completed`; null while it is live or if it never completed. */
  spentUsd: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const amount = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function readFacts(first: RunEvent | null | undefined, last: RunEvent | null | undefined): RunFacts {
  const started = first?.type === "run.started" ? first.payload : {};
  const params = isRecord(started.params) ? started.params : {};
  const spec = isRecord(params.spec) ? params.spec : {};
  const chaos = isRecord(params.chaos) ? params.chaos : null;
  const actions = chaos && Array.isArray(chaos.actions) ? chaos.actions : null;
  return {
    task: text(spec.task),
    profile: chaos ? text(chaos.profile) : null,
    kills: actions ? actions.filter((a) => isRecord(a) && a.kind === "kill_coordinator").length : null,
    // Only a billed run has a project ledger, so only a billed run records what was left of the project's budget.
    billed: "project_remaining_usd" in started ? started.project_remaining_usd !== null : null,
    clock: started.clock === "live" || started.clock === "sim" ? started.clock : null,
    capUsd: amount(started.run_cap_usd),
    spentUsd: last?.type === "run.completed" ? amount(last.payload.spent_usd) : null,
  };
}

/** The coordinator kills each named profile makes (bench/profiles.py). */
const KILLS: Record<string, number> = { C0: 0, C1: 1, C2: 3, C3: 5 };

export interface ChaosWords {
  /** The glossary entry that defines the profile, when it is one of C0 to C3. */
  term: TermId | null;
  label: string;
  /** "5 coordinators killed". */
  killed: string | null;
}

const killedText = (n: number) => `${n === 0 ? "no" : n} coordinator${n === 1 ? "" : "s"} killed`;

/** What failures a run was recorded with, or null when its log names no plan. */
export function chaosWords(facts: RunFacts): ChaosWords | null {
  const term = profileTerm(facts.profile);
  if (term) return { term, label: term.toUpperCase(), killed: killedText(KILLS[term.toUpperCase()]) };
  if (facts.kills !== null && facts.kills > 0) return { term: null, label: facts.profile ?? "Custom plan", killed: killedText(facts.kills) };
  return facts.profile ? { term: null, label: facts.profile, killed: null } : null;
}

// ---- the table: rows, filter, sort ----

export interface CatalogueRow {
  listing: RunListing;
  /** Where the server listed it: runs come newest first, so this is the order of recency. */
  index: number;
  state: RunState;
  workflow: { id: string; label: string };
  /** Null until the first and last event have been read. */
  facts: RunFacts | null;
}

/** How many runs the Runs page opens with on a server, whose list grows with every run it records. The static site holds the few it was
 * built with, and lists all of them. */
export const FEATURED_RUNS = 4;

/** The runs a page that cannot list them all opens with: the final run, then the other finished runs in the server's order (newest
 * first). A live run has its own strip and an empty one has nothing to open. */
export function featuredRows(rows: readonly CatalogueRow[], limit = FEATURED_RUNS): CatalogueRow[] {
  const finished = rows.filter((row) => row.state !== "live" && row.state !== "empty");
  return [...finished.filter((row) => row.listing.id === FINAL_RUN), ...finished.filter((row) => row.listing.id !== FINAL_RUN)].slice(0, limit);
}

/** The runs of this server, newest first: what came of a person's own text or task, which the runs to start with would not show. A reading of a
 * text is not one of them: it places no talk. */
export function yourRows(rows: readonly CatalogueRow[], limit = FEATURED_RUNS): CatalogueRow[] {
  return rows.filter((row) => row.listing.source !== "demo" && row.workflow.id !== "intake" && row.state !== "empty").slice(0, limit);
}

export const rowOf = (listing: RunListing, facts: RunFacts | null = null, index = 0): CatalogueRow => ({
  listing,
  index,
  state: stateOf(listing.status),
  workflow: workflowOf(listing.scenario),
  facts,
});

export interface Filter {
  query: string;
  state: RunState | "all";
  workflow: string;
}

export const NO_FILTER: Filter = { query: "", state: "all", workflow: "all" };

/** The words a search looks in: the id, the workflow, the task and the failure plan. */
function haystack(row: CatalogueRow): string {
  const chaos = row.facts ? chaosWords(row.facts) : null;
  return [row.listing.id, row.workflow.label, row.facts?.task, chaos?.label, chaos?.killed, STATES[row.state].label].filter(Boolean).join(" ").toLowerCase();
}

export function filterRows(rows: readonly CatalogueRow[], filter: Filter): CatalogueRow[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.state !== "all" && row.state !== filter.state) return false;
    if (filter.workflow !== "all" && row.workflow.id !== filter.workflow) return false;
    const hay = haystack(row);
    return words.every((word) => hay.includes(word));
  });
}

export type SortKey = "listed" | "run" | "workflow" | "state" | "events" | "duration" | "spent";
export type SortDir = "asc" | "desc";

const compareText = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

function compareBy(key: SortKey, a: CatalogueRow, b: CatalogueRow): number {
  switch (key) {
    case "listed":
      return a.index - b.index;
    case "run":
      return compareText(a.listing.id, b.listing.id);
    case "workflow":
      return compareText(a.workflow.label, b.workflow.label);
    case "state":
      return STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
    case "events":
      return a.listing.events - b.listing.events;
    case "duration":
      return a.listing.duration_ms - b.listing.duration_ms;
    case "spent":
      // A run that has not said what it spent goes last whichever way the column is sorted.
      return (a.facts?.spentUsd ?? Number.POSITIVE_INFINITY) - (b.facts?.spentUsd ?? Number.POSITIVE_INFINITY);
  }
}

/** Sorted by one column, with the server's order and then the id to break ties, so the order never jumps between renders. */
export function sortRows(rows: readonly CatalogueRow[], key: SortKey, dir: SortDir): CatalogueRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "spent") {
      const missing = Number(a.facts?.spentUsd == null) - Number(b.facts?.spentUsd == null);
      if (missing !== 0) return missing;
    }
    return sign * compareBy(key, a, b) || a.index - b.index || compareText(a.listing.id, b.listing.id);
  });
}

/** "2 live · 12 recorded · 1 interrupted": the states that have a run, in the order of STATE_ORDER. */
export function summarize(rows: readonly CatalogueRow[]): string {
  return STATE_ORDER.map((state) => [state, rows.filter((row) => row.state === state).length] as const)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${STATES[state].label.toLowerCase()}`)
    .join(" · ");
}

/** The workflows in a set of rows, for the filter: the ones that are there, most used first. */
export function workflowsIn(rows: readonly CatalogueRow[]): { id: string; label: string; count: number }[] {
  const seen = new Map<string, { id: string; label: string; count: number }>();
  for (const row of rows) {
    const entry = seen.get(row.workflow.id) ?? { ...row.workflow, count: 0 };
    entry.count += 1;
    seen.set(row.workflow.id, entry);
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || compareText(a.label, b.label));
}

// ---- billing ----

/** What a log says about billing, in words. A run that makes real calls reserves against the project budget, and its start
 * records what was left of it; a run on the fake model records none (src/fractalswarm/cli.py), so what such a run "spent"
 * is notional. The page names what the log records and goes no further than that. */
export const BILLING = {
  billed: {
    label: "Billed",
    says: "This run reserved its spend against the project budget, as every call to the real model does.",
  },
  notBilled: {
    label: "Not billed",
    says: "This run recorded no project budget, which is how a run on the free practice model is recorded. The spend shown is notional.",
  },
  unknown: {
    label: "Not recorded",
    says: "This log does not say whether the run was billed.",
  },
} as const;

// ---- numbers and verdicts ----

/** A run's length: "4.0 s", "3 min 19 s", "1 h 02 min". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 60) return `${tenths.toFixed(1)} s`;
  const whole = Math.round(ms / 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min ${whole % 60} s`;
}

/** Where a run's replay check stands. The check re-runs the whole run, so it happens when asked for. */
export type VerifyView =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "error"; error: string }
  | { state: "done"; report: VerifyReport };

export interface VerifyWords {
  label: string;
  tone: "plain" | "good" | "bad" | "warn";
  detail: string;
  /** A second verdict beside the first. */
  also?: { label: string; detail: string };
}

/** A replay that does not match while the log's own hash chain holds is not a broken log: this code does not reproduce that recording
 * (the chain is intact, so what was recorded is what is there). The words say exactly that and no more: whether the recording came from an
 * older version is not something the check can know. */
export const notReproduced = (report: VerifyReport): boolean => !report.ok && report.chain_ok;

export const notReproducedWords = (report: VerifyReport): string =>
  `Log intact. This code does not reproduce this recording${report.first_divergence === null ? "" : `: first difference at seq ${report.first_divergence}`}.`;

/** The Runs page's button for every listed run. On the static showcase the browser does the work, and what it does is not a replay. */
export function verifyAllLabel(verifying: boolean, verifiable: number): string {
  const here = import.meta.env.MODE === "static";
  if (verifying) return here ? "Recomputing…" : "Replaying…";
  if (verifiable === 0) return here ? "Nothing to recompute" : "Nothing to verify";
  return here ? `Recompute ${verifiable} log${verifiable === 1 ? "" : "s"} here` : `Verify ${verifiable} listed run${verifiable === 1 ? "" : "s"}`;
}

/** The same verdict the run page gives (components/VerifyBadge.tsx): verified only when the replay and the bundle's head both match. */
export function verifyWords(view: VerifyView): VerifyWords {
  switch (view.state) {
    case "idle":
      return { label: "Not checked", tone: "plain", detail: "" };
    case "pending":
      if (import.meta.env.MODE === "static") return { label: "Recomputing…", tone: "plain", detail: "Your browser is recomputing every hash of the log." };
      return { label: "Replaying…", tone: "plain", detail: "Re-running the run from its log." };
    case "error":
      return { label: "Could not check", tone: "warn", detail: view.error };
    case "done": {
      const { report } = view;
      if (report.ok && report.bundle_head_ok) {
        // The static showcase has no server to replay on: its report was made when the site was built (static/BuildVerified.tsx).
        if (import.meta.env.MODE === "static") return { tone: "good", ...verifiedAtBuild(report) };
        return {
          label: "Replay verified",
          tone: "good",
          detail: `${report.replayed_events} events re-run from run.started; recorded and replayed head ${report.replayed_head.slice(0, 12)}.`,
        };
      }
      if (notReproduced(report)) return { label: notReproducedWords(report), tone: "warn", detail: report.detail };
      return { label: `Replay mismatch at seq ${report.first_divergence ?? "?"}`, tone: "bad", detail: report.detail };
    }
  }
}
