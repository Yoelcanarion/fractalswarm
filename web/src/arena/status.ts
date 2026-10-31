// What a side says about itself at the playhead, in one line: who is down, and what it is costing.
// The two systems fail differently and the line says so in their own terms:
//
//   swarm   a coordinator is killed, nobody restarts it: the detector suspects it, declares it dead, and a
//           neighbour adopts its subtree. The line follows that.
//   rival   the supervisor is down until it is restarted; its workers wait for it (or, for an in-process
//           supervisor, are gone with it).
//
// It says what the log shows and no more: a number is the one the counters hold at this moment.

import { ADOPTION_LIFE_MS } from "../lib/decay";
import type { OutageWindow } from "../lib/arena";
import type { ViewState } from "../lib/reducer";
import { outagesNow, headcount } from "./board";
import type { SystemKind } from "./assumptions";

export type StatusTone = "ok" | "danger" | "warn" | "muted";

export interface SideStatus {
  tone: StatusTone;
  /** The line. */
  text: string;
  /** A restart under way: how far, 0 to 1. Null when nothing is restarting. */
  restart: number | null;
}

const seconds = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The coordinator that took over for ``dead``, from the adoption the log shows. */
function adopterOf(view: ViewState, dead: string): { adopter: string; ts: number } | null {
  let found: { adopter: string; ts: number } | null = null;
  for (const id of view.order) {
    const actor = view.actors[id];
    if (actor.adoptedBy === undefined || actor.originalParent !== dead) continue;
    if (found === null || (actor.adoptedTs ?? 0) > found.ts) found = { adopter: actor.adoptedBy, ts: actor.adoptedTs ?? 0 };
  }
  return found;
}

/** How a run that has played out ended, in the words of its kind of system. Its board still shows what failed, so the line must not say that
 * nothing is down, or that the supervisor is up, over crosses it has just drawn. */
function endStatus(system: SystemKind, view: ViewState, crashes: number): SideStatus {
  const done = view.completed;
  const what =
    system === "swarm"
      ? crashes === 0
        ? "no coordinator lost"
        : `lost ${plural(crashes, "coordinator")}`
      : crashes === 0
        ? "the supervisor never crashed"
        : `supervisor crashed ${plural(crashes, "time")}`;
  return { tone: done ? "ok" : "danger", text: `${done ? "Finished" : "Did not finish"}, ${what}`, restart: null };
}

/** ``finished``: the replay has played the run to its last event. An outage the log never closed is still said, before anything else. */
export function sideStatus(system: SystemKind, view: ViewState, windows: readonly OutageWindow[], nowMs: number, finished = false): SideStatus {
  if (!view.started) return { tone: "muted", text: "Waiting for the run", restart: null };
  const open = windows.filter((w) => w.until === null);
  const now = outagesNow(view, open);

  if (system === "swarm") {
    if (open.length > 0) {
      const ids = open.map((w) => w.coordinator).join(", ");
      const suspected = open.some((w) => view.actors[w.coordinator]?.suspected);
      const longest = Math.max(...open.map((w) => nowMs - w.since));
      return { tone: "danger", text: `${ids} down for ${seconds(longest)} · ${suspected ? "suspected, confirming" : "not noticed yet"}`, restart: null };
    }
    if (finished) return endStatus(system, view, windows.length);
    // The outage ends at the last takeover event, so for a few seconds after it the line still says who took over.
    const lately = windows.filter((w) => w.until !== null && nowMs - w.until < ADOPTION_LIFE_MS);
    if (lately.length > 0) {
      const last = lately[lately.length - 1];
      const heir = adopterOf(view, last.coordinator);
      const took = heir ? `${heir.adopter} took over` : "takeover under way";
      return { tone: "warn", text: `${last.coordinator} was down ${seconds((last.until ?? last.since) - last.since)} · ${took}`, restart: null };
    }
    const { agents } = headcount(view);
    return { tone: "ok", text: `No coordinator down · ${plural(agents, "agent")}`, restart: null };
  }

  if (open.length > 0) {
    const first = now[0];
    const outage = view.actors[first.coordinator]?.outage;
    const waiting = now.reduce((sum, o) => sum + o.idle, 0);
    const stopped = now.reduce((sum, o) => sum + o.stopped, 0);
    const people = stopped > 0 ? `${plural(stopped, "worker")} stopped with it` : `${plural(waiting, "agent")} waiting for it`;
    return {
      tone: "danger",
      text: `${first.coordinator} down for ${seconds(nowMs - first.since)} · ${people}`,
      restart: outage && outage.restartInMs > 0 ? Math.min(1, Math.max(0, (nowMs - outage.sinceTs) / outage.restartInMs)) : null,
    };
  }
  if (finished) return endStatus(system, view, windows.length);
  const lately = windows.filter((w) => w.until !== null && nowMs - w.until < ADOPTION_LIFE_MS);
  if (lately.length > 0) {
    const last = lately[lately.length - 1];
    const crash = view.supervision.crashes.find((c) => c.coordinator === last.coordinator && c.restartedTs === last.until);
    const read = crash?.adopted ? ` · ${plural(crash.adopted.results, "result")} read back from the log` : "";
    return { tone: "warn", text: `${last.coordinator} restarted after ${seconds((last.until ?? last.since) - last.since)}${read}`, restart: null };
  }
  const { agents } = headcount(view);
  return { tone: "ok", text: `Supervisor up · ${plural(agents, "agent")}`, restart: null };
}
