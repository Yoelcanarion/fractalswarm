import { create } from "zustand";

import { listRuns, loadAllEvents, tailEvents, verifyRun } from "./lib/api";
import { advancePlayhead, countAtTime, Folder } from "./lib/playback";
import { emptyView, type ViewState } from "./lib/reducer";
import type { RunEvent, RunListing, VerifyReport } from "./lib/types";

export type VerifyState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; report: VerifyReport }
  | { state: "error"; error: string };

interface RunStore {
  runs: RunListing[];
  runsError: string | null;
  runId: string | null;
  loading: boolean;
  loadError: string | null;
  events: RunEvent[];
  live: boolean; // tailing a run that is still recording
  following: boolean; // the view sticks to the newest event
  cursor: number; // events applied to the view
  playhead: number; // virtual ms
  playing: boolean;
  speed: number;
  view: ViewState;
  verify: VerifyState;

  loadRuns(): Promise<void>;
  openRun(id: string): Promise<void>;
  seek(count: number): void;
  seekTime(t: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  tick(realMs: number): void;
  runVerify(): Promise<void>;
}

const folder = new Folder();
let stopTail: (() => void) | null = null;

export const useRun = create<RunStore>((set, get) => ({
  runs: [],
  runsError: null,
  runId: null,
  loading: false,
  loadError: null,
  events: [],
  live: false,
  following: false,
  cursor: 0,
  playhead: 0,
  playing: false,
  speed: 1,
  view: emptyView(),
  verify: { state: "idle" },

  async loadRuns() {
    try {
      set({ runs: await listRuns(), runsError: null });
    } catch (error) {
      set({ runsError: String((error as Error).message ?? error) });
    }
  },

  async openRun(id) {
    stopTail?.();
    stopTail = null;
    folder.reset([]);
    set({
      runId: id,
      loading: true,
      loadError: null,
      events: [],
      cursor: 0,
      playhead: 0,
      playing: false,
      view: emptyView(),
      verify: { state: "idle" },
      live: false,
      following: false,
    });
    try {
      const events = await loadAllEvents(id);
      if (get().runId !== id) return;
      folder.reset(events);
      const completed = events.at(-1)?.type === "run.completed";
      // A finished run opens at the start, ready to replay; a live one opens at its head.
      const cursor = completed ? 0 : events.length;
      set({
        events,
        loading: false,
        live: !completed,
        following: !completed,
        cursor,
        playhead: completed ? 0 : (events.at(-1)?.ts_virtual ?? 0),
        view: folder.seek(cursor),
      });
      if (!completed) {
        stopTail = tailEvents(
          id,
          (events.at(-1)?.seq ?? 0) + 1,
          (batch) => {
            if (get().runId !== id) return;
            folder.extend(batch);
            const all = get().events.concat(batch);
            const follow = get().following;
            const cursor = follow ? all.length : get().cursor;
            set({
              events: all,
              cursor,
              playhead: follow ? (all.at(-1)?.ts_virtual ?? 0) : get().playhead,
              view: folder.seek(cursor),
            });
          },
          () => {
            if (get().runId === id) set({ live: false });
          },
        );
      }
    } catch (error) {
      set({ loading: false, loadError: String((error as Error).message ?? error) });
    }
  },

  seek(count) {
    const { events } = get();
    const target = Math.max(0, Math.min(count, events.length));
    const playhead = target === 0 ? 0 : events[target - 1].ts_virtual;
    set({ cursor: target, playhead, following: target === events.length, view: folder.seek(target) });
  },

  seekTime(t) {
    const { events } = get();
    const cursor = countAtTime(events, t);
    set({ playhead: t, cursor, following: cursor === events.length, view: folder.seek(cursor) });
  },

  setPlaying(playing) {
    const { events, cursor } = get();
    if (playing && cursor >= events.length) get().seek(0);
    set({ playing });
  },

  setSpeed(speed) {
    set({ speed });
  },

  tick(realMs) {
    const { events, playhead, speed, playing } = get();
    if (!playing || events.length === 0) return;
    const next = advancePlayhead(events, playhead, realMs, speed);
    const cursor = countAtTime(events, next);
    const end = events[events.length - 1].ts_virtual;
    set({
      playhead: next,
      cursor,
      view: folder.seek(cursor),
      playing: next < end || cursor < events.length,
      following: cursor === events.length,
    });
  },

  async runVerify() {
    const id = get().runId;
    if (!id) return;
    set({ verify: { state: "pending" } });
    try {
      const report = await verifyRun(id);
      if (get().runId === id) set({ verify: { state: "done", report } });
    } catch (error) {
      if (get().runId === id) set({ verify: { state: "error", error: String((error as Error).message ?? error) } });
    }
  },
}));
