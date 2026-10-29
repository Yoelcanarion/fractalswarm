// The Muse lens of one run store: the LLM calls of the open run (for the meter and the call list),
// what the person opened in the side panel, and the calls read in full so far.
//
//   lensStoreOf(runStore)      the lens that belongs to a run store, made on first use
//   useLens(selector)          read a slice of the lens of the nearest run store
//   useLensStoreApi()          its actions, for event handlers
//
// A lens follows its run store: when the run changes it loads that run's calls and closes the panel;
// while the run is recording it reloads them now and then. Like the run store it takes its server
// calls as an option, so tests pass fakes. Nothing here is global: W5's arena has two run stores
// and each gets its own lens.

import { useStore, type StoreApi } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createStore } from "zustand/vanilla";

import { fetchCallDetail, fetchCalls, fetchMeter } from "./lib/api";
import { pickCall, type CallDetail, type CallRow, type Meter, type Refused } from "./lib/lens";
import { useRunStoreApi, type RunStoreApi } from "./store";

export type LensStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

/** Which calls the list shows: every call of the run, or one actor's. */
export type LensScope = { kind: "run" } | { kind: "actor"; actor: string };

export type DetailEntry =
  | { state: "loading" }
  | { state: "ready"; detail: CallDetail }
  | { state: "error"; error: string };

export interface LensState {
  /** The run the calls belong to. */
  runId: string | null;
  /** "unavailable": the server has no lens routes. The meter and the panel stay out of the way. */
  status: LensStatus;
  error: string | null;
  /** In the order the calls started. */
  calls: CallRow[];
  refused: Refused[];
  /** The server's meter for the whole run: the figures the playhead-aware meter cannot fold itself. */
  meter: Meter | null;
  open: boolean;
  scope: LensScope;
  /** The effect id shown in full below the list. */
  selected: string | null;
  details: Record<string, DetailEntry>;
}

export interface LensActions {
  load(runId: string | null): Promise<void>;
  /** Read the calls again, keeping what is on screen. Used while a run is recording. */
  refresh(): Promise<void>;
  /** Open the panel on one actor's calls, at the call it had reached on the playhead. */
  openActor(actor: string): void;
  /** Open the panel on one call (from the event log, or from the call list). */
  openCall(effectId: string): void;
  /** Open the panel on every call of the run (the meter does). */
  openRun(): void;
  select(effectId: string | null): void;
  close(): void;
  loadDetail(effectId: string): Promise<void>;
}

export type LensStore = LensState & LensActions;
export type LensStoreApi = StoreApi<LensStore>;

export interface LensApi {
  calls: typeof fetchCalls;
  meter: typeof fetchMeter;
  detail: typeof fetchCallDetail;
}

const serverApi: LensApi = { calls: fetchCalls, meter: fetchMeter, detail: fetchCallDetail };

/** How often a recording run's calls are read again. */
export const LENS_POLL_MS = 5000;
/** Calls read in full that are kept; one can run to 40 kB. The selected one is always kept. */
export const DETAIL_CACHE = 24;

const messageOf = (error: unknown): string => String((error as Error).message ?? error);

const idle = (): LensState => ({
  runId: null,
  status: "idle",
  error: null,
  calls: [],
  refused: [],
  meter: null,
  open: false,
  scope: { kind: "run" },
  selected: null,
  details: {},
});

/** Drop the oldest details beyond the cache size, never the one on screen. */
function trimDetails(details: Record<string, DetailEntry>, keep: string | null): Record<string, DetailEntry> {
  const ids = Object.keys(details);
  if (ids.length <= DETAIL_CACHE) return details;
  const drop = ids.filter((id) => id !== keep).slice(0, ids.length - DETAIL_CACHE);
  const next = { ...details };
  for (const id of drop) delete next[id];
  return next;
}

