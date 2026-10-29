import { isInfraKind } from "../lib/layout";
import type { ViewState } from "../lib/reducer";
import { Stat } from "./ui";

// The counters change many times a second while a replay plays, so they show the number as it is
// (animate={false}) instead of chasing it with a count-up.
export function Counters({ view }: { view: ViewState }) {
  const c = view.counters;
  const tree = view.order.filter((id) => !isInfraKind(view.actors[id].kind));
  const alive = tree.filter((id) => view.actors[id].status === "alive").length;
  const down = tree.filter((id) => ["killed", "dead", "restarting"].includes(view.actors[id].status)).length;
  return (
    <div className="counters">
      <Stat
        hero
        animate={false}
        label="coordination tokens"
        value={c.coordinationTokens}
        hint="LLM tokens spent on membership, ownership and takeover"
      />
      <Stat animate={false} label="actors alive" value={alive} />
      <Stat animate={false} label="down" value={down} tone={down > 0 ? "bad" : "neutral"} hint="killed, declared dead or restarting" />
      <Stat animate={false} label="adoptions" value={c.adoptions} />
      <Stat animate={false} label="member epoch" value={view.memberEpoch} />
      <Stat animate={false} label="LLM calls" value={c.llmCalls} />
      <Stat animate={false} label="spent" prefix="$" value={c.spentUsd} decimals={4} />
      <Stat animate={false} label="messages" value={c.messages} />
    </div>
  );
}
