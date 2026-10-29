import { worstCaseLines, type Checked, type Gate } from "./spend";

export interface SpendPanelProps {
  /** What is being bought: "the reading", "the arena pair", "the run". */
  what: string;
  checked: Checked | null;
  checking: boolean;
  /** The check itself failed (the server refused the request, or could not be reached). */
  error: string | null;
  gate: Gate;
  typed: string;
  onTyped: (word: string) => void;
  onCheck: () => void;
  onLaunch: () => void;
  launching: boolean;
  launchLabel: string;
}

/** Real spend in W2's two steps: the cost is checked at its worst case first, and only then can the word be typed. The
 * worst case and the caps are on screen before the word is: nothing here lets a launch go without them. */
export function SpendPanel({ what, checked, checking, error, gate, typed, onTyped, onCheck, onLaunch, launching, launchLabel }: SpendPanelProps) {
  const preflight = checked?.preflight ?? null;
  return (
    <section className="spend" aria-label={`Billed: ${what}`}>
      <h3 className="spend__title">Billed: {what}</h3>
      <p className="spend__lead">This sends your text to Meta&rsquo;s model API and is charged to the project&rsquo;s budget. The cost is checked first, at its worst case.</p>
      <div className="spend__row">
        <button type="button" className="btn" onClick={onCheck} disabled={checking}>
          {checking ? "Checking…" : checked ? "Check the cost again" : "Check the cost"}
        </button>
      </div>
      {error !== null && (
        <p className="spend__error" role="alert">
          {error}
        </p>
      )}
      {preflight !== null && (
        <div className="spend__check">
          {worstCaseLines(preflight).map((line, i) => (
            <p key={line} className={i === 0 ? "spend__worst" : "spend__line"}>
              {line}
            </p>
          ))}
          {preflight.refusals.length > 0 && (
            <ul className="spend__refusals" role="alert">
              {preflight.refusals.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {preflight.ok && (
            <div className="spend__confirm">
              <label className="spend__field">
                <span>
                  Type <b className="mono">{preflight.confirm_word}</b> to confirm
                </span>
                <input value={typed} onChange={(event) => onTyped(event.target.value)} autoComplete="off" spellCheck={false} aria-describedby="spend-why" />
              </label>
              <button type="button" className="btn btn--danger btn--big" disabled={!gate.launch || launching} onClick={onLaunch}>
                {launching ? "Starting…" : launchLabel}
              </button>
              {!gate.launch && (
                <p id="spend-why" className="spend__why">
                  {gate.reason}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
