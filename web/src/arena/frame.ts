// The camera of a board: which part of the drawing the side shows. It is fixed for the whole run, so
// nothing zooms or drifts while the failure plays out, and it is the same size on both sides, so a
// dot is the same number of pixels in the swarm as in its rival (the two panels are the same size).
//
// The frame has to hold every shape the tree takes: a node arrives, a team grows with the agents it
// adopts. So it is the union of the layout's bounds at each structural event of the whole log, found
// by folding only the events that change the structure (a layout reads who exists and who hangs from
// whom, nothing else).

import { emptyView, foldEvent } from "../lib/reducer";
import type { RunEvent } from "../lib/types";
import { boundsOfNodes, layoutBoard, type Box } from "./board";

export const FRAME_PAD = 16;
/** A tree smaller than this is not zoomed past it: one supervisor and a few workers stay a modest cluster. */
export const MIN_FRAME: Pick<Box, "w" | "h"> = { w: 420, h: 220 };

const STRUCTURAL: ReadonlySet<string> = new Set(["actor.spawned", "tree.adopted"]);

const frames = new WeakMap<readonly RunEvent[], Box | null>();

function unionOf(a: Box | null, b: Box | null): Box | null {
  if (a === null || b === null) return a ?? b;
  return boundsOfNodes([a, b]);
}

/** Everything the board of this log ever draws, in the board's own coordinates; null for a log with no actors. */
export function frameOf(events: readonly RunEvent[]): Box | null {
  if (frames.has(events)) return frames.get(events) ?? null;
  let view = emptyView();
  let union: Box | null = null;
  for (const event of events) {
    if (!STRUCTURAL.has(event.type)) continue;
    view = foldEvent(view, event);
    union = unionOf(union, layoutBoard(view).bounds);
  }
  frames.set(events, union);
  return union;
}

/** The viewBox of each side: both as large as the larger of the two drawings (and the minimum), each
 * centred on its own and top-aligned, so the roots of the two sides sit on the same line. */
export function sharedFrames(a: Box | null, b: Box | null): [Box, Box] {
  const w = Math.max(MIN_FRAME.w, (a?.w ?? 0) + 2 * FRAME_PAD, (b?.w ?? 0) + 2 * FRAME_PAD);
  const h = Math.max(MIN_FRAME.h, (a?.h ?? 0) + 2 * FRAME_PAD, (b?.h ?? 0) + 2 * FRAME_PAD);
  const around = (drawing: Box | null): Box => ({ x: (drawing ? drawing.x + drawing.w / 2 : 0) - w / 2, y: (drawing ? drawing.y : 0) - FRAME_PAD, w, h });
  return [around(a), around(b)];
}

/** A frame zoomed on ``target`` by ``zoom`` (1 = the frame as it is), for a director's camera. */
export function zoomed(frame: Box, target: Box, zoom: number): Box {
  const w = frame.w / zoom;
  const h = frame.h / zoom;
  return { x: target.x + target.w / 2 - w / 2, y: target.y + target.h / 2 - h / 2, w, h };
}
