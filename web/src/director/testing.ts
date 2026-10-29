// Helpers for the director's tests: scenes written as plain objects, and a replay and a page that are only fakes, so a
// take runs in vitest without a browser.

import { FRAME_H, FRAME_W, contentRect, type Camera, type Rect, HOME } from "./camera";
import { parseScene, type PanelName, type Scene } from "./script";
import type { ReplayClock, Surface } from "./take";
import type { Target } from "./targets";
import type { TimeContext } from "./time";

/** A scene from a plain object; fails the test with the director's own reason when it is not one. */
export function sceneOf(raw: Record<string, unknown>): Scene {
  const read = parseScene({ id: "test", title: "Test", stage: "arena", duration_ms: 10_000, steps: [], ...raw });
  if (!read.ok) throw new Error(read.reason);
  return read.value;
}

export interface FakeReplay extends ReplayClock {
  log: string[];
  /** Virtual ms the replay moves per fixed step at speed 1. */
  perStep: number;
}

export function fakeReplay(end = 60_000, perStep = 1000 / 60): FakeReplay {
  let t = 0;
  let playing = false;
  let speed = 1;
  const log: string[] = [];
  return {
    log,
    perStep,
    playing: () => playing,
    playhead: () => t,
    speed: () => speed,
    end: () => end,
    seek: (ms) => {
      log.push(`seek ${Math.round(ms)}`);
      t = Math.min(end, Math.max(0, ms));
    },
    setPlaying: (value) => {
      if (value !== playing) log.push(value ? "play" : "pause");
      playing = value;
    },
    setSpeed: (value) => {
      speed = value;
    },
    step: () => {
      t = Math.min(end, t + perStep * speed);
      if (t >= end) playing = false;
    },
  };
}

export interface FakeSurface extends Surface {
  applied: Camera;
  panels: Partial<Record<PanelName, boolean>>;
  opened: (string | null)[];
}

/** A page with a few rectangles in it, keyed by the target's JSON; a target that is not listed is not on the page,
 * unless `anywhere` says where everything else is. */
export function fakeSurface(rects: Record<string, Rect>, context: Partial<TimeContext> = {}, anywhere: Rect | null = null, titles: Record<string, string> | string = {}): FakeSurface {
  const key = (target: Target): string => JSON.stringify(target);
  const surface: FakeSurface = {
    applied: HOME,
    panels: {},
    opened: [],
    contentRect: (target) => rects[key(target)] ?? anywhere,
    bounds: () => ({ w: FRAME_W, h: FRAME_H }),
    titleOf: (target) => (typeof titles === "string" ? titles : titles[key(target)] ?? null),
    screenRect(target) {
      const rect = rects[key(target)] ?? anywhere;
      if (!rect) return null;
      const c = surface.applied;
      return { x: (rect.x - c.x) * c.zoom, y: (rect.y - c.y) * c.zoom, w: rect.w * c.zoom, h: rect.h * c.zoom };
    },
    apply(camera) {
      surface.applied = camera;
    },
    panel(name, show) {
      surface.panels[name] = show;
    },
    lens(call) {
      surface.opened.push(call);
      return call === "missing" ? `call "missing" is not in the run` : null;
    },
    context: () => ({ end: 60_000, crashes: [], calls: new Map(), ...context }),
  };
  return surface;
}

export const target = (value: Record<string, unknown>): string => JSON.stringify(parseTarget(value));

/** A target as the scene's JSON writes it, in the form the take keys it by. */
function parseTarget(value: Record<string, unknown>): Target {
  const read = parseScene({
    id: "t",
    title: "t",
    stage: "arena",
    duration_ms: 1000,
    steps: [{ do: "highlight", target: value, ms: 200 }],
  });
  if (!read.ok) throw new Error(read.reason);
  const step = read.value.steps[0];
  if (step.do !== "highlight") throw new Error("not a highlight");
  return step.target;
}

export { FRAME_H, FRAME_W, contentRect };
