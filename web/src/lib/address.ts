// What the address asks the run pages for. The store opens a run in an effect, after the page's first paint, so for that one frame a
// page would say "no run selected" (a first visit to #/run/x) or draw the run that was open before (a switch from the list). The
// pages hold their place with a skeleton instead, and this tells them what they are waiting for. Pure, apart from the one hook.

import { useSyncExternalStore } from "react";

/** The run an address names: `#/run/<id>` and each of its views. The bare `#/run` names none, and the first listed run opens.
 * A malformed escape in the id names none, rather than throwing where the router reads it. */
export function namedRunId(hash: string): string | null {
  const [path = ""] = hash.replace(/^#\/?/, "").split("?");
  const [page, id] = path.split("/");
  if (page !== "run" || !id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

/** The query that opens a recorded run at its end: the whole picture at once, with "Play from the start" one click away. An address
 * without it opens a recorded run at its start, to be replayed; a live run opens at its head either way. */
export const AT_END = "?at=end";

/** The recorded final run: the one the app opens when no run is named, and the one the guide sends a newcomer to. */
export const FINAL_RUN = "demo-final";

/** The run a bare `#/run` opens: the final run, or the first listed one on a server that has none. */
export function defaultRunId(runs: readonly { id: string }[]): string | null {
  return runs.find((run) => run.id === FINAL_RUN)?.id ?? runs[0]?.id ?? null;
}

/** The address of a run opened from a list of runs. */
export const openedRunHash = (id: string): string => `#/run/${encodeURIComponent(id)}${AT_END}`;

/** The address of what a run produced, its Results view at its end, where the final report is. */
export const resultsHash = (id: string): string => `#/run/${encodeURIComponent(id)}/results${AT_END}`;

export type Opening = { kind: "run"; id: string } | { kind: "list" };

export interface OpeningState {
  /** The run the store has open, if any. */
  runId: string | null;
  /** The run the address names, if any. */
  named: string | null;
  runs: readonly { id: string }[];
  /** Whether the list of runs has answered, with a list or with an error. */
  runsLoaded: boolean;
}

/** What the page is about to show when it is not showing a run yet: a run the address names and the store has not opened, or, for a
 * bare address, the final run once the list arrives (a run already open stays on screen until then). Null when there is nothing to
 * wait for. */
export function openingRun({ runId, named, runs, runsLoaded }: OpeningState): Opening | null {
  if (named !== null) return named === runId ? null : { kind: "run", id: named };
  if (!runsLoaded) return runId === null ? { kind: "list" } : null;
  const wanted = defaultRunId(runs);
  return wanted === null || wanted === runId ? null : { kind: "run", id: wanted };
}

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

/** The run the address names now, following the address as it changes. */
export function useAddressedRun(): string | null {
  return namedRunId(useSyncExternalStore(subscribe, () => window.location.hash, () => ""));
}
