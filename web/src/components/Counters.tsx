import { useMemo } from "react";

import { BILLING, readFacts } from "../lib/catalogue";
import { defineTerm } from "../lib/glossary";
import { isInfraKind } from "../lib/layout";
import type { ViewState } from "../lib/reducer";
import { useRunStore } from "../store";
import { Stat } from "./ui";

export interface CountersProps {
  view: ViewState;
  /** Only the numbers that are the run's claim, for the line a run page opens with; the rest are under its Details. */
  headline?: boolean;
}

// The counters change many times a second while a replay plays, so they show the number as it is
// (animate={false}) instead of chasing it with a count-up.
export function Counters({ view, headline = false }: CountersProps) {
  const c = view.counters;
  const first = useRunStore((s) => s.events[0]);
  const notional = useMemo(() => readFacts(first, null).billed === false, [first]);
  const coordination = (
    <Stat hero animate={false} label="coordination tokens" value={c.coordinationTokens} hint={defineTerm("coordinationTokens")} />
  );
  const handovers = (
    <Stat
      animate={false}
      label="hand-overs"
      value={c.adoptions}
      hint="a dead coordinator's work taken over by a survivor. One coordinator's root duties and its subtree are two hand-overs, so there can be more of them than crashes"
    />
  );
  const spent = <Stat animate={false} label={notional ? "notional spend" : "spent"} prefix="$" value={c.spentUsd} decimals={4} hint={notional ? BILLING.notBilled.says : undefined} />;
  if (headline) {
    return (
      <div className="counters counters--headline">
        {coordination}
        {handovers}
        {spent}
      </div>
    );
  }
  const tree = view.order.filter((id) => !isInfraKind(view.actors[id].kind));
  const alive = tree.filter((id) => view.actors[id].status === "alive").length;
  const down = tree.filter((id) => ["killed", "dead", "restarting"].includes(view.actors[id].status)).length;
  return (
    <div className="counters">
      {coordination}
      {/* a finished run has no actor alive, and "0 alive" reads as if they had all died */}
      {view.completed ? (
        <Stat animate={false} label="actors" value="finished" hint="the run completed: every actor has stopped" />
      ) : (
        <Stat animate={false} label="actors alive" value={alive} />
      )}
      <Stat animate={false} label="down" value={down} tone={down > 0 ? "bad" : "neutral"} hint="killed, declared dead or restarting" />
      {handovers}
      <Stat animate={false} label="membership changes" value={view.memberEpoch} hint={defineTerm("memberEpoch")} />
      <Stat animate={false} label="LLM calls" value={c.llmCalls} />
      {spent}
      <Stat animate={false} label="messages" value={c.messages} />
    </div>
  );
}
