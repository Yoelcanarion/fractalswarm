import { CircleHelp } from "lucide-react";
import { useCallback, useState } from "react";

// Whether this browser has been shown the guide. It is a convenience: with no storage the guide simply shows each time.
const KEY = "fractalswarm.runguide.seen";

function wasSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // private window, blocked storage: it will be offered again, which is harmless
  }
}

export interface Guide {
  open: boolean;
  /** Show or hide it by hand. */
  toggle: () => void;
  /** "Got it": hide it and do not open it by itself again. */
  dismiss: () => void;
}

/** Open the first time this browser sees a run, closed after it is dismissed, and a button brings it back. */
export function useGuide(): Guide {
  const [open, setOpen] = useState(() => !wasSeen());
  const toggle = useCallback(() => setOpen((now) => !now), []);
  const dismiss = useCallback(() => {
    remember();
    setOpen(false);
  }, []);
  return { open, toggle, dismiss };
}

/** The button that opens and closes the guide. It sits beside the counters, so it takes no height of its own. */
export function GuideButton({ guide }: { guide: Guide }) {
  return (
    <button
      type="button"
      className="icon-btn runguide__button"
      aria-expanded={guide.open}
      aria-controls="runguide"
      aria-label="How to read this page"
      onClick={guide.toggle}
    >
      <CircleHelp size={18} aria-hidden="true" />
    </button>
  );
}

/** A few sentences on how to read a run, for someone who has never seen one: the tree, the numbers, and above all the playhead. */
export function GuideStrip({ guide }: { guide: Guide }) {
  if (!guide.open) return null;
  return (
    <aside id="runguide" className="runguide" aria-label="How to read this page">
      <p>
        <strong>The tree</strong> is the swarm: each circle is an orchestrator, its colour marks the track it belongs to, an ✕ marks one that was killed, and
        a moving line is a message.
      </p>
      <p>
        <strong>The playhead</strong> is the marker on the bar at the bottom. Every view shows the run as it was at that moment. Drag it, press play, or
        press one of the dots on the bar (a kill, a takeover) to go there.
      </p>
      <button type="button" className="btn runguide__done" onClick={guide.dismiss}>
        Got it
      </button>
    </aside>
  );
}
