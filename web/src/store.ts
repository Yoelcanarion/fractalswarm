// The run store: the event log of one run, a playback position into it, and the view folded from
// the events before that position. One store per run being shown.
//
//   createRunStore()           a fresh store; its replay Folder and live tail live inside it
//   RunStoreProvider           makes a store the one `useRunStore` reads below it
//   useRunStore(selector)      read a slice, re-rendering only when the slice changes
//   useRunStoreShallow(sel)    the same for a selector that builds a new object or array
//   useRun                     the default store as a hook, for the app's own pages
//
// Playback is driven by a Clock (lib/clock.ts). A store made without one gets a private clock;
// give several stores one clock (`clock.attach(store)`) to play them on a single scrubber.

import { createContext, createElement, useContext, type ReactNode } from "react";
import { useStore, type StoreApi, type UseBoundStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createStore } from "zustand/vanilla";

import { listRuns, loadAllEvents, tailEvents, verifyRun } from "./lib/api";
import { createClock, type Clock } from "./lib/clock";
import { countAtTime, Folder } from "./lib/playback";
import { emptyView, type ViewState } from "./lib/reducer";
import type { RunEvent, RunListing, VerifyReport } from "./lib/types";

export type VerifyState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; report: VerifyReport }
  | { state: "error"; error: string };

export interface RunStoreState {
  runs: RunListing[];
  runsError: string | null;
  runId: string | null;
  loading: boolean;
  loadError: string | null;
  events: RunEvent[];
  live: boolean; // tailing a run that is still recording
  following: boolean; // the view sticks to the newest event
  cursor: number; // events applied to the view
  playhead: number; // virtual ms, as last committed by the clock (see lib/clock.ts)
  playing: boolean; // mirrors the clock
  speed: number; // mirrors the clock
  view: ViewState;
  verify: VerifyState;
  clock: Clock;
}

