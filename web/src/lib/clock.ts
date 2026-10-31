// The virtual-time clock: one requestAnimationFrame loop that drives any number of run stores
// at the same virtual time and speed. The arena plays two runs side by side on one scrubber by
// attaching both stores to one clock:
//
//   const clock = createClock();
//   clock.attach(storeA);
//   clock.attach(storeB);
//   clock.setPlaying(true);   // both stores advance together
//   clock.seekTime(30_000);   // and seek together
//
// A store made without a clock gets a private one, so a single run needs no setup.
//
// Two ways to advance:
//   - "realtime" (default): each frame moves the playhead by the real frame time x speed.
//   - "fixed-step": each frame moves it by exactly speed x 1/60 s, whatever the real frame time
//     was, so director takes of the same scene are identical. step(n) advances n such frames by
//     hand, for a recorder that drives the clock itself.
//
// Writes to the stores are throttled: a store is written when its cursor changes (its view must
// follow) and otherwise at most every commitIntervalMs of real time, so a React tree sees the
// playhead at ~20 Hz instead of 60. Anything that needs the playhead every frame (the timeline
// marker, edge fades) reads now() from an onFrame listener and writes the DOM itself.

import { createStore, type StoreApi } from "zustand/vanilla";

import { advanceVirtual, countAtTime, FIXED_FRAME_MS } from "./playback";
import type { RunEvent } from "./types";

export type ClockMode = "realtime" | "fixed-step";

export interface ClockState {
  /** Virtual ms, as last committed to React: not every frame. Use ``now()`` for the exact value. */
  playhead: number;
  playing: boolean;
  speed: number;
  mode: ClockMode;
}

/** What the clock needs from a run store (the run store in store.ts satisfies it). */
export interface ClockedState {
  events: RunEvent[];
  cursor: number;
  clock: Clock;
  /** A run still recording: more of its log is on the way. */
  live?: boolean;
  /** Move to virtual time ``t``; the cursor is derived from ``t`` unless it is given. */
  syncTo(t: number, cursor?: number): void;
  commitPlayhead(t: number): void;
  bindClock(clock: Clock): void;
}

export interface ClockedStore {
  getState(): ClockedState;
  setState(partial: { playing?: boolean; speed?: number }): void;
}

export interface FrameScheduler {
  request(callback: (frameMs: number) => void): number;
  cancel(handle: number): void;
}

export interface ClockOptions {
  mode?: ClockMode;
  speed?: number;
  /** Real ms between playhead commits while no cursor changes. Default 50. */
  commitIntervalMs?: number;
  /** Defaults to requestAnimationFrame, or a 16 ms timer outside a browser. */
  scheduler?: FrameScheduler;
}

export interface Clock {
  /** Reactive state (throttled playhead); subscribe with ``useStore(clock.state, selector)``. */
  readonly state: StoreApi<ClockState>;
  /** The exact virtual time in ms. */
  now(): number;
  /** The time base for tweens that run in real time (the tree gliding to a new layout). Normally
   * the real clock; in fixed-step mode the frames advanced so far x 1/60 s, so a take repeats
   * exactly whatever the real frame times were. It only goes forward. */
  motion(): number;
  /** The virtual time of the last event of the longest attached run. */
  end(): number;
  attach(store: ClockedStore): () => void;
  detach(store: ClockedStore): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  setMode(mode: ClockMode): void;
  /** Move every attached store to ``t``, except ``origin``, which the caller has already set. */
  seekTime(t: number, origin?: ClockedStore): void;
  /** Advance ``frames`` fixed steps (speed x 1/60 s each), playing or not. */
  step(frames?: number): void;
  /** Called with the exact virtual time after every frame, step and seek. */
  onFrame(listener: (t: number) => void): () => void;
  dispose(): void;
}

// A tab that was asleep must not make the next frame jump by minutes.
export const MAX_FRAME_MS = 100;

export function browserScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame === "function") {
    return { request: (callback) => requestAnimationFrame(callback), cancel: (handle) => cancelAnimationFrame(handle) };
  }
  return {
    request: (callback) => setTimeout(() => callback(performance.now()), 16) as unknown as number,
    cancel: (handle) => clearTimeout(handle),
  };
}

