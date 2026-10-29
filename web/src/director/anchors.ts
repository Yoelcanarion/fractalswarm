// What the director reads from the logs it plays: where each crash was and when it ended (the moments a scene
// names, see time.ts), and who a scene means by "the coordinator that crashed first" or "its heir".

import { laneOf } from "../arena/bands";
import { rootOf } from "../arena/board";
import type { ViewState } from "../lib/reducer";
import type { RunEvent } from "../lib/types";

export interface Crash {
  coordinator: string;
  at: number;
  /** When the outage ended: the takeover, the restart, or the end of the run when the log never ends it. */
  until: number;
  source: "chaos" | "supervisor";
}

/** The coordinator outages of a log, in the order they began. */
export function crashesOf(events: readonly RunEvent[]): Crash[] {
  return laneOf(events).bands.map((band) => ({ coordinator: band.coordinator, at: band.since, until: band.until, source: band.source }));
}

export const endOf = (events: readonly RunEvent[]): number => events.at(-1)?.ts_virtual ?? 0;

const nth = <T>(items: readonly T[], index: number): T | undefined => (index > 0 ? items[index - 1] : items[items.length + index]);

const REF = /^\$(crashed|heir):(-?[1-9]\d*)$/;

export interface ActorContext {
  events: readonly RunEvent[];
  view: ViewState;
  crashes: readonly Crash[];
}

/** The actor a scene names: an id as it is; `$root`, whoever holds the root duties at this moment of the replay;
 * `$crashed:N`, the coordinator of the Nth outage; `$heir:N`, the one that took over its work. Null when the run has none. */
export function resolveActor(ref: string, context: ActorContext): string | null {
  if (ref === "$root") return rootOf(context.view);
  const match = REF.exec(ref);
  if (!match) return ref;
  const crash = nth(context.crashes, Number(match[2]));
  if (!crash) return null;
  if (match[1] === "crashed") return crash.coordinator;
  const adopted = context.events.find((event) => event.type === "tree.adopted" && event.payload.dead === crash.coordinator);
  if (!adopted) return null;
  const adopter = adopted.payload.adopter;
  return typeof adopter === "string" ? adopter : adopted.actor;
}

/** An actor and everyone under it in the view, in spawn order. A parent is not always spawned before the actors it
 * adopted, so this goes on until no one else is found. */
export function subtreeOf(view: ViewState, root: string): string[] {
  const inside = new Set<string>([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of view.order) {
      const parent = view.actors[id]?.parent;
      if (!inside.has(id) && parent !== null && parent !== undefined && inside.has(parent)) {
        inside.add(id);
        grew = true;
      }
    }
  }
  return view.order.filter((id) => inside.has(id));
}
