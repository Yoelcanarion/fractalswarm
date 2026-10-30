// One requestAnimationFrame loop for everything on the home page that runs on a clock of its own: the hero's loop and the
// tree's ambient layer. It runs only while something is subscribed and the tab is visible, so a page with nothing moving,
// and a hidden tab, cost nothing. Subscribers run in `order` within a frame, so the one that moves the recorded run goes
// before the one that reads the frame it has just painted.

/** What a subscriber is told each frame: the seconds since the last one, never more than MAX_DT (a tab that comes back does not leap). */
export type Tick = (dt: number) => void;

export const MAX_DT = 0.1;

interface Entry {
  tick: Tick;
  order: number;
}

let entries: Entry[] = [];
let handle = 0;
let last = 0;
let watching = false;

const hidden = (): boolean => typeof document !== "undefined" && document.hidden;

function frame(now: number): void {
  handle = requestAnimationFrame(frame);
  const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
  last = now;
  // `entries` is replaced, never changed in place, so a tick that unsubscribes does not disturb this round.
  for (const entry of entries) entry.tick(dt);
}

function start(): void {
  if (handle !== 0 || entries.length === 0 || hidden()) return;
  last = performance.now();
  handle = requestAnimationFrame(frame);
}

function stop(): void {
  if (handle === 0) return;
  cancelAnimationFrame(handle);
  handle = 0;
}

function onVisibility(): void {
  if (hidden()) stop();
  else start();
}

function watch(on: boolean): void {
  if (on === watching || typeof document === "undefined") return;
  watching = on;
  if (on) document.addEventListener("visibilitychange", onVisibility);
  else document.removeEventListener("visibilitychange", onVisibility);
}

/** Calls `tick` every frame until the returned function is called. Lower `order` runs first. */
export function onFrame(tick: Tick, order = 0): () => void {
  const entry: Entry = { tick, order };
  entries = [...entries, entry].sort((a, b) => a.order - b.order);
  watch(true);
  start();
  return () => {
    entries = entries.filter((e) => e !== entry);
    if (entries.length === 0) {
      stop();
      watch(false);
    }
  };
}

/** How many subscribers are running: for the tests, and for a page that wants to know that it is idle. */
export const subscribers = (): number => entries.length;
