// The one line a run page opens with: what state the run is in, said in words, and what has happened by the playhead. Pure: the same view
// and the same facts always say the same thing. Only what the log holds is stated, and no comparison.

import type { RunStatus } from "./controls";
import { isInfraKind, isLeafKind } from "./layout";
import { rootProposal, tracksOf } from "./plan";
import type { ViewState } from "./reducer";

/** What the page knows about the run apart from its view. */
export interface StateFacts {
  /** The run is being written now. */
  live: boolean;
  /** A recording is playing; false when it is stopped. */
  playing: boolean;
  /** Events in view, and in the log. */
  cursor: number;
  total: number;
  /** What the catalogue says became of the run, when it says. */
  status: RunStatus | null;
  /** The log's last virtual time, in ms. */
  endMs: number;
  /** The replay matched the log, and the bundle's head. */
  verified: boolean;
}

export type StateTone = "live" | "good" | "warn" | "muted";

export interface StateLine {
  /** What state the run is in: "Finished", "Replaying". */
  headline: string;
  tone: StateTone;
  /** What has happened, as a clause: "48 of 48 talks placed, 5 coordinators crashed, replay verified". */
  rest: string;
}

/** The brains that were killed or declared dead by the playhead. */
export const crashedCoordinators = (view: ViewState): number =>
  view.order.filter((id) => {
    const actor = view.actors[id];
    return !isInfraKind(actor.kind) && !isLeafKind(actor.kind) && (actor.status === "killed" || actor.status === "dead");
  }).length;

/** Talks placed by the playhead, and how many the plan holds when it says. */
export function talksOf(view: ViewState): { placed: number; expected: number | null } {
  const proposal = rootProposal(view.panels.plan);
  const planned = proposal === null ? 0 : new Set(tracksOf(proposal.plan).flatMap((track) => track.talks)).size;
  return { placed: Object.keys(view.schedule.cells).length, expected: planned > 0 ? planned : null };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export function stateLine(view: ViewState, facts: StateFacts): StateLine {
  const atEnd = facts.total > 0 && facts.cursor >= facts.total;
  const crashed = crashedCoordinators(view);
  const { placed, expected } = talksOf(view);
  const talks = expected !== null ? `${placed} of ${expected} talks placed` : placed > 0 ? `${plural(placed, "talk", "talks")} placed` : null;

  if (!facts.live && facts.cursor === 0) {
    return { headline: "At the start:", tone: "muted", rest: "nothing has happened yet" };
  }

  // what is in view is all there will be: a recording at its end, not a run still being written
  const settled = atEnd && !facts.live;
  const clauses: string[] = [];
  if (!facts.live && !atEnd) clauses.push(`at ${seconds(view.lastTs)} of ${seconds(facts.endMs)}`);
  if (talks !== null) clauses.push(talks);
  // "so far" says the count can still change; a finished run's count is the run's
  if (crashed > 0) clauses.push(`${plural(crashed, "coordinator", "coordinators")} crashed${settled ? "" : " so far"}`);
  else if (settled) clauses.push("no coordinator crashed");
  if (settled && facts.verified) clauses.push("replay verified");
  const rest = clauses.join(", ") || "waiting for the first actor";

  if (facts.live) return { headline: "Running:", tone: "live", rest };
  if (!atEnd) return facts.playing ? { headline: "Replaying:", tone: "live", rest } : { headline: "Paused:", tone: "muted", rest };
  const finished = facts.status === "completed" || (facts.status === null && view.completed) || (facts.status === "running" && view.completed);
  if (finished) return { headline: "Finished:", tone: "good", rest };
  if (facts.status === "halted") return { headline: "Halted:", tone: "warn", rest };
  if (facts.status === "interrupted") return { headline: "Interrupted:", tone: "warn", rest };
  return { headline: view.completed ? "Finished:" : "Ended without finishing:", tone: view.completed ? "good" : "warn", rest };
}
