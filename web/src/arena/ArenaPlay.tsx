import { useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";

import { resultsHash } from "../lib/address";
import type { Clock } from "../lib/clock";
import { useClockFrame } from "../lib/clockHooks";
import type { RunStoreApi } from "../store";
import { startedOf } from "./assumptions";
import { laneOf, sharedEnd } from "./bands";
import { bringBoardIntoView, clockReadout, firstCrashOfPair, playFromStart, watchFirstCrash } from "./play";
import { playedOut } from "./playedOut";
import { talksTotal } from "./work";

export interface ArenaPlayProps {
  clock: Clock;
  left: RunStoreApi;
  right: RunStoreApi;
}

/** The main action of the arena, which says what it will do now, as the run page's does: pause the pair while it plays, with the clock beside
 * it; carry on from where it was stopped; from its start watch the first coordinator fall, with playing the whole pair from its start beside that;
 * and once both runs have played out, open what the swarm's run produced, with playing them again beside that. A pair in which no coordinator is
 * killed has no first crash to watch. Where the timeline is pinned it has the clock, and this one is left out (arena.css). */
export function ArenaPlay({ clock, left, right }: ArenaPlayProps) {
  const leftEvents = useStore(left, (s) => s.events);
  const rightEvents = useStore(right, (s) => s.events);
  const playing = useStore(clock.state, (s) => s.playing);
  const midway = useStore(clock.state, (s) => s.playhead > 0 && s.playhead < clock.end());
  const leftPlayedOut = useStore(left, playedOut);
  const rightPlayedOut = useStore(right, playedOut);
  const swarmRun = useStore(left, (s) => (s.view.completed ? s.runId : null));
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
  const over = idle && leftPlayedOut && rightPlayedOut;
  const [label, onMain]: [string, () => void] = playing
    ? ["Pause", press(() => clock.setPlaying(false), false)]
    : midway
      ? ["Carry on", press(() => clock.setPlaying(true))]
      : crashAt !== null && !over
        ? ["Watch the first crash", press(() => watchFirstCrash(clock, crashAt))]
        : ["Play both from the start", press(() => playFromStart(clock))];
  const results = over && swarmRun !== null;
  return (
    <div className="arena__play">
      {results && (
        <a className="btn btn--on" href={resultsHash(swarmRun)}>
          {talksTotal(startedOf(leftEvents)) === null ? "See the result" : "See the program"}
        </a>
      )}
      <button ref={main} type="button" className={results ? "btn" : "btn btn--on"} onClick={onMain}>
        {label}
      </button>
      {idle && !over && crashAt !== null && (
        <button type="button" className="btn" onClick={press(() => playFromStart(clock))}>
          Play both from the start
        </button>
      )}
      {!idle && <span ref={readout} className="arena__clock mono" />}
    </div>
  );
}
