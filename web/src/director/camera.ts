// The camera of a take. The page is laid out once at 1920 x 1080 (the frame); the camera is the part of it the clip
// shows: where its top-left corner is and how far in it looks. It is applied as one CSS transform on the whole stage,
// so it works on an SVG board, a React Flow tree and a plain panel alike.
//
//   screen = (content - camera) * zoom
//
// A move goes from the camera as it is to a new one over some milliseconds of the take, eased. The centre travels in a
// straight line and the zoom changes by a constant factor per millisecond, so a zoom in reads as one steady movement.

import { cubicBezier, EASE_OUT } from "../lib/motion";
import type { Ease } from "./script";

export const FRAME_W = 1920;
export const FRAME_H = 1080;

/** Where the frame sits in a window: scaled to fit, centred, on whole pixels. A window of exactly 1920 x 1080 gets scale 1. */
export function fitFrame(width: number, height: number): { scale: number; left: number; top: number } {
  const scale = Math.max(0.05, Math.min(width / FRAME_W, height / FRAME_H));
  return { scale, left: Math.round((width - FRAME_W * scale) / 2), top: Math.round((height - FRAME_H * scale) / 2) };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Camera {
  /** The top-left corner of the part shown, in the frame's own pixels before any zoom. */
  x: number;
  y: number;
  zoom: number;
}

export const HOME: Camera = { x: 0, y: 0, zoom: 1 };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const centreOf = (camera: Camera): { x: number; y: number } => ({ x: camera.x + FRAME_W / camera.zoom / 2, y: camera.y + FRAME_H / camera.zoom / 2 });

/** The camera that shows ``centre`` in the middle of the frame at ``zoom``. */
export const lookAt = (centre: { x: number; y: number }, zoom: number): Camera => ({ x: centre.x - FRAME_W / zoom / 2, y: centre.y - FRAME_H / zoom / 2, zoom });

/** The camera that fits ``rect`` in the frame with ``pad`` (a share of the rectangle's own size) all round, never past
 * the zoom limits and never narrower than ``minSide`` px, so a single dot does not fill the screen. */
export function fit(rect: Rect, pad: number, minSide = 160): Camera {
  const w = Math.max(rect.w, minSide) * (1 + 2 * pad);
  const h = Math.max(rect.h, minSide) * (1 + 2 * pad);
  const zoom = clamp(Math.min(FRAME_W / w, FRAME_H / h), MIN_ZOOM, MAX_ZOOM);
  return lookAt({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, zoom);
}

/** ``camera`` kept inside a stage of ``stage`` px, so the clip never shows what is beyond its edges. A view larger than
 * the stage (zoomed out past it) is centred on it. */
export function within(camera: Camera, stage: { w: number; h: number }): Camera {
  const w = FRAME_W / camera.zoom;
  const h = FRAME_H / camera.zoom;
  const x = w >= stage.w ? (stage.w - w) / 2 : clamp(camera.x, 0, stage.w - w);
  const y = h >= stage.h ? (stage.h - h) / 2 : clamp(camera.y, 0, stage.h - h);
  return { ...camera, x, y };
}

/** ``camera`` looking at the same centre at an absolute ``zoom``. */
export const zoomedTo = (camera: Camera, zoom: number): Camera => lookAt(centreOf(camera), clamp(zoom, MIN_ZOOM, MAX_ZOOM));

/** ``camera`` shifted by ``by`` frame pixels (what the viewer sees move, whatever the zoom). */
export const panned = (camera: Camera, by: { x: number; y: number }): Camera => ({ ...camera, x: camera.x + by.x / camera.zoom, y: camera.y + by.y / camera.zoom });

export function lerp(from: Camera, to: Camera, progress: number): Camera {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  const zoom = from.zoom * (to.zoom / from.zoom) ** progress;
  const a = centreOf(from);
  const b = centreOf(to);
  return lookAt({ x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress }, zoom);
}

const INOUT = cubicBezier(0.65, 0, 0.35, 1);
const EASINGS: Record<Ease, (t: number) => number> = { linear: (t) => clamp(t, 0, 1), out: EASE_OUT, inout: INOUT };
export const easing = (ease: Ease, t: number): number => EASINGS[ease](t);

export interface Move {
  from: Camera;
  to: Camera;
  /** The take time the move began, in ms. */
  start: number;
  ms: number;
  ease: Ease;
}

/** Where the camera is at take time ``t`` while ``move`` runs (and after it, where it ended). */
export function cameraAt(move: Move, t: number): Camera {
  if (move.ms <= 0) return move.to;
  return lerp(move.from, move.to, easing(move.ease, (t - move.start) / move.ms));
}

export const moveEnded = (move: Move, t: number): boolean => t - move.start >= move.ms;

/** The CSS transform of a camera, on an element whose transform origin is its top-left corner. */
export const transformOf = (camera: Camera): string => `scale(${round(camera.zoom)}) translate(${round(-camera.x)}px, ${round(-camera.y)}px)`;

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/** A rectangle measured on screen, back in the content's own coordinates, given the camera that was applied when it was measured. */
export const contentRect = (screen: Rect, camera: Camera): Rect => ({
  x: screen.x / camera.zoom + camera.x,
  y: screen.y / camera.zoom + camera.y,
  w: screen.w / camera.zoom,
  h: screen.h / camera.zoom,
});

export function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.w);
    bottom = Math.max(bottom, r.y + r.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

// ---- speed ramps ----

export interface Ramp {
  from: number;
  to: number;
  start: number;
  ms: number;
}

/** The replay speed at take time ``t``: eased from one speed to the next, as the camera is. */
export function speedAt(ramp: Ramp, t: number): number {
  if (ramp.ms <= 0) return ramp.to;
  return ramp.from + (ramp.to - ramp.from) * INOUT(clamp((t - ramp.start) / ramp.ms, 0, 1));
}
