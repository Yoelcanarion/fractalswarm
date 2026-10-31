// The motion of the orchestrator tree: nodes glide to their new places when the layout changes,
// and the camera follows when the structure does.
//
//   - Glide. React Flow gets a new `position` for every moving node on every frame, so it
//     recomputes the edges and they stay attached (a CSS transition on the node would move the
//     box and leave the edge behind). The tween is lib/glide.ts; this hook drives it.
//   - Camera. It re-fits only when a node arrives, leaves or is adopted (`structure`), never on
//     an event that leaves the shape alone, and eases on the same curve as the nodes. It fits
//     the layout's own bounds, not the nodes' current ones, so it lands where they will.
//   - Jumps. After a seek (`epoch` changed), under reduced motion, and for the first layout
//     there is nothing to glide across: everything is drawn at its place at once.
//
// Time comes from `clock.motion()`: the real clock, or in fixed-step mode a frame count, so a
// director take repeats exactly.

import { getViewportForBounds, useReactFlow, useStore, useStoreApi, type Node, type ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";

import { createGlide, type Glide, type Point } from "../lib/glide";
import { ACROSS, type Bounds } from "../lib/layout";
import { EASE_OUT, GLIDE_MS, prefersReducedMotion } from "../lib/motion";
import { useRunStore } from "../store";

// How the camera frames the tree: as large as the pane allows, so that the labels can be read, with a margin round it. The cards are
// small (lib/layout.ts), so a tree of a dozen agents is zoomed in to fill a page's width.
export const FIT_PADDING = "24px";
export const FIT_MAX_ZOOM = 1.5;
// A tree on its side (a phone) is drawn at a scale of one, in the pixels its ids are sized in: it is never zoomed in, and its margin is small.
export const FIT_MAX_ZOOM_ACROSS = 1;
const FIT_RETRIES = 30; // frames to wait for React Flow to measure its pane

export interface TreeShape {
  /** The node each one hangs from. A node that appears starts on its parent. */
  parents: ReadonlyMap<string, string | null>;
  bounds: Bounds | null;
  /** Changes when a node arrives, leaves or is adopted (see ``structureKey``). */
  structure: string;
  /** The tree is on its side, as on a phone (``ACROSS``). */
  across: boolean;
}

export interface TreeMotion<N extends Node> {
  /** The nodes with `position` set to where each is drawn right now. The same array when
   * nothing is moving, so a quiet tree costs nothing. */
  nodes: N[];
  /** Pass to `<ReactFlow onInit>`: frames the first layout (the element must not set `fitView`). */
  onInit: () => void;
}

type FlowStore = ReturnType<typeof useStoreApi>;

/** Move the camera to show ``bounds()``. The pane may not have a size yet on the first call, so
 * ask again for a few frames. */
function fitCamera(flow: ReactFlowInstance, store: FlowStore, shape: () => TreeShape, duration: number, attempt = 0): void {
  const { bounds: area, across } = shape();
  if (!area) return;
  const { width, height, minZoom } = store.getState();
  if (width <= 0 || height <= 0) {
    if (attempt < FIT_RETRIES) requestAnimationFrame(() => fitCamera(flow, store, shape, duration, attempt + 1));
    return;
  }
  const viewport = getViewportForBounds(area, width, height, minZoom, across ? FIT_MAX_ZOOM_ACROSS : FIT_MAX_ZOOM, across ? `${ACROSS.pad}px` : FIT_PADDING);
  void flow.setViewport(viewport, { duration, ease: EASE_OUT, interpolate: "linear" });
}

export function useTreeMotion<N extends Node>(nodes: N[], shape: TreeShape): TreeMotion<N> {
  const clock = useRunStore((s) => s.clock);
  const epoch = useRunStore((s) => s.epoch);
  const flow = useReactFlow();
  const flowStore = useStoreApi();
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  // The latest values, for animation frames and for onInit, which outlive the render they were
  // made in.
  const latest = useRef({ clock, shape, flow, flowStore });
  latest.current = { clock, shape, flow, flowStore };

  const glide = useRef<Glide | null>(null);
  glide.current ??= createGlide(GLIDE_MS, EASE_OUT);
  const drawnAt = useRef(0); // the animation time of the frame drawn last
  const frame = useRef<number | null>(null);
  const seenEpoch = useRef(epoch);
  const seenStructure = useRef<string | null>(null);
  const first = useRef(true);
  const ready = useRef(false); // set by onInit

  const moveCamera = useCallback((duration: number) => {
    const { flow, flowStore } = latest.current;
    fitCamera(flow, flowStore, () => latest.current.shape, duration);
  }, []);

  const onInit = useCallback(() => {
    ready.current = true;
    seenStructure.current = latest.current.shape.structure;
    moveCamera(0);
  }, [moveCamera]);

  // The pane changed size (the window was resized, a fold opened above or below): the tree is framed again, so it still fills it.
  const size = useStore((s) => `${s.width}x${s.height}`);
  useEffect(() => {
    if (ready.current) moveCamera(0);
  }, [size, moveCamera]);

  const tick = useCallback(() => {
    frame.current = null;
    const now = latest.current.clock.motion();
    if (now !== drawnAt.current) {
      drawnAt.current = now;
      redraw();
    }
    // In fixed-step mode the time stands still while the clock is paused: keep asking.
    if (glide.current!.moving(now)) frame.current = requestAnimationFrame(tick);
  }, []);

  // Aim again only when a node's place changed: events that leave the layout alone re-render the
  // tree but must not touch the glide.
  const places = nodes.map((n) => `${n.id}:${n.position.x}:${n.position.y}`).join("|");

  useLayoutEffect(() => {
    const g = glide.current!;
    const now = clock.motion();
    const jumped = first.current || epoch !== seenEpoch.current || prefersReducedMotion();
    first.current = false;
    seenEpoch.current = epoch;

    g.aim(new Map(nodes.map((n) => [n.id, n.position as Point])), now, { snap: jumped, origin: (id) => shape.parents.get(id) });
    drawnAt.current = now;

    if (ready.current && seenStructure.current !== shape.structure) moveCamera(jumped ? 0 : GLIDE_MS);
    seenStructure.current = shape.structure;

    redraw();
    if (frame.current === null && g.moving(now)) frame.current = requestAnimationFrame(tick);
    // The effect is about changes: `places` and `shape.structure` stand for `nodes` and `shape`.
  }, [places, shape.structure, epoch, clock, moveCamera, tick]);

  useLayoutEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  const g = glide.current;
  if (!g.moving(drawnAt.current)) return { nodes, onInit };
  const drawn = g.at(drawnAt.current);
  return {
    nodes: nodes.map((n) => {
      const at = drawn.get(n.id);
      return at && (at.x !== n.position.x || at.y !== n.position.y) ? { ...n, position: at } : n;
    }),
    onInit,
  };
}
