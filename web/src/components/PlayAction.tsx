import { useMemo, type MouseEvent } from "react";

import { prefersReducedMotion } from "../lib/motion";
import { PHONE_QUERY } from "../lib/phone";
import { WHOLE_RUN_SPEED } from "../lib/playback";
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

/** On a phone the bars above the page go up with it, and the state row is under them with the tree below: a press on a play action scrolls the
 * state row to the top of the window, which leaves the tree the rest of it above the replay bar, so that what plays is in view. A wider
 * window shows the tree on its first screen, and nothing moves. It waits for the page to be drawn for what the press did: a run that stood
 * at its start has no tree yet, so the page is too short to scroll that far until it has one. */
export function bringRunIntoView(): void {
  if (typeof window.matchMedia !== "function" || !window.matchMedia(PHONE_QUERY).matches) return;
  requestAnimationFrame(() => {
    document.querySelector(".runstate")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  });
}

/** The start buttons (the row's and the empty tree's) give way to Pause when the replay plays, and a key press on one that has the focus would
 * leave it on the page's body, with Space and Enter pressing nothing. So the focus goes to Pause, the button of the row that is left, as it
 * stays on Pause and Carry on (one element for the two). Only a button that has the focus gives it up: a click that did not focus it (Safari's
 * buttons) moves nothing. It waits for the page to be drawn for the press, and does not scroll, so it does not fight the phone's scroll to
 * the row (`bringRunIntoView`). */
export function keepFocusOnPause(event: Pick<MouseEvent<HTMLElement>, "currentTarget">): void {
  if (document.activeElement !== event.currentTarget) return;
  requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-replay-pause]")?.focus({ preventScroll: true }));
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
  const playFromStart = (event: MouseEvent<HTMLButtonElement>) => {
    const { seek, setPlaying, setSpeed, speed } = store.getState();
    keepFocusOnPause(event); // before the press takes the button away
    seek(0);
    if (speed === 1) setSpeed(WHOLE_RUN_SPEED);
    setPlaying(true);
    bringRunIntoView();
  };
  return (
    <div className="runstate__actions">
      {playing ? (
        <button type="button" className="btn btn--on" data-replay-pause onClick={() => store.getState().setPlaying(false)}>
          Pause
        </button>
      ) : midway ? (
        <button
          type="button"
          className="btn btn--on"
          onClick={() => {
            store.getState().setPlaying(true);
            bringRunIntoView();
          }}
        >
          Carry on
        </button>
      ) : (
        <>
          {crashAt !== null && (
            <button
              type="button"
              className="btn btn--on"
              onClick={(event) => {
                keepFocusOnPause(event);
                watchFirstCrash(store, crashAt);
                bringRunIntoView();
              }}
            >
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
