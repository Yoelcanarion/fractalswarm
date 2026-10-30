import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { conserved, headline } from "../lib/auction";
import { burnRate, committed, ladderLevel, LADDER, runCap, type LadderLevel } from "../lib/economy";
import { axis, GRID, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE } from "../lib/chart";
import { useFirstDraw } from "../lib/chartMotion";
import { compact } from "../lib/generic";
import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, money, Nothing, Pill, PStat, Subhead, virtualSeconds } from "./PanelParts";
import { Term } from "./ui";

const AXIS = axis(12);

const LEVELS: Record<LadderLevel, { label: string; tone: "good" | "warn" | "bad"; what: string }> = {
  L0: { label: "L0", tone: "good", what: "normal" },
  L1: { label: "L1", tone: "warn", what: "cheaper models" },
  L2: { label: "L2", tone: "warn", what: "critical path only" },
  stop: { label: "stop", tone: "bad", what: "partial result" },
};

// What each level of the budget ladder changes.
const LADDER_MEANING: Record<LadderLevel, string> = {
  L0: "full models, speculative execution allowed",
  L1: "cheaper model or effort, no speculative execution, scale down",
  L2: "cheaper still: only the critical path continues",
  stop: "the run returns a partial result with explicit gaps and a resumable checkpoint",
};

type SpendPoint = { t: number; spent: number; committed: number; cap: number | null };

