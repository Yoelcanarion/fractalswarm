// What draws the frames of a take: one frame each time the browser asks for one (requestAnimationFrame). A recorder that
// stands in for the browser's frame clock (scripts/record_scenes.mjs) gets exactly one frame per frame it grants, so a
// clip has the frames the scene says; a person watching gets the take as fast as the machine draws it.
//
//   loading   the page is still getting its runs, fonts and panels
//   preroll   everything is there: some frames go by with the take held, so what animates on its own settles
//             (the tree fitting itself to the view, the counters counting up, the fade of a panel)
//   waiting   the address said `hold`: the take starts when `go()` is called (the recorder does)
//   playing   one take frame per frame
//   paused    the author stopped it (space); `step()` draws one frame
//   done      the last frame is on screen

import type { Take } from "./take";

export type DriverState = "loading" | "preroll" | "waiting" | "playing" | "paused" | "done";

export interface FrameLoop {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export interface DriverOptions {
  /** Wait for `go()` after the pre-roll instead of starting by itself. */
  hold: boolean;
  /** Frames to let go by before the take starts. */
  preroll: number;
  loop: FrameLoop;
  /** Run something once React has rendered what the frame changed. */
  defer?: (task: () => void) => void;
  onChange?: (state: DriverState) => void;
}

export interface Driver {
  state(): DriverState;
  /** The page has what the take needs: the pre-roll begins. */
  ready(): void;
  /** Start the take when the driver is waiting. */
  go(): void;
  pause(): void;
  resume(): void;
  /** Draw one frame while paused. */
  step(): void;
  /** The first frame again, playing. */
  restart(): void;
  dispose(): void;
}

export const PREROLL_FRAMES = 45;

export function createDriver(take: Take, options: DriverOptions): Driver {
  const defer = options.defer ?? ((task: () => void) => queueMicrotask(task));
  let state: DriverState = "loading";
  let handle: number | null = null;
  let waited = 0;
  let disposed = false;

  const set = (next: DriverState): void => {
    if (next === state) return;
    state = next;
    options.onChange?.(next);
  };
  const draw = (): void => {
    take.tick();
    defer(() => take.refresh());
    if (take.state.getState().done) set("done");
  };

  function frame(): void {
    handle = null;
    if (disposed) return;
    if (state === "preroll") {
      waited += 1;
      if (waited >= options.preroll) {
        set(options.hold ? "waiting" : "playing");
        take.refresh();
      }
    } else if (state === "playing") {
      draw();
    }
    if (state === "preroll" || state === "playing") handle = options.loop.request(frame);
  }
  const run = (): void => {
    if (handle === null && !disposed) handle = options.loop.request(frame);
  };

  return {
    state: () => state,
    ready() {
      if (state !== "loading") return;
      waited = 0;
      set("preroll");
      run();
    },
    go() {
      if (state !== "waiting") return;
      set("playing");
      run();
    },
    pause() {
      if (state !== "playing") return;
      set("paused");
    },
    resume() {
      if (state !== "paused") return;
      set("playing");
      run();
    },
    step() {
      if (state === "paused") draw();
    },
    restart() {
      if (state === "loading" || state === "preroll") return;
      take.restart();
      set("playing");
      run();
    },
    dispose() {
      disposed = true;
      if (handle !== null) options.loop.cancel(handle);
      handle = null;
    },
  };
}
