import type { ViewState } from "../lib/reducer";

export function Counters({ view }: { view: ViewState }) {
  const c = view.counters;
  const alive = view.order.filter((id) => view.actors[id].status === "alive").length;
  const down = view.order.filter((id) => ["killed", "dead"].includes(view.actors[id].status)).length;
  return (
    <div className="counters">
      <div className="stat stat--hero" title="LLM tokens spent on membership, ownership and takeover">
        <div className="stat__value">{c.coordinationTokens.toLocaleString("en")}</div>
        <div className="stat__label">coordination tokens</div>
      </div>
      <Stat label="actors alive" value={`${alive}`} />
      <Stat label="killed / dead" value={`${down}`} bad={down > 0} />
      <Stat label="adoptions" value={`${c.adoptions}`} />
      <Stat label="member epoch" value={`${view.memberEpoch}`} />
      <Stat label="LLM calls" value={`${c.llmCalls}`} />
      <Stat label="spent" value={`$${c.spentUsd.toFixed(4)}`} />
      <Stat label="messages" value={`${c.messages}`} />
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`stat ${bad ? "stat--bad" : ""}`}>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}
