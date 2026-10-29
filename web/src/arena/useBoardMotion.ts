// The motion of a board: when the layout changes (a node arrives, a subtree is adopted, siblings
// re-centre) every node glides to its new place, on the tree's own curve (lib/glide.ts, EASE_OUT).
// It is the same machinery as the orchestrator tree's (components/useTreeMotion.ts), for plain SVG.
//
// Time is `clock.motion()`: the real clock, or in fixed-step mode a count of frames, so a director's
// take repeats exactly. After a seek (the store's `epoch` changed), under reduced motion, and for the
// first layout there is nothing to glide across: every node is drawn at its place at once.

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";

import { createGlide, type Glide, type Point } from "../lib/glide";
import { EASE_OUT, GLIDE_MS, prefersReducedMotion } from "../lib/motion";
import { useRunStore } from "../store";
import type { BoardLayout } from "./board";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Where each node of ``layout`` is drawn right now. The layout's own places when nothing is moving. */
export function useBoardPlaces(layout: BoardLayout): ReadonlyMap<string, Point> {
  const clock = useRunStore((s) => s.clock);
  const epoch = useRunStore((s) => s.epoch);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const glide = useRef<Glide | null>(null);
  glide.current ??= createGlide(GLIDE_MS, EASE_OUT);
  const drawnAt = useRef(0);
  const frame = useRef<number | null>(null);
  const seenEpoch = useRef(epoch);
  const first = useRef(true);
  const latest = useRef({ clock });
  latest.current = { clock };

  const targets = useMemo(() => new Map(layout.nodes.map((n): [string, Point] => [n.id, { x: n.x, y: n.y }])), [layout]);
  const parents = useMemo(() => new Map(layout.nodes.map((n): [string, string | null] => [n.id, n.parent])), [layout]);
  // Aim again only when a place changed: an event that leaves the layout alone must not touch the glide.
  const places = layout.nodes.map((n) => `${n.id}:${n.x}:${n.y}`).join("|");

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

  useIsoLayoutEffect(() => {
    const g = glide.current!;
    const now = clock.motion();
    const jumped = first.current || epoch !== seenEpoch.current || prefersReducedMotion();
    first.current = false;
    seenEpoch.current = epoch;
    g.aim(targets, now, { snap: jumped, origin: (id) => parents.get(id) });
    drawnAt.current = now;
    redraw();
    if (frame.current === null && g.moving(now)) frame.current = requestAnimationFrame(tick);
    // About changes: `places` stands for `targets` and `parents`.
  }, [places, epoch, clock, tick]);

  useIsoLayoutEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  const g = glide.current;
  return g.moving(drawnAt.current) ? g.at(drawnAt.current) : targets;
}