export interface RunStoreActions {
  loadRuns(): Promise<void>;
  openRun(id: string): Promise<void>;
  /** Show exactly the first ``count`` events. */
  seek(count: number): void;
  /** Move the clock, and so every store on it, to virtual time ``t``. */
  seekTime(t: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  runVerify(): Promise<void>;
  // Plumbing for the clock. App code does not call these.
  syncTo(t: number, cursor?: number): void;
  commitPlayhead(t: number): void;
  bindClock(clock: Clock): void;
}

export type RunStore = RunStoreState & RunStoreActions;
export type RunStoreApi = StoreApi<RunStore>;

/** The server calls a store makes; tests pass fakes. */
export interface RunApi {
  listRuns: typeof listRuns;
  loadAllEvents: typeof loadAllEvents;
  tailEvents: typeof tailEvents;
  verifyRun: typeof verifyRun;
}

export interface RunStoreOptions {
  api?: RunApi;
  /** Attach the store to a shared clock instead of a private one. */
  clock?: Clock;
}

const serverApi: RunApi = { listRuns, loadAllEvents, tailEvents, verifyRun };
const messageOf = (error: unknown): string => String((error as Error).message ?? error);

export function createRunStore(options: RunStoreOptions = {}): RunStoreApi {
  const api = options.api ?? serverApi;
  const clock = options.clock ?? createClock();
  const folder = new Folder();
  let stopTail: (() => void) | null = null;

  const store: RunStoreApi = createStore<RunStore>()((set, get) => ({
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
    speed: clock.state.getState().speed,
    view: emptyView(),
    verify: { state: "idle" },
    clock,

    async loadRuns() {
      try {
        set({ runs: await api.listRuns(), runsError: null });
      } catch (error) {
        set({ runsError: messageOf(error) });
      }
    },

    async openRun(id) {
      stopTail?.();
      stopTail = null;
      folder.reset([]);
      get().clock.setPlaying(false);
      set({
        runId: id,
        loading: true,
        loadError: null,
        events: [],
        cursor: 0,
        playhead: 0,
        view: emptyView(),
        verify: { state: "idle" },
        live: false,
        following: false,
      });
      get().clock.seekTime(0, store);
      try {
        const events = await api.loadAllEvents(id);
        if (get().runId !== id) return;
        folder.reset(events);
        const completed = events.at(-1)?.type === "run.completed";
        // A finished run opens at the start, ready to replay; a live one opens at its head.
        const cursor = completed ? 0 : events.length;
        const playhead = completed ? 0 : (events.at(-1)?.ts_virtual ?? 0);
        set({ events, loading: false, live: !completed, following: !completed, cursor, playhead, view: folder.seek(cursor) });
        get().clock.seekTime(playhead, store);
        if (!completed) {
          stopTail = api.tailEvents(
            id,
            (events.at(-1)?.seq ?? 0) + 1,
            (batch) => {
              if (get().runId !== id) return;
              folder.extend(batch);
              const all = get().events.concat(batch);
              const follow = get().following;
              const cursor = follow ? all.length : get().cursor;
              const head = all.at(-1)?.ts_virtual ?? 0;
              set({ events: all, cursor, playhead: follow ? head : get().playhead, view: folder.seek(cursor) });
              if (follow) get().clock.seekTime(head, store);
            },
            () => {
              if (get().runId === id) set({ live: false });
            },
          );
        }
      } catch (error) {
        set({ loading: false, loadError: messageOf(error) });
      }
    },

    seek(count) {
      const { events } = get();
      const target = Math.max(0, Math.min(count, events.length));
      const playhead = target === 0 ? 0 : events[target - 1].ts_virtual;
      set({ cursor: target, playhead, following: target === events.length, view: folder.seek(target) });
      get().clock.seekTime(playhead, store);
    },

    seekTime(t) {
      get().clock.seekTime(t);
    },

    setPlaying(playing) {
      get().clock.setPlaying(playing);
    },

    setSpeed(speed) {
      get().clock.setSpeed(speed);
    },

    syncTo(t, cursor) {
      const { events } = get();
      const target = cursor ?? countAtTime(events, t);
      set({ playhead: t, cursor: target, following: target === events.length, view: folder.seek(target) });
    },

    commitPlayhead(t) {
      if (get().playhead !== t) set({ playhead: t });
    },

    bindClock(next) {
      set({ clock: next });
    },

    async runVerify() {
      const id = get().runId;
      if (!id) return;
      set({ verify: { state: "pending" } });
      try {
        const report = await api.verifyRun(id);
        if (get().runId === id) set({ verify: { state: "done", report } });
      } catch (error) {
        if (get().runId === id) set({ verify: { state: "error", error: messageOf(error) } });
      }
    },
  }));

  clock.attach(store);
  return store;
}

// ---- React bindings ----

/** The store the app's own pages use. */
export const defaultRunStore: RunStoreApi = createRunStore();

/** The default store as a hook, for code that predates the provider. Prefer `useRunStore`. */
export const useRun: UseBoundStore<RunStoreApi> = Object.assign(
  <T,>(selector?: (state: RunStore) => T) => useStore(defaultRunStore, selector as (state: RunStore) => T),
  defaultRunStore,
) as UseBoundStore<RunStoreApi>;

const RunStoreContext = createContext<RunStoreApi | null>(null);

export function RunStoreProvider({ store, children }: { store: RunStoreApi; children?: ReactNode }) {
  return createElement(RunStoreContext.Provider, { value: store }, children);
}

/** The store of the nearest provider, or the default store outside one. */
export function useRunStoreApi(): RunStoreApi {
  return useContext(RunStoreContext) ?? defaultRunStore;
}

/** Subscribe to one slice of the store. The component re-renders only when the slice changes
 * (compared with ``Object.is``), so select the narrowest value you can. */
export function useRunStore<T>(selector: (state: RunStore) => T): T {
  return useStore(useRunStoreApi(), selector);
}

/** For a selector that returns a new object or array each time: re-renders only when a member
 * changes. */
export function useRunStoreShallow<T>(selector: (state: RunStore) => T): T {
  return useStore(useRunStoreApi(), useShallow(selector));
}
