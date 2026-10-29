// The arena's shared timeline: one lane per side, on the same time axis. A lane draws the whole run
// (the timeline shows the future too, as the run page's does), so it is a pass over the full log:
//
//   bands    each coordinator outage from the failure to its end: a supervisor's crash to its restart,
//            the swarm's kill to its last takeover event (lib/arena.ts decides both). An outage the log
//            never ends runs to the end of the run and is marked open.
//   marks    where a coordinator went down (✕), and where the work came back (the swarm's adoption, a
//            supervisor's restart): the run page's markers, without the ones that are noise at this size.
//
// Bands that overlap would hide each other, so each goes in the first row it fits.

import { foldEvents } from "../lib/reducer";
import { marksOf, type Mark } from "../lib/timeline";
import type { RunEvent } from "../lib/types";

export interface Band {
  coordinator: string;
  since: number;
  until: number;
  /** Who reported it: a chaos kill (the swarm: nobody restarts it, its work is adopted) or a supervisor's crash. */
  source: "chaos" | "supervisor";
  /** The log ends with the coordinator still down. */
  open: boolean;
  /** 0 for the first row of the lane; an outage that overlaps an earlier one goes below it. */
  row: number;
}

export interface Lane {
  end: number;
  bands: Band[];
  /** How many rows the bands take. */
  rows: number;
  marks: Mark[];
}

const KEPT: ReadonlySet<Mark["kind"]> = new Set(["coordinator-kill", "restart", "adopted"]);

/** Give each band the first row in which it overlaps none of the bands already there. */
export function packRows<T extends { since: number; until: number }>(bands: readonly T[]): (T & { row: number })[] {
  const rowEnds: number[] = [];
  return [...bands]
    .sort((a, b) => a.since - b.since || a.until - b.until)
    .map((band) => {
      let row = rowEnds.findIndex((end) => end <= band.since);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = band.until;
      return { ...band, row };
    });
}

const lanes = new WeakMap<readonly RunEvent[], Lane>();

/** The lane of a whole log. Memoized by the array, which the store replaces when events arrive. */
export function laneOf(events: readonly RunEvent[]): Lane {
  const known = lanes.get(events);
  if (known) return known;
  const end = events.at(-1)?.ts_virtual ?? 0;
  const windows = foldEvents(events as RunEvent[]).arena.windows;
  const bands = packRows(
    windows.map((w) => ({
      coordinator: w.coordinator,
      since: w.since,
      until: w.until ?? end,
      source: w.source,
      open: w.until === null,
    })),
  );
  const lane: Lane = {
    end,
    bands,
    rows: bands.reduce((rows, band) => Math.max(rows, band.row + 1), 0),
    marks: marksOf(events as RunEvent[]).filter((mark) => KEPT.has(mark.kind)),
  };
  lanes.set(events, lane);
  return lane;
}

/** The time axis the two lanes share: the end of the longer run. */
export const sharedEnd = (...lanesOf: readonly Pick<Lane, "end">[]): number => Math.max(0, ...lanesOf.map((lane) => lane.end));
