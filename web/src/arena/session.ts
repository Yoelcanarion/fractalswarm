// A pair of runs on one clock. Each side is an ordinary run store (store.ts) and both are attached to
// one clock (lib/clock.ts), so one play button, one scrubber and one speed move both views through
// the same virtual time. The runs line up at `run.started`: every run's virtual time starts at 0, so
// time 0 is the same moment on both sides and nothing needs shifting.
//
//   const session = createPairSession();
//   await session.open("pair-swarm", "pair-durable-max", { atMs: 31_500, speed: 5, play: true });
//   session.clock.seekTime(0);       // both sides, together
//   session.dispose();
//
// The idle stretches the clock skips (lib/playback.ts) are the ones in which neither run has an event,
// so a quiet side never makes the other wait.

import { createClock, type Clock, type ClockOptions } from "../lib/clock";
import { createRunStore, type RunApi, type RunStoreApi } from "../store";
import type { ArenaPlayback } from "./route";

export interface PairSession {
  clock: Clock;
  /** The swarm. */
  left: RunStoreApi;
  /** Its rival. */
  right: RunStoreApi;
  /** Open the two runs, both at their start, then apply the playback the address asked for. */
  open(left: string, right: string, playback?: ArenaPlayback): Promise<void>;
  dispose(): void;
}

export interface PairSessionOptions {
  /** The server calls the stores make; tests pass fakes. */
  api?: RunApi;
  clock?: ClockOptions;
}

/** Calls ``settled`` once the run open in ``store`` has stopped recording: at once if it has. What is said of a whole log, its replay check and its
 * scored numbers, is not asked of a part of one: scored half way, a run's numbers would stand as its final ones. Returns what stops the waiting. */
export function whenSettled(store: RunStoreApi, settled: () => void): () => void {
  if (!store.getState().live) {
    settled();
    return () => undefined;
  }
  return store.subscribe((now, before) => {
    if (before.live && !now.live) settled();
  });
}

export function createPairSession(options: PairSessionOptions = {}): PairSession {
  const clock = createClock(options.clock);
  const left = createRunStore({ api: options.api, clock });
  const right = createRunStore({ api: options.api, clock });
  let opening = 0;

  return {
    clock,
    left,
    right,

    async open(leftId, rightId, playback) {
      const attempt = ++opening;
      await Promise.all([left.getState().openRun(leftId), right.getState().openRun(rightId)]);
      if (attempt !== opening) return; // another pair was asked for while these loaded
      // Each openRun parked the shared clock at its own start; the pair starts together.
      clock.setPlaying(false);
      clock.seekTime(0);
      if (!playback) return;
      if (playback.speed) clock.setSpeed(playback.speed);
      if (playback.atMs !== null) clock.seekTime(playback.atMs === "end" ? clock.end() : playback.atMs);
      if (playback.play) clock.setPlaying(true);
    },

    dispose() {
      opening += 1;
      clock.dispose();
    },
  };
}
