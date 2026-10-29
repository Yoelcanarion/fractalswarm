// A frame-time logger for measuring how smooth a replay is, instead of judging it by eye. A
// requestAnimationFrame loop records the time between frames.
//
//   Open the app with `?frames` in the URL (before the `#`), on the dev server or on a build made
//   with VITE_FRAME_LOG=1. `window.__frames` then has
//
//     reset()    start a new measurement
//     report()   { frames, seconds, fps, meanMs, p50Ms, p95Ms, p99Ms, maxMs, over20Ms, over34Ms }
//
//   and a small readout in the corner shows the live fps and the 95th percentile frame.
//
// It does nothing in a normal build: the guard below is a build-time constant, so the bundler
// drops the code.

export interface FrameReport {
  frames: number;
  seconds: number;
  fps: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames longer than 20 ms: a 60 fps frame is 16.7 ms, so these are visibly late. */
  over20Ms: number;
  /** Frames longer than 34 ms: two frames or more missed. */
  over34Ms: number;
}

/** The value below which a share ``p`` (0 to 1) of the sorted ``values`` falls (nearest rank). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

const round = (x: number, digits = 1): number => Math.round(x * 10 ** digits) / 10 ** digits;

/** Summarise the times between frames, in ms. */
export function summarizeFrames(deltasMs: number[]): FrameReport {
  const sorted = [...deltasMs].sort((a, b) => a - b);
  const total = deltasMs.reduce((sum, d) => sum + d, 0);
  return {
    frames: deltasMs.length,
    seconds: round(total / 1000, 2),
    fps: total > 0 ? round((deltasMs.length / total) * 1000) : 0,
    meanMs: deltasMs.length ? round(total / deltasMs.length) : 0,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted.at(-1) ?? 0),
    over20Ms: deltasMs.filter((d) => d > 20).length,
    over34Ms: deltasMs.filter((d) => d > 34).length,
  };
}

const MAX_FRAMES = 60_000; // 16 minutes at 60 fps

declare global {
  interface Window {
    __frames?: { reset(): void; report(): FrameReport };
  }
}

export function startFrameLogger(): void {
  if (!(import.meta.env.DEV || import.meta.env.VITE_FRAME_LOG === "1")) return;
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("frames")) return;

  let deltas: number[] = [];
  let last: number | null = null;
  const loop = (now: number): void => {
    if (last !== null) {
      deltas.push(now - last);
      if (deltas.length > MAX_FRAMES) deltas.shift();
    }
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  window.__frames = {
    reset() {
      deltas = [];
      last = null;
    },
    report: () => summarizeFrames(deltas),
  };

  const readout = document.createElement("div");
  readout.setAttribute("aria-hidden", "true");
  Object.assign(readout.style, {
    position: "fixed",
    right: "8px",
    bottom: "8px",
    zIndex: "9999",
    padding: "4px 8px",
    borderRadius: "6px",
    font: "12px var(--font-mono, monospace)",
    background: "var(--surface-3)",
    color: "var(--text-primary)",
    pointerEvents: "none",
  });
  document.body.append(readout);
  window.setInterval(() => {
    const { fps, p95Ms } = summarizeFrames(deltas.slice(-120));
    readout.textContent = `${fps} fps · p95 ${p95Ms} ms`;
  }, 500);
}
