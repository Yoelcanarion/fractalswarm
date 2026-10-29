import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";

import { ClockScope } from "../components/ClockScope";
import { Skeleton, SkeletonGroup } from "../components/ui";
import { listRuns } from "../lib/api";
import type { RunListing } from "../lib/types";
import { RunStoreProvider } from "../store";
import "./arena.css";
import { fetchOfficial, fetchPairs, type PairListing } from "./api";
import { ArenaSide } from "./ArenaSide";
import { ArenaTimeline } from "./ArenaTimeline";
import { assumptionsOf, startedOf, systemKind } from "./assumptions";
import { frameOf, sharedFrames } from "./frame";
import type { Official } from "./official";
import { PairPicker } from "./PairPicker";
import { arenaHash, type ArenaRoute } from "./route";
import { Scoreboard } from "./Scoreboard";
import { createPairSession, type PairSession } from "./session";

const NO_OFFICIAL: { left: Official | null; right: Official | null } = { left: null, right: null };
const STEP_MS = 1000;

/** The arena: the swarm and its rival on one clock, face to face. */
export function ArenaPage({ route }: { route: ArenaRoute }) {
  // One session per visit. It is made in an effect, not in render, so that a development remount
  // (which runs the cleanup) never leaves the page holding a disposed clock.
  const [session, setSession] = useState<PairSession | null>(null);
  useEffect(() => {
    const made = createPairSession();
    setSession(made);
    return () => made.dispose();
  }, []);

  const [pairs, setPairs] = useState<PairListing[] | null>(null);
  const [runs, setRuns] = useState<RunListing[]>([]);
  useEffect(() => {
    let live = true;
    void fetchPairs().then((found) => live && setPairs(found), () => live && setPairs([]));
    void listRuns().then((found) => live && setRuns(found), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const [official, setOfficial] = useState(NO_OFFICIAL);
  const { left, right, playback } = route;

  // `#/arena` alone opens the newest pair on record. A private pair (live input) is never opened on its own.
  useEffect(() => {
    const newest = pairs?.find((pair) => !pair.private);
    if (!left && !right && newest) window.location.replace(arenaHash(newest.left, newest.right));
  }, [pairs, left, right]);
  useEffect(() => {
    if (!session || !left || !right) return;
    let live = true;
    setOfficial(NO_OFFICIAL);
    void session.open(left, right, playback).then(async () => {
      if (!live) return;
      // Replay both runs from their logs, as the run page does, and fetch the scored numbers.
      for (const store of [session.left, session.right]) {
        const s = store.getState();
        if (!s.live && !s.loadError) void s.runVerify();
      }
      const [l, r] = await Promise.all([fetchOfficial(left).catch(() => null), fetchOfficial(right).catch(() => null)]);
      if (live) setOfficial({ left: l, right: r });
    });
    return () => {
      live = false;
    };
    // The address decides the pair; its playback applies once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, left, right]);

  if (!session) return <ArenaSkeleton />;
  return (
    <RunStoreProvider store={session.left}>
      <ClockScope>
        <ArenaView session={session} pairs={pairs} runs={runs} official={official} left={left} right={right} />
      </ClockScope>
    </RunStoreProvider>
  );
}

export interface ArenaViewProps {
  session: PairSession;
  pairs: PairListing[] | null;
  runs: RunListing[];
  official: { left: Official | null; right: Official | null };
  left: string | null;
  right: string | null;
  /** Without the picker: a director's frame has no app chrome. What the rival is granted stays on screen. */
  bare?: boolean;
}

export function ArenaView({ session, pairs, runs, official, left, right, bare = false }: ArenaViewProps) {
  const { clock } = session;
  const leftEvents = useStore(session.left, (s) => s.events);
  const rightEvents = useStore(session.right, (s) => s.events);
  const leftLoading = useStore(session.left, (s) => s.loading);
  const rightLoading = useStore(session.right, (s) => s.loading);
  const leftError = useStore(session.left, (s) => s.loadError);
  const rightError = useStore(session.right, (s) => s.loadError);
  const loading = leftLoading || rightLoading;
  const loadError = leftError ?? rightError;
  const playing = useStore(clock.state, (s) => s.playing);
  const fixedStep = useStore(clock.state, (s) => s.mode === "fixed-step");

  const frames = useMemo(() => sharedFrames(frameOf(leftEvents), frameOf(rightEvents)), [leftEvents, rightEvents]);
  const assumptions = useMemo(() => assumptionsOf(startedOf(rightEvents), startedOf(leftEvents)), [leftEvents, rightEvents]);
  const leftSystem = useMemo(() => systemKind(String(startedOf(leftEvents)?.payload.scenario ?? "")), [leftEvents]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
    if (event.key === " ") {
      event.preventDefault();
      clock.setPlaying(!clock.state.getState().playing);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = (event.shiftKey ? 5 : 1) * STEP_MS * (event.key === "ArrowRight" ? 1 : -1);
      clock.setPlaying(false);
      clock.seekTime(Math.min(clock.end(), Math.max(0, clock.now() + step)));
    }
  };

  const chosen = Boolean(left && right);
  return (
    <div className="arena" tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="arena__bar">
        {!bare && <PairPicker left={left} right={right} pairs={pairs} runs={runs} />}
        {chosen && !loading && !loadError && (
          <p className="arena__assumptions" title="What the rival is granted. It comes from the run's own parameters.">
            {assumptions.caption}
          </p>
        )}
      </header>
      {!chosen && (
        <div className="empty">
          Choose a swarm run and a rival run above, or open <code>#/arena/&lt;swarm run&gt;/&lt;rival run&gt;</code>. A pair is made with{" "}
          <code>POST /api/arena</code> (the intake page) or by recording two runs with the same input, seed and failure plan.
        </div>
      )}
      {chosen && loading && <ArenaSkeleton />}
      {chosen && !loading && loadError && <div className="empty empty--bad">Could not load the pair: {loadError}</div>}
      {chosen && !loading && !loadError && (
        <>
          <div className="arena__stage">
            <ArenaSide store={session.left} role="swarm" title="FractalSwarm" system={leftSystem} frame={frames[0]} />
            <ArenaSide store={session.right} role="rival" title={capitalize(assumptions.name)} system={assumptions.system} frame={frames[1]} />
          </div>
          <Scoreboard left={session.left} right={session.right} official={official} playing={playing} fixedStep={fixedStep} />
          <ArenaTimeline clock={clock} left={session.left} right={session.right} />
        </>
      )}
    </div>
  );
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function ArenaSkeleton() {
  return (
    <SkeletonGroup label="Loading the pair">
      <div className="arena__stage">
        <Skeleton height={420} />
        <Skeleton height={420} />
      </div>
    </SkeletonGroup>
  );
}
