import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { compact } from "../lib/generic";
import { remainingShare, requestsPerMinute } from "../lib/limits";
import type { ViewState } from "../lib/reducer";
import { Card, GenericRows, Meter, Nothing, Pill, PStat, Subhead } from "./PanelParts";

const tone = (share: number | null): "good" | "warn" | "bad" | "" =>
  share === null ? "" : share < 0.1 ? "bad" : share < 0.3 ? "warn" : "";

export function LimitsPanel({ view }: { view: ViewState }) {
  const { limits } = view.panels;
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

      {models.length === 0 ? (
        <Nothing>No model call has completed yet.</Nothing>
      ) : (
        models.map((m) => {
          const requests = remainingShare(m.remainingRequests, m.limitRequests);
          const tokens = remainingShare(m.remainingTokens, m.limitTokens);
          return (
            <div key={m.model} className="limit">
              <div className="limit__head">
                <b className="mono">{m.model}</b>
                <span className="muted">{m.calls} calls · {m.calls ? Math.round(m.latencyMs / m.calls).toLocaleString("en") : 0} ms mean</span>
                {m.throttled > 0 && <Pill tone="bad">{m.throttled} × 429</Pill>}
                {m.failed > 0 && <Pill tone="bad">{m.failed} failed</Pill>}
                {m.retries > 0 && <Pill tone="warn">{m.retries} retries</Pill>}
                {m.retryAfterMs !== null && <Pill tone="warn">Retry-After {(m.retryAfterMs / 1000).toFixed(0)} s</Pill>}
              </div>
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
            </div>
          );
        })
      )}
      <GenericRows rows={limits.other} title="Quota events (AIMD) this panel does not read yet" />
    </Card>
  );
}
