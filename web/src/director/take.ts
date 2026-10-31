// A take: one scene played from its first frame to its last. Time is a count of frames of 1/60 s (the same step as the
// fixed-step clock, lib/clock.ts), never the wall clock, so the same scene shows the same thing on the same frame
// however the machine behaves, and a recorder that steps a frame at a time gets the clip a real-time one would.
//
// One frame:
//   1. the program runs the steps that are due (seek, play, camera, caption, ...);
//   2. the replay speed follows its ramp, and a replay that is playing moves one fixed step;
//   3. the camera follows its move and is applied to the page;
//   4. the captions are trimmed to the live ones, and each ring is placed on its target where it is now.
//
// The take touches the page only through the `Surface`, and the replay only through the `ReplayClock`, so the whole of
// it runs under vitest with fakes.

import { createStore, type StoreApi } from "zustand/vanilla";

import { FIXED_FRAME_MS } from "../lib/playback";
import { cameraAt, fit, HOME, moveEnded, panned, speedAt, within, zoomedTo, type Camera, type Move, type Ramp, type Rect } from "./camera";
import { addCaption, liveCaptions, liveRings, ringOpacity, tipOpacity, type Caption, type Placed, type PlacedTip, type Ring, type Tip } from "./overlay";
import { createProgram, type Host, type Program } from "./program";
import type { PanelName, Scene, Step } from "./script";
import type { Target } from "./targets";
import { resolveTime, type TimeContext, type TimeExpr } from "./time";

/** What a target gets to be drawn after the step that brings it (a lens that was just opened is in the page a frame or
 * two later): a highlight warns only when its target is still missing once this has passed, or its time is up. */
export const RING_GRACE_MS = 500;

/** How many polls (a tenth of a second each) the page gives the hover text of a tooltip's target to appear before it starts
 * the take without it: a verdict chip has none until its check has come back, which on a long log takes a while. */
export const TIP_WAIT_POLLS = 300;

/** The targets of the scene's tooltips: a take cannot draw one before its target has something to say. */
export const tooltipTargets = (scene: Scene): Target[] => scene.steps.flatMap((step) => (step.do === "tooltip" ? [step.target] : []));

