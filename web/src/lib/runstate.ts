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

const isBrain = (view: ViewState, id: string): boolean => {
  const actor = view.actors[id];
  return actor === undefined || (!isInfraKind(actor.kind) && !isLeafKind(actor.kind));
};

/** The coordinators that crashed by the playhead: the larger of three counts. The brains that are down now (killed, or declared dead: a swarm's
 * false deaths are in this one only); the coordinator kills injected so far, which a restart does not undo (a rival's supervisor is up again
 * after each, and a count of the ones down would forget it, and fall back between crashes); and the supervisor's crashes in the log. */
export function crashedCoordinators(view: ViewState): number {
  const down = view.order.filter((id) => isBrain(view, id) && (view.actors[id].status === "killed" || view.actors[id].status === "dead")).length;
  const struck = view.chaos
    .filter((fault) => fault.kind === "kill_coordinator")
    .reduce((n, fault) => n + (fault.targets.length === 0 ? 1 : fault.targets.filter((id) => isBrain(view, id)).length), 0);
  return Math.max(down, struck, view.supervision.crashes.length);
}

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
  const unplaced = expected === null ? 0 : Math.max(0, expected - placed);
  const violations = view.schedule.hardViolations ?? 0;

  if (!facts.live && facts.cursor === 0) {
    return { headline: "At the start:", tone: "muted", rest: "nothing has happened yet" };
  }

  // what is in view is all there will be: a recording at its end, not a run still being written
  const settled = atEnd && !facts.live;
  const clauses: string[] = [];
  if (!facts.live && !atEnd) clauses.push(`at ${seconds(view.lastTs)} of ${seconds(facts.endMs)}`);
  if (talks !== null) clauses.push(talks);
  // a result that is short or broken says so in words, and its dot is not green; a count still on its way is not a result
  if (settled && unplaced > 0) clauses.push(`${unplaced} unplaced`);
  if (settled && violations > 0) clauses.push(plural(violations, "hard violation", "hard violations"));
  // "so far" says the count can still change; a finished run's count is the run's
  // a rival's coordinator is its supervisor, which comes back after each crash: the arena's end card says it the same way
  const supervised = view.supervision.crashes.length > 0;
  if (crashed > 0) clauses.push(`${supervised ? `its supervisor crashed ${plural(crashed, "time", "times")}` : `${plural(crashed, "coordinator", "coordinators")} crashed`}${settled ? "" : " so far"}`);
  else if (settled) clauses.push("no coordinator crashed");
  if (settled && facts.verified) clauses.push("replay verified");
  const rest = clauses.join(", ") || "waiting for the first actor";

  if (facts.live) return { headline: "Running:", tone: "live", rest };
  if (!atEnd) return facts.playing ? { headline: "Replaying:", tone: "live", rest } : { headline: "Paused:", tone: "muted", rest };
  const finished = facts.status === "completed" || (facts.status === null && view.completed) || (facts.status === "running" && view.completed);
  const flawed = unplaced > 0 || violations > 0;
  if (finished) return { headline: "Finished:", tone: flawed ? "warn" : "good", rest };
  if (facts.status === "halted") return { headline: "Halted:", tone: "warn", rest };
  if (facts.status === "interrupted") return { headline: "Interrupted:", tone: "warn", rest };
  return { headline: view.completed ? "Finished:" : "Ended without finishing:", tone: view.completed && !flawed ? "good" : "warn", rest };
}