export function createClock(options: ClockOptions = {}): Clock {
  const scheduler = options.scheduler ?? browserScheduler();
  const commitIntervalMs = options.commitIntervalMs ?? 50;
  const state = createStore<ClockState>(() => ({
    playhead: 0,
    playing: false,
    speed: options.speed ?? 1,
    mode: options.mode ?? "realtime",
  }));
  const stores = new Set<ClockedStore>();
  const listeners = new Set<(t: number) => void>();
  let t = 0;
  let handle: number | null = null;
  let lastFrameMs: number | null = null;
  let lastCommitMs = Number.NEGATIVE_INFINITY;
  let stepClockMs = 0;
  let frames = 0;

  const endOf = (): number => Math.max(0, ...[...stores].map((s) => s.getState().events.at(-1)?.ts_virtual ?? 0));
  const hasEvents = (): boolean => [...stores].some((s) => s.getState().events.length > 0);
  const nextTsOf = (): number | null => {
    let next: number | null = null;
    for (const store of stores) {
      const { events } = store.getState();
      const index = countAtTime(events, t);
      if (index < events.length && (next === null || events[index].ts_virtual < next)) next = events[index].ts_virtual;
    }
    return next;
  };
  const finished = (): boolean =>
    t >= endOf() &&
    [...stores].every((s) => {
      const { cursor, events } = s.getState();
      return cursor >= events.length;
    });
  const recording = (): boolean => [...stores].some((s) => s.getState().live === true);

  const emit = (): void => listeners.forEach((listener) => listener(t));

  /** Write the exact playhead to the clock state and to every store. */
  function commit(frameMs = lastCommitMs): void {
    state.setState({ playhead: t });
    for (const store of stores) store.getState().commitPlayhead(t);
    lastCommitMs = frameMs;
  }

  function mirror(partial: { playing?: boolean; speed?: number }): void {
    for (const store of stores) store.setState(partial);
  }

  function advance(dt: number, frameMs: number, force: boolean): void {
    frames += 1;
    t = advanceVirtual(t, dt, state.getState().speed, nextTsOf(), endOf());
    let moved = false;
    for (const store of stores) {
      const s = store.getState();
      const cursor = countAtTime(s.events, t);
      if (cursor !== s.cursor) {
        s.syncTo(t, cursor);
        moved = true;
      }
    }
    if (moved || force || frameMs - lastCommitMs >= commitIntervalMs) commit(frameMs);
    // A playhead that has caught up with a run still recording waits there, playing, and goes on as its events come in.
    if (state.getState().playing && finished() && !recording()) {
      state.setState({ playing: false });
      mirror({ playing: false });
      commit(frameMs);
    }
    emit();
  }

  function loop(frameMs: number): void {
    handle = null;
    if (!state.getState().playing) return;
    const fixed = state.getState().mode === "fixed-step";
    const dt = fixed ? FIXED_FRAME_MS : lastFrameMs === null ? 0 : Math.min(frameMs - lastFrameMs, MAX_FRAME_MS);
    lastFrameMs = frameMs;
    advance(dt, frameMs, fixed);
    if (state.getState().playing) handle = scheduler.request(loop);
  }

  function place(next: number, origin?: ClockedStore): void {
    t = Math.max(0, next);
    for (const store of stores) if (store !== origin) store.getState().syncTo(t);
    commit();
    emit();
  }

  const clock: Clock = {
    state,
    now: () => t,
    motion: () => (state.getState().mode === "fixed-step" ? frames * FIXED_FRAME_MS : performance.now()),
    end: endOf,

    attach(store) {
      if (!stores.has(store)) {
        const current = store.getState().clock;
        if (current !== clock) {
          current.detach(store);
          store.getState().bindClock(clock);
        }
        stores.add(store);
        const { playing, speed } = state.getState();
        store.setState({ playing, speed });
        store.getState().syncTo(t);
      }
      return () => clock.detach(store);
    },

    detach(store) {
      if (!stores.delete(store)) return;
      if (stores.size === 0) clock.setPlaying(false);
    },

    setPlaying(playing) {
      if (playing === state.getState().playing) return;
      if (playing) {
        if (!hasEvents()) return;
        if (finished()) place(0);
        state.setState({ playing: true });
        mirror({ playing: true });
        lastFrameMs = null;
        if (handle === null) handle = scheduler.request(loop);
      } else {
        if (handle !== null) scheduler.cancel(handle);
        handle = null;
        state.setState({ playing: false });
        mirror({ playing: false });
        commit();
      }
    },

    setSpeed(speed) {
      state.setState({ speed });
      mirror({ speed });
    },

    setMode(mode) {
      state.setState({ mode });
    },

    seekTime: place,

    step(frames = 1) {
      for (let i = 0; i < frames; i++) {
        stepClockMs += FIXED_FRAME_MS;
        advance(FIXED_FRAME_MS, stepClockMs, true);
      }
    },

    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
      stores.clear();
      listeners.clear();
      state.setState({ playing: false });
    },
  };
  return clock;
}
