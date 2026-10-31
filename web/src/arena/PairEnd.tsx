import { useMemo } from "react";
import { useStore } from "zustand";

import { Details } from "../components/ui";
import { resultsHash } from "../lib/address";
import { arenaCounters } from "../lib/arena";
import { readFacts } from "../lib/catalogue";
import type { RunEvent } from "../lib/types";
import type { RunStoreApi } from "../store";
import { startedOf, type Assumptions, type SystemKind } from "./assumptions";
import { pairEndText, type EndSide } from "./pairEndText";
import { playedOut } from "./playedOut";
import { talksTotal, workOf } from "./work";

const NOT_YET: Omit<EndSide, "system"> = { finished: false, completed: false, crashes: 0, handOvers: null, duplicatedCalls: 0, placed: 0, total: null };

/** The kills of agents a log holds (lib/timeline.ts reads the same event). */
const agentKills = (events: readonly RunEvent[]): number =>
  events.filter((e) => e.type === "chaos.injected" && String(e.payload.fault ?? e.payload.kind ?? "") === "kill_agent").length;

/** One side's figures at the end of its run. Nothing is counted until the replay has played the run out. */
function useEndSide(store: RunStoreApi, system: SystemKind): EndSide {
  const view = useStore(store, (s) => s.view);
  const events = useStore(store, (s) => s.events);
  const finished = useStore(store, playedOut);
  const takeover = useStore(store, (s) => s.takeover);
  return useMemo(() => {
    if (!finished) return { system, ...NOT_YET };
    const counters = arenaCounters(view, events.at(-1)?.ts_virtual ?? 0);
    const work = workOf(view, talksTotal(startedOf(events)));
    return {
      system,
      finished,
      completed: view.completed,
      crashes: counters.coordinatorCrashes,
      agentsKilled: agentKills(events),
      handOvers: takeover.state === "done" ? takeover.report.heirs : null,
      duplicatedCalls: counters.duplicatedCalls,
      placed: work.placed,
      total: work.total,
    };
  }, [view, events, finished, takeover, system]);
}

export interface PairEndProps {
  left: RunStoreApi;
  right: RunStoreApi;
  leftSystem: SystemKind;
  assumptions: Assumptions;
}

/** When both runs have played out: what each did, and that one pair is one run on one seed. Nothing before that. */
export function PairEnd({ left, right, leftSystem, assumptions }: PairEndProps) {
  const l = useEndSide(left, leftSystem);
  const r = useEndSide(right, assumptions.system);
  const leftRun = useStore(left, (s) => s.runId);
  const rightRun = useStore(right, (s) => s.runId);
  const byHand = useStore(left, (s) => readFacts(s.events[0], null).profile === "same-moment");
  if (!l.finished || !r.finished) return null;
  const text = pairEndText(l, r, assumptions, byHand);
  const ends = [
    { side: l, run: leftRun },
    { side: r, run: rightRun },
  ];
  return (
    <section className="pairend" role="status" aria-label="How this pair ended">
      <h2 className="pairend__title">{text.headline}</h2>
      <dl className="pairend__sides">
        {text.sides.map((side, index) => {
          const { side: end, run } = ends[index];
          return (
            <div key={side.who} className="pairend__side">
              <dt>{side.who}</dt>
              <dd>
                {side.text}
                {end.completed && run !== null && (
                  <>
                    {" "}
                    <a href={resultsHash(run)}>{end.total === null ? "See its result" : "See its program"}</a>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="pairend__scope">
        {text.scope} <a href="#/helps">Trade-offs</a> shows when this holds, and <a href="#/charts">Charts</a> has the numbers over ten seeds.
      </p>
      {text.more.length > 0 && (
        <Details inline summary="More on this pair">
          {text.more.map((line) => (
            <p key={line} className="pairend__more">
              {line}
            </p>
          ))}
        </Details>
      )}
    </section>
  );
}