// The chart is its own component so that it animates the first time it appears (when the first
// call settles), not on every tick of the replay after that.
function SpendChart({ data, shocks }: { data: SpendPoint[]; shocks: { seq: number; ts: number }[] }) {
  const draw = useFirstDraw();
  return (
    <ResponsiveContainer width="100%" height={140}>
      <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} {...AXIS} tickFormatter={(t) => `${Math.round(t)}s`} />
        <YAxis {...AXIS} width={52} tickFormatter={(v) => money(Number(v), 2)} domain={[0, "auto"]} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          labelFormatter={(t) => `t = ${Number(t).toFixed(1)} s`}
          formatter={(value, name) => [typeof value === "number" ? money(value, 4) : String(value), String(name)]}
        />
        <Area dataKey="spent" name="spent" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} strokeWidth={2} {...draw} />
        <Line dataKey="committed" name="spent + reserved" stroke="var(--warn)" strokeWidth={1.5} dot={false} {...draw} />
        <Line dataKey="cap" name="cap" stroke="var(--danger)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} type="stepAfter" {...draw} />
        {shocks.map((shock) => (
          <ReferenceLine key={shock.seq} x={shock.ts / 1000} stroke="var(--danger)" strokeOpacity={0.8} label={{ value: "shock", fill: "var(--danger-text)", fontSize: 12, position: "insideTopLeft" }} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MarketPanel({ view }: { view: ViewState }) {
  const { economy } = view.panels;
  const cap = runCap(economy);
  const used = committed(economy);
  const share = cap && cap > 0 ? used / cap : cap === 0 ? 1 : 0;
  const level = ladderLevel(used, cap);
  const burn = burnRate(economy, view.lastTs);
  const squads = Object.values(economy.squads)
    .filter((row) => row.spent > 0 || row.reserved > 0 || row.refused > 0 || row.cap !== null)
    .sort((a, b) => b.spent + b.reserved - (a.spent + a.reserved) || a.squad.localeCompare(b.squad));
  const mostSpent = Math.max(...squads.map((row) => row.spent + row.reserved), 1e-9);
  const { auction } = view.panels;
  const head = headline(auction);
  const headEpoch = head && [...auction.epochs].reverse().find((e) => e.goalId === head.goalId && e.epoch === head.epoch);
  const auctionOn = auction.epochCount > 0 || head !== null || auction.topups.length > 0 || auction.scaling.length > 0;
  const roles = Object.values(economy.roles).sort((a, b) => b.usd - a.usd);
  const models = Object.values(economy.models).sort((a, b) => b.usd - a.usd);
  const data = useMemo(
    () => economy.burn.map((p) => ({ t: p.ts / 1000, spent: p.spent, committed: p.spent + p.reserved, cap: p.cap })),
    [economy.burn],
  );
  const shocks = economy.capChanges.filter((change) => change.shock);
  const hasEvents = economy.refusals.length > 0 || economy.capChanges.length > 0 || economy.halted !== null;

  return (
    <Card
      title="Market & budget"
      wide
      hint={
        <>
          {view.marketEpoch > 0 && (
            <>
              <Term id="marketEpoch">market epoch</Term> {view.marketEpoch} ·{" "}
            </>
          )}
          {economy.settled} calls settled · {economy.cancelled} cancelled in flight
        </>
      }
    >
      <div className="pstats">
        <PStat label="run cap" value={cap === null ? "none" : money(cap, 2)} />
        <PStat label="spent" value={money(economy.spentUsd)} />
        <PStat label="reserved" value={money(economy.reservedUsd)} title="open reservations: money held for calls in flight" />
        <PStat label="left" value={cap === null ? "–" : money(Math.max(cap - used, 0))} tone={level === "L0" ? "" : LEVELS[level].tone} />
        <PStat
          label="burn / min"
          value={money(burn.perMinute, 3)}
          title={`spend settled in the last minute of virtual time${
            burn.limit === null ? "" : `; the global spend breaker trips above ${money(burn.limit)} (20% of what is left)`
          }`}
        />
        <PStat
          label={`ladder · ${LEVELS[level].what}`}
          value={LEVELS[level].label}
          tone={LEVELS[level].tone}
          title={`${LEVELS[level].what}: ${LADDER_MEANING[level]}`}
        />
        <PStat label="refused" value={economy.refusedCount} tone={economy.refusedCount > 0 ? "bad" : ""} title="calls the budget caps refused" />
      </div>

      <div className="ladder" title="committed money (spent + reserved) against the run cap; the model ladder steps down at 80, 90 and 95%">
        <i className={`ladder__fill ladder__fill--${LEVELS[level].tone}`} style={{ width: `${Math.min(share, 1) * 100}%` }} />
        {[LADDER.L1, LADDER.L2, LADDER.stop].map((at, i) => (
          <b key={at} className="ladder__tick" style={{ left: `${at * 100}%` }}>
            <span>{["L1", "L2", "stop"][i]}</span>
          </b>
        ))}
      </div>

      <div className="pcols">
        <div className="pcol">
          <Subhead hint={burn.limit === null ? "virtual seconds" : `the spend breaker trips above ${money(burn.limit, 3)}/min`}>Spend over time</Subhead>
          {data.length < 2 ? (
            <Nothing>No call has been settled yet.</Nothing>
          ) : (
            <SpendChart data={data} shocks={shocks} />
          )}
          {hasEvents && (
            <div className="pevents">
              {economy.capChanges.map((change) => (
                <div key={change.seq} className={`pevent ${change.shock ? "pevent--warn" : ""}`}>
                  <Pill tone={change.shock ? "warn" : ""}>{change.shock ? "budget shock" : "cap set"}</Pill> t = {virtualSeconds(change.ts)} {change.level} {change.key} →{" "}
                  {money(change.usd, 2)}
                  {change.reason ? ` (${change.reason})` : ""}
                </div>
              ))}
              {economy.refusedCount > 0 && (
                <div className="pevent pevent--bad">
                  <Pill tone="bad">{economy.refusedCount} refused</Pill>
                  {economy.refusals.length > 0 && (
                    <>
                      {" "}
                      latest t = {virtualSeconds(economy.refusals.at(-1)!.ts)}: {economy.refusals.at(-1)!.actor} wanted {money(economy.refusals.at(-1)!.usd, 3)}, over the{" "}
                      {economy.refusals.at(-1)!.level} cap ({economy.refusals.at(-1)!.key})
                    </>
                  )}
                </div>
              )}
              {economy.halted && (
                <div className="pevent pevent--bad">
                  <Pill tone="bad">halted</Pill> t = {virtualSeconds(economy.halted.ts)} by {economy.halted.by}: {economy.halted.reason}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pcol">
          <Subhead hint={`${squads.length} squads · top 5`}>Who spends: by squad</Subhead>
          {squads.length === 0 ? (
            <Nothing>No reservation yet.</Nothing>
          ) : (
            <ul className="bars">
              {squads.slice(0, 5).map((row) => {
                const used = row.spent + row.reserved;
                // A squad the market has capped is measured against its cap, the rest against the biggest spender.
                const capped = row.cap !== null && row.cap > 0;
                const filled = Math.min(used / (capped ? row.cap! : mostSpent), 1);
                return (
                  <li key={row.squad} title={`${row.calls} calls${row.refused ? `, ${row.refused} refused` : ""}`}>
                    <span className="mono bars__name">{row.squad}</span>
                    <span className="bars__track">
                      <i className={capped && filled >= 0.9 ? "bars__fill--bad" : ""} style={{ width: `${filled * 100}%` }} />
                    </span>
                    <span className="mono bars__value">{money(used)}</span>
                    <span className="muted bars__calls">{row.cap !== null ? `of ${money(row.cap, 2)}` : `${row.calls} calls`}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {auctionOn && (
            <div className="auction">
              <Subhead
                hint={`${auction.epochCount} epochs · ${auction.bidSets} bid sets · refunds ${money(auction.refundedUsd, 3)} · top-ups ${money(auction.grantedUsd, 3)} of ${money(auction.requestedUsd, 3)}`}
              >
                Epoch auction
              </Subhead>
              {head && (
                <div className="auction__line">
                  <b className="mono">{head.goalId}</b> e{head.epoch}
                  {headEpoch ? ` (${headEpoch.reason})` : ""} cleared {head.mode}: envelope {money(head.envelopeUsd, 3)} = grants{" "}
                  {money(head.grants.reduce((sum, g) => sum + g.usd, 0), 3)} + pool {money(head.poolUsd, 3)} + reserve {money(head.reserveUsd, 3)}{" "}
                  <Pill tone={conserved(head) ? "good" : "bad"}>{conserved(head) ? "adds up ✓" : "does not add up"}</Pill>
                </div>
              )}
              {head && head.grants.length > 0 && (
                <div className="spendchips">
                  {head.grants.slice(0, 5).map((grant) => (
                    <span key={grant.child} className="spendchip" title="granted to this child for the next epoch">
                      <b>{grant.child}</b> {money(grant.usd, 3)}
                    </span>
                  ))}
                </div>
              )}
              {auction.epochs.length > 0 && (
                <div className="spendchips">
                  {auction.epochs.slice(-5).map((epoch) => (
                    <span key={epoch.seq} className="spendchip" title={`t = ${virtualSeconds(epoch.ts)} · ${epoch.completions} completions`}>
                      {epoch.goalId} e{epoch.epoch} <span className="muted">{epoch.reason}</span>
                    </span>
                  ))}
                </div>
              )}
              {auction.scaling.slice(-2).map((decision) => (
                <div key={decision.seq} className="auction__line">
                  <b className="mono">{decision.owner}</b> {decision.kind} {decision.before} → {decision.after} <span className="muted">{decision.reason}</span>
                </div>
              ))}
            </div>
          )}
          <Subhead hint="calls · spent">By role</Subhead>
          <div className="spendchips">
            {roles.map((row) => (
              <span key={row.role} className="spendchip">
                <b>{row.role}</b> {row.calls} · {money(row.usd)}
              </span>
            ))}
          </div>
          <Subhead hint="calls · spent · tokens in / out">By model</Subhead>
          <div className="spendchips">
            {models.map((row) => (
              <span key={row.model} className="spendchip">
                <b>{row.model.replace("muse-", "")}</b> {row.calls} · {money(row.usd)} · {compact(row.inputTokens)} / {compact(row.outputTokens)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <GenericRows rows={economy.other} title="Market events (epochs, bids, allocations) this panel does not read yet" />
    </Card>
  );
}
