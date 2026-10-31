import { useState } from "react";

import { postControl, type ControlResult } from "../lib/api";
import { isLeafKind } from "../lib/layout";
import type { ViewState } from "../lib/reducer";
import { ControlButton, useControlState } from "./ControlButton";
import { Details, Hint } from "./ui";

interface Props {
  runId: string;
  view: ViewState;
}

const NET_LABELS = [
  ["drop", "dropped"],
  ["delay", "delayed"],
  ["duplicate", "duplicated"],
  ["reorder", "reordered"],
  ["partition_drop", "cut"],
] as const;

/** What can be broken, and what was. On a live run "Kill half the brains" is the one action and the other ways to break it are under
 * Details; a recorded run cannot be changed, so it says so and points to starting a run, and its controls wait, off, under Details. */
export function ChaosPanel({ runId, view }: Props) {
  const chaos = useControlState("chaos");
  const [result, setResult] = useState<ControlResult | null>(null);
  const [busy, setBusy] = useState(false);
  const agents = view.order.filter((id) => isLeafKind(view.actors[id].kind) && view.actors[id].status === "alive");
  const [target, setTarget] = useState("");

  const fire = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      setResult(await postControl(`api/runs/${encodeURIComponent(runId)}/chaos`, body));
    } catch (error) {
      setResult({ ok: false, status: 0, detail: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const killHalf = (
    <ControlButton control="chaos" className="btn btn--danger btn--big" disabled={busy} onClick={() => fire({ kind: "kill_half" })}>
      Kill half the brains
    </ControlButton>
  );

  return (
    <section className="panel chaos">
      <header className="panel__title">
        Chaos
        <span className="panel__hint">{chaos.enabled ? "live run" : chaos.reason}</span>
      </header>
      {chaos.enabled ? (
        killHalf
      ) : (
        <p className="chaos__note">
          This run is recorded, so its failures are already in the log: the ✕ on the tree marks what was killed. <a href="#/new">Start a run</a> to kill some yourself.
        </p>
      )}
      {result && <div className={`chaos__result ${result.ok ? "" : "chaos__result--bad"}`}>{result.detail}</div>}
      {Object.keys(view.netFaults).length > 0 && (
        <Hint label="the chaos network's faults are counted, not listed; the Events tab has each one">
          <div className="chaos__net mono">
            network: {NET_LABELS.filter(([key]) => view.netFaults[key]).map(([key, label]) => `${view.netFaults[key].toLocaleString("en")} ${label}`).join(" · ")}
          </div>
        </Hint>
      )}
      {view.chaos.length > 0 && (
        <ol className="chaos__log">
          {view.chaos.map((entry) => (
            <li key={entry.seq}>
              <span className="mono">t={(entry.ts / 1000).toFixed(1)}s</span> {entry.kind}
              {entry.targets.length > 0 && <> → {entry.targets.join(", ")}</>}
            </li>
          ))}
        </ol>
      )}
      <Details inline id="chaos" summary={chaos.enabled ? "More ways to break it" : "Chaos controls"} hint={chaos.enabled ? undefined : "live runs only"}>
        {!chaos.enabled && killHalf}
        <div className="chaos__row">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="agent to kill" disabled={!chaos.enabled}>
            <option value="">any agent</option>
            {agents.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <ControlButton control="chaos" className="btn" disabled={busy} onClick={() => fire({ kind: "kill_agent", target: target || null })}>
            Kill agent
          </ControlButton>
        </div>
        <div className="chaos__row">
          <ControlButton control="chaos" className="btn" disabled={busy} onClick={() => fire({ kind: "api_storm" })}>
            API storm (429s)
          </ControlButton>
          <ControlButton control="chaos" className="btn" disabled={busy} onClick={() => fire({ kind: "net_fault" })}>
            Network faults
          </ControlButton>
        </div>
      </Details>
    </section>
  );
}
