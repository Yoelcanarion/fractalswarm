import { useMemo } from "react";
import { useStore } from "zustand";

import { arenaCounters } from "../lib/arena";
import type { RunStoreApi } from "../store";
import { startedOf, type Assumptions, type SystemKind } from "./assumptions";
import { pairEndText, type EndSide } from "./pairEndText";
import { talksTotal, workOf } from "./work";

const NOT_YET: Omit<EndSide, "system"> = { finished: false, completed: false, crashes: 0, duplicatedCalls: 0, placed: 0, total: null };

/** One side's figures at the end of its run. Nothing is counted until the replay has played the run out. */
function useEndSide(store: RunStoreApi, system: SystemKind): EndSide {
  const view = useStore(store, (s) => s.view);
  const events = useStore(store, (s) => s.events);
  const finished = useStore(store, (s) => !s.live && s.events.length > 0 && s.cursor >= s.events.length);
  return useMemo(() => {
    if (!finished) return { system, ...NOT_YET };
    const counters = arenaCounters(view, events.at(-1)?.ts_virtual ?? 0);
    const work = workOf(view, talksTotal(startedOf(events)));
    return {
      system,
      finished,
      completed: view.completed,
      crashes: counters.coordinatorCrashes,
      duplicatedCalls: counters.duplicatedCalls,
      placed: work.placed,
      total: work.total,
    };
  }, [view, events, finished, system]);
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
  if (!l.finished || !r.finished) return null;
  const text = pairEndText(l, r, assumptions);
  return (
    <section className="pairend" role="status" aria-label="How this pair ended">
      <h2 className="pairend__title">{text.headline}</h2>
      <dl className="pairend__sides">
        {text.sides.map((side) => (
          <div key={side.who} className="pairend__side">
            <dt>{side.who}</dt>
            <dd>{side.text}</dd>
          </div>
        ))}
      </dl>
      <p className="pairend__scope">
        {text.scope} <a href="#/helps">Trade-offs</a> shows when this holds, and <a href="#/evidence">the Evidence page</a> has the numbers over ten seeds.
      </p>
    </section>
  );
}
