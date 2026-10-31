import { useMemo } from "react";

import { firstCrashStart, marksOf } from "../lib/timeline";
import { useRunStoreApi, useRunStoreShallow, type RunStoreApi } from "../store";

/** Where "Watch the first crash" starts, or null for a live run and for a recording in which no coordinator is killed. */
export function useFirstCrashStart(): number | null {
  const { live, events } = useRunStoreShallow((s) => ({ live: s.live, events: s.events }));
  return useMemo(() => (live ? null : firstCrashStart(marksOf(events))), [live, events]);
}

/** Only the playhead moves, to a few seconds before the first kill, and the recording plays from there at the speed it reads at: the log is
 * not cut. The seek comes first, because playing a recording that stands at its end starts it again from the beginning. */
export function watchFirstCrash(store: RunStoreApi, at: number): void {
  const { seekTime, setSpeed, setPlaying } = store.getState();
  seekTime(at);
  setSpeed(1);
  setPlaying(true);
}

/** The main action of a recorded run, which says what it will do now: pause it while it plays, carry on from where it was stopped, and from
 * its start (or its end) watch its first coordinator die, with playing the whole run from its start beside it. A run in which no
 * coordinator is killed has the second only. A live run is played by the run itself. */
export function PlayAction() {
  const { live, playing, cursor, total } = useRunStoreShallow((s) => ({ live: s.live, playing: s.playing, cursor: s.cursor, total: s.events.length }));
  const store = useRunStoreApi();
  const crashAt = useFirstCrashStart();
  if (live) return null;
  const midway = cursor > 0 && cursor < total;
  const playFromStart = () => {
    const { seek, setPlaying } = store.getState();
    seek(0);
    setPlaying(true);
  };
  return (
    <div className="runstate__actions">
      {playing ? (
        <button type="button" className="btn btn--on" onClick={() => store.getState().setPlaying(false)}>
          Pause
        </button>
      ) : midway ? (
        <button type="button" className="btn btn--on" onClick={() => store.getState().setPlaying(true)}>
          Carry on
        </button>
      ) : (
        <>
          {crashAt !== null && (
            <button type="button" className="btn btn--on" onClick={() => watchFirstCrash(store, crashAt)}>
              Watch the first crash
            </button>
          )}
          <button type="button" className={crashAt === null ? "btn btn--on" : "btn"} onClick={playFromStart}>
            Play from the start
          </button>
        </>
      )}
    </div>
  );
}
