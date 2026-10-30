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
 * bare address with nothing open, the first run once the list arrives. Null when there is nothing to wait for. The bare address leaves a
 * run that is already open alone. */
export function openingRun({ runId, named, runs, runsLoaded }: OpeningState): Opening | null {
  if (named !== null) return named === runId ? null : { kind: "run", id: named };
  if (runId !== null) return null;
  if (!runsLoaded) return { kind: "list" };
  return runs.length > 0 ? { kind: "run", id: runs[0].id } : null;
}

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener("hashchange", notify);
  return () => window.removeEventListener("hashchange", notify);
};

/** The run the address names now, following the address as it changes. */
export function useAddressedRun(): string | null {
  return namedRunId(useSyncExternalStore(subscribe, () => window.location.hash, () => ""));
}
