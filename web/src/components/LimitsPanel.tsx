import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { compact } from "../lib/generic";
import { remainingShare, requestsPerMinute, type ModelLimits, type Quota } from "../lib/limits";
import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, Meter, Nothing, Pill, PStat, Subhead } from "./PanelParts";

const tone = (share: number | null): "good" | "warn" | "bad" | "" =>
  share === null ? "" : share < 0.1 ? "bad" : share < 0.3 ? "warn" : "";

// How the quota moved at the last epoch (market/quotas.py).
const CHANGE: Record<string, string> = {
  init: "starts at 50%",
  decrease: "×0.7 after a 429",
  increase: "+5 points: a clean epoch",
  hold: "held",
};

function QuotaMeter({ quota }: { quota: Quota }) {
  const rpm = quota.rpm === null ? "?" : quota.rpm.toLocaleString("en");
  const limit = quota.limitRpm === null ? "?" : quota.limitRpm.toLocaleString("en");
  return (
    <Meter
      share={quota.fraction}
      label={`AIMD quota · epoch ${quota.epoch} · ${CHANGE[quota.change] ?? quota.change}`}
      detail={`${rpm} of ${limit} rpm${quota.fraction === null ? "" : ` · ${Math.round(quota.fraction * 100)}%`}`}
      tone={quota.pressure || quota.change === "decrease" ? "warn" : ""}
    />
  );
}

export function LimitsPanel({ view }: { view: ViewState }) {
  const { limits } = view.panels;
  const names = [...limits.order, ...limits.quotaOrder.filter((name) => !limits.models[name])];
  const models = limits.order.map((name) => limits.models[name]);
  const throttled = models.reduce((sum, m) => sum + m.throttled, 0);
  const retries = models.reduce((sum, m) => sum + m.retries, 0);
  const history = limits.history.map((point) => ({ t: point.ts / 1000, rpm: point.rpm }));

  return (
    <Card title="Rate limits" hint="what the model endpoint reported">
      <div className="pstats">
        <PStat label="requests / min" value={requestsPerMinute(limits, view.lastTs)} title="requests that left in the last minute of virtual time" />
        <PStat label="in flight" value={limits.inflight} title={`most at once: ${limits.peakInflight}`} />
        <PStat label="429s" value={throttled} tone={throttled > 0 ? "bad" : ""} title="calls whose final answer was 429" />
        <PStat label="retries" value={retries} tone={retries > 0 ? "warn" : ""} title="attempts beyond the first, summed" />
      </div>

      {history.length > 1 && (
        <>
          <Subhead hint={`requests in the last 60 s · most in flight at once: ${limits.peakInflight}`}>Request rate</Subhead>
          <ResponsiveContainer width="100%" height={52}>
            <AreaChart data={history} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} hide />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip contentStyle={{ background: "#1f1f1d", border: "1px solid #3a3936", borderRadius: 8 }} labelFormatter={(t) => `t = ${Number(t).toFixed(1)} s`} formatter={(v) => [String(v), "requests / min"]} />
              <Area dataKey="rpm" stroke="#199e70" fill="#199e70" fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}

      {names.length === 0 ? (
        <Nothing>No model call has completed yet.</Nothing>
      ) : (
        names.map((name) => {
          const m: ModelLimits | undefined = limits.models[name];
          const quota: Quota | undefined = limits.quotas[name];
          const requests = m ? remainingShare(m.remainingRequests, m.limitRequests) : null;
          const tokens = m ? remainingShare(m.remainingTokens, m.limitTokens) : null;
          return (
            <div key={name} className="limit">
              <div className="limit__head">
                <b className="mono">{name}</b>
                {m ? (
                  <span className="muted">{m.calls} calls · {m.calls ? Math.round(m.latencyMs / m.calls).toLocaleString("en") : 0} ms mean</span>
                ) : (
                  <span className="muted">no call yet</span>
                )}
                {m && m.throttled > 0 && <Pill tone="bad">{m.throttled} × 429</Pill>}
                {m && m.failed > 0 && <Pill tone="bad">{m.failed} failed</Pill>}
                {m && m.retries > 0 && <Pill tone="warn">{m.retries} retries</Pill>}
                {m && m.retryAfterMs !== null && <Pill tone="warn">Retry-After {(m.retryAfterMs / 1000).toFixed(0)} s</Pill>}
                {quota && quota.pressure && <Pill tone="warn">pressure</Pill>}
                {quota && (quota.decreases > 0 || quota.increases > 0) && (
                  <span className="muted" title="how often the quota moved">
                    ↓{quota.decreases} ↑{quota.increases}
                  </span>
                )}
              </div>
              {m && (
                <>
                  <Meter
                    share={requests}
                    label="requests left"
                    detail={m.remainingRequests === null ? undefined : `${m.remainingRequests.toLocaleString("en")} of ${m.limitRequests?.toLocaleString("en") ?? "?"}`}
                    tone={tone(requests)}
                  />
                  <Meter
                    share={tokens}
                    label="tokens left"
                    detail={m.remainingTokens === null ? undefined : `${compact(m.remainingTokens)} of ${m.limitTokens === null ? "?" : compact(m.limitTokens)}`}
                    tone={tone(tokens)}
                  />
                </>
              )}
              {quota && <QuotaMeter quota={quota} />}
            </div>
          );
        })
      )}
      <GenericRows rows={limits.other} title="Quota events this panel does not read yet" />
    </Card>
  );
}
