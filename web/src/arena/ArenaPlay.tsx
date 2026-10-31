import { useMemo, useRef } from "react";
import { useStore } from "zustand";

import type { Clock } from "../lib/clock";
import { useClockFrame } from "../lib/clockHooks";
import type { RunStoreApi } from "../store";
import { laneOf, sharedEnd } from "./bands";
import { clockReadout, firstCrashOfPair, playFromStart, watchFirstCrash } from "./play";

export interface ArenaPlayProps {
  clock: Clock;
  left: RunStoreApi;
  right: RunStoreApi;
}

/** The main action of the arena, which says what it will do now, as the run page's does: pause the pair while it plays, with the clock beside
 * it; carry on from where it was stopped; and from its start (or its end) watch the first coordinator fall, with playing the whole pair from its
 * start beside that. A pair in which no coordinator is killed has the second only. */
export function ArenaPlay({ clock, left, right }: ArenaPlayProps) {
  const leftEvents = useStore(left, (s) => s.events);
  const rightEvents = useStore(right, (s) => s.events);
  const playing = useStore(clock.state, (s) => s.playing);
  const midway = useStore(clock.state, (s) => s.playhead > 0 && s.playhead < clock.end());
  const crashAt = useMemo(() => firstCrashOfPair(leftEvents, rightEvents), [leftEvents, rightEvents]);
  const end = useMemo(() => sharedEnd(laneOf(leftEvents), laneOf(rightEvents)), [leftEvents, rightEvents]);
  // The clock follows the playhead every frame, straight into the DOM, as the timeline's readout does.
  const readout = useRef<HTMLSpanElement>(null);
  useClockFrame((t) => {
    if (readout.current) readout.current.textContent = clockReadout(t, end);
  });
  return (
    <div className="arena__play">
      {playing ? (
        <button type="button" className="btn btn--on" onClick={() => clock.setPlaying(false)}>
          Pause
        </button>
      ) : midway ? (
        <button type="button" className="btn btn--on" onClick={() => clock.setPlaying(true)}>
          Carry on
        </button>
      ) : (
        <>
          {crashAt !== null && (
            <button type="button" className="btn btn--on" onClick={() => watchFirstCrash(clock, crashAt)}>
              Watch the first crash
            </button>
          )}
          <button type="button" className={crashAt === null ? "btn btn--on" : "btn"} onClick={() => playFromStart(clock)}>
            Play both from the start
          </button>
        </>
      )}
      {(playing || midway) && <span ref={readout} className="arena__clock mono" />}
    </div>
  );
}
