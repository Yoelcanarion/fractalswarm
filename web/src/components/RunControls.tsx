import { useEffect, useState } from "react";

import { postControl, type ControlResult } from "../lib/api";
import { runCap } from "../lib/economy";
import type { ViewState } from "../lib/reducer";
import { money, virtualSeconds } from "./PanelParts";

interface Props {
  runId: string;
  view: ViewState;
  live: boolean;
}

// The kill switch asks twice: it cannot be undone, and the button sits next to inputs.
const CONFIRM_MS = 4000;

/** Budget shock and kill switch (spec §16). Both write the live run's control inbox; what they
 * did shows up in the panels once the run records ``budget.shock`` or ``run.halted``. */
export function RunControls({ runId, view, live }: Props) {
  const { economy } = view.panels;
  const cap = runCap(economy);
  const [usd, setUsd] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ControlResult | null>(null);
  const halted = economy.halted;
  const disabled = !live || busy || halted !== null;
  const value = Number(usd);
  const valid = usd.trim() !== "" && Number.isFinite(value) && value >= 0;

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const send = async (action: "halt" | "budget", body: Record<string, unknown>) => {
    setBusy(true);
    try {
      setResult(await postControl(`api/runs/${encodeURIComponent(runId)}/${action}`, body));
    } catch (error) {
      setResult({ ok: false, status: 0, detail: String(error) });
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <section className="panel controls">
      <span className="controls__label">Run controls</span>
      <form
        className="controls__shock"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !disabled) void send("budget", { usd: value, level: "run", reason: "budget shock from the UI" });
        }}
      >
        <label>
          Budget shock: new run cap $
          <input
            inputMode="decimal"
            placeholder={cap === null ? "0.50" : cap.toFixed(2)}
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
            disabled={disabled}
            aria-label="new run cap in USD"
          />
        </label>
        <button className="btn" type="submit" disabled={disabled || !valid}>
          Apply cap
        </button>
        <span className="muted">{cap === null ? "no cap set" : `now ${money(cap, 2)}`} · the ladder reacts at once</span>
      </form>
      <span className={`controls__state ${halted ? "controls__state--bad" : ""}`}>
        {halted
          ? `Halted by ${halted.by} at t = ${virtualSeconds(halted.ts)}: ${halted.reason}. Nothing starts after run.halted.`
          : live
            ? "live run: these act on it"
            : "recorded run: controls act on live runs"}
      </span>
      <div className="controls__kill">
        {armed ? (
          <>
            <button className="btn btn--danger" disabled={disabled} onClick={() => void send("halt", { reason: "kill switch from the UI" })}>
              Confirm: halt the run
            </button>
            <button className="btn" onClick={() => setArmed(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn--danger" disabled={disabled} onClick={() => setArmed(true)}>
            Kill switch
          </button>
        )}
      </div>
      {result && !halted && (
        <div className={`chaos__result ${result.ok ? "" : "chaos__result--bad"}`}>
          {result.status === 501 ? "Not wired yet — " : ""}
          {result.detail}
        </div>
      )}
    </section>
  );
}