export function createLensStore(run: RunStoreApi, options: { api?: LensApi } = {}): LensStoreApi {
  const api = options.api ?? serverApi;
  let poll: ReturnType<typeof setInterval> | null = null;

  const stopPoll = (): void => {
    if (poll !== null) clearInterval(poll);
    poll = null;
  };
  const startPoll = (): void => {
    if (poll !== null) return;
    poll = setInterval(() => void store.getState().refresh(), LENS_POLL_MS);
    (poll as { unref?: () => void }).unref?.(); // never keep a Node process alive (tests)
  };

  /** Fetch the run's calls and meter. Null when the server does not offer the lens. */
  const fetchRun = async (runId: string) => {
    const [calls, meter] = await Promise.all([api.calls(runId), api.meter(runId).catch(() => null)]);
    return calls === null ? null : { calls, meter };
  };

  const store: LensStoreApi = createStore<LensStore>()((set, get) => ({
    ...idle(),

    async load(runId) {
      stopPoll();
      set({ ...idle(), runId, status: runId === null ? "idle" : "loading" });
      if (runId === null) return;
      try {
        const found = await fetchRun(runId);
        if (get().runId !== runId) return;
        set(found ? { status: "ready", calls: found.calls.calls, refused: found.calls.refused, meter: found.meter } : { status: "unavailable" });
        if (found && run.getState().live) startPoll();
      } catch (error) {
        if (get().runId === runId) set({ status: "error", error: messageOf(error) });
      }
    },

    async refresh() {
      const runId = get().runId;
      if (runId === null || get().status === "unavailable") return;
      try {
        const found = await fetchRun(runId);
        if (get().runId !== runId || !found) return;
        set({ status: "ready", error: null, calls: found.calls.calls, refused: found.calls.refused, meter: found.meter });
      } catch {
        // keep what is on screen; the next poll tries again
      }
    },

    openActor(actor) {
      const call = pickCall(get().calls, actor, run.getState().playhead);
      set({ open: true, scope: { kind: "actor", actor }, selected: call?.effect_id ?? null });
      if (call) void get().loadDetail(call.effect_id);
    },

    openCall(effectId) {
      const call = get().calls.find((c) => c.effect_id === effectId);
      set({ open: true, scope: call ? { kind: "actor", actor: call.actor } : { kind: "run" }, selected: call ? effectId : null });
      if (call) void get().loadDetail(effectId);
    },

    openRun() {
      const { selected, calls } = get();
      const keep = selected !== null && calls.some((c) => c.effect_id === selected) ? selected : null;
      set({ open: true, scope: { kind: "run" }, selected: keep });
    },

    select(effectId) {
      set({ selected: effectId });
      if (effectId !== null) void get().loadDetail(effectId);
    },

    close() {
      set({ open: false });
    },

    async loadDetail(effectId) {
      const runId = get().runId;
      if (runId === null) return;
      const known = get().details[effectId];
      if (known && known.state !== "error") return;
      set({ details: { ...get().details, [effectId]: { state: "loading" } } });
      try {
        const detail = await api.detail(runId, effectId);
        if (get().runId !== runId) return;
        set({ details: trimDetails({ ...get().details, [effectId]: { state: "ready", detail } }, get().selected) });
      } catch (error) {
        if (get().runId === runId) set({ details: { ...get().details, [effectId]: { state: "error", error: messageOf(error) } } });
      }
    },
  }));

  // Follow the run store: load when the run changes, poll while it records.
  let wasLive = false;
  const follow = (): void => {
    const { runId, live } = run.getState();
    if (runId !== store.getState().runId) {
      wasLive = live;
      void store.getState().load(runId);
      return;
    }
    if (live && store.getState().status === "ready") startPoll();
    if (wasLive && !live) {
      stopPoll();
      void store.getState().refresh(); // the run's last calls
    }
    wasLive = live;
  };
  run.subscribe(follow);
  follow();
  return store;
}

const lenses = new WeakMap<RunStoreApi, LensStoreApi>();

/** The lens of a run store, made the first time it is asked for. */
export function lensStoreOf(run: RunStoreApi): LensStoreApi {
  let lens = lenses.get(run);
  if (!lens) {
    lens = createLensStore(run);
    lenses.set(run, lens);
  }
  return lens;
}

/** Give a run store a lens made elsewhere, such as one over a fake server. For tests. */
export function registerLensStore(run: RunStoreApi, lens: LensStoreApi): void {
  lenses.set(run, lens);
}

/** The lens of the nearest run store (the default one outside a provider). */
export function useLensStoreApi(): LensStoreApi {
  return lensStoreOf(useRunStoreApi());
}

export function useLens<T>(selector: (state: LensStore) => T): T {
  return useStore(useLensStoreApi(), selector);
}

/** For a selector that returns a new object or array each time. */
export function useLensShallow<T>(selector: (state: LensStore) => T): T {
  return useStore(useLensStoreApi(), useShallow(selector));
}
