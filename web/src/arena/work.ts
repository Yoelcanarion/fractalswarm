// The work a side has done so far: the talks of the conference placed on its schedule. It is the
// output that matters (a run that finishes has all of them), so a stall shows here as a bar that
// stops growing while the other side's keeps going.

import { asNumber, asRecord } from "../lib/generic";
import type { ViewState } from "../lib/reducer";
import type { RunEvent } from "../lib/types";

export interface Work {
  placed: number;
  /** How many talks the task has; null for a task whose corpus is not a list of talks. */
  total: number | null;
  /** 0 to 1; 0 when the total is not known. */
  share: number;
}

/** The talks the run was given, from run.started's corpus. */
export function talksTotal(started: RunEvent | undefined): number | null {
  const corpus = asRecord(asRecord(started?.payload.params).corpus);
  const talks = corpus.talks;
  if (Array.isArray(talks)) return talks.length;
  return asNumber(talks);
}

export function workOf(view: ViewState, total: number | null): Work {
  const placed = Object.keys(view.schedule.cells).length;
  return { placed, total, share: total !== null && total > 0 ? Math.min(1, placed / total) : 0 };
}