/** The replay the scene plays; absent on stages that have none (the title card, the panels). */
export interface ReplayClock {
  playing(): boolean;
  /** The exact run time in ms. */
  playhead(): number;
  speed(): number;
  /** The last moment of the longest run. */
  end(): number;
  seek(ms: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  /** Move one fixed step (1/60 s of the take, times the speed). */
  step(): void;
}

/** The page the take plays on. */
export interface Surface {
  /** A target in the frame's own coordinates, as it is laid out with no camera; null when it is not on the page. */
  contentRect(target: Target): Rect | null;
  /** A target as it is on screen now, with the camera applied; null when it is not on the page. */
  screenRect(target: Target): Rect | null;
  /** How large the stage is, in the frame's own pixels: what the camera may look at. */
  bounds(): { w: number; h: number };
  /** The hover text the target carries (its `title`, or its first descendant's), as the page words it; null when it has none. */
  titleOf(target: Target): string | null;
  apply(camera: Camera): void;
  panel(name: PanelName, show: boolean): void;
  /** Open a call of the lens by the name the scene gave it, or close it (null). Returns why it could not, or null. */
  lens(call: string | null): string | null;
  /** What a moment of the scene can be resolved against, now. */
  context(): TimeContext;
}

export interface TakeState {
  /** Frames drawn so far: the clip has `frames` of them. */
  frame: number;
  /** The take's clock at the frame last drawn, in ms. */
  ms: number;
  camera: Camera;
  captions: Caption[];
  rings: Placed[];
  tips: PlacedTip[];
  done: boolean;
  /** Steps of the scene that have run: fewer than it has when the scene ends before its script does. */
  position: number;
  /** Things the scene asked for that the page or the run could not give; the recorder prints them. */
  warnings: string[];
}

export interface Take {
  readonly scene: Scene;
  /** How many frames the clip has. */
  readonly frames: number;
  readonly state: StoreApi<TakeState>;
  /** Draw the next frame. Does nothing once the clip is done. */
  tick(): void;
  /** Place the rings again on the page as it is now. A frame is drawn before React has rendered what the replay's step
   * changed, so a ring placed by `tick` can be one render behind a node that moved; the driver calls this once that has run. */
  refresh(): void;
  /** Back to the first frame: the replay at its start and paused, or where the seeks the scene opens with put it, the camera home, the panels as the
   * scene opens them. Those seeks are made here, not at the first frame, so that a page that is held for a while (the driver's pre-roll) has settled on
   * the picture they lead to: after a seek the cards change colour and the tree lays itself out again for a quarter of a second, and a clip that opens
   * on it would show that as a blink instead of a cut. */
  restart(): void;
}

export const framesOf = (durationMs: number): number => Math.ceil(durationMs / FIXED_FRAME_MS - 1e-9);

export function createTake(scene: Scene, replay: ReplayClock | null, surface: Surface): Take {
  const frames = framesOf(scene.durationMs);
  const state = createStore<TakeState>(() => ({ frame: 0, ms: 0, camera: HOME, captions: [], rings: [], tips: [], done: false, position: 0, warnings: [] }));

  let frame = 0;
  let camera = HOME;
  let move: Move | null = null;
  let ramp: Ramp | null = null;
  let captions: Caption[] = [];
  let rings: Ring[] = [];
  let tips: Tip[] = [];
  let ids = 0;
  let warnings: string[] = [];
  const unplaced = new Set<number>();
  let program: Program;

  const warn = (message: string): void => {
    if (!warnings.includes(message)) warnings = [...warnings, message];
  };
  const clockMs = (): number => frame * FIXED_FRAME_MS;

  function aim(step: Extract<Step, { do: "camera" }>): void {
    let to: Camera = HOME;
    if (step.fit !== null) {
      const rect = surface.contentRect(step.fit);
      if (rect === null) return warn(`step ${program.position()}: the camera's target is not on the page`);
      to = fit(rect, step.pad);
      if (step.zoom !== null) to = zoomedTo(to, step.zoom);
      if (step.pan !== null) to = panned(to, step.pan);
      to = within(to, surface.bounds());
    }
    move = { from: move === null ? camera : cameraAt(move, clockMs()), to, start: clockMs(), ms: step.ms, ease: step.ease };
  }

  function host(): Host {
    return {
      now: clockMs,
      playhead: () => replay?.playhead() ?? 0,
      playing: () => replay?.playing() ?? false,
      resolve: (time: TimeExpr) => {
        const at = resolveTime(time, surface.context());
        return at === null ? null : Math.min(at, replay?.end() ?? at);
      },
      warn: (message) => warn(message),
      run(step) {
        switch (step.do) {
          case "seek": {
            const at = resolveTime(step.to, surface.context());
            if (at === null) return warn(`step ${program.position()}: the run has no moment to seek to`);
            replay?.seek(Math.min(at, replay.end()));
            return;
          }
          case "play":
            return replay?.setPlaying(true);
          case "pause":
            return replay?.setPlaying(false);
          case "speed": {
            if (replay === null) return;
            ramp = step.rampMs > 0 ? { from: replay.speed(), to: step.x, start: clockMs(), ms: step.rampMs } : null;
            if (ramp === null) replay.setSpeed(step.x);
            return;
          }
          case "camera":
            return aim(step);
          case "highlight":
            rings = [...rings, { id: ++ids, target: step.target, from: clockMs(), to: clockMs() + step.ms }];
            return;
          case "tooltip":
            tips = [...tips, { id: ++ids, target: step.target, from: clockMs(), to: clockMs() + step.ms }];
            return;
          case "caption":
            captions = addCaption(captions, { id: ++ids, text: step.text, kicker: step.kicker, style: step.style, from: clockMs(), to: clockMs() + step.ms });
            return;
          case "lens": {
            const why = surface.lens(step.open);
            if (why !== null) warn(`step ${program.position()}: ${why}`);
            return;
          }
          case "panel":
            return surface.panel(step.name, step.show);
        }
      },
    };
  }

  function publish(done: boolean): void {
    const t = clockMs();
    const placed: Placed[] = [];
    for (const ring of rings) {
      const rect = surface.screenRect(ring.target);
      if (rect === null) {
        if (t - ring.from >= Math.min(RING_GRACE_MS, ring.to - ring.from) && !unplaced.has(ring.id)) {
          unplaced.add(ring.id);
          warn(`a highlight's target is not on the page (it began at ${(ring.from / 1000).toFixed(2)} s)`);
        }
        continue;
      }
      placed.push({ ring, rect, opacity: ringOpacity(ring, t) });
    }
    const placedTips: PlacedTip[] = [];
    for (const tip of tips) {
      const rect = surface.screenRect(tip.target);
      const text = rect === null ? null : surface.titleOf(tip.target);
      if (rect === null || text === null) {
        if (t - tip.from >= Math.min(RING_GRACE_MS, tip.to - tip.from) && !unplaced.has(tip.id)) {
          unplaced.add(tip.id);
          warn(`a tooltip's target ${rect === null ? "is not on the page" : "has no hover text"} (it began at ${(tip.from / 1000).toFixed(2)} s)`);
        }
        continue;
      }
      placedTips.push({ tip, rect, text, opacity: tipOpacity(tip, t) });
    }
    state.setState({ frame, ms: t, camera, captions, rings: placed, tips: placedTips, done, position: program.position(), warnings });
  }

  function reset(): void {
    frame = 0;
    camera = HOME;
    move = null;
    ramp = null;
    captions = [];
    rings = [];
    tips = [];
    warnings = [];
    unplaced.clear();
    program = createProgram(scene.steps, host());
    if (replay !== null) {
      replay.setPlaying(false);
      replay.setSpeed(1);
      replay.seek(0);
    }
    surface.apply(HOME);
    for (const name of ["scoreboard", "timeline", "counters", "schedule", "feed"] as const) surface.panel(name, scene.panels[name] ?? true);
    publish(false);
  }

  reset();

  return {
    scene,
    frames,
    state,
    tick() {
      if (frame >= frames) return;
      const t = clockMs();
      program.frame();
      if (replay !== null) {
        if (ramp !== null) {
          const x = speedAt(ramp, t);
          if (x !== replay.speed()) replay.setSpeed(x);
          if (t - ramp.start >= ramp.ms) ramp = null;
        }
        if (replay.playing()) replay.step();
      }
      if (move !== null) {
        camera = cameraAt(move, t);
        if (moveEnded(move, t)) move = null;
      }
      surface.apply(camera);
      captions = liveCaptions(captions, t);
      rings = liveRings(rings, t);
      tips = liveRings(tips, t);
      frame += 1;
      publish(frame >= frames);
    },
    refresh: () => publish(frame >= frames),
    restart() {
      reset();
      program.opening();
      publish(false);
    },
  };
}
