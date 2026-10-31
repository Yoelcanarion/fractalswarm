import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "zustand";

import { ClockScope } from "../components/ClockScope";
import { EmptyState, PageHeader, Skeleton, SkeletonGroup } from "../components/ui";
import { listRuns } from "../lib/api";
import { readFacts } from "../lib/catalogue";
import { useRoom } from "../lib/room";
import type { RunListing } from "../lib/types";
import { RunStoreProvider, type RunStoreApi } from "../store";
import "./arena.css";
import { fetchOfficial, fetchPairs, type PairListing } from "./api";
import { ArenaPlay } from "./ArenaPlay";
import { ArenaSide } from "./ArenaSide";
import { ArenaTimeline } from "./ArenaTimeline";
import { assumptionsOf, rivalSentence, startedOf, systemKind } from "./assumptions";
import { frameOf, sharedFrames } from "./frame";
import { keyAction } from "./keys";
import type { Official } from "./official";
import { PairEnd } from "./PairEnd";
import { PairPicker } from "./PairPicker";
import { playedOut } from "./playedOut";
import { arenaHash, type ArenaRoute } from "./route";
import { Scoreboard } from "./Scoreboard";
import { createPairSession, whenSettled, type PairSession } from "./session";

const NO_OFFICIAL: { left: Official | null; right: Official | null } = { left: null, right: null };
// The failure plan's crash points are points of the work, not of time (profiles.py, half_the_brains_plan): on the shared clock the first kill
// does not fall at the same second on both sides. "About" because the logs put one crash a step apart (the durable pair's fourth: progress 0.67
// on one side, 0.72 on the other).
const LEAD = "FractalSwarm, on the left, and a rival, on the right, plan the same conference under the same failures, each at about the same point of the work.";
// A pair whose plan is named same-moment takes its kills by hand, at fixed seconds of the shared clock: it is a film for the eye, not the benchmark's rule.
const LEAD_SAME_MOMENT = "FractalSwarm, on the left, and a rival, on the right, plan the same conference, and a coordinator falls on each side at the same second. We set these kills by hand: the benchmark's rule hits each side at the same point of the work instead.";
// True of every pair. It stands until the pair is known: one pair's rule is false of the other, and a log takes seconds to load.
const LEAD_ANY_PAIR = "FractalSwarm, on the left, and a rival, on the right, plan the same conference.";
const leadOf = (plan: string | null): string => (plan === "same-moment" ? LEAD_SAME_MOMENT : LEAD);
const PRACTICE = "Both ran on the free practice model: nothing was billed, and their costs are only notional.";

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

  // `#/arena` alone opens the first pair on record: the recorded ones that ship with the repository come first. A private
  // pair (live input) is never opened on its own.
  useEffect(() => {
    const newest = pairs?.find((pair) => !pair.private);
    if (!left && !right && newest) window.location.replace(arenaHash(newest.left, newest.right));
  }, [pairs, left, right]);
  useEffect(() => {
    if (!session || !left || !right) return;
    let live = true;
    const waiting: (() => void)[] = [];
    setOfficial(NO_OFFICIAL);
    void session.open(left, right, playback).then(() => {
      if (!live) return;
      // Replay each run from its log, as the run page does, and fetch its scored numbers, once it has stopped recording.
      const settle = (store: RunStoreApi, run: string, side: keyof typeof NO_OFFICIAL) =>
        whenSettled(store, () => {
          const s = store.getState();
          if (!s.loadError) void s.runVerify();
          void fetchOfficial(run)
            .catch(() => null)
            .then((scored) => {
              if (live) setOfficial((known) => ({ ...known, [side]: scored }));
            });
        });
      waiting.push(settle(session.left, left, "left"), settle(session.right, right, "right"));
    });
    return () => {
      live = false;
      for (const stop of waiting) stop();
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
  // The end of the pair says the one-run caveat in full, so the scoreboard's is left out once both runs have played out (a director's frame has no end card).
  const leftPlayedOut = useStore(session.left, playedOut);
  const rightPlayedOut = useStore(session.right, playedOut);
  const finished = leftPlayedOut && rightPlayedOut;
  const root = useRef<HTMLDivElement>(null);
  useRoom(root, "--arena-room");

  const frames = useMemo(() => sharedFrames(frameOf(leftEvents), frameOf(rightEvents)), [leftEvents, rightEvents]);
  const assumptions = useMemo(() => assumptionsOf(startedOf(rightEvents), startedOf(leftEvents)), [leftEvents, rightEvents]);
  const leftSystem = useMemo(() => systemKind(String(startedOf(leftEvents)?.payload.scenario ?? "")), [leftEvents]);
  const practice = useMemo(() => [leftEvents, rightEvents].every((events) => readFacts(events[0], null).billed === false), [leftEvents, rightEvents]);
  // The log has the last word. While it loads, the list of pairs, which comes first, names the plan.
  const lead = useMemo(() => {
    if (!leftLoading && leftEvents.length > 0) return leadOf(readFacts(leftEvents[0], null).profile);
    const pair = pairs?.find((found) => found.left === left && found.right === right);
    return pair ? leadOf(pair.chaos) : LEAD_ANY_PAIR;
  }, [leftEvents, leftLoading, pairs, left, right]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
    const action = keyAction(event.key, event.shiftKey, clock.now(), clock.end());
    if (action === null) return;
    event.preventDefault();
    if ("toggle" in action) {
      clock.setPlaying(!clock.state.getState().playing);
    } else {
      clock.setPlaying(false);
      clock.seekTime(action.seek);
    }
  };

  const chosen = Boolean(left && right);
  // `#/arena` alone opens the first public pair: until it has, it is not an empty page
  const opening = !chosen && (pairs === null || pairs.some((pair) => !pair.private));
  const watching = chosen && !loading && !loadError;
  return (
    <div ref={root} className={["arena", finished && "arena--played-out", bare && "arena--bare"].filter(Boolean).join(" ")} tabIndex={-1} onKeyDown={onKeyDown}>
      {!bare && (
        <PageHeader
          compact
          title="Arena"
          lead={watching ? [lead, rivalSentence(assumptions), practice ? PRACTICE : ""].filter(Boolean).join(" ") : lead}
          actions={watching && <ArenaPlay clock={clock} left={session.left} right={session.right} />}
        />
      )}
      <header className="arena__bar">
        {!bare && <PairPicker left={left} right={right} pairs={pairs} runs={runs} />}
        {chosen && !loading && !loadError && (
          <p className="arena__assumptions" title="What the rival is granted. It comes from the run's own parameters.">
            {assumptions.caption}
          </p>
        )}
      </header>
      {opening && <ArenaSkeleton />}
      {!chosen && !opening && (
        <EmptyState
          title="No pair to watch yet"
          actions={
            <>
              <a className="btn btn--on" href="#/new">
                Start a pair
              </a>
              <a className="btn" href="#/runs">
                Open the runs
              </a>
            </>
          }
        >
          A pair is the swarm and a rival running the same job under the same failures. Pick one above, or start one of your own: on the practice model it is free.
        </EmptyState>
      )}
      {chosen && loading && <ArenaSkeleton />}
      {chosen && !loading && loadError && (
        <EmptyState
          tone="bad"
          title="Could not load the pair"
          actions={
            <>
              <button type="button" className="btn btn--on" onClick={() => window.location.reload()}>
                Try again
              </button>
              <a className="btn" href="#/runs">
                Open the runs
              </a>
            </>
          }
        >
          {loadError}
        </EmptyState>
      )}
      {chosen && !loading && !loadError && (
        <>
          <div className="arena__stage">
            <ArenaSide store={session.left} role="swarm" title="FractalSwarm" system={leftSystem} frame={frames[0]} />
            <ArenaSide store={session.right} role="rival" title={capitalize(assumptions.name)} system={assumptions.system} frame={frames[1]} />
          </div>
          {!bare && <PairEnd left={session.left} right={session.right} leftSystem={leftSystem} assumptions={assumptions} />}
          <Scoreboard left={session.left} right={session.right} official={official} playing={playing} fixedStep={fixedStep} caveat={bare || !finished} />
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
