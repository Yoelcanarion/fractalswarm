// What a scene plays on, made without a page: the stores, the clock and the loading. A stage controller owns them, hands
// the take its replay and its runs, and says when everything the frame shows has arrived. The React views that draw a
// stage are in StageViews.tsx; they only read what is here.
//
// Every replay runs on a fixed-step clock whose own frame loop is switched off: the take steps it, one frame of 1/60 s
// at a time (lib/clock.ts), so the same scene shows the same moment of the run on the same frame.

import { createStore, type StoreApi } from "zustand/vanilla";

import { fetchOfficial as serverOfficial } from "../arena/api";
import type { Official } from "../arena/official";
import { createPairSession, type PairSession } from "../arena/session";
import { createClock, type Clock, type ClockOptions, type FrameScheduler } from "../lib/clock";
import { formatUsd } from "../lib/lens";
import { createLensStore, lensStoreOf, registerLensStore, type LensApi, type LensStoreApi } from "../lensStore";
import { createRunStore, type RunApi, type RunStoreApi } from "../store";
import { callTimes, pickCall } from "./calls";
import type { CallPick } from "./script";
import type { LensHandle, RunSide } from "./surface";
import type { ReplayClock } from "./take";

/** A scheduler that never calls back: nothing but the take moves the clock. */
export const NO_FRAMES: FrameScheduler = { request: () => 0, cancel: () => undefined };

export const takeClock = (): ClockOptions => ({ mode: "fixed-step", scheduler: NO_FRAMES });

export function clockReplay(clock: Clock): ReplayClock {
  return {
    playing: () => clock.state.getState().playing,
    playhead: () => clock.now(),
    speed: () => clock.state.getState().speed,
    end: () => clock.end(),
    seek: (ms) => clock.seekTime(ms),
    setPlaying: (playing) => clock.setPlaying(playing),
    setSpeed: (speed) => clock.setSpeed(speed),
    step: () => clock.step(1),
  };
}

export interface StageController {
  readonly replay: ReplayClock;
  readonly sides: { left: RunSide; right: RunSide | null };
  readonly lens: LensHandle | null;
  /** The cost of each run on the page, in the order they are on screen; null where the server did not say. */
  costs(): (number | null)[];
  /** Everything the frame shows has arrived: the logs, the scored numbers, the checks, the calls. Polled. */
  loaded(): boolean;
  /** Why the stage cannot be shown (a run that does not load), or null. */
  problem(): string | null;
  dispose(): void;
}

export interface StageOptions {
  /** The server calls the stores make; tests pass fakes. */
  api?: RunApi;
  /** The scored numbers of a run (`GET /api/runs/{id}/metrics`). */
  official?: (runId: string) => Promise<Official | null>;
  /** The Muse lens's server calls, for the run stage. */
  lens?: LensApi;
}

type Settled = { events: unknown[]; loadError: string | null; loading: boolean; live: boolean; verify: { state: string } };

const sideOf = (store: RunStoreApi): RunSide => ({ events: () => store.getState().events, view: () => store.getState().view });

/** A recorded run whose log is in and whose replay check has an answer (a run still recording is never checked). */
const arrived = (s: Settled): boolean => !s.loading && (s.loadError !== null || (s.events.length > 0 && (s.live || s.verify.state === "done" || s.verify.state === "error")));

const problemOf = (...stores: RunStoreApi[]): string | null => {
  for (const store of stores) {
    const { runId, loadError } = store.getState();
    if (loadError !== null) return `could not load ${runId ?? "the run"}: ${loadError}`;
  }
  return null;
};

export interface Scored {
  left: Official | null;
  right: Official | null;
  /** Both answers are in, whatever they were. */
  settled: boolean;
}

export interface ArenaStage extends StageController {
  readonly kind: "arena";
  readonly session: PairSession;
  readonly left: string;
  readonly right: string;
  readonly scored: StoreApi<Scored>;
  readonly sides: { left: RunSide; right: RunSide };
}

/** The arena: the swarm run and its rival on one clock. */
export function createArenaStage(left: string, right: string, options: StageOptions = {}): ArenaStage {
  const session = createPairSession({ api: options.api, clock: takeClock() });
  const scored = createStore<Scored>(() => ({ left: null, right: null, settled: false }));
  const official = options.official ?? serverOfficial;
  let disposed = false;

  void session.open(left, right).then(async () => {
    if (disposed) return;
    for (const store of [session.left, session.right]) {
      const s = store.getState();
      if (!s.live && !s.loadError) void s.runVerify();
    }
    const [l, r] = await Promise.all([official(left).catch(() => null), official(right).catch(() => null)]);
    if (!disposed) scored.setState({ left: l, right: r, settled: true });
  });

  return {
    kind: "arena",
    session,
    left,
    right,
    scored,
    replay: clockReplay(session.clock),
    sides: { left: sideOf(session.left), right: sideOf(session.right) },
    lens: null,
    costs: () => [scored.getState().left?.costUsd ?? null, scored.getState().right?.costUsd ?? null],
    loaded: () => scored.getState().settled && arrived(session.left.getState()) && arrived(session.right.getState()),
    problem: () => problemOf(session.left, session.right),
    dispose() {
      disposed = true;
      session.dispose();
    },
  };
}

