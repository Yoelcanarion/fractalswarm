// Replay playback over a loaded event log: a virtual-time playhead, 1–20×.
// Scrubbing back refolds from the nearest snapshot, so any position is cheap to show.

import { emptyView, foldEvent, type ViewState } from "./reducer";
import type { RunEvent } from "./types";

export const SPEEDS = [1, 2, 5, 10, 20] as const;
export const SNAPSHOT_EVERY = 250;
// Real-time cap on an idle gap between two events, so a long quiet stretch never stalls the
// replay (the timeline still shows true virtual time).
export const MAX_IDLE_GAP_MS = 1500;

/** Number of events at or before virtual time ``t`` (events are sorted by seq and their
 * ts_virtual never decreases). */
export function countAtTime(events: RunEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].ts_virtual <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// One frame of a fixed-step clock: the playhead moves by ``speed`` x 1/60 s whatever the real
// frame time was, so two takes of the same scene show the same thing on the same frame.
export const FIXED_FRAME_MS = 1000 / 60;

/** Advance a playhead by ``realMs`` of wall time at ``speed``. ``nextTs`` is the virtual time
 * of the next event still ahead (any run on the clock), ``null`` if there is none. A gap longer
 * than MAX_IDLE_GAP_MS of real time is skipped; the playhead never passes ``end``. */
export function advanceVirtual(playhead: number, realMs: number, speed: number, nextTs: number | null, end: number): number {
  let next = playhead + realMs * speed;
  if (nextTs !== null) {
    const gapReal = (nextTs - playhead) / speed;
    if (gapReal > MAX_IDLE_GAP_MS) next = Math.max(next, nextTs - MAX_IDLE_GAP_MS * speed);
  }
  return Math.min(next, end);
}

/** The same for one event log. */
export function advancePlayhead(events: RunEvent[], playhead: number, realMs: number, speed: number): number {
  const end = events.length ? events[events.length - 1].ts_virtual : 0;
  const nextIndex = countAtTime(events, playhead);
  return advanceVirtual(playhead, realMs, speed, nextIndex < events.length ? events[nextIndex].ts_virtual : null, end);
}

export class Folder {
  private snapshots: ViewState[] = [emptyView()];
  private view: ViewState = emptyView();
  private applied = 0;

  constructor(private events: RunEvent[] = []) {}

  get count(): number {
    return this.applied;
  }

  /** Append newly arrived events (a live tail); the current view is unchanged. */
  extend(events: RunEvent[]): void {
    this.events = this.events.concat(events);
  }

  reset(events: RunEvent[]): void {
    this.events = events;
    this.snapshots = [emptyView()];
    this.view = emptyView();
    this.applied = 0;
  }

  /** The view after the first ``count`` events. */
  seek(count: number): ViewState {
    const target = Math.max(0, Math.min(count, this.events.length));
    if (target < this.applied) {
      const index = Math.min(Math.floor(target / SNAPSHOT_EVERY), this.snapshots.length - 1);
      this.view = this.snapshots[index];
      this.applied = index * SNAPSHOT_EVERY;
    }
    while (this.applied < target) {
      this.view = foldEvent(this.view, this.events[this.applied]);
      this.applied += 1;
      if (this.applied % SNAPSHOT_EVERY === 0 && this.snapshots.length === this.applied / SNAPSHOT_EVERY) {
        this.snapshots.push(this.view);
      }
    }
    return this.view;
  }
}
