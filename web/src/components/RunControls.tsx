import { useEffect, useState } from "react";

import { postControl, type ControlResult } from "../lib/api";
import { runCap } from "../lib/economy";
import type { ViewState } from "../lib/reducer";
import { ControlButton, useControlState } from "./ControlButton";
import { money, virtualSeconds } from "./PanelParts";
import { Details } from "./ui";

interface Props {
  runId: string;
  view: ViewState;
}

// The kill switch asks twice: it cannot be undone, and the button sits next to inputs.
const CONFIRM_MS = 4000;

/** Budget shock and kill switch (spec §16). Both write the live run's control inbox; what they
 * did shows up in the panels once the run records ``budget.shock`` or ``run.halted``. On a recording they have nothing to act on, so
 * they are folded away, the way the plan's approval is: in view while the run is live. */
export function RunControls({ runId, view }: Props) {
  const budget = useControlState("budget");
  const { economy } = view.panels;
  const cap = runCap(economy);
  const [usd, setUsd] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ControlResult | null>(null);
  const halted = economy.halted;
  const disabled = busy || halted !== null;
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

  const controls = (
    <div className="controls__body">
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
            disabled={disabled || !budget.enabled}
            aria-label="new run cap in USD"
          />
        </label>
        <ControlButton control="budget" className="btn" type="submit" disabled={disabled || !valid}>
          Apply cap
        </ControlButton>
        <span className="muted">{cap === null ? "no cap set" : `now ${money(cap, 2)}`} · the ladder reacts at once</span>
      </form>
      <div className="controls__kill">
        {armed ? (
          <>
            <ControlButton control="halt" className="btn btn--danger" disabled={disabled} onClick={() => void send("halt", { reason: "kill switch from the UI" })}>
              Confirm: halt the run
            </ControlButton>
            <button className="btn" onClick={() => setArmed(false)}>
              Cancel
            </button>
          </>
        ) : (
          <ControlButton control="halt" className="btn btn--danger" disabled={disabled} onClick={() => setArmed(true)}>
            Kill switch
          </ControlButton>
        )}
      </div>
    </div>
  );

  return (
    <section className="panel controls">
      <span className="controls__label">Run controls</span>
      {budget.enabled ? (
        controls
      ) : (
        <Details inline id="controls" summary="Budget shock and kill switch" hint="only on a live run" className="controls__fold">
          {controls}
        </Details>
      )}
      <span className={`controls__state ${halted ? "controls__state--bad" : ""}`}>
        {halted
          ? `Halted by ${halted.by} at t = ${virtualSeconds(halted.ts)}: ${halted.reason}. Nothing starts after run.halted.`
          : budget.enabled
            ? "live run: these act on it"
            : `recorded run: controls ${budget.reason}`}
      </span>
      {result && !halted && <div className={`chaos__result ${result.ok ? "" : "chaos__result--bad"}`}>{result.detail}</div>}
    </section>
  );
}