export interface RunStage extends StageController {
  readonly kind: "run";
  readonly runId: string;
  readonly store: RunStoreApi;
  readonly lensStore: LensStoreApi;
  readonly lens: LensHandle;
}

/** The Muse lens of a run, as a scene uses it: by the names the scene gave its calls. */
export function lensHandle(lens: LensStoreApi, picks: Readonly<Record<string, CallPick>>): LensHandle {
  return {
    open(name) {
      if (name === null) {
        lens.getState().close();
        return null;
      }
      const pick = picks[name];
      if (pick === undefined) return `call "${name}" is not in the scene's calls`;
      const call = pickCall(lens.getState().calls, pick);
      if (call === null) return `call "${name}" is not in the run`;
      lens.getState().openCall(call.effect_id);
      return null;
    },
    times: () => callTimes(lens.getState().calls, picks),
  };
}

function lensOf(store: RunStoreApi, api: LensApi | undefined): LensStoreApi {
  if (api === undefined) return lensStoreOf(store);
  const lens = createLensStore(store, { api });
  registerLensStore(store, lens);
  return lens;
}

/** The run page: one run, its tree, schedule, evidence strip and the Muse lens. */
export function createRunStage(runId: string, calls: Readonly<Record<string, CallPick>> = {}, options: StageOptions = {}): RunStage {
  const clock = createClock(takeClock());
  const store = createRunStore({ api: options.api, clock });
  const lens = lensOf(store, options.lens);
  const official = options.official ?? serverOfficial;
  const state = { scored: false, cost: null as number | null, details: false };
  let disposed = false;

  void (async () => {
    const s = store.getState();
    // what the app does when it opens a run: the catalog (the run's status), the server's capabilities, the run
    await Promise.all([s.loadRuns(), s.loadCapabilities()]).catch(() => undefined);
    if (disposed) return;
    await s.openRun(runId);
    if (disposed || store.getState().loadError !== null) return;
    await Promise.allSettled([s.runVerify(), s.runTakeover(), official(runId).then((o) => (state.cost = o?.costUsd ?? null), () => undefined)]);
    state.scored = true;
    // The lens loads its calls by itself once the run is open; the calls a scene opens are read in full now, so
    // opening one in a take shows it at once and not after however long the server took.
    await waitFor(() => ["ready", "unavailable", "error"].includes(lens.getState().status));
    if (disposed) return;
    const picks = Object.values(calls).flatMap((pick) => pickCall(lens.getState().calls, pick) ?? []);
    await Promise.allSettled(picks.map((call) => lens.getState().loadDetail(call.effect_id)));
    state.details = true;
  })();

  return {
    kind: "run",
    runId,
    store,
    lensStore: lens,
    replay: clockReplay(clock),
    sides: { left: sideOf(store), right: null },
    lens: lensHandle(lens, calls),
    costs: () => [state.cost],
    loaded() {
      const s = store.getState();
      const takeover = s.takeover.state;
      return arrived(s) && state.scored && state.details && (takeover === "done" || takeover === "absent" || takeover === "error" || s.live);
    },
    problem: () => problemOf(store),
    dispose() {
      disposed = true;
      clock.dispose();
    },
  };
}

/** Resolve when ``ready`` holds (checked every 50 ms of real time, a bounded number of times). */
async function waitFor(ready: () => boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
}

// ---- the replay note ----

const dollars = (usd: number): string => formatUsd(usd);

/** What the frame says about the replay (the video script asks for it wherever one is shown). "Real" only where the
 * server gave a cost above zero: a run on the practice model costs nothing and is never called real. */
export function replayNote(costs: readonly (number | null)[]): string {
  const real = costs.map((cost) => (cost !== null && cost > 0 ? cost : null));
  if (costs.length === 1) {
    return real[0] === null ? "Replay of a recorded run · practice model, no cost" : `Replay of a real recorded run · real cost ${dollars(real[0])}`;
  }
  const [swarm, rival] = real;
  if (swarm === null && rival === null) return "Replay of two recorded runs · practice model, no cost";
  if (swarm !== null && rival !== null) return `Replay of two real recorded runs · real cost ${dollars(swarm)} and ${dollars(rival)}`;
  return `Replay of two recorded runs · real cost ${swarm === null ? "none" : dollars(swarm)} (swarm), ${rival === null ? "none" : dollars(rival)} (rival)`;
}
