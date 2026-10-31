import { useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";

import type { Clock } from "../lib/clock";
import { useClockFrame } from "../lib/clockHooks";
import type { RunStoreApi } from "../store";
import { laneOf, sharedEnd } from "./bands";
import { bringBoardIntoView, clockReadout, firstCrashOfPair, playFromStart, watchFirstCrash } from "./play";

export interface ArenaPlayProps {
  clock: Clock;
  left: RunStoreApi;
  right: RunStoreApi;
}

/** The main action of the arena, which says what it will do now, as the run page's does: pause the pair while it plays, with the clock beside
 * it; carry on from where it was stopped; and from its start (or its end) watch the first coordinator fall, with playing the whole pair from its
 * start beside that. A pair in which no coordinator is killed has the second only. Where the timeline is pinned it has the clock, and this one is
 * left out (arena.css). */
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
  // The button that is pressed is not always the one that is there afterwards: Play both from the start gives way to Pause. Focus goes to the main
  // button after a press, so that Enter and Space go on working from where the person is. The main button is one element whatever it says, so
  // that Watch, Pause and Carry on hand the focus over by themselves.
  const main = useRef<HTMLButtonElement>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    main.current?.focus({ preventScroll: true });
  });
  const press = (action: () => void, bring = true) => () => {
    pressed.current = true;
    action();
    if (bring) bringBoardIntoView();
  };
  const idle = !playing && !midway;
  const [label, onMain]: [string, () => void] = playing
    ? ["Pause", press(() => clock.setPlaying(false), false)]
    : midway
      ? ["Carry on", press(() => clock.setPlaying(true))]
      : crashAt !== null
        ? ["Watch the first crash", press(() => watchFirstCrash(clock, crashAt))]
        : ["Play both from the start", press(() => playFromStart(clock))];
  return (
    <div className="arena__play">
      <button ref={main} type="button" className="btn btn--on" onClick={onMain}>
        {label}
      </button>
      {idle && crashAt !== null && (
        <button type="button" className="btn" onClick={press(() => playFromStart(clock))}>
          Play both from the start
        </button>
      )}
      {!idle && <span ref={readout} className="arena__clock mono" />}
    </div>
  );
}
