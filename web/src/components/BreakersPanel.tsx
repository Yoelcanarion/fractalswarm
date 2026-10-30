import { secondsUntilProbe, type BreakerKind, type BreakerState } from "../lib/breakers";
import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";
import { Term } from "./ui";

const STATE: Record<BreakerState, { label: string; tone: "good" | "warn" | "bad" }> = {
  closed: { label: "closed", tone: "good" },
  half_open: { label: "half-open", tone: "warn" },
  open: { label: "open", tone: "bad" },
};

const KIND: Record<BreakerKind, string> = {
  model: "model endpoint",
  channel: "orchestrator channel",
  topic: "topic storm",
  global: "global spend",
  other: "breaker",
};

const NET_FAULTS = [
  ["drop", "dropped"],
  ["delay", "delayed"],
  ["duplicate", "duplicated"],
  ["reorder", "reordered"],
  ["partition_drop", "cut by a partition"],
] as const;

export function BreakersPanel({ view }: { view: ViewState }) {
  const { breakers, limits } = view.panels;
  const rows = breakers.order.map((name) => breakers.rows[name]);
  // A model that has been called and never tripped is a closed breaker, even without an event.
  const quiet = limits.order.filter((model) => !breakers.rows[`model:${model}`]).map((model) => limits.models[model]);
  const open = rows.filter((row) => row.state !== "closed").length;
  const faults = NET_FAULTS.map(([key, label]) => [label, view.netFaults[key] ?? 0] as const);
  const history = rows
    .flatMap((row) => row.history.map((h) => ({ ...h, name: row.name })))
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 6);

  return (
    <Card title={<Term id="breaker" focusable={false}>Breakers</Term>} hint="what stopped calls, and when it let them through again">
      <div className="pstats">
        <PStat label="breakers" value={rows.length + quiet.length} />
        <PStat label="not closed" value={open} tone={open > 0 ? "bad" : ""} />
        <PStat label="trips" value={rows.reduce((sum, row) => sum + row.trips, 0)} />
        <PStat label="transitions" value={breakers.transitions} />
        {breakers.mailbox.deliveries > 0 && (
          <PStat
            label="mailbox"
            value={breakers.mailbox.items}
            tone={breakers.mailbox.dropped > 0 ? "bad" : ""}
            title={`${breakers.mailbox.items} messages an open channel diverted, handed over in ${breakers.mailbox.deliveries} deliveries; ${breakers.mailbox.dropped} dropped`}
          />
        )}
      </div>

      {rows.length + quiet.length === 0 && <Nothing>No model has been called yet.</Nothing>}
      <ul className="blist">
        {rows.map((row) => {
          const wait = secondsUntilProbe(row, view.lastTs);
          return (
            <li key={row.name} className={`brow brow--${row.state}`}>
              <Pill tone={STATE[row.state].tone}>{STATE[row.state].label}</Pill>
              <b className="mono">{row.name}</b>
              <span className="muted">{KIND[row.kind]} · {row.trips} trip{row.trips === 1 ? "" : "s"}</span>
              {row.state === "open" && (
                <span className="brow__why">
                  {row.reason}
                  {wait !== null && ` · probe in ${wait.toFixed(1)} s`}
                </span>
              )}
            </li>
          );
        })}
        {quiet.map((model) => (
          <li key={model.model} className="brow brow--closed">
            <Pill tone="good">closed</Pill>
            <b className="mono">model:{model.model}</b>
            <span className="muted">
              model endpoint · never tripped · {model.throttled + model.failed} failures, {model.retries} retries
            </span>
          </li>
        ))}
      </ul>

      <Subhead hint="what the channel breaker watches">Network faults injected</Subhead>
      <div className="faults">
        {faults.map(([label, count]) => (
          <div key={label} className={count > 0 ? "fault fault--on" : "fault"}>
            <b className="mono">{count.toLocaleString("en")}</b>
            <span className="muted">{label}</span>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <>
          <Subhead>Latest transitions</Subhead>
          <ol className="generic__list">
            {history.map((h) => (
              <li key={`${h.name}-${h.seq}`}>
                <span className="mono muted">{h.seq}</span> <b>{h.name}</b> {h.event.replace("_", "-")} <span className="muted">by {h.actor} · t = {virtualSeconds(h.ts)}{h.reason ? ` · ${h.reason}` : ""}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <GenericRows rows={breakers.other} title="Breaker events this panel does not read yet" />
    </Card>
  );
}
